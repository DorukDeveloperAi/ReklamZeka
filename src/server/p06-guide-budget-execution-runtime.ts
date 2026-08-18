import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { P06StatusExecutionWorker, type P06StatusExecutionGateResolver } from "@/application/p06-status-execution-worker";
import { P06StatusExecutionSchedulerWorker } from "@/application/p06-status-execution-scheduler-worker";
import { DrizzleP06ExecutionRepository } from "@/connectors/actions/p06-execution-drizzle-repository";
import { DrizzleP06GuideBudgetExecutionDispatchAuthorityRepository } from "@/connectors/actions/p06-guide-budget-execution-dispatch-authority-drizzle-repository";
import { P06MetaStatusWriter } from "@/connectors/meta/p06-meta-status-writer";
import * as schema from "@/db/schema";
import { p06ExecutionV2Digest, type P06ExecutionV2Action } from "@/domain/actions/p06-execution-v2";
import { createLocalGuideBudgetAdmissionGate } from "@/server/local-guide-budget-action-runtime";
import { resolveP08RolloutControl } from "@/server/p08-rollout-control";

type Database = NodePgDatabase<typeof schema>;
type Environment = Readonly<Record<string, string | undefined>>;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const BUDGET_ACTIONS = new Set<P06ExecutionV2Action>(["budget_decrease", "budget_increase"]);
function list(value: string | undefined, maximum: number) {
  const entries = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return entries.length <= maximum && new Set(entries).size === entries.length && entries.every((item) => REF.test(item))
    ? Object.freeze([...entries].sort()) : Object.freeze([] as string[]);
}
function actions(value: string | undefined) {
  const entries = list(value, 2);
  return entries.every((item) => BUDGET_ACTIONS.has(item as P06ExecutionV2Action))
    ? Object.freeze(entries as readonly P06ExecutionV2Action[]) : Object.freeze([] as P06ExecutionV2Action[]);
}
function inputs(environment: Environment) {
  const rollout = resolveP08RolloutControl(environment);
  const workspaceAllowlist = list(environment.P06_META_WRITE_WORKSPACE_ALLOWLIST, 100);
  const accountAllowlist = list(environment.P06_META_WRITE_ACCOUNT_ALLOWLIST, 1_000);
  const actionAllowlist = actions(environment.P06_META_BUDGET_WRITE_ACTION_ALLOWLIST);
  const killSwitch = environment.P06_META_WRITE_KILL_SWITCH !== "false";
  const enabled = rollout.metaWriteEnabled && rollout.humanActionExecutionEnabled
    && environment.P06_META_BUDGET_WRITE_ENABLED === "true" && !killSwitch
    && workspaceAllowlist.length > 0 && accountAllowlist.length > 0 && actionAllowlist.length > 0;
  return Object.freeze({ workspaceAllowlist, accountAllowlist, actionAllowlist, killSwitch, enabled,
    allowlistHash: p06ExecutionV2Digest({ route: "guide_budget_human_approved", workspaceAllowlist, accountAllowlist, actionAllowlist, killSwitch }) });
}
function gateResolver(environment: Environment, now: () => Date): P06StatusExecutionGateResolver {
  return Object.freeze({ async resolve({ phase }) {
    const current = inputs(environment), capturedAt = now().toISOString();
    return Object.freeze({ phase, ...current, capturedAt, expiresAt: new Date(Date.parse(capturedAt) + 60_000).toISOString() });
  } });
}

/**
 * Default-off Guide-budget runtime. There is no HTTP entrypoint. A private
 * scheduler first binds persisted disabled-admission evidence into execution
 * v2, then processes only the budget route under the P04 dispatch gate.
 */
export function createP06GuideBudgetExecutionRuntime(input: Readonly<{ database: Database; environment?: Environment; now?: () => Date }>) {
  const environment = input.environment ?? process.env, now = input.now ?? (() => new Date());
  const token = environment.P06_META_WRITE_ACCESS_TOKEN?.trim() ?? "";
  const rollout = resolveP08RolloutControl(environment);
  const current = inputs(environment);
  if (!rollout.metaWriteEnabled || !rollout.humanActionExecutionEnabled
    || !current.enabled || token.length === 0) {
    return Object.freeze({ enabled: false as const, worker: null, scheduler: null });
  }
  const repository = new DrizzleP06ExecutionRepository(input.database);
  const worker = new P06StatusExecutionWorker({ repository, gates: gateResolver(environment, now),
    authority: new DrizzleP06GuideBudgetExecutionDispatchAuthorityRepository(input.database, createLocalGuideBudgetAdmissionGate(input.database)),
    writer: new P06MetaStatusWriter(token, fetch, { now }) });
  const runner = new P06StatusExecutionSchedulerWorker({
    repository: { listRunnable: (limit) => repository.listRunnableByRoute("guide_budget_human_approved", limit) }, worker, now,
  });
  const scheduler = Object.freeze({ async tick(limit = 25) {
    // A runtime can outlive a rollout/kill-switch change. Do not materialize
    // another execution identity after that change; a later explicitly-open
    // tick can reconsider the immutable source through the normal admission
    // path. This is intentionally stricter than relying on the worker's
    // downstream dispatch gate alone.
    const current = inputs(environment);
    if (!current.enabled) return Object.freeze([] as const);
    const pending = await repository.listUnmaterializedGuideBudgetAttempts(limit);
    for (const source of pending) {
      const evaluatedAt = now().toISOString(), base = Date.parse(evaluatedAt);
      try {
        await repository.createGuideBudgetHumanApproved({ workspaceId: source.workspaceId, actionExecutionAttemptId: source.attemptId,
          evaluatedAt, gates: (["staging", "admission"] as const).map((phase, index) => Object.freeze({ phase,
            enabled: current.enabled, allowlistHash: current.allowlistHash, capturedAt: new Date(base - (2 - index)).toISOString(),
            expiresAt: new Date(base + 60_000).toISOString() })) });
      } catch {
        // A superseded Guide, stale approval, or changed evidence is a closed
        // hold for this candidate, not a reason to skip later independent ones.
      }
    }
    return runner.tick(limit);
  } });
  return Object.freeze({ enabled: true as const, worker, scheduler });
}
