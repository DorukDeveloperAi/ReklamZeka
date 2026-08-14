import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  buildMetaPortfolioCapability,
  type MetaPortfolioCapability,
  type MetaPortfolioConnectionFact,
  type MetaPortfolioAccountFact,
} from "@/domain/meta/portfolio-capability";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DrizzleMetaPortfolioCapabilityRepository {
  constructor(private readonly database: Database) {}

  /**
   * One short read-only snapshot for a workspace's connection/account/group
   * topology. No connection key, external account ID, raw payload, or secret
   * metadata crosses this server-side boundary.
   */
  async load(workspaceId: string): Promise<MetaPortfolioCapability> {
    if (!UUID.test(workspaceId)) throw new Error("Meta portfolio capability rejected: invalid_scope");
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`set local transaction isolation level repeatable read`);
      await transaction.execute(sql`set local transaction read only`);
      const rows = await transaction.select({
        connectionId: schema.metaConnections.id,
        displayName: schema.metaConnections.displayName,
        connectionStatus: schema.metaConnections.status,
        connectionAccessMode: schema.metaConnections.accessMode,
        grantedScopes: schema.metaConnections.grantedScopes,
        enabledCapabilities: schema.metaConnections.enabledCapabilities,
        capabilityCheckedAt: schema.metaConnections.capabilityCheckedAt,
        accountId: schema.adAccounts.id,
        accountName: schema.adAccounts.name,
        currency: schema.adAccounts.currency,
        timezone: schema.adAccounts.timezone,
        spendCapMinor: schema.adAccounts.spendCapMinor,
        disappearedAt: schema.adAccounts.disappearedAt,
        permissionSnapshot: schema.adAccounts.permissionSnapshot,
        accountCapabilitySnapshot: schema.adAccounts.capabilitySnapshot,
        groupRef: schema.accountGroups.groupRef,
      }).from(schema.metaConnections)
        .leftJoin(schema.dataSources, and(
          eq(schema.dataSources.workspaceId, schema.metaConnections.workspaceId),
          eq(schema.dataSources.metaConnectionId, schema.metaConnections.id),
        ))
        .leftJoin(schema.adAccounts, and(
          eq(schema.adAccounts.workspaceId, schema.metaConnections.workspaceId),
          eq(schema.adAccounts.dataSourceId, schema.dataSources.id),
          isNull(schema.adAccounts.disappearedAt),
        ))
        .leftJoin(schema.accountGroupAccountBindings, and(
          eq(schema.accountGroupAccountBindings.workspaceId, schema.metaConnections.workspaceId),
          eq(schema.accountGroupAccountBindings.adAccountId, schema.adAccounts.id),
        ))
        .leftJoin(schema.accountGroupRevisions, and(
          eq(schema.accountGroupRevisions.workspaceId, schema.metaConnections.workspaceId),
          eq(schema.accountGroupRevisions.id, schema.accountGroupAccountBindings.accountGroupRevisionId),
        ))
        .leftJoin(schema.accountGroups, and(
          eq(schema.accountGroups.workspaceId, schema.metaConnections.workspaceId),
          eq(schema.accountGroups.id, schema.accountGroupRevisions.accountGroupId),
          eq(schema.accountGroups.currentRevision, schema.accountGroupRevisions.revision),
          eq(schema.accountGroups.currentRevisionHash, schema.accountGroupRevisions.revisionHash),
          eq(schema.accountGroupRevisions.status, "active"),
        ))
        .where(eq(schema.metaConnections.workspaceId, workspaceId));

      const connections = new Map<string, MetaPortfolioConnectionFact>();
      const accounts = new Map<string, MetaPortfolioAccountFact>();
      for (const row of rows) {
        if (!row.connectionId || !row.displayName || !row.connectionStatus || !row.connectionAccessMode
          || !row.grantedScopes || !row.enabledCapabilities) throw new Error("Meta portfolio capability rejected: corrupt_store");
        connections.set(row.connectionId, Object.freeze({ id: row.connectionId, displayName: row.displayName,
          status: row.connectionStatus, accessMode: row.connectionAccessMode as "read_only", grantedScopes: row.grantedScopes,
          enabledCapabilities: row.enabledCapabilities, capabilityCheckedAt: row.capabilityCheckedAt?.toISOString() ?? null }));
        if (!row.accountId || !row.accountName || !row.currency || !row.timezone) continue;
        const previous = accounts.get(row.accountId);
        const groupRefs = new Set(previous?.groupRefs ?? []);
        if (row.groupRef) groupRefs.add(row.groupRef);
        accounts.set(row.accountId, Object.freeze({ id: row.accountId, connectionId: row.connectionId, name: row.accountName,
          currency: row.currency, timezone: row.timezone, spendCapMinor: row.spendCapMinor, disappearedAt: row.disappearedAt?.toISOString() ?? null,
          permissionSnapshot: row.permissionSnapshot ?? null, capabilitySnapshot: row.accountCapabilitySnapshot ?? null,
          groupRefs: Object.freeze([...groupRefs].sort()) }));
      }
      return buildMetaPortfolioCapability({ workspaceId, connections: [...connections.values()], accounts: [...accounts.values()] });
    });
  }
}
