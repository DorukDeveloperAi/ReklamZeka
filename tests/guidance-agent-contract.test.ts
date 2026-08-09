import { describe, expect, it } from "vitest";
import { GuidanceAgentContract, GUIDANCE_AGENT_TOOLS } from "@/application/guidance-agent-contract";
import { createGuidanceRegistry } from "@/domain/guidance/registry";
import { MCP_TOOL_SCHEMAS } from "@/mcp/tool-schemas";

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
const contract = new GuidanceAgentContract({ load: async () => registry }, [{ userId, workspaceId, role: "viewer" }]);

describe("GuidanceAgentContract", () => {
  it("lists preserved owner statements with all mutation/action authority closed", async () => {
    const result = await contract.execute(principal, { name: "guidance_registry_list", arguments: { status: "published" } });
    expect("items" in result.result).toBe(true);
    if (!("items" in result.result)) throw new Error("unexpected result");
    expect(result.result.items).toHaveLength(2);
    expect(result.result.items[0]).toMatchObject({ authority: "guidance_only",
      provenance: [{ sourceType: "owner_statement", status: "published" }] });
    expect(result.authority).toMatchObject({ canDraft: false, canPublish: false, canArchive: false,
      canAuthorizeAction: false, canWriteMeta: false, persistence: false });
  });

  it("adds semantic timeframe topic and resolves a deterministic public-safe pack", async () => {
    const result = await contract.execute(principal, { name: "guidance_effective_preview", arguments: {
      accountRef: "account_aaaaaaaaaaaaaaaaaaaaaaaa", accountGroupRefs: [], objective: "OUTCOME_LEADS",
      funnel: null, optimization: null, internalCategoryRefs: [], lifecycle: null, promotionTemplateRefs: [],
      entity: { type: "campaign", ref: "campaign_aaaaaaaaaaaaaaaaaaaaaaaa" }, topics: ["cadence"],
      requiredTopics: ["cadence", "timeframe:rolling"], evaluatedAt: "2026-08-08T10:00:00.000Z",
      timeframe: { ref: "timeframe_last_7d", kind: "rolling" },
    } });
    expect("applied" in result.result).toBe(true);
    if (!("applied" in result.result)) throw new Error("unexpected result");
    expect(result.result.applied.map((item) => item.cardId)).toEqual([
      "guidance_bbbbbbbbbbbbbbbbbbbbbbbb", "guidance_aaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
    expect(result.result.missing).toEqual([]);
    expect(result.result.timeframe).toEqual({ ref: "timeframe_last_7d", kind: "rolling" });
    expect(result.contractVersion).toBe("guidance-agent-tools/1.1.0");
    expect(result.authority.canWriteMeta).toBe(false);
  });

  it("rejects non-public category and account identifiers", async () => {
    await expect(contract.execute(principal, { name: "guidance_effective_preview", arguments: {
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
      [{ userId, workspaceId, role: "viewer" }]);
    const arguments_ = { accountRef: "account_aaaaaaaaaaaaaaaaaaaaaaaa",
      accountGroupRefs: ["account_group_primary"], objective: "OUTCOME_LEADS", funnel: "consideration",
      optimization: "LEAD", internalCategoryRefs: [], lifecycle: "evergreen", entity: null,
      promotionTemplateRefs: ["promotion_template_lead"], topics: ["budget"], requiredTopics: ["budget"],
      evaluatedAt: "2026-08-08T10:00:00.000Z", timeframe: { ref: "timeframe_last_7d", kind: "rolling" as const } };
    expect(MCP_TOOL_SCHEMAS.guidance_effective_preview.safeParse(arguments_).success).toBe(true);
    const matched = await scopedContract.execute(principal,
      { name: "guidance_effective_preview", arguments: arguments_ });
    expect("applied" in matched.result && matched.result.applied.map((item) => item.cardId))
      .toEqual(["guidance_cccccccccccccccccccccccc"]);
    const missed = await scopedContract.execute(principal, { name: "guidance_effective_preview",
      arguments: { ...arguments_, lifecycle: "seasonal" } });
    expect("suppressed" in missed.result && missed.result.suppressed)
      .toContainEqual({ cardId: "guidance_cccccccccccccccccccccccc", reason: "scope_not_matched" });
  });

  it("fails closed on missing or over-limit extended facet refs", async () => {
    const base = { accountRef: "account_aaaaaaaaaaaaaaaaaaaaaaaa", accountGroupRefs: [], objective: null,
      funnel: null, optimization: null, internalCategoryRefs: [], lifecycle: null, entity: null,
      promotionTemplateRefs: [], topics: [], requiredTopics: [], evaluatedAt: capturedAt,
      timeframe: { ref: "timeframe_last_7d", kind: "rolling" as const } };
    await expect(contract.execute(principal, { name: "guidance_effective_preview",
      arguments: { ...base, accountGroupRefs: Array.from({ length: 26 }, (_, index) => `account_group_${index}`) } }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(MCP_TOOL_SCHEMAS.guidance_effective_preview.safeParse({ ...base, lifecycle: undefined }).success).toBe(false);
    expect(MCP_TOOL_SCHEMAS.guidance_effective_preview.safeParse({ ...base,
      topics: ["budget", "budget"] }).success).toBe(false);
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
});
