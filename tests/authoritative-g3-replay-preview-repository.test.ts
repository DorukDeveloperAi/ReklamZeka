import { describe, expect, it, vi } from "vitest";
import { createAuthoritativeG3ReplayPreviewRepository } from "@/application/authoritative-g3-replay-preview-service";

describe("authoritative G3 replay repository adapter", () => {
  it("forwards only the existing read-only publish-impact preview", async () => {
    const impacts = { preview: vi.fn(async () => null) };
    const repository = createAuthoritativeG3ReplayPreviewRepository({ authority: { loadAuthority: vi.fn() } as never,
      contexts: { loadHistoricalContext: vi.fn() } as never, lifecycle: { inspectLifecycle: vi.fn() } as never,
      formalizations: { inspectFormalizations: vi.fn() } as never, impacts });
    await expect(repository.previewImpact("11111111-1111-4111-8111-111111111111", "policy_primary", "publish")).resolves.toBeNull();
    expect(impacts.preview).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "policy_primary", "publish");
  });
});
