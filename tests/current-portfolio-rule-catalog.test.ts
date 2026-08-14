import { describe, expect, it } from "vitest";

import {
  CURRENT_PORTFOLIO_RULE_CATALOG,
  INTERNATIONAL_INTENSIVE_FTR_EVALUATION_COHORT_RULE,
  currentPortfolioRulesFor,
} from "@/domain/campaigns/current-portfolio-rule-catalog";

describe("current portfolio rule catalogue", () => {
  it("keeps the portfolio market boundary first and supplies FTR's specialised group rules only in scope", () => {
    const matching = currentPortfolioRulesFor({
      market: "international", serviceRef: "service_physical_therapy_rehab", campaignFamilyRef: "campaign_family_intensive_ftr",
      businessGoal: "lead_acquisition", countryOrRegion: "gcc", audienceStrategy: "custom_audience", platform: "instagram",
    });
    expect(matching.map((rule) => rule.rule.kind)).toEqual([
      "pazar_siniri", "degerlendirme_kumesi", "sonuc_olcum_siniri", "targeting_budget_preservation",
    ]);
    expect(matching[1]).toBe(INTERNATIONAL_INTENSIVE_FTR_EVALUATION_COHORT_RULE);
    expect(matching.every((rule) => rule.authority.canWriteMeta === false && rule.authority.canEnableAutomation === false)).toBe(true);
  });

  it("does not leak foreign FTR rules into a domestic campaign merely because it has a similar route", () => {
    const matching = currentPortfolioRulesFor({
      market: "domestic", serviceRef: "service_physical_therapy_rehab", businessGoal: "lead_acquisition", conversionRoute: "whatsapp",
    });
    expect(matching).toHaveLength(1);
    expect(matching[0]?.rule.kind).toBe("pazar_siniri");
  });

  it("has a deterministic priority order", () => {
    expect(CURRENT_PORTFOLIO_RULE_CATALOG.map((rule) => rule.priority)).toEqual([1000, 850, 110, 100]);
  });
});
