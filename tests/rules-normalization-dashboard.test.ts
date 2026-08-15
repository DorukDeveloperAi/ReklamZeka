import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildCodexManualTask, codexPageGuide, OperatingDashboard } from "@/app/dashboard/operating-dashboard";
import { normalizeDashboardLocation } from "@/app/dashboard/dashboard-location";

const model = {
  periodDays: 7, spend: "₺0", conversions: 0, cpa: "₺0", roas: "0",
  freshnessHours: 0, freshnessLabel: "şimdi", currency: "TRY", timezone: "Europe/Istanbul",
  attribution: "7d_click_1d_view",
};

describe("Rules normalization dashboard integration", () => {
  it("defers normalization until the Guidance source is verified and keeps Slice Rules in their own workspace", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model, initialView: "rules" }));
    const guidance = html.indexOf("Talimatlar yükleniyor");
    const normalization = html.indexOf("Owner talimatını yapılandırılmış taslak olarak değerlendir");
    const sliceRule = html.indexOf("SLICE &amp; KURAL ÇALIŞMA ALANI");

    expect(guidance).toBeGreaterThanOrEqual(0);
    expect(normalization).toBe(-1);
    expect(sliceRule).toBe(-1);
    expect(html).toContain("Kullanıcı yazarlı kural ve bağlam kayıtları");
  });

  it("opens the Slice Rule table without mounting the unrelated guidance editor", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model,
      initialLocation: { ...normalizeDashboardLocation("rules"), rulesArea: "slices" } }));
    expect(html).toContain("KURAL KÜTÜPHANESİ");
    expect(html).not.toContain("TALİMAT STUDIO");
    expect(html).not.toContain("DRAFT-ONLY NORMALIZATION");
  });

  it("keeps the strict policy screen separate from the normalization workbench", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model, initialView: "strict-policies" }));
    expect(html).toContain("Bağlayıcı politika kayıtları yükleniyor");
    expect(html).not.toContain("Owner talimatını yapılandırılmış taslak olarak değerlendir");
  });

  it("gives Codex the complete draft-only Rules record guide", () => {
    const task = buildCodexManualTask(codexPageGuide("rules", "Kurallar & akışlar"));
    expect(task).toContain("normalization-workbench-panel.tsx");
    expect(task).toContain("Guidance → Normalization → Slice Rule → Policy → Authority");
    expect(task).toContain("yayın, onay veya execution yapma");
  });
});
