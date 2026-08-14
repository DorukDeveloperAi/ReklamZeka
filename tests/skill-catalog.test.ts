import { describe, expect, it } from "vitest";
import { CORE_SKILL_MANIFESTS, CLOSED_SKILL_AUTHORITY, defaultSkillCatalogBinding } from "@/domain/orchestrator/skill-catalog";

describe("release-owned Skill Catalog Paket 1", () => {
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
});
