import { buildCampaignClassificationReview, type CampaignClassificationReviewSource } from "@/domain/campaigns/campaign-classification-review";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
export type CampaignClassificationReviewRepository = Readonly<{ load(workspaceId: string): Promise<CampaignClassificationReviewSource> }>;
export class CampaignClassificationReviewService { constructor(private readonly repository: CampaignClassificationReviewRepository, private readonly memberships: readonly WorkspaceMembership[]) {} async list(principal: TrustedDecisionRoomPrincipal) { authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships); return buildCampaignClassificationReview(await this.repository.load(principal.workspaceId)); } }
