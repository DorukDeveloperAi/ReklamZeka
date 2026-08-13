import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { CampaignClassificationReviewRepository } from "@/application/campaign-classification-review-service";
import { buildSliceScopeCandidates } from "@/domain/campaigns/slice-scope-candidates";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import type { BudgetImpactScopeEvidencePort } from "@/application/slice-rule-budget-impact-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

const CLOSED = Object.freeze({ canSave: false as const, canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const });

type CurrentContexts = Readonly<{
  listLatestValidCampaignPublic(input: Readonly<{ workspaceId: string }>): Promise<readonly StoredEffectiveCampaignContext[]>;
}>;

/**
 * A public readiness result is deliberately narrower than a context. It says
 * whether a canonical scope has an already-persisted, exact budget-evidence
 * context; it never composes one or exposes its account/campaign/hash.
 */
export class SliceOperationalReadinessService {
  constructor(
    private readonly candidates: CampaignClassificationReviewRepository,
    private readonly contexts: CurrentContexts,
    private readonly scopeEvidence: BudgetImpactScopeEvidencePort,
    private readonly memberships: readonly WorkspaceMembership[],
  ) {}

  async list(principal: TrustedDecisionRoomPrincipal) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    const source = await this.candidates.load(principal.workspaceId);
    const projected = buildSliceScopeCandidates(source);
    const latest = await this.contexts.listLatestValidCampaignPublic({ workspaceId: principal.workspaceId });
    const campaignIds = new Map(source.campaigns.map((campaign) => [campaign.ref, campaign.id]));
    const byCampaignId = new Map(latest.flatMap((record) => record.analysisDataScope && !record.invalidated
      ? [[record.analysisDataScope.campaignId, record] as const] : []));
    const items = await Promise.all(projected.candidates.map(async (candidate) => {
      const campaignId = campaignIds.get(candidate.campaignRef);
      const record = campaignId ? byCampaignId.get(campaignId) : undefined;
      if (!record?.analysisDataScope) return Object.freeze({ candidateRef: candidate.campaignRef, scope: candidate.scope,
        frozenContext: "missing" as const, budgetImpact: "blocked" as const });
      const evidence = await this.scopeEvidence.loadExact({ workspaceId: principal.workspaceId,
        adAccountId: record.analysisDataScope.adAccountId, campaignId: record.analysisDataScope.campaignId,
        contextHash: record.context.contextHash, expectedScope: candidate.scope });
      return Object.freeze({ candidateRef: candidate.campaignRef, scope: candidate.scope,
        frozenContext: evidence.state === "ready" ? "ready" as const : "not_eligible" as const,
        budgetImpact: evidence.state === "ready" ? "eligible" as const : "blocked" as const });
    }));
    return Object.freeze({ version: "slice-operational-readiness/1.0.0" as const, items: Object.freeze(items), authority: CLOSED });
  }
}
