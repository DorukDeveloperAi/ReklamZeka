import { PgDialect } from "drizzle-orm/pg-core";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCreativeDiagnosticSettlementPolicy } from "@/analyses/creative-diagnostic-settlement-policy";
import { DrizzleCreativeDiagnosticWindowInsightSnapshotRepository } from "@/connectors/analyses/creative-diagnostic-window-insight-snapshot-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const configSnapshotId = "22222222-2222-4222-8222-222222222222";
const insightId = "33333333-3333-4333-8333-333333333333";
const windowId = "44444444-4444-4444-8444-444444444444";
const policy = createCreativeDiagnosticSettlementPolicy({ policyRef: "creative_settlement_1234567890abcdef12345678", revision: 1, previousHash: null, state: "published", settlementLagDays: 1 });
const hashes = { source_payload_hash: "a".repeat(64), frequency_source_hash: "b".repeat(64), clicks_source_hash: "c".repeat(64), impressions_source_hash: "d".repeat(64) };
function harness(responses: readonly (readonly unknown[])[]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const database = { execute, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ execute }) };
  const policies = { loadCurrentPublishedInTransaction: vi.fn(async () => policy) };
  return { execute, policies, repository: new DrizzleCreativeDiagnosticWindowInsightSnapshotRepository(database as never, policies as never) };
}
function input(overrides: Record<string, unknown> = {}) { return { workspaceId, configSnapshotId, windowKind: "recent" as const, date: "2026-08-10", settlementPolicyRef: policy.policyRef, observedAt: "2026-08-11T18:00:00.000Z", ...overrides }; }
function rendered(execute: ReturnType<typeof vi.fn>) { return (execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n"); }
function source(overrides: Record<string, unknown> = {}) { return { insight_id: insightId, attribution_label: "account_default", timezone: "Europe/Istanbul", frequency_count: 1, clicks_count: 1, impressions_count: 1, frequency: "2.5", clicks: "25", impressions: "1000", ...hashes, ...overrides }; }
function expectedSourceHash(): string {
  return createHash("sha256").update(JSON.stringify({ clicksSourceHash: hashes.clicks_source_hash, frequencySourceHash: hashes.frequency_source_hash,
    impressionsSourceHash: hashes.impressions_source_hash, insightId, payloadHash: hashes.source_payload_hash })).digest("hex");
}

describe("DrizzleCreativeDiagnosticWindowInsightSnapshotRepository", () => {
  it("persists only a policy-bound, single source-grain day without aggregating frequency", async () => {
    const subject = harness([[source()], [{ id: windowId }]]);
    await expect(subject.repository.materializeDaily(input())).resolves.toMatchObject({ id: windowId, settlementPolicy: { policyHash: policy.policyHash }, inserted: true });
    const sql = rendered(subject.execute);
    expect(sql).toContain("metric.metric_key = 'frequency'");
    expect(sql).toMatch(/insight\.date_start = \$\d+::date and insight\.date_stop = \$\d+::date/);
    expect(sql).toContain("settlement_policy_ref");
    expect(sql).not.toMatch(/avg\(|sum\(.*frequency/i);
    expect(subject.policies.loadCurrentPublishedInTransaction).toHaveBeenCalledTimes(1);
  });

  it("fails closed for missing/non-singleton source metrics or an unsettled day before persistence", async () => {
    const missing = harness([[source({ frequency_count: 0 })]]);
    await expect(missing.repository.materializeDaily(input())).rejects.toMatchObject({ code: "insufficient_evidence" });
    expect(rendered(missing.execute)).not.toContain("insert into meta_creative_window_insight_snapshots");
    const future = harness([[source()]]);
    await expect(future.repository.materializeDaily(input({ date: "2026-08-11" }))).rejects.toMatchObject({ code: "insufficient_evidence" });
  });

  it("reuses only an exact existing policy-bound immutable snapshot", async () => {
    const subject = harness([[source()], [], [{ id: windowId, settlement_policy_ref: policy.policyRef, settlement_policy_hash: policy.policyHash, source_hash: expectedSourceHash() }]]);
    await expect(subject.repository.materializeDaily(input())).resolves.toMatchObject({ id: windowId, inserted: false });
  });

  it("uses a direct all-days source for period frequency and only daily rows for complete coverage", async () => {
    const execute = vi.fn(async () => ({ rows: [] as unknown[] }));
    const database = { execute, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ execute }) };
    const policies = { loadCurrentPublishedInTransaction: vi.fn(async () => policy) };
    const sourceRef = `creative_window_${"a".repeat(24)}`;
    const sourceReader = { read: vi.fn(async () => ({ startDate: "2026-08-08", endDate: "2026-08-10", frequency: "2.8", clicks: "40", impressions: "400", sourceRef, sourceHash: "e".repeat(64) })) };
    let index = 0;
    const responses = [
      [{ account_ref: "act_123", ad_ref: "123456" }],
      [{ insight_id: insightId, insight_date: "2026-08-08", source_payload_hash: "1".repeat(64), timezone: "Europe/Istanbul" }, { insight_id: "55555555-5555-4555-8555-555555555555", insight_date: "2026-08-09", source_payload_hash: "2".repeat(64), timezone: "Europe/Istanbul" }, { insight_id: "66666666-6666-4666-8666-666666666666", insight_date: "2026-08-10", source_payload_hash: "3".repeat(64), timezone: "Europe/Istanbul" }],
      [{ id: windowId }],
    ];
    execute.mockImplementation(async () => ({ rows: responses[index++] ?? [] }));
    const repository = new DrizzleCreativeDiagnosticWindowInsightSnapshotRepository(database as never, policies as never, sourceReader as never);
    await expect(repository.materializeAllDays({ ...input(), startDate: "2026-08-08", endDate: "2026-08-10" })).resolves.toMatchObject({ id: windowId, sourceRef, inserted: true });
    expect(sourceReader.read).toHaveBeenCalledWith({ accountRef: "act_123", adRef: "123456", startDate: "2026-08-08", endDate: "2026-08-10" });
    const sql = rendered(execute);
    expect(sql).toContain("insight.date_start = insight.date_stop");
    expect(sql).not.toMatch(/avg\(|sum\(.*frequency/i);
  });
});
