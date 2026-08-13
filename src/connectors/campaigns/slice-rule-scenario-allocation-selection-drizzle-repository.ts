import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { verifyBudgetProposal, type BudgetProposal } from "@/application/budget-proposal-service";
import { verifySliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type WriterDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const AUTHORITY = Object.freeze({ recommendationOnly: true as const, canPublish: false as const,
  canApprove: false as const, canExecute: false as const, canWriteMeta: false as const,
  canEnableAutomation: false as const });

export class SliceRuleScenarioAllocationSelectionRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "membership_required" | "role_denied"
    | "source_missing" | "source_ambiguous" | "source_not_selectable" | "corrupt_store" | "idempotency_conflict") {
    super("Bütçe senaryosu seçimi güvenli biçimde tamamlanamadı");
  }
}

/** Server-private command. No amount, Meta identifier, or authority can be supplied by a caller. */
export type SliceRuleScenarioAllocationSelectionCommand = Readonly<{
  workspaceId: string; draftHash: string; proposalHash: string; scenarioRef: string; allocationRef: string;
  idempotencyKey: string; selectedAt: string; actorId: string;
}>;
export type SliceRuleScenarioAllocationSelectionPort = Readonly<{
  append(input: SliceRuleScenarioAllocationSelectionCommand): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>>;
}>;

export function selectPlannedScenarioAllocation(input: Readonly<{
  alternative: BudgetProposal["alternatives"][number]; contextHash: string; allocationRef: string;
}>): Readonly<{ beforeAmountMinor: number; afterAmountMinor: number }> {
  if (input.alternative.status !== "composed") throw new SliceRuleScenarioAllocationSelectionRepositoryError("source_not_selectable");
  const result = input.alternative.result;
  if (result.status !== "planned" || result.frozenInput.hash !== input.contextHash
    || result.before.allocations.length !== 1 || result.after.allocations.length !== 1
    || result.before.allocations[0]!.ref !== input.allocationRef || result.after.allocations[0]!.ref !== input.allocationRef
    || result.before.allocations[0]!.amountMinor === result.after.allocations[0]!.amountMinor
    || result.after.allocations[0]!.deltaMinor !== result.after.allocations[0]!.amountMinor - result.before.allocations[0]!.amountMinor) {
    throw new SliceRuleScenarioAllocationSelectionRepositoryError("source_not_selectable");
  }
  return Object.freeze({ beforeAmountMinor: result.before.allocations[0]!.amountMinor, afterAmountMinor: result.after.allocations[0]!.amountMinor });
}

function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new SliceRuleScenarioAllocationSelectionRepositoryError("corrupt_store");
  }
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function valid(input: SliceRuleScenarioAllocationSelectionCommand): boolean {
  return !!input && typeof input === "object" && Object.keys(input).sort().join("|")
    === ["actorId", "allocationRef", "draftHash", "idempotencyKey", "proposalHash", "scenarioRef", "selectedAt", "workspaceId"].join("|")
    && UUID.test(input.workspaceId) && UUID.test(input.actorId) && HASH.test(input.draftHash) && HASH.test(input.proposalHash)
    && REF.test(input.scenarioRef) && REF.test(input.allocationRef) && REF.test(input.idempotencyKey)
    && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.selectedAt) && new Date(input.selectedAt).toISOString() === input.selectedAt;
}
async function assertOwnerOrAdmin(database: WriterDatabase, workspaceId: string, actorId: string): Promise<void> {
  const workspace = rows<{ id: string }>(await database.execute(sql`
    select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 1 for update`))[0];
  if (!workspace) throw new SliceRuleScenarioAllocationSelectionRepositoryError("workspace_scope_mismatch");
  const membership = rows<{ role: string }>(await database.execute(sql`
    select role from memberships where workspace_id = ${workspaceId}::uuid and user_id = ${actorId}::uuid limit 1 for update`))[0];
  if (!membership) throw new SliceRuleScenarioAllocationSelectionRepositoryError("membership_required");
  if (membership.role !== "owner" && membership.role !== "admin") throw new SliceRuleScenarioAllocationSelectionRepositoryError("role_denied");
}

/**
 * Appends one exact choice only after resolving every source from immutable
 * storage. It intentionally has no ActionUnit, approval, or Meta writer path.
 */
export class DrizzleSliceRuleScenarioAllocationSelectionRepository implements SliceRuleScenarioAllocationSelectionPort {
  constructor(private readonly database: WriterDatabase) {}

  async append(input: SliceRuleScenarioAllocationSelectionCommand) {
    if (!valid(input)) throw new SliceRuleScenarioAllocationSelectionRepositoryError("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`slice-rule-selection:${input.workspaceId}:${input.draftHash}:${input.allocationRef}`}, 0))`);
      await assertOwnerOrAdmin(tx, input.workspaceId, input.actorId);
      const replay = await tx.select().from(schema.sliceRuleScenarioAllocationSelections).where(and(
        eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, input.workspaceId),
        eq(schema.sliceRuleScenarioAllocationSelections.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (replay[0]) {
        if (replay[0].draftHash === input.draftHash && replay[0].proposalHash === input.proposalHash
          && replay[0].scenarioRef === input.scenarioRef && replay[0].allocationRef === input.allocationRef) {
          return Object.freeze({ outcome: "unchanged" as const });
        }
        throw new SliceRuleScenarioAllocationSelectionRepositoryError("idempotency_conflict");
      }
      const [drafts, bindings, proposals, entityBindings] = await Promise.all([
        tx.select().from(schema.sliceRuleWorkspaceDrafts).where(and(eq(schema.sliceRuleWorkspaceDrafts.workspaceId, input.workspaceId), eq(schema.sliceRuleWorkspaceDrafts.draftHash, input.draftHash))).limit(2),
        tx.select().from(schema.sliceRuleBudgetProposalBindings).where(and(eq(schema.sliceRuleBudgetProposalBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleBudgetProposalBindings.draftHash, input.draftHash), eq(schema.sliceRuleBudgetProposalBindings.proposalHash, input.proposalHash))).limit(2),
        tx.select().from(schema.budgetProposalVersions).where(and(eq(schema.budgetProposalVersions.workspaceId, input.workspaceId), eq(schema.budgetProposalVersions.proposalHash, input.proposalHash))).limit(2),
        tx.select().from(schema.sliceRuleAllocationEntityBindings).where(and(eq(schema.sliceRuleAllocationEntityBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleAllocationEntityBindings.draftHash, input.draftHash), eq(schema.sliceRuleAllocationEntityBindings.allocationRef, input.allocationRef))).limit(2),
      ]);
      if (drafts.length !== 1 || bindings.length !== 1 || proposals.length !== 1 || entityBindings.length !== 1) {
        throw new SliceRuleScenarioAllocationSelectionRepositoryError([drafts, bindings, proposals, entityBindings].some((items) => items.length > 1) ? "source_ambiguous" : "source_missing");
      }
      const draft = drafts[0]!;
      const proposalRow = proposals[0]!;
      const proposal = proposalRow.proposalPayload as BudgetProposal;
      if (!verifySliceRuleWorkspaceDraft(draft.draftPayload) || !verifyBudgetProposal(proposal)
        || proposal.proposalHash !== proposalRow.proposalHash || proposal.proposalRef !== proposalRow.proposalRef
        || bindings[0]!.proposalRef !== proposalRow.proposalRef
        || entityBindings[0]!.bindingPayload?.["allocationRef"] !== input.allocationRef) {
        throw new SliceRuleScenarioAllocationSelectionRepositoryError("corrupt_store");
      }
      const persistedAlternatives = await tx.select().from(schema.budgetProposalAlternatives).where(and(
        eq(schema.budgetProposalAlternatives.workspaceId, input.workspaceId), eq(schema.budgetProposalAlternatives.proposalId, proposalRow.id),
        eq(schema.budgetProposalAlternatives.proposalHash, input.proposalHash), eq(schema.budgetProposalAlternatives.scenarioRef, input.scenarioRef),
      )).limit(2);
      if (persistedAlternatives.length !== 1) throw new SliceRuleScenarioAllocationSelectionRepositoryError(persistedAlternatives.length > 1 ? "source_ambiguous" : "source_missing");
      const alternative = proposal.alternatives.filter((item) => item.scenarioRef === input.scenarioRef);
      if (alternative.length !== 1 || alternative[0]!.status !== "composed"
        || JSON.stringify(stable(persistedAlternatives[0]!.alternativePayload)) !== JSON.stringify(stable(alternative[0]!))) {
        throw new SliceRuleScenarioAllocationSelectionRepositoryError("source_not_selectable");
      }
      const selected = selectPlannedScenarioAllocation({ alternative: alternative[0]!, contextHash: proposal.scope.contextHash, allocationRef: input.allocationRef });
      const evidenceCore = Object.freeze({ proposalHash: input.proposalHash, scenarioRef: input.scenarioRef,
        allocationRef: input.allocationRef, frozenContextHash: proposal.scope.contextHash,
        allocationBindingEvidenceHash: entityBindings[0]!.sourceEvidenceHash });
      const selectionEvidence = Object.freeze({ ...evidenceCore, evidenceHash: hash(evidenceCore) });
      const payload = Object.freeze({ schemaVersion: "slice-rule-scenario-allocation-selection/1.0.0" as const,
        draftHash: input.draftHash, proposalHash: input.proposalHash, proposalRef: proposal.proposalRef,
        scenarioRef: input.scenarioRef, allocationRef: input.allocationRef,
        beforeAmountMinor: selected.beforeAmountMinor, afterAmountMinor: selected.afterAmountMinor,
        selectionEvidence, selectedAt: input.selectedAt, authority: AUTHORITY });
      await tx.insert(schema.sliceRuleScenarioAllocationSelections).values({ workspaceId: input.workspaceId, draftHash: input.draftHash,
        proposalHash: input.proposalHash, proposalRef: proposal.proposalRef, scenarioRef: input.scenarioRef, allocationRef: input.allocationRef,
        beforeAmountMinor: selected.beforeAmountMinor, afterAmountMinor: selected.afterAmountMinor,
        selectionEvidenceHash: selectionEvidence.evidenceHash, selectionEvidence, idempotencyKey: input.idempotencyKey,
        selectedByActorId: input.actorId, selectionPayload: payload, selectedAt: new Date(input.selectedAt) });
      return Object.freeze({ outcome: "inserted" as const });
    });
  }
}
