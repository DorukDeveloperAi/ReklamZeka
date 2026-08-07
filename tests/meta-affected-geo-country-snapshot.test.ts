import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/meta-affected-geo-country.json";
import {
  hashMetaAffectedGeoSourceSubtree,
  META_AFFECTED_GEO_COUNTRY_SNAPSHOT_VERSION,
  normalizeMetaAffectedGeoCountries,
} from "@/domain/meta/affected-geo-country-snapshot";

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const targeting = Object.hasOwn(overrides, "targeting") ? overrides.targeting : structuredClone(fixture.targeting);
  const provenanceOverride = overrides.provenance as Record<string, unknown> | undefined;
  const sourceGeoSubtreeHash = provenanceOverride && Object.hasOwn(provenanceOverride, "sourceGeoSubtreeHash")
    ? provenanceOverride.sourceGeoSubtreeHash : hashMetaAffectedGeoSourceSubtree(targeting);
  return {
    ...structuredClone(fixture),
    ...overrides,
    targeting,
    provenance: {
      ...structuredClone(fixture.provenance),
      ...provenanceOverride,
      sourceGeoSubtreeHash,
    },
  };
}

describe("canonical Meta affected-geo country snapshot", () => {
  it("normalizes only explicit included countries into deterministic namespaced refs", () => {
    const first = normalizeMetaAffectedGeoCountries(valid());
    const second = normalizeMetaAffectedGeoCountries(valid());
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: META_AFFECTED_GEO_COUNTRY_SNAPSHOT_VERSION,
      sourceKind: "canonical_meta_affected_geo_snapshot",
      status: "known",
      scope: fixture.scope,
      capturedAt: fixture.fetchedAt,
      items: [
        { polarity: "included", geoType: "country", geoRef: expect.stringMatching(/^geo_[a-f0-9]{64}$/) },
        { polarity: "included", geoType: "country", geoRef: expect.stringMatching(/^geo_[a-f0-9]{64}$/) },
      ],
      locationTypes: ["home", "recent"],
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      capabilities: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false },
    });
    expect(JSON.stringify(first)).not.toMatch(/"AA"|"ZZ"|countries|geo_locations/);
  });

  it("uses a typed namespace rather than the bare country-code digest", () => {
    const result = normalizeMetaAffectedGeoCountries(valid({ targeting: {
      geo_locations: { countries: ["AA"], location_types: ["home"] },
    } }));
    expect(result.status).toBe("known");
    if (result.status !== "known") return;
    const bare = createHash("sha256").update("AA").digest("hex");
    expect(result.items[0]?.geoRef).not.toBe(`geo_${bare}`);
  });

  it.each([
    ["missing targeting", undefined],
    ["null targeting", null],
    ["missing geo", {}],
    ["null geo", { geo_locations: null }],
    ["empty countries", { geo_locations: { countries: [], location_types: ["home"] } }],
    ["lowercase", { geo_locations: { countries: ["aa"], location_types: ["home"] } }],
    ["whitespace", { geo_locations: { countries: [" AA"], location_types: ["home"] } }],
    ["wrong length", { geo_locations: { countries: ["AAA"], location_types: ["home"] } }],
    ["mixed values", { geo_locations: { countries: ["AA", 7], location_types: ["home"] } }],
    ["duplicate", { geo_locations: { countries: ["AA", "AA"], location_types: ["home"] } }],
    ["missing location types", { geo_locations: { countries: ["AA"] } }],
    ["empty location types", { geo_locations: { countries: ["AA"], location_types: [] } }],
    ["duplicate location types", { geo_locations: { countries: ["AA"], location_types: ["home", "home"] } }],
    ["unverified travel location", { geo_locations: { countries: ["AA"], location_types: ["travel_in"] } }],
    ["unknown location type", { geo_locations: { countries: ["AA"], location_types: ["SENSITIVE_TYPE"] } }],
    ["region", { geo_locations: { countries: ["AA"], location_types: ["home"], regions: [{ key: "SENSITIVE_REGION" }] } }],
    ["city", { geo_locations: { countries: ["AA"], location_types: ["home"], cities: [{ key: "SENSITIVE_CITY" }] } }],
    ["custom location", { geo_locations: { countries: ["AA"], location_types: ["home"], custom_locations: [{}] } }],
    ["excluded empty", { geo_locations: { countries: ["AA"], location_types: ["home"] }, excluded_geo_locations: {} }],
    ["excluded country", { geo_locations: { countries: ["AA"], location_types: ["home"] }, excluded_geo_locations: { countries: ["ZZ"] } }],
  ])("fails the whole snapshot closed for %s", (_label, targeting) => {
    const input = targeting === undefined ? valid({ targeting: null }) : valid({ targeting });
    if (targeting === undefined) delete input.targeting;
    const result = normalizeMetaAffectedGeoCountries(input);
    expect(result).toMatchObject({ status: "unknown", availability: "mixed_unavailable",
      capabilities: { canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false } });
    expect(result).not.toHaveProperty("items");
    expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|"AA"|"ZZ"/);
  });

  it.each([
    ["wrong workspace prefix", { scope: { ...fixture.scope, workspaceRef: "account_wrong" } }],
    ["scope extension", { scope: { ...fixture.scope, rawId: "SENSITIVE_ID" } }],
    ["unverified Graph version", { sourceGraphVersion: "v24.0" }],
    ["invalid catalog", { fieldCatalogVersion: "bad version" }],
    ["non-canonical time", { fetchedAt: "2026-08-08T15:00:00+03:00" }],
    ["invalid observation ref", { provenance: { ...fixture.provenance, observationRunRef: "bad" } }],
    ["invalid page hash", { provenance: { ...fixture.provenance, rawPayloadHash: "short" } }],
    ["input extension", { extra: "SENSITIVE_EXTENSION" }],
  ])("rejects invalid source contract: %s", (_label, override) => {
    const result = normalizeMetaAffectedGeoCountries(valid(override));
    expect(result).toMatchObject({ status: "unknown", availability: "mixed_unavailable",
      reasonCode: "invalid_source_contract" });
    expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|workspace_fixture|account_fixture|campaign_fixture|adset_fixture/);
  });

  it("rejects a stale or attacker-rehashed geo subtree without partial evidence", () => {
    const input = valid();
    const provenance = input.provenance as Record<string, unknown>;
    input.targeting = { geo_locations: { countries: ["AA"], location_types: ["home"] } };
    provenance.sourceGeoSubtreeHash = hashMetaAffectedGeoSourceSubtree({
      geo_locations: { countries: ["ZZ"], location_types: ["home"] },
    });
    const result = normalizeMetaAffectedGeoCountries(input);
    expect(result).toMatchObject({ status: "unknown", availability: "mixed_unavailable",
      reasonCode: "source_hash_mismatch" });
    expect(result).not.toHaveProperty("items");
  });

  it("binds snapshot identity to exact scope and provenance without exposing source country values", () => {
    const first = normalizeMetaAffectedGeoCountries(valid());
    const scoped = normalizeMetaAffectedGeoCountries(valid({ scope: { ...fixture.scope, adSetRef: "adset_other" } }));
    const revised = normalizeMetaAffectedGeoCountries(valid({ provenance: {
      rawPayloadHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    } }));
    expect(first.status).toBe("known"); expect(scoped.status).toBe("known"); expect(revised.status).toBe("known");
    if (first.status !== "known" || scoped.status !== "known" || revised.status !== "known") return;
    expect(scoped.snapshotHash).not.toBe(first.snapshotHash);
    expect(revised.snapshotHash).not.toBe(first.snapshotHash);
    expect(scoped.items).toEqual(first.items);
  });
});
