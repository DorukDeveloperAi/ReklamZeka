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
    expect(brief.nextDecision).toBeNull();
    expect(brief.campaignLanes).toEqual([expect.objectContaining({ laneRef: "conversion_lane", sequence: 1, route: "lead_form" })]);
  });

  it("routes interrupted delivery and unclassified records to blocking templates before performance guidance", () => {
    expect(createInteractiveCampaignBrief({ ...base, deliveryHealth: "interrupted" })).toMatchObject({ templateRef: "continuity_recovery", readiness: "blocked" });
    const unclassified = createInteractiveCampaignBrief({ ...base, classification: "unclassified" });
    expect(unclassified).toMatchObject({ templateRef: "classification_triage", readiness: "blocked", nextDecision: { field: "classification" } });
    expect(unclassified.campaignLanes).toEqual([]);
  });

  it("asks for missing market/service/capacity inputs instead of inventing a launch plan", () => {
    const brief = createInteractiveCampaignBrief({ ...base, market: "international", language: null, serviceRef: null,
      countryOrRegion: null, capacity: "unknown", conversionRoute: "unknown", creativeReady: false });
    expect(brief).toMatchObject({ readiness: "needs_input", templateRef: "lead_acquisition" });
    expect(brief.questions).toHaveLength(5);
    expect(brief.nextDecision).toMatchObject({ field: "language" });
  });

  it("keeps upper-funnel education separate from lead measurement", () => {
    const brief = createInteractiveCampaignBrief({ ...base, businessGoal: "upper_funnel_education", conversionRoute: "not_applicable" });
    expect(brief.measurement.primaryOutcome).toContain("erişim/etkileşim");
    expect(brief.measurement.doNotCompareWith).toContain("lead CPL");
    expect(brief.campaignLanes).toEqual([expect.objectContaining({ laneRef: "education_lane", route: "not_applicable" })]);
  });

  it("keeps a market-service learning lane separate from conversion and asks one next question at a time", () => {
    const brief = createInteractiveCampaignBrief({ ...base, businessGoal: "market_service_learning", capacity: "unknown" });
    expect(brief).toMatchObject({ readiness: "needs_input", nextDecision: { field: "capacity" } });
    expect(brief.campaignLanes).toEqual([expect.objectContaining({ laneRef: "learning_lane", sequence: 1 })]);
    expect(brief.authority).toMatchObject({ canCreateCampaign: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });
  });
});
