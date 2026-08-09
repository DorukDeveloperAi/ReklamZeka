import { describe, expect, it } from "vitest";

import {
  OBJECTIVE_PLAYBOOKS,
  OBJECTIVE_PLAYBOOK_VERSION,
} from "@/analyses/objective-playbooks";
import { CAMPAIGN_OBJECTIVES } from "@/analyses/schema";
import { createCategoryProfile } from "@/domain/categories/category-profile";
import {
  STARTER_CATEGORY_PLAYBOOK_CATALOG,
  STARTER_CATEGORY_PLAYBOOK_CATALOG_HASH,
  resolveStarterCategoryProfile,
} from "@/domain/categories/starter-playbook-catalog";

describe("starter objective/internal-category playbook catalog", () => {
  it("references the six existing objective playbooks by exact version and stable hash without copying them", () => {
    expect(STARTER_CATEGORY_PLAYBOOK_CATALOG.objectivePlaybooks.map((entry) => entry.objective))
      .toEqual(CAMPAIGN_OBJECTIVES);
    for (const entry of STARTER_CATEGORY_PLAYBOOK_CATALOG.objectivePlaybooks) {
      expect(entry).toEqual({
        objective: entry.objective,
        playbookRef: expect.stringMatching(`^analysis_playbook_objective_${entry.objective}_[a-f0-9]{16}$`),
        playbookVersion: OBJECTIVE_PLAYBOOK_VERSION,
        playbookHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(entry).not.toHaveProperty("primaryMetrics");
      expect(entry).not.toHaveProperty("decisionGuide");
      expect(OBJECTIVE_PLAYBOOKS[entry.objective].version).toBe(entry.playbookVersion);
      expect(entry.playbookRef).toBe(
        `analysis_playbook_objective_${entry.objective}_${entry.playbookHash.slice(0, 16)}`,
      );
    }
    expect(STARTER_CATEGORY_PLAYBOOK_CATALOG.catalogHash).toBe(STARTER_CATEGORY_PLAYBOOK_CATALOG_HASH);
    expect(STARTER_CATEGORY_PLAYBOOK_CATALOG_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates)).toBe(true);
  });

  it("covers the canonical starter examples while keeping owner-defined values explicit", () => {
    expect(STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates.map((template) => template.templateRef)).toEqual([
      "starter_category_template_audience_strategy_prospecting",
      "starter_category_template_audience_strategy_retargeting",
      "starter_category_template_campaign_role_promotion",
      "starter_category_template_campaign_role_evergreen",
      "starter_category_template_geo_market_owner_defined",
      "starter_category_template_language_owner_defined",
      "starter_category_template_destination_lead_form",
      "starter_category_template_destination_whatsapp",
      "starter_category_template_funnel_intent_sales",
      "starter_category_template_protection_class_protected_budget",
    ]);
    expect(STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates
      .filter((template) => template.kind === "owner_defined_value")
      .map((template) => template.dimensionKey)).toEqual(["geo_market", "language"]);
    expect(STARTER_CATEGORY_PLAYBOOK_CATALOG).toMatchObject({
      catalogStatus: "reviewed_bootstrap_proposal",
      seedPolicy: "never_auto_seed",
      ownerConfirmationRequired: true,
      authority: {
        canPersist: false,
        canPublish: false,
        canAuthorizeAction: false,
        canExecuteWrite: false,
        canWriteMeta: false,
        canGrantApproval: false,
        canCreatePolicy: false,
        canCallTool: false,
        canAccessNetwork: false,
        canQuerySql: false,
      },
    });
  });

  it.each(CAMPAIGN_OBJECTIVES)("resolves %s only to an owner-review-required CategoryProfile draft shape", (objective) => {
    const first = resolveStarterCategoryProfile({
      objective,
      categoryTemplateRef: "starter_category_template_audience_strategy_prospecting",
    });
    const second = resolveStarterCategoryProfile({
      objective,
      categoryTemplateRef: "starter_category_template_audience_strategy_prospecting",
    });
    expect(first).toEqual(second);
    expect(first.status).toBe("review_required");
    if (first.status !== "review_required") throw new Error("starter proposal unexpectedly blocked");
    expect(first.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.profileTemplate.bindings.analysisPlaybookRefs).toEqual([first.objectivePlaybook.playbookRef]);
    expect(first.profileTemplate.bindings).toMatchObject({
      ruleInstructionBundleRefs: [],
      budgetPolicyRefs: [],
      transferPolicyRefs: [],
      schedulePolicyRefs: [],
      actionPolicyRefs: [],
      creativePolicyRefs: [],
    });
    expect(first).toMatchObject({ ownerConfirmationRequired: true, persistenceAdapterRequired: true,
      authority: { canPersist: false, canPublish: false, canAuthorizeAction: false, canExecuteWrite: false,
        canWriteMeta: false, canGrantApproval: false, canCreatePolicy: false, canCallTool: false,
        canAccessNetwork: false, canQuerySql: false } });

    // The proposal is structurally compatible, but tenant/owner identities are deliberately
    // absent until a separate authoring lifecycle receives explicit confirmation.
    expect(createCategoryProfile({
      workspaceRef: "workspace_test",
      profileRef: "category_profile_starter_test",
      categoryRef: first.profileTemplate.categoryRef,
      parentCategoryRef: first.profileTemplate.parentCategoryRef,
      label: first.profileTemplate.label,
      description: first.profileTemplate.description,
      color: first.profileTemplate.color,
      ownerRef: "actor_owner_test",
      status: first.profileTemplate.status,
      bindings: first.profileTemplate.bindings,
    }).bindings.analysisPlaybookRefs).toEqual([first.objectivePlaybook.playbookRef]);
  });

  it("fails closed for unknown objectives/categories and owner-specific category meaning", () => {
    expect(resolveStarterCategoryProfile({ objective: "unknown",
      categoryTemplateRef: "starter_category_template_audience_strategy_prospecting" }))
      .toMatchObject({ status: "blocked", reasonCode: "unknown_objective", ownerConfirmationRequired: true });
    expect(resolveStarterCategoryProfile({ objective: "sales", categoryTemplateRef: "starter_category_template_unknown" }))
      .toMatchObject({ status: "blocked", reasonCode: "unknown_category", ownerConfirmationRequired: true });
    expect(resolveStarterCategoryProfile({ objective: "sales",
      categoryTemplateRef: "starter_category_template_geo_market_owner_defined" }))
      .toMatchObject({ status: "blocked", reasonCode: "owner_configuration_required" });
    expect(resolveStarterCategoryProfile({ objective: "sales",
      categoryTemplateRef: "starter_category_template_protection_class_protected_budget" }))
      .toMatchObject({ status: "blocked", reasonCode: "owner_configuration_required" });
  });

  it("does not invent targeting, executable policy, approval or Meta/tool authority", () => {
    const serialized = JSON.stringify(STARTER_CATEGORY_PLAYBOOK_CATALOG);
    expect(serialized).not.toMatch(/"targeting"|audiencePreset|metaAccessToken|bearer|secret/i);
    expect(serialized).not.toMatch(/"(?:rules|selector|policyClause|approvalGrant)":/i);
    for (const template of STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates) {
      expect(template).not.toHaveProperty("selector");
      expect(template).not.toHaveProperty("rules");
      expect(template).not.toHaveProperty("policy");
    }
  });
});
