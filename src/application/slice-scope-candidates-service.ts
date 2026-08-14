import { buildSliceScopeCandidates } from "@/domain/campaigns/slice-scope-candidates";
import type { CampaignClassificationReviewRepository } from "@/application/campaign-classification-review-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
export class SliceScopeCandidatesService {
  constructor(private readonly repository: CampaignClassificationReviewRepository, private readonly memberships: readonly WorkspaceMembership[]) {}
  async list(principal: TrustedDecisionRoomPrincipal) { authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships); return buildSliceScopeCandidates(await this.repository.load(principal.workspaceId)); }
}
