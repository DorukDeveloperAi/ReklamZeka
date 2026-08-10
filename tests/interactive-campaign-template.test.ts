import { describe, expect, it } from "vitest";
import { createInteractiveCampaignBrief } from "@/domain/campaigns/interactive-campaign-template";

const base = { businessGoal: "lead_acquisition" as const, market: "domestic" as const, language: "tr",
  serviceRef: "service_medical_aesthetics", countryOrRegion: null, conversionRoute: "lead_form" as const,
  deliveryHealth: "healthy" as const, classification: "classified" as const, capacity: "confirmed" as const, creativeReady: true };

describe("interactive campaign template", () => {
  it("creates a human-review-only lead brief and keeps form and WhatsApp outcomes distinct", () => {
    const brief = createInteractiveCampaignBrief(base);
    expect(brief).toMatchObject({ templateRef: "lead_acquisition", readiness: "ready_for_human_review", humanReviewRequired: true,
      measurement: { primaryOutcome: "Nitelikli form talebi" }, authority: { canCreateCampaign: false, canWriteMeta: false } });
    expect(brief.measurement.doNotCompareWith).toContain("farklı dönüşüm yolu");
  });

  it("routes interrupted delivery and unclassified records to blocking templates before performance guidance", () => {
    expect(createInteractiveCampaignBrief({ ...base, deliveryHealth: "interrupted" })).toMatchObject({ templateRef: "continuity_recovery", readiness: "blocked" });
    expect(createInteractiveCampaignBrief({ ...base, classification: "unclassified" })).toMatchObject({ templateRef: "classification_triage", readiness: "blocked" });
  });

  it("asks for missing market/service/capacity inputs instead of inventing a launch plan", () => {
    const brief = createInteractiveCampaignBrief({ ...base, market: "international", language: null, serviceRef: null,
      countryOrRegion: null, capacity: "unknown", conversionRoute: "unknown", creativeReady: false });
    expect(brief).toMatchObject({ readiness: "needs_input", templateRef: "lead_acquisition" });
    expect(brief.questions).toHaveLength(5);
  });

  it("keeps upper-funnel education separate from lead measurement", () => {
    const brief = createInteractiveCampaignBrief({ ...base, businessGoal: "upper_funnel_education", conversionRoute: "not_applicable" });
    expect(brief.measurement.primaryOutcome).toContain("erişim/etkileşim");
    expect(brief.measurement.doNotCompareWith).toContain("lead CPL");
  });
});
