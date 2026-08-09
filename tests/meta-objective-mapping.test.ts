import { describe, expect, it } from "vitest";
import {
  META_OBJECTIVE_MAPPING_CATALOG,
  META_OBJECTIVE_MAPPING_VERSION,
  normalizeMetaCampaignObjective,
} from "@/domain/meta/objective-mapping";

describe("reviewed Meta objective mapping", () => {
  it("maps current and legacy objectives onto exactly six canonical objectives", () => {
    expect(normalizeMetaCampaignObjective("OUTCOME_LEADS")).toMatchObject({
      version: META_OBJECTIVE_MAPPING_VERSION,
      status: "mapped",
      sourceKind: "current",
      canonicalObjective: "lead_generation",
      reason: "reviewed_current",
    });
    expect(normalizeMetaCampaignObjective("LEAD_GENERATION")).toMatchObject({
      status: "mapped",
      sourceKind: "legacy",
      canonicalObjective: "lead_generation",
      reason: "reviewed_legacy",
    });
    const mapped = [...Object.values(META_OBJECTIVE_MAPPING_CATALOG.current), ...Object.values(META_OBJECTIVE_MAPPING_CATALOG.legacy)];
    expect([...new Set(mapped)].sort()).toEqual([
      "app_growth", "awareness", "engagement", "lead_generation", "sales", "traffic",
    ]);
  });

  it("leaves null, unknown, and malformed sources explicitly uncertain without guessing", () => {
    expect(normalizeMetaCampaignObjective(null)).toEqual({
      version: META_OBJECTIVE_MAPPING_VERSION,
      status: "uncertain",
      sourceObjective: null,
      sourceKind: null,
      canonicalObjective: null,
      reason: "source_missing",
    });
    expect(normalizeMetaCampaignObjective("OUTCOME_FUTURE")).toMatchObject({
      status: "uncertain", sourceObjective: "OUTCOME_FUTURE", canonicalObjective: null, reason: "source_unknown",
    });
    expect(normalizeMetaCampaignObjective("outcome_sales")).toMatchObject({
      status: "uncertain", sourceObjective: null, canonicalObjective: null, reason: "source_invalid",
    });
  });
});
