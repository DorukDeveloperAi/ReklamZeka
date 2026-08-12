import { describe, expect, it } from "vitest";
import { createInteractiveCampaignBrief, planningHintFromPersistedCampaignContext } from "@/domain/campaigns/interactive-campaign-template";

const base = { businessGoal: "lead_acquisition" as const, market: "domestic" as const, language: "tr",
  serviceRef: "service_medical_aesthetics", countryOrRegion: null, conversionRoute: "lead_form" as const,
  deliveryHealth: "healthy" as const, classification: "classified" as const, capacity: "confirmed" as const, creativeReady: true };

describe("interactive campaign template", () => {
  it("creates a human-review-only lead brief and keeps form and WhatsApp outcomes distinct", () => {
    const brief = createInteractiveCampaignBrief(base);
    expect(brief).toMatchObject({ templateRef: "lead_acquisition", readiness: "ready_for_human_review", humanReviewRequired: true,
      measurement: { primaryOutcome: "Nitelikli form talebi" }, authority: { canCreateCampaign: false, canWriteMeta: false } });
    expect(brief.measurement.doNotCompareWith).toContain("farklı dönüşüm yolu");
    expect(brief.variantRef).toBe("domestic_form_lead");
    expect(brief.comparisonBoundary.cohortKey).toBe("domestic:tr:domestic:service_medical_aesthetics:lead_acquisition:lead_form");
    expect(brief.nextDecision).toBeNull();
    expect(brief.campaignLanes).toEqual([expect.objectContaining({ laneRef: "conversion_lane", sequence: 1, route: "lead_form" })]);
    expect(brief.recommendation).toMatchObject({ status: "ready_for_human_review", kind: "review_campaign_structure", laneRefs: ["conversion_lane"] });
  });

  it("routes interrupted delivery and unclassified records to blocking templates before performance guidance", () => {
    expect(createInteractiveCampaignBrief({ ...base, deliveryHealth: "interrupted" })).toMatchObject({ templateRef: "continuity_recovery", readiness: "blocked", recommendation: { kind: "restore_delivery" } });
    const unclassified = createInteractiveCampaignBrief({ ...base, classification: "unclassified" });
    expect(unclassified).toMatchObject({ templateRef: "classification_triage", readiness: "blocked", nextDecision: { field: "classification" }, recommendation: { kind: "resolve_classification" } });
    expect(unclassified.campaignLanes).toEqual([]);
  });

  it("asks for missing market/service/capacity inputs instead of inventing a launch plan", () => {
    const brief = createInteractiveCampaignBrief({ ...base, market: "international", language: null, serviceRef: null,
      countryOrRegion: null, capacity: "unknown", conversionRoute: "unknown", creativeReady: false });
    expect(brief).toMatchObject({ readiness: "needs_input", templateRef: "lead_acquisition" });
    expect(brief.questions).toHaveLength(5);
    expect(brief.nextDecision).toMatchObject({ field: "language" });
    expect(brief.recommendation).toMatchObject({ status: "needs_input", kind: "complete_brief" });
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

  it("does not invent a market or delivery lane, and gives those answers priority after classification", () => {
    const marketUnknown = createInteractiveCampaignBrief({ ...base, market: "unknown" });
    expect(marketUnknown).toMatchObject({ readiness: "needs_input", variantRef: null, nextDecision: { field: "market" } });
    expect(marketUnknown.campaignLanes).toEqual([]);
    expect(marketUnknown.comparisonBoundary.cohortKey).toBeNull();

    const deliveryUnknown = createInteractiveCampaignBrief({ ...base, deliveryHealth: "unknown" });
    expect(deliveryUnknown).toMatchObject({ readiness: "needs_input", variantRef: null, nextDecision: { field: "deliveryHealth" } });
    expect(deliveryUnknown.campaignLanes).toEqual([]);
  });

  it("keeps domestic/international and form/WhatsApp variants in distinct comparison boundaries", () => {
    const internationalWhatsApp = createInteractiveCampaignBrief({ ...base, market: "international", language: "ar", countryOrRegion: "GCC", conversionRoute: "whatsapp" });
    expect(internationalWhatsApp.variantRef).toBe("international_whatsapp_lead");
    expect(internationalWhatsApp.comparisonBoundary.cohortKey).toBe("international:ar:gcc:service_medical_aesthetics:lead_acquisition:whatsapp");
    expect(internationalWhatsApp.comparisonBoundary.summary).toContain("Yalnız aynı pazar");
  });

  it("adds a human-confirmed campaign family to a cohort without confusing it with the route", () => {
    const brief = createInteractiveCampaignBrief({ ...base, market: "international", language: "ar", countryOrRegion: "GCC",
      serviceRef: "service_physical_therapy_rehab", campaignFamilyRef: "campaign_family_intensive_ftr", conversionRoute: "whatsapp" });
    expect(brief.classification.campaignFamilyRef).toBe("campaign_family_intensive_ftr");
    expect(brief.comparisonBoundary.requiredDimensions).toContain("campaignFamily");
    expect(brief.comparisonBoundary.cohortKey).toBe("international:ar:gcc:service_physical_therapy_rehab:campaign_family_intensive_ftr:lead_acquisition:whatsapp");
  });

  it("uses only a verified frozen Meta objective as an optional business-goal hint", () => {
    expect(planningHintFromPersistedCampaignContext({ meta: { objective: { state: "known", value: "lead_generation" } } }))
      .toMatchObject({ source: "frozen_campaign_context", suggestedBusinessGoal: "lead_acquisition", deliveryHealth: "unknown", requiresHumanClassification: true });
    expect(planningHintFromPersistedCampaignContext({ meta: { objective: { state: "known", value: "awareness" } } }))
      .toMatchObject({ suggestedBusinessGoal: "upper_funnel_education" });
    expect(planningHintFromPersistedCampaignContext({ meta: { objective: { state: "known", value: "sales" } } }))
      .toMatchObject({ suggestedBusinessGoal: null });
    expect(planningHintFromPersistedCampaignContext({ meta: { objective: { state: "unknown", reason: "objective_unmapped" } } }))
      .toMatchObject({ suggestedBusinessGoal: null });
    expect(planningHintFromPersistedCampaignContext({ meta: { objective: { state: "known", value: 42 } } })).toBeNull();
  });
});
