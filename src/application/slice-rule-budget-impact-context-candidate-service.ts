import { createHash } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { BudgetLabDraftCommand } from "@/application/budget-lab-draft-service";
import type { BudgetImpactScopeEvidencePort, CurrentSliceRuleDraftPort, SliceRuleBudgetPoolBindingEvidencePort, SliceRuleBudgetImpactInput } from "@/application/slice-rule-budget-impact-service";
import type { ExactSliceRuleScope, SliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const CANDIDATE = /^budget_impact_context_[a-f0-9]{24}$/;
const CLOSED = Object.freeze({ canPreview: false as const, canSave: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });

type Contexts = Readonly<{ listLatestValidCampaignPublic(input: Readonly<{ workspaceId: string }>): Promise<readonly StoredEffectiveCampaignContext[]> }>;
export type BudgetImpactContextCandidate = Readonly<{ candidateRef: string; campaignRef: string; capturedAt: string; currency: string; currentBudgetDecimal: string; scope: ExactSliceRuleScope }>;
export type UserBudgetScenarioCommand = Readonly<{ label: string; mode: "keep" | "conservative"; requestedBudgetDecimal: string; startDate: string; endDate: string }>;
type TechnicalTemplate = Readonly<{ currency: string; currentAmountMinor: number; observedAt: string; allocationRef: string; categoryRef: string; geoRef: string; groupRefs: readonly string[] }>;
type Templates = Readonly<{ loadExact(input: Readonly<{ workspaceId: string; adAccountId: string; campaignId: string; contextHash: string; scope: ExactSliceRuleScope }>): Promise<TechnicalTemplate | null> }>;

export class BudgetImpactContextCandidateError extends Error {
  constructor(readonly code: "invalid_input" | "draft_missing" | "pool_binding_required" | "candidate_missing" | "candidate_stale" | "market_boundary") {
    super(`Bütçe bağlam adayı doğrulanamadı: ${code}`); this.name = "BudgetImpactContextCandidateError";
  }
}

function candidateRef(workspaceId: string, draftHash: string, record: StoredEffectiveCampaignContext): string {
  const scope = record.analysisDataScope;
  if (!scope) throw new BudgetImpactContextCandidateError("candidate_stale");
  return `budget_impact_context_${createHash("sha256").update(`${workspaceId}:${draftHash}:${scope.adAccountId}:${scope.campaignId}:${record.context.contextHash}`).digest("hex").slice(0, 24)}`;
}
function sameScope(left: ExactSliceRuleScope, right: ExactSliceRuleScope) { return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort()); }
function validUserCommand(value: unknown): value is UserBudgetScenarioCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = ["label", "mode", "requestedBudgetDecimal", "startDate", "endDate"];
  return Object.keys(record).length === keys.length && Object.keys(record).every((key) => keys.includes(key))
    && typeof record.label === "string" && REF.test(record.label) && ["keep", "conservative"].includes(String(record.mode))
    && typeof record.requestedBudgetDecimal === "string" && /^(0|[1-9]\d{0,29})(?:\.\d{1,2})?$/.test(record.requestedBudgetDecimal)
    && typeof record.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.startDate)
    && typeof record.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.endDate) && record.startDate <= record.endDate;
}
function decimal(minor: number) { return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`; }
function toMinor(value: string) { const [whole, fraction = ""] = value.split("."); return Number(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))); }

/**
 * Lists only server-verified frozen contexts. The public token is deterministic
 * but opaque; its UUID/hash inputs never leave this service.
 */
export class BudgetImpactContextCandidateService {
  constructor(private readonly drafts: CurrentSliceRuleDraftPort, private readonly contexts: Contexts,
    private readonly scopeEvidence: BudgetImpactScopeEvidencePort, private readonly pools: SliceRuleBudgetPoolBindingEvidencePort, private readonly templates: Templates,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  private async draft(principal: TrustedDecisionRoomPrincipal, seriesRef: string): Promise<SliceRuleWorkspaceDraft> {
    if (!REF.test(seriesRef)) throw new BudgetImpactContextCandidateError("invalid_input");
    authorizeWorkspace(principal.actor, principal.workspaceId, "budget:draft", this.memberships);
    const draft = await this.drafts.loadCurrentExact({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, seriesRef });
    if (!draft || draft.status !== "draft" || draft.operatingMode !== "recommendation_only") throw new BudgetImpactContextCandidateError("draft_missing");
    if (!await this.pools.hasExact({ workspaceId: principal.workspaceId, draftHash: draft.draftHash, market: draft.scope.market })) throw new BudgetImpactContextCandidateError("pool_binding_required");
    return draft;
  }

  async list(principal: TrustedDecisionRoomPrincipal, seriesRef: string) {
    const draft = await this.draft(principal, seriesRef);
    const records = await this.contexts.listLatestValidCampaignPublic({ workspaceId: principal.workspaceId });
    const candidates: BudgetImpactContextCandidate[] = [];
    for (const record of records) {
      const scope = record.analysisDataScope;
      if (!scope || record.invalidated || record.context.data.trustStatus !== "ready") continue;
      const evidence = await this.scopeEvidence.loadExact({ workspaceId: principal.workspaceId, adAccountId: scope.adAccountId,
        campaignId: scope.campaignId, contextHash: record.context.contextHash, expectedScope: draft.scope });
      if (evidence.state !== "ready" || evidence.scope === null || !sameScope(evidence.scope, draft.scope)) continue;
      const template = await this.templates.loadExact({ workspaceId: principal.workspaceId, adAccountId: scope.adAccountId, campaignId: scope.campaignId, contextHash: record.context.contextHash, scope: draft.scope });
      if (!template) continue;
      candidates.push(Object.freeze({ candidateRef: candidateRef(principal.workspaceId, draft.draftHash, record),
        campaignRef: `campaign_${createHash("sha256").update(record.context.identity.campaignRef).digest("hex").slice(0, 16)}`,
        capturedAt: record.context.capturedAt, currency: template.currency, currentBudgetDecimal: decimal(template.currentAmountMinor), scope: draft.scope }));
    }
    return Object.freeze({ contractVersion: "slice-rule-budget-impact-context-candidates/1.0.0" as const,
      seriesRef: draft.seriesRef, candidates: Object.freeze(candidates.slice(0, 50)), authority: CLOSED });
  }

  async resolve(principal: TrustedDecisionRoomPrincipal, input: Readonly<{ seriesRef: string; candidateRef: string; budgetCommand: unknown }>): Promise<SliceRuleBudgetImpactInput> {
    if (!CANDIDATE.test(input.candidateRef) || !validUserCommand(input.budgetCommand)) throw new BudgetImpactContextCandidateError("invalid_input");
    const draft = await this.draft(principal, input.seriesRef);
    const records = await this.contexts.listLatestValidCampaignPublic({ workspaceId: principal.workspaceId });
    for (const record of records) {
      const scope = record.analysisDataScope;
      if (!scope || record.invalidated || candidateRef(principal.workspaceId, draft.draftHash, record) !== input.candidateRef) continue;
      const evidence = await this.scopeEvidence.loadExact({ workspaceId: principal.workspaceId, adAccountId: scope.adAccountId,
        campaignId: scope.campaignId, contextHash: record.context.contextHash, expectedScope: draft.scope });
      if (evidence.state !== "ready" || evidence.scope === null) throw new BudgetImpactContextCandidateError("candidate_stale");
      if (evidence.scope.market !== draft.scope.market) throw new BudgetImpactContextCandidateError("market_boundary");
      if (!sameScope(evidence.scope, draft.scope)) throw new BudgetImpactContextCandidateError("candidate_stale");
      const template = await this.templates.loadExact({ workspaceId: principal.workspaceId, adAccountId: scope.adAccountId, campaignId: scope.campaignId, contextHash: record.context.contextHash, scope: draft.scope });
      if (!template) throw new BudgetImpactContextCandidateError("candidate_stale");
      const requestedMinor = toMinor(input.budgetCommand.requestedBudgetDecimal); const requestedDecimal = decimal(requestedMinor);
      return Object.freeze({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, seriesRef: draft.seriesRef,
        expectedDraftRef: draft.draftRef, expectedDraftHash: draft.draftHash, expectedScope: draft.scope,
        budgetCommand: Object.freeze({ scope: Object.freeze({ adAccountId: scope.adAccountId, campaignId: scope.campaignId, contextHash: record.context.contextHash }), seriesRef: `budget.impact.${draft.seriesRef}`.slice(0, 127), revision: 1, previousProposalHash: "GENESIS", idempotencyKey: `budget.impact.${input.candidateRef.slice(-12)}.${input.budgetCommand.label}`.slice(0, 127), createdAt: new Date().toISOString(), outcomeProxy: null, scenarios: [Object.freeze({ scenarioRef: `scenario.${input.budgetCommand.label}`, kind: input.budgetCommand.mode, minorUnitScale: 2, requestedBudgetMinor: requestedMinor, allocations: [Object.freeze({ ref: template.allocationRef, currentAmountMinor: template.currentAmountMinor, categoryRef: template.categoryRef, geoRef: template.geoRef, groupRefs: template.groupRefs })], constraints: [], strategy: Object.freeze({ mode: "fixed", targets: [Object.freeze({ ref: template.allocationRef, amountMinor: requestedMinor })] }), pacing: Object.freeze({ period: Object.freeze({ startDate: input.budgetCommand.startDate, endDate: input.budgetCommand.endDate, timezone: "Europe/Istanbul" }), asOfAt: template.observedAt, amounts: Object.freeze({ currency: template.currency, plannedDecimal: decimal(template.currentAmountMinor), committedDecimal: decimal(template.currentAmountMinor), actualDecimal: "0.00", requestedCommitmentDecimal: requestedDecimal }), signal: Object.freeze({ kind: "business_outcome", metricRef: "delivery_health", sampleSize: 0, coverageBps: 0, observedThroughAt: template.observedAt, retrievedAt: template.observedAt, learningPhase: false, lastMaterialChangeAt: null }), policy: Object.freeze({ moneyScale: 2, moneyRounding: "half_even", minimumElapsedBps: 0, conservativeRemainingRateBps: 10_000, forecastMinimumDecimal: "0", forecastMaximumDecimal: requestedDecimal, maximumFreshnessMinutes: 10_080, minimumCoverageBps: 0, minimumSampleSize: 0, attributionLagMinutes: 0, suppressDuringLearning: true, cooldownMinutes: 0, allowProxyAction: false, maximumChangeBps: 10_000, maximumChangeAbsoluteDecimal: requestedDecimal }) }) })] }) });
    }
    throw new BudgetImpactContextCandidateError("candidate_missing");
  }
}
