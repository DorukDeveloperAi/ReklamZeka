import { describe, expect, it, vi } from "vitest";
import { GuidanceAgentContract, GUIDANCE_AGENT_TOOLS } from "@/application/guidance-agent-contract";
import { GUIDANCE_FACET_SCOPE_CATALOG_VERSION, type GuidanceFacetScopeResolver } from
  "@/application/guidance-facet-scope-resolver";
import { createGuidanceRegistry } from "@/domain/guidance/registry";
import { MCP_TOOL_SCHEMAS } from "@/mcp/tool-schemas";
import { DrizzleGuidanceFacetScopeResolver, guidanceFacetPublicRef } from
  "@/connectors/guidance/guidance-facet-scope-drizzle-resolver";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111"; const userId = "22222222-2222-4222-8222-222222222222";
const principal = { actor: { userId }, workspaceId, workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
const capturedAt = "2026-08-08T08:00:00.000Z";
const source = (id: string, content: string) => ({ id, workspaceId, sourceType: "owner_statement" as const,
  title: content, sourceRef: `guidance_${id.slice(-24)}`, sourceUrl: null, content, author: "reader_test",
  capturedAt, reviewedAt: null, reviewBy: null, status: "published" as const, version: 1 });
const card = (id: string, sourceId: string, title: string, topic: string) => ({ id, workspaceId,
  sourceType: "owner_statement" as const, sourceIds: [sourceId], title, body: title, rationale: null,
  strength: "should" as const, topic, decisionKey: null, positionKey: null, authority: "guidance_only" as const,
  status: "published" as const, effectiveFrom: capturedAt, effectiveTo: null, ownerRef: "reader_test", version: 1 });
const registry = createGuidanceRegistry({ workspaceId,
  sources: [source("source_aaaaaaaaaaaaaaaaaaaaaaaa", "Genel olarak istikrarlı karar ver."),
    source("source_bbbbbbbbbbbbbbbbbbbbbbbb", "Rolling analizde önce trendi incele.")],
  cards: [card("guidance_aaaaaaaaaaaaaaaaaaaaaaaa", "source_aaaaaaaaaaaaaaaaaaaaaaaa", "İstikrarlı karar", "cadence"),
    card("guidance_bbbbbbbbbbbbbbbbbbbbbbbb", "source_bbbbbbbbbbbbbbbbbbbbbbbb", "Rolling trend", "timeframe:rolling")],
  bindings: [{ id: "binding_aaaaaaaaaaaaaaaaaaaaaaaa", workspaceId, cardId: "guidance_aaaaaaaaaaaaaaaaaaaaaaaa",
    facet: "global", value: null, entityType: null, mode: "default", priority: 50, version: 1 },
  { id: "binding_bbbbbbbbbbbbbbbbbbbbbbbb", workspaceId, cardId: "guidance_bbbbbbbbbbbbbbbbbbbbbbbb",
    facet: "topic", value: "timeframe:rolling", entityType: null, mode: "default", priority: 60, version: 1 }], sets: [] });
const scopeCatalog = { version: GUIDANCE_FACET_SCOPE_CATALOG_VERSION, capturedAt,
  catalogHash: "c".repeat(64), evidence: { objectiveMappingVersion: "meta-objective-mapping/1.0.0" }, facets: [] } as const;
const scopeResolver: GuidanceFacetScopeResolver = {
  listCatalog: async () => scopeCatalog,
  resolve: async (_workspaceId, input) => Object.freeze({ ...input,
    objective: input.objective === null ? null : "lead_generation",
    funnel: input.funnel === null ? null : input.funnel === "funnel_seasonal" ? "seasonal" : "consideration",
    optimization: input.optimization === null ? null : "LEAD",
    lifecycle: input.lifecycle === null ? null : input.lifecycle === "lifecycle_seasonal" ? "seasonal" : "evergreen",
    topics: Object.freeze(input.topics.map((ref) => ref === "topic_budget" ? "budget" : "cadence")),
    requiredTopics: Object.freeze(input.requiredTopics.map((ref) => ref === "topic_timeframe" ? "timeframe:rolling"
      : ref === "topic_budget" ? "budget" : "cadence")),
    capture: Object.freeze({ version: GUIDANCE_FACET_SCOPE_CATALOG_VERSION, capturedAt,
      catalogHash: "c".repeat(64) }),
  }),
};
const contract = new GuidanceAgentContract({ load: async () => registry },
  [{ userId, workspaceId, role: "viewer" }], scopeResolver);

describe("GuidanceAgentContract", () => {
  it("lists preserved owner statements with all mutation/action authority closed", async () => {
    const result = await contract.execute(principal, { name: "guidance_registry_list", arguments: { status: "published" } });
    expect("items" in result.result).toBe(true);
    if (!("items" in result.result)) throw new Error("unexpected result");
    expect(result.result.items).toHaveLength(2);
    expect(result.result.items[0]).toMatchObject({ authority: "guidance_only",
      provenance: [{ sourceType: "owner_statement", status: "published" }] });
    expect(result.result.scopeCatalog).toEqual(scopeCatalog);
    expect(result.authority).toMatchObject({ canDraft: false, canPublish: false, canArchive: false,
      canAuthorizeAction: false, canWriteMeta: false, persistence: false });
  });

  it("adds semantic timeframe topic and resolves a deterministic public-safe pack", async () => {
    const result = await contract.execute(principal, { name: "guidance_effective_preview", arguments: {
      contractVersion: "guidance-agent-tools/1.2.0", expectedCatalogHash: "c".repeat(64),
      accountRef: "account_aaaaaaaaaaaaaaaaaaaaaaaa", accountGroupRefs: [], objective: "objective_leads",
      funnel: null, optimization: null, internalCategoryRefs: [], lifecycle: null, promotionTemplateRefs: [],
      entity: { type: "campaign", ref: "campaign_aaaaaaaaaaaaaaaaaaaaaaaa" }, topics: ["topic_cadence"],
      requiredTopics: ["topic_cadence", "topic_timeframe"], evaluatedAt: "2026-08-08T10:00:00.000Z",
      timeframe: { ref: "timeframe_last_7d", kind: "rolling" },
    } });
    expect("applied" in result.result).toBe(true);
    if (!("applied" in result.result)) throw new Error("unexpected result");
    expect(result.result.applied.map((item) => item.cardId)).toEqual([
      "guidance_bbbbbbbbbbbbbbbbbbbbbbbb", "guidance_aaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
    expect(result.result.missing).toEqual([]);
    expect(result.result.timeframe).toEqual({ ref: "timeframe_last_7d", kind: "rolling" });
    expect(result.result.scopeCapture.catalogHash).toBe("c".repeat(64));
    expect(result.contractVersion).toBe("guidance-agent-tools/1.2.0");
    expect(result.authority.canWriteMeta).toBe(false);
  });

  it("rejects non-public category and account identifiers", async () => {
    await expect(contract.execute(principal, { name: "guidance_effective_preview", arguments: {
      contractVersion: "guidance-agent-tools/1.2.0", expectedCatalogHash: "c".repeat(64),
      accountRef: "123", accountGroupRefs: [], objective: null, funnel: null, optimization: null,
      internalCategoryRefs: ["category_bad"], lifecycle: null, entity: null, promotionTemplateRefs: [],
      topics: [], requiredTopics: [], evaluatedAt: capturedAt,
      timeframe: { ref: "timeframe_last_7d", kind: "rolling" },
    } })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("passes all extended facets through the MCP validator into deterministic matching", async () => {
    const scopedRegistry = createGuidanceRegistry({ workspaceId,
      sources: [source("source_cccccccccccccccccccccccc", "Tam kapsamlı guidance")],
      cards: [card("guidance_cccccccccccccccccccccccc", "source_cccccccccccccccccccccccc",
        "Tam kapsamlı guidance", "budget")],
      bindings: ([
        { facet: "account_group", value: "account_group_primary" },
        { facet: "funnel", value: "consideration" },
        { facet: "optimization", value: "LEAD" },
        { facet: "lifecycle", value: "evergreen" },
        { facet: "promotion_template", value: "promotion_template_lead" },
      ] as const).map((scope, index) => ({ id: `binding_${String(index).padStart(24, "a")}`, workspaceId,
        cardId: "guidance_cccccccccccccccccccccccc", ...scope, entityType: null,
        mode: "default" as const, priority: 50, version: 1 })), sets: [] });
    const scopedContract = new GuidanceAgentContract({ load: async () => scopedRegistry },
      [{ userId, workspaceId, role: "viewer" }], scopeResolver);
    const arguments_ = { contractVersion: "guidance-agent-tools/1.2.0" as const, expectedCatalogHash: "c".repeat(64),
      accountRef: "account_aaaaaaaaaaaaaaaaaaaaaaaa",
      accountGroupRefs: ["account_group_primary"], objective: "objective_leads", funnel: "funnel_consideration",
      optimization: "optimization_lead", internalCategoryRefs: [], lifecycle: "lifecycle_evergreen", entity: null,
      promotionTemplateRefs: ["promotion_template_lead"], topics: ["topic_budget"], requiredTopics: ["topic_budget"],
      evaluatedAt: "2026-08-08T10:00:00.000Z", timeframe: { ref: "timeframe_last_7d", kind: "rolling" as const } };
    expect(MCP_TOOL_SCHEMAS.guidance_effective_preview.safeParse(arguments_).success).toBe(true);
    const matched = await scopedContract.execute(principal,
      { name: "guidance_effective_preview", arguments: arguments_ });
    expect("applied" in matched.result && matched.result.applied.map((item) => item.cardId))
      .toEqual(["guidance_cccccccccccccccccccccccc"]);
    const missed = await scopedContract.execute(principal, { name: "guidance_effective_preview",
      arguments: { ...arguments_, lifecycle: "lifecycle_seasonal" } });
    expect("suppressed" in missed.result && missed.result.suppressed)
      .toContainEqual({ cardId: "guidance_cccccccccccccccccccccccc", reason: "scope_not_matched" });
  });

  it("fails closed on missing or over-limit extended facet refs", async () => {
    const base = { contractVersion: "guidance-agent-tools/1.2.0" as const, expectedCatalogHash: "c".repeat(64),
      accountRef: "account_aaaaaaaaaaaaaaaaaaaaaaaa", accountGroupRefs: [], objective: null,
      funnel: null, optimization: null, internalCategoryRefs: [], lifecycle: null, entity: null,
      promotionTemplateRefs: [], topics: [], requiredTopics: [], evaluatedAt: capturedAt,
      timeframe: { ref: "timeframe_last_7d", kind: "rolling" as const } };
    await expect(contract.execute(principal, { name: "guidance_effective_preview",
      arguments: { ...base, accountGroupRefs: Array.from({ length: 26 }, (_, index) => `account_group_${index}`) } }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(MCP_TOOL_SCHEMAS.guidance_effective_preview.safeParse({ ...base, lifecycle: undefined }).success).toBe(false);
    expect(MCP_TOOL_SCHEMAS.guidance_effective_preview.safeParse({ ...base,
      topics: ["topic_budget", "topic_budget"] }).success).toBe(false);
    const previewTool = GUIDANCE_AGENT_TOOLS.find((tool) => tool.name === "guidance_effective_preview");
    expect(previewTool?.inputSchema.properties).toMatchObject({
      accountGroupRefs: { maxItems: 25, uniqueItems: true },
      internalCategoryRefs: { maxItems: 100, uniqueItems: true,
        items: { pattern: "^category_[a-f0-9]{24}$" } },
      promotionTemplateRefs: { maxItems: 50, uniqueItems: true },
      topics: { maxItems: 100, uniqueItems: true },
      requiredTopics: { maxItems: 100, uniqueItems: true },
    });
  });

  it("applies a legacy objective binding through the actual tenant resolver and catalog OCC guard", async () => {
    const accountId = "33333333-3333-4333-8333-333333333333";
    const objectiveRowId = "44444444-4444-4444-8444-444444444444";
    const topicRowId = "55555555-5555-4555-8555-555555555555";
    const capture = { captured_at: capturedAt, account_id: null, entity_type: null,
      dimension_key: null, definition_key: null };
    const rows = [
      { ...capture, facet: "_capture", internal_id: "00000000-0000-4000-8000-000000000000",
        canonical_value: "capture_ref", label: "capture" },
      { ...capture, facet: "account", internal_id: accountId, canonical_value: `account_${accountId}`,
        label: "Main", account_id: accountId },
      { ...capture, facet: "objective", internal_id: objectiveRowId, canonical_value: "lead_generation",
        label: "OUTCOME_LEADS", account_id: accountId },
      { ...capture, facet: "topic", internal_id: topicRowId, canonical_value: "budget", label: "budget" },
    ];
    const execute = vi.fn(async () => ({ rows }));
    const actualResolver = new DrizzleGuidanceFacetScopeResolver({ execute } as never);
    const catalog = await actualResolver.listCatalog(workspaceId);
    const scopedRegistry = createGuidanceRegistry({ workspaceId,
      sources: [source("source_dddddddddddddddddddddddd", "Legacy objective guidance")],
      cards: [card("guidance_dddddddddddddddddddddddd", "source_dddddddddddddddddddddddd",
        "Legacy objective", "budget")],
      bindings: [{ id: "binding_dddddddddddddddddddddddd", workspaceId,
        cardId: "guidance_dddddddddddddddddddddddd", facet: "objective", value: "LEAD_GENERATION",
        entityType: null, mode: "default", priority: 50, version: 1 },
      { id: "binding_eeeeeeeeeeeeeeeeeeeeeeee", workspaceId,
        cardId: "guidance_dddddddddddddddddddddddd", facet: "topic", value: "budget",
        entityType: null, mode: "default", priority: 50, version: 1 }], sets: [] });
    const actualContract = new GuidanceAgentContract({ load: async () => scopedRegistry },
      [{ userId, workspaceId, role: "viewer" }], actualResolver);
    const result = await actualContract.execute(principal, { name: "guidance_effective_preview", arguments: {
      contractVersion: "guidance-agent-tools/1.2.0", expectedCatalogHash: catalog.catalogHash,
      accountRef: promotionRegistryPublicRef("account", workspaceId, accountId), accountGroupRefs: [],
      objective: guidanceFacetPublicRef("objective", workspaceId, "lead_generation"), funnel: null,
      optimization: null, internalCategoryRefs: [], lifecycle: null, entity: null,
      promotionTemplateRefs: [], topics: [guidanceFacetPublicRef("topic", workspaceId, "budget")],
      requiredTopics: [guidanceFacetPublicRef("topic", workspaceId, "budget")], evaluatedAt: capturedAt,
      timeframe: { ref: "timeframe_last_7d", kind: "rolling" },
    } });
    expect("applied" in result.result && result.result.applied.map((item) => item.cardId))
      .toEqual(["guidance_dddddddddddddddddddddddd"]);
    expect(result.result).toMatchObject({ scopeCapture: { catalogHash: catalog.catalogHash } });
  });
});
