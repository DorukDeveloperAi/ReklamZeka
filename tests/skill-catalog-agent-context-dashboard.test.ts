import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { skillCatalogContextFromResponse, skillCatalogLoadState } from "@/app/dashboard/operating-dashboard";
import { SkillCatalogContextStrip } from "@/app/dashboard/skill-catalog-context-strip";

const safeProjection = {
  contractVersion: "skill-catalog-ui/1.0.0",
  activeProfile: { kind: "profile", ref: "profile_private", revision: 4, state: "active" },
  playbooks: [{ kind: "playbook", ref: "playbook_private", revision: 2, state: "active", title: "Görünmemeli", url: "https://example.test/source", freshness: "current" }],
  skills: [{ ref: "rule_coach", name: "RuleCoach", version: "1.0.0", lifecycle: "released", citationRequired: true, negativeCapabilities: ["create_rule"] }],
  authority: {
    canSelectProfile: true, canCreatePlaybookRevision: true, canTombstonePlaybook: true,
    canPersist: false, canCreateRule: false, canDraftPolicy: false, canAlterScope: false,
    canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false,
  },
} as const;

describe("Agent skill catalog context strip", () => {
  it("maps only safe GET projection fields and drops IDs, playbooks, and authority controls", () => {
    const context = skillCatalogContextFromResponse(safeProjection);
    expect(context).toEqual({ profileLabel: "Aktif skill profili · revizyon 4", skills: [{ name: "RuleCoach", version: "1.0.0" }] });
    expect(JSON.stringify(context)).not.toMatch(/profile_private|playbook_private|Görünmemeli|example\.test|canSelectProfile/);
  });

  it("fails closed for an unrecorded legacy turn or a projection carrying a raw body", () => {
    expect(skillCatalogContextFromResponse({ ...safeProjection, activeProfile: null })).toMatchObject({ legacy: true, skills: [] });
    expect(skillCatalogContextFromResponse({ ...safeProjection, activeProfile: { ...safeProjection.activeProfile, body: "raw prompt" } })).toBeNull();
  });

  it("keeps session and unavailable catalog states out of the strip", () => {
    expect(skillCatalogLoadState(401, { error: { code: "local_session_required" } })).toBe("session_required");
    expect(skillCatalogLoadState(503, { error: { code: "source_not_configured" } })).toBe("unavailable");
    expect(skillCatalogLoadState(200, { ...safeProjection, activeProfile: null })).toBe("legacy");
    expect(skillCatalogLoadState(200, { skills: [] })).toBe("unavailable");
  });

  it("uses no catalog mutation control in the Agent surface", () => {
    const source = readFileSync("src/app/dashboard/operating-dashboard.tsx", "utf8");
    const catalogSlice = source.slice(source.indexOf("const refreshSkillCatalog"), source.indexOf("const verifyOrchestratorWorkspace"));
    expect(catalogSlice).toContain('method: "GET"');
    expect(catalogSlice).toContain('"X-ReklamZeka-Intent": "skill-catalog-agent-read"');
    expect(catalogSlice).not.toContain("POST");
    expect(catalogSlice).not.toMatch(/skill-profile-select|skill-playbook|tombstone/);
  });

  it("explains an unselected profile as setup work rather than a technical snapshot error", () => {
    const source = readFileSync("src/app/dashboard/skill-catalog-context-strip.tsx", "utf8");
    expect(source).toContain("Henüz çalışma alanına ait bir skill profili seçilmedi.");
    expect(source).toContain("Agent kural veya policy üretmez.");
    expect(source).not.toContain("Skill snapshot not recorded.");
  });

  it("offers navigation to user-owned skill setup without selecting a profile from Agent", () => {
    const html = renderToStaticMarkup(createElement(SkillCatalogContextStrip, {
      context: { profileLabel: "", skills: [], legacy: true }, onOpenSetup: () => undefined,
    }));
    expect(html).toContain("Skill çalışma dilini aç");
    expect(readFileSync("src/app/dashboard/operating-dashboard.tsx", "utf8")).toContain("function openSkillSetup()");
    expect(readFileSync("src/app/dashboard/skill-catalog-context-strip.tsx", "utf8")).toContain("Navigation only: profile selection stays an explicit action");
  });
});
