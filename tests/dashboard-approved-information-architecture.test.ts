import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OperatingDashboard, type DashboardViewId } from "@/app/dashboard/operating-dashboard";

const primaryViews: readonly DashboardViewId[] = [
  "today", "campaigns", "decision-room", "budgets", "approvals", "rules", "settings",
];
const dashboardSource = readFileSync("src/app/dashboard/operating-dashboard.tsx", "utf8");

describe("approved dashboard information architecture", () => {
  it("keeps exactly seven user-purpose destinations and one page heading per primary surface", () => {
    for (const view of primaryViews) {
      const html = renderToStaticMarkup(createElement(OperatingDashboard, { initialView: view }));
      expect((html.match(/<h1/g) ?? []).length, view).toBe(1);
      expect((html.match(/<main/g) ?? []).length, view).toBe(1);
      expect(html, view).toContain('tabindex="-1"');
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
    expect(strict).toContain("Bağlayıcı politika kayıtları yükleniyor");

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

  it("binds navigation, subareas and the assistant to browser history and keyboard containment", () => {
    expect(dashboardSource).toContain('window.addEventListener("popstate", restoreLocation)');
    expect(dashboardSource).toContain('window.history[mode === "push" ? "pushState" : "replaceState"]');
    expect(dashboardSource).toContain("const campaignContextReady = requestedCampaignRef === null");
    expect(dashboardSource).toContain("campaignContextRequestRef.current !== requestId");
    expect(dashboardSource).toContain("campaignContextPending={!campaignContextReady}");
    expect(readFileSync("src/app/dashboard/approval-queue-panel.tsx", "utf8")).toContain("detailRequestEpoch.current !== requestEpoch");
    expect(readFileSync("src/app/dashboard/decision-room-panel.tsx", "utf8")).toContain("requestEpoch.current !== epoch");
    expect(dashboardSource).toContain("Kampanya bağlamı için yerel oturum gerekli");
    expect(dashboardSource).toContain('event.key !== "Tab"');
    expect(dashboardSource).toContain("assistantDrawerRef.current");
    expect(dashboardSource).toContain("contentRef.current?.focus()");
    expect(dashboardSource).toContain("lastContentFocusKeyRef");
    expect(dashboardSource).toContain('aria-current={activeView === item.id ? "page" : undefined}');
    expect(dashboardSource).not.toContain("<i>⌄</i>");
  });
});
