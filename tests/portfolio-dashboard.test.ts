import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { filterCampaignPortfolio, OperatingDashboard } from "@/app/dashboard/operating-dashboard";

const model = {
  periodDays: 7, spend: "₺0", conversions: 0, cpa: "₺0", roas: "0",
  freshnessHours: 0, freshnessLabel: "şimdi", currency: "TRY", timezone: "Europe/Istanbul",
  attribution: "7d_click_1d_view",
};

describe("portfolio dashboard", () => {
  it("intersects Meta objective and internal-category filters without inventing a persisted source", () => {
    const campaigns = [
      { objective: "OUTCOME_LEADS", category: "Uluslararası hasta", id: "a" },
      { objective: "OUTCOME_LEADS", category: "Doktor tanıtım", id: "b" },
      { objective: "OUTCOME_AWARENESS", category: "Marka koruma", id: "c" },
    ];
    expect(filterCampaignPortfolio(campaigns, { objective: "OUTCOME_LEADS", category: "Uluslararası hasta" }).map((item) => item.id)).toEqual(["a"]);
    expect(filterCampaignPortfolio(campaigns, { objective: "all", category: "all" })).toHaveLength(3);
  });

  it("renders the read-only hierarchy and explicit demo-source boundary in the campaign surface", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model, initialView: "campaigns" }));
    expect(html).toContain("BUGÜN / PORTFÖY HİYERARŞİSİ");
    expect(html).toContain("Meta objective");
    expect(html).toContain("İç kategori");
    expect(html).toContain("unbound demo context");
    expect(html).toContain("persisted account-group/asset graph taklit edilmez");
    expect(html).not.toContain("Meta write yetkisi açık");
  });
});
