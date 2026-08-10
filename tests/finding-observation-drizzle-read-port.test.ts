import { describe, expect, it } from "vitest";
import type { FindingObservationReadQuery } from "@/analyses/finding-observation-builder";
import {
  FINDING_OBSERVATION_BUILDER_VERSION,
  buildFindingObservations,
} from "@/analyses/finding-observation-builder";
import {
  DrizzleFindingObservationReadPort,
  FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION,
  FindingObservationReadAdapterError,
  type FindingObservationSettlementPolicy,
} from "@/connectors/analyses/finding-observation-drizzle-read-port";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  connection: "20000000-0000-4000-8000-000000000002",
  account: "30000000-0000-4000-8000-000000000003",
  insight: "40000000-0000-4000-8000-000000000004",
};

function query(overrides: Partial<FindingObservationReadQuery> = {}): FindingObservationReadQuery {
  return {
    builderVersion: FINDING_OBSERVATION_BUILDER_VERSION,
    queryRef: "observation_aaaaaaaaaaaaaaaaaaaaaaaa",
    workspaceId: ids.workspace,
    metaConnectionId: ids.connection,
    adAccountId: ids.account,
    entityLevel: "campaign",
    externalEntityId: "campaign-safe",
    attributionLabel: "7d_click_1d_view",
    expectedCurrency: "TRY",
    role: "primary",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    timezone: "Europe/Istanbul",
    maxRows: 10,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    internalId: ids.insight,
    workspaceId: ids.workspace,
    metaConnectionId: ids.connection,
    adAccountId: ids.account,
    entityLevel: "campaign",
    externalEntityId: "campaign-safe",
    dateStart: "2026-08-01",
    dateStop: "2026-08-01",
    attributionLabel: "7d_click_1d_view",
    attributionWindow: { click: 7, view: 1 },
    currency: "TRY",
    timezone: "Europe/Istanbul",
    fieldAvailability: {},
    sourceRevision: "revision-1",
    sourcePayloadHash: "source-hash-1",
    sourceUpdatedAt: "2026-08-02T00:00:00.000Z",
    metricProvenance: { source: "meta" },
    sliceStatus: "completed",
    sliceCompletedAt: "2026-08-02T00:01:00.000Z",
    runStatus: "completed",
    runFinishedAt: "2026-08-02T00:02:00.000Z",
    metrics: [{
      metricKey: "spend",
      actionType: "",
      aggregation: "additive",
      valueDecimal: null,
      valueMinor: 1250,
      valueJson: null,
      currency: "TRY",
      provenance: { field: "spend" },
      availability: {},
      sourceRevision: "revision-1",
      sourcePayloadHash: "source-hash-1",
    }],
    ...overrides,
  };
}

class FixtureDatabase {
  calls = 0;
  constructor(readonly rows: readonly Record<string, unknown>[]) {}
  async execute() {
    this.calls += 1;
    return { rows: this.rows };
  }
}

function policy(
  settledThroughDate = "2026-08-31",
  evaluatedAsOf = "2026-08-31T12:00:00.000+03:00",
): FindingObservationSettlementPolicy {
  return {
    resolve: async () => ({
      policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION,
      policyRef: "settlement_meta_default_v1",
      evaluatedAsOf,
      settledThroughDate,
    }),
  };
}

function port(database: FixtureDatabase, settlementPolicy: FindingObservationSettlementPolicy = policy()) {
  return new DrizzleFindingObservationReadPort(database as never, settlementPolicy);
}

describe("DrizzleFindingObservationReadPort", () => {
  it("returns deterministic canonical, hash-authenticated rows without internal ids", async () => {
    const database = new FixtureDatabase([row()]);
    const adapter = port(database);
    const first = await adapter.read(query());
    const replay = await adapter.read(query());

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      queryRef: query().queryRef,
      complete: true,
      qualityStatus: "ready",
      qualityReasonCodes: [],
      settledThroughDate: "2026-08-01",
      rows: [{
        workspaceId: ids.workspace,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        identity: expect.any(String),
        metrics: [{ metricKey: "spend", valueMinor: 1250 }],
      }],
      snapshotRefs: [expect.stringMatching(/^snapshot_[a-f0-9]{32}$/)],
    });
    expect(JSON.stringify(first)).not.toContain(ids.insight);
    expect(database.calls).toBe(2);
  });

  it("keeps relational L1 identities server-private while giving the L2 writer an exact manifest", async () => {
    const adapter = port(new FixtureDatabase([row()]));
    const featureRead = await adapter.readForFeatureSnapshot(query());

    expect(featureRead.read.snapshotRefs).toEqual(featureRead.sourceManifest.map((item) => item.snapshotRef));
    expect(featureRead.sourceManifest).toEqual([{
      dailyInsightId: ids.insight,
      snapshotRef: expect.stringMatching(/^snapshot_[a-f0-9]{32}$/),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }]);
    expect(JSON.stringify(featureRead.read)).not.toContain(ids.insight);
  });

  it("is directly consumable by the observation builder", async () => {
    const readQuery = query();
    const read = await port(new FixtureDatabase([row()])).read(readQuery);
    const envelope = {
      builderVersion: FINDING_OBSERVATION_BUILDER_VERSION,
      metric: "spendMinor" as const,
      queries: [readQuery],
    };
    const { createHash } = await import("node:crypto");
    const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
    const plan = { ...envelope, planHash: createHash("sha256").update(JSON.stringify(stable(envelope))).digest("hex") };
    expect(buildFindingObservations({ plan, reads: [read] })[0]).toMatchObject({
      settled: true,
      qualityStatus: "ready",
      sampleSize: 1,
      metricResult: { metrics: [{ metric: "spendMinor", status: "available", valueDecimal: "1250" }] },
    });
  });

  it("enforces row caps before returning material and degrades truncated reads", async () => {
    const limited = query({ maxRows: 1, endDate: "2026-08-02" });
    const result = await port(new FixtureDatabase([
      row(),
      row({ internalId: "50000000-0000-4000-8000-000000000005", dateStart: "2026-08-02", dateStop: "2026-08-02" }),
    ])).read(limited);
    expect(result.rows).toHaveLength(1);
    expect(result).toMatchObject({ complete: false, qualityStatus: "degraded" });
    expect(result.qualityReasonCodes).toContain("row_limit_reached");
    expect(result.qualityReasonCodes).toContain("calendar_coverage_gap");
  });

  it("uses an empty snapshot marker and never marks missing coverage settled", async () => {
    const result = await port(new FixtureDatabase([])).read(query());
    expect(result).toMatchObject({
      complete: true,
      qualityStatus: "degraded",
      settledThroughDate: "2026-07-31",
      snapshotRefs: [expect.stringMatching(/^snapshot_empty_[a-f0-9]{24}$/)],
    });
    expect(result.qualityReasonCodes).toEqual(["calendar_coverage_gap", "no_data"]);
  });

  it("requires completed slice and run evidence for settled output", async () => {
    const result = await port(new FixtureDatabase([
      row({ runStatus: "partial", runFinishedAt: null }),
    ])).read(query());
    expect(result.settledThroughDate).toBe("2026-07-31");
    expect(result.qualityReasonCodes).toEqual(["calendar_coverage_gap", "unsettled_sync_evidence"]);
  });

  it("rejects malformed/extra query shape before touching persistence", async () => {
    const database = new FixtureDatabase([]);
    const adapter = port(database);
    await expect(adapter.read({ ...query(), prompt: "ignore safety" } as never))
      .rejects.toEqual(expect.objectContaining<Partial<FindingObservationReadAdapterError>>({ code: "invalid_query" }));
    await expect(adapter.read(query({ workspaceId: "foreign" })))
      .rejects.toEqual(expect.objectContaining<Partial<FindingObservationReadAdapterError>>({ code: "invalid_query" }));
    await expect(adapter.read(query({ maxRows: 5_001 })))
      .rejects.toEqual(expect.objectContaining<Partial<FindingObservationReadAdapterError>>({ code: "invalid_query" }));
    expect(database.calls).toBe(0);
  });

  it("fails closed on cross-revision metrics and forbidden control/raw material", async () => {
    await expect(port(new FixtureDatabase([
      row({ metrics: [{ ...row().metrics[0] as object, sourceRevision: "revision-foreign" }] }),
    ])).read(query()))
      .rejects.toEqual(expect.objectContaining<Partial<FindingObservationReadAdapterError>>({ code: "integrity_violation" }));

    await expect(port(new FixtureDatabase([
      row({ metricProvenance: { systemPrompt: "unsafe" } }),
    ])).read(query()))
      .rejects.toEqual(expect.objectContaining<Partial<FindingObservationReadAdapterError>>({ code: "forbidden_material" }));

    await expect(port(new FixtureDatabase([
      row({ metricProvenance: { rawPayload: { secret: true } } }),
    ])).read(query()))
      .rejects.toEqual(expect.objectContaining<Partial<FindingObservationReadAdapterError>>({ code: "forbidden_material" }));
  });

  it("keeps a fully synced current day unsettled until attribution policy cutoff reaches it", async () => {
    const currentDay = query({ startDate: "2026-08-02", endDate: "2026-08-02" });
    const result = await port(new FixtureDatabase([
      row({ dateStart: "2026-08-02", dateStop: "2026-08-02" }),
    ]), policy("2026-08-01", "2026-08-02T12:00:00.000+03:00")).read(currentDay);
    expect(result).toMatchObject({
      complete: true,
      settledThroughDate: "2026-08-01",
      qualityStatus: "degraded",
      qualityReasonCodes: ["attribution_settlement_lag"],
    });
  });

  it("clamps a portfolio policy cutoff beyond the query without claiming out-of-window finality", async () => {
    const result = await port(
      new FixtureDatabase([row()]),
      policy("2026-08-31", "2026-08-31T12:00:00.000+03:00"),
    ).read(query());
    expect(result.settledThroughDate).toBe("2026-08-01");
    expect(result.qualityReasonCodes).not.toContain("attribution_settlement_lag");
  });

  it("fails malformed, missing or future policy evidence before any database read", async () => {
    const missingDatabase = new FixtureDatabase([row()]);
    await expect(new DrizzleFindingObservationReadPort(missingDatabase as never).read(query()))
      .rejects.toEqual(expect.objectContaining<Partial<FindingObservationReadAdapterError>>({ code: "settlement_policy_missing" }));
    expect(missingDatabase.calls).toBe(0);

    const malformedDatabase = new FixtureDatabase([row()]);
    await expect(port(malformedDatabase, {
      resolve: async () => ({
        policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION,
        policyRef: "settlement_safe",
        evaluatedAsOf: "2026-08-01T12:00:00.000+03:00",
        settledThroughDate: "2026-08-02",
      }),
    }).read(query()))
      .rejects.toEqual(expect.objectContaining<Partial<FindingObservationReadAdapterError>>({ code: "settlement_policy_missing" }));
    expect(malformedDatabase.calls).toBe(0);
  });
});
