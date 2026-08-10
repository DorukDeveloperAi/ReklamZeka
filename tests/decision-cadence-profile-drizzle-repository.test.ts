import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DrizzleDecisionCadenceProfileRepository } from "@/connectors/decisions/decision-cadence-profile-drizzle-repository";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const campaignId = "44444444-4444-4444-8444-444444444444";
const profile = { version: DECISION_CADENCE_VERSION, settleHours: 24, minimumObservationHours: 12,
  minimumLearningHours: 24, cooldownHours: 24, repeatSuppressionHours: 24, frequencyWindowHours: 168,
  maxDecisionsPerWindow: 3, maxActionsPerWindow: 1, maximumHistoryEntries: 20, minimumEvidenceCount: 2,
  minimumEvidenceScore: 0.8 };

function repository(responses: readonly unknown[][]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  return { execute, repository: new DrizzleDecisionCadenceProfileRepository({ execute,
    transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) } as never) };
}

describe("DrizzleDecisionCadenceProfileRepository", () => {
  it("makes cadence storage tenant-scoped, RLS-protected, and revision-immutable", () => {
    const migration = readFileSync("drizzle/20260810123929_white_roxanne_simpson.sql", "utf8");
    expect(migration).toContain("decision_cadence_profile_revisions_account_scope_fk");
    expect(migration).toContain("decision_cadence_profile_revisions_campaign_scope_fk");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("service_role");
    expect(migration).toContain("decision_cadence_profile_revisions_immutable_trigger");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  });

  it("publishes only after membership, tenant scope, revision OCC, and audit locking", async () => {
    const harness = repository([[{ id: workspaceId }], [{ role: "owner" }], [{ account_id: accountId, campaign_id: campaignId }], [], [], [], [], []]);
    await expect(harness.repository.publish({ workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner",
      role: "owner", accountRef: "account_primary", campaignRef: "campaign_primary", profileRef: "cadence_primary",
      revision: 1, expectedCurrentHash: "GENESIS", profile, occurredAt: "2026-08-10T12:00:00.000Z" })).resolves.toMatchObject({
      outcome: "inserted", capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false },
    });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toContain("for update");
    expect(rendered).toContain("insert into decision_cadence_profile_revisions");
    expect(rendered).not.toContain("'cadence_profile'");
    expect(rendered).toContain("pg_advisory_xact_lock");
    expect(rendered).toContain("insert into audit_events");
  });

  it("atomically invalidates the superseded cadence component, never the newly inserted hash", async () => {
    const priorHash = "a".repeat(64);
    const harness = repository([[{ id: workspaceId }], [{ role: "owner" }], [{ account_id: accountId, campaign_id: campaignId }], [{ revision: 1, profile_hash: priorHash }], [], [], [], [], [], []]);
    await expect(harness.repository.publish({ workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner",
      role: "owner", accountRef: "account_primary", campaignRef: "campaign_primary", profileRef: "cadence_primary",
      revision: 2, expectedCurrentHash: priorHash, profile, occurredAt: "2026-08-10T12:00:00.000Z" })).resolves.toMatchObject({ outcome: "inserted" });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toContain("insert into effective_campaign_context_invalidations");
    expect(rendered).toContain("'cadence_profile'");
    expect(rendered).toContain("'exact_entity_component'");
    const invalidation = (harness.execute.mock.calls as unknown[][]).find(([query]) => new PgDialect().sqlToQuery(query as never).sql.includes("effective_campaign_context_invalidations"));
    expect(invalidation).toBeDefined();
    expect(new PgDialect().sqlToQuery(invalidation![0] as never).params).toContain(priorHash);
  });

  it("rejects a non-owner before it can supersede or append a profile", async () => {
    const harness = repository([[{ id: workspaceId }], [{ role: "analyst" }]]);
    await expect(harness.repository.publish({ workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner",
      role: "owner", accountRef: "account_primary", campaignRef: "campaign_primary", profileRef: "cadence_primary",
      revision: 1, expectedCurrentHash: "GENESIS", profile, occurredAt: "2026-08-10T12:00:00.000Z" }))
      .rejects.toMatchObject({ code: "forbidden" });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).not.toContain("insert into decision_cadence_profile_revisions");
  });
});
