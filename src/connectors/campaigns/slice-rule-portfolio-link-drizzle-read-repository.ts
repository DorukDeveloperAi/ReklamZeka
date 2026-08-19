import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { verifySliceRuleWorkspaceDraft, type SliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import { DrizzleSliceRuleDecisionTraceReadRepository, type SliceRuleDecisionTraceItem } from "@/connectors/campaigns/slice-rule-decision-trace-drizzle-read-repository";
import * as schema from "@/db/schema";
import { metaPublicReference } from "@/domain/meta/public-reference";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SliceRulePortfolioLink = Readonly<{
  campaignRef: string;
  rule: Readonly<{ seriesRef: string; revision: number; kind: SliceRuleWorkspaceDraft["operatingRule"]["rule"]["kind"] }>;
  source: Readonly<{ state: "bound"; boundAt: string }>;
  decision: SliceRuleDecisionTraceItem | null;
}>;

/**
 * Read-only join for the portfolio: a rule is shown only when its immutable
 * allocation binding names the exact canonical campaign.  The decision trace
 * remains opaque and is accepted only from its own fail-closed reader.
 */
export class DrizzleSliceRulePortfolioLinkReadRepository {
  constructor(private readonly database: Pick<Database, "select" | "execute">) {}

  async list(workspaceId: string): Promise<readonly SliceRulePortfolioLink[]> {
    if (!UUID.test(workspaceId)) throw new Error("invalid_input");
    const [rows, traces] = await Promise.all([
      this.database.select({ campaignId: schema.sliceRuleAllocationEntityBindings.campaignId,
        draftHash: schema.sliceRuleAllocationEntityBindings.draftHash, allocationRef: schema.sliceRuleAllocationEntityBindings.allocationRef,
        boundAt: schema.sliceRuleAllocationEntityBindings.boundAt, seriesRef: schema.sliceRuleWorkspaceDrafts.seriesRef,
        revision: schema.sliceRuleWorkspaceDrafts.revision, draftPayload: schema.sliceRuleWorkspaceDrafts.draftPayload })
        .from(schema.sliceRuleAllocationEntityBindings)
        .innerJoin(schema.sliceRuleWorkspaceDrafts, and(eq(schema.sliceRuleWorkspaceDrafts.workspaceId, schema.sliceRuleAllocationEntityBindings.workspaceId),
          eq(schema.sliceRuleWorkspaceDrafts.draftHash, schema.sliceRuleAllocationEntityBindings.draftHash)))
        .where(eq(schema.sliceRuleAllocationEntityBindings.workspaceId, workspaceId)).limit(101),
      new DrizzleSliceRuleDecisionTraceReadRepository(this.database as Pick<Database, "execute">).list(workspaceId),
    ]);
    if (rows.length > 100) throw new Error("corrupt_store");
    const tracesBySelection = new Map(traces.map((trace) => [trace.selectionRef, trace]));
    const selections = await this.database.select({ draftHash: schema.sliceRuleScenarioAllocationSelections.draftHash,
      allocationRef: schema.sliceRuleScenarioAllocationSelections.allocationRef, selectionEvidenceHash: schema.sliceRuleScenarioAllocationSelections.selectionEvidenceHash })
      .from(schema.sliceRuleScenarioAllocationSelections).where(eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, workspaceId)).limit(101);
    if (selections.length > 100) throw new Error("corrupt_store");
    const selectionByBinding = new Map(selections.map((selection) => [`${selection.draftHash}:${selection.allocationRef}`, selection.selectionEvidenceHash]));
    const projected = rows.map((row) => {
      const draft = row.draftPayload as SliceRuleWorkspaceDraft;
      if (!verifySliceRuleWorkspaceDraft(draft) || draft.workspaceId !== workspaceId || draft.draftHash !== row.draftHash
        || draft.seriesRef !== row.seriesRef || draft.revision !== row.revision) return null;
      const evidenceHash = selectionByBinding.get(`${row.draftHash}:${row.allocationRef}`);
      return Object.freeze({ campaignRef: metaPublicReference("campaign", workspaceId, row.campaignId),
        rule: Object.freeze({ seriesRef: draft.seriesRef, revision: draft.revision, kind: draft.operatingRule.rule.kind }),
        source: Object.freeze({ state: "bound" as const, boundAt: row.boundAt.toISOString() }),
        decision: evidenceHash ? tracesBySelection.get(`selection_${evidenceHash}`) ?? null : null,
      });
    }).filter((row): row is SliceRulePortfolioLink => row !== null);
    return Object.freeze(projected.sort((left, right) => left.campaignRef.localeCompare(right.campaignRef)
      || left.rule.seriesRef.localeCompare(right.rule.seriesRef) || left.rule.revision - right.rule.revision));
  }
}
