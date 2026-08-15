import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeDashboardLocation } from "@/app/dashboard/operating-dashboard";

const dashboard = readFileSync("src/app/dashboard/operating-dashboard.tsx", "utf8");
const decisionRoom = readFileSync("src/app/dashboard/decision-room-panel.tsx", "utf8");
const budgetLab = readFileSync("src/app/dashboard/budget-lab-panel.tsx", "utf8");
const approvalQueue = readFileSync("src/app/dashboard/approval-queue-panel.tsx", "utf8");
const autonomyStudio = readFileSync("src/app/dashboard/autonomy-studio-panel.tsx", "utf8");
const budgetPools = readFileSync("src/app/dashboard/budget-pool-hierarchy-panel.tsx", "utf8");

describe("dashboard analysis and decision information architecture", () => {
  it("keeps one production-backed analysis surface and removes the static duplicate", () => {
    expect(dashboard).toContain('{ id: "manage", label: "Portföy / Slice"');
    expect(dashboard).not.toContain('{ id: "analysis", label: "Analizler"');
    expect(dashboard).not.toContain("const analysisRuns");
    expect(dashboard).not.toContain("4 hesap · 32 kampanya");
    expect(dashboard).not.toContain("Dry-run çalıştır →");
    expect(dashboard).not.toContain("Takvimi yönet");
    expect(decisionRoom).toContain("Yalnız bağlı çalışma alanının rutinleri, koşumları ve sonuçları gösterilir.");
  });

  it("routes the legacy analysis entry point to the canonical Decision Room read model", () => {
    expect(normalizeDashboardLocation("analysis")).toMatchObject({ view: "manage", manageArea: "decisions", decisionArea: "analysis" });
    expect(dashboard).toContain('componentPath: "src/app/dashboard/decision-room-panel.tsx"');
    expect(dashboard).not.toContain("function renderAnalysis()");
  });

  it("implements the approved three-purpose primary IA and keeps legacy entries contextual", () => {
    for (const label of ["Ana Sayfa", "Portföy / Slice", "Agent"]) {
      expect(dashboard).toContain(`label: "${label}"`);
    }
    for (const legacyNav of ["Strict policies", "İç kategoriler", "Autonomy Studio", "Practice Lab", "Meta bağlantısı", "Orchestrator Agent", "Teslimat alarmları", "Gönderi öne çıkarma", "Timeline"]) {
      expect(dashboard).not.toContain(`label: "${legacyNav}", icon:`);
    }
    expect(normalizeDashboardLocation("strict-policies")).toMatchObject({ view: "manage", manageArea: "rules", rulesArea: "policies" });
    expect(normalizeDashboardLocation("autonomy")).toMatchObject({ view: "manage", manageArea: "rules", rulesArea: "authority" });
    expect(normalizeDashboardLocation("practice-lab")).toMatchObject({ view: "manage", manageArea: "rules", rulesArea: "learning" });
    expect(normalizeDashboardLocation("categories")).toMatchObject({ view: "manage", manageArea: "settings", settingsArea: "categories" });
    expect(normalizeDashboardLocation("promotions")).toMatchObject({ view: "manage", manageArea: "portfolio", campaignArea: "promotion" });
    expect(normalizeDashboardLocation("timeline")).toMatchObject({ view: "manage", manageArea: "portfolio", campaignArea: "timeline" });
    expect(normalizeDashboardLocation("agent")).toMatchObject({ view: "agent" });
  });

  it("keeps session recovery inside each operational context without seeded frontend budgets", () => {
    for (const surface of [budgetLab, approvalQueue, autonomyStudio]) {
      expect(surface).toContain('import { LocalSessionConnector } from "./local-session-connector"');
      expect(surface).toContain("<LocalSessionConnector");
      expect(surface).not.toContain("Decision Room’da oturumu bağla");
    }
    expect(budgetPools).toContain("const emptyNodes");
    expect(budgetPools).not.toContain('hardCapDecimal: "500000"');
    expect(budgetPools).not.toContain('poolRef: "budget_pool_domestic"');
  });

  it("opens the real recommendation-only pool workspace from the approved budget route", () => {
    expect(dashboard).toContain('import { BudgetPoolHierarchyPanel } from "./budget-pool-hierarchy-panel"');
    expect(dashboard).toContain('if (budgetArea === "pools") return <BudgetPoolHierarchyPanel />');
    expect(dashboard).not.toContain("Bütçe havuzları Faz 1’de gizlidir");
    expect(budgetPools).toContain('import { LocalSessionConnector } from "./local-session-connector"');
    expect(budgetPools).toContain('"session_required"');
  });
});
