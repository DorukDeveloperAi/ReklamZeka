import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { verifyBudgetProposal, type BudgetProposal } from "@/application/budget-proposal-service";
import { verifySliceRuleWorkspaceDraft, type SliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const AUTHORITY = Object.freeze({ recommendationOnly: true, canPublish: false, canApprove: false,
  canExecute: false, canWriteMeta: false, canEnableAutomation: false });

export class SliceRuleBudgetProposalBindingError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "role_denied" | "source_missing" | "corrupt_store" | "idempotency_conflict") {
    super("Kural-bütçe provenance bağı güvenli biçimde tamamlanamadı");
    this.name = "SliceRuleBudgetProposalBindingError";
  }
}

export type SliceRuleBudgetProposalBindingPort = Readonly<{ append(input: Readonly<{
  draft: SliceRuleWorkspaceDraft;
  proposal: BudgetProposal;
  actorId: string;
  boundAt: string;
  idempotencyKey: string;
}>): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>> }>;

function valid(input: Parameters<SliceRuleBudgetProposalBindingPort["append"]>[0]): boolean {
  return verifySliceRuleWorkspaceDraft(input.draft) && verifyBudgetProposal(input.proposal)
    && UUID.test(input.actorId) && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.boundAt)
    && new Date(input.boundAt).toISOString() === input.boundAt && REF.test(input.idempotencyKey)
    && input.draft.workspaceId === input.proposal.scope.workspaceId && HASH.test(input.draft.draftHash);
}

export class DrizzleSliceRuleBudgetProposalBindingRepository implements SliceRuleBudgetProposalBindingPort {
  constructor(private readonly database: Database) {}

  async append(input: Parameters<SliceRuleBudgetProposalBindingPort["append"]>[0]) {
    if (!valid(input)) throw new SliceRuleBudgetProposalBindingError("invalid_input");
    return this.database.transaction(async (tx) => {
      const workspace = await tx.execute(sql`select m.role from workspaces w join memberships m on m.workspace_id = w.id
        where w.id = ${input.draft.workspaceId}::uuid and w.lifecycle_state = 'active' and m.user_id = ${input.actorId}::uuid
        limit 1 for update`);
      const role = (workspace as { rows?: readonly { role?: unknown }[] }).rows?.[0]?.role;
      if (role !== "owner" && role !== "admin" && role !== "analyst") throw new SliceRuleBudgetProposalBindingError("role_denied");
      const [draftRow, proposalRow] = await Promise.all([
        tx.select().from(schema.sliceRuleWorkspaceDrafts).where(and(eq(schema.sliceRuleWorkspaceDrafts.workspaceId, input.draft.workspaceId), eq(schema.sliceRuleWorkspaceDrafts.draftHash, input.draft.draftHash))).limit(1),
        tx.select().from(schema.budgetProposalVersions).where(and(eq(schema.budgetProposalVersions.workspaceId, input.draft.workspaceId), eq(schema.budgetProposalVersions.proposalHash, input.proposal.proposalHash))).limit(1),
      ]);
      if (!draftRow[0] || !proposalRow[0] || proposalRow[0].proposalRef !== input.proposal.proposalRef
        || !verifySliceRuleWorkspaceDraft(draftRow[0].draftPayload) || !verifyBudgetProposal(proposalRow[0].proposalPayload as BudgetProposal)
        || (proposalRow[0].proposalPayload as BudgetProposal).proposalHash !== input.proposal.proposalHash) {
        throw new SliceRuleBudgetProposalBindingError("source_missing");
      }
      const existing = await tx.select().from(schema.sliceRuleBudgetProposalBindings).where(and(
        eq(schema.sliceRuleBudgetProposalBindings.workspaceId, input.draft.workspaceId),
        eq(schema.sliceRuleBudgetProposalBindings.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (existing[0]) {
        if (existing[0].draftHash === input.draft.draftHash && existing[0].proposalHash === input.proposal.proposalHash) {
          return Object.freeze({ outcome: "unchanged" as const });
        }
        throw new SliceRuleBudgetProposalBindingError("idempotency_conflict");
      }
      const payload = Object.freeze({ draftHash: input.draft.draftHash, proposalHash: input.proposal.proposalHash,
        proposalRef: input.proposal.proposalRef, boundAt: input.boundAt, authority: AUTHORITY });
      await tx.insert(schema.sliceRuleBudgetProposalBindings).values({ workspaceId: input.draft.workspaceId,
        draftHash: input.draft.draftHash, proposalHash: input.proposal.proposalHash, proposalRef: input.proposal.proposalRef,
        idempotencyKey: input.idempotencyKey, boundByActorId: input.actorId, bindingPayload: payload, boundAt: new Date(input.boundAt) });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.draft.workspaceId}`}, 0))`);
      const previousHash = ((await tx.execute(sql`select event_hash from audit_events where workspace_id = ${input.draft.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`)) as { rows?: readonly { event_hash?: string }[] }).rows?.[0]?.event_hash ?? "GENESIS";
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.draft.workspaceId, actorId: input.actorId,
        action: "slice_rule.budget_proposal_bound", resourceType: "slice_rule_budget_proposal_binding", resourceId: input.proposal.proposalRef,
        occurredAt: input.boundAt, metadata: Object.freeze({ draftRef: input.draft.draftRef, proposalRef: input.proposal.proposalRef, mode: "recommendation_only" }), previousHash });
      const eventHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at)
        values (${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash}, ${eventHash}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ outcome: "inserted" as const });
    });
  }
}
