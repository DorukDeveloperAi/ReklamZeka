import { describe, expect, it } from "vitest";
import {
  buildMetaCampaignSelectorFacts,
  CATEGORY_SELECTOR_PREVIEW_VERSION,
  CategorySelectorContractError,
  previewCategorySelector,
  type CategorySelectorDefinition,
  type CategorySelectorFacts,
} from "@/domain/categories/category-selector-preview";
import {
  META_INVENTORY_FIELD_CATALOG_VERSION,
  parseMetaInventoryPage,
} from "@/connectors/meta/sync/inventory-materialization";
import { normalizeMetaCampaignObjective } from "@/domain/meta/objective-mapping";

const selector: CategorySelectorDefinition = {
  version: CATEGORY_SELECTOR_PREVIEW_VERSION,
  selectorRef: "selector:lead-tr",
  proposedCategoryRef: "category:lead-generation",
  evidence: {
    kind: "reviewed_selector_mapping",
    ref: "mapping:lead-tr:1",
    reviewedAt: "2026-08-09T00:00:00.000Z",
    reviewedByRef: "user:reviewer",
  },
  confidenceBasisPoints: 9300,
  accountRefs: ["act_100"],
  platforms: ["meta_ads"],
  namePattern: { operator: "contains", value: "lead", caseSensitive: false },
  objectives: ["lead_generation"],
  optimizationGoals: ["LEAD_GENERATION"],
  geoRefs: ["TR"],
  languages: ["tr"],
  budgetModels: ["campaign"],
  statuses: ["ACTIVE"],
  creativeAttributes: [{ attribute: "format", values: ["video"] }],
  entityIds: [{ level: "campaign", ids: ["campaign_1"] }],
};

const facts: CategorySelectorFacts = {
  accountRef: { status: "known", value: "act_100" },
  platform: { status: "known", value: "meta_ads" },
  name: { status: "known", value: "Lead Campaign" },
  objective: normalizeMetaCampaignObjective("OUTCOME_LEADS"),
  optimizationGoal: { status: "known", value: "LEAD_GENERATION" },
  geoRefs: { status: "known", value: ["TR"] },
  languages: { status: "known", value: ["tr"] },
  budgetModel: { status: "known", value: "campaign" },
  status: { status: "known", value: "ACTIVE" },
  creativeAttributes: { status: "known", value: { format: ["video"] } },
  entityIds: { status: "known", value: [{ level: "campaign", id: "campaign_1" }] },
};

describe("strict category selector preview", () => {
  it("returns a deterministic matched proposal and no mutation, policy, or action authority", () => {
    const first = previewCategorySelector(selector, facts);
    const second = previewCategorySelector(structuredClone(selector), structuredClone(facts));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "matched",
      proposedCategoryRef: "category:lead-generation",
      evidence: { kind: "reviewed_selector_mapping", ref: "mapping:lead-tr:1" },
      confidence: 0.93,
      authority: {
        categoryMutation: false,
        categoryAssignment: false,
        policyMutation: false,
        actionExecution: false,
      },
    });
    expect(first.reasonTrace.map((entry) => entry.criterion)).toEqual([
      "account", "platform", "name_pattern", "objective", "optimization", "geo", "language",
      "budget_model", "status", "creative_attribute", "entity_id",
    ]);
    expect(first.reasonTrace.every((entry) => entry.outcome === "matched")).toBe(true);
  });

  it("makes a definite mismatch win over missing evidence and otherwise returns uncertain", () => {
    const missingGeo = { ...facts, geoRefs: { status: "unknown", reason: "not_observed" } as const };
    expect(previewCategorySelector(selector, missingGeo).status).toBe("uncertain");
    expect(previewCategorySelector(selector, {
      ...missingGeo,
      status: { status: "known", value: "PAUSED" },
    }).status).toBe("not_matched");
  });

  it("rejects extra fields, regex-like patterns, and authority-bearing empty selectors", () => {
    expect(() => previewCategorySelector({ ...selector, unexpected: true } as CategorySelectorDefinition, facts))
      .toThrow(CategorySelectorContractError);
    expect(() => previewCategorySelector({
      ...selector,
      namePattern: { operator: "contains", value: "", caseSensitive: false },
    }, facts)).toThrow(CategorySelectorContractError);
    expect(() => previewCategorySelector({
      ...selector,
      accountRefs: [], platforms: [], namePattern: null, objectives: [], optimizationGoals: [], geoRefs: [],
      languages: [], budgetModels: [], statuses: [], creativeAttributes: [], entityIds: [],
    }, facts)).toThrow(CategorySelectorContractError);
  });

  it("connects a raw campaign fixture to reviewed canonical objective and a read-only preview", () => {
    const page = parseMetaInventoryPage({
      workspaceId: "workspace_test",
      connectionId: "connection_test",
      externalAccountId: "act_100",
      parentRunId: "run_test",
      sliceId: "inventory:act_100:campaign:all:all",
      cursorId: "a".repeat(64),
      entityLevel: "campaign",
      observedAt: "2026-08-09T12:00:00.000Z",
      sourceGraphVersion: "v23.0",
      fieldCatalogVersion: META_INVENTORY_FIELD_CATALOG_VERSION,
      terminal: true,
      records: [{
        id: "campaign_1", name: "Lead Campaign", status: "ACTIVE", effective_status: "ACTIVE",
        objective: "OUTCOME_LEADS", buying_type: "AUCTION", special_ad_categories: [],
        daily_budget: "12000", lifetime_budget: null, updated_time: "2026-08-09T11:30:00Z",
      }],
    });
    const campaign = page.records[0]!;
    if (campaign.level !== "campaign") throw new Error("campaign fixture bekleniyordu");
    expect(campaign).toMatchObject({
      canonicalObjective: "lead_generation",
      legacyObjectiveSource: null,
      objectiveMappingVersion: "meta-objective-mapping/1.0.0",
    });
    const preview = previewCategorySelector({
      ...selector,
      optimizationGoals: [], geoRefs: [], languages: [], creativeAttributes: [],
    }, buildMetaCampaignSelectorFacts({ externalAccountId: page.externalAccountId, campaign }));
    expect(preview.status).toBe("matched");
    expect(preview.authority.actionExecution).toBe(false);
  });
});
