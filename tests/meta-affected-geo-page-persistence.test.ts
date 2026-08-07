import { describe, expect, it, vi } from "vitest";
import { appendKnownAffectedGeoForCanonicalAdSetPage } from "@/connectors/meta/sync/affected-geo-page-persistence";
import { META_INVENTORY_FIELD_CATALOG_VERSION, parseMetaInventoryPage,
  type MetaInventoryCanonicalWriteOutcome } from "@/connectors/meta/sync/inventory-materialization";

const workspaceId = "workspace_fixture";
const rawKnown = Object.freeze({ id: "adset_fixture", name: "Private AdSet", campaign_id: "campaign_fixture",
  status: "ACTIVE", effective_status: "ACTIVE", optimization_goal: "LINK_CLICKS", billing_event: "IMPRESSIONS",
  bid_strategy: "LOWEST_COST_WITHOUT_CAP", bid_amount: null, daily_budget: "1000", lifetime_budget: null,
  attribution_spec: [], promoted_object: {}, updated_time: "2026-08-08T10:00:00Z",
  targeting: { geo_locations: { countries: ["AA"], location_types: ["home"] } } });

function page(rawRecord: Readonly<Record<string, unknown>> = rawKnown) {
  return parseMetaInventoryPage({ workspaceId, connectionId: "connection_fixture", externalAccountId: "act_fixture",
    parentRunId: "run_fixture", sliceId: "inventory:act_fixture:ad_set:all:all", cursorId: "a".repeat(64),
    entityLevel: "ad_set", observedAt: "2026-08-08T12:00:00.000Z", sourceGraphVersion: "v23.0",
    fieldCatalogVersion: META_INVENTORY_FIELD_CATALOG_VERSION, terminal: true, records: [rawRecord] });
}

const hierarchy = Object.freeze([{ externalAdSetId: "adset_fixture", campaignId: "22222222-2222-4222-8222-222222222222",
  adSetId: "33333333-3333-4333-8333-333333333333" }]);

function run(rawRecord: Readonly<Record<string, unknown>>, outcome: MetaInventoryCanonicalWriteOutcome,
  append = vi.fn(async () => ({ outcome: "inserted" as const }))) {
  return { append, promise: appendKnownAffectedGeoForCanonicalAdSetPage({ page: page(rawRecord),
    privateSource: { records: [rawRecord] }, adAccountId: "11111111-1111-4111-8111-111111111111",
    hierarchy, outcomes: [outcome], repository: { append } }) };
}

describe("affected-geo canonical page transaction coordinator", () => {
  it("appends only a known snapshot using resolved internal hierarchy and returns no raw targeting", async () => {
    const operation = run(rawKnown, "inserted");
    await expect(operation.promise).resolves.toEqual({ known: 1, unknown: 0, stale: 0, inserted: 1, unchanged: 0 });
    expect(operation.append).toHaveBeenCalledTimes(1);
    expect(operation.append).toHaveBeenCalledWith(expect.objectContaining({ workspaceId,
      adAccountId: "11111111-1111-4111-8111-111111111111", campaignId: hierarchy[0]!.campaignId,
      adSetId: hierarchy[0]!.adSetId, snapshot: expect.objectContaining({ status: "known" }) }));
    expect(JSON.stringify(await operation.promise)).not.toMatch(/targeting|countries|"AA"/);
  });

  it("keeps unsupported targeting as unknown without failing the page or creating evidence", async () => {
    const unsupported = { ...rawKnown, targeting: { geo_locations: { countries: ["AA"], location_types: ["home"],
      regions: [{ key: "SENSITIVE_REGION" }] } } };
    const operation = run(unsupported, "updated");
    await expect(operation.promise).resolves.toEqual({ known: 0, unknown: 1, stale: 0, inserted: 0, unchanged: 0 });
    expect(operation.append).not.toHaveBeenCalled();
  });

  it("validates stale source binding but never appends stale geo evidence", async () => {
    const operation = run(rawKnown, "stale");
    await expect(operation.promise).resolves.toEqual({ known: 0, unknown: 0, stale: 1, inserted: 0, unchanged: 0 });
    expect(operation.append).not.toHaveBeenCalled();
  });

  it("replays idempotently through the immutable repository outcome", async () => {
    const append = vi.fn().mockResolvedValueOnce({ outcome: "inserted" }).mockResolvedValueOnce({ outcome: "unchanged" });
    const first = run(rawKnown, "inserted", append); await expect(first.promise).resolves.toMatchObject({ inserted: 1 });
    const replay = run(rawKnown, "unchanged", append); await expect(replay.promise).resolves.toMatchObject({ unchanged: 1 });
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[1]?.[0].snapshot.snapshotHash).toBe(append.mock.calls[0]?.[0].snapshot.snapshotHash);
  });

  it("fails the page closed for raw hash/source mismatch and partial hierarchy", async () => {
    const canonical = page(rawKnown); const changed = { ...rawKnown, targeting: null };
    const append = vi.fn(async () => ({ outcome: "inserted" as const }));
    await expect(appendKnownAffectedGeoForCanonicalAdSetPage({ page: canonical,
      privateSource: { records: [changed] }, adAccountId: "11111111-1111-4111-8111-111111111111",
      hierarchy, outcomes: ["updated"], repository: { append } })).rejects.toThrow("private page binding");
    await expect(appendKnownAffectedGeoForCanonicalAdSetPage({ page: canonical,
      privateSource: { records: [rawKnown] }, adAccountId: "11111111-1111-4111-8111-111111111111",
      hierarchy: [], outcomes: ["updated"], repository: { append } })).rejects.toThrow("private page binding");
    expect(append).not.toHaveBeenCalled();
  });

  it("propagates immutable append failure so the outer canonical transaction can roll back before checkpoint", async () => {
    const append = vi.fn(async () => { throw new Error("fixture append rollback"); });
    const operation = run(rawKnown, "inserted", append);
    await expect(operation.promise).rejects.toThrow("fixture append rollback");
  });
});
