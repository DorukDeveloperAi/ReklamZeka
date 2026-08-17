import { describe, expect, it } from "vitest";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const row = (name: string, ref: string, kind = 0, aref = "") => ({ campaign_id: "33333333-3333-4333-8333-333333333333", campaign_name: name, campaign_ref: ref, account_id: "22222222-2222-4222-8222-222222222222", account_name: "Account", adset_id: kind ? "44444444-4444-4444-8444-444444444444" : null, adset_name: kind ? "Set" : null, cbo: true, org_id: null, org_name: null, market: "yerli", days: ["2026-08-17"], spend: 33, spend_count: 1, currencies: 1, campaign_budget_out: kind ? null : 1000, adset_budget_out: null, kind, aref });

describe("DrizzleOperationReadRepository", () => {
  it("uses read-only RR, canonical metric aggregation, and opaque limit+1 cursor", async () => {
    const statements: unknown[] = [];
    const database = { transaction: async (callback: (tx: { execute(statement: unknown): Promise<{ rows: unknown[] }> }) => unknown) => callback({ execute: async (statement) => { statements.push(statement); return { rows: statements.length === 3 ? [row("A", "campaign_a"), row("B", "campaign_b")] : [] }; } }) };
    const result = await new DrizzleOperationReadRepository(database as never).load({ workspaceId, period: { startDate: "2026-08-17", endDate: "2026-08-17" }, sliceRef: null, limit: 1, cursor: null });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({ spendMinor: 33, observedDays: ["2026-08-17"] });
    expect(result.nextCursor).toMatch(/^operation_cursor_/);
    // The first two statements are the RR/read-only guards; the third is the
    // single canonical facts query (the Drizzle SQL object is intentionally opaque).
    expect(statements).toHaveLength(3);
  });

  it("keeps campaign summary and ad-set siblings in the cursor order", async () => {
    const statements: unknown[] = [];
    const database = { transaction: async (callback: (tx: { execute(statement: unknown): Promise<{ rows: unknown[] }> }) => unknown) => callback({ execute: async (statement) => { statements.push(statement); return { rows: statements.length === 3 ? [row("A", "campaign_a", 0), row("A", "campaign_a", 1, "ad_set_a"), row("A", "campaign_a", 1, "ad_set_b")] : [] }; } }) };
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
