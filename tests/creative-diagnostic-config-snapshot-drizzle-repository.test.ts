import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createCreativeDiagnosticConfigSnapshot } from "@/domain/meta/creative-diagnostic-config-snapshot";
import {
  CreativeDiagnosticConfigSnapshotRepositoryError,
  DrizzleCreativeDiagnosticConfigSnapshotRepository,
} from "@/connectors/analyses/creative-diagnostic-config-snapshot-drizzle-repository";
import { CreativeDiagnosticSourceError } from "@/connectors/meta/creative-diagnostic-source-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "22222222-2222-4222-8222-222222222222";
const adId = "33333333-3333-4333-8333-333333333333";
const creativeId = "44444444-4444-4444-8444-444444444444";
const config = createCreativeDiagnosticConfigSnapshot({ bindingRef: "binding_primary", bindingHash: "a".repeat(64),
  creativeContentHash: "b".repeat(64), objective: { state: "known", ref: "objective_sales", sourceRef: "campaign_primary", sourceHash: "c".repeat(64) },
  optimization: { state: "known", ref: "optimization_purchase", sourceRef: "adset_primary", sourceHash: "d".repeat(64) },
  billing: { state: "unknown", reason: "not_observed" }, destination: { state: "unknown", reason: "not_observed" } });

function harness(responses: readonly (readonly unknown[])[], readCurrent = vi.fn(async () => ({ config, adId, creativeId }))) {
  let index = 0; const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const database = { transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) };
  return { execute, readCurrent, repository: new DrizzleCreativeDiagnosticConfigSnapshotRepository(database as never, { readCurrent }) };
}
function input() { return { workspaceId, targetEvidenceId: evidenceId, observedAt: "2026-08-11T15:00:00.000Z" }; }
function sqls(execute: ReturnType<typeof vi.fn>) { return (execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n"); }
const target = { account_ref: "act_123", entity_ref: "ad_123", context_hash: "e".repeat(64) };

describe("DrizzleCreativeDiagnosticConfigSnapshotRepository", () => {
  it("materializes an immutable current config only for an exact ad-bound evidence envelope", async () => {
    const subject = harness([[target], [{ id: "55555555-5555-4555-8555-555555555555" }]]);
    await expect(subject.repository.materialize(input())).resolves.toMatchObject({ inserted: true, config });
    expect(subject.readCurrent).toHaveBeenCalledWith({ workspaceId, accountRef: "act_123", adRef: "ad_123" });
    const sql = sqls(subject.execute);
    expect(sql).toContain("evidence.entity_type = 'ad'");
    expect(sql).toContain("context.entity_type = 'ad'");
    expect(sql).toContain("insert into meta_creative_config_snapshots");
    expect(sql).toContain("on conflict (workspace_id, snapshot_hash) do nothing");
  });

  it("reuses only a hash-and-payload-exact existing snapshot", async () => {
    const existingPayload = { config, contextHash: target.context_hash };
    const subject = harness([[target], [], [{ id: "55555555-5555-4555-8555-555555555555", config_payload: existingPayload,
      binding_hash: config.bindingHash, creative_content_hash: config.creativeContentHash }]]);
    await expect(subject.repository.materialize(input())).resolves.toMatchObject({ inserted: false, config });
    expect(sqls(subject.execute)).toContain("from meta_creative_config_snapshots");
  });

  it("fails closed for a missing/non-ad target or unavailable source binding", async () => {
    const missing = harness([[]]);
    await expect(missing.repository.materialize(input())).rejects.toMatchObject({ name: CreativeDiagnosticConfigSnapshotRepositoryError.name, code: "not_found" });
    const unavailable = harness([[target]], vi.fn(async () => { throw new CreativeDiagnosticSourceError("not_found"); }));
    await expect(unavailable.repository.materialize(input())).rejects.toMatchObject({ code: "insufficient_evidence" });
    expect(sqls(unavailable.execute)).not.toContain("insert into meta_creative_config_snapshots");
  });
});
