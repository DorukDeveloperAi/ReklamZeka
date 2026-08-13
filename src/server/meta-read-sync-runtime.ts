import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ConnectorError } from "@/connectors/contract";
import { DrizzleMetaConnectionRepository } from "@/connectors/meta/connection-drizzle-repository";
import type { MetaConnectionRepository } from "@/connectors/meta/connection-repository";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import { MetaGraphClient } from "@/connectors/meta/graph-client";
import { DrizzleEnvironmentMetaSecretRepository } from "@/connectors/meta/environment-secret-drizzle-repository";
import type { MetaSecretRepository } from "@/connectors/meta/secret-repository";
import { MetaGraphSyncTransport } from "@/connectors/meta/sync/graph-transport";
import { DrizzleMetaInventoryPagePersistence } from "@/connectors/meta/sync/inventory-drizzle-repository";
import { DrizzleMetaInsightPagePersistence } from "@/connectors/meta/sync/insights-drizzle-repository";
import { TransactionBackedMetaSyncPersistenceAdapter, DrizzleMetaSyncTransactionManager } from "@/connectors/meta/sync/persistence-adapter";
import { planMetaReadSync } from "@/connectors/meta/sync/planner";
import { MetaPartialReadSyncRuntime, type MetaSyncResult, type MetaSyncRuntimeOptions } from "@/connectors/meta/sync/runtime";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type ServerDerivedMetaSyncScope = Readonly<{
  workspaceId: string;
  connectionId: string;
}>;

/** Implement this at an authenticated scheduler/route boundary, never from request JSON. */
export interface ServerDerivedMetaSyncScopeResolver {
  resolve(): Promise<ServerDerivedMetaSyncScope>;
}

export interface MetaSyncAccountScopeResolver {
  resolve(scope: ServerDerivedMetaSyncScope): Promise<readonly string[]>;
}

export type ProductionMetaReadSyncInput = Readonly<{
  parentRunId: string;
  dateStart: string;
  dateStop: string;
  dateSliceDays?: number;
  initialPageSize?: number;
  /** Bounded server-run guard; it cannot enable a write capability. */
  requestTimeoutMs?: number;
  /** Runtime-level retry budget; Graph client retries are disabled when this is supplied. */
  maxAttempts?: number;
}>;

export type ProductionMetaReadSyncResult = Readonly<{
  status: MetaSyncResult["parentRun"]["status"];
  streamCounts: Readonly<{ completed: number; partial: number; failed: number }>;
  inserted: number;
  updated: number;
  unchanged: number;
  writeNetworkCalls: 0;
  affectedGeoMaterialization?: "completed" | "deferred";
}>;

export class ProductionMetaReadSyncError extends Error {
  constructor(readonly code: "scope_unavailable" | "connection_unavailable" | "account_scope_unavailable" | "sync_failed") {
    super("Meta salt-okunur senkronizasyonu güvenli biçimde tamamlanamadı");
    this.name = "ProductionMetaReadSyncError";
  }
}

type RuntimeFactory = (options: MetaSyncRuntimeOptions) => Pick<MetaPartialReadSyncRuntime, "run">;

type ProductionMetaReadSyncDependencies = Readonly<{
  scopeResolver: ServerDerivedMetaSyncScopeResolver;
  connections: MetaConnectionRepository;
  secrets: MetaSecretRepository;
  accounts: MetaSyncAccountScopeResolver;
  inventoryPagePersistence: MetaSyncRuntimeOptions["inventoryPagePersistence"];
  insightPagePersistence?: MetaSyncRuntimeOptions["insightPagePersistence"];
  durablePersistence: MetaSyncRuntimeOptions["persistence"];
  affectedGeoMaterialization?: "completed" | "deferred";
  fetchImpl?: MetaFetch;
  runtimeFactory?: RuntimeFactory;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const META_ACCOUNT = /^act_[0-9]{1,32}$/;

function validScope(scope: ServerDerivedMetaSyncScope): boolean {
  return UUID.test(scope.workspaceId) && UUID.test(scope.connectionId);
}

function summarize(result: MetaSyncResult, affectedGeoMaterialization: "completed" | "deferred"): ProductionMetaReadSyncResult {
  return Object.freeze({
    status: result.parentRun.status,
    streamCounts: Object.freeze({
      completed: result.streamRuns.filter((run) => run.status === "completed").length,
      partial: result.streamRuns.filter((run) => run.status === "partial").length,
      failed: result.streamRuns.filter((run) => run.status === "failed").length,
    }),
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    writeNetworkCalls: 0,
    affectedGeoMaterialization,
  });
}

/**
 * Server-only orchestration. The run caller cannot supply workspace, connection,
 * account IDs, a token or a transport. Canonical inventory pages are written by
 * the dedicated port before the runtime advances its durable cursor; inventory
 * payloads therefore remain absent from the generic restart ledger.
 */
export class ProductionMetaReadSyncService {
  constructor(private readonly dependencies: ProductionMetaReadSyncDependencies) {}

  async run(input: ProductionMetaReadSyncInput): Promise<ProductionMetaReadSyncResult> {
    if (!RUN_REF.test(input.parentRunId)) throw new ProductionMetaReadSyncError("sync_failed");
    if (input.requestTimeoutMs !== undefined && (!Number.isInteger(input.requestTimeoutMs) || input.requestTimeoutMs < 1_000 || input.requestTimeoutMs > 60_000)) {
      throw new ProductionMetaReadSyncError("sync_failed");
    }
    if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 3)) {
      throw new ProductionMetaReadSyncError("sync_failed");
    }

    let scope: ServerDerivedMetaSyncScope;
    try {
      scope = await this.dependencies.scopeResolver.resolve();
    } catch {
      throw new ProductionMetaReadSyncError("scope_unavailable");
    }
    if (!validScope(scope)) throw new ProductionMetaReadSyncError("scope_unavailable");

    try {
      const connection = await this.dependencies.connections.find(scope.workspaceId, scope.connectionId);
      if (connection.status !== "active" || connection.accessMode !== "read_only") {
        throw new ProductionMetaReadSyncError("connection_unavailable");
      }

      const accountIds = [...new Set(await this.dependencies.accounts.resolve(scope))].sort();
      if (!accountIds.length || accountIds.length > 1_000 || accountIds.some((id) => !META_ACCOUNT.test(id))) {
        throw new ProductionMetaReadSyncError("account_scope_unavailable");
      }

      let token: string;
      try {
        token = await this.dependencies.secrets.resolve(connection.secretReference, scope);
      } catch {
        throw new ProductionMetaReadSyncError("connection_unavailable");
      }
      if (!token.trim()) throw new ProductionMetaReadSyncError("connection_unavailable");

      const transport = new MetaGraphSyncTransport(new MetaGraphClient(token, this.dependencies.fetchImpl, {
        graphApiVersion: connection.graphApiVersion,
        ...(input.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: input.requestTimeoutMs }),
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: 1 }),
      }));
      const createRuntime = this.dependencies.runtimeFactory ?? ((options) => new MetaPartialReadSyncRuntime(options));
      const runtime = createRuntime({
        transport,
        persistence: this.dependencies.durablePersistence,
        inventoryPagePersistence: this.dependencies.inventoryPagePersistence,
        insightPagePersistence: this.dependencies.insightPagePersistence,
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      });
      const result = await runtime.run({
        parentRunId: input.parentRunId,
        workspaceId: scope.workspaceId,
        connectionId: scope.connectionId,
        plan: planMetaReadSync({
          accountIds,
          dateStart: input.dateStart,
          dateStop: input.dateStop,
          ...(input.dateSliceDays === undefined ? {} : { dateSliceDays: input.dateSliceDays }),
          ...(input.initialPageSize === undefined ? {} : { initialPageSize: input.initialPageSize }),
        }),
      });
      return summarize(result as MetaSyncResult, this.dependencies.affectedGeoMaterialization ?? "completed");
    } catch (error) {
      if (error instanceof ProductionMetaReadSyncError) throw error;
      if (error instanceof ConnectorError && error.code === "authentication") {
        throw new ProductionMetaReadSyncError("connection_unavailable");
      }
      throw new ProductionMetaReadSyncError("sync_failed");
    }
  }
}

export class DrizzleMetaSyncAccountScopeResolver implements MetaSyncAccountScopeResolver {
  constructor(private readonly database: Database) {}

  async resolve(scope: ServerDerivedMetaSyncScope): Promise<readonly string[]> {
    if (!validScope(scope)) throw new ProductionMetaReadSyncError("scope_unavailable");
    const rows = await this.database.select({ externalAccountId: schema.adAccounts.externalAccountId })
      .from(schema.adAccounts)
      .innerJoin(schema.dataSources, and(
        eq(schema.adAccounts.dataSourceId, schema.dataSources.id),
        eq(schema.adAccounts.workspaceId, schema.dataSources.workspaceId),
      ))
      .where(and(
        eq(schema.adAccounts.workspaceId, scope.workspaceId),
        eq(schema.dataSources.workspaceId, scope.workspaceId),
        eq(schema.dataSources.metaConnectionId, scope.connectionId),
        eq(schema.dataSources.platform, "meta_ads"),
        isNull(schema.adAccounts.disappearedAt),
      )).limit(1_001);
    return Object.freeze(rows.map((row) => row.externalAccountId));
  }
}

/** Production composition point; constructing it performs no network or sync. */
export function createDrizzleProductionMetaReadSyncService(input: Readonly<{
  database: Database;
  scopeResolver: ServerDerivedMetaSyncScopeResolver;
  environment?: Record<string, string | undefined>;
  fetchImpl?: MetaFetch;
  deferAffectedGeoMaterialization?: boolean;
}>): ProductionMetaReadSyncService {
  return new ProductionMetaReadSyncService({
    scopeResolver: input.scopeResolver,
    connections: new DrizzleMetaConnectionRepository(input.database),
    secrets: new DrizzleEnvironmentMetaSecretRepository(input.database, input.environment),
    accounts: new DrizzleMetaSyncAccountScopeResolver(input.database),
    durablePersistence: new TransactionBackedMetaSyncPersistenceAdapter(
      new DrizzleMetaSyncTransactionManager(input.database),
    ),
    affectedGeoMaterialization: input.deferAffectedGeoMaterialization ? "deferred" : "completed",
    inventoryPagePersistence: new DrizzleMetaInventoryPagePersistence(input.database, undefined,
      { materializeAffectedGeo: !input.deferAffectedGeoMaterialization }),
    insightPagePersistence: new DrizzleMetaInsightPagePersistence(input.database),
    fetchImpl: input.fetchImpl,
  });
}
