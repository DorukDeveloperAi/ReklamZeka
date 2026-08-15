import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/app/dashboard/skill-catalog-panel.tsx", "utf8");
const dashboard = readFileSync("src/app/dashboard/operating-dashboard.tsx", "utf8");

describe("SkillCatalogPanel Yönet → Kurallar surface", () => {
  it("uses the local-session GET projection and only explicit user mutation intents", () => {
    expect(panel).toContain('"X-ReklamZeka-Intent": "skill-catalog-read"');
    expect(panel).toContain('"skill-profile-select"');
    expect(panel).toContain('"skill-playbook-create"');
    expect(panel).toContain('"skill-playbook-revise"');
    expect(panel).toContain('"skill-playbook-tombstone"');
    expect(panel).toContain('credentials: "same-origin"');
    expect(panel).toContain('method: "POST"');
    expect(panel).toContain("const refreshed = await reload()");
    expect(panel).toContain("SOURCE_REF");
    expect(panel).toContain("Yalnız mevcut GuidanceSource referansı kabul edilir");
  });

  it("keeps profile, create, and tombstone changes explicitly user initiated", () => {
    expect(panel).toContain('onClick={() => void selectProfile()}');
    expect(panel).toContain('onSubmit={(event) => void createPlaybook(event)}');
    expect(panel).toContain('onClick={() => setPendingTombstone(playbook)}');
    expect(panel).toContain("startRevision(playbook)");
    expect(panel).toContain('role="alertdialog"');
    expect(panel).toContain("Kaldırmayı onayla");
    expect(panel).toContain("Yeni revizyonu kaydet");
    expect(panel).toContain("Kaydetmeyi onayla");
    expect(panel).toContain("catalog.activeProfile ? \"Etkin\"");
  });

  it("does not introduce structured rule, policy, scope, action, or Meta-write authoring", () => {
    for (const forbidden of [
      'name="rule"', 'name="policy"', 'name="scope"', 'name="action"',
    ]) expect(panel, forbidden).not.toContain(forbidden);
    expect(panel).toContain("Playbook metni");
    expect(panel).toContain("Yayınlanmış kaynak referansı");
  });

  it("explains where each user-owned working-language item is used without widening Agent authority", () => {
    expect(panel).toContain("Çalışma dili kullanım özeti");
    expect(panel).toContain("Her turn’de sunucu seçer");
    expect(panel).toContain("makbuzda kaynak tazeliği görünür");
    expect(panel).toContain("kural veya policy metni değildir");
  });

  it("mounts only in Yönet → Kurallar after the shared session gate is ready", () => {
    expect(dashboard).toContain('import { SkillCatalogPanel } from "./skill-catalog-panel"');
    expect(dashboard).toContain('<SkillCatalogPanel onSessionRequiredChange={setRulesSessionRequired} />');
    const rulesSlice = dashboard.slice(dashboard.indexOf("function renderRules"), dashboard.indexOf("function renderSettings"));
    expect(rulesSlice).toContain("rulesSessionRequired === false");
    const agentSlice = dashboard.slice(dashboard.indexOf("function renderAgent"), dashboard.indexOf("function renderBudgets"));
    expect(agentSlice).not.toContain("SkillCatalogPanel");
    expect(agentSlice).not.toContain("skill-playbook-create");
    expect(agentSlice).not.toContain("skill-profile-select");
  });
});
