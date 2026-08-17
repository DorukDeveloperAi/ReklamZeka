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
import { DrizzleMetaAssetContentRepository } from "@/connectors/meta/sync/asset-content-drizzle-repository";
import { repositoryBackedMetaAssetContentRun } from "@/connectors/meta/sync/live-asset-content-service";
import { MetaCreativeContentRuntimePersistence } from "@/connectors/meta/sync/creative-content-runtime-persistence";
import { TransactionBackedMetaSyncPersistenceAdapter, DrizzleMetaSyncTransactionManager } from "@/connectors/meta/sync/persistence-adapter";
import { planMetaReadSync } from "@/connectors/meta/sync/planner";
import { MetaPartialReadSyncRuntime, type MetaSyncResult, type MetaSyncRuntimeOptions } from "@/connectors/meta/sync/runtime";
import {
  completedNormalInventoryEvidence,
  DrizzleCanonicalBudgetHistoryMaterializer,
  type CanonicalBudgetHistoryMaterializer,
} from "@/connectors/meta/sync/canonical-budget-history-materializer";
import { DrizzleCanonicalDataHealthPostSyncMaterializer, type CanonicalDataHealthPostSyncMaterializer } from "@/connectors/meta/data-health-post-sync-materializer";
import { planMetaInsightQuery } from "@/domain/meta/insights/capability-catalog";
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
  /** Server-composed duration window; it only yields a durable partial checkpoint. */
  maxRunDurationMs?: number;
}>;

/**
 * A deliberately narrow, server-owned recovery route. Callers can tune only
 * bounded execution controls and dates; they never choose an account, stream,
 * entity level, parent id, token, or transport.
 */
export type ProductionMetaReadSyncRecoveryInput = Readonly<Omit<ProductionMetaReadSyncInput, "parentRunId">>;

/**
 * A bounded historical hydration, not an operator-selectable sync endpoint.
 * Account selection and the campaign-only stream filter remain server-owned.
 */
export type ProductionMetaInsightBootstrapInput = Readonly<Omit<ProductionMetaReadSyncInput, "parentRunId">>;

export type ServerOwnedMetaRecoveryLaneId = "inventory_ad_set_v1" | "creative_ad_v1" | "creative_ad_v2" | "insights_ad_v1";

type ServerOwnedMetaRecoveryLane = Readonly<{
  id: ServerOwnedMetaRecoveryLaneId;
  accountId: string;
  /** Stable across invocations so the durable cursor is restored exactly. */
  parentRunId: string;
}>;

export type ProductionMetaReadSyncResult = Readonly<{
  status: MetaSyncResult["parentRun"]["status"];
  streamCounts: Readonly<{ completed: number; partial: number; failed: number }>;
  inserted: number;
  updated: number;
  unchanged: number;
  writeNetworkCalls: 0;
  affectedGeoMaterialization?: "completed" | "deferred";
  /** A completed GET sync stays usable if its derived history is retriable. */
  postProcess: "completed" | "not_applicable" | "partial_result";
  postProcessRetryable: boolean;
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
  /** Built only after the authoritative workspace/connection scope is resolved. */
  creativePagePersistenceFactory?: (scope: ServerDerivedMetaSyncScope) => MetaSyncRuntimeOptions["creativePagePersistence"];
  durablePersistence: MetaSyncRuntimeOptions["persistence"];
  affectedGeoMaterialization?: "completed" | "deferred";
  fetchImpl?: MetaFetch;
  runtimeFactory?: RuntimeFactory;
  recoveryLane?: ServerOwnedMetaRecoveryLane;
  /** Post-run canonical budget/config history; only normal full inventory may call it. */
  budgetHistoryMaterializer?: CanonicalBudgetHistoryMaterializer;
  /** Derived canonical health/finding ledger; normal full reads only, never recovery/bootstrap. */
  dataHealthMaterializer?: CanonicalDataHealthPostSyncMaterializer;
  /**
   * Optional only for deterministic tests. The production composition installs
   * the fixed GET-only capability selector below; no request can provide it.
   */
  insightBootstrapAccountSelector?: (input: Readonly<{
    client: MetaGraphClient;
    accountIds: readonly string[];
  }>) => Promise<readonly string[]>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const META_ACCOUNT = /^act_[0-9]{1,32}$/;
const INSIGHT_BOOTSTRAP_ACCOUNT_LIMIT = 10;

function validScope(scope: ServerDerivedMetaSyncScope): boolean {
  return UUID.test(scope.workspaceId) && UUID.test(scope.connectionId);
}

type InsightCapabilityProbeResponse = Readonly<{ data?: readonly unknown[] }>;

/**
 * Fixed, minimally wide capability gate for historical hydration. A non-empty
 * campaign-level row proves that this DB-derived account can contribute source
 * evidence; errors or empty responses are deliberately excluded rather than
 * guessed. This is body-less GET through MetaGraphClient only.
 */
async function selectInsightBootstrapAccounts(input: Readonly<{
  client: MetaGraphClient;
  accountIds: readonly string[];
}>): Promise<readonly string[]> {
  const plan = planMetaInsightQuery({
    graphApiVersion: "v23.0",
    level: "campaign",
    metrics: ["impressions"],
    attribution: { mode: "account_default" },
    timeIncrement: 1,
    grantedPermissions: ["ads_read"],
  });
  if (plan.status !== "planned") throw new ProductionMetaReadSyncError("sync_failed");
  const selected: string[] = [];
  for (const accountId of input.accountIds.slice(0, INSIGHT_BOOTSTRAP_ACCOUNT_LIMIT)) {
    try {
      const response = await input.client.get<InsightCapabilityProbeResponse>(`/${accountId}/insights`, {
        ...plan.parameters,
        date_preset: "last_30d",
        limit: "1",
      });
      if (Array.isArray(response.data) && response.data.length > 0) selected.push(accountId);
    } catch {
      // A capability failure for one account must not broaden the run to it or
      // prevent a separately proven account from being hydrated.
    }
  }
  return Object.freeze(selected);
}

function summarize(
  result: MetaSyncResult,
  affectedGeoMaterialization: "completed" | "deferred",
  postProcess: ProductionMetaReadSyncResult["postProcess"] = "not_applicable",
): ProductionMetaReadSyncResult {
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
    postProcess,
    postProcessRetryable: postProcess === "partial_result",
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
    return this.runInternal(input, null);
  }

  /**
   * Resumes one preconfigured inventory/ad-set lane only. The lane is selected
   * after the normal server-derived scope and account-scope checks, rather than
   * from CLI/HTTP input. Its stable parent id restores the existing durable
   * cursor on every idempotent recovery invocation.
   */
  async runRecoveryLane(input: ProductionMetaReadSyncRecoveryInput): Promise<ProductionMetaReadSyncResult> {
    const lane = this.dependencies.recoveryLane;
    if (!lane || !META_ACCOUNT.test(lane.accountId) || !RUN_REF.test(lane.parentRunId)) {
      throw new ProductionMetaReadSyncError("account_scope_unavailable");
    }
    // Insight evidence is date-grained. A recovery must be exactly one day so
    // an empty Graph page stays an exact empty observation rather than a
    // synthetic aggregate, and so a later day cannot inherit this day's
    // completed cursor set.
    if (lane.id === "insights_ad_v1") {
      if (input.dateStart !== input.dateStop || (input.dateSliceDays !== undefined && input.dateSliceDays !== 1)) {
        throw new ProductionMetaReadSyncError("sync_failed");
      }
      return this.runInternal({ ...input, dateSliceDays: 1, parentRunId: `${lane.parentRunId}.${input.dateStart}` }, lane);
    }
    return this.runInternal({ ...input, parentRunId: lane.parentRunId }, lane);
  }

  /**
   * Hydrates only campaign-level insights for accounts whose fixed, read-only
   * capability probe returns a row. The caller cannot choose account IDs,
   * stream/entity level, parent id, token, or Graph parameters.
   */
  async runInsightBootstrap(input: ProductionMetaInsightBootstrapInput): Promise<ProductionMetaReadSyncResult> {
    if (input.dateStart > input.dateStop) throw new ProductionMetaReadSyncError("sync_failed");
    return this.runInternal({
      ...input,
      parentRunId: `meta.read.insight.bootstrap.v1.${input.dateStart}.${input.dateStop}`,
    }, null, "insight_bootstrap");
  }

  private async runInternal(
    input: ProductionMetaReadSyncInput,
    recoveryLane: ServerOwnedMetaRecoveryLane | null,
    mode: "normal" | "insight_bootstrap" = "normal",
  ): Promise<ProductionMetaReadSyncResult> {
    if (!RUN_REF.test(input.parentRunId)) throw new ProductionMetaReadSyncError("sync_failed");
    if (input.requestTimeoutMs !== undefined && (!Number.isInteger(input.requestTimeoutMs) || input.requestTimeoutMs < 1_000 || input.requestTimeoutMs > 60_000)) {
      throw new ProductionMetaReadSyncError("sync_failed");
    }
    if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 3)) {
      throw new ProductionMetaReadSyncError("sync_failed");
    }
    if (input.maxRunDurationMs !== undefined && (!Number.isInteger(input.maxRunDurationMs) || input.maxRunDurationMs < 5_000 || input.maxRunDurationMs > 900_000)) {
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
      if (recoveryLane && !accountIds.includes(recoveryLane.accountId)) {
        throw new ProductionMetaReadSyncError("account_scope_unavailable");
      }

      let token: string;
      try {
        token = await this.dependencies.secrets.resolve(connection.secretReference, scope);
      } catch {
        throw new ProductionMetaReadSyncError("connection_unavailable");
      }
      if (!token.trim()) throw new ProductionMetaReadSyncError("connection_unavailable");

      const client = new MetaGraphClient(token, this.dependencies.fetchImpl, {
        graphApiVersion: connection.graphApiVersion,
        ...(input.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: input.requestTimeoutMs }),
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: 1 }),
      });
      const transport = new MetaGraphSyncTransport(client);
      const createRuntime = this.dependencies.runtimeFactory ?? ((options) => new MetaPartialReadSyncRuntime(options));
      const runtime = createRuntime({
        transport,
        persistence: this.dependencies.durablePersistence,
        inventoryPagePersistence: this.dependencies.inventoryPagePersistence,
        insightPagePersistence: this.dependencies.insightPagePersistence,
        creativePagePersistence: this.dependencies.creativePagePersistenceFactory?.(scope),
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
        ...(input.maxRunDurationMs === undefined ? {} : { deadlineAtEpochMs: Date.now() + input.maxRunDurationMs }),
      });
      const bootstrapAccountIds = mode === "insight_bootstrap"
        ? await (this.dependencies.insightBootstrapAccountSelector ?? selectInsightBootstrapAccounts)({ client, accountIds })
        : accountIds;
      if (!bootstrapAccountIds.length || (mode === "insight_bootstrap" && bootstrapAccountIds.length > INSIGHT_BOOTSTRAP_ACCOUNT_LIMIT)
        || bootstrapAccountIds.some((id) => !accountIds.includes(id) || !META_ACCOUNT.test(id))) {
        throw new ProductionMetaReadSyncError("account_scope_unavailable");
      }
      const fullPlan = planMetaReadSync({
        accountIds: recoveryLane ? [recoveryLane.accountId] : bootstrapAccountIds,
        dateStart: input.dateStart,
        dateStop: input.dateStop,
        ...(input.dateSliceDays === undefined ? {} : { dateSliceDays: input.dateSliceDays }),
        ...(input.initialPageSize === undefined ? {} : { initialPageSize: input.initialPageSize }),
      });
      // Each recovery lane is intentionally one fixed stream/entity-level; it
      // cannot silently fan out to another account or Meta stream.
      const plan = recoveryLane
        ? fullPlan.filter((slice) => recoveryLane.id === "inventory_ad_set_v1"
          ? slice.stream === "inventory" && slice.entityLevel === "ad_set"
          : recoveryLane.id === "creative_ad_v1" || recoveryLane.id === "creative_ad_v2"
            ? slice.stream === "creative_post" && slice.entityLevel === "ad"
            : slice.stream === "insights" && slice.entityLevel === "ad")
        : mode === "insight_bootstrap"
          ? fullPlan.filter((slice) => slice.stream === "insights" && slice.entityLevel === "campaign")
          : fullPlan;
      if (!plan.length) throw new ProductionMetaReadSyncError("account_scope_unavailable");
      const result = await runtime.run({
        parentRunId: input.parentRunId,
        workspaceId: scope.workspaceId,
        connectionId: scope.connectionId,
        plan,
      });
      const metaResult = result as MetaSyncResult;
      const inventoryEvidence = completedNormalInventoryEvidence({
        result: metaResult,
        plan,
        mode,
        recovery: recoveryLane !== null,
      });
      const shouldMaterializeDataHealth = mode === "normal" && recoveryLane === null && this.dependencies.dataHealthMaterializer !== undefined;
      if ((inventoryEvidence && this.dependencies.budgetHistoryMaterializer) || shouldMaterializeDataHealth) {
        try {
          // Derived lanes are independent. A recoverable budget-history failure
          // must not suppress the missing/stale health observation for this same
          // normal full read.
          let derivedFailure = false;
          try { if (inventoryEvidence && this.dependencies.budgetHistoryMaterializer) await this.dependencies.budgetHistoryMaterializer.materialize(inventoryEvidence); } catch { derivedFailure = true; }
          try { if (shouldMaterializeDataHealth) await this.dependencies.dataHealthMaterializer!.materialize({
            workspaceId: scope.workspaceId,
            externalAccountIds: accountIds,
            // A partial normal run is still valuable evidence: it produces
            // current health alerts, but must not resolve accounts the run did
            // not fully evaluate.  Recovery/bootstrap lanes never enter here.
            resolveAbsent: inventoryEvidence !== null,
            occurredAt: inventoryEvidence?.accounts.map(account => account.capturedAt).sort().at(-1) ?? new Date().toISOString(),
          }); } catch { derivedFailure = true; }
          if (!derivedFailure) return summarize(metaResult, this.dependencies.affectedGeoMaterialization ?? "completed", "completed");
          // The source GET/mirror is complete. This derived timeline can be
          // retried on the next normal inventory run and must never be turned
          // into a non-retryable sync_failed response.
          return summarize({ ...metaResult, parentRun: { ...metaResult.parentRun, status: "partial" } },
            this.dependencies.affectedGeoMaterialization ?? "completed", "partial_result");
        } catch { throw new ProductionMetaReadSyncError("sync_failed"); }
      }
      return summarize(metaResult, this.dependencies.affectedGeoMaterialization ?? "completed", "not_applicable");
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
      )).limit(251);
    if (rows.length > 250) throw new ProductionMetaReadSyncError("account_scope_unavailable");
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
  /** Server-composed recovery mode; request payloads cannot select it. */
  inventoryTransactionMode?: "atomic" | "idempotent_page";
  /** Server-composed recovery mode for durable checkpoint replay. */
  durableTransactionMode?: "atomic" | "idempotent_checkpoint";
  /**
   * Server deployment configuration for one resumable recovery lane. It is
   * deliberately absent from request inputs and does not grant write access.
   */
  recoveryAccountId?: string;
  /** One of the fixed server-owned lanes; absent means inventory/ad-set. */
  recoveryLaneId?: ServerOwnedMetaRecoveryLaneId;
}>): ProductionMetaReadSyncService {
  const recoveryAccountId = input.recoveryAccountId;
  const recoveryLane = recoveryAccountId === undefined ? undefined : (() => {
    const id = input.recoveryLaneId ?? "inventory_ad_set_v1";
    if (!(["inventory_ad_set_v1", "creative_ad_v1", "creative_ad_v2", "insights_ad_v1"] as const).includes(id)) {
      throw new ProductionMetaReadSyncError("account_scope_unavailable");
    }
    return Object.freeze({ id, accountId: recoveryAccountId,
      parentRunId: `meta.read.recovery.${id.replace(/_v1$/, "").replaceAll("_", ".")}.v1` });
  })();
  return new ProductionMetaReadSyncService({
    scopeResolver: input.scopeResolver,
    connections: new DrizzleMetaConnectionRepository(input.database),
    secrets: new DrizzleEnvironmentMetaSecretRepository(input.database, input.environment),
    accounts: new DrizzleMetaSyncAccountScopeResolver(input.database),
    durablePersistence: new TransactionBackedMetaSyncPersistenceAdapter(
      new DrizzleMetaSyncTransactionManager(input.database,
        input.durableTransactionMode === undefined ? {} : { transactionMode: input.durableTransactionMode }),
    ),
    affectedGeoMaterialization: input.deferAffectedGeoMaterialization ? "deferred" : "completed",
    inventoryPagePersistence: new DrizzleMetaInventoryPagePersistence(input.database, undefined,
      {
        materializeAffectedGeo: !input.deferAffectedGeoMaterialization,
        ...(input.inventoryTransactionMode === undefined ? {} : { transactionMode: input.inventoryTransactionMode }),
      }),
    insightPagePersistence: new DrizzleMetaInsightPagePersistence(input.database),
    creativePagePersistenceFactory: (scope) => new MetaCreativeContentRuntimePersistence({
      workspaceId: scope.workspaceId,
      connectionId: scope.connectionId,
      // The canonical connection repository assigns this stable external key
      // to the connection id; it is not caller-provided.
      connectionExternalKey: scope.connectionId,
    }, repositoryBackedMetaAssetContentRun(new DrizzleMetaAssetContentRepository(input.database))),
    fetchImpl: input.fetchImpl,
    recoveryLane,
    budgetHistoryMaterializer: new DrizzleCanonicalBudgetHistoryMaterializer(input.database),
    dataHealthMaterializer: new DrizzleCanonicalDataHealthPostSyncMaterializer(input.database),
  });
}
