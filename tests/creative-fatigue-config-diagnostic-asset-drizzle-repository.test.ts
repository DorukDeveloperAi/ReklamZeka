import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createCreativeDiagnosticDefinition } from "@/analyses/creative-diagnostic-definition";
import { DrizzleCreativeFatigueConfigDiagnosticAssetRepository } from "@/connectors/analyses/creative-fatigue-config-diagnostic-asset-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const ids = { target: "22222222-2222-4222-8222-222222222222", baselineConfig: "33333333-3333-4333-8333-333333333333", recentConfig: "44444444-4444-4444-8444-444444444444", baselineWindow: "55555555-5555-4555-8555-555555555555", recentWindow: "66666666-6666-4666-8666-666666666666", definition: "77777777-7777-4777-8777-777777777777", asset: "88888888-8888-4888-8888-888888888888", creative: "99999999-9999-4999-8999-999999999999" };
const hash = (char: string) => char.repeat(64);
const definition = createCreativeDiagnosticDefinition({ definitionRef: "creative_definition_1234567890abcdef12345678", revision: 1, previousHash: null, state: "published", minimumImpressions: 100, minimumFrequencyIncreaseFraction: 0.2, minimumCtrDeclineFraction: 0.1, maximumCoverageGapDays: 0 });
function source(overrides: Record<string, unknown> = {}) { return {
  entity_ref: "ad_1234567890abcdef", definition_revision_id: ids.definition, baseline_config_hash: hash("a"), recent_config_hash: hash("b"), baseline_config_payload: { config: { objective: { state: "unknown", reason: "not_observed" } } }, recent_config_payload: { config: { objective: { state: "unknown", reason: "not_observed" } } }, baseline_creative_id: ids.creative, recent_creative_id: ids.creative,
  baseline_window_id: ids.baselineWindow, baseline_start_date: "2026-08-09", baseline_end_date: "2026-08-09", baseline_frequency: "2", baseline_clicks: "20", baseline_impressions: "200", baseline_source_ref: "creative_window_1234567890abcdef12345678", baseline_daily_coverage: [{ date: "2026-08-09", settled: true, sourceSnapshotRef: "snapshot_1234567890abcdef1234567890abcdef" }], baseline_window_hash: hash("c"), baseline_policy_ref: "creative_settlement_1234567890abcdef12345678", baseline_policy_hash: hash("d"),
  recent_window_id: ids.recentWindow, recent_start_date: "2026-08-10", recent_end_date: "2026-08-10", recent_frequency: "3", recent_clicks: "18", recent_impressions: "200", recent_source_ref: "creative_window_abcdef1234567890abcdef1234", recent_daily_coverage: [{ date: "2026-08-10", settled: true, sourceSnapshotRef: "snapshot_abcdef1234567890abcdef1234567890" }], recent_window_hash: hash("e"), recent_policy_ref: "creative_settlement_1234567890abcdef12345678", recent_policy_hash: hash("f"), ...overrides,
}; }
function harness(responses: readonly (readonly unknown[])[]) { let index = 0; const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] })); const database = { execute, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ execute }) }; const definitions = { loadCurrentPublishedInTransaction: vi.fn(async () => definition) }; return { execute, definitions, repository: new DrizzleCreativeFatigueConfigDiagnosticAssetRepository(database as never, definitions as never) }; }
function input(overrides: Record<string, unknown> = {}) { return { workspaceId, targetEvidenceId: ids.target, definitionRef: definition.definitionRef, baselineConfigSnapshotId: ids.baselineConfig, recentConfigSnapshotId: ids.recentConfig, baselineWindowId: ids.baselineWindow, recentWindowId: ids.recentWindow, occurredAt: "2026-08-11T18:00:00.000Z", ...overrides }; }
function rendered(execute: ReturnType<typeof vi.fn>) { return (execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n"); }

describe("DrizzleCreativeFatigueConfigDiagnosticAssetRepository", () => {
  it("binds published definition and exact baseline/recent windows into an advisory-only immutable asset", async () => {
    const subject = harness([[source()], [{ id: ids.asset }]]);
    await expect(subject.repository.materialize(input())).resolves.toMatchObject({ id: ids.asset, inserted: true, result: { fatigue: { state: "finding" }, config: { changed: false } }, capabilities: { canAuthorizeAction: false, canWriteMeta: false, canAccessNetwork: false } });
    const sql = rendered(subject.execute);
    expect(sql).toContain("definition.state = 'published'");
    expect(sql).toContain("baseline_window.window_kind = 'baseline'");
    expect(sql).toContain("recent_window.window_kind = 'recent'");
    expect(sql).toContain("insert into creative_fatigue_config_diagnostic_assets");
  });

  it("fails closed before insert for mismatched creative, unsettled coverage, or an unavailable definition", async () => {
    const mismatch = harness([[source({ recent_creative_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })]]);
    await expect(mismatch.repository.materialize(input())).rejects.toMatchObject({ code: "corrupt_store" });
    expect(rendered(mismatch.execute)).not.toContain("insert into creative_fatigue_config_diagnostic_assets");
    const unsettled = harness([[source({ recent_daily_coverage: [{ date: "2026-08-10", settled: false, sourceSnapshotRef: "snapshot_abcdef1234567890abcdef1234567890" }] })], [{ id: ids.asset }]]);
    await expect(unsettled.repository.materialize(input())).resolves.toMatchObject({ result: { fatigue: { state: "insufficient_data", reason: "unsettled_coverage" } } });
    const noDefinition = harness([]); noDefinition.definitions.loadCurrentPublishedInTransaction.mockRejectedValueOnce(new Error("not found"));
    await expect(noDefinition.repository.materialize(input())).rejects.toMatchObject({ code: "insufficient_evidence" });
  });
});
