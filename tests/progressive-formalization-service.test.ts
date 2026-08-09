import { describe, expect, it, vi } from "vitest";

import { ProgressiveFormalizationService, type ProgressiveFormalizationRepository } from
  "@/application/progressive-formalization-service";
import { AuthorizationError } from "@/security/authorization";

const workspaceId = "11111111-1111-4111-8111-111111111111"; const registryHash = "a".repeat(64);
const ids = { owner: "22222222-2222-4222-8222-222222222222", analyst: "33333333-3333-4333-8333-333333333333",
  viewer: "44444444-4444-4444-8444-444444444444" } as const;
const memberships = Object.entries(ids).map(([role, userId]) => ({ workspaceId, userId,
  role: role as "owner" | "analyst" | "viewer" }));
const principal = (role: keyof typeof ids) => ({ actor: { userId: ids[role] }, workspaceId,
  workspaceRef: "workspace_test", readerRef: `actor_${role}` }) as const;
function repository(): ProgressiveFormalizationRepository & { mutate: ReturnType<typeof vi.fn> } {
  const state = { registryHash, flows: [] } as const;
  return { inspect: vi.fn(async () => state), preview: vi.fn(async () => ({ contractVersion: "progressive-formalization-studio/1.0.0",
    target: "G3", formalizationRef: "formalization_test", headHash: "b".repeat(64), previewHash: "c".repeat(64),
    disposition: "blocked", blockers: ["production_policy_authority_catalog_unavailable"], normalizedDraft: null,
    g4Payload: null, evidence: { persistedGuidance: true, persistedPolicy: true,
      productionAuthoritySourceBound: false, historicalRunsEvaluated: 0 }, authority: { canApprove: false,
      canExecute: false, canWriteMeta: false, canSchedule: false, canCallTool: false } } as never)),
    mutate: vi.fn(async () => ({ state, auditAppended: true as const })) };
}

describe("progressive formalization service", () => {
  it("keeps viewer read-only and every action authority closed", async () => {
    const result = await new ProgressiveFormalizationService(repository(), memberships).inspect(principal("viewer"));
    expect(result.authority).toEqual({ canRead: true, canCapture: false, canScope: false, canReview: false,
      canPromote: false, canQualify: false, canApprove: false, canExecute: false, canWriteMeta: false,
      canSchedule: false, canCallTool: false });
  });

  it("allows analyst G0/G1 but denies human-gated G2+ before persistence", async () => {
    const repo = repository(); const service = new ProgressiveFormalizationService(repo, memberships);
    await service.mutate(principal("analyst"), { operation: "capture_g0", expectedRegistryHash: registryHash,
      rawProvenanceRef: "source_owner_note" });
    expect(repo.mutate).toHaveBeenCalledWith(expect.objectContaining({ role: "analyst",
      command: { operation: "capture_g0", expectedRegistryHash: registryHash, rawProvenanceRef: "source_owner_note" } }));
    await expect(service.mutate(principal("analyst"), { operation: "review_g2", expectedRegistryHash: registryHash,
      formalizationRef: "formalization_test", expectedHeadHash: "b".repeat(64), guidanceSetRef: "guidance_set_test",
      ownerConfirmation: { confirmed: true, confirmationRef: "confirmation_owner_review" } }))
      .rejects.toBeInstanceOf(AuthorizationError);
  });

  it("normalizes exact owner confirmation and OCC preview hashes without granting publish", async () => {
    const repo = repository(); const service = new ProgressiveFormalizationService(repo, memberships);
    const result = await service.mutate(principal("owner"), { operation: "promote_g3", expectedRegistryHash: registryHash,
      formalizationRef: "formalization_test", expectedHeadHash: "b".repeat(64), policyRef: "policy_test",
      expectedPreviewHash: "c".repeat(64), ownerConfirmation: { confirmed: true,
        confirmationRef: "confirmation_owner_g3" } });
    expect(result.authority).toMatchObject({ canPromote: true, canApprove: false, canExecute: false, canWriteMeta: false });
    expect(repo.mutate).toHaveBeenCalledWith(expect.objectContaining({ role: "owner", command: expect.objectContaining({
      expectedHeadHash: "b".repeat(64), expectedPreviewHash: "c".repeat(64),
      ownerConfirmation: { confirmed: true, confirmationRef: "confirmation_owner_g3" } }) }));
  });

  it("rejects truthy-ish confirmation and injected refs before repository access", async () => {
    const repo = repository(); const service = new ProgressiveFormalizationService(repo, memberships);
    await expect(service.mutate(principal("owner"), { operation: "review_g2", expectedRegistryHash: registryHash,
      formalizationRef: "formalization_test", expectedHeadHash: "b".repeat(64), guidanceSetRef: "guidance_set_test",
      ownerConfirmation: { confirmed: 1, confirmationRef: "confirmation_owner" } as never }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(repo.mutate).not.toHaveBeenCalled();
  });
});
