import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  P06StatusExecutionWorker,
  type P06StatusExecutionGateResolver,
} from "@/application/p06-status-execution-worker";
import { P06StatusExecutionSchedulerWorker } from "@/application/p06-status-execution-scheduler-worker";
import { DrizzleP06ExecutionRepository } from "@/connectors/actions/p06-execution-drizzle-repository";
import { DrizzleP06StatusExecutionDispatchAuthorityRepository } from "@/connectors/actions/p06-status-execution-dispatch-authority-drizzle-repository";
import { DrizzleGuideRunCandidateStagingContextRepository } from "@/connectors/guides/guide-run-candidate-staging-context-drizzle-repository";
import { DrizzleGuideRunEffectiveOverlapRepository } from "@/connectors/guides/guide-run-effective-overlap-drizzle";
import { P06MetaStatusWriter } from "@/connectors/meta/p06-meta-status-writer";
import * as schema from "@/db/schema";
import {
  p06ExecutionV2Digest,
  type P06ExecutionV2Action,
} from "@/domain/actions/p06-execution-v2";
import { resolveP08RolloutControl } from "@/server/p08-rollout-control";

type Database = NodePgDatabase<typeof schema>;
type Environment = Readonly<Record<string, string | undefined>>;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const STATUS_ACTIONS = new Set<P06ExecutionV2Action>([
  "status_pause",
  "status_activate",
]);
const RENAME_ACTIONS = new Set<P06ExecutionV2Action>([
  "campaign_rename",
  "adset_rename",
  "ad_rename",
]);

function list(value: string | undefined, maximum: number): readonly string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (
    entries.length > maximum ||
    new Set(entries).size !== entries.length ||
    entries.some((entry) => !REF.test(entry))
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([...entries].sort());
}

function actions(value: string | undefined, renameEnabled: boolean): readonly P06ExecutionV2Action[] {
  const entries = list(value, 2);
  if (
    entries.some((entry) => !STATUS_ACTIONS.has(entry as P06ExecutionV2Action)
      && !(renameEnabled && RENAME_ACTIONS.has(entry as P06ExecutionV2Action)))
  )
    return Object.freeze([]);
  return Object.freeze(entries as P06ExecutionV2Action[]);
}

function gateResolver(
  environment: Environment,
  now: () => Date,
): P06StatusExecutionGateResolver {
  return Object.freeze({
    async resolve({ phase, route }) {
      const rollout = resolveP08RolloutControl(environment);
      const capturedAt = now().toISOString();
      const workspaceAllowlist = list(
        environment.P06_META_WRITE_WORKSPACE_ALLOWLIST,
        100,
      );
      const accountAllowlist = list(
        environment.P06_META_WRITE_ACCOUNT_ALLOWLIST,
        1_000,
      );
      const actionAllowlist = actions(environment.P06_META_WRITE_ACTION_ALLOWLIST,
        environment.P06_META_RENAME_WRITE_ENABLED === "true");
      const killSwitch = environment.P06_META_WRITE_KILL_SWITCH !== "false";
      const routeEnabled = route === "human_rename_approved"
        ? environment.P06_META_RENAME_WRITE_ENABLED === "true"
        : environment.P06_META_STATUS_WRITE_ENABLED === "true";
      const enabled =
        rollout.metaWriteEnabled &&
        routeEnabled &&
        (route === "limited_autonomy_status"
          ? rollout.limitedAutonomyEnabled
          : rollout.humanActionExecutionEnabled) &&
        workspaceAllowlist.length > 0 &&
        accountAllowlist.length > 0 &&
        actionAllowlist.length > 0;
      const allowlistHash = p06ExecutionV2Digest({
        route,
        workspaceAllowlist,
        accountAllowlist,
        actionAllowlist,
        killSwitch,
      });
      return Object.freeze({
        phase,
        enabled,
        killSwitch,
        workspaceAllowlist,
        accountAllowlist,
        actionAllowlist,
        allowlistHash,
        capturedAt,
        expiresAt: new Date(Date.parse(capturedAt) + 60_000).toISOString(),
      });
    },
  });
}

function initialGate(
  environment: Environment,
  phase: "staging" | "admission",
  capturedAt: string,
  route: "human_approved" | "human_rename_approved" | "limited_autonomy_status",
) {
  const rollout = resolveP08RolloutControl(environment);
  const workspaceAllowlist = list(
    environment.P06_META_WRITE_WORKSPACE_ALLOWLIST,
    100,
  );
  const accountAllowlist = list(
    environment.P06_META_WRITE_ACCOUNT_ALLOWLIST,
    1_000,
  );
  const actionAllowlist = actions(environment.P06_META_WRITE_ACTION_ALLOWLIST,
    environment.P06_META_RENAME_WRITE_ENABLED === "true");
  const killSwitch = environment.P06_META_WRITE_KILL_SWITCH !== "false";
  const routeEnabled = route === "human_rename_approved"
    ? environment.P06_META_RENAME_WRITE_ENABLED === "true"
    : environment.P06_META_STATUS_WRITE_ENABLED === "true";
  const enabled =
    rollout.metaWriteEnabled &&
    routeEnabled &&
    (route === "limited_autonomy_status"
      ? rollout.limitedAutonomyEnabled
      : rollout.humanActionExecutionEnabled) &&
    workspaceAllowlist.length > 0 &&
    accountAllowlist.length > 0 &&
    actionAllowlist.length > 0 &&
    !killSwitch;
  return Object.freeze({
    phase,
    enabled,
    allowlistHash: p06ExecutionV2Digest({
      route,
      workspaceAllowlist,
      accountAllowlist,
      actionAllowlist,
      killSwitch,
    }),
    capturedAt,
    expiresAt: new Date(Date.parse(capturedAt) + 60_000).toISOString(),
  });
}

/**
 * Server-only and default-off. It deliberately refuses the generic read token:
 * controlled status writes require a separately provisioned credential plus
 * explicit workspace, account and action allowlists. No HTTP handler or timer
 * is installed here; a trusted scheduler must supply the lease/fence inputs.
 */
export function createP06StatusExecutionRuntime(
  input: Readonly<{
    database: Pick<Database, "execute" | "transaction">;
    environment?: Environment;
    now?: () => Date;
  }>,
) {
  const environment = input.environment ?? process.env;
  const now = input.now ?? (() => new Date());
  const token = environment.P06_META_WRITE_ACCESS_TOKEN?.trim() ?? "";
  const rollout = resolveP08RolloutControl(environment);
  const capturedAt = now().toISOString();
  const humanConfigured = rollout.humanActionExecutionEnabled &&
    initialGate(environment, "staging", capturedAt, "human_approved").enabled;
  const renameConfigured = rollout.humanActionExecutionEnabled &&
    initialGate(environment, "staging", capturedAt, "human_rename_approved").enabled;
  const limitedConfigured = rollout.limitedAutonomyEnabled &&
    initialGate(environment, "staging", capturedAt, "limited_autonomy_status").enabled;
  const configured =
    rollout.metaWriteEnabled &&
    (humanConfigured || renameConfigured || limitedConfigured) &&
    token.length > 0;
  if (!configured)
    return Object.freeze({
      enabled: false as const,
      worker: null,
      scheduler: null,
      materializeApproved: null,
      materializeRenameAttempt: null,
    });
  const repository = new DrizzleP06ExecutionRepository(input.database);
  const contexts = new DrizzleGuideRunCandidateStagingContextRepository(
    input.database,
    new DrizzleGuideRunEffectiveOverlapRepository(input.database),
  );
  const worker = new P06StatusExecutionWorker({
    repository,
    authority: new DrizzleP06StatusExecutionDispatchAuthorityRepository(
      input.database,
      contexts,
    ),
    gates: gateResolver(environment, now),
    writer: new P06MetaStatusWriter(token, fetch, { now }),
  });
  const scheduler = new P06StatusExecutionSchedulerWorker({
    repository: { listRunnable: async (limit) => {
      const boundedLimit = limit ?? 25;
      const currentRollout = resolveP08RolloutControl(environment);
      if (currentRollout.limitedAutonomyEnabled) {
        const admissions = await repository.listUnmaterializedLimitedAutonomyAdmissions(boundedLimit);
        for (const admission of admissions) {
          const evaluatedAt = now().toISOString();
          const base = Date.parse(evaluatedAt);
          const gates = [
            initialGate(environment, "staging", new Date(base - 2).toISOString(), "limited_autonomy_status"),
            initialGate(environment, "admission", new Date(base - 1).toISOString(), "limited_autonomy_status"),
          ] as const;
          if (!gates.every((gate) => gate.enabled)) continue;
          try {
            await repository.createLimitedAutonomyStatus({
              workspaceId: admission.workspaceId,
              admissionId: admission.admissionId,
              evaluatedAt,
              gates,
            });
          } catch {
            // A stale/current-policy/context rejection is a closed hold. The
            // immutable admission remains inspectable and no execution is made.
          }
        }
      }
      if (currentRollout.humanActionExecutionEnabled
        && initialGate(environment, "staging", now().toISOString(), "human_rename_approved").enabled) {
        const attempts = await repository.listUnmaterializedHumanRenameAttempts(boundedLimit);
        for (const attempt of attempts) {
          const evaluatedAt = now().toISOString();
          const base = Date.parse(evaluatedAt);
          const gates = [
            initialGate(environment, "staging", new Date(base - 2).toISOString(), "human_rename_approved"),
            initialGate(environment, "admission", new Date(base - 1).toISOString(), "human_rename_approved"),
          ] as const;
          if (!gates.every((gate) => gate.enabled)) continue;
          try { await repository.createHumanRenameApproved({ workspaceId: attempt.workspaceId, actionExecutionAttemptId: attempt.attemptId, evaluatedAt, gates }); }
          catch { /* stale approval/name/context is a closed hold; no dispatch occurs. */ }
        }
      }
      const human = currentRollout.humanActionExecutionEnabled
        ? await repository.listRunnableByRoute("human_approved", boundedLimit)
        : Object.freeze([] as string[]);
      const renames = currentRollout.humanActionExecutionEnabled
        && initialGate(environment, "staging", now().toISOString(), "human_rename_approved").enabled
        ? await repository.listRunnableByRoute("human_rename_approved", Math.max(1, boundedLimit - human.length))
        : Object.freeze([] as string[]);
      const limited = currentRollout.limitedAutonomyEnabled
        ? await repository.listRunnableByRoute("limited_autonomy_status", Math.max(1, boundedLimit - human.length - renames.length))
        : Object.freeze([] as string[]);
      return Object.freeze([...human, ...renames, ...limited].slice(0, boundedLimit));
    } },
    worker,
    now,
  });
  const materializeApproved = async (approved: Readonly<{
    workspaceId: string;
    unitRef: string;
    kind: "approve" | "reject" | "defer" | "request_changes";
    decidedAt: string;
  }>) => {
    if (approved.kind !== "approve" || !resolveP08RolloutControl(environment).humanActionExecutionEnabled) return;
    const evaluatedAt = now().toISOString();
    const base = Date.parse(evaluatedAt);
    await repository.materializeHumanApprovedUnit({
      workspaceId: approved.workspaceId,
      unitRef: approved.unitRef,
      evaluatedAt,
      gates: [
        initialGate(environment, "staging", new Date(base - 2).toISOString(), "human_approved"),
        initialGate(environment, "admission", new Date(base - 1).toISOString(), "human_approved"),
      ],
    });
  };
  const materializeRenameAttempt = async (input: Readonly<{ workspaceId: string; actionExecutionAttemptId: string }>) => {
    const evaluatedAt = now().toISOString();
    const base = Date.parse(evaluatedAt);
    const gates = [
      initialGate(environment, "staging", new Date(base - 2).toISOString(), "human_rename_approved"),
      initialGate(environment, "admission", new Date(base - 1).toISOString(), "human_rename_approved"),
    ] as const;
    if (!gates.every((gate) => gate.enabled)) return null;
    return repository.createHumanRenameApproved({ workspaceId: input.workspaceId, actionExecutionAttemptId: input.actionExecutionAttemptId, evaluatedAt, gates });
  };
  return Object.freeze({
    enabled: true as const,
    worker,
    scheduler,
    materializeApproved,
    materializeRenameAttempt,
  });
}
