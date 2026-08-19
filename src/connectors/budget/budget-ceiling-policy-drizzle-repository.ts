import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BudgetCeilingPolicyRevisionPort } from "@/application/budget-ceiling-policy-service";
import { budgetCeilingPublisherRef } from "@/application/budget-ceiling-policy-service";
import { assertValidBudgetCeilingPolicy } from "@/domain/budget/budget-ceiling-policy";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "select" | "insert" | "execute" | "transaction">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class BudgetCeilingPolicyRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "scope_denied" | "role_denied" | "revision_conflict" | "corrupt_store") { super("Bütçe ceiling politikası kalıcılaştırılamadı"); }
}
const rows = <T>(value: unknown): readonly T[] => value && typeof value === "object" && "rows" in value && Array.isArray(value.rows) ? value.rows as readonly T[] : (()=>{throw new BudgetCeilingPolicyRepositoryError("corrupt_store");})();

export class DrizzleBudgetCeilingPolicyRepository implements BudgetCeilingPolicyRevisionPort {
  constructor(private readonly database: Executor) {}
  async append(input: Parameters<BudgetCeilingPolicyRevisionPort["append"]>[0]) {
    if (!UUID.test(input.actorId) || !UUID.test(input.workspaceId)) throw new BudgetCeilingPolicyRepositoryError("invalid_input");
    const policy = assertValidBudgetCeilingPolicy(input.policy);
    if (canonicalGuideWorkspaceRef(input.workspaceId) !== policy.workspaceRef || budgetCeilingPublisherRef(input.actorId) !== policy.publishedByActorRef) throw new BudgetCeilingPolicyRepositoryError("scope_denied");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`budget-ceiling:${input.workspaceId}:${policy.limitRef}`},0))`);
      const access = rows<{ role: string }>(await tx.execute(sql`select m.role from workspaces w join memberships m on m.workspace_id=w.id and m.user_id=${input.actorId}::uuid where w.id=${input.workspaceId}::uuid and w.lifecycle_state='active' and w.tombstoned_at is null for update of w,m limit 2`));
      if (access.length !== 1) throw new BudgetCeilingPolicyRepositoryError("scope_denied");
      if (!["owner","admin"].includes(access[0]!.role)) throw new BudgetCeilingPolicyRepositoryError("role_denied");
      const existing = await tx.select().from(schema.budgetCeilingPolicyRevisions).where(and(eq(schema.budgetCeilingPolicyRevisions.workspaceId,input.workspaceId),eq(schema.budgetCeilingPolicyRevisions.limitRef,policy.limitRef),eq(schema.budgetCeilingPolicyRevisions.revision,policy.revision))).limit(2);
      if (existing.length > 1) throw new BudgetCeilingPolicyRepositoryError("corrupt_store");
      if (existing[0]) {
        const stored = assertValidBudgetCeilingPolicy(existing[0].policyPayload);
        if (stored.policyHash !== policy.policyHash) throw new BudgetCeilingPolicyRepositoryError("revision_conflict");
        return Object.freeze({ outcome:"unchanged" as const,auditAppended:false });
      }
      const history = await tx.select().from(schema.budgetCeilingPolicyRevisions).where(and(eq(schema.budgetCeilingPolicyRevisions.workspaceId,input.workspaceId),eq(schema.budgetCeilingPolicyRevisions.limitRef,policy.limitRef))).orderBy(asc(schema.budgetCeilingPolicyRevisions.revision));
      const previous = history.at(-1);
      if ((!previous && (policy.revision!==1 || policy.previousPolicyHash!==null)) || (previous && (policy.revision!==previous.revision+1 || policy.previousPolicyHash!==previous.policyHash))) throw new BudgetCeilingPolicyRepositoryError("revision_conflict");
      await tx.insert(schema.budgetCeilingPolicyRevisions).values({workspaceId:input.workspaceId,limitRef:policy.limitRef,revision:policy.revision,previousPolicyHash:policy.previousPolicyHash,policyHash:policy.policyHash,poolRef:policy.poolRef,parentLimitRef:policy.parentLimitRef,layer:policy.layer,targetScopeRef:policy.targetScopeRef,market:policy.market,currency:policy.currency,ceilingDecimal:policy.ceilingDecimal,effectiveFrom:new Date(policy.effectiveFrom),effectiveTo:new Date(policy.effectiveTo),state:policy.state,publishedByActorId:input.actorId,publishedAt:new Date(policy.publishedAt),policyPayload:policy as unknown as Record<string,unknown>});
      const previousAudit = rows<{event_hash:string}>(await tx.execute(sql`select event_hash from audit_events where workspace_id=${input.workspaceId}::uuid order by occurred_at desc,created_at desc,id desc limit 1`))[0]?.event_hash ?? "GENESIS";
      const event={id:randomUUID(),workspaceId:input.workspaceId,actorId:input.actorId,action:"budget_ceiling.policy_published",resourceType:"budget_ceiling_policy",resourceId:policy.policyHash,occurredAt:policy.publishedAt,previousHash:previousAudit};
      const eventHash=createHash("sha256").update(JSON.stringify(event)).digest("hex");
      await tx.execute(sql`insert into audit_events(id,workspace_id,actor_id,action,resource_type,resource_id,metadata,previous_hash,event_hash,occurred_at) values(${event.id}::uuid,${event.workspaceId}::uuid,${event.actorId}::uuid,${event.action},${event.resourceType},${event.resourceId},${JSON.stringify({limitRef:policy.limitRef,revision:policy.revision,state:policy.state,constraintAuthority:true})}::jsonb,${event.previousHash},${eventHash},${event.occurredAt}::timestamptz)`);
      return Object.freeze({outcome:"inserted" as const,auditAppended:true});
    });
  }
}
