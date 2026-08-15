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
});
