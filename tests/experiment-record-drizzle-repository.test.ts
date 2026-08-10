import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DrizzleExperimentRecordRepository } from "@/connectors/decisions/experiment-record-drizzle-repository";
import { EXPERIMENT_CONTRACT_VERSION } from "@/domain/decisions/cadence";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const campaignId = "44444444-4444-4444-8444-444444444444";
const cadenceId = "55555555-5555-4555-8555-555555555555";
const plan = { version: EXPERIMENT_CONTRACT_VERSION, hypothesis: "Offer improves quality", primaryMetric: "qualifiedLeadRate",
  desiredDirection: "increase" as const, primaryVariable: "offer", changedVariables: ["offer"], baselineRef: "baseline_safe",
  guardrailMetrics: ["cplMinor"], stopConditions: ["guardrail_breach", "contamination"] as const, minimumSampleSize: 10,
  minimumWindowHours: 24, minimumEvidenceScore: 0.7, minimumDetectableEffect: 0.05 };

function repository(responses: readonly unknown[][]) {
  let index = 0; const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  return { execute, repository: new DrizzleExperimentRecordRepository({ execute,
    transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) } as never) };
}

describe("DrizzleExperimentRecordRepository", () => {
  it("makes plan/outcome history tenant-scoped, immutable, RLS-protected, and tombstone-aware", () => {
    const migration = readFileSync("drizzle/20260810124955_yielding_hemingway.sql", "utf8");
    for (const key of ["experiment_record_revisions_account_scope_fk", "experiment_record_revisions_campaign_scope_fk", "experiment_record_revisions_cadence_profile_scope_fk", "experiment_record_revisions_chain_trigger"]) expect(migration).toContain(key);
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY"); expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("service_role"); expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  });

  it("records a one-variable plan only after workspace, membership, scope, cadence, and audit checks", async () => {
    const harness = repository([[{ id: workspaceId }], [{ role: "analyst" }], [{ account_id: accountId, campaign_id: campaignId }], [{ id: cadenceId }], [], [], [], []]);
    await expect(harness.repository.plan({ workspaceId, actorId, actorRef: "actor_analyst", role: "analyst", accountRef: "account_primary",
      campaignRef: "campaign_primary", cadenceProfileRevisionId: cadenceId, plan, occurredAt: "2026-08-10T12:00:00.000Z" }))
      .resolves.toMatchObject({ outcome: "inserted", capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toContain("insert into experiment_record_revisions"); expect(rendered).toContain("pg_advisory_xact_lock"); expect(rendered).toContain("insert into audit_events");
  });

  it("rejects a plan with no explicit guardrail stop condition before database I/O", async () => {
    const execute = vi.fn(); const repository = new DrizzleExperimentRecordRepository({ execute } as never);
    await expect(repository.plan({ workspaceId, actorId, actorRef: "actor_analyst", role: "analyst", accountRef: "account_primary",
      campaignRef: "campaign_primary", cadenceProfileRevisionId: cadenceId, plan: { ...plan, stopConditions: ["contamination"] }, occurredAt: "2026-08-10T12:00:00.000Z" }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(execute).not.toHaveBeenCalled();
  });
});
