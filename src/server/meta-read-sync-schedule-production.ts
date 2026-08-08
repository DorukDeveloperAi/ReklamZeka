import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type {
  MetaReadSyncRetryClassifierPort,
  MetaReadSyncServiceResult,
  ScheduledMetaReadSyncService,
  ScheduledMetaReadSyncServiceFactoryPort,
} from "@/application/meta-read-sync-schedule-worker";
import { ConnectorError } from "@/connectors/contract";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import * as schema from "@/db/schema";
import {
  createDrizzleProductionMetaReadSyncService,
  ProductionMetaReadSyncError,
  type ServerDerivedMetaSyncScope,
  type ServerDerivedMetaSyncScopeResolver,
} from "@/server/meta-read-sync-runtime";

type Database = NodePgDatabase<typeof schema>;
type ServiceBuilder = (scopeResolver: ServerDerivedMetaSyncScopeResolver) => ScheduledMetaReadSyncService;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === keys.length
    && Object.keys(value as object).every((key) => keys.includes(key));
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && DATE.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

async function fixedScope(source: ServerDerivedMetaSyncScopeResolver): Promise<ServerDerivedMetaSyncScope> {
  let raw: unknown;
  try { raw = await source.resolve(); } catch { throw new ProductionMetaReadSyncError("scope_unavailable"); }
  if (!exact(raw, ["workspaceId", "connectionId"])
    || typeof raw.workspaceId !== "string" || !UUID.test(raw.workspaceId)
    || typeof raw.connectionId !== "string" || !UUID.test(raw.connectionId)) {
    throw new ProductionMetaReadSyncError("scope_unavailable");
  }
  return Object.freeze({ workspaceId: raw.workspaceId, connectionId: raw.connectionId });
}

/**
 * Scheduler-only composition boundary. A service captures one server-derived
 * workspace/connection scope and reuses it across bounded worker retries.
 */
export class ServerDerivedMetaReadSyncServiceFactory implements ScheduledMetaReadSyncServiceFactoryPort {
  constructor(private readonly build: ServiceBuilder) {}

  create(input: Readonly<{ scopeResolver: ServerDerivedMetaSyncScopeResolver }>): ScheduledMetaReadSyncService {
    if (!exact(input, ["scopeResolver"]) || typeof input.scopeResolver?.resolve !== "function") {
      throw new ProductionMetaReadSyncError("scope_unavailable");
    }
    let scopePromise: Promise<ServerDerivedMetaSyncScope> | null = null;
    let servicePromise: Promise<ScheduledMetaReadSyncService> | null = null;
    const resolveOnce = () => (scopePromise ??= fixedScope(input.scopeResolver));
    const serviceOnce = () => (servicePromise ??= resolveOnce().then((scope) => this.build({ resolve: async () => scope })));

    return Object.freeze({
      run: async (request: Parameters<ScheduledMetaReadSyncService["run"]>[0]): Promise<MetaReadSyncServiceResult> => {
        if (!exact(request, ["parentRunId", "dateStart", "dateStop"])
          || typeof request.parentRunId !== "string" || !RUN_REF.test(request.parentRunId)
          || !validDate(request.dateStart) || !validDate(request.dateStop)
          || request.dateStart > request.dateStop) throw new ProductionMetaReadSyncError("sync_failed");
        const result = await (await serviceOnce()).run({
          parentRunId: request.parentRunId,
          dateStart: request.dateStart,
          dateStop: request.dateStop,
        });
        if (!result || !["completed", "partial", "failed"].includes(result.status)
          || result.writeNetworkCalls !== 0) throw new ProductionMetaReadSyncError("sync_failed");
        return result;
      },
    });
  }
}

/** Creates the worker factory without performing a DB query or network call. */
export function createDrizzleScheduledMetaReadSyncServiceFactory(input: Readonly<{
  database: Database;
  environment?: Record<string, string | undefined>;
  fetchImpl?: MetaFetch;
}>): ScheduledMetaReadSyncServiceFactoryPort {
  if (!exact(input, ["database", ...(input.environment === undefined ? [] : ["environment"]),
    ...(input.fetchImpl === undefined ? [] : ["fetchImpl"])])) {
    throw new ProductionMetaReadSyncError("scope_unavailable");
  }
  return new ServerDerivedMetaReadSyncServiceFactory((scopeResolver) => {
    const service = createDrizzleProductionMetaReadSyncService({
      database: input.database,
      scopeResolver,
      ...(input.environment === undefined ? {} : { environment: input.environment }),
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    });
    return { run: async (request) => {
      const result = await service.run(request);
      if (!["completed", "partial", "failed"].includes(result.status)) {
        throw new ProductionMetaReadSyncError("sync_failed");
      }
      return result as MetaReadSyncServiceResult;
    } };
  });
}

/** Closed, redacted retry policy for the scheduled read-sync worker. */
export class ProductionMetaReadSyncRetryClassifier implements MetaReadSyncRetryClassifierPort {
  classify(error: unknown) {
    if (error instanceof ProductionMetaReadSyncError) {
      return Object.freeze({ reason: error.code, retryable: false });
    }
    if (error instanceof ConnectorError) {
      if (error.code === "rate_limited") return Object.freeze({ reason: "rate_limited" as const, retryable: true });
      if (error.code === "transient") return Object.freeze({ reason: "transient" as const, retryable: true });
      if (error.code === "authentication") {
        return Object.freeze({ reason: "connection_unavailable" as const, retryable: false });
      }
    }
    return Object.freeze({ reason: "sync_failed" as const, retryable: false });
  }
}
