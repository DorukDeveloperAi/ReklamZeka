import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildCodexManualTask, codexPageGuide, OperatingDashboard } from "@/app/dashboard/operating-dashboard";

const model = {
  periodDays: 7, spend: "₺0", conversions: 0, cpa: "₺0", roas: "0",
  freshnessHours: 0, freshnessLabel: "şimdi", currency: "TRY", timezone: "Europe/Istanbul",
  attribution: "7d_click_1d_view",
};

describe("Rules normalization dashboard integration", () => {
  it("places the draft-only normalization workbench in the Rules flow, before Slice Rule work", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model, initialView: "rules" }));
    const guidance = html.indexOf("Talimatlar yükleniyor");
    const normalization = html.indexOf("Owner talimatını yapılandırılmış taslak olarak değerlendir");
    const sliceRule = html.indexOf("Kanıtlı kapsam için işletim kuralı taslağı");

    expect(guidance).toBeGreaterThanOrEqual(0);
    expect(normalization).toBeGreaterThan(guidance);
    expect(sliceRule).toBeGreaterThan(normalization);
    expect(html).toContain("Bu akış publish, G3, approval, action ve Meta write üretmez.");
    expect(html).toContain("Normalization sadece structured draft + varsayım/açık soru üretir");
  });

  it("keeps the strict policy screen separate from the normalization workbench", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model, initialView: "strict-policies" }));
    expect(html).toContain("Strict policy registry yükleniyor");
    expect(html).not.toContain("Owner talimatını yapılandırılmış taslak olarak değerlendir");
  });

  it("gives Codex the complete draft-only Rules record guide", () => {
    const task = buildCodexManualTask(codexPageGuide("rules", "Kurallar & akışlar"));
    expect(task).toContain("normalization-workbench-panel.tsx");
    expect(task).toContain("Guidance → Normalization → Slice Rule");
    expect(task).toContain("strict policy veya uygulama değildir");
  });
});
