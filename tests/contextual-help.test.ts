import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ContextualHelp", () => {
  it("offers transient and pinned, keyboard-accessible terminology help", () => {
    const source = readFileSync("src/app/dashboard/contextual-help.tsx", "utf8");
    expect(source).toContain('role="tooltip"');
    expect(source).toContain("onContextMenu");
    expect(source).toContain('event.key === "Enter"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("aria-describedby");
  });

  it("puts clear operational definitions next to the rule workflow", () => {
    const dashboard = readFileSync("src/app/dashboard/operating-dashboard.tsx", "utf8");
    expect(dashboard).toContain('aria-label="Kurallar alanı kavram yardımı"');
    expect(dashboard).toContain('term="Kullanıcı kuralı"');
    expect(dashboard).toContain('term="İnsan onayı"');
  });

  it("gives every management area a short, operationally scoped explanation", () => {
    const dashboard = readFileSync("src/app/dashboard/operating-dashboard.tsx", "utf8");
    expect(dashboard).toContain("function ManagementFlowGuide");
    expect(dashboard).toContain('props.area === "portfolio"');
    expect(dashboard).toContain('props.area === "decisions"');
    expect(dashboard).toContain('props.area === "rules"');
    expect(dashboard).toContain('<ManagementFlowGuide area={manageArea} />');
  });

  it("keeps the slice workspace divided into a readable four-step operation", () => {
    const workspace = readFileSync("src/app/dashboard/slice-rule-workspace-panel.tsx", "utf8");
    expect(workspace).toContain('aria-label="Kural çalışma sırası"');
    expect(workspace).toContain("Kanıtlı slice’ı seçin.");
    expect(workspace).toContain("Aynı pazar bütçe sınırını bağlayın.");
    expect(workspace).toContain("SADECE ÖNERİ · UYGULAMA YETKİSİ YOK");
  });
});
