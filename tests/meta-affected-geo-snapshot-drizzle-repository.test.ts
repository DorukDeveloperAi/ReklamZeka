import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  DrizzleMetaAffectedGeoSnapshotRepository,
  MetaAffectedGeoSnapshotRepositoryError,
} from "@/connectors/meta/meta-affected-geo-snapshot-drizzle-repository";
import {
  hashMetaAffectedGeoSourceSubtree,
  normalizeMetaAffectedGeoCountries,
  type CanonicalAffectedGeoCountrySnapshot,
} from "@/domain/meta/affected-geo-country-snapshot";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const accountId = "22222222-2222-4222-a222-222222222222";
const campaignId = "33333333-3333-4333-a333-333333333333";
const adSetId = "44444444-4444-4444-a444-444444444444";
const snapshotId = "55555555-5555-4555-a555-555555555555";
const h = (value: string) => value.repeat(64);

function snapshot(): CanonicalAffectedGeoCountrySnapshot {
  const targeting = { geo_locations: { countries: ["TR", "DE"], location_types: ["home", "recent"] } };
  const result = normalizeMetaAffectedGeoCountries({ sourceKind: "meta_graph_adset_targeting",
    scope: { workspaceRef: "workspace_alpha", accountRef: "account_doruk", campaignRef: "campaign_leads", adSetRef: "adset_leads" },
    sourceGraphVersion: "v23.0", fieldCatalogVersion: "catalog-meta/1.0.0", fetchedAt: "2026-08-08T12:00:00.000Z",
    provenance: { observationRunRef: "observation_sync", sliceRef: "slice_adsets", pageRef: "page_one",
      rawPayloadHash: h("a"), sourceGeoSubtreeHash: hashMetaAffectedGeoSourceSubtree(targeting) }, targeting });
  if (result.status !== "known") throw new Error("fixture_failed");
  return result;
}
function row(value = snapshot(), patch: Record<string, unknown> = {}) {
  return { id: snapshotId, workspace_id: workspaceId, ad_account_id: accountId, campaign_id: campaignId, ad_set_id: adSetId,
    workspace_ref: value.scope.workspaceRef, account_ref: value.scope.accountRef, campaign_ref: value.scope.campaignRef,
    ad_set_ref: value.scope.adSetRef, schema_version: value.version, source_kind: value.sourceKind, status: value.status,
    source_graph_version: value.source.sourceGraphVersion, field_catalog_version: value.source.fieldCatalogVersion,
    captured_at: value.capturedAt, observation_run_ref: value.source.observationRunRef, slice_ref: value.source.sliceRef,
    page_ref: value.source.pageRef, raw_payload_hash: value.source.rawPayloadHash,
    source_geo_subtree_hash: value.source.sourceGeoSubtreeHash, snapshot_hash: value.snapshotHash,
    item_count: value.items.length, location_type_count: value.locationTypes.length, ...patch };
}
function itemRows(value = snapshot()) { return value.items.map((item) => ({ polarity: item.polarity, geo_type: item.geoType, geo_ref: item.geoRef })); }
function locationRows(value = snapshot()) { return value.locationTypes.map((location_type) => ({ location_type })); }
function binding(value = snapshot(), patch: Record<string, unknown> = {}) {
  return { workspaceId, adAccountId: accountId, campaignId, adSetId, snapshot: value, ...patch };
}
function exact(value = snapshot(), patch: Record<string, unknown> = {}) {
  return { workspaceId, workspaceRef: value.scope.workspaceRef, adAccountId: accountId, accountRef: value.scope.accountRef,
    campaignId, campaignRef: value.scope.campaignRef, adSetId, adSetRef: value.scope.adSetRef, capturedAt: value.capturedAt,
    sourceGraphVersion: value.source.sourceGraphVersion, fieldCatalogVersion: value.source.fieldCatalogVersion,
    rawPayloadHash: value.source.rawPayloadHash, sourceGeoSubtreeHash: value.source.sourceGeoSubtreeHash,
    snapshotHash: value.snapshotHash, ...patch };
}
function database(results: readonly unknown[]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
  return { execute, transaction };
}

describe("Drizzle canonical Meta affected-geo persistence", () => {
  it("appends only a known canonical snapshot and writes hash-only items atomically", async () => {
    const value = snapshot();
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [{ id: adSetId }] },
      { rows: [] }, { rows: [{ id: snapshotId }] }, { rows: [{ count: value.items.length }] },
      { rows: [{ count: value.locationTypes.length }] }]);
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(db as never, workspaceId).append(binding(value)))
      .resolves.toEqual({ outcome: "inserted", snapshotId, snapshotHash: value.snapshotHash });
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for update");
    const statements = db.execute.mock.calls.map((call) => dialect.sqlToQuery(call[0]).sql).join("\n");
    expect(statements).not.toMatch(/country_code|country_name|latitude|longitude|address|targeting_payload/i);
  });

  it("returns unchanged only when header and every child exactly reconstruct the snapshot", async () => {
    const value = snapshot();
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [{ id: adSetId }] },
      { rows: [row(value)] }, { rows: itemRows(value) }, { rows: locationRows(value) }]);
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(db as never, workspaceId).append(binding(value)))
      .resolves.toEqual({ outcome: "unchanged", snapshotId, snapshotHash: value.snapshotHash });
  });

  it("fails closed before insert when the same exact source identity has another snapshot hash", async () => {
    const value = snapshot();
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [{ id: adSetId }] },
      { rows: [row(value, { snapshot_hash: h("f") })] }]);
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(db as never, workspaceId).append(binding(value)))
      .rejects.toMatchObject({ code: "snapshot_conflict" });
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it("resolves by exact tenant, hierarchy refs/IDs, capture time, versions, source hashes and snapshot hash", async () => {
    const value = snapshot();
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(value)] },
      { rows: itemRows(value) }, { rows: locationRows(value) }]);
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(db as never, workspaceId).resolveExact(exact(value)))
      .resolves.toEqual(value);
    const query = new PgDialect().sqlToQuery(db.execute.mock.calls[1]![0]).sql;
    for (const column of ["workspace_ref", "ad_account_id", "account_ref", "campaign_id", "campaign_ref", "ad_set_id",
      "ad_set_ref", "captured_at", "source_graph_version", "field_catalog_version", "raw_payload_hash",
      "source_geo_subtree_hash", "snapshot_hash"]) expect(query).toContain(column);
  });

  it("fails closed for missing, ambiguous, partial, corrupt and cross-tenant records", async () => {
    const value = snapshot();
    const missing = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }]);
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(missing as never, workspaceId).resolveExact(exact(value)))
      .rejects.toMatchObject({ code: "not_found" });
    const ambiguous = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(value), row(value)] }]);
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(ambiguous as never, workspaceId).resolveExact(exact(value)))
      .rejects.toMatchObject({ code: "ambiguous" });
    for (const stored of [
      [{ rows: [row(value)] }, { rows: itemRows(value).slice(1) }, { rows: locationRows(value) }],
      [{ rows: [row(value, { snapshot_hash: h("f") })] }, { rows: itemRows(value) }, { rows: locationRows(value) }],
      [{ rows: [row(value, { workspace_id: "66666666-6666-4666-a666-666666666666" })] }],
    ]) {
      const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, ...stored]);
      await expect(new DrizzleMetaAffectedGeoSnapshotRepository(db as never, workspaceId).resolveExact(exact(value)))
        .rejects.toMatchObject({ code: "corrupt_store" });
    }
    const untouched = database([]);
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(untouched as never, workspaceId).resolveExact(exact(value, {
      workspaceId: "66666666-6666-4666-a666-666666666666",
    }))).rejects.toMatchObject({ code: "workspace_scope_mismatch" });
    expect(untouched.execute).not.toHaveBeenCalled();
  });

  it("rejects invalid hierarchy and forged/non-canonical input without persistence", async () => {
    const hierarchy = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }]);
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(hierarchy as never, workspaceId).append(binding()))
      .rejects.toMatchObject({ code: "hierarchy_scope_mismatch" });
    const untouched = database([]); const value = snapshot();
    await expect(new DrizzleMetaAffectedGeoSnapshotRepository(untouched as never, workspaceId)
      .append(binding({ ...value, snapshotHash: h("0") } as never))).rejects.toMatchObject({ code: "invalid_input" });
    expect(untouched.execute).not.toHaveBeenCalled();
  });

  it("exposes no Meta call, update, delete, policy, approval or execution method", () => {
    expect(Object.getOwnPropertyNames(DrizzleMetaAffectedGeoSnapshotRepository.prototype).sort())
      .toEqual(["append", "constructor", "loadChildren", "resolveExact"]);
    expect(() => new DrizzleMetaAffectedGeoSnapshotRepository({} as never, "invalid"))
      .toThrow(MetaAffectedGeoSnapshotRepositoryError);
  });
});
