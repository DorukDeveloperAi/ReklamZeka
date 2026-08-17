import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OperatingDashboard, type DashboardViewId } from "@/app/dashboard/operating-dashboard";
import { normalizeDashboardLocation } from "@/app/dashboard/dashboard-location";

const primaryViews: readonly DashboardViewId[] = [
  "monitor", "manage", "agent",
];
const dashboardSource = readFileSync("src/app/dashboard/operating-dashboard.tsx", "utf8");
const sliceRuleSource = readFileSync("src/app/dashboard/slice-rule-workspace-panel.tsx", "utf8");
const sliceRuleStyles = readFileSync("src/app/dashboard/slice-rule-workspace-panel.module.css", "utf8");

describe("approved dashboard information architecture", () => {
  it("keeps five operator destinations and one page heading per existing routed surface", () => {
    for (const view of primaryViews) {
      const html = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: view }));
      expect((html.match(/<h1/g) ?? []).length, view).toBe(1);
      expect((html.match(/<main/g) ?? []).length, view).toBe(1);
      expect(html, view).toContain('tabindex="-1"');
      expect((html.match(/<nav aria-label="Ana alanlar"/g) ?? []).length, view).toBe(1);
      expect(html, view).toContain("Operasyon");
      expect(html, view).toContain("Kılavuzlar");
      expect(html, view).toContain("Analiz");
      expect(html, view).toContain("Kararlar");
      expect(html, view).toContain("Sistem");
      expect(html, view).toContain("Agent");
      expect(html, view).not.toContain("<strong>Orchestrator Agent</strong>");
      expect(html, view).not.toContain("<strong>Teslimat alarmları</strong>");
      expect(html, view).not.toContain("<strong>Timeline</strong>");
    }
  });

  it("routes legacy capability entries into their approved parent context", () => {
    const strict = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "strict-policies" }));
    expect(strict).toContain('aria-label="Kılavuzlar"');
    expect(strict).toContain("Bağlayıcı politika kayıtları yükleniyor");

    const category = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "categories" }));
    expect(category).toContain('aria-label="Sistem"');
    expect(category).toContain("Kategori envanteri yükleniyor");

    const promotion = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "promotions" }));
    expect(promotion).toContain('aria-label="Operasyon"');
    expect(promotion).toContain("K4 ön kontrol");
    expect((promotion.match(/<h1/g) ?? []).length).toBe(1);
  });

  it("keeps Agent as a primary page and makes its authoring boundary explicit", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "agent" }));
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain("Kanıtı açıklayın, kuralı siz yazın.");
    expect(html).toContain("kural/policy metni üretmez, alanlara kopyalamaz veya kayıt oluşturmaz");
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
  });

  it("offers a persistent, accessible light-theme preference without changing the information architecture", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "monitor" }));
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('aria-label="Açık temaya geç"');
    expect(dashboardSource).toContain('window.localStorage.setItem("reklamzeka.dashboard-theme", nextTheme)');
    expect(readFileSync("src/app/dashboard/operating-dashboard.module.css", "utf8")).toContain('.appShell[data-theme="light"]');
  });

  it("keeps one page heading while a selected campaign context is being recovered", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, {
      initialLocation: { ...normalizeDashboardLocation("decision-room"), campaignRef: "ref_abcdef012345" },
    }));

    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toContain("Kampanya bağlamı doğrulanamadı");
    expect((html.match(/<main/g) ?? []).length).toBe(1);
  });

  it("binds navigation and subareas to browser history without a dialog-only Agent", () => {
    expect(dashboardSource).toContain('window.addEventListener("popstate", restoreLocation)');
    expect(dashboardSource).toContain('window.history[mode === "push" ? "pushState" : "replaceState"]');
    expect(dashboardSource).toContain("const campaignContextReady = requestedCampaignRef === null");
    expect(dashboardSource).toContain("campaignContextRequestRef.current !== requestId");
    expect(dashboardSource).toContain("campaignContextPending={!campaignContextReady}");
    expect(dashboardSource).toContain("function openSlicePreparation(campaignRef: string)");
    expect(dashboardSource).toContain("onOpenSliceWorkspace={openSlicePreparation}");
    expect(readFileSync("src/app/dashboard/approval-queue-panel.tsx", "utf8")).toContain("detailRequestEpoch.current !== requestEpoch");
    expect(readFileSync("src/app/dashboard/decision-room-panel.tsx", "utf8")).toContain("requestEpoch.current !== epoch");
    expect(dashboardSource).toContain("Kampanya bağlamı için yerel oturum gerekli");
    expect(dashboardSource).toContain("contentRef.current?.focus()");
    expect(dashboardSource).toContain('aria-current={activePrimaryNavigationArea === item.id ? "page" : undefined}');
    expect(dashboardSource).toContain('<nav className={styles.mobileNav} aria-label="Ana alanlar (mobil)">');
    expect(dashboardSource).toContain("Canlı Graph envanteri bu sürümde kapalıdır.");
    expect(dashboardSource).toContain("kural/policy metni üretmez, alanlara kopyalamaz veya kayıt oluşturmaz");
    expect(sliceRuleSource).not.toContain("<h1>Kanıtlı kapsam için işletim kuralı taslağı</h1>");
    expect(sliceRuleSource).toContain("Kullanıcı yazarlı kuralları");
    expect(sliceRuleSource).toContain("KURAL KÜTÜPHANESİ");
    expect(sliceRuleSource).toContain('term="Slice, kural ve takip yaklaşımı"');
    expect(sliceRuleStyles).toContain(".hero h2");
    expect(dashboardSource).not.toContain("<i>⌄</i>");
  });
});
