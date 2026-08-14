import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  META_TRUST_READINESS_READ_VERSION,
  type MetaTrustReadinessReadProjection,
} from "@/application/meta-trust-readiness-read-service";
import * as schema from "@/db/schema";
import {
  DrizzleMetaTrustReadStore,
  MetaTrustReadinessEvidenceAdapter,
} from "@/connectors/meta/sync/trust-readiness-drizzle-adapter";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function connectionRef(workspaceId: string, connectionId: string): string {
  return `connection_${createHash("sha256").update(`${workspaceId}\u0000${connectionId}`).digest("hex").slice(0, 24)}`;
}

/**
 * Builds quality reports solely from the persisted canonical mirror. Scope is
 * derived from active connections and their account rows inside the read-only
 * transaction; request input can never choose a connection or account.
 */
export class DrizzleMetaTrustReadinessReadRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}

  async load(workspaceId: string): Promise<MetaTrustReadinessReadProjection> {
    if (!UUID.test(workspaceId)) throw new Error("Meta trust/readiness rejected: invalid_scope");
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`set local transaction isolation level repeatable read`);
      await transaction.execute(sql`set local transaction read only`);
      const sources = await transaction.select({
        connectionId: schema.metaConnections.id,
        accountExternalId: schema.adAccounts.externalAccountId,
      }).from(schema.metaConnections)
        .innerJoin(schema.dataSources, and(
          eq(schema.dataSources.workspaceId, schema.metaConnections.workspaceId),
          eq(schema.dataSources.metaConnectionId, schema.metaConnections.id),
        ))
        .innerJoin(schema.adAccounts, and(
          eq(schema.adAccounts.workspaceId, schema.dataSources.workspaceId),
          eq(schema.adAccounts.dataSourceId, schema.dataSources.id),
        ))
        .where(and(
          eq(schema.metaConnections.workspaceId, workspaceId),
          eq(schema.metaConnections.status, "active"),
        ));
      const byConnection = new Map<string, string[]>();
      for (const source of sources) {
        const selected = byConnection.get(source.connectionId) ?? [];
        selected.push(source.accountExternalId);
        byConnection.set(source.connectionId, selected);
      }
      const observedAt = new Date().toISOString();
      const reports = [];
      for (const [id, externalAccountIds] of [...byConnection].sort(([a], [b]) => a.localeCompare(b))) {
        const selectedExternalAccountIds = [...new Set(externalAccountIds)].sort();
        if (selectedExternalAccountIds.length === 0) continue;
        const adapter = new MetaTrustReadinessEvidenceAdapter(new DrizzleMetaTrustReadStore(transaction as unknown as Database));
        reports.push(Object.freeze({
          connectionRef: connectionRef(workspaceId, id),
          report: await adapter.buildReport({ workspaceId, connectionId: id, selectedExternalAccountIds, evaluatedAt: observedAt }),
        }));
      }
      return Object.freeze({
        version: META_TRUST_READINESS_READ_VERSION,
        reports: Object.freeze(reports),
        authority: Object.freeze({ actionAuthority: "none" as const, canPublish: false as const,
          canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }),
      });
    });
  }
}
