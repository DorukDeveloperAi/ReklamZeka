import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CampaignPlanningBriefPanel, type CampaignPlanningBriefContext } from "@/app/dashboard/campaign-planning-brief-panel";

const gccContext: CampaignPlanningBriefContext = Object.freeze({
  campaignRef: "cmp_gcc",
  campaignLabel: "GCC · Doktor Tanıtım · Leads",
  input: Object.freeze({ businessGoal: "lead_acquisition", market: "international", language: "ar", serviceRef: "service_doctor_introduction", countryOrRegion: "GCC", conversionRoute: "lead_form", deliveryHealth: "healthy", classification: "classified", capacity: "confirmed", creativeReady: true }),
});

describe("campaign planning brief panel", () => {
  it("surfaces the taxonomy-driven, proposal-only interactive brief without any action control", () => {
    const html = renderToStaticMarkup(createElement(CampaignPlanningBriefPanel));
    expect(html).toContain("Taslak kampanya briefi");
    expect(html).toContain("pazar → dil → hizmet → iş amacı → dönüşüm yolu → kapasite/kreatif");
    expect(html).toContain("Nitelikli form talebi");
    expect(html).toContain("campaign create / publish / approval / execute / Meta write: kapalı");
    expect(html).not.toMatch(/Meta.{0,30}(yaz|write).{0,30}(başlat|çalıştır|onayla)/i);
  });

  it("starts from the selected campaign context and keeps context reset proposal-only", () => {
    const html = renderToStaticMarkup(createElement(CampaignPlanningBriefPanel, { context: gccContext }));
    expect(html).toContain("Seçili bağlam: GCC · Doktor Tanıtım · Leads");
    expect(html).toContain("CONTEXT BOUND");
    expect(html).toContain("Nitelikli form talebi");
    expect(html).toContain("Bağlamı geri yükle");
    expect(html).not.toContain("Meta transport");
  });
});
