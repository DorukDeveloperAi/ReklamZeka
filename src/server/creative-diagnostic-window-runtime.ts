import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DrizzleCreativeDiagnosticWindowInsightSnapshotRepository, CreativeDiagnosticWindowInsightSnapshotRepositoryError } from "@/connectors/analyses/creative-diagnostic-window-insight-snapshot-drizzle-repository";
import { DrizzleMetaConnectionRepository } from "@/connectors/meta/connection-drizzle-repository";
import type { MetaConnectionRepository } from "@/connectors/meta/connection-repository";
import { DrizzleEnvironmentMetaSecretRepository } from "@/connectors/meta/environment-secret-drizzle-repository";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import { MetaGraphClient } from "@/connectors/meta/graph-client";
import { MetaGraphCreativeWindowAllDaysSource } from "@/connectors/meta/creative-window-all-days-source";
import type { MetaSecretRepository } from "@/connectors/meta/secret-repository";
import { MetaGraphSyncTransport } from "@/connectors/meta/sync/graph-transport";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ServerDerivedCreativeDiagnosticWindowScope = Readonly<{
  workspaceId: string;
  configSnapshotId: string;
  windowKind: "baseline" | "recent";
  startDate: string;
  endDate: string;
  settlementPolicyRef: string;
  observedAt: string;
}>;

/** This must be implemented at a server scheduler/job boundary, never from request JSON. */
export interface ServerDerivedCreativeDiagnosticWindowScopeResolver {
  resolve(): Promise<ServerDerivedCreativeDiagnosticWindowScope>;
}

export type ProductionCreativeDiagnosticWindowResult = Readonly<{
  snapshotHash: string;
  sourceRef: string;
  inserted: boolean;
  readOnlyGraphGet: true;
  canAuthorizeAction: false;
  canExecuteWrite: false;
  canWriteMeta: false;
}>;

export class ProductionCreativeDiagnosticWindowError extends Error {
  constructor(readonly code: "scope_unavailable" | "connection_unavailable" | "insufficient_evidence" | "materialization_failed") {
    super("Creative diagnostic window güvenli biçimde üretilemedi");
    this.name = "ProductionCreativeDiagnosticWindowError";
  }
}

type ConnectionScopeResolver = Readonly<{ resolve(workspaceId: string, configSnapshotId: string): Promise<string> }>;
type WindowWriter = Pick<DrizzleCreativeDiagnosticWindowInsightSnapshotRepository, "materializeAllDays">;
type Dependencies = Readonly<{
  scopeResolver: ServerDerivedCreativeDiagnosticWindowScopeResolver;
  connectionScope: ConnectionScopeResolver;
  connections: MetaConnectionRepository;
  secrets: MetaSecretRepository;
  createWriter: (token: string, graphApiVersion: string) => WindowWriter;
}>;

function validScope(scope: ServerDerivedCreativeDiagnosticWindowScope): boolean {
  return UUID.test(scope.workspaceId)
    && UUID.test(scope.configSnapshotId)
    && ["baseline", "recent"].includes(scope.windowKind)
    && DATE.test(scope.startDate)
    && DATE.test(scope.endDate)
    && scope.startDate <= scope.endDate
    && /^creative_settlement_[a-f0-9]{24}$/.test(scope.settlementPolicyRef)
    && Number.isFinite(Date.parse(scope.observedAt))
    && new Date(scope.observedAt).toISOString() === scope.observedAt;
}

/** Server-private, GET-only composition root for all-days creative evidence. */
export class ProductionCreativeDiagnosticWindowService {
  constructor(private readonly dependencies: Dependencies) {}

  async materialize(): Promise<ProductionCreativeDiagnosticWindowResult> {
    let scope: ServerDerivedCreativeDiagnosticWindowScope;
    try { scope = await this.dependencies.scopeResolver.resolve(); }
    catch { throw new ProductionCreativeDiagnosticWindowError("scope_unavailable"); }
    if (!validScope(scope)) throw new ProductionCreativeDiagnosticWindowError("scope_unavailable");
    try {
      const connectionId = await this.dependencies.connectionScope.resolve(scope.workspaceId, scope.configSnapshotId);
      if (!UUID.test(connectionId)) throw new ProductionCreativeDiagnosticWindowError("connection_unavailable");
      const connection = await this.dependencies.connections.find(scope.workspaceId, connectionId);
      if (connection.status !== "active" || connection.accessMode !== "read_only") {
        throw new ProductionCreativeDiagnosticWindowError("connection_unavailable");
      }
      const token = await this.dependencies.secrets.resolve(connection.secretReference, { workspaceId: scope.workspaceId, connectionId });
      if (!token.trim()) throw new ProductionCreativeDiagnosticWindowError("connection_unavailable");
      const result = await this.dependencies.createWriter(token, connection.graphApiVersion).materializeAllDays(scope);
      return Object.freeze({ snapshotHash: result.snapshotHash, sourceRef: result.sourceRef, inserted: result.inserted,
        readOnlyGraphGet: true, canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false });
    } catch (error) {
      if (error instanceof ProductionCreativeDiagnosticWindowError) throw error;
      if (error instanceof CreativeDiagnosticWindowInsightSnapshotRepositoryError && ["not_found", "insufficient_evidence"].includes(error.code)) {
        throw new ProductionCreativeDiagnosticWindowError("insufficient_evidence");
      }
      throw new ProductionCreativeDiagnosticWindowError("materialization_failed");
    }
  }
}

class DrizzleCreativeDiagnosticWindowConnectionScopeResolver implements ConnectionScopeResolver {
  constructor(private readonly database: Database) {}

  async resolve(workspaceId: string, configSnapshotId: string): Promise<string> {
    const result = await this.database.execute(sql`
      select source.meta_connection_id::text as connection_id
      from meta_creative_config_snapshots config
      join meta_ads ad on ad.workspace_id = config.workspace_id and ad.id = config.ad_id and ad.disappeared_at is null
      join ad_accounts account on account.workspace_id = ad.workspace_id and account.id = ad.ad_account_id and account.disappeared_at is null
      join data_sources source on source.workspace_id = account.workspace_id and source.id = account.data_source_id
        and source.platform = 'meta_ads' and source.meta_connection_id is not null
      join workspaces workspace on workspace.id = config.workspace_id and workspace.lifecycle_state = 'active'
      where config.workspace_id = ${workspaceId}::uuid and config.id = ${configSnapshotId}::uuid
      order by source.meta_connection_id asc limit 2
    `) as unknown as Readonly<{ rows?: readonly Readonly<{ connection_id?: unknown }>[] }>;
    const rows = result.rows;
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.connection_id !== "string" || !UUID.test(rows[0].connection_id)) {
      throw new ProductionCreativeDiagnosticWindowError("connection_unavailable");
    }
    return rows[0].connection_id;
  }
}

/** Production composition point. Constructing it neither reads Meta nor writes a snapshot. */
export function createDrizzleProductionCreativeDiagnosticWindowService(input: Readonly<{
  database: Database;
  scopeResolver: ServerDerivedCreativeDiagnosticWindowScopeResolver;
  environment?: Record<string, string | undefined>;
  fetchImpl?: MetaFetch;
}>): ProductionCreativeDiagnosticWindowService {
  const secrets = new DrizzleEnvironmentMetaSecretRepository(input.database, input.environment);
  return new ProductionCreativeDiagnosticWindowService({
    scopeResolver: input.scopeResolver,
    connectionScope: new DrizzleCreativeDiagnosticWindowConnectionScopeResolver(input.database),
    connections: new DrizzleMetaConnectionRepository(input.database),
    secrets,
    createWriter: (token, graphApiVersion) => new DrizzleCreativeDiagnosticWindowInsightSnapshotRepository(
      input.database,
      undefined,
      new MetaGraphCreativeWindowAllDaysSource(new MetaGraphSyncTransport(new MetaGraphClient(token, input.fetchImpl, { graphApiVersion }))),
    ),
  });
}
