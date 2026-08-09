import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { GuidanceFacetScopeError } from "@/application/guidance-facet-scope-resolver";
import {
  DrizzleGuidanceFacetScopeResolver,
  guidanceFacetPublicRef,
} from "@/connectors/guidance/guidance-facet-scope-drizzle-resolver";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const foreignWorkspaceId = "99999999-9999-4999-8999-999999999999";
const capturedAt = "2026-08-10T08:00:00.000Z";
const accountId = "22222222-2222-4222-8222-222222222222";
const campaignId = "33333333-3333-4333-8333-333333333333";
const objectiveRowId = "44444444-4444-4444-8444-444444444444";
const optimizationRowId = "55555555-5555-4555-8555-555555555555";
const categoryId = "66666666-6666-4666-8666-666666666666";
const lifecycleId = "77777777-7777-4777-8777-777777777777";
const topicId = "88888888-8888-4888-8888-888888888888";
const templateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function row(overrides: Record<string, unknown>) {
  return { captured_at: capturedAt, facet: "_capture", internal_id: "00000000-0000-4000-8000-000000000000",
    canonical_value: "capture_ref", label: "capture", account_id: null, entity_type: null,
    dimension_key: null, definition_key: null, ...overrides };
}

function sourceRows() {
  return [
    row({}),
    row({ facet: "account", internal_id: accountId, canonical_value: `account_${accountId}`,
      label: "Main account", account_id: accountId }),
    row({ facet: "objective", internal_id: objectiveRowId, canonical_value: "lead_generation",
      label: "OUTCOME_LEADS", account_id: accountId }),
    row({ facet: "optimization", internal_id: optimizationRowId, canonical_value: "LEAD",
      label: "LEAD", account_id: accountId }),
    row({ facet: "internal_category", internal_id: categoryId, canonical_value: "consideration",
      label: "Consideration", dimension_key: "funnel_intent", definition_key: "consideration" }),
    row({ facet: "funnel", internal_id: categoryId, canonical_value: "consideration",
      label: "Consideration", dimension_key: "funnel_intent", definition_key: "consideration" }),
    row({ facet: "internal_category", internal_id: lifecycleId, canonical_value: "evergreen",
      label: "Evergreen", dimension_key: "lifecycle", definition_key: "evergreen" }),
    row({ facet: "lifecycle", internal_id: lifecycleId, canonical_value: "evergreen",
      label: "Evergreen", dimension_key: "lifecycle", definition_key: "evergreen" }),
    row({ facet: "entity", internal_id: campaignId, canonical_value: `campaign_${campaignId}`,
      label: "Lead campaign", account_id: accountId, entity_type: "campaign" }),
    row({ facet: "promotion_template", internal_id: templateId, canonical_value: "promotion_template_lead",
      label: "promotion_template_lead", account_id: accountId }),
    row({ facet: "topic", internal_id: topicId, canonical_value: "budget", label: "budget" }),
  ];
}

describe("DrizzleGuidanceFacetScopeResolver", () => {
  it("resolves opaque refs to canonical values from one bounded tenant capture", async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: sourceRows() }));
    const resolver = new DrizzleGuidanceFacetScopeResolver({ execute } as never);
    const accountRef = promotionRegistryPublicRef("account", workspaceId, accountId);
    const listed = await resolver.listCatalog(workspaceId); execute.mockClear();
    const result = await resolver.resolve(workspaceId, {
      expectedCatalogHash: listed.catalogHash, accountRef, accountGroupRefs: [],
      objective: guidanceFacetPublicRef("objective", workspaceId, "lead_generation"),
      funnel: categoryDefinitionPublicRef("funnel_intent", "consideration"),
      optimization: guidanceFacetPublicRef("optimization", workspaceId, "LEAD"),
      internalCategoryRefs: [categoryDefinitionPublicRef("funnel_intent", "consideration")],
      lifecycle: categoryDefinitionPublicRef("lifecycle", "evergreen"),
      entity: { type: "campaign", ref: promotionRegistryPublicRef("campaign", workspaceId, campaignId) },
      promotionTemplateRefs: ["promotion_template_lead"],
      topics: [guidanceFacetPublicRef("topic", workspaceId, "budget")],
      requiredTopics: [guidanceFacetPublicRef("topic", workspaceId, "budget")],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never).sql;
    expect(query).toMatch(/with capture as \(select transaction_timestamp\(\) as captured_at\)/i);
    expect(query).toMatch(/select captured_at, '_capture' as facet[\s\S]+union all/i);
    expect(query).toContain("campaign.objective_mapping_version =");
    expect(query).toMatch(/from guidance_bindings binding[\s\S]+binding\.facet = 'topic'[\s\S]+newer_binding/i);
    expect(result).toMatchObject({ accountRef, objective: "lead_generation", funnel: "consideration",
      optimization: "LEAD", lifecycle: "evergreen", promotionTemplateRefs: ["promotion_template_lead"],
      topics: ["budget"], requiredTopics: ["budget"], capture: { capturedAt } });
    expect(result.internalCategoryRefs).toEqual([categoryDefinitionPublicRef("funnel_intent", "consideration")]);
    expect(result.capture.catalogHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps account-group explicitly unavailable and rejects stale/cross-tenant refs", async () => {
    const resolver = new DrizzleGuidanceFacetScopeResolver({ execute: vi.fn(async () => ({ rows: sourceRows() })) } as never);
    const catalog = await resolver.listCatalog(workspaceId);
    expect(catalog.facets.find((item) => item.facet === "account_group")).toEqual({ facet: "account_group",
      status: "partial", reasonCode: "account_group_catalog_unavailable", options: [] });
    const selection = { expectedCatalogHash: catalog.catalogHash,
      accountRef: promotionRegistryPublicRef("account", workspaceId, accountId),
      accountGroupRefs: [], objective: null, funnel: null, optimization: null, internalCategoryRefs: [],
      lifecycle: null, entity: null, promotionTemplateRefs: [], topics: [], requiredTopics: [] } as const;
    await expect(resolver.resolve(workspaceId, { ...selection,
      accountRef: promotionRegistryPublicRef("account", foreignWorkspaceId, accountId) }))
      .rejects.toMatchObject({ code: "unknown_scope_ref" });
    await expect(resolver.resolve(workspaceId, { ...selection, accountGroupRefs: ["account_group_missing"] }))
      .rejects.toMatchObject({ code: "catalog_unavailable" });
    await expect(resolver.resolve(workspaceId, { ...selection,
      internalCategoryRefs: [categoryDefinitionPublicRef("lifecycle", "archived")] }))
      .rejects.toMatchObject({ code: "unknown_scope_ref" });
  });

  it("rejects a public ref that maps to two authoritative promotion revisions as ambiguous", async () => {
    const rows = sourceRows();
    rows.push(row({ facet: "promotion_template", internal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      canonical_value: "promotion_template_lead", label: "promotion_template_lead", account_id: accountId }));
    const resolver = new DrizzleGuidanceFacetScopeResolver({ execute: vi.fn(async () => ({ rows })) } as never);
    const catalog = await resolver.listCatalog(workspaceId);
    await expect(resolver.resolve(workspaceId, {
      expectedCatalogHash: catalog.catalogHash,
      accountRef: promotionRegistryPublicRef("account", workspaceId, accountId), accountGroupRefs: [],
      objective: null, funnel: null, optimization: null, internalCategoryRefs: [], lifecycle: null, entity: null,
      promotionTemplateRefs: ["promotion_template_lead"], topics: [], requiredTopics: [],
    })).rejects.toMatchObject({ code: "ambiguous_scope_ref" });
  });

  it("uses canonical objective identity while raw Meta objective is only a label", async () => {
    const resolver = new DrizzleGuidanceFacetScopeResolver({ execute: vi.fn(async () => ({ rows: sourceRows() })) } as never);
    const catalog = await resolver.listCatalog(workspaceId);
    const option = catalog.facets.find((item) => item.facet === "objective")?.options[0];
    expect(catalog.evidence.objectiveMappingVersion).toBe("meta-objective-mapping/1.0.0");
    expect(option).toMatchObject({ ref: guidanceFacetPublicRef("objective", workspaceId, "lead_generation"),
      label: "OUTCOME_LEADS" });
    expect(option?.ref).not.toBe(guidanceFacetPublicRef("objective", workspaceId, "OUTCOME_LEADS"));
  });

  it("keeps the content hash stable across capture times and rejects changed catalog content", async () => {
    const firstRows = sourceRows();
    const laterRows = sourceRows().map((value) => ({ ...value, captured_at: "2026-08-10T09:00:00.000Z" }));
    const changedRows = [...laterRows, row({ captured_at: "2026-08-10T09:00:00.000Z", facet: "topic",
      internal_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", canonical_value: "testing", label: "testing" })];
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: firstRows })
      .mockResolvedValueOnce({ rows: laterRows })
      .mockResolvedValueOnce({ rows: changedRows });
    const resolver = new DrizzleGuidanceFacetScopeResolver({ execute } as never);
    const first = await resolver.listCatalog(workspaceId);
    const later = await resolver.listCatalog(workspaceId);
    expect(later.catalogHash).toBe(first.catalogHash);
    expect(later.capturedAt).not.toBe(first.capturedAt);
    await expect(resolver.resolve(workspaceId, { expectedCatalogHash: first.catalogHash,
      accountRef: promotionRegistryPublicRef("account", workspaceId, accountId), accountGroupRefs: [],
      objective: null, funnel: null, optimization: null, internalCategoryRefs: [], lifecycle: null,
      entity: null, promotionTemplateRefs: [], topics: [], requiredTopics: [] }))
      .rejects.toMatchObject({ code: "stale_catalog" });
  });

  it("preserves the real SQL capture boundary for an empty tenant catalog", async () => {
    const resolver = new DrizzleGuidanceFacetScopeResolver({ execute: vi.fn(async () => ({ rows: [row({})] })) } as never);
    const catalog = await resolver.listCatalog(workspaceId);
    expect(catalog.capturedAt).toBe(capturedAt);
    expect(catalog.capturedAt).not.toBe("1970-01-01T00:00:00.000Z");
    expect(catalog.facets.find((item) => item.facet === "account")?.options).toEqual([]);
  });

  it("classifies malformed source rows as unsafe without leaking source material", async () => {
    const resolver = new DrizzleGuidanceFacetScopeResolver({ execute: vi.fn(async () => ({ rows: [row({}),
      row({ facet: "account", internal_id: "not-a-uuid", canonical_value: "account_bad", label: "bad" })] })) } as never);
    await expect(resolver.listCatalog(workspaceId)).rejects.toBeInstanceOf(GuidanceFacetScopeError);
  });
});
