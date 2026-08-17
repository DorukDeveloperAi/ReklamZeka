import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DrizzleMetaDataHealthAdapter } from "@/connectors/meta/data-health-drizzle-adapter";
import { DrizzleDataHealthFindingDevelopmentLogRepository } from "@/connectors/meta/data-health-finding-development-log-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

/** Normal full-sync derived lane only. It has no recovery/bootstrap call site and no Meta write capability. */
export interface CanonicalDataHealthPostSyncMaterializer {
  materialize(input: Readonly<{
    workspaceId: string; externalAccountIds: readonly string[]; occurredAt: string;
    /** A partial normal sync records fresh warnings but never resolves absent evidence. */
    resolveAbsent?: boolean;
  }>): Promise<void>;
}

export class DrizzleCanonicalDataHealthPostSyncMaterializer implements CanonicalDataHealthPostSyncMaterializer {
  constructor(private readonly database: Database) {}
  async materialize(input: Readonly<{ workspaceId: string; externalAccountIds: readonly string[]; occurredAt: string; resolveAbsent?: boolean }>) {
    const external = [...new Set(input.externalAccountIds)];
    if (!external.length || external.length > 250) throw new Error("canonical_data_health_account_unavailable");
    // Health reports are account-scoped today; one canonical workspace-owned
    // account-set is resolved once here rather than by the runtime loop.
    const accounts = await this.database.select({ id: schema.adAccounts.id, externalAccountId: schema.adAccounts.externalAccountId }).from(schema.adAccounts)
      .where(eq(schema.adAccounts.workspaceId, input.workspaceId)).limit(251);
    const selected = accounts.filter(account => external.includes(account.externalAccountId));
    if (selected.length !== external.length || new Set(selected.map(a => a.externalAccountId)).size !== external.length) throw new Error("canonical_data_health_account_unavailable");
    // One sync run produces one workspace-consistent report and one ledger
    // materialization.  Per-account loops caused the same report to re-enter
    // its lifecycle repeatedly and could turn a single run into many writes.
    const evaluated = await new DrizzleMetaDataHealthAdapter(this.database).evaluate({
      workspaceId: input.workspaceId, targetAdAccountId: selected[0]!.id, evaluatedAt: input.occurredAt,
    });
    await new DrizzleDataHealthFindingDevelopmentLogRepository(this.database).materialize({
      workspaceId: input.workspaceId, report: evaluated.report, occurredAt: input.occurredAt,
      resolveAbsent: input.resolveAbsent,
    });
  }
}
