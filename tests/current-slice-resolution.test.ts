import { describe, expect, it } from "vitest";
import { createSliceRevision } from "@/domain/slices/slice-definition";
import { resolveCurrentOperationSlice } from "@/connectors/operations/current-slice-resolution";

const marketDimension = "dimension_market", marketYerli = "definition_yerli", segmentDimension = "dimension_segment", segmentA = "definition_segment_a";
const revision = createSliceRevision({ sliceRef: "slice_current", revisionRef: "slice_revision_current", revisionNumber: 2, market: { dimensionId: marketDimension, valueId: marketYerli, key: "yerli" }, predicates: [{ dimensionId: segmentDimension, key: "segment", values: [{ valueId: segmentA, key: "a" }] }], explicitIncludeEntityRefs: ["campaign_include"], explicitExcludeEntityRefs: ["adset_exclude"] });
const candidate = (entityRef: string, entityLevel: "organization_campaign" | "campaign" | "ad_set", market = marketYerli, segment = segmentA) => ({ entityRef, entityLevel, market: { state: "resolved" as const, dimensionId: marketDimension, valueId: market, key: market === marketYerli ? "yerli" as const : "yabanci" as const, evidenceRefs: ["evidence_market"] }, dimensions: [{ dimensionId: segmentDimension, valueIds: [segment], valueKeys: ["a"], evidenceRefs: ["evidence_segment"] }] });

describe("current operation slice resolver", () => {
  it("uses current own-level evidence, hard market, and exclude precedence", () => {
    expect(resolveCurrentOperationSlice({ revision, resolvedAt: "2026-08-17T00:00:00.000Z", candidates: [candidate("orgcampaign_new", "organization_campaign"), candidate("campaign_include", "campaign", "definition_other"), candidate("adset_exclude", "ad_set"), candidate("campaign_dynamic", "campaign"), candidate("campaign_foreign", "campaign", "definition_yabanci")] })).toEqual(["campaign_dynamic", "orgcampaign_new"]);
  });
  it("fails closed when persisted definition hash has been tampered", () => {
    expect(() => resolveCurrentOperationSlice({ revision: { ...revision, definitionHash: "0".repeat(64) }, resolvedAt: "2026-08-17T00:00:00.000Z", candidates: [candidate("campaign_dynamic", "campaign")] })).toThrow("slice definition");
  });
});
