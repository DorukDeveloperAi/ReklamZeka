import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { CurrentDecisionCadenceReader, CurrentDecisionCadenceReaderError } from "@/connectors/decisions/current-decision-cadence-reader";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const profile = { version: DECISION_CADENCE_VERSION, settleHours: 24, minimumObservationHours: 12,
  minimumLearningHours: 24, cooldownHours: 24, repeatSuppressionHours: 24, frequencyWindowHours: 168,
  maxDecisionsPerWindow: 3, maxActionsPerWindow: 1, maximumHistoryEntries: 20, minimumEvidenceCount: 2,
  minimumEvidenceScore: 0.8 };

function hash(value: unknown) {
  const stable = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(stable) : entry && typeof entry === "object"
    ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : entry;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function candidate(overrides: Record<string, unknown> = {}) {
  return { revision_id: revisionId, profile_ref: "cadence_primary", revision: 1, profile_version: DECISION_CADENCE_VERSION,
    profile_hash: hash(profile), profile_payload: profile, profile_created_at: "2026-08-01T00:00:00.000Z",
    observed_from: "2026-08-01T00:00:00.000Z", last_material_change_at: null, campaign_status: "ACTIVE",
    database_now: "2026-08-10T12:00:00.000Z", ...overrides };
}

function reader(rows: readonly unknown[]) {
  const execute = vi.fn(async (query: unknown) => {
    const rendered = new PgDialect().sqlToQuery(query as never).sql;
    if (rendered.includes("select to_char(transaction_timestamp()")) {
      return { rows: [{ captured_at: "2026-08-10T12:00:00.000Z" }] };
    }
    return { rows };
  });
  const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({ execute }));
  const database = { execute, transaction };
  return { execute, transaction, reader: new CurrentDecisionCadenceReader(database as never) };
}

describe("CurrentDecisionCadenceReader", () => {
  it("uses one read-only snapshot, resolves the exact current profile, and evaluates only repository-owned evidence", async () => {
    const harness = reader([candidate()]);
    await expect(harness.reader.readCurrent({ workspaceId, accountRef: "account_primary", campaignRef: "campaign_primary" }))
      .resolves.toMatchObject({ revisionId, profileRef: "cadence_primary", profileRevision: 1,
        profileVersion: DECISION_CADENCE_VERSION, profile, decision: { disposition: "blocked", reason: "insufficient_evidence", actionAuthority: "none" } });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toMatch(/set transaction isolation level repeatable read, read only/i);
    expect(rendered).toContain("cadence.superseded_at is null");
    expect(rendered).toContain("cadence.ad_account_id = account.id");
    expect(rendered).toContain("cadence.campaign_id = campaign.id");
    expect(rendered).toContain("transaction_timestamp()");
    expect(harness.transaction).toHaveBeenCalledTimes(1);
  });

  it("uses the caller transaction and exact captured snapshot without opening a nested transaction", async () => {
    const harness = reader([candidate()]);
    const transaction = { execute: harness.execute };
    await expect(harness.reader.readCurrentInTransaction(transaction as never,
      { workspaceId, accountRef: "account_primary", campaignRef: "campaign_primary" }, "2026-08-10T12:00:00.000Z"))
      .resolves.toMatchObject({ revisionId, decision: { evaluatedAt: "2026-08-10T12:00:00.000Z" } });
    expect(harness.transaction).not.toHaveBeenCalled();
    expect((harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n"))
      .toContain("transaction_timestamp()");
  });

  it("rejects a cadence row observed from a different transaction snapshot", async () => {
    await expect(reader([candidate({ database_now: "2026-08-10T12:00:00.001Z" })]).reader.readCurrentInTransaction({ execute: vi.fn(async () => ({
      rows: [candidate({ database_now: "2026-08-10T12:00:00.001Z" })],
    })) } as never, { workspaceId, accountRef: "account_primary", campaignRef: "campaign_primary" }, "2026-08-10T12:00:00.000Z"))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentDecisionCadenceReaderError>>({ code: "corrupt_store" }));
  });

  it.each([
    ["missing", [], "not_found"],
    ["ambiguous", [candidate(), candidate({ revision_id: "33333333-3333-4333-8333-333333333333", profile_ref: "cadence_secondary" })], "ambiguous"],
    ["paused", [candidate({ campaign_status: "PAUSED" })], "paused"],
    ["future", [candidate({ observed_from: "2026-08-11T00:00:00.000Z" })], "future"],
    ["malformed", [candidate({ profile_hash: "a".repeat(64) })], "corrupt_store"],
    ["contract-invalid", [candidate({ profile_payload: { ...profile, maxActionsPerWindow: 4 }, profile_hash: hash({ ...profile, maxActionsPerWindow: 4 }) })], "corrupt_store"],
  ] as const)("fails closed on %s current data", async (_name, rows, code) => {
    await expect(reader(rows).reader.readCurrent({ workspaceId, accountRef: "account_primary", campaignRef: "campaign_primary" }))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentDecisionCadenceReaderError>>({ code }));
  });

  it("rejects malformed caller scope before database I/O", async () => {
    const harness = reader([candidate()]);
    await expect(harness.reader.readCurrent({ workspaceId: "not-a-uuid", accountRef: "account_primary", campaignRef: "campaign_primary" }))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentDecisionCadenceReaderError>>({ code: "invalid_input" }));
    expect(harness.execute).not.toHaveBeenCalled();
  });
});
