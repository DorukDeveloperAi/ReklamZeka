import { createHash } from "node:crypto";
import type {
  BudgetLabDraftCommand,
  BudgetLabDraftResult,
  BudgetLabDraftService,
} from "@/application/budget-lab-draft-service";
import {
  verifySliceRuleWorkspaceDraft,
  type ExactSliceRuleScope,
  type SliceRuleWorkspaceDraft,
} from "@/application/slice-rule-workspace-service";

export const SLICE_RULE_BUDGET_IMPACT_VERSION = "slice-rule-budget-impact/1.0.0" as const;

export type SliceRuleBudgetImpactInput = Readonly<{
  workspaceId: string;
  actorId: string;
  seriesRef: string;
  expectedDraftRef: string;
  expectedDraftHash: string;
  expectedScope: ExactSliceRuleScope;
  budgetCommand: BudgetLabDraftCommand;
}>;

export interface CurrentSliceRuleDraftPort {
  loadCurrentExact(input: Readonly<{
    workspaceId: string;
    actorId: string;
    seriesRef: string;
  }>): Promise<SliceRuleWorkspaceDraft | null>;
}

/**
 * Resolves the campaign classification from server-held frozen evidence. A UI
 * supplied market/service/family must never implement this port.
 */
export interface BudgetImpactScopeEvidencePort {
  loadExact(input: Readonly<{
    workspaceId: string;
    adAccountId: string;
    campaignId: string;
    contextHash: string;
    /** Optional scope facets must be proven from this exact frozen context too. */
    expectedScope: ExactSliceRuleScope;
  }>): Promise<Readonly<{
    state: "ready" | "missing" | "stale" | "ambiguous";
    scope: ExactSliceRuleScope | null;
    evidenceRefs: readonly string[];
  }>>;
}
/** A budget-affecting saved rule must be bound to an immutable same-market pool before any dry-run. */
export interface SliceRuleBudgetPoolBindingEvidencePort {
  hasExact(input: Readonly<{ workspaceId: string; draftHash: string; market: "domestic" | "international" }>): Promise<boolean>;
}

export type SliceRuleBudgetImpactResult = Readonly<{
  contractVersion: typeof SLICE_RULE_BUDGET_IMPACT_VERSION;
  mode: "read_only_impact_preview";
  binding: Readonly<{
    seriesRef: string;
    draftRef: string;
    draftHash: string;
    scope: ExactSliceRuleScope;
    ruleKind: SliceRuleWorkspaceDraft["operatingRule"]["rule"]["kind"];
    evidenceRefs: readonly string[];
  }>;
  budgetPreview: BudgetLabDraftResult;
  persistence: "none";
  writeOperations: 0;
  authority: Readonly<{
    recommendationOnly: true;
    canPublish: false;
    canApprove: false;
    canCreateProposal: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
}>;

export type SliceRuleBudgetImpactSavedResult = Readonly<{
  contractVersion: typeof SLICE_RULE_BUDGET_IMPACT_VERSION;
  mode: "saved_advisory_draft";
  binding: SliceRuleBudgetImpactResult["binding"];
  budgetProposal: BudgetLabDraftResult["proposal"];
  persistence: "inserted" | "unchanged";
  provenance: "inserted" | "unchanged";
  authority: SliceRuleBudgetImpactResult["authority"];
}>;

export class SliceRuleBudgetImpactError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "draft_missing"
    | "stale_draft"
    | "scope_evidence_not_ready"
    | "market_boundary"
    | "scope_mismatch"
    | "pool_binding_required"
    | "unsafe_budget_preview"
    | "provenance_unavailable") {
    super(`Slice Rule bütçe etki önizlemesi reddedildi: ${code}`);
    this.name = "SliceRuleBudgetImpactError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const DRAFT_REF = /^slice_rule_draft_[a-f0-9]{20}$/;
const HASH = /^[a-f0-9]{64}$/;
const AUTHORITY = Object.freeze({ recommendationOnly: true as const, canPublish: false as const,
  canApprove: false as const, canCreateProposal: false as const, canExecute: false as const,
  canWriteMeta: false as const });

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function sameScope(left: ExactSliceRuleScope, right: ExactSliceRuleScope): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function assertInput(input: SliceRuleBudgetImpactInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).sort().join("|") !== ["actorId", "budgetCommand", "expectedDraftHash",
      "expectedDraftRef", "expectedScope", "seriesRef", "workspaceId"].sort().join("|")
    || !UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !REF.test(input.seriesRef)
    || !DRAFT_REF.test(input.expectedDraftRef) || !HASH.test(input.expectedDraftHash)
    || !input.budgetCommand || typeof input.budgetCommand !== "object"
    || !input.budgetCommand.scope || !UUID.test(input.budgetCommand.scope.adAccountId)
    || !UUID.test(input.budgetCommand.scope.campaignId) || !HASH.test(input.budgetCommand.scope.contextHash)) {
    throw new SliceRuleBudgetImpactError("invalid_input");
  }
}

function safeBudgetPreview(value: BudgetLabDraftResult): boolean {
  return value.contractVersion === "budget-lab-draft/1.0.0" && value.mode === "dry_run"
    && value.persistence === "none" && value.auditAppended === false
    && value.authority.draftOnly === true && value.authority.canApprove === false
    && value.authority.canExecute === false && value.authority.canWriteMeta === false
    && value.proposal.actionAuthority === "none" && value.proposal.writeOperations === 0;
}

export class SliceRuleBudgetImpactService {
  constructor(
    private readonly drafts: CurrentSliceRuleDraftPort,
    private readonly scopeEvidence: BudgetImpactScopeEvidencePort,
    private readonly budgetLab: Pick<BudgetLabDraftService, "dryRun"> & Partial<Pick<BudgetLabDraftService, "saveRuleLinkedDraft">>,
    private readonly poolBindings?: SliceRuleBudgetPoolBindingEvidencePort,
  ) {}

  async preview(input: SliceRuleBudgetImpactInput): Promise<SliceRuleBudgetImpactResult> {
    assertInput(input);
    const draft = await this.drafts.loadCurrentExact({ workspaceId: input.workspaceId,
      actorId: input.actorId, seriesRef: input.seriesRef });
    if (!draft) throw new SliceRuleBudgetImpactError("draft_missing");
    if (!verifySliceRuleWorkspaceDraft(draft) || draft.workspaceId !== input.workspaceId
      || draft.seriesRef !== input.seriesRef || draft.draftRef !== input.expectedDraftRef
      || draft.draftHash !== input.expectedDraftHash || !sameScope(draft.scope, input.expectedScope)) {
      throw new SliceRuleBudgetImpactError("stale_draft");
    }
    if (draft.status !== "draft" || draft.operatingMode !== "recommendation_only"
      || Object.values(draft.authority).some((capability) => capability !== false)) {
      throw new SliceRuleBudgetImpactError("stale_draft");
    }
    if (this.poolBindings && !await this.poolBindings.hasExact({ workspaceId: input.workspaceId, draftHash: draft.draftHash, market: draft.scope.market })) {
      throw new SliceRuleBudgetImpactError("pool_binding_required");
    }

    const evidence = await this.scopeEvidence.loadExact({ workspaceId: input.workspaceId,
      adAccountId: input.budgetCommand.scope.adAccountId, campaignId: input.budgetCommand.scope.campaignId,
      contextHash: input.budgetCommand.scope.contextHash, expectedScope: draft.scope });
    if (evidence.state !== "ready" || evidence.scope === null || evidence.evidenceRefs.length < 1
      || evidence.evidenceRefs.some((ref) => !REF.test(ref))) {
      throw new SliceRuleBudgetImpactError("scope_evidence_not_ready");
    }
    if (evidence.scope.market !== draft.scope.market) throw new SliceRuleBudgetImpactError("market_boundary");
    if (!sameScope(evidence.scope, draft.scope)) throw new SliceRuleBudgetImpactError("scope_mismatch");

    const budgetPreview = await this.budgetLab.dryRun(input.workspaceId, input.budgetCommand);
    if (!safeBudgetPreview(budgetPreview)) throw new SliceRuleBudgetImpactError("unsafe_budget_preview");
    return Object.freeze({ contractVersion: SLICE_RULE_BUDGET_IMPACT_VERSION,
      mode: "read_only_impact_preview" as const,
      binding: Object.freeze({ seriesRef: draft.seriesRef, draftRef: draft.draftRef,
        draftHash: draft.draftHash, scope: draft.scope, ruleKind: draft.operatingRule.rule.kind,
        evidenceRefs: Object.freeze([...evidence.evidenceRefs]) }),
      budgetPreview, persistence: "none" as const, writeOperations: 0 as const, authority: AUTHORITY });
  }

  async save(input: SliceRuleBudgetImpactInput, occurredAt: string): Promise<SliceRuleBudgetImpactSavedResult> {
    if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt))
      || new Date(occurredAt).toISOString() !== occurredAt || !this.budgetLab.saveRuleLinkedDraft) {
      throw new SliceRuleBudgetImpactError("provenance_unavailable");
    }
    const preview = await this.preview(input);
    // Read the exact current revision again immediately before the atomic
    // proposal+binding write; a concurrent revision cannot be silently linked.
    const draft = await this.drafts.loadCurrentExact({ workspaceId: input.workspaceId, actorId: input.actorId, seriesRef: input.seriesRef });
    if (!draft || !verifySliceRuleWorkspaceDraft(draft) || draft.draftHash !== preview.binding.draftHash
      || draft.draftRef !== preview.binding.draftRef || !sameScope(draft.scope, preview.binding.scope)) {
      throw new SliceRuleBudgetImpactError("stale_draft");
    }
    const bindingIdempotencyKey = `rule_budget_${createHash("sha256").update(`${draft.draftHash}:${input.budgetCommand.idempotencyKey}`).digest("hex").slice(0, 32)}`;
    const saved = await this.budgetLab.saveRuleLinkedDraft(input.workspaceId, input.actorId, occurredAt,
      input.budgetCommand, draft, bindingIdempotencyKey);
    if (saved.result.mode !== "saved_draft" || (saved.result.persistence !== "inserted" && saved.result.persistence !== "unchanged")) {
      throw new SliceRuleBudgetImpactError("provenance_unavailable");
    }
    const persistence: "inserted" | "unchanged" = saved.result.persistence;
    return Object.freeze({ contractVersion: SLICE_RULE_BUDGET_IMPACT_VERSION, mode: "saved_advisory_draft" as const,
      binding: preview.binding, budgetProposal: saved.result.proposal, persistence,
      provenance: saved.bindingOutcome, authority: AUTHORITY });
  }
}
