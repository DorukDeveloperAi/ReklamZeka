import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  ExistingPostPromotionPublicPreflightError,
  type ExistingPostPromotionPreflightRequest,
  type ExistingPostPromotionPreflightResult,
  type ExistingPostPromotionPublicPreflightService,
} from "@/application/existing-post-promotion-preflight-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const EXISTING_POST_PROMOTION_AGENT_CONTRACT_VERSION = "existing-post-promotion-agent/1.0.0" as const;

export type ExistingPostPromotionAgentCall = Readonly<{
  name: "existing_post_promotion_preflight";
  arguments: ExistingPostPromotionPreflightRequest;
}>;

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ExistingPostPromotionPublicPreflightError("invalid_input");
  }
}
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/;

export class ExistingPostPromotionPreflightAgentContract {
  constructor(
    private readonly service: Pick<ExistingPostPromotionPublicPreflightService, "evaluate">,
    private readonly memberships: readonly WorkspaceMembership[],
  ) {}

  async execute(principal: TrustedDecisionRoomPrincipal, call: ExistingPostPromotionAgentCall): Promise<Readonly<{
    contractVersion: typeof EXISTING_POST_PROMOTION_AGENT_CONTRACT_VERSION;
    result: ExistingPostPromotionPreflightResult;
    authority: Readonly<{ readOnlyPreflight: true; canPersist: false; canApprove: false; canExecute: false; canWriteMeta: false; canGenerateCreative: false }>;
  }>> {
    exact(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]);
    exact(principal.actor, ["userId"]);
    authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    exact(call, ["name", "arguments"]);
    if (call.name !== "existing_post_promotion_preflight") throw new ExistingPostPromotionPublicPreflightError("invalid_input");
    exact(call.arguments, ["accountRef", "actorRef", "postRef", "promotionTemplateRef", "audiencePresetRef", "budgetPlanRef", "timeframeRef", "objectiveRef", "internalCategoryRef"]);
    if (Object.values(call.arguments).some((value) => typeof value !== "string" || !REF.test(value)
      || /(token|secret|prompt|raw)/i.test(value))) throw new ExistingPostPromotionPublicPreflightError("invalid_input");
    return Object.freeze({
      contractVersion: EXISTING_POST_PROMOTION_AGENT_CONTRACT_VERSION,
      result: await this.service.evaluate(principal, call.arguments),
      authority: Object.freeze({
        readOnlyPreflight: true as const, canPersist: false as const, canApprove: false as const,
        canExecute: false as const, canWriteMeta: false as const, canGenerateCreative: false as const,
      }),
    });
  }
}

const refProperty = () => Object.freeze({ type: "string", pattern: "^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$" });
export const EXISTING_POST_PROMOTION_AGENT_TOOLS = Object.freeze([Object.freeze({
  name: "existing_post_promotion_preflight",
  description: "Validate a server-bound existing Page/Instagram post against exact approved presets and return a non-persistent K4 approval preview. It cannot create creative, approve, execute, or call Meta writes.",
  inputSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: Object.freeze(["accountRef", "actorRef", "postRef", "promotionTemplateRef", "audiencePresetRef", "budgetPlanRef", "timeframeRef", "objectiveRef", "internalCategoryRef"]),
    properties: Object.freeze({
      accountRef: refProperty(), actorRef: refProperty(), postRef: refProperty(), promotionTemplateRef: refProperty(),
      audiencePresetRef: refProperty(), budgetPlanRef: refProperty(), timeframeRef: refProperty(),
      objectiveRef: refProperty(), internalCategoryRef: refProperty(),
    }),
  }),
})]);
