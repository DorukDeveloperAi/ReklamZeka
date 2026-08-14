import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperatingDashboard } from "@/app/dashboard/operating-dashboard";

const model = {
  periodDays: 7, spend: "₺0", conversions: 0, cpa: "₺0", roas: "0",
  freshnessHours: 0, freshnessLabel: "şimdi", currency: "TRY", timezone: "Europe/Istanbul",
  attribution: "7d_click_1d_view",
};

describe("portfolio dashboard", () => {
  it("renders only the canonical source boundary while the campaign mirror is loading", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model, initialView: "campaigns" }));
    expect(html).toContain("META PORTFÖYÜ · KANONİK AYNA");
    expect(html).toContain("Kampanya kaynağı okunuyor");
    expect(html).toContain("ekran örnek içerikle doldurulmaz");
    expect(html).not.toContain("OFFLINE ÇALIŞMA KİTABI");
    expect(html).not.toContain("Demo Marka");
    expect(html).not.toContain("deterministik demo");
    expect(html).not.toContain("Taslak örnek");
    expect(html).not.toContain("Broad · İstanbul");
  });
});
