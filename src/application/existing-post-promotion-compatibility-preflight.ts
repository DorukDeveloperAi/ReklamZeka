import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { existingPostPromotionEvidenceSelectionHash, existingPostPromotionSelectionHash,
  type ExistingPostPromotionCompatibilityPort, type ExistingPostPromotionMaterialResolver } from
  "@/application/existing-post-promotion-canonical-submitter";
import type { ExistingPostPromotionPreflightContext, ExistingPostPromotionPreflightRepository } from
  "@/application/existing-post-promotion-preflight-service";
import { META_COMPATIBILITY_DIMENSIONS } from "@/domain/meta/promotion/compatibility-artifact";

const HASH = /^[a-f0-9]{64}$/;
type Compatibility = ExistingPostPromotionPreflightContext["template"]["compatibility"];

function unresolved(context: ExistingPostPromotionPreflightContext): ExistingPostPromotionPreflightContext {
  return Object.freeze({ ...context, template: Object.freeze({ ...context.template,
    compatibility: Object.freeze({ destination: "unknown", optimization: "unknown", placement: "unknown",
      specialCategory: "unknown", tracking: "unknown" }) }) });
}

/**
 * Selection-bound compatibility bridge used by both dashboard preflight and the
 * proposal draft recheck. It can only replace `unknown` after the exact immutable
 * material hash and all five reviewed evidence dimensions resolve.
 */
export class ExistingPostPromotionCompatibilityPreflightRepository implements ExistingPostPromotionPreflightRepository {
  constructor(private readonly principal: TrustedDecisionRoomPrincipal,
    private readonly base: ExistingPostPromotionPreflightRepository,
    private readonly material: ExistingPostPromotionMaterialResolver,
    private readonly compatibility: ExistingPostPromotionCompatibilityPort,
    private readonly clock: () => Date = () => new Date()) {}

  async resolve(input: Parameters<ExistingPostPromotionPreflightRepository["resolve"]>[0]) {
    const context = await this.base.resolve(input);
    if (!context) return null;
    if (input.workspaceId !== this.principal.workspaceId || input.workspaceRef !== this.principal.workspaceRef
      || context.workspaceId !== this.principal.workspaceId || context.workspaceRef !== this.principal.workspaceRef) {
      return unresolved(context);
    }
    const now = this.clock();
    if (!Number.isFinite(now.valueOf())) return unresolved(context);
    const evaluatedAt = now.toISOString();
    let requestSelectionHash: string;
    try { requestSelectionHash = existingPostPromotionSelectionHash(input.request); }
    catch { return unresolved(context); }
    let resolvedMaterial: Awaited<ReturnType<ExistingPostPromotionMaterialResolver["resolve"]>>;
    try { resolvedMaterial = await this.material.resolve({ principal: this.principal, selection: input.request,
      selectionHash: requestSelectionHash, evaluatedAt }); }
    catch { return unresolved(context); }
    if (!resolvedMaterial) return unresolved(context);
    let evidenceSelectionHash: string;
    try { evidenceSelectionHash = existingPostPromotionEvidenceSelectionHash(requestSelectionHash, resolvedMaterial); }
    catch { return unresolved(context); }
    let resolution: Awaited<ReturnType<ExistingPostPromotionCompatibilityPort["resolve"]>>;
    try { resolution = await this.compatibility.resolve(evidenceSelectionHash, evaluatedAt); }
    catch { return unresolved(context); }
    if (resolution.selectionHash !== evidenceSelectionHash || !HASH.test(resolution.resolutionHash)
      || resolution.dimensions.length !== META_COMPATIBILITY_DIMENSIONS.length
      || new Set(resolution.dimensions.map((item) => item.dimension)).size !== META_COMPATIBILITY_DIMENSIONS.length
      || META_COMPATIBILITY_DIMENSIONS.some((dimension) => !resolution.dimensions.some((item) => item.dimension === dimension))) {
      return unresolved(context);
    }
    const byDimension = new Map(resolution.dimensions.map((item) => [item.dimension, item.status]));
    const projected: Compatibility = Object.freeze({ destination: byDimension.get("destination") ?? "unknown",
      optimization: byDimension.get("optimization") ?? "unknown", placement: byDimension.get("placement") ?? "unknown",
      specialCategory: byDimension.get("special_category") ?? "unknown", tracking: byDimension.get("tracking") ?? "unknown" });
    return Object.freeze({ ...context, template: Object.freeze({ ...context.template, compatibility: projected }) });
  }
}
