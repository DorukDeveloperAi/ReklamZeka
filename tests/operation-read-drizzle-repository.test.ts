import { describe, expect, it } from "vitest";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import { createSliceRevision } from "@/domain/slices/slice-definition";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const row = (name: string, ref: string, kind = 0, aref = "") => ({ campaign_id: "33333333-3333-4333-8333-333333333333", campaign_name: name, campaign_ref: ref, account_id: "22222222-2222-4222-8222-222222222222", account_name: "Account", adset_id: kind ? "44444444-4444-4444-8444-444444444444" : null, adset_name: kind ? "Set" : null, cbo: true, org_id: null, org_name: null, market: "yerli", days: ["2026-08-17"], spend: 33, spend_count: 1, currencies: 1, campaign_budget_out: kind ? null : 1000, adset_budget_out: null, kind, aref });

describe("DrizzleOperationReadRepository", () => {
  const ids = { revision: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", campaign: "33333333-3333-4333-8333-333333333333", assignmentMarket: "55555555-5555-4555-8555-555555555555", assignmentSegment: "66666666-6666-4666-8666-666666666666" };
  const revision = () => createSliceRevision({ sliceRef: "slice_live", revisionRef: "slice_revision_live", revisionNumber: 2, market: { dimensionId: categoryDimensionPublicRef("market"), valueId: categoryDefinitionPublicRef("market", "yerli"), key: "yerli" }, predicates: [{ dimensionId: categoryDimensionPublicRef("segment"), key: "segment", values: [{ valueId: categoryDefinitionPublicRef("segment", "a"), key: "a" }] }] });
  const scopeRows = (hash = revision().definitionHash, candidates: unknown[] = [{ entity_level: "campaign", entity_id: ids.campaign, campaign_id: ids.campaign, market_value_id: null, market_dimension_id: null, market_key: null }]) => [
    [{ revision_id: ids.revision, slice_ref: "slice_live", revision_ref: "slice_revision_live", revision_number: 2, definition_hash: hash, market_dimension_id: "11111111-1111-4111-8111-111111111111", market_dimension_key: "market", market_value_id: "22222222-2222-4222-8222-222222222222", market_key: "yerli" }],
    [{ dimension_id: "77777777-7777-4777-8777-777777777777", dimension_key: "segment", value_id: "88888888-8888-4888-8888-888888888888", value_key: "a" }], [], candidates,
    [{ entity_level: "campaign", operation: "add", source: "manual", manual_lock: false, confidence: 1, version: 1, evidence: [{ kind: "manual", ref: "evidence_market" }], campaign_id: ids.campaign, ad_set_id: null, dimension_id: "11111111-1111-4111-8111-111111111111", definition_id: "22222222-2222-4222-8222-222222222222", assignment_id: ids.assignmentMarket }, { entity_level: "campaign", operation: "add", source: "manual", manual_lock: false, confidence: 1, version: 1, evidence: [{ kind: "manual", ref: "evidence_segment" }], campaign_id: ids.campaign, ad_set_id: null, dimension_id: "77777777-7777-4777-8777-777777777777", definition_id: "88888888-8888-4888-8888-888888888888", assignment_id: ids.assignmentSegment }],
    [{ id: "11111111-1111-4111-8111-111111111111", key: "market", version: 1, cardinality: "single", allowed_entity_levels: ["campaign"] }, { id: "77777777-7777-4777-8777-777777777777", key: "segment", version: 1, cardinality: "single", allowed_entity_levels: ["campaign"] }],
    [{ id: "22222222-2222-4222-8222-222222222222", dimension_id: "11111111-1111-4111-8111-111111111111", key: "yerli", label: "Yerli", version: 1 }, { id: "88888888-8888-4888-8888-888888888888", dimension_id: "77777777-7777-4777-8777-777777777777", key: "a", label: "A", version: 1 }],
  ];

  it("resolves a newly matching current campaign without consulting a frozen snapshot", async () => {
    const output = scopeRows(); let index = 0;
    const tx = { execute: async () => ({ rows: output[index++]! }) };
    await expect((new DrizzleOperationReadRepository({ transaction: async () => undefined } as never) as any).resolveCurrentScope(tx, workspaceId, "slice_live")).resolves.toMatchObject({ organizationCampaignIds: [], campaignIds: [ids.campaign], adSetIds: [], campaignMarkets: new Map([[ids.campaign, "yerli"]]) });
  });

  it("fails closed for a tampered current revision or a candidate cap", async () => {
    for (const output of [scopeRows("0".repeat(64)), scopeRows(revision().definitionHash, Array.from({ length: 20_001 }, () => ({ entity_level: "campaign", entity_id: ids.campaign, campaign_id: ids.campaign, market_value_id: null, market_dimension_id: null, market_key: null })) )]) {
      let index = 0; const tx = { execute: async () => ({ rows: output[index++]! }) };
      await expect((new DrizzleOperationReadRepository({ transaction: async () => undefined } as never) as any).resolveCurrentScope(tx, workspaceId, "slice_live")).rejects.toThrow(/slice/);
    }
  });

  it("uses canonical own market evidence in the global view instead of an organization fallback", async () => {
    const scoped = scopeRows(); const responses = [[], [], scoped[0], scoped[3], scoped[4], scoped[5], scoped[6], [{ ...row("A", "campaign_a"), market: "yabanci" }]]; let index = 0;
    const database = { transaction: async (callback: (tx: { execute(): Promise<{ rows: unknown[] }> }) => unknown) => callback({ execute: async () => ({ rows: responses[index++]! }) }) };
    const result = await new DrizzleOperationReadRepository(database as never).load({ workspaceId, period: { startDate: "2026-08-17", endDate: "2026-08-17" }, sliceRef: null, limit: 1, cursor: null });
    expect(result.facts[0]?.market).toBe("yerli");
  });

  it("uses read-only RR, canonical metric aggregation, and opaque limit+1 cursor", async () => {
    const statements: unknown[] = [];
    const database = { transaction: async (callback: (tx: { execute(statement: unknown): Promise<{ rows: unknown[] }> }) => unknown) => callback({ execute: async (statement) => { statements.push(statement); return { rows: statements.length === 4 ? [row("A", "campaign_a"), row("B", "campaign_b")] : [] }; } }) };
    const result = await new DrizzleOperationReadRepository(database as never).load({ workspaceId, period: { startDate: "2026-08-17", endDate: "2026-08-17" }, sliceRef: null, limit: 1, cursor: null });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({ spendMinor: 33, observedDays: ["2026-08-17"] });
    expect(result.nextCursor).toMatch(/^operation_cursor_/);
    // The first two statements are the RR/read-only guards; the third is the
    // single canonical facts query (the Drizzle SQL object is intentionally opaque).
    expect(statements).toHaveLength(4);
  });

  it("keeps campaign summary and ad-set siblings in the cursor order", async () => {
    const statements: unknown[] = [];
    const database = { transaction: async (callback: (tx: { execute(statement: unknown): Promise<{ rows: unknown[] }> }) => unknown) => callback({ execute: async (statement) => { statements.push(statement); return { rows: statements.length === 4 ? [row("A", "campaign_a", 0), row("A", "campaign_a", 1, "ad_set_a"), row("A", "campaign_a", 1, "ad_set_b")] : [] }; } }) };
    const result = await new DrizzleOperationReadRepository(database as never).load({ workspaceId, period: { startDate: "2026-08-17", endDate: "2026-08-17" }, sliceRef: null, limit: 2, cursor: null });
    expect(result.facts.map((fact) => fact.adSetId)).toEqual([null, "44444444-4444-4444-8444-444444444444"]);
    const cursor = JSON.parse(Buffer.from(result.nextCursor!.slice("operation_cursor_".length), "base64url").toString());
    expect(cursor).toMatchObject({ v: 2, k: 1, a: "ad_set_a" });
  });

  it("rejects a malformed cursor before querying canonical facts", async () => {
    const database = { transaction: async (callback: (tx: { execute(): Promise<{ rows: unknown[] }> }) => unknown) => callback({ execute: async () => ({ rows: [] }) }) };
    await expect(new DrizzleOperationReadRepository(database as never).load({ workspaceId, period: { startDate: "2026-08-17", endDate: "2026-08-17" }, sliceRef: null, limit: 1, cursor: "operation_cursor_not-json" })).rejects.toThrow("cursor");
  });
});
