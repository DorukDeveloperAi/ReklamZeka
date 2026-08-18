import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { runMetaReadSyncManualWorker, runMetaReadSyncScheduleWorker, type MetaReadSyncScheduleWorkerResult } from
  "@/application/meta-read-sync-schedule-worker";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import * as schema from "@/db/schema";
import { DrizzleMetaReadSyncLease, DrizzleMetaReadSyncScheduleRegistry } from
  "@/server/meta-read-sync-schedule-drizzle-adapters";
import { createDrizzleScheduledMetaReadSyncServiceFactory, ProductionMetaReadSyncRetryClassifier } from
  "@/server/meta-read-sync-schedule-production";
import { resolveP08RolloutControl } from "@/server/p08-rollout-control";

type Database = NodePgDatabase<typeof schema>;

export type DrizzleMetaReadSyncScheduleTickInput = Readonly<{
  now: string;
  batchSize?: number;
  concurrency?: number;
  maxAttempts?: number;
  leaseMs?: number;
}>;

export type DrizzleMetaReadSyncScheduleTickConstruction = Readonly<{
  database: Database;
  environment?: Record<string, string | undefined>;
  fetchImpl?: MetaFetch;
}>;

export class DrizzleMetaReadSyncScheduleTickError extends Error {
  constructor(readonly code: "invalid_construction" | "invalid_result" | "rollout_disabled") {
    super("Meta scheduled read-sync tick güvenli biçimde çalıştırılamadı");
    this.name = "DrizzleMetaReadSyncScheduleTickError";
  }
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === keys.length
    && Object.keys(value as object).every((key) => keys.includes(key));
}

function construction(value: unknown): value is DrizzleMetaReadSyncScheduleTickConstruction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = ["database", ...(candidate.environment === undefined ? [] : ["environment"]),
    ...(candidate.fetchImpl === undefined ? [] : ["fetchImpl"])];
  return exact(value, keys) && Boolean(candidate.database) && typeof candidate.database === "object"
    && (candidate.environment === undefined || Boolean(candidate.environment) && typeof candidate.environment === "object"
      && !Array.isArray(candidate.environment))
    && (candidate.fetchImpl === undefined || typeof candidate.fetchImpl === "function");
}

/**
 * Server-only production tick. Scope, accounts, token, ports and service
 * instances are derived behind this boundary and cannot be supplied by a tick caller.
 */
export async function runDrizzleMetaReadSyncScheduleTick(
  input: DrizzleMetaReadSyncScheduleTickInput,
  dependencies: DrizzleMetaReadSyncScheduleTickConstruction,
): Promise<MetaReadSyncScheduleWorkerResult> {
  if (!construction(dependencies)) throw new DrizzleMetaReadSyncScheduleTickError("invalid_construction");
  if (!resolveP08RolloutControl(dependencies.environment).metaReadEnabled) {
    throw new DrizzleMetaReadSyncScheduleTickError("rollout_disabled");
  }
  const result = await runMetaReadSyncScheduleWorker(input, {
    registry: new DrizzleMetaReadSyncScheduleRegistry(dependencies.database),
    leases: new DrizzleMetaReadSyncLease(dependencies.database),
    services: createDrizzleScheduledMetaReadSyncServiceFactory({ database: dependencies.database,
      ...(dependencies.environment === undefined ? {} : { environment: dependencies.environment }),
      ...(dependencies.fetchImpl === undefined ? {} : { fetchImpl: dependencies.fetchImpl }) }),
    retryClassifier: new ProductionMetaReadSyncRetryClassifier(),
  });
  if (result.actionAuthority !== "none" || result.writeNetworkCalls !== 0) {
    throw new DrizzleMetaReadSyncScheduleTickError("invalid_result");
  }
  return result;
}

/**
 * Server-only manual read fire. The caller passes only the authenticated
 * workspace chosen by the local session boundary; this factory resolves the
 * active connection and uses the same lease/worker as the six-hour scheduler.
 */
export async function runDrizzleManualMetaReadSync(
  input: Readonly<{ now: string; workspaceId: string; leaseMs?: number }>,
  dependencies: DrizzleMetaReadSyncScheduleTickConstruction,
): Promise<MetaReadSyncScheduleWorkerResult> {
  if (!input || Object.keys(input).some((key) => !["now", "workspaceId", "leaseMs"].includes(key))
    || !construction(dependencies)) throw new DrizzleMetaReadSyncScheduleTickError("invalid_construction");
  if (!resolveP08RolloutControl(dependencies.environment).metaReadEnabled) {
    throw new DrizzleMetaReadSyncScheduleTickError("rollout_disabled");
  }
  const registry = new DrizzleMetaReadSyncScheduleRegistry(dependencies.database);
  const result = await runMetaReadSyncManualWorker(input, {
    registry,
    leases: new DrizzleMetaReadSyncLease(dependencies.database),
    services: createDrizzleScheduledMetaReadSyncServiceFactory({ database: dependencies.database,
      ...(dependencies.environment === undefined ? {} : { environment: dependencies.environment }),
      ...(dependencies.fetchImpl === undefined ? {} : { fetchImpl: dependencies.fetchImpl }) }),
    retryClassifier: new ProductionMetaReadSyncRetryClassifier(),
  });
  if (result.actionAuthority !== "none" || result.writeNetworkCalls !== 0) {
    throw new DrizzleMetaReadSyncScheduleTickError("invalid_result");
  }
  return result;
}
