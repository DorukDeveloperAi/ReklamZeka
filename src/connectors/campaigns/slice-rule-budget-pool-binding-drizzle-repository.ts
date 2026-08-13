import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SliceRuleBudgetPoolBinding, SliceRuleBudgetPoolBindingPort } from "@/application/slice-rule-budget-pool-binding-service";
import * as schema from "@/db/schema";
type DB=NodePgDatabase<typeof schema>; type Executor=Pick<DB,"select"|"insert"|"execute"|"transaction">;
export class SliceRuleBudgetPoolBindingRepositoryError extends Error { constructor(readonly code:"market_mismatch"|"draft_missing"|"pool_missing"|"conflict"|"invalid_input"){super(code);} }
export class DrizzleSliceRuleBudgetPoolBindingRepository implements SliceRuleBudgetPoolBindingPort { constructor(private readonly database:Executor) {}
  async bind(input:Readonly<{binding:SliceRuleBudgetPoolBinding;actorId:string}>){ const b=input.binding; return this.database.transaction(async(tx)=>{ await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`rule-pool:${b.workspaceId}:${b.draftHash}`},0))`);
    const draft=await tx.select().from(schema.sliceRuleWorkspaceDrafts).where(and(eq(schema.sliceRuleWorkspaceDrafts.workspaceId,b.workspaceId),eq(schema.sliceRuleWorkspaceDrafts.draftHash,b.draftHash))).limit(1); if(!draft[0])throw new SliceRuleBudgetPoolBindingRepositoryError("draft_missing");
    const hierarchy=await tx.select().from(schema.budgetPoolHierarchyRevisions).where(and(eq(schema.budgetPoolHierarchyRevisions.workspaceId,b.workspaceId),eq(schema.budgetPoolHierarchyRevisions.hierarchyHash,b.hierarchyHash))).limit(1); if(!hierarchy[0])throw new SliceRuleBudgetPoolBindingRepositoryError("pool_missing");
    const nodes=(hierarchy[0].hierarchyPayload as {nodes?:readonly {poolRef:string;market:"domestic"|"international"}[]}).nodes; const node=nodes?.find((candidate)=>candidate.poolRef===b.poolRef); if(!node)throw new SliceRuleBudgetPoolBindingRepositoryError("pool_missing");
    if(node.market!==b.market||draft[0].market!==b.market)throw new SliceRuleBudgetPoolBindingRepositoryError("market_mismatch");
    const existing=await tx.select().from(schema.sliceRuleBudgetPoolBindings).where(and(eq(schema.sliceRuleBudgetPoolBindings.workspaceId,b.workspaceId),eq(schema.sliceRuleBudgetPoolBindings.draftHash,b.draftHash))).limit(1); if(existing[0]){if(existing[0].hierarchyHash===b.hierarchyHash&&existing[0].poolRef===b.poolRef)return Object.freeze({outcome:"unchanged" as const});throw new SliceRuleBudgetPoolBindingRepositoryError("conflict");}
    await tx.insert(schema.sliceRuleBudgetPoolBindings).values({workspaceId:b.workspaceId,draftHash:b.draftHash,hierarchyHash:b.hierarchyHash,poolRef:b.poolRef,market:b.market,idempotencyKey:b.idempotencyKey,boundByActorId:input.actorId,bindingPayload:b as unknown as Record<string,unknown>,boundAt:new Date(b.boundAt)}); return Object.freeze({outcome:"inserted" as const}); }); }
}
