import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperatingDashboard, type DashboardViewId } from "@/app/dashboard/operating-dashboard";

const primaryViews: readonly DashboardViewId[] = [
  "today", "campaigns", "decision-room", "budgets", "approvals", "rules", "settings",
];

describe("approved dashboard information architecture", () => {
  it("keeps exactly seven user-purpose destinations and one page heading per primary surface", () => {
    for (const view of primaryViews) {
      const html = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: view }));
      expect((html.match(/<h1/g) ?? []).length, view).toBe(1);
      expect((html.match(/<nav aria-label="Ana navigasyon"/g) ?? []).length, view).toBe(1);
      expect(html, view).toContain("Kurallar &amp; Yetkiler");
      expect(html, view).toContain("Ayarlar");
      expect(html, view).not.toContain("<strong>Orchestrator Agent</strong>");
      expect(html, view).not.toContain("<strong>Teslimat alarmları</strong>");
      expect(html, view).not.toContain("<strong>Timeline</strong>");
    }
  });

  it("routes legacy capability entries into their approved parent context", () => {
    const strict = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "strict-policies" }));
    expect(strict).toContain('aria-label="Kurallar &amp; Yetkiler"');
    expect(strict).toContain("Strict policy registry yükleniyor");

    const category = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "categories" }));
    expect(category).toContain('aria-label="Ayarlar"');
    expect(category).toContain("Kategori envanteri yükleniyor");

    const promotion = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "promotions" }));
    expect(promotion).toContain('aria-label="Kampanyalar"');
    expect(promotion).toContain("K4 ön kontrol");
    expect((promotion.match(/<h1/g) ?? []).length).toBe(1);
  });

  it("opens the legacy agent entry as a contextual dialog instead of a primary page", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: "agent" }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="dashboard-assistant-title"');
    expect(html).toContain("Bağlamı kaybetmeden çalışın.");
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
  });
});
