import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  P06StatusExecutionWorker,
  type P06StatusExecutionGateResolver,
} from "@/application/p06-status-execution-worker";
import { DrizzleP06ExecutionRepository } from "@/connectors/actions/p06-execution-drizzle-repository";
import { P06MetaStatusWriter } from "@/connectors/meta/p06-meta-status-writer";
import * as schema from "@/db/schema";
import {
  p06ExecutionV2Digest,
  type P06ExecutionV2Action,
} from "@/domain/actions/p06-execution-v2";

type Database = NodePgDatabase<typeof schema>;
type Environment = Readonly<Record<string, string | undefined>>;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const STATUS_ACTIONS = new Set<P06ExecutionV2Action>([
  "status_pause",
  "status_activate",
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

function actions(value: string | undefined): readonly P06ExecutionV2Action[] {
  const entries = list(value, 2);
  if (
    entries.some((entry) => !STATUS_ACTIONS.has(entry as P06ExecutionV2Action))
  )
    return Object.freeze([]);
  return Object.freeze(entries as P06ExecutionV2Action[]);
}

function gateResolver(
  environment: Environment,
  now: () => Date,
): P06StatusExecutionGateResolver {
  return Object.freeze({
    async resolve({ phase }) {
      const capturedAt = now().toISOString();
      const workspaceAllowlist = list(
        environment.P06_META_WRITE_WORKSPACE_ALLOWLIST,
        100,
      );
      const accountAllowlist = list(
        environment.P06_META_WRITE_ACCOUNT_ALLOWLIST,
        1_000,
      );
      const actionAllowlist = actions(
        environment.P06_META_WRITE_ACTION_ALLOWLIST,
      );
      const killSwitch = environment.P06_META_WRITE_KILL_SWITCH !== "false";
      const enabled =
        environment.P06_META_STATUS_WRITE_ENABLED === "true" &&
        workspaceAllowlist.length > 0 &&
        accountAllowlist.length > 0 &&
        actionAllowlist.length > 0;
      const allowlistHash = p06ExecutionV2Digest({
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
  const configured =
    environment.P06_META_STATUS_WRITE_ENABLED === "true" && token.length > 0;
  if (!configured)
    return Object.freeze({ enabled: false as const, worker: null });
  const repository = new DrizzleP06ExecutionRepository(input.database);
  const worker = new P06StatusExecutionWorker({
    repository,
    gates: gateResolver(environment, now),
    writer: new P06MetaStatusWriter(token, fetch, { now }),
  });
  return Object.freeze({ enabled: true as const, worker });
}
