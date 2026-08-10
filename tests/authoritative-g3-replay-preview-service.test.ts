import { describe, expect, it, vi } from "vitest";
import { AuthoritativeG3ReplayPreviewService } from "@/application/authoritative-g3-replay-preview-service";
import { AuthorizationError } from "@/security/authorization";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);
const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" }, workspaceId,
  workspaceRef: "workspace_primary", readerRef: "actor_primary" } as const;
const impact = { impactHash: "b".repeat(64), operation: "publish", registryHash: hash,
  target: { policyRef: "policy_primary", policyVersion: 1, policyHash: "c".repeat(64), status: "draft" },
  coverage: { complete: false, exactRelational: [], partialOrUnknown: ["topic_scope"], integrity: { unclassifiedJsonbColumns: 0,
    missingManifestJsonbColumns: 0, brokenPolicyRevisionChains: 0, unresolvedExceptionRefs: 0, malformedContextPolicies: 0,
    inconsistentContextComponents: 0, corruptActionLifecycleRows: 0, rowCapExceeded: 0 } } } as const;

describe("AuthoritativeG3ReplayPreviewService", () => {
  it("loads the exact frozen context, then binds authority to its account and timestamp", async () => {
    const repository = { loadHistoricalContext: vi.fn(async () => ({ invalidated: false, context: {
      workspaceId, contextHash: hash, capturedAt: "2026-08-10T10:00:00.000Z", identity: { accountRef: "account_primary" },
    } })), inspectFormalizations: vi.fn(async () => ({ flows: [{ formalizationRef: "formalization_primary", level: "G2",
      revisions: [{ payload: { rawProvenanceRef: "provenance_primary", rawTextHash: hash } },
        { payload: { guidanceCardRefs: [] } }, { payload: { guidanceSetRef: "guidance_set_primary", reviewedGuidanceHash: hash } }] }] })),
      inspectLifecycle: vi.fn(async () => ({ current: [{ policy: { policyRef: "policy_primary",
      policyVersion: 1, canonicalHash: "c".repeat(64), status: "draft", workspaceRef: "workspace_primary",
      source: { rawProvenanceRef: "provenance_primary", rawTextHash: hash, promotedFromGuidanceRefs: [] } } }] })),
      loadAuthority: vi.fn(async () => ({ catalog: { bindings: [] }, authoritySnapshot: { schemaVersion: "tenant-authority-snapshot/1.0.0",
        workspaceId, workspaceRef: "workspace_primary", snapshotRef: "authority_snapshot_primary", snapshotHash: "d".repeat(64),
        repositoryRef: "repository_primary", repositoryRevision: "1", catalogHash: "e".repeat(64), scopeHash: "f".repeat(64),
        verifiedAt: "2026-08-10T09:00:00.000Z", expiresAt: "2026-08-11T09:00:00.000Z" }, compose: vi.fn(() => ({
        validationBoundary: { productionAuthoritySourceBound: true }, context: { contextHash: "1".repeat(64),
          identity: { accountRef: "account_primary" } }, resolution: { state: "RESOLVED", applied: [], suppressed: [], parked: [] } })) })),
      previewImpact: vi.fn(async () => impact) };
    const service = new AuthoritativeG3ReplayPreviewService(repository as never,
      [{ userId: principal.actor.userId, workspaceId, role: "viewer" }]);
    const result = await service.preview(principal, { formalizationRef: "formalization_primary", policyRef: "policy_primary", contextHash: hash });
    expect(repository.loadAuthority).toHaveBeenCalledWith({ workspaceId, accountRef: "account_primary", evaluatedAt: "2026-08-10T10:00:00.000Z" });
    expect(repository.previewImpact).toHaveBeenCalledWith(workspaceId, "policy_primary", "publish");
    expect(result).toMatchObject({ disposition: "blocked", replay: { sourceBound: true },
      blockers: ["candidate_not_in_authority_catalog", "impact_coverage_incomplete"] });
  });

  it("does not read a repository for an unauthenticated workspace principal", async () => {
    const repository = { loadHistoricalContext: vi.fn() };
    const service = new AuthoritativeG3ReplayPreviewService(repository as never, []);
    await expect(service.preview(principal, { formalizationRef: "formalization_primary", policyRef: "policy_primary", contextHash: hash }))
      .rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.loadHistoricalContext).not.toHaveBeenCalled();
  });
});
