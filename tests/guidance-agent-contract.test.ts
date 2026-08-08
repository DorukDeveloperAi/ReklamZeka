import { describe, expect, it } from "vitest";
import { GuidanceAgentContract } from "@/application/guidance-agent-contract";
import { createGuidanceRegistry } from "@/domain/guidance/registry";

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
      accountRef: "account_aaaaaaaaaaaaaaaaaaaaaaaa", objective: "OUTCOME_LEADS", internalCategoryRefs: [],
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
    expect(result.authority.canWriteMeta).toBe(false);
  });

  it("rejects non-public category and account identifiers", async () => {
    await expect(contract.execute(principal, { name: "guidance_effective_preview", arguments: {
      accountRef: "123", objective: null, internalCategoryRefs: ["category_bad"], entity: null,
      topics: [], requiredTopics: [], evaluatedAt: capturedAt,
      timeframe: { ref: "timeframe_last_7d", kind: "rolling" },
    } })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
