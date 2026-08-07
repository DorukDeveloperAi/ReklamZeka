import { describe, expect, it, vi } from "vitest";
import {
  classifyMetaInventoryCanonicalDelta,
  MetaInventoryMaterializationError,
  parseMetaInventoryPage,
  type CanonicalMetaInventoryPage,
  type MetaInventoryPagePersistencePort,
} from "@/connectors/meta/sync/inventory-materialization";
import { MetaPartialReadSyncRuntime } from "@/connectors/meta/sync/runtime";
import type { MetaReadRequest, MetaReadTransport, MetaSyncSlice } from "@/connectors/meta/sync/types";

const observedAt = "2026-08-07T12:00:00.000Z";
const cursorId = "a".repeat(64);

function parse(level: "campaign" | "ad_set" | "ad", records: readonly Readonly<Record<string, unknown>>[], terminal = true) {
  return parseMetaInventoryPage({
    workspaceId: "workspace_test", connectionId: "connection_test", externalAccountId: "act_100",
    parentRunId: "run_test", sliceId: `inventory:act_100:${level}:all:all`, cursorId,
    entityLevel: level, observedAt, sourceGraphVersion: "v23.0",
    fieldCatalogVersion: "meta-inventory-field-catalog/1.0.0", terminal, records,
  });
}

function campaign(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    id: "campaign_1", name: "Campaign 1", status: "ACTIVE", effective_status: "ACTIVE",
    objective: "OUTCOME_LEADS", buying_type: "AUCTION", special_ad_categories: [],
    daily_budget: "12000", lifetime_budget: null, updated_time: "2026-08-07T11:30:00+0000",
    ...overrides,
  };
}

describe("Meta canonical inventory parser", () => {
  it("materializes requested campaign facts without inventing an objective mapping or retaining raw material", () => {
    const page = parse("campaign", [campaign({ access_token: "must-never-persist" })]);
    const row = page.records[0]!;
    expect(row).toMatchObject({
      level: "campaign", externalId: "campaign_1", configuredStatus: "ACTIVE",
      objectiveSource: "OUTCOME_LEADS", canonicalObjective: null, objectiveMappingVersion: null,
      specialAdCategories: [], dailyBudgetMinor: 12000, campaignBudgetOptimization: true,
      trace: { sourceRevision: "2026-08-07T11:30:00.000Z", sourceGraphVersion: "v23.0" },
    });
    expect(row.unsupportedFields).toEqual(expect.arrayContaining([
      { field: "canonical_objective", reason: "mapping_not_reviewed" },
      { field: "access_token", reason: "unrequested_field" },
    ]));
    expect(JSON.stringify(page)).not.toContain("must-never-persist");
    expect(page.pageHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps missing and malformed optional fields as reasoned unknowns without mutating a frozen issue list", () => {
    const page = parse("ad_set", [{
      id: "adset_1", name: "Ad Set", campaign_id: "campaign_1",
      status: 42, effective_status: "ACTIVE", optimization_goal: null,
      billing_event: "IMPRESSIONS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      bid_amount: "invalid", daily_budget: null, lifetime_budget: null,
      attribution_spec: "invalid", promoted_object: { page_id: "page_1" },
    }]);
    const row = page.records[0]!;
    expect(row).toMatchObject({
      level: "ad_set", configuredStatus: null, optimizationGoal: null,
      bidAmountMinor: null, attributionSpec: null, promotedObject: { page_id: "page_1" },
      trace: { provenance: { sourcePriority: 10 } },
    });
    expect(row.unsupportedFields).toEqual(expect.arrayContaining([
      { field: "status", reason: "invalid_type" },
      { field: "bid_amount", reason: "invalid_value" },
      { field: "attribution_spec", reason: "invalid_type" },
      { field: "updated_time", reason: "missing_field" },
    ]));
    expect(Object.isFrozen(row.unsupportedFields)).toBe(true);
  });

  it("preserves ad hierarchy and creative identity while explicitly leaving tracking unknown", () => {
    const page = parse("ad", [{
      id: "ad_1", name: "Ad", status: "PAUSED", effective_status: "PAUSED",
      campaign_id: "campaign_1", adset_id: "adset_1", creative: { id: "creative_1" },
      updated_time: "2026-08-07T10:00:00Z",
    }]);
    expect(page.records[0]).toMatchObject({
      level: "ad", externalCampaignId: "campaign_1", externalAdSetId: "adset_1",
      externalCreativeId: "creative_1",
      unsupportedFields: expect.arrayContaining([{ field: "tracking_specs", reason: "field_not_requested" }]),
    });
  });

  it("rejects missing required hierarchy and duplicate page identities", () => {
    expect(() => parse("ad_set", [{ id: "adset_1", name: "Ad Set" }]))
      .toThrow(MetaInventoryMaterializationError);
    expect(() => parse("campaign", [campaign(), campaign()]))
      .toThrowError(expect.objectContaining({ code: "duplicate_identity" }));
  });

  it("rejects pages claiming an unrecognized inventory field catalog", () => {
    expect(() => parseMetaInventoryPage({
      workspaceId: "workspace_test", connectionId: "connection_test", externalAccountId: "act_100",
      parentRunId: "run_test", sliceId: "inventory:act_100:campaign:all:all", cursorId,
      entityLevel: "campaign", observedAt, sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "meta-inventory-field-catalog/unknown", terminal: true, records: [campaign()],
    })).toThrow(MetaInventoryMaterializationError);
  });

  it("never lets a later fetch fallback overwrite higher-priority Meta updated_time evidence", () => {
    expect(classifyMetaInventoryCanonicalDelta(
      { sourceRevision: "2026-08-01T00:00:00.000Z", sourcePriority: 20, payloadHash: "a".repeat(64) },
      { sourceRevision: "2026-08-07T12:00:00.000Z", sourcePriority: 10, payloadHash: "b".repeat(64) },
    )).toBe("stale");
    expect(classifyMetaInventoryCanonicalDelta(
      { sourceRevision: "2026-08-07T12:00:00.000Z", sourcePriority: 10, payloadHash: "a".repeat(64) },
      { sourceRevision: "2026-08-01T00:00:00.000Z", sourcePriority: 20, payloadHash: "b".repeat(64) },
    )).toBe("updated");
  });
});

class PageWriter implements MetaInventoryPagePersistencePort {
  readonly pages: CanonicalMetaInventoryPage[] = [];
  async writePage(page: CanonicalMetaInventoryPage) {
    this.pages.push(structuredClone(page));
    return { inserted: page.records.length, updated: 0, unchanged: 0, stale: 0, disappeared: 0, pageHash: page.pageHash };
  }
}

const slice: MetaSyncSlice = {
  id: "inventory:act_100:campaign:all:all", stream: "inventory", accountId: "act_100",
  entityLevel: "campaign", dateStart: null, dateStop: null, pageSize: 10,
};

describe("Meta inventory runtime materialization hook", () => {
  it("writes every canonical page before advancing pagination and marks only the final page terminal", async () => {
    const writer = new PageWriter();
    const requests: MetaReadRequest[] = [];
    const transport: MetaReadTransport = {
      async get(request) {
        requests.push(request);
        return {
          records: [campaign({ id: request.cursor ? "campaign_2" : "campaign_1" })],
          nextCursor: request.cursor ? null : "opaque-next",
          usageHeadroom: 0.5, sourceGraphVersion: "v23.0",
          fieldCatalogVersion: "meta-inventory-field-catalog/1.0.0",
        };
      },
    };
    const runtime = new MetaPartialReadSyncRuntime({
      transport, inventoryPagePersistence: writer, now: () => new Date(observedAt),
    });
    const result = await runtime.run({ parentRunId: "run_test", workspaceId: "workspace_test", connectionId: "connection_test", plan: [slice] });
    expect(result.parentRun.status).toBe("completed");
    expect(requests.map((entry) => entry.cursor)).toEqual([null, "opaque-next"]);
    expect(writer.pages.map((entry) => entry.terminal)).toEqual([false, true]);
    expect(writer.pages.map((entry) => entry.records[0]?.externalId)).toEqual(["campaign_1", "campaign_2"]);
    expect(runtime.store.snapshot().records.map((entry) => entry.payload)).toEqual([{}, {}]);
  });

  it("fails closed before cursor advancement when provenance metadata is missing", async () => {
    const writer = new PageWriter();
    const transport: MetaReadTransport = { get: vi.fn(async () => ({ records: [campaign()], nextCursor: null, usageHeadroom: 0.5 })) };
    const runtime = new MetaPartialReadSyncRuntime({ transport, inventoryPagePersistence: writer, now: () => new Date(observedAt) });
    const result = await runtime.run({ parentRunId: "run_test", workspaceId: "workspace_test", connectionId: "connection_test", plan: [slice] });
    expect(result.parentRun.status).toBe("failed");
    expect(result.streamRuns[0]?.error?.reason).toBe("malformed_response");
    expect(result.streamRuns[0]?.cursorBySlice).toEqual({});
    expect(writer.pages).toHaveLength(0);
  });

  it("isolates a persistence failure as a redacted non-retryable slice result", async () => {
    const transport: MetaReadTransport = { get: vi.fn(async () => ({
      records: [campaign()], nextCursor: null, usageHeadroom: 0.5,
      sourceGraphVersion: "v23.0", fieldCatalogVersion: "meta-inventory-field-catalog/1.0.0",
    })) };
    const runtime = new MetaPartialReadSyncRuntime({
      transport, now: () => new Date(observedAt),
      inventoryPagePersistence: { writePage: vi.fn(async () => { throw new Error("postgres secret storage detail"); }) },
    });
    const result = await runtime.run({ parentRunId: "run_test", workspaceId: "workspace_test", connectionId: "connection_test", plan: [slice] });
    expect(result.parentRun.status).toBe("failed");
    expect(result.streamRuns[0]?.error).toEqual({
      reason: "unknown", retryable: false, message: "Meta inventory canonical kaydı güvenli biçimde tamamlanamadı",
    });
    expect(JSON.stringify(result)).not.toContain("postgres secret storage detail");
    expect(result.streamRuns[0]?.cursorBySlice).toEqual({});
  });
});
