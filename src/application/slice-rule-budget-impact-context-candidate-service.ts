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
export type BudgetImpactContextCandidate = Readonly<{ candidateRef: string; campaignRef: string; capturedAt: string; scope: ExactSliceRuleScope }>;
export type UserBudgetScenarioCommand = Readonly<Omit<BudgetLabDraftCommand, "scope">>;

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
  const keys = ["seriesRef", "revision", "previousProposalHash", "idempotencyKey", "createdAt", "scenarios", "outcomeProxy"];
  return Object.keys(record).length === keys.length && Object.keys(record).every((key) => keys.includes(key))
    && typeof record.seriesRef === "string" && REF.test(record.seriesRef)
    && typeof record.idempotencyKey === "string" && REF.test(record.idempotencyKey)
    && Number.isInteger(record.revision) && Number(record.revision) >= 1
    && typeof record.createdAt === "string" && Array.isArray(record.scenarios);
}

/**
 * Lists only server-verified frozen contexts. The public token is deterministic
 * but opaque; its UUID/hash inputs never leave this service.
 */
export class BudgetImpactContextCandidateService {
  constructor(private readonly drafts: CurrentSliceRuleDraftPort, private readonly contexts: Contexts,
    private readonly scopeEvidence: BudgetImpactScopeEvidencePort, private readonly pools: SliceRuleBudgetPoolBindingEvidencePort,
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
      candidates.push(Object.freeze({ candidateRef: candidateRef(principal.workspaceId, draft.draftHash, record),
        campaignRef: `campaign_${createHash("sha256").update(record.context.identity.campaignRef).digest("hex").slice(0, 16)}`,
        capturedAt: record.context.capturedAt, scope: draft.scope }));
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
      return Object.freeze({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, seriesRef: draft.seriesRef,
        expectedDraftRef: draft.draftRef, expectedDraftHash: draft.draftHash, expectedScope: draft.scope,
        budgetCommand: Object.freeze({ ...input.budgetCommand, scope: Object.freeze({ adAccountId: scope.adAccountId, campaignId: scope.campaignId, contextHash: record.context.contextHash }) }) });
    }
    throw new BudgetImpactContextCandidateError("candidate_missing");
  }
}
