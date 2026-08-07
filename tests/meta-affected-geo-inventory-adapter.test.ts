import { describe, expect, it } from "vitest";
import { affectedGeoSnapshotFromCanonicalInventoryAdSetRaw, META_AFFECTED_GEO_INVENTORY_ADAPTER_VERSION,
  META_AFFECTED_GEO_SOURCE_FIELD_CATALOG_VERSION } from "@/connectors/meta/sync/affected-geo-inventory-adapter";
import { stableHash } from "@/connectors/meta/sync/types";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "synthetic-adset-private", campaign_id: "synthetic-campaign-private", name: "SENSITIVE_PRIVATE_NAME",
    targeting: { geo_locations: { countries: ["AA", "ZZ"], location_types: ["home", "recent"] } },
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const rawRecord = Object.hasOwn(overrides, "rawRecord") ? overrides.rawRecord : raw();
  return {
    workspaceId: "synthetic-workspace-private", connectionId: "synthetic-connection-private",
    externalAccountId: "synthetic-account-private", entityLevel: "ad_set", parentRunId: "synthetic-run-private",
    sliceId: "inventory:synthetic-account-private:ad_set:all:all", cursorId: "a".repeat(64),
    pageHash: "b".repeat(64), observedAt: "2026-08-08T12:00:00.000Z",
    sourceGraphVersion: "v23.0", fieldCatalogVersion: META_AFFECTED_GEO_SOURCE_FIELD_CATALOG_VERSION,
    rawPayloadHash: stableHash(rawRecord), rawRecord, ...overrides,
  };
}

describe("Meta affected-geo canonical inventory private adapter", () => {
  it("binds exact hierarchy and page provenance into digest-only refs and a known snapshot", () => {
    const first = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate());
    const second = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate());
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: META_AFFECTED_GEO_INVENTORY_ADAPTER_VERSION,
      status: "bound",
      binding: {
        workspaceRef: expect.stringMatching(/^workspace_[a-f0-9]{64}$/),
        connectionRef: expect.stringMatching(/^connection_[a-f0-9]{64}$/),
        accountRef: expect.stringMatching(/^account_[a-f0-9]{64}$/),
        campaignRef: expect.stringMatching(/^campaign_[a-f0-9]{64}$/),
        adSetRef: expect.stringMatching(/^adset_[a-f0-9]{64}$/),
        observationRunRef: expect.stringMatching(/^observation_[a-f0-9]{64}$/),
        sliceRef: expect.stringMatching(/^slice_[a-f0-9]{64}$/),
        cursorRef: expect.stringMatching(/^cursor_[a-f0-9]{64}$/),
        pageRef: expect.stringMatching(/^page_[a-f0-9]{64}$/),
      },
      snapshot: { status: "known", items: [
        { polarity: "included", geoType: "country", geoRef: expect.stringMatching(/^geo_[a-f0-9]{64}$/) },
        { polarity: "included", geoType: "country", geoRef: expect.stringMatching(/^geo_[a-f0-9]{64}$/) },
      ], locationTypes: ["home", "recent"], snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      capabilities: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false },
    });
    const serialized = JSON.stringify(first);
    for (const sourceValue of ["synthetic-workspace-private", "synthetic-connection-private",
      "synthetic-account-private", "synthetic-campaign-private", "synthetic-adset-private",
      "synthetic-run-private", "SENSITIVE_PRIVATE_NAME", '"AA"', '"ZZ"', "geo_locations", "countries"]) {
      expect(serialized).not.toContain(sourceValue);
    }
  });

  it("hierarchically changes safe bindings and snapshot identity when exact scope or page provenance changes", () => {
    const base = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate());
    const connection = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate({ connectionId: "synthetic-connection-other" }));
    const changedRaw = raw({ campaign_id: "synthetic-campaign-other", id: "synthetic-adset-other" });
    const hierarchy = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate({ rawRecord: changedRaw,
      rawPayloadHash: stableHash(changedRaw) }));
    const page = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate({ pageHash: "c".repeat(64) }));
    expect(base.status).toBe("bound"); expect(connection.status).toBe("bound");
    expect(hierarchy.status).toBe("bound"); expect(page.status).toBe("bound");
    if (base.status !== "bound" || connection.status !== "bound" || hierarchy.status !== "bound" || page.status !== "bound") return;
    expect(connection.binding.accountRef).not.toBe(base.binding.accountRef);
    expect(connection.snapshot.status === "known" && base.snapshot.status === "known"
      && connection.snapshot.snapshotHash).not.toBe(base.snapshot.status === "known" && base.snapshot.snapshotHash);
    expect(hierarchy.binding.campaignRef).not.toBe(base.binding.campaignRef);
    expect(hierarchy.binding.adSetRef).not.toBe(base.binding.adSetRef);
    expect(page.binding.pageRef).not.toBe(base.binding.pageRef);
    expect(page.snapshot.status === "known" && base.snapshot.status === "known"
      && page.snapshot.snapshotHash).not.toBe(base.snapshot.status === "known" && base.snapshot.snapshotHash);
  });

  it.each([
    ["missing targeting", raw({ targeting: undefined })],
    ["unsupported region", raw({ targeting: { geo_locations: { countries: ["AA"], location_types: ["home"],
      regions: [{ key: "SENSITIVE_REGION" }] } } })],
    ["excluded geo", raw({ targeting: { geo_locations: { countries: ["AA"], location_types: ["home"] },
      excluded_geo_locations: {} } })],
    ["unsupported location type", raw({ targeting: { geo_locations: { countries: ["AA"],
      location_types: ["travel_in"] } } })],
  ])("returns a bound but fail-closed unknown snapshot for %s", (_label, rawRecord) => {
    if (_label === "missing targeting") delete rawRecord.targeting;
    const result = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate({ rawRecord,
      rawPayloadHash: stableHash(rawRecord) }));
    expect(result).toMatchObject({ status: "bound", snapshot: { status: "unknown", availability: "mixed_unavailable" },
      capabilities: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false } });
    expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|"AA"|travel_in|geo_locations|countries/);
  });

  it("fails closed without bindings when the canonical raw payload hash does not match", () => {
    const result = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate({ rawPayloadHash: "f".repeat(64) }));
    expect(result).toEqual({ version: META_AFFECTED_GEO_INVENTORY_ADAPTER_VERSION, status: "unknown",
      availability: "mixed_unavailable", reasonCode: "raw_payload_hash_mismatch",
      capabilities: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false } });
  });

  it.each([
    ["Graph version", { sourceGraphVersion: "v24.0" }],
    ["catalog", { fieldCatalogVersion: "meta-inventory-field-catalog/1.0.0" }],
    ["entity level", { entityLevel: "campaign" }],
    ["scope", { externalAccountId: "" }],
    ["cursor", { cursorId: "short" }],
    ["page", { pageHash: "short" }],
    ["time", { observedAt: "2026-08-08T15:00:00+03:00" }],
    ["extension", { extra: "SENSITIVE_EXTENSION" }],
  ])("rejects an invalid %s boundary without echoing private material", (_label, overrides) => {
    const result = affectedGeoSnapshotFromCanonicalInventoryAdSetRaw(candidate(overrides));
    expect(result).toMatchObject({ status: "unknown", availability: "mixed_unavailable",
      reasonCode: "invalid_inventory_boundary" });
    expect(result).not.toHaveProperty("binding"); expect(result).not.toHaveProperty("snapshot");
    expect(JSON.stringify(result)).not.toContain("SENSITIVE_EXTENSION");
  });
});
