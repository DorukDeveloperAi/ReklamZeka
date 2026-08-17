import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { GuideBudgetActionTrustedContextReadPort } from "@/application/guide-budget-action-preparation-service";
import { metaPublicReference } from "@/domain/meta/public-reference";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type ReadDatabase = Pick<Database, "transaction">;
type Row = Readonly<Record<string, unknown>>;

/** No client-provided runtime context can cross this server-only resolver. */
export class GuideBudgetActionTrustedContextRepositoryError extends Error {
  constructor(readonly code: "owner_missing" | "owner_ambiguous" | "parent_ceiling_unavailable") { super(code); }
}
const rows = (value: unknown): readonly Row[] => value && typeof value === "object" && "rows" in value && Array.isArray(value.rows) ? value.rows as readonly Row[] : [];

/**
 * Resolves public aliases only to prove their tenant-bound identity. It never
 * substitutes the alias as an ActionUnit entity ref. Until a canonical durable
 * parent/pool ceiling exists, it fails closed after that proof.
 */
export class DrizzleGuideBudgetActionTrustedContextRepository implements GuideBudgetActionTrustedContextReadPort {
  constructor(private readonly database: ReadDatabase) {}
  async load(input: Parameters<GuideBudgetActionTrustedContextReadPort["load"]>[0]) {
    const owner = input.dryRun.effectiveBudgetOwner;
    if (!owner) throw new GuideBudgetActionTrustedContextRepositoryError("owner_missing");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level repeatable read`);
      await tx.execute(sql`set local transaction read only`);
      const candidates = rows(await tx.execute(sql`
        select c.id::text campaign_id,c.external_campaign_id,a.external_account_id,
          s.id::text adset_id,s.external_ad_set_id
        from ad_campaigns c join ad_accounts a on a.workspace_id=c.workspace_id and a.id=c.ad_account_id
        left join meta_ad_sets s on s.workspace_id=c.workspace_id and s.campaign_id=c.id and s.ad_account_id=c.ad_account_id
        where c.workspace_id=${input.workspaceId}::uuid and c.disappeared_at is null
        order by c.id,s.id limit 1001
      `));
      if (candidates.length > 1000) throw new GuideBudgetActionTrustedContextRepositoryError("owner_ambiguous");
      const matches = candidates.filter((row) => {
        const id = owner.budgetOwnerKind === "campaign" ? row.campaign_id : row.adset_id;
        return typeof id === "string" && metaPublicReference(owner.budgetOwnerKind === "campaign" ? "campaign" : "ad_set", input.workspaceId, id) === owner.budgetOwnerRef;
      });
      if (matches.length === 0) throw new GuideBudgetActionTrustedContextRepositoryError("owner_missing");
      if (matches.length !== 1) throw new GuideBudgetActionTrustedContextRepositoryError("owner_ambiguous");
      // The successful mapping intentionally remains private. There is no
      // authoritative durable parent/pool ceiling in current canonical state.
      throw new GuideBudgetActionTrustedContextRepositoryError("parent_ceiling_unavailable");
    });
  }
}
