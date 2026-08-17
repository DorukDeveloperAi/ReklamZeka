import { describe, expect, it } from "vitest";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const row = (name: string, ref: string) => ({ campaign_id: "33333333-3333-4333-8333-333333333333", campaign_name: name, campaign_ref: ref, external_campaign_id: "meta-c", account_id: "22222222-2222-4222-8222-222222222222", account_name: "Account", adset_id: null, adset_name: null, cbo: true, campaign_budget: 1000, adset_budget: null, org_id: null, org_name: null, market: "yerli", observed_days: ["2026-08-17"], spend_minor: 33, currency_count: 1 });

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

  it("rejects a malformed cursor before querying canonical facts", async () => {
    const database = { transaction: async (callback: (tx: { execute(): Promise<{ rows: unknown[] }> }) => unknown) => callback({ execute: async () => ({ rows: [] }) }) };
    await expect(new DrizzleOperationReadRepository(database as never).load({ workspaceId, period: { startDate: "2026-08-17", endDate: "2026-08-17" }, sliceRef: null, limit: 1, cursor: "operation_cursor_not-json" })).rejects.toThrow("cursor");
  });
});
