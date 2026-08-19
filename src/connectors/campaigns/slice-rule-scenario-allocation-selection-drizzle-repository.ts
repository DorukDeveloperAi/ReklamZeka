import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { verifyBudgetProposal, type BudgetProposal } from "@/application/budget-proposal-service";
import { verifySliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import { appendActionPreparationGateSnapshot, evaluateUnifiedActionPreparationGate, UnifiedActionPreparationGateError } from "@/connectors/campaigns/unified-action-preparation-gate";
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
    | "source_missing" | "source_ambiguous" | "source_not_selectable" | "scope_mismatch" | "market_boundary"
    | "delivery_hold" | "stale_source" | "corrupt_store" | "idempotency_conflict") {
    super("Bütçe senaryosu seçimi güvenli biçimde tamamlanamadı");
  }
}

/** Server-private command. No amount, Meta identifier, or authority can be supplied by a caller. */
export type SliceRuleScenarioAllocationSelectionCommand = Readonly<{
  workspaceId: string; draftHash: string; proposalHash: string; scenarioRef: string; allocationRef: string;
  idempotencyKey: string; selectedAt: string; actorId: string;
}>;
export type SliceRuleScenarioAllocationSelectionPort = Readonly<{
  append(input: SliceRuleScenarioAllocationSelectionCommand): Promise<Readonly<{ outcome: "inserted" | "unchanged"; selectionEvidenceHash: string }>>;
}>;
export type SliceRuleScenarioAllocationCandidate = Readonly<{
  candidateRef: string; scenarioLabel: string; beforeAmountMinor: number; afterAmountMinor: number; currency: string;
  status: "selectable" | "blocked"; blockReason: "delivery_hold" | "market_boundary" | "scope_unavailable" | "stale_source" | "already_selected" | null;
}>;
export function selectionCandidateRef(input: Readonly<{ draftHash: string; proposalHash: string; scenarioRef: string; allocationRef: string }>) {
  return `selection_candidate_${hash(input)}`;
}

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

type ResolvedSource = Readonly<{ draft: any; proposal: BudgetProposal; proposalRow: any; entityBinding: any; alternative: BudgetProposal["alternatives"][number]; selected: Readonly<{ beforeAmountMinor: number; afterAmountMinor: number }> }>;

async function resolveSource(tx: WriterDatabase, input: SliceRuleScenarioAllocationSelectionCommand): Promise<ResolvedSource> {
  const [drafts, bindings, proposals, entityBindings] = await Promise.all([
    tx.select().from(schema.sliceRuleWorkspaceDrafts).where(and(eq(schema.sliceRuleWorkspaceDrafts.workspaceId, input.workspaceId), eq(schema.sliceRuleWorkspaceDrafts.draftHash, input.draftHash))).limit(2),
    tx.select().from(schema.sliceRuleBudgetProposalBindings).where(and(eq(schema.sliceRuleBudgetProposalBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleBudgetProposalBindings.draftHash, input.draftHash), eq(schema.sliceRuleBudgetProposalBindings.proposalHash, input.proposalHash))).limit(2),
    tx.select().from(schema.budgetProposalVersions).where(and(eq(schema.budgetProposalVersions.workspaceId, input.workspaceId), eq(schema.budgetProposalVersions.proposalHash, input.proposalHash))).limit(2),
    tx.select().from(schema.sliceRuleAllocationEntityBindings).where(and(eq(schema.sliceRuleAllocationEntityBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleAllocationEntityBindings.draftHash, input.draftHash), eq(schema.sliceRuleAllocationEntityBindings.allocationRef, input.allocationRef))).limit(2),
  ]);
  if (drafts.length !== 1 || bindings.length !== 1 || proposals.length !== 1 || entityBindings.length !== 1) {
    throw new SliceRuleScenarioAllocationSelectionRepositoryError([drafts, bindings, proposals, entityBindings].some((items) => items.length > 1) ? "source_ambiguous" : "source_missing");
  }
  const draft = drafts[0]!; const proposalRow = proposals[0]!; const proposal = proposalRow.proposalPayload as BudgetProposal;
  if (!verifySliceRuleWorkspaceDraft(draft.draftPayload) || draft.draftPayload.draftHash !== input.draftHash
    || !verifyBudgetProposal(proposal) || proposal.proposalHash !== proposalRow.proposalHash || proposal.proposalRef !== proposalRow.proposalRef
    || bindings[0]!.proposalRef !== proposalRow.proposalRef || entityBindings[0]!.bindingPayload?.["allocationRef"] !== input.allocationRef) {
    throw new SliceRuleScenarioAllocationSelectionRepositoryError("corrupt_store");
  }
  const persistedAlternatives = await tx.select().from(schema.budgetProposalAlternatives).where(and(
    eq(schema.budgetProposalAlternatives.workspaceId, input.workspaceId), eq(schema.budgetProposalAlternatives.proposalId, proposalRow.id),
    eq(schema.budgetProposalAlternatives.proposalHash, input.proposalHash), eq(schema.budgetProposalAlternatives.scenarioRef, input.scenarioRef),
  )).limit(2);
  if (persistedAlternatives.length !== 1) throw new SliceRuleScenarioAllocationSelectionRepositoryError(persistedAlternatives.length > 1 ? "source_ambiguous" : "source_missing");
  const alternatives = proposal.alternatives.filter((item) => item.scenarioRef === input.scenarioRef);
  if (alternatives.length !== 1 || alternatives[0]!.status !== "composed"
    || JSON.stringify(stable(persistedAlternatives[0]!.alternativePayload)) !== JSON.stringify(stable(alternatives[0]!))) {
    throw new SliceRuleScenarioAllocationSelectionRepositoryError("source_not_selectable");
  }
  return Object.freeze({ draft, proposal, proposalRow, entityBinding: entityBindings[0]!, alternative: alternatives[0]!,
    selected: selectPlannedScenarioAllocation({ alternative: alternatives[0]!, contextHash: proposal.scope.contextHash, allocationRef: input.allocationRef }) });
}

async function assertAdmission(tx: WriterDatabase, input: SliceRuleScenarioAllocationSelectionCommand, source: ResolvedSource): Promise<void> {
  try {
    await evaluateUnifiedActionPreparationGate(tx, { workspaceId: input.workspaceId, draftHash: input.draftHash,
      proposalHash: input.proposalHash, allocationRef: input.allocationRef, stage: "selection", evaluatedAt: input.selectedAt });
  } catch (error) {
    if (error instanceof UnifiedActionPreparationGateError) throw new SliceRuleScenarioAllocationSelectionRepositoryError(error.code);
    throw error;
  }
  /* The source argument is intentionally retained so callers must resolve the
   * exact composed allocation before this shared market/delivery gate. */
  void source;
}

type CandidateCommand = Readonly<{ candidate: SliceRuleScenarioAllocationCandidate; draftHash: string; proposalHash: string; scenarioRef: string; allocationRef: string }>;
function blockReason(error: unknown): SliceRuleScenarioAllocationCandidate["blockReason"] {
  if (!(error instanceof SliceRuleScenarioAllocationSelectionRepositoryError)) return "scope_unavailable";
  if (error.code === "delivery_hold" || error.code === "market_boundary" || error.code === "stale_source") return error.code;
  return "scope_unavailable";
}
async function candidates(tx: WriterDatabase, workspaceId: string): Promise<readonly CandidateCommand[]> {
  const bindings = await tx.select().from(schema.sliceRuleBudgetProposalBindings).where(eq(schema.sliceRuleBudgetProposalBindings.workspaceId, workspaceId)).limit(101);
  const found: CandidateCommand[] = [];
  for (const binding of bindings) {
    const proposals = await tx.select().from(schema.budgetProposalVersions).where(and(eq(schema.budgetProposalVersions.workspaceId, workspaceId), eq(schema.budgetProposalVersions.proposalHash, binding.proposalHash))).limit(2);
    if (proposals.length !== 1 || !verifyBudgetProposal(proposals[0]!.proposalPayload as BudgetProposal)) continue;
    const proposal = proposals[0]!.proposalPayload as BudgetProposal;
    for (const alternative of proposal.alternatives) {
      if (alternative.status !== "composed" || alternative.result.status !== "planned" || alternative.result.before.allocations.length !== 1 || alternative.result.after.allocations.length !== 1) continue;
      const allocationRef = alternative.result.before.allocations[0]!.ref;
      const candidateRef = selectionCandidateRef({ draftHash: binding.draftHash, proposalHash: binding.proposalHash, scenarioRef: alternative.scenarioRef, allocationRef });
      const command: SliceRuleScenarioAllocationSelectionCommand = { workspaceId, draftHash: binding.draftHash, proposalHash: binding.proposalHash,
        scenarioRef: alternative.scenarioRef, allocationRef, idempotencyKey: "selection.candidate.resolve", selectedAt: "2026-01-01T00:00:00.000Z", actorId: "00000000-0000-4000-8000-000000000000" };
      let status: SliceRuleScenarioAllocationCandidate["status"] = "selectable"; let reason: SliceRuleScenarioAllocationCandidate["blockReason"] = null;
      let beforeAmountMinor: number; let afterAmountMinor: number; let currency = "";
      try {
        const source = await resolveSource(tx, command); await assertAdmission(tx, command, source);
        beforeAmountMinor = source.selected.beforeAmountMinor; afterAmountMinor = source.selected.afterAmountMinor; currency = source.entityBinding.currency;
        const existing = await tx.select().from(schema.sliceRuleScenarioAllocationSelections).where(and(eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, workspaceId), eq(schema.sliceRuleScenarioAllocationSelections.draftHash, binding.draftHash), eq(schema.sliceRuleScenarioAllocationSelections.allocationRef, allocationRef))).limit(2);
        if (existing.length) { status = "blocked"; reason = "already_selected"; }
      } catch (error) {
        status = "blocked"; reason = blockReason(error); beforeAmountMinor = alternative.result.before.allocations[0]!.amountMinor; afterAmountMinor = alternative.result.after.allocations[0]!.amountMinor;
        currency = "N/A";
      }
      found.push(Object.freeze({ candidate: Object.freeze({ candidateRef, scenarioLabel: alternative.scenarioRef, beforeAmountMinor, afterAmountMinor, currency, status, blockReason: reason }),
        draftHash: binding.draftHash, proposalHash: binding.proposalHash, scenarioRef: alternative.scenarioRef, allocationRef }));
    }
  }
  return Object.freeze(found.slice(0, 100));
}

/**
 * Appends one exact choice only after resolving every source from immutable
 * storage. It intentionally has no ActionUnit, approval, or Meta writer path.
 */
export class DrizzleSliceRuleScenarioAllocationSelectionRepository implements SliceRuleScenarioAllocationSelectionPort {
  constructor(private readonly database: WriterDatabase) {}

  async listCandidates(workspaceId: string): Promise<readonly SliceRuleScenarioAllocationCandidate[]> {
    if (!UUID.test(workspaceId)) throw new SliceRuleScenarioAllocationSelectionRepositoryError("invalid_input");
    return this.database.transaction(async (tx) => Object.freeze((await candidates(tx, workspaceId)).map((item) => item.candidate)));
  }

  async resolveCandidate(workspaceId: string, candidateRef: string) {
    if (!UUID.test(workspaceId) || !/^selection_candidate_[a-f0-9]{64}$/.test(candidateRef)) throw new SliceRuleScenarioAllocationSelectionRepositoryError("invalid_input");
    const found = await this.database.transaction(async (tx) => (await candidates(tx, workspaceId)).filter((item) => item.candidate.candidateRef === candidateRef));
    if (found.length !== 1) throw new SliceRuleScenarioAllocationSelectionRepositoryError(found.length ? "source_ambiguous" : "source_missing");
    if (found[0]!.candidate.status !== "selectable" && found[0]!.candidate.blockReason !== "already_selected") {
      throw new SliceRuleScenarioAllocationSelectionRepositoryError(found[0]!.candidate.blockReason === "delivery_hold" ? "delivery_hold" : "stale_source");
    }
    return found[0]!;
  }

  async append(input: SliceRuleScenarioAllocationSelectionCommand) {
    if (!valid(input)) throw new SliceRuleScenarioAllocationSelectionRepositoryError("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`slice-rule-selection:${input.workspaceId}:${input.draftHash}:${input.allocationRef}`}, 0))`);
      await assertOwnerOrAdmin(tx, input.workspaceId, input.actorId);
      const source = await resolveSource(tx, input);
      await assertAdmission(tx, input, source);
      const replay = await tx.select().from(schema.sliceRuleScenarioAllocationSelections).where(and(
        eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, input.workspaceId),
        eq(schema.sliceRuleScenarioAllocationSelections.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (replay[0]) {
        if (replay[0].draftHash === input.draftHash && replay[0].proposalHash === input.proposalHash
          && replay[0].scenarioRef === input.scenarioRef && replay[0].allocationRef === input.allocationRef) {
          return Object.freeze({ outcome: "unchanged" as const, selectionEvidenceHash: replay[0].selectionEvidenceHash });
        }
        throw new SliceRuleScenarioAllocationSelectionRepositoryError("idempotency_conflict");
      }
      const existing = await tx.select().from(schema.sliceRuleScenarioAllocationSelections).where(and(
        eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, input.workspaceId), eq(schema.sliceRuleScenarioAllocationSelections.draftHash, input.draftHash),
        eq(schema.sliceRuleScenarioAllocationSelections.allocationRef, input.allocationRef),
      )).limit(2);
      if (existing.length !== 0) {
        if (existing.length === 1 && existing[0]!.proposalHash === input.proposalHash && existing[0]!.scenarioRef === input.scenarioRef) {
          return Object.freeze({ outcome: "unchanged" as const, selectionEvidenceHash: existing[0]!.selectionEvidenceHash });
        }
        throw new SliceRuleScenarioAllocationSelectionRepositoryError("idempotency_conflict");
      }
      const selected = source.selected;
      const evidenceCore = Object.freeze({ proposalHash: input.proposalHash, scenarioRef: input.scenarioRef,
        allocationRef: input.allocationRef, frozenContextHash: source.proposal.scope.contextHash,
        allocationBindingEvidenceHash: source.entityBinding.sourceEvidenceHash });
      const selectionEvidence = Object.freeze({ ...evidenceCore, evidenceHash: hash(evidenceCore) });
      const payload = Object.freeze({ schemaVersion: "slice-rule-scenario-allocation-selection/1.0.0" as const,
        draftHash: input.draftHash, proposalHash: input.proposalHash, proposalRef: source.proposal.proposalRef,
        scenarioRef: input.scenarioRef, allocationRef: input.allocationRef,
        beforeAmountMinor: selected.beforeAmountMinor, afterAmountMinor: selected.afterAmountMinor,
        selectionEvidence, selectedAt: input.selectedAt, authority: AUTHORITY });
      const inserted = await tx.insert(schema.sliceRuleScenarioAllocationSelections).values({ workspaceId: input.workspaceId, draftHash: input.draftHash,
        proposalHash: input.proposalHash, proposalRef: source.proposal.proposalRef, scenarioRef: input.scenarioRef, allocationRef: input.allocationRef,
        beforeAmountMinor: selected.beforeAmountMinor, afterAmountMinor: selected.afterAmountMinor,
        selectionEvidenceHash: selectionEvidence.evidenceHash, selectionEvidence, idempotencyKey: input.idempotencyKey,
        selectedByActorId: input.actorId, selectionPayload: payload, selectedAt: new Date(input.selectedAt) }).returning({ id: schema.sliceRuleScenarioAllocationSelections.id });
      if (inserted.length !== 1) throw new SliceRuleScenarioAllocationSelectionRepositoryError("corrupt_store");
      const gate = await evaluateUnifiedActionPreparationGate(tx, { workspaceId: input.workspaceId, draftHash: input.draftHash,
        proposalHash: input.proposalHash, allocationRef: input.allocationRef, stage: "selection", evaluatedAt: input.selectedAt });
      await appendActionPreparationGateSnapshot(tx, { workspaceId: input.workspaceId, selectionId: inserted[0]!.id,
        actionProposalUnitId: null, result: gate, evaluatedAt: input.selectedAt });
      return Object.freeze({ outcome: "inserted" as const, selectionEvidenceHash: selectionEvidence.evidenceHash });
    });
  }
}
