import { describe, expect, it } from "vitest";
import { CORE_SKILL_MANIFESTS, CLOSED_SKILL_AUTHORITY, MAX_ACTIVE_PLAYBOOKS, MAX_PLAYBOOK_GUIDANCE_BYTES, WorkspaceSkillCatalogBindingError, createWorkspaceSkillCatalogBinding, defaultSkillCatalogBinding } from "@/domain/orchestrator/skill-catalog";

describe("release-owned Skill Catalog Paket 1", () => {
  const citation = { sourceTitle: "Meta yardım", sourceType: "official_meta_guidance" as const,
    sourceUrl: "https://www.facebook.com/business/help/learning", freshness: "fresh" as const };
  it("ships exactly nine immutable, citation-bound read-only manifests", () => {
    expect(CORE_SKILL_MANIFESTS).toHaveLength(9);
    for (const manifest of CORE_SKILL_MANIFESTS) {
      expect(manifest.citationRequired).toBe(true);
      expect(manifest.allowedDraftTools).toEqual([]);
      expect(manifest.negativeCapabilities).toEqual(expect.arrayContaining([
        "persist", "create_rule", "draft_policy", "alter_scope", "publish", "approve", "execute", "meta_write",
      ]));
      expect(manifest.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("keeps RuleCoach and ActionReadinessExplainer out of rule/action production", () => {
    expect(CORE_SKILL_MANIFESTS.find((item) => item.ref === "rule_coach")?.outputContract).toBe("evidence-matrix-only");
    expect(CORE_SKILL_MANIFESTS.find((item) => item.ref === "action_readiness_explainer")?.outputContract).toBe("risk-dependency-only");
    expect(Object.values(CLOSED_SKILL_AUTHORITY)).toEqual(Array.from({ length: 8 }, () => false));
  });

  it("binds every turn to an exact profile and all release manifest hashes", () => {
    const binding = defaultSkillCatalogBinding();
    expect(binding.bindingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.profile.profileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.manifests).toHaveLength(9);
  });

  it("freezes only a current official source citation and rejects stale or unallowed URLs", () => {
    const base = { profile: { profileRef: "profile_default", revision: 1, profileHash: "a".repeat(64) },
      manifests: CORE_SKILL_MANIFESTS.map(({ ref, version, hash }) => ({ ref, version, hash })) };
    const playbook = { playbookRef: "playbook_alpha", revision: 1, playbookHash: "b".repeat(64), sourceRef: "source_guidance",
      citation: { sourceTitle: "Meta yardım", sourceType: "official_meta_guidance" as const,
        sourceUrl: "https://www.facebook.com/business/help/learning", freshness: "fresh" as const }, title: "Not", body: "Kanıt" };
    const fresh = createWorkspaceSkillCatalogBinding({ ...base, playbooks: [playbook] });
    expect(fresh.playbooks[0]?.citation).toEqual(playbook.citation);
    expect(() => createWorkspaceSkillCatalogBinding({ ...base, playbooks: [{ ...playbook,
      citation: { ...playbook.citation, freshness: "not_scheduled" as const } }] })).toThrow(WorkspaceSkillCatalogBindingError);
    expect(() => createWorkspaceSkillCatalogBinding({ ...base, playbooks: [{ ...playbook,
      citation: { ...playbook.citation, sourceUrl: "https://example.test/not-allowed" } }] })).toThrow(WorkspaceSkillCatalogBindingError);
  });

  it("bounds user-authored working guidance before it can enter a model prompt", () => {
    const base = { profile: { profileRef: "profile_default", revision: 1, profileHash: "a".repeat(64) },
      manifests: CORE_SKILL_MANIFESTS.map(({ ref, version, hash }) => ({ ref, version, hash })) };
    expect(() => createWorkspaceSkillCatalogBinding({ ...base, playbooks: Array.from({ length: MAX_ACTIVE_PLAYBOOKS + 1 }, (_, index) => ({
      playbookRef: `playbook_${index}`, revision: 1, playbookHash: "b".repeat(64), sourceRef: "source_guidance", citation, title: "Not", body: "Kanıt" })) })).toThrow(WorkspaceSkillCatalogBindingError);
    expect(() => createWorkspaceSkillCatalogBinding({ ...base, playbooks: [{ playbookRef: "playbook_alpha", revision: 1,
      playbookHash: "b".repeat(64), sourceRef: "source_guidance", citation, title: "Not", body: "x".repeat(MAX_PLAYBOOK_GUIDANCE_BYTES) }] })).toThrow(WorkspaceSkillCatalogBindingError);
  });
});
