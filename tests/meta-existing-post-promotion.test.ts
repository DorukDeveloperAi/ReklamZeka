import { describe, expect, it, vi } from "vitest";
import {
  type ExistingPostPromotionEligibilityInput,
  evaluateExistingPostPromotionEligibility,
} from "@/domain/meta/promotion/existing-post-eligibility";
import { PromotionPreviewReferenceVault } from "@/server/promotion-preview-reference";

function eligibleInput(): ExistingPostPromotionEligibilityInput {
  return {
    workspaceId: "workspace-1",
    adAccountExternalId: "act-1",
    requestedActor: { type: "instagram", externalId: "ig-1" },
    post: {
      identity: "known",
      externalPostId: "post-1",
      actorExternalId: "ig-1",
      lifecycle: "published",
      contentHash: "A".repeat(64),
    },
    ownership: { adAccount: "confirmed", actor: "confirmed" },
    permission: "confirmed",
    capabilities: { actorAdvertising: "supported", postPromotion: "supported" },
  };
}

describe("existing-post promotion eligibility", () => {
  it("is promotable only when ownership, actor, capability, identity and content freeze are known", () => {
    const result = evaluateExistingPostPromotionEligibility(eligibleInput());

    expect(result).toMatchObject({ status: "promotable", reasons: ["eligible"] });
    expect(result.contentFreeze).toMatchObject({
      externalPostId: "post-1",
      actorExternalId: "ig-1",
      contentHash: "a".repeat(64),
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(Object.isFrozen(result.contentFreeze)).toBe(true);
  });

  it("produces a stable freeze and changes it when frozen content changes", () => {
    const first = evaluateExistingPostPromotionEligibility(eligibleInput()).contentFreeze!;
    const replay = evaluateExistingPostPromotionEligibility(eligibleInput()).contentFreeze!;
    const changedInput = eligibleInput();
    const changed = evaluateExistingPostPromotionEligibility({
      ...changedInput,
      post: { ...changedInput.post, contentHash: "b".repeat(64) },
    }).contentFreeze!;

    expect(replay.fingerprint).toBe(first.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it.each([
    ["account ownership", { ownership: { adAccount: "rejected", actor: "confirmed" } }, "ad_account_not_owned"],
    ["actor ownership", { ownership: { adAccount: "confirmed", actor: "rejected" } }, "actor_not_owned"],
    ["permission", { permission: "rejected" }, "permission_denied"],
    ["advertise capability", { capabilities: { actorAdvertising: "denied", postPromotion: "supported" } }, "actor_advertising_denied"],
    ["unsupported capability", { capabilities: { actorAdvertising: "unsupported", postPromotion: "supported" } }, "actor_advertising_unsupported"],
  ] as const)("fails closed for rejected %s", (_label, override, reason) => {
    const input = eligibleInput();
    const result = evaluateExistingPostPromotionEligibility({ ...input, ...override } as ExistingPostPromotionEligibilityInput);
    expect(result).toEqual({ status: "non_promotable", reasons: [reason], contentFreeze: null });
  });

  it("rejects actor mismatch, unpublished post and invalid freeze hash explicitly", () => {
    const input = eligibleInput();
    const result = evaluateExistingPostPromotionEligibility({
      ...input,
      post: {
        identity: "known",
        externalPostId: "post-1",
        actorExternalId: "another-actor",
        lifecycle: "not_published",
        contentHash: "not-a-hash",
      },
    });

    expect(result.status).toBe("non_promotable");
    expect(result.reasons).toEqual([
      "actor_mismatch",
      "post_not_published",
      "content_hash_invalid",
    ]);
    expect(result.contentFreeze).toBeNull();
  });

  it("distinguishes missing post identity and deleted lifecycle", () => {
    const input = eligibleInput();
    const result = evaluateExistingPostPromotionEligibility({
      ...input,
      post: {
        identity: "missing",
        externalPostId: null,
        actorExternalId: null,
        lifecycle: "deleted",
        contentHash: null,
      },
    });
    expect(result).toEqual({
      status: "non_promotable",
      reasons: ["post_identity_missing", "post_deleted", "content_hash_missing"],
      contentFreeze: null,
    });
  });

  it("reports only unresolved evidence as unknown and never emits a freeze", () => {
    const input = eligibleInput();
    const result = evaluateExistingPostPromotionEligibility({
      ...input,
      ownership: { adAccount: "unknown", actor: "unknown" },
      permission: "unknown",
      capabilities: { actorAdvertising: "unknown", postPromotion: "unknown" },
      post: {
        identity: "unknown",
        externalPostId: null,
        actorExternalId: null,
        lifecycle: "unknown",
        contentHash: null,
      },
    });

    expect(result.status).toBe("unknown");
    expect(result.reasons).toEqual([
      "ad_account_ownership_unknown",
      "actor_ownership_unknown",
      "permission_unknown",
      "actor_advertising_unknown",
      "post_promotion_unknown",
      "post_identity_unknown",
      "post_lifecycle_unknown",
      "content_hash_missing",
    ]);
    expect(result.contentFreeze).toBeNull();
  });

  it("lets a definitive blocker dominate unknown evidence", () => {
    const input = eligibleInput();
    const result = evaluateExistingPostPromotionEligibility({
      ...input,
      ownership: { adAccount: "unknown", actor: "rejected" },
    });
    expect(result.status).toBe("non_promotable");
    expect(result.reasons).toEqual(["ad_account_ownership_unknown", "actor_not_owned"]);
  });

  it("does not contain targeting or creative-generation fields", () => {
    const serialized = JSON.stringify(evaluateExistingPostPromotionEligibility(eligibleInput()));
    expect(serialized).not.toMatch(/targeting|audience|creative|copy|headline/i);
  });
});

describe("short-lived promotion preview references", () => {
  it("issues an opaque one-use reference without exposing the sensitive URL", () => {
    let now = Date.parse("2026-08-07T10:00:00.000Z");
    const vault = new PromotionPreviewReferenceVault({
      now: () => now,
      random: () => Buffer.alloc(32, 7),
      isAllowedUrl: () => true,
    });
    const sensitiveUrl = "https://graph.example.test/media?access_token=secret";
    const issued = vault.issue({ workspaceId: "ws-1", sensitiveUrl, ttlMs: 30_000 });

    expect(issued).toEqual({
      reference: `ppv_${Buffer.alloc(32, 7).toString("base64url")}`,
      expiresAt: "2026-08-07T10:00:30.000Z",
      remainingUses: 1,
    });
    expect(JSON.stringify(issued)).not.toContain(sensitiveUrl);
    expect(JSON.stringify(issued)).not.toContain("access_token");

    const consumer = vi.fn();
    const resolved = vault.consumeServerSide(
      { workspaceId: "ws-1", reference: issued.reference },
      consumer,
    );
    expect(resolved).toEqual({ code: "resolved", remainingUses: 0 });
    expect(JSON.stringify(resolved)).not.toContain(sensitiveUrl);
    expect(consumer.mock.calls[0]?.[0].url.toString()).toBe(sensitiveUrl);

    const replayConsumer = vi.fn();
    expect(vault.consumeServerSide(
      { workspaceId: "ws-1", reference: issued.reference },
      replayConsumer,
    )).toEqual({ code: "exhausted", remainingUses: 0 });
    expect(replayConsumer).not.toHaveBeenCalled();
    expect(vault.consumeServerSide(
      { workspaceId: "ws-1", reference: issued.reference },
      replayConsumer,
    )).toEqual({ code: "not_found", remainingUses: 0 });
    now += 1;
  });

  it("binds a reference to one workspace without consuming it on mismatch", () => {
    const vault = new PromotionPreviewReferenceVault({ isAllowedUrl: () => true });
    const issued = vault.issue({
      workspaceId: "ws-owner",
      sensitiveUrl: "https://example.test/preview/signed-value",
      ttlMs: 10_000,
      maxUses: 2,
    });

    expect(vault.consumeServerSide(
      { workspaceId: "ws-other", reference: issued.reference },
      vi.fn(),
    )).toEqual({ code: "workspace_mismatch", remainingUses: 0 });

    const ownerConsumer = vi.fn();
    expect(vault.consumeServerSide(
      { workspaceId: "ws-owner", reference: issued.reference },
      ownerConsumer,
    )).toEqual({ code: "resolved", remainingUses: 1 });
    expect(ownerConsumer).toHaveBeenCalledOnce();
    expect(vault.consumeServerSide(
      { workspaceId: "ws-owner", reference: issued.reference },
      ownerConsumer,
    )).toEqual({ code: "resolved", remainingUses: 0 });
    expect(ownerConsumer).toHaveBeenCalledTimes(2);
  });

  it("expires references and never invokes the server consumer", () => {
    let now = 1_000;
    const vault = new PromotionPreviewReferenceVault({ now: () => now, isAllowedUrl: () => true });
    const issued = vault.issue({
      workspaceId: "ws-1",
      sensitiveUrl: "https://example.test/preview",
      ttlMs: 50,
    });
    now = 1_050;
    const consumer = vi.fn();

    expect(vault.consumeServerSide(
      { workspaceId: "ws-1", reference: issued.reference },
      consumer,
    )).toEqual({ code: "expired", remainingUses: 0 });
    expect(consumer).not.toHaveBeenCalled();
    expect(vault.disposeExpired()).toBe(0);
  });

  it("allows at most five uses and rejects unsafe URLs or excessive lifetime", () => {
    const vault = new PromotionPreviewReferenceVault({ maxTtlMs: 1_000, isAllowedUrl: () => true });
    expect(() => vault.issue({
      workspaceId: "ws",
      sensitiveUrl: "http://example.test/plaintext",
      ttlMs: 100,
    })).toThrow("HTTPS");
    expect(() => vault.issue({
      workspaceId: "ws",
      sensitiveUrl: "https://example.test/preview",
      ttlMs: 1_001,
    })).toThrow("ttlMs");
    expect(() => vault.issue({
      workspaceId: "ws",
      sensitiveUrl: "https://example.test/preview",
      ttlMs: 100,
      maxUses: 6,
    })).toThrow("maxUses");

    expect(() => new PromotionPreviewReferenceVault().issue({
      workspaceId: "ws",
      sensitiveUrl: "https://169.254.169.254/latest/meta-data",
      ttlMs: 100,
    })).toThrow("not allowed");
    expect(() => new PromotionPreviewReferenceVault().issue({
      workspaceId: "ws",
      sensitiveUrl: "https://user:password@graph.facebook.com/preview",
      ttlMs: 100,
    })).toThrow("not allowed");

    const weakEntropyVault = new PromotionPreviewReferenceVault({
      random: () => Buffer.alloc(8),
      isAllowedUrl: () => true,
    });
    expect(() => weakEntropyVault.issue({
      workspaceId: "ws",
      sensitiveUrl: "https://example.test/preview",
      ttlMs: 100,
    })).toThrow("entropy source");
  });
});
