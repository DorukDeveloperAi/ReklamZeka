import { describe, expect, it } from "vitest";

import { auditAdNamingIdentity, auditAdSetNamingIdentity, auditCampaignNamingIdentity } from "@/domain/campaigns/live-naming-identity-audit";

describe("live naming identity audit", () => {
  it("verifies the Russian FTR campaign name against live objective and its reviewed identity", () => {
    const audit = auditCampaignNamingIdentity({
      name: "Fizik Tedavi - Intensive FTR - Türki Cumhuriyetler - Tümü - RU - Lechenie v Turtsii - lead",
      configuredObjective: "OUTCOME_LEADS",
      expected: { service: "physical_therapy_rehab", campaignFamily: "intensive_ftr", route: "lead_form", language: "ru" },
    });

    expect(audit.status).toBe("verified");
    expect(audit.suggestedName).toBeNull();
    expect(audit.authority).toEqual({ canRename: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });
  });

  it("rejects WhatsApp as the primary campaign identity while retaining it as a live route", () => {
    const audit = auditCampaignNamingIdentity({
      name: "Whatsapp - Fizik Tedavi - Intensive FTR - Arap Bölgesi - AR",
      configuredObjective: "OUTCOME_LEADS",
      expected: { service: "physical_therapy_rehab", campaignFamily: "intensive_ftr", route: "whatsapp", language: "ar" },
    });

    expect(audit.status).toBe("mismatch");
    expect(audit.findings.find((item) => item.facet === "campaign_family")).toMatchObject({ status: "verified" });
    expect(audit.findings.find((item) => item.facet === "route")).toMatchObject({ status: "mismatch", severity: "correction_required" });
    expect(audit.suggestedName).toBe("Fizik Tedavi · Intensive FTR");
    expect(audit.authority.canRename).toBe(false);
  });

  it("does not require a conversion route token in a campaign name", () => {
    const audit = auditCampaignNamingIdentity({
      name: "Fizik Tedavi - Intensive FTR - Arap Bölgesi - AR",
      configuredObjective: "OUTCOME_LEADS",
      expected: { service: "physical_therapy_rehab", campaignFamily: "intensive_ftr", route: "whatsapp", language: "ar" },
    });

    expect(audit.status).toBe("unknown");
    expect(audit.findings.find((item) => item.facet === "route")).toMatchObject({ status: "unknown", severity: "information" });
  });

  it("recognizes a WApp naming variant without allowing it to become the campaign identity", () => {
    const audit = auditCampaignNamingIdentity({
      name: "WApp - Fizik Tedavi - Intensive FTR - AR",
      configuredObjective: "OUTCOME_LEADS",
      expected: { service: "physical_therapy_rehab", campaignFamily: "intensive_ftr", route: "whatsapp", language: "ar" },
    });

    expect(audit.findings.find((item) => item.facet === "route")).toMatchObject({ status: "mismatch", severity: "correction_required" });
    expect(audit.suggestedName).toBe("Fizik Tedavi · Intensive FTR");
  });

  it("flags an Arabic Android ad set whose name omits a live targeted country and proposes only a reviewable label", () => {
    const audit = auditAdSetNamingIdentity({
      name: "Kuveyt,Katar Whatsapp android luks",
      configuredTargeting: { countryCodes: ["BH", "KW", "QA"], userOperatingSystem: "android", publisherPlatforms: null },
      observedDelivery: { countryCodes: ["BH", "KW", "QA"], platformBreakdown: ["mobile_app", "mobile_web"] },
      expected: { route: "whatsapp", audienceStrategy: "luks" },
    });

    expect(audit.status).toBe("mismatch");
    expect(audit.findings.find((item) => item.facet === "country_targeting")).toMatchObject({ status: "mismatch", severity: "correction_required" });
    expect(audit.findings.find((item) => item.facet === "publisher_platform")).toMatchObject({ status: "unknown" });
    expect(audit.suggestedName).toBe("Bahreyn + Kuveyt + Katar · WhatsApp · Android · luks");
    expect(audit.authority.canRename).toBe(false);
  });

  it("does not confuse observed delivery platform with operating-system targeting", () => {
    const audit = auditAdSetNamingIdentity({
      name: "FTR - genel - lead - cold - özbekistan - kombine2 - iOS hedefli",
      configuredTargeting: { countryCodes: ["UZ"], userOperatingSystem: "ios", publisherPlatforms: ["facebook", "instagram"] },
      observedDelivery: { countryCodes: ["UZ"], platformBreakdown: ["mobile_app", "mobile_web"] },
      expected: { route: "lead_form", audienceStrategy: "kombine2" },
    });

    expect(audit.findings.find((item) => item.facet === "operating_system")?.status).toBe("verified");
    expect(audit.findings.find((item) => item.facet === "delivery_country")?.status).toBe("verified");
    expect(audit.status).toBe("verified");
  });

  it("keeps unexpected delivery as a review issue instead of rewriting targeting", () => {
    const audit = auditAdSetNamingIdentity({
      name: "BAE Whatsapp IOS luks",
      configuredTargeting: { countryCodes: ["AE"], userOperatingSystem: "ios", publisherPlatforms: null },
      observedDelivery: { countryCodes: ["AE", "KW"], platformBreakdown: ["mobile_app"] },
      expected: { route: "whatsapp", audienceStrategy: "luks" },
    });

    expect(audit.findings.find((item) => item.facet === "delivery_country")).toMatchObject({ status: "mismatch", severity: "review_required" });
    expect(audit.authority.canWriteMeta).toBe(false);
  });

  it("flags a bare Arabic copy-chain ad name without inventing a creative replacement", () => {
    const audit = auditAdNamingIdentity({ name: "1 - Kopya - Kopya", expected: { language: "ar" } });

    expect(audit.entityType).toBe("ad");
    expect(audit.status).toBe("mismatch");
    expect(audit.findings[0]).toMatchObject({ status: "mismatch", severity: "correction_required" });
    expect(audit.suggestedName).toBeNull();
    expect(audit.authority.canRename).toBe(false);
  });
});
