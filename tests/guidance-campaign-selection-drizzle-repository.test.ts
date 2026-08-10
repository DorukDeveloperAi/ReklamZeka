import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzleGuidanceCampaignSelectionRepository, GUIDANCE_CAMPAIGN_SELECTION_VERSION } from "@/connectors/guidance/guidance-campaign-selection-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const campaignId = "44444444-4444-4444-8444-444444444444";
const occurredAt = "2026-08-10T12:00:00.000Z";
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
const input = Object.freeze({ workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner", role: "owner" as const,
  accountRef: "account_primary", campaignRef: "campaign_primary", selectionRef: "guidance_selection_primary", revision: 1,
  expectedCurrentHash: "GENESIS" as const, selectedSetRef: "set_primary", selectedSetVersion: 1, selectedSetHash: "a".repeat(64),
  topics: ["quality"], requiredTopics: [], budget: { maxCards: 10, maxSources: 20, maxCharacters: 1000 }, effectiveAt: occurredAt, occurredAt });

function repository(responses: readonly unknown[][]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const guidanceReader = { readCurrentInTransaction: vi.fn(async () => ({ capturedAt: occurredAt, registryHash: "b".repeat(64), registry: {} as never,
    reviewedSets: [{ setRef: input.selectedSetRef, setVersion: input.selectedSetVersion, setHash: input.selectedSetHash, cards: [] }] })) };
  return { execute, guidanceReader, repository: new DrizzleGuidanceCampaignSelectionRepository({ execute,
    transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) } as never, guidanceReader) };
}

describe("DrizzleGuidanceCampaignSelectionRepository", () => {
  it("uses immutable revision + mutable OCC head with RLS, tenant FKs and no public grants", () => {
    const migration = readFileSync("drizzle/20260810180000_guidance_campaign_selection.sql", "utf8");
    for (const token of ["guidance_campaign_selection_revisions", "guidance_campaign_selection_heads",
      "guidance_campaign_selection_revisions_immutable", "guidance_campaign_selection_scope_guard",
      "ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY", "service_role", "guidance_selection"]) expect(migration).toContain(token);
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  });

  it("requires owner membership, exact current reviewed set, OCC and writes audit in the same transaction", async () => {
    const harness = repository([[{ id: workspaceId }], [{ role: "owner" }], [{ account_id: accountId, campaign_id: campaignId, captured_at: occurredAt }], [], [], [], [], []]);
    await expect(harness.repository.publish(input)).resolves.toMatchObject({ outcome: "inserted", selection: {
      sourceSelectionHash: hash({ selectionVersion: GUIDANCE_CAMPAIGN_SELECTION_VERSION, selectedSetRef: input.selectedSetRef,
        selectedSetVersion: input.selectedSetVersion, selectedSetHash: input.selectedSetHash, topics: input.topics,
        requiredTopics: input.requiredTopics, budget: input.budget, effectiveAt: occurredAt }),
    }, capabilities: { canExecute: false, canWriteMeta: false } });
    expect(harness.guidanceReader.readCurrentInTransaction).toHaveBeenCalledWith(expect.anything(), workspaceId, occurredAt);
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toContain("for update");
    expect(rendered).toContain("insert into guidance_campaign_selection_revisions");
    expect(rendered).toContain("guidance_campaign_selection_heads");
    expect(rendered).toContain("pg_advisory_xact_lock");
    expect(rendered).toContain("insert into audit_events");
  });

  it("rejects non-owner before it can write a revision", async () => {
    const harness = repository([[{ id: workspaceId }], [{ role: "analyst" }]]);
    await expect(harness.repository.publish(input)).rejects.toMatchObject({ code: "forbidden" });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).not.toContain("insert into guidance_campaign_selection_revisions");
  });
});
