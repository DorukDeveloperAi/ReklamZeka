import { createHash } from "node:crypto";

export const META_AFFECTED_GEO_COUNTRY_SNAPSHOT_VERSION = "meta-affected-geo-country-snapshot/1.0.0" as const;
export const META_AFFECTED_GEO_VERIFIED_GRAPH_VERSION = "v23.0" as const;

export type MetaAffectedGeoSourceScope = Readonly<{
  workspaceRef: string;
  accountRef: string;
  campaignRef: string;
  adSetRef: string;
}>;

export type MetaAffectedGeoSourceProvenance = Readonly<{
  observationRunRef: string;
  sliceRef: string;
  pageRef: string;
  rawPayloadHash: string;
  sourceGeoSubtreeHash: string;
}>;

export type MetaAffectedGeoCountryInput = Readonly<{
  sourceKind: "meta_graph_adset_targeting";
  scope: MetaAffectedGeoSourceScope;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  fetchedAt: string;
  provenance: MetaAffectedGeoSourceProvenance;
  targeting: unknown;
}>;

type NoAuthority = Readonly<{
  canApprove: false;
  canExecute: false;
  canWriteMeta: false;
  canGrantApproval: false;
}>;

export type CanonicalAffectedGeoCountryItem = Readonly<{
  polarity: "included";
  geoType: "country";
  geoRef: `geo_${string}`;
}>;

export type CanonicalAffectedGeoCountrySnapshot = Readonly<{
  version: typeof META_AFFECTED_GEO_COUNTRY_SNAPSHOT_VERSION;
  sourceKind: "canonical_meta_affected_geo_snapshot";
  status: "known";
  scope: MetaAffectedGeoSourceScope;
  capturedAt: string;
  source: Readonly<{
    sourceGraphVersion: typeof META_AFFECTED_GEO_VERIFIED_GRAPH_VERSION;
    fieldCatalogVersion: string;
    observationRunRef: string;
    sliceRef: string;
    pageRef: string;
    rawPayloadHash: string;
    sourceGeoSubtreeHash: string;
  }>;
  items: readonly CanonicalAffectedGeoCountryItem[];
  locationTypes: readonly ("home" | "recent")[];
  snapshotHash: string;
  capabilities: NoAuthority;
}>;

export type UnknownAffectedGeoCountrySnapshot = Readonly<{
  version: typeof META_AFFECTED_GEO_COUNTRY_SNAPSHOT_VERSION;
  status: "unknown";
  availability: "mixed_unavailable";
  reasonCode: "invalid_source_contract" | "source_hash_mismatch" | "unsupported_or_invalid_geo";
  capabilities: NoAuthority;
}>;

export type AffectedGeoCountryNormalizationResult =
  | CanonicalAffectedGeoCountrySnapshot
  | UnknownAffectedGeoCountrySnapshot;

const CAPABILITIES = Object.freeze({ canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canGrantApproval: false as const });
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const INPUT_KEYS = ["sourceKind", "scope", "sourceGraphVersion", "fieldCatalogVersion", "fetchedAt", "provenance", "targeting"] as const;
const SCOPE_KEYS = ["workspaceRef", "accountRef", "campaignRef", "adSetRef"] as const;
const PROVENANCE_KEYS = ["observationRunRef", "sliceRef", "pageRef", "rawPayloadHash", "sourceGeoSubtreeHash"] as const;

function codePointCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).sort(([left], [right]) => codePointCompare(left, right))
    .map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function canonicalInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validRef(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && REF.test(value);
}

function validScope(value: unknown): value is MetaAffectedGeoSourceScope {
  return exact(value, SCOPE_KEYS) && validRef(value.workspaceRef, "workspace_")
    && validRef(value.accountRef, "account_") && validRef(value.campaignRef, "campaign_")
    && validRef(value.adSetRef, "adset_");
}

function validProvenance(value: unknown): value is MetaAffectedGeoSourceProvenance {
  return exact(value, PROVENANCE_KEYS) && validRef(value.observationRunRef, "observation_")
    && validRef(value.sliceRef, "slice_") && validRef(value.pageRef, "page_")
    && typeof value.rawPayloadHash === "string" && HASH.test(value.rawPayloadHash)
    && typeof value.sourceGeoSubtreeHash === "string" && HASH.test(value.sourceGeoSubtreeHash);
}

function geoSourceProjection(targeting: unknown): unknown {
  if (!isObject(targeting)) return targeting;
  return {
    ...(Object.hasOwn(targeting, "geo_locations") ? { geo_locations: targeting.geo_locations } : {}),
    ...(Object.hasOwn(targeting, "excluded_geo_locations")
      ? { excluded_geo_locations: targeting.excluded_geo_locations } : {}),
  };
}

/** Hashes the exact geo-only projection; callers must retain the original source hash separately. */
export function hashMetaAffectedGeoSourceSubtree(targeting: unknown): string {
  return digest({ namespace: "meta-affected-geo-source-subtree/1.0.0", value: geoSourceProjection(targeting) });
}

function unknown(reasonCode: UnknownAffectedGeoCountrySnapshot["reasonCode"]): UnknownAffectedGeoCountrySnapshot {
  return Object.freeze({ version: META_AFFECTED_GEO_COUNTRY_SNAPSHOT_VERSION, status: "unknown",
    availability: "mixed_unavailable", reasonCode, capabilities: CAPABILITIES });
}

function countryTargeting(targeting: unknown): Readonly<{
  codes: readonly string[];
  locationTypes: readonly ("home" | "recent")[];
}> | null {
  if (!isObject(targeting) || Object.hasOwn(targeting, "excluded_geo_locations")
    || !Object.hasOwn(targeting, "geo_locations")) return null;
  const geoLocations = targeting.geo_locations;
  if (!exact(geoLocations, ["countries", "location_types"]) || !Array.isArray(geoLocations.countries)
    || geoLocations.countries.length === 0 || geoLocations.countries.length > 250) return null;
  const codes: string[] = [];
  for (const value of geoLocations.countries) {
    if (typeof value !== "string" || !COUNTRY_CODE.test(value)) return null;
    codes.push(value);
  }
  if (new Set(codes).size !== codes.length || !Array.isArray(geoLocations.location_types)
    || geoLocations.location_types.length === 0 || geoLocations.location_types.length > 2) return null;
  const locationTypes: Array<"home" | "recent"> = [];
  for (const value of geoLocations.location_types) {
    if (value !== "home" && value !== "recent") return null;
    locationTypes.push(value);
  }
  if (new Set(locationTypes).size !== locationTypes.length) return null;
  return Object.freeze({ codes: Object.freeze(codes), locationTypes: Object.freeze(locationTypes.sort(codePointCompare)) });
}

function geoRef(countryCode: string): `geo_${string}` {
  return `geo_${createHash("sha256").update(`meta-affected-geo/country/1.0.0\0${countryCode}`).digest("hex")}`;
}

/** Pure fail-closed normalizer. It grants no authority and performs no I/O. */
export function normalizeMetaAffectedGeoCountries(input: unknown): AffectedGeoCountryNormalizationResult {
  if (!exact(input, INPUT_KEYS) || input.sourceKind !== "meta_graph_adset_targeting"
    || !validScope(input.scope) || input.sourceGraphVersion !== META_AFFECTED_GEO_VERIFIED_GRAPH_VERSION
    || typeof input.fieldCatalogVersion !== "string" || !VERSION.test(input.fieldCatalogVersion)
    || !canonicalInstant(input.fetchedAt) || !validProvenance(input.provenance)) {
    return unknown("invalid_source_contract");
  }
  if (hashMetaAffectedGeoSourceSubtree(input.targeting) !== input.provenance.sourceGeoSubtreeHash) {
    return unknown("source_hash_mismatch");
  }
  const country = countryTargeting(input.targeting);
  if (!country) return unknown("unsupported_or_invalid_geo");
  const items = Object.freeze(country.codes.map((code): CanonicalAffectedGeoCountryItem => Object.freeze({
    polarity: "included", geoType: "country", geoRef: geoRef(code),
  })).sort((left, right) => codePointCompare(left.geoRef, right.geoRef)));
  const source = Object.freeze({ sourceGraphVersion: META_AFFECTED_GEO_VERIFIED_GRAPH_VERSION,
    fieldCatalogVersion: input.fieldCatalogVersion, observationRunRef: input.provenance.observationRunRef,
    sliceRef: input.provenance.sliceRef, pageRef: input.provenance.pageRef,
    rawPayloadHash: input.provenance.rawPayloadHash, sourceGeoSubtreeHash: input.provenance.sourceGeoSubtreeHash });
  const core = Object.freeze({ version: META_AFFECTED_GEO_COUNTRY_SNAPSHOT_VERSION,
    sourceKind: "canonical_meta_affected_geo_snapshot" as const, status: "known" as const,
    scope: Object.freeze({ ...input.scope }), capturedAt: input.fetchedAt, source, items,
    locationTypes: country.locationTypes, capabilities: CAPABILITIES });
  return Object.freeze({ ...core, snapshotHash: digest(core) });
}
