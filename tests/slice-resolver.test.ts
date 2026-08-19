import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSliceRevision } from "@/domain/slices/slice-definition";
import { buildFrozenSliceSnapshot, replayFrozenSliceSnapshot, resolveSlice, type SliceEntityCandidate } from "@/domain/slices/slice-resolver";

const market = { dimensionId: "dimension_market", valueId: "category_yerli", key: "yerli" as const };
const revision = () => createSliceRevision({ sliceRef: "slice_growth", revisionRef: "slice_revision_1", revisionNumber: 1, market,
  predicates: [
    { dimensionId: "dimension_service", key: "service", values: [{ valueId: "category_physical", key: "physical_therapy" }] },
    { dimensionId: "dimension_geo", key: "geo", values: [{ valueId: "category_tr", key: "tr" }, { valueId: "category_de", key: "de" }] },
  ],
  explicitIncludeEntityRefs: ["campaign_include", "campaign_excluded"], explicitExcludeEntityRefs: ["campaign_excluded"] });
function entity(entityRef: string, overrides: Partial<SliceEntityCandidate> = {}): SliceEntityCandidate {
  return { entityRef, entityLevel: "campaign", market: { state: "resolved", ...market, evidenceRefs: ["assignment_market_1"] },
    dimensions: [
      { dimensionId: "dimension_service", valueIds: ["category_physical"], valueKeys: ["physical_therapy"], evidenceRefs: ["assignment_service_1"] },
      { dimensionId: "dimension_geo", valueIds: ["category_tr"], valueKeys: ["tr"], evidenceRefs: ["assignment_geo_1"] },
    ], ...overrides };
}
const at = "2026-08-17T12:00:00.000Z";

describe("P03 slice resolver", () => {
  it("applies AND across dimensions, OR within a dimension and exclude > include > dynamic", () => {
    const result = resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_excluded"), entity("campaign_dynamic"), entity("campaign_include", { dimensions: [] }), entity("campaign_no_match", { dimensions: [] })] });
    expect(result.included.map((item) => [item.entityRef, item.reason])).toEqual([["campaign_dynamic", "dynamic_filter"], ["campaign_include", "explicit_include"]]);
    expect(result.memberships.find((item) => item.entityRef === "campaign_excluded")?.reason).toBe("excluded_explicit");
    expect(result.memberships.find((item) => item.entityRef === "campaign_dynamic")?.matchedDimensionEvidenceRefs).toEqual(["assignment_geo_1", "assignment_service_1"]);
  });
  it("records explicit inclusion provenance even when that entity also dynamically matches", () => {
    const result = resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_include")] });
    expect(result.included[0]).toMatchObject({ entityRef: "campaign_include", reason: "explicit_include" });
  });
  it("rejects a market predicate because market is a dedicated hard binding", () => {
    expect(() => createSliceRevision({ sliceRef: "slice_growth", revisionRef: "slice_revision_market", revisionNumber: 1, market,
      predicates: [{ dimensionId: "dimension_market", key: "market", values: [{ valueId: "category_yerli", key: "yerli" }] }] })).toThrow();
  });
  it("requires every dimension but allows any selected value inside one dimension", () => {
    const result = resolveSlice({ revision: revision(), resolvedAt: at, candidates: [
      entity("campaign_or", { dimensions: [
        { dimensionId: "dimension_service", valueIds: ["category_physical"], valueKeys: ["physical_therapy"], evidenceRefs: ["assignment_service_1"] },
        { dimensionId: "dimension_geo", valueIds: ["category_de"], valueKeys: ["de"], evidenceRefs: ["assignment_geo_de"] },
      ] }),
      entity("campaign_and_missing", { dimensions: [{ dimensionId: "dimension_service", valueIds: ["category_physical"], valueKeys: ["physical_therapy"], evidenceRefs: ["assignment_service_1"] }] }),
    ] });
    expect(result.included.map((item) => item.entityRef)).toEqual(["campaign_or"]);
  });
  it("admits future matching members at the next current resolution", () => {
    const first = resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_old")] });
    const next = resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_old"), entity("campaign_future")] });
    expect(first.included.map((item) => item.entityRef)).toEqual(["campaign_old"]);
    expect(next.included.map((item) => item.entityRef)).toEqual(["campaign_future", "campaign_old"]);
  });
  it("never lets explicit inclusion cross the canonical market boundary", () => {
    const result = resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_include", { market: { state: "resolved", dimensionId: "dimension_market", valueId: "category_yabanci", key: "yabanci", evidenceRefs: ["assignment_market_2"] }, dimensions: [] })] });
    expect(result.included).toEqual([]);
    expect(result.memberships[0]?.reason).toBe("excluded_market_mismatch");
  });
  it("excludes missing, ambiguous and conflicting market evidence", () => {
    const result = resolveSlice({ revision: revision(), resolvedAt: at, candidates: [
      entity("campaign_missing", { market: { state: "missing", evidenceRefs: [] } }),
      entity("campaign_ambiguous", { market: { state: "ambiguous", evidenceRefs: ["assignment_1", "assignment_2"] } }),
      entity("campaign_conflicting", { market: { state: "conflicting", evidenceRefs: ["assignment_1", "assignment_2"] } }),
    ] });
    expect(result.memberships.map((item) => item.reason)).toEqual(["excluded_market_ambiguous", "excluded_market_conflicting", "excluded_market_missing"]);
  });
  it("rejects non-canonical candidate shapes and mismatched dimension evidence", () => {
    expect(() => resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_bad_market", {
      market: { state: "missing", dimensionId: "dimension_market", evidenceRefs: [] } as SliceEntityCandidate["market"],
    })] })).toThrow();
    expect(() => resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_bad_dimension", {
      dimensions: [{ dimensionId: "dimension_service", valueIds: ["category_physical"], valueKeys: [], evidenceRefs: ["assignment_service_1"] }],
    })] })).toThrow();
  });
  it("normalizes duplicate explicit references and produces stable definition and result order", () => {
    const first = createSliceRevision({ sliceRef: "slice_growth", revisionRef: "slice_revision_1", revisionNumber: 1, market, predicates: [], explicitIncludeEntityRefs: ["campaign_b", "campaign_a", "campaign_a"], explicitExcludeEntityRefs: [] });
    const second = createSliceRevision({ sliceRef: "slice_growth", revisionRef: "slice_revision_1", revisionNumber: 1, market, predicates: [], explicitIncludeEntityRefs: ["campaign_a", "campaign_b"], explicitExcludeEntityRefs: [] });
    expect(first.definitionHash).toBe(second.definitionHash);
    expect(resolveSlice({ revision: first, resolvedAt: at, candidates: [entity("campaign_b"), entity("campaign_a")] }).included.map((item) => item.entityRef)).toEqual(["campaign_a", "campaign_b"]);
  });
  it("freezes exact membership evidence and replays independently of later candidate changes", () => {
    const result = resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_one")] });
    const frozen = buildFrozenSliceSnapshot(result);
    const later = resolveSlice({ revision: revision(), resolvedAt: "2026-08-18T12:00:00.000Z", candidates: [entity("campaign_one", { dimensions: [] })] });
    expect(later.included).toEqual([]);
    expect(replayFrozenSliceSnapshot(frozen)).toEqual(frozen);
    expect(buildFrozenSliceSnapshot(result).snapshotHash).toBe(frozen.snapshotHash);
  });
  it("rejects malformed self-hashed snapshots rather than trusting their hash", () => {
    const frozen = buildFrozenSliceSnapshot(resolveSlice({ revision: revision(), resolvedAt: at, candidates: [entity("campaign_one")] }));
    const malformed = { ...frozen, members: [{ ...frozen.members[0], reason: "excluded_no_match" }] } as unknown as typeof frozen;
    const selfHashed = { ...malformed, snapshotHash: "" } as Record<string, unknown>;
    selfHashed.snapshotHash = (awaitableHash(selfHashed));
    expect(() => replayFrozenSliceSnapshot(selfHashed as typeof frozen)).toThrow();
  });
});

function awaitableHash(snapshot: Record<string, unknown>): string {
  const { snapshotHash: _ignored, ...body } = snapshot;
  // Keep this test independent from a private implementation function while
  // deliberately constructing a syntactically valid self-hash.
  return createHash("sha256").update(JSON.stringify(stable(body))).digest("hex");
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
