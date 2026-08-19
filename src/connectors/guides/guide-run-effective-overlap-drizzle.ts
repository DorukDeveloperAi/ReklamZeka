import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { resolveEffectiveGuideOverlap, type EffectiveGuideOverlap } from "@/domain/guides/effective-guide-overlap";
import { DrizzleGuideLifecycleRepository } from "@/connectors/guides/guide-lifecycle-drizzle-repository";
import { DrizzleGuideBudgetEvidenceRepository } from "@/connectors/guides/guide-budget-evidence-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;

/** Reads every currently active Guide in the exact slice/market, then delegates
 * canonical ordering, cap merging and conflict holding to the pure resolver. */
export class DrizzleGuideRunEffectiveOverlapRepository {
  constructor(private readonly database: Pick<Database, "execute" | "transaction">, private readonly budgetEvidence?: DrizzleGuideBudgetEvidenceRepository) {}
  async resolve(input: Readonly<{ workspaceId: string; workspaceRef: string; guideRevisionId: string; entityRef: string; sliceRef: string; market: "yerli" | "yabanci"; action: string; at: string }>): Promise<EffectiveGuideOverlap> {
    if (["budget_increase", "budget_decrease"].includes(input.action)) {
      // This is P04's authenticated target membership + v2 overlap envelope;
      // never reconstruct its caps from mutable copies in P06.
      if (!this.budgetEvidence) throw new Error("budget overlap contract composition required");
      const evidence = await this.budgetEvidence.load({ workspaceId: input.workspaceId, guideRevisionId: input.guideRevisionId, at: input.at });
      if (evidence.targetScopeRef !== input.entityRef) throw new Error("budget candidate target mismatch");
      return evidence.effectiveGuideOverlap;
    }
    return this.database.transaction(async (tx) => this.resolveInTransaction(tx, input));
  }
  async resolveInTransaction(tx: Pick<Database,"execute">, input: Readonly<{ workspaceId: string; workspaceRef: string; guideRevisionId: string; entityRef: string; sliceRef: string; market: "yerli" | "yabanci"; action: string; at: string }>): Promise<EffectiveGuideOverlap> {
    if (["budget_increase", "budget_decrease"].includes(input.action)) throw new Error("budget overlap transaction composition required");
      const result = await tx.execute(sql`
        select r.id::text revision_id,r.guide_id::text guide_id,
          exists(select 1 from guide_revision_actions a where a.workspace_id=r.workspace_id and a.guide_revision_id=r.id and a.action in ('budget_increase','budget_decrease')) budget_capable,
          exists(select 1 from guide_budget_contracts c where c.workspace_id=r.workspace_id and c.guide_revision_id=r.id) has_budget_contract
        from guide_revisions r join guide_heads h on h.workspace_id=r.workspace_id and h.guide_id=r.guide_id and h.current_active_revision_id=r.id
        join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null
        join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active'
        where r.workspace_id=${input.workspaceId}::uuid and r.slice_ref=${input.sliceRef} and r.market_key=${input.market}
        order by r.guide_id,r.id limit 1001 for share of r,h,g,w`);
      const rows = result.rows as readonly Row[];
      if (rows.length === 0 || rows.length > 1000) throw new Error("effective guide set corrupt");
      // v2 contracts carry restrictions/caps that this legacy status reader
      // cannot faithfully reconstruct. A partial reconstruction would turn a
      // persisted deny/manual lock into permission, so require the P04
      // authenticated contract path instead of silently dropping it.
      if (rows.some((row) => row.budget_capable === true || row.has_budget_contract === true)) {
        throw new Error("status overlap contract composition required");
      }
      const lifecycle = new DrizzleGuideLifecycleRepository({ transaction: async (work: (transaction: never) => Promise<unknown>) => work(tx as never) } as never);
      const guides = await Promise.all(rows.map(async (row) => {
        if (typeof row.guide_id !== "string" || typeof row.revision_id !== "string") throw new Error("effective guide set corrupt");
        return Object.freeze({ revision: await lifecycle.loadCanonicalRevision({ workspaceId: input.workspaceId, guideId: row.guide_id, revisionId: row.revision_id }), restrictions: [], numericCaps: [], unresolvedConflictRefs: [] });
      }));
      return resolveEffectiveGuideOverlap({ workspaceRef: input.workspaceRef, entityRef: input.entityRef, market: input.market, guides });
  }
}
