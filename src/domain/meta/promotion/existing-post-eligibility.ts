import { createHash } from "node:crypto";

export type EligibilityFact = "confirmed" | "rejected" | "unknown";
export type PromotionCapability = "supported" | "denied" | "unsupported" | "unknown";
export type ExistingPostLifecycle = "published" | "not_published" | "deleted" | "unknown";
export type PromotionActorType = "page" | "instagram" | "unsupported";

export type ExistingPostPromotionReasonCode =
  | "eligible"
  | "ad_account_not_owned"
  | "ad_account_ownership_unknown"
  | "actor_not_owned"
  | "actor_ownership_unknown"
  | "actor_mismatch"
  | "actor_match_unknown"
  | "actor_type_unsupported"
  | "permission_denied"
  | "permission_unknown"
  | "actor_advertising_denied"
  | "actor_advertising_unsupported"
  | "actor_advertising_unknown"
  | "post_promotion_denied"
  | "post_promotion_unsupported"
  | "post_promotion_unknown"
  | "post_identity_missing"
  | "post_identity_unknown"
  | "post_not_published"
  | "post_deleted"
  | "post_lifecycle_unknown"
  | "content_hash_missing"
  | "content_hash_invalid";

export type ExistingPostPromotionEligibilityInput = Readonly<{
  workspaceId: string;
  adAccountExternalId: string;
  requestedActor: Readonly<{
    type: PromotionActorType;
    externalId: string;
  }>;
  post: Readonly<{
    identity: "known" | "missing" | "unknown";
    externalPostId: string | null;
    actorExternalId: string | null;
    lifecycle: ExistingPostLifecycle;
    contentHash: string | null;
  }>;
  ownership: Readonly<{
    adAccount: EligibilityFact;
    actor: EligibilityFact;
  }>;
  permission: EligibilityFact;
  capabilities: Readonly<{
    actorAdvertising: PromotionCapability;
    postPromotion: PromotionCapability;
  }>;
}>;

export type ExistingPostContentFreeze = Readonly<{
  externalPostId: string;
  actorExternalId: string;
  contentHash: string;
  fingerprint: string;
}>;

export type ExistingPostPromotionEligibility = Readonly<{
  status: "promotable" | "non_promotable" | "unknown";
  reasons: readonly ExistingPostPromotionReasonCode[];
  contentFreeze: ExistingPostContentFreeze | null;
}>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function addFactReason(
  reasons: ExistingPostPromotionReasonCode[],
  fact: EligibilityFact,
  rejected: ExistingPostPromotionReasonCode,
  unknown: ExistingPostPromotionReasonCode,
): void {
  if (fact === "rejected") reasons.push(rejected);
  if (fact === "unknown") reasons.push(unknown);
}

function addCapabilityReason(
  reasons: ExistingPostPromotionReasonCode[],
  capability: PromotionCapability,
  denied: ExistingPostPromotionReasonCode,
  unsupported: ExistingPostPromotionReasonCode,
  unknown: ExistingPostPromotionReasonCode,
): void {
  if (capability === "denied") reasons.push(denied);
  if (capability === "unsupported") reasons.push(unsupported);
  if (capability === "unknown") reasons.push(unknown);
}

const UNKNOWN_REASONS = new Set<ExistingPostPromotionReasonCode>([
  "ad_account_ownership_unknown",
  "actor_ownership_unknown",
  "actor_match_unknown",
  "permission_unknown",
  "actor_advertising_unknown",
  "post_promotion_unknown",
  "post_identity_unknown",
  "post_lifecycle_unknown",
  "content_hash_missing",
]);

function freezeContent(input: ExistingPostPromotionEligibilityInput): ExistingPostContentFreeze {
  const externalPostId = input.post.externalPostId!.trim();
  const actorExternalId = input.post.actorExternalId!.trim();
  const contentHash = input.post.contentHash!.toLowerCase();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      workspaceId: input.workspaceId.trim(),
      adAccountExternalId: input.adAccountExternalId.trim(),
      actorType: input.requestedActor.type,
      actorExternalId,
      externalPostId,
      contentHash,
    }))
    .digest("hex");

  return Object.freeze({ externalPostId, actorExternalId, contentHash, fingerprint });
}

/**
 * Pure, fail-closed eligibility check. This contract deliberately does not select
 * targeting, create creative content, or call Meta.
 */
export function evaluateExistingPostPromotionEligibility(
  input: ExistingPostPromotionEligibilityInput,
): ExistingPostPromotionEligibility {
  required(input.workspaceId, "workspaceId");
  required(input.adAccountExternalId, "adAccountExternalId");
  const requestedActorId = required(input.requestedActor.externalId, "requestedActor.externalId");
  const reasons: ExistingPostPromotionReasonCode[] = [];

  addFactReason(reasons, input.ownership.adAccount, "ad_account_not_owned", "ad_account_ownership_unknown");
  addFactReason(reasons, input.ownership.actor, "actor_not_owned", "actor_ownership_unknown");
  addFactReason(reasons, input.permission, "permission_denied", "permission_unknown");

  if (input.requestedActor.type === "unsupported") reasons.push("actor_type_unsupported");

  addCapabilityReason(
    reasons,
    input.capabilities.actorAdvertising,
    "actor_advertising_denied",
    "actor_advertising_unsupported",
    "actor_advertising_unknown",
  );
  addCapabilityReason(
    reasons,
    input.capabilities.postPromotion,
    "post_promotion_denied",
    "post_promotion_unsupported",
    "post_promotion_unknown",
  );

  if (input.post.identity === "missing") reasons.push("post_identity_missing");
  if (input.post.identity === "unknown") reasons.push("post_identity_unknown");
  if (input.post.identity === "known") {
    if (!input.post.externalPostId?.trim()) reasons.push("post_identity_missing");
    if (!input.post.actorExternalId?.trim()) {
      reasons.push("actor_match_unknown");
    } else if (input.post.actorExternalId.trim() !== requestedActorId) {
      reasons.push("actor_mismatch");
    }
  }

  if (input.post.lifecycle === "not_published") reasons.push("post_not_published");
  if (input.post.lifecycle === "deleted") reasons.push("post_deleted");
  if (input.post.lifecycle === "unknown") reasons.push("post_lifecycle_unknown");

  if (!input.post.contentHash?.trim()) {
    reasons.push("content_hash_missing");
  } else if (!SHA256_PATTERN.test(input.post.contentHash)) {
    reasons.push("content_hash_invalid");
  }

  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length === 0) {
    return Object.freeze({
      status: "promotable",
      reasons: Object.freeze(["eligible"] as const),
      contentFreeze: freezeContent(input),
    });
  }

  const onlyUnknown = uniqueReasons.every((reason) => UNKNOWN_REASONS.has(reason));
  return Object.freeze({
    status: onlyUnknown ? "unknown" : "non_promotable",
    reasons: Object.freeze(uniqueReasons),
    contentFreeze: null,
  });
}
