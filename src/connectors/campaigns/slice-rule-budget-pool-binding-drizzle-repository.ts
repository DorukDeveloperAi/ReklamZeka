import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SliceRuleBudgetPoolBinding, SliceRuleBudgetPoolBindingPort } from "@/application/slice-rule-budget-pool-binding-service";
import * as schema from "@/db/schema";
type DB=NodePgDatabase<typeof schema>; type Executor=Pick<DB,"select"|"insert"|"execute"|"transaction">;
export class SliceRuleBudgetPoolBindingRepositoryError extends Error { constructor(readonly code:"market_mismatch"|"draft_missing"|"pool_missing"|"conflict"|"invalid_input"){super(code);} }
export type PublicSliceRuleBudgetPoolBinding = Readonly<{
  draftHash: string; hierarchyHash: string; poolRef: string; market: "domestic" | "international";
  boundAt: string;
  authority: Readonly<{ canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false; canEnableAutomation: false }>;
}>;
export class DrizzleSliceRuleBudgetPoolBindingRepository implements SliceRuleBudgetPoolBindingPort { constructor(private readonly database:Executor) {}
  async hasExact(input: Readonly<{ workspaceId: string; draftHash: string; market: "domestic" | "international" }>): Promise<boolean> {
    const found = await this.database.select({ draftHash: schema.sliceRuleBudgetPoolBindings.draftHash }).from(schema.sliceRuleBudgetPoolBindings).where(and(eq(schema.sliceRuleBudgetPoolBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleBudgetPoolBindings.draftHash, input.draftHash), eq(schema.sliceRuleBudgetPoolBindings.market, input.market))).limit(1);
    return found.length === 1;
  }
  async list(input: Readonly<{ workspaceId: string; actorId: string }>): Promise<readonly PublicSliceRuleBudgetPoolBinding[]> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.workspaceId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.actorId)) throw new SliceRuleBudgetPoolBindingRepositoryError("invalid_input");
    const membership = await this.database.execute(sql`select role from memberships where workspace_id=${input.workspaceId}::uuid and user_id=${input.actorId}::uuid limit 1`);
    if (!membership || typeof membership !== "object" || !("rows" in membership) || !Array.isArray(membership.rows) || membership.rows.length !== 1) throw new SliceRuleBudgetPoolBindingRepositoryError("invalid_input");
    const stored = await this.database.select().from(schema.sliceRuleBudgetPoolBindings).where(eq(schema.sliceRuleBudgetPoolBindings.workspaceId, input.workspaceId)).limit(100);
    return Object.freeze(stored.map((row) => Object.freeze({ draftHash: row.draftHash, hierarchyHash: row.hierarchyHash,
      poolRef: row.poolRef, market: row.market as "domestic" | "international", boundAt: row.boundAt.toISOString(),
      authority: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const, canEnableAutomation: false as const }),
    })));
  }
  async bind(input:Readonly<{binding:SliceRuleBudgetPoolBinding;actorId:string}>){ const b=input.binding; return this.database.transaction(async(tx)=>{ await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`rule-pool:${b.workspaceId}:${b.draftHash}`},0))`);
    const draft=await tx.select().from(schema.sliceRuleWorkspaceDrafts).where(and(eq(schema.sliceRuleWorkspaceDrafts.workspaceId,b.workspaceId),eq(schema.sliceRuleWorkspaceDrafts.draftHash,b.draftHash))).limit(1); if(!draft[0])throw new SliceRuleBudgetPoolBindingRepositoryError("draft_missing");
    const hierarchy=await tx.select().from(schema.budgetPoolHierarchyRevisions).where(and(eq(schema.budgetPoolHierarchyRevisions.workspaceId,b.workspaceId),eq(schema.budgetPoolHierarchyRevisions.hierarchyHash,b.hierarchyHash))).limit(1); if(!hierarchy[0])throw new SliceRuleBudgetPoolBindingRepositoryError("pool_missing");
    const nodes=(hierarchy[0].hierarchyPayload as {nodes?:readonly {poolRef:string;market:"domestic"|"international"}[]}).nodes; const node=nodes?.find((candidate)=>candidate.poolRef===b.poolRef); if(!node)throw new SliceRuleBudgetPoolBindingRepositoryError("pool_missing");
    if(node.market!==b.market||draft[0].market!==b.market)throw new SliceRuleBudgetPoolBindingRepositoryError("market_mismatch");
    const existing=await tx.select().from(schema.sliceRuleBudgetPoolBindings).where(and(eq(schema.sliceRuleBudgetPoolBindings.workspaceId,b.workspaceId),eq(schema.sliceRuleBudgetPoolBindings.draftHash,b.draftHash))).limit(1); if(existing[0]){if(existing[0].hierarchyHash===b.hierarchyHash&&existing[0].poolRef===b.poolRef)return Object.freeze({outcome:"unchanged" as const});throw new SliceRuleBudgetPoolBindingRepositoryError("conflict");}
    await tx.insert(schema.sliceRuleBudgetPoolBindings).values({workspaceId:b.workspaceId,draftHash:b.draftHash,hierarchyHash:b.hierarchyHash,poolRef:b.poolRef,market:b.market,idempotencyKey:b.idempotencyKey,boundByActorId:input.actorId,bindingPayload:b as unknown as Record<string,unknown>,boundAt:new Date(b.boundAt)}); return Object.freeze({outcome:"inserted" as const}); }); }
}
