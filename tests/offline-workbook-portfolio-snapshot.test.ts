import { describe, expect, it } from "vitest";

import { offlineWorkbookPortfolioSnapshot } from "@/domain/campaigns/offline-workbook-portfolio-snapshot";

describe("offline workbook portfolio snapshot", () => {
  it("preserves the workbook's dated market and conversion-route boundaries without presenting a live source", () => {
    expect(offlineWorkbookPortfolioSnapshot).toMatchObject({
      version: "offline-workbook-portfolio/1.0.0",
      source: "kampanya_butce_harcama_takip_kesinti_analizli.xlsx",
      totals: { campaigns: 27, leads: 3407 },
      interruptionRule: expect.stringContaining("teslimat kesintisi"),
    });
    expect(offlineWorkbookPortfolioSnapshot.markets).toEqual([
      expect.objectContaining({ market: "Yerli", formLeads: 2125, whatsappLeads: 0 }),
      expect.objectContaining({ market: "Yabancı", formLeads: 501, whatsappLeads: 781 }),
    ]);
    expect(offlineWorkbookPortfolioSnapshot.lanes).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: "AR", route: "whatsapp", briefScenarioRef: "international_ar_whatsapp" }),
      expect.objectContaining({ language: "RU", route: "lead_form", briefScenarioRef: "international_ru_form" }),
    ]));
  });
});
