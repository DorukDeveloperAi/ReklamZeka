import { describe, expect, it, vi } from "vitest";
import { ExistingPostPromotionProtectionEvidenceMaterializer, PROTECTION_EVIDENCE_MATERIAL_VERSION,
  type AuthenticAffectedGeoEvidenceCandidate, type AuthenticCategoryEvidenceCandidate,
  type ProtectionEvidenceScope } from "@/application/existing-post-promotion-protection-evidence-materializer";

const h = (value: string) => value.repeat(64).slice(0, 64);
const scope: ProtectionEvidenceScope = { workspaceId: "11111111-1111-4111-a111-111111111111", workspaceRef: "workspace_alpha",
  accountRef: "account_doruk", campaignRef: "campaign_leads", entity: { level: "adset", ref: "adset_leads" },
  evaluatedAt: "2026-08-07T12:00:00.000Z", notBefore: "2026-08-07T10:00:00.000Z" };
const category = (overrides: Record<string, unknown> = {}): AuthenticCategoryEvidenceCandidate => ({
  sourceKind: "effective_category_context", workspaceId: scope.workspaceId, workspaceRef: scope.workspaceRef,
  accountRef: scope.accountRef, campaignRef: scope.campaignRef, entity: scope.entity, capturedAt: "2026-08-07T11:00:00.000Z",
  contextHash: h("a"), categoryRefs: ["category_hair"],
  sourceRevisions: [{ sourceRef: "category_resolution_hair", revision: 3, sourceHash: h("b") }], ...overrides,
} as AuthenticCategoryEvidenceCandidate);
const geo = (overrides: Record<string, unknown> = {}): AuthenticAffectedGeoEvidenceCandidate => ({
  sourceKind: "canonical_meta_affected_geo_snapshot", workspaceId: scope.workspaceId, workspaceRef: scope.workspaceRef,
  accountRef: scope.accountRef, campaignRef: scope.campaignRef, entity: scope.entity, capturedAt: "2026-08-07T11:00:00.000Z",
  geoRefs: ["geo_turkey"], sourceRevisions: [{ sourceRef: "meta_affected_geo_snapshot_adset", revision: 7, sourceHash: h("c") }],
  ...overrides,
} as AuthenticAffectedGeoEvidenceCandidate);
function resolver(categories: readonly unknown[], geos: readonly unknown[]) {
  return new ExistingPostPromotionProtectionEvidenceMaterializer(
    { resolveCandidates: vi.fn(async () => categories) }, { resolveCandidates: vi.fn(async () => geos) });
}

describe("existing-post protection evidence materializer", () => {
  it("binds authentic category and canonical affected-geo facts to one exact scope deterministically", async () => {
    const first = await resolver([category()], [geo()]).resolve(scope); const second = await resolver([category()], [geo()]).resolve(scope);
    expect(first).toEqual(second); expect(first).toMatchObject({ version: PROTECTION_EVIDENCE_MATERIAL_VERSION,
      categoryEvidenceRef: expect.stringMatching(/^protection_evidence_[a-f0-9]{24}$/),
      categoryEvidence: { status: "known", refs: ["category_hair"], evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      affectedGeoEvidenceRef: expect.stringMatching(/^protection_evidence_[a-f0-9]{24}$/),
      affectedGeoEvidence: { status: "known", refs: ["geo_turkey"], evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      capabilities: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false } });
  });

  it("changes evidence refs and hashes when an authoritative source revision or snapshot hash changes", async () => {
    const before = await resolver([category()], [geo()]).resolve(scope);
    const after = await resolver([category({ sourceRevisions: [{ sourceRef: "category_resolution_hair", revision: 4,
      sourceHash: h("d") }] })], [geo({ sourceRevisions: [{ sourceRef: "meta_affected_geo_snapshot_adset", revision: 8,
        sourceHash: h("e") }] })]).resolve(scope);
    expect(after.categoryEvidenceRef).not.toBe(before.categoryEvidenceRef);
    expect(after.affectedGeoEvidenceRef).not.toBe(before.affectedGeoEvidenceRef);
    expect(after.categoryEvidence.status === "known" && before.categoryEvidence.status === "known"
      && after.categoryEvidence.evidenceHash).not.toBe(before.categoryEvidence.status === "known" && before.categoryEvidence.evidenceHash);
  });

  it.each([
    ["missing", [], "affected_geo_evidence_missing"],
    ["ambiguous", [geo(), geo()], "affected_geo_evidence_ambiguous"],
    ["stale", [geo({ capturedAt: "2026-08-07T09:59:59.000Z" })], "affected_geo_evidence_untrusted"],
    ["cross tenant", [geo({ workspaceId: "22222222-2222-4222-a222-222222222222" })], "affected_geo_evidence_untrusted"],
    ["unknown geo", [geo({ geoRefs: [] })], "affected_geo_evidence_untrusted"],
  ])("fails closed for %s affected-geo evidence", async (_label, candidates, reasonRef) => {
    const value = await resolver([category()], candidates as readonly unknown[]).resolve(scope);
    expect(value.affectedGeoEvidenceRef).toBeNull(); expect(value.affectedGeoEvidence).toEqual({ status: "unknown", reasonRef });
  });

  it.each([
    ["targeting summary", { ...geo(), sourceKind: "targeting_summary", targetingSummary: { geo: ["TR"] } }],
    ["audience preset", { ...geo(), sourceKind: "audience_preset", presetRef: "audience_turkey" }],
    ["guidance", { ...geo(), sourceKind: "guidance", guidanceRef: "guidance_geo" }],
    ["free text", { ...geo(), sourceKind: "canonical_meta_affected_geo_snapshot", note: "Türkiye hedefleniyor" }],
  ])("never promotes %s into affected-geo evidence", async (_label, candidate) => {
    const value = await resolver([category()], [candidate]).resolve(scope);
    expect(value.affectedGeoEvidence).toEqual({ status: "unknown", reasonRef: "affected_geo_evidence_untrusted" });
  });

  it.each([
    ["missing", []], ["ambiguous", [category(), category()]],
    ["stale", [category({ capturedAt: "2026-08-07T09:00:00.000Z" })]],
    ["cross tenant", [category({ workspaceRef: "workspace_other" })]],
    ["unknown category", [category({ categoryRefs: [] })]],
  ])("fails closed for %s category evidence", async (_label, candidates) => {
    const value = await resolver(candidates as readonly unknown[], [geo()]).resolve(scope);
    expect(value.categoryEvidence.status).toBe("unknown"); expect(value.categoryEvidenceRef).toBeNull();
  });

  it("turns port failures into explicit unknown evidence without throwing authority-bearing defaults", async () => {
    const materializer = new ExistingPostPromotionProtectionEvidenceMaterializer(
      { resolveCandidates: vi.fn(async () => { throw new Error("db_down"); }) },
      { resolveCandidates: vi.fn(async () => { throw new Error("no_authoritative_geo_adapter"); }) });
    await expect(materializer.resolve(scope)).resolves.toMatchObject({ categoryEvidence: { status: "unknown" },
      affectedGeoEvidence: { status: "unknown" }, categoryEvidenceRef: null, affectedGeoEvidenceRef: null });
    await expect(materializer.resolve(scope)).resolves.toMatchObject({
      categoryEvidence: { status: "unknown", reasonRef: "category_evidence_source_unavailable" },
      affectedGeoEvidence: { status: "unknown", reasonRef: "affected_geo_evidence_source_unavailable" },
    });
  });

  it("rejects caller scope extensions and duplicate source identities", async () => {
    await expect(resolver([category()], [geo()]).resolve({ ...scope, rawTargeting: { countries: ["TR"] } } as never))
      .rejects.toThrow("invalid_protection_evidence_scope");
    const duplicateSource = [{ sourceRef: "category_resolution_hair", revision: 3, sourceHash: h("b") },
      { sourceRef: "category_resolution_hair", revision: 4, sourceHash: h("d") }];
    await expect(resolver([category({ sourceRevisions: duplicateSource })], [geo()]).resolve(scope)).resolves.toMatchObject({
      categoryEvidence: { status: "unknown", reasonRef: "category_evidence_untrusted" },
    });
  });
});
