import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { ExistingPostPromotionPreflightRequest, ExistingPostPromotionPreflightResult } from "@/application/existing-post-promotion-preflight-service";
import type { ExistingPostPromotionProposalResult } from "@/application/existing-post-promotion-proposal-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const EXISTING_POST_PROMOTION_DRAFT_VERSION = "existing-post-promotion-draft/1.0.0" as const;
type PreflightPort = Readonly<{ evaluate(principal: TrustedDecisionRoomPrincipal, request: ExistingPostPromotionPreflightRequest): Promise<ExistingPostPromotionPreflightResult> }>;
type ServerSubmitPort = Readonly<{ submitResolved(input: Readonly<{ principal: TrustedDecisionRoomPrincipal; selection: ExistingPostPromotionPreflightRequest }>): Promise<ExistingPostPromotionProposalResult> }>;

export class ExistingPostPromotionDraftError extends Error {
  constructor(readonly code: "invalid_input" | "preflight_not_ready" | "material_unavailable" | "persistence_failed") {
    super("Mevcut gönderi öne çıkarma taslağı güvenli biçimde oluşturulamadı"); this.name = "ExistingPostPromotionDraftError";
  }
}
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/;
function selection(value: ExistingPostPromotionPreflightRequest): ExistingPostPromotionPreflightRequest {
  const keys = ["accountRef", "adSetRef", "actorRef", "postRef", "promotionTemplateRef", "audiencePresetRef", "budgetPlanRef", "timeframeRef", "objectiveRef", "internalCategoryRef"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key)) || Object.values(value).some((item) => typeof item !== "string" || !REF.test(item))) {
    throw new ExistingPostPromotionDraftError("invalid_input");
  }
  return Object.freeze({ ...value });
}

/** Re-evaluates exact refs before the optional server-private materializer may persist. */
export class ExistingPostPromotionProposalDraftService {
  constructor(private readonly preflight: PreflightPort, private readonly submitter: ServerSubmitPort,
    private readonly memberships: readonly WorkspaceMembership[]) {}
  async draft(principal: TrustedDecisionRoomPrincipal, requested: ExistingPostPromotionPreflightRequest) {
    const selected = selection(requested);
    authorizeWorkspace(principal.actor, principal.workspaceId, "promotion:draft", this.memberships);
    const evaluated = await this.preflight.evaluate(principal, selected);
    if (evaluated.status !== "ready_for_approval_proposal" || !evaluated.proposalPreview
      || evaluated.authority.canPersistProposal || evaluated.authority.canApprove || evaluated.authority.canExecute
      || evaluated.authority.canWriteMeta || evaluated.authority.canGenerateCreative) {
      throw new ExistingPostPromotionDraftError("preflight_not_ready");
    }
    try { return await this.submitter.submitResolved({ principal, selection: selected }); }
    catch (reason) {
      if (reason instanceof ExistingPostPromotionDraftError) throw reason;
      throw new ExistingPostPromotionDraftError("persistence_failed");
    }
  }
}
