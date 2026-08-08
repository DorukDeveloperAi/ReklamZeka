import { describe, expect, it, vi } from "vitest";

import { ExistingPostPromotionCompatibilityPreflightRepository } from
  "@/application/existing-post-promotion-compatibility-preflight";
import { META_COMPATIBILITY_DIMENSIONS } from "@/domain/meta/promotion/compatibility-artifact";

const h = (value: string) => value.repeat(64);
const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = Object.freeze({ actor: Object.freeze({ userId: "22222222-2222-4222-a222-222222222222" }),
  workspaceId, workspaceRef: "workspace_local", readerRef: "actor_local_owner" });
const request = Object.freeze({ accountRef: "account_doruk", adSetRef: "adset_doruk", actorRef: "actor_instagram",
  postRef: "post_existing", promotionTemplateRef: "template_existing", audiencePresetRef: "audience_existing",
  budgetPlanRef: "budget_daily", timeframeRef: "timeframe_week", objectiveRef: "objective_leads",
  internalCategoryRef: "category_hair" });
const unknownCompatibility = Object.freeze({ destination: "unknown" as const, optimization: "unknown" as const,
  placement: "unknown" as const, specialCategory: "unknown" as const, tracking: "unknown" as const });
const context = Object.freeze({ workspaceId, workspaceRef: principal.workspaceRef,
  template: Object.freeze({ compatibility: unknownCompatibility }) }) as never;
const material = Object.freeze({ template: { templateHash: h("a") }, preset: { presetHash: h("b") },
  binding: { bindingHash: h("c") }, eligibility: { post: { contentHash: h("d") } },
  adSetSnapshotHash: h("e"), campaignSnapshotHash: h("f"),
  postBinding: { sourceBinding: { kind: "organic_post_binding", sourceHash: h("1"), postIdentityHash: h("2"),
    objectStorySpecHash: h("3") } } }) as never;

function resolution(selectionHash: string, status: "confirmed" | "rejected" | "unknown" = "confirmed") {
  return Object.freeze({ selectionHash, overallStatus: status,
    dimensions: Object.freeze(META_COMPATIBILITY_DIMENSIONS.map((dimension) => Object.freeze({ dimension, status,
      reasonCode: `compatibility.${status}`, evidenceHash: status === "confirmed" ? h("9") : null }))),
    authority: Object.freeze({ canExecute: false, canWriteMeta: false, canGrantApproval: false,
      canCreatePolicy: false, canPromoteGuidance: false }) });
}

function harness(materialValue: unknown = material) {
  const base = { resolve: vi.fn(async () => context) };
  const materialPort = { resolve: vi.fn(async () => materialValue) };
  const compatibility = { resolve: vi.fn(async (selectionHash: string) => resolution(selectionHash)) };
  const repository = new ExistingPostPromotionCompatibilityPreflightRepository(principal, base as never,
    materialPort as never, compatibility, () => new Date("2026-08-08T12:00:00.000Z"));
  return { repository, base, materialPort, compatibility };
}

describe("selection-bound compatibility preflight bridge", () => {
  it("projects all five reviewed compatibility dimensions onto the public preflight context", async () => {
    const api = harness();
    await expect(api.repository.resolve({ workspaceId, workspaceRef: principal.workspaceRef, request }))
      .resolves.toMatchObject({ template: { compatibility: { destination: "confirmed", optimization: "confirmed",
        placement: "confirmed", specialCategory: "confirmed", tracking: "confirmed" } } });
    expect(api.materialPort.resolve).toHaveBeenCalledWith(expect.objectContaining({ principal, selection: request,
      evaluatedAt: "2026-08-08T12:00:00.000Z" }));
    expect(api.compatibility.resolve).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/),
      "2026-08-08T12:00:00.000Z");
  });

  it("keeps every dimension unknown when immutable material or compatibility is unavailable", async () => {
    const missing = harness(null);
    await expect(missing.repository.resolve({ workspaceId, workspaceRef: principal.workspaceRef, request }))
      .resolves.toMatchObject({ template: { compatibility: unknownCompatibility } });
    expect(missing.compatibility.resolve).not.toHaveBeenCalled();
    const unsafe = harness();
    unsafe.compatibility.resolve.mockImplementation(async (selectionHash: string) => ({ ...resolution(selectionHash),
      dimensions: resolution(selectionHash).dimensions.slice(0, 4) }));
    await expect(unsafe.repository.resolve({ workspaceId, workspaceRef: principal.workspaceRef, request }))
      .resolves.toMatchObject({ template: { compatibility: unknownCompatibility } });
    const invalidStatus = harness();
    invalidStatus.compatibility.resolve.mockImplementation(async (selectionHash: string) => ({
      ...resolution(selectionHash), dimensions: resolution(selectionHash).dimensions.map((item, index) =>
        index === 0 ? { ...item, status: "approved" } : item) } as never));
    await expect(invalidStatus.repository.resolve({ workspaceId, workspaceRef: principal.workspaceRef, request }))
      .resolves.toMatchObject({ template: { compatibility: unknownCompatibility } });
  });

  it("preserves reviewed rejection instead of converting it to confirmed or unknown", async () => {
    const api = harness();
    api.compatibility.resolve.mockImplementation(async (selectionHash: string) => resolution(selectionHash, "rejected"));
    await expect(api.repository.resolve({ workspaceId, workspaceRef: principal.workspaceRef, request }))
      .resolves.toMatchObject({ template: { compatibility: { destination: "rejected", optimization: "rejected",
        placement: "rejected", specialCategory: "rejected", tracking: "rejected" } } });
  });

  it("never resolves compatibility for a caller-selected foreign workspace", async () => {
    const api = harness();
    await expect(api.repository.resolve({ workspaceId: "33333333-3333-4333-a333-333333333333",
      workspaceRef: principal.workspaceRef, request })).resolves.toMatchObject({ template: { compatibility: unknownCompatibility } });
    expect(api.materialPort.resolve).not.toHaveBeenCalled(); expect(api.compatibility.resolve).not.toHaveBeenCalled();
  });
});
