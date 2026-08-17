import { createHash } from "node:crypto";

export const META_TARGETING_SUMMARY_VERSION = "meta-targeting-summary/1.0.0" as const;

type EvidenceState = "known" | "missing";

export type CanonicalMetaTargetingSummary = Readonly<{
  version: typeof META_TARGETING_SUMMARY_VERSION;
  state: "ready" | "partial" | "missing" | "unsupported";
  source: Readonly<{
    fieldState: "present" | "missing" | "known_null";
    sourceHash: string;
    missingFields: readonly string[];
    knownNullFields: readonly string[];
    unsupportedFields: readonly string[];
  }>;
  geo: Readonly<{
    state: EvidenceState;
    includedCountries: readonly string[] | null;
    excludedCountries: readonly string[] | null;
    locationTypes: readonly string[] | null;
    includedRegionCount: number | null;
    includedCityCount: number | null;
    includedCustomLocationCount: number | null;
    includedDetailHash: string | null;
    excludedDetailCount: number | null;
    excludedDetailHash: string | null;
  }>;
  age: Readonly<{ state: EvidenceState; minimum: number | null; maximum: number | null }>;
  gender: Readonly<{ state: EvidenceState; values: readonly ("female" | "male")[] | null }>;
  platform: Readonly<{
    state: EvidenceState;
    publisherPlatforms: readonly string[] | null;
    devicePlatforms: readonly string[] | null;
  }>;
  placement: Readonly<{
    state: EvidenceState;
    facebook: readonly string[] | null;
    instagram: readonly string[] | null;
    messenger: readonly string[] | null;
    audienceNetwork: readonly string[] | null;
  }>;
  customAudience: Readonly<{
    state: EvidenceState;
    includedCount: number | null;
    excludedCount: number | null;
    includedSetHash: string | null;
    excludedSetHash: string | null;
  }>;
}>;

export type CanonicalMetaTargetingEvidence = Readonly<{
  summary: CanonicalMetaTargetingSummary;
  signature: string;
}>;

export class MetaTargetingEvidenceError extends Error {
  constructor(readonly code: "malformed" | "oversized") {
    super(`Meta targeting evidence rejected: ${code}`);
    this.name = "MetaTargetingEvidenceError";
  }
}

const KNOWN_FIELDS = new Set([
  "geo_locations", "excluded_geo_locations", "age_min", "age_max", "genders",
  "publisher_platforms", "device_platforms", "facebook_positions", "instagram_positions",
  "messenger_positions", "audience_network_positions", "custom_audiences", "excluded_custom_audiences",
]);
const TOKEN = /^[a-z][a-z0-9_]{0,63}$/;
const COUNTRY = /^[A-Z]{2}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compare(left, right))
    .map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function nullableStringArray(value: unknown, pattern = TOKEN): boolean {
  return value === null || Array.isArray(value) && value.length <= 250
    && value.every((item) => typeof item === "string" && pattern.test(item))
    && new Set(value).size === value.length;
}

function requiredStringArray(value: unknown, pattern = TOKEN): boolean {
  return value !== null && nullableStringArray(value, pattern);
}

function nullableCount(value: unknown): boolean {
  return value === null || Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 250;
}

function nullableHash(value: unknown): boolean { return value === null || typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }

function bounded(value: unknown): void {
  let nodes = 0;
  const visit = (entry: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 4_000 || depth > 8) throw new MetaTargetingEvidenceError("oversized");
    if (typeof entry === "string") {
      if (entry.length > 512) throw new MetaTargetingEvidenceError("oversized");
      return;
    }
    if (entry === null || typeof entry === "number" || typeof entry === "boolean") return;
    if (Array.isArray(entry)) {
      if (entry.length > 250) throw new MetaTargetingEvidenceError("oversized");
      for (const child of entry) visit(child, depth + 1);
      return;
    }
    if (!isObject(entry)) throw new MetaTargetingEvidenceError("malformed");
    const keys = Object.keys(entry);
    if (keys.length > 64 || keys.some((key) => key.length > 64 || !/^[a-z][a-z0-9_]*$/.test(key))) {
      throw new MetaTargetingEvidenceError("oversized");
    }
    for (const child of Object.values(entry)) visit(child, depth + 1);
  };
  visit(value, 0);
}

function stringSet(value: unknown, pattern: RegExp = TOKEN): readonly string[] {
  if (!Array.isArray(value) || value.length > 250) throw new MetaTargetingEvidenceError("malformed");
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !pattern.test(item)) throw new MetaTargetingEvidenceError("malformed");
    result.push(item);
  }
  if (new Set(result).size !== result.length) throw new MetaTargetingEvidenceError("malformed");
  return Object.freeze(result.sort(compare));
}

function optionalStringSet(targeting: Record<string, unknown>, key: string, pattern: RegExp = TOKEN): readonly string[] | null {
  return !Object.hasOwn(targeting, key) || targeting[key] === null ? null : stringSet(targeting[key], pattern);
}

function geoDetails(value: unknown, scopeHash: string): Readonly<{ count: number; hash: string }> {
  if (!Array.isArray(value) || value.length > 250) throw new MetaTargetingEvidenceError("malformed");
  const identities: string[] = [];
  for (const item of value) {
    if (!isObject(item) || Object.keys(item).length > 8) throw new MetaTargetingEvidenceError("malformed");
    const identity = typeof item.key === "string" ? item.key : typeof item.id === "string" ? item.id : null;
    if (!identity || identity.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(identity)) {
      throw new MetaTargetingEvidenceError("malformed");
    }
    identities.push(identity);
  }
  if (new Set(identities).size !== identities.length) throw new MetaTargetingEvidenceError("malformed");
  return Object.freeze({ count: identities.length, hash: digest({ namespace: "meta-targeting-geo-detail/1.0.0", scopeHash,
    identities: identities.sort(compare) }) });
}

function geoSide(value: unknown, prefix: string, unsupported: string[], scopeHash: string): Readonly<{
  countries: readonly string[] | null;
  locationTypes: readonly string[] | null;
  regions: Readonly<{ count: number; hash: string }> | null;
  cities: Readonly<{ count: number; hash: string }> | null;
  customLocations: Readonly<{ count: number; hash: string }> | null;
}> {
  if (!isObject(value) || Object.keys(value).length > 16) throw new MetaTargetingEvidenceError("malformed");
  const allowed = new Set(["countries", "location_types", "regions", "cities", "custom_locations"]);
  unsupported.push(...Object.keys(value).filter((key) => !allowed.has(key)).map((key) => `${prefix}.${key}`));
  return Object.freeze({
    countries: optionalStringSet(value, "countries", COUNTRY),
    locationTypes: optionalStringSet(value, "location_types", /^(?:home|recent)$/),
    regions: Object.hasOwn(value, "regions") ? geoDetails(value.regions, scopeHash) : null,
    cities: Object.hasOwn(value, "cities") ? geoDetails(value.cities, scopeHash) : null,
    customLocations: Object.hasOwn(value, "custom_locations") ? geoDetails(value.custom_locations, scopeHash) : null,
  });
}

function age(targeting: Record<string, unknown>, key: "age_min" | "age_max"): number | null {
  if (!Object.hasOwn(targeting, key)) return null;
  const value = targeting[key];
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 13 || (value as number) > 65) {
    throw new MetaTargetingEvidenceError("malformed");
  }
  return value as number;
}

function genders(value: unknown): readonly ("female" | "male")[] {
  if (!Array.isArray(value) || value.length > 2) throw new MetaTargetingEvidenceError("malformed");
  const mapped = value.map((item) => item === 1 ? "male" as const : item === 2 ? "female" as const : null);
  if (mapped.some((item) => item === null) || new Set(mapped).size !== mapped.length) {
    throw new MetaTargetingEvidenceError("malformed");
  }
  return Object.freeze((mapped as ("female" | "male")[]).sort(compare));
}

function audiences(value: unknown, scopeHash: string): Readonly<{ count: number; hash: string }> {
  if (!Array.isArray(value) || value.length > 250) throw new MetaTargetingEvidenceError("malformed");
  const ids: string[] = [];
  for (const item of value) {
    if (!isObject(item) || Object.keys(item).some((key) => key !== "id" && key !== "name")
      || typeof item.id !== "string" || item.id.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(item.id)
      || Object.hasOwn(item, "name") && (typeof item.name !== "string" || item.name.length > 256)) {
      throw new MetaTargetingEvidenceError("malformed");
    }
    ids.push(item.id);
  }
  if (new Set(ids).size !== ids.length) throw new MetaTargetingEvidenceError("malformed");
  return Object.freeze({ count: ids.length,
    hash: digest({ namespace: "meta-targeting-custom-audience/1.0.0", scopeHash, ids: ids.sort(compare) }) });
}

function missing(fieldState: "missing" | "known_null", scopeHash: string): CanonicalMetaTargetingEvidence {
  const summary: CanonicalMetaTargetingSummary = Object.freeze({
    version: META_TARGETING_SUMMARY_VERSION, state: "missing",
    source: Object.freeze({ fieldState, sourceHash: digest({ namespace: "meta-targeting-source/1.0.0", scopeHash, fieldState }),
      missingFields: Object.freeze([...KNOWN_FIELDS].sort(compare)), knownNullFields: Object.freeze([]), unsupportedFields: Object.freeze([]) }),
    geo: Object.freeze({ state: "missing", includedCountries: null, excludedCountries: null,
      locationTypes: null, includedRegionCount: null, includedCityCount: null, includedCustomLocationCount: null,
      includedDetailHash: null, excludedDetailCount: null, excludedDetailHash: null }),
    age: Object.freeze({ state: "missing", minimum: null, maximum: null }),
    gender: Object.freeze({ state: "missing", values: null }),
    platform: Object.freeze({ state: "missing", publisherPlatforms: null, devicePlatforms: null }),
    placement: Object.freeze({ state: "missing", facebook: null, instagram: null, messenger: null, audienceNetwork: null }),
    customAudience: Object.freeze({ state: "missing", includedCount: null, excludedCount: null,
      includedSetHash: null, excludedSetHash: null }),
  });
  return Object.freeze({ summary, signature: digest(summary) });
}

/** Converts one Meta targeting object into a bounded public-safe evidence summary. */
export function normalizeMetaTargetingEvidence(input: Readonly<{ fieldPresent: boolean; targeting: unknown;
  scope: Readonly<{ workspaceId: string; externalAccountId: string }> }>): CanonicalMetaTargetingEvidence {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.scope.workspaceId)
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.scope.externalAccountId)) {
    throw new MetaTargetingEvidenceError("malformed");
  }
  const scopeHash = digest({ namespace: "meta-targeting-private-scope/1.0.0", ...input.scope });
  if (!input.fieldPresent) return missing("missing", scopeHash);
  if (input.targeting === null) return missing("known_null", scopeHash);
  bounded(input.targeting);
  if (!isObject(input.targeting)) throw new MetaTargetingEvidenceError("malformed");
  const targeting = input.targeting;
  const unsupported: string[] = Object.keys(targeting).filter((key) => !KNOWN_FIELDS.has(key));
  const missingFields = Object.freeze([...KNOWN_FIELDS].filter((key) => !Object.hasOwn(targeting, key)).sort(compare));
  const knownNullFields = Object.freeze([...KNOWN_FIELDS].filter((key) => targeting[key] === null).sort(compare));

  const includedGeo = Object.hasOwn(targeting, "geo_locations") && targeting.geo_locations !== null
    ? geoSide(targeting.geo_locations, "geo_locations", unsupported, scopeHash) : null;
  const excludedGeo = Object.hasOwn(targeting, "excluded_geo_locations") && targeting.excluded_geo_locations !== null
    ? geoSide(targeting.excluded_geo_locations, "excluded_geo_locations", unsupported, scopeHash) : null;
  const ageMinimum = age(targeting, "age_min"); const ageMaximum = age(targeting, "age_max");
  if (ageMinimum !== null && ageMaximum !== null && ageMinimum > ageMaximum) throw new MetaTargetingEvidenceError("malformed");
  const genderValues = Object.hasOwn(targeting, "genders") && targeting.genders !== null ? genders(targeting.genders) : null;
  const publisherPlatforms = optionalStringSet(targeting, "publisher_platforms");
  const devicePlatforms = optionalStringSet(targeting, "device_platforms");
  const facebook = optionalStringSet(targeting, "facebook_positions");
  const instagram = optionalStringSet(targeting, "instagram_positions");
  const messenger = optionalStringSet(targeting, "messenger_positions");
  const audienceNetwork = optionalStringSet(targeting, "audience_network_positions");
  const includedAudience = Object.hasOwn(targeting, "custom_audiences") && targeting.custom_audiences !== null
    ? audiences(targeting.custom_audiences, scopeHash) : null;
  const excludedAudience = Object.hasOwn(targeting, "excluded_custom_audiences") && targeting.excluded_custom_audiences !== null
    ? audiences(targeting.excluded_custom_audiences, scopeHash) : null;
  const unsupportedFields = Object.freeze([...new Set(unsupported)].sort(compare));
  const supportedCount = Object.keys(targeting).filter((key) => KNOWN_FIELDS.has(key) && targeting[key] !== null).length;
  const state = supportedCount === 0 ? unsupportedFields.length ? "unsupported" : "missing"
    : unsupportedFields.length || missingFields.length || knownNullFields.length ? "partial" : "ready";
  const includedDetail = includedGeo ? [includedGeo.regions, includedGeo.cities, includedGeo.customLocations].filter(Boolean) as Readonly<{ count: number; hash: string }>[] : [];
  const excludedDetail = excludedGeo ? [excludedGeo.regions, excludedGeo.cities, excludedGeo.customLocations].filter(Boolean) as Readonly<{ count: number; hash: string }>[] : [];
  const sourceHash = digest({ namespace: "meta-targeting-source/1.0.0", scopeHash, includedGeo, excludedGeo,
    ageMinimum, ageMaximum, genderValues, publisherPlatforms, devicePlatforms, facebook, instagram,
    messenger, audienceNetwork, includedAudience, excludedAudience, unsupportedFields, knownNullFields });
  const summary: CanonicalMetaTargetingSummary = Object.freeze({
    version: META_TARGETING_SUMMARY_VERSION, state,
    source: Object.freeze({ fieldState: "present", sourceHash,
      missingFields, knownNullFields, unsupportedFields }),
    geo: Object.freeze({ state: includedGeo || excludedGeo ? "known" : "missing",
      includedCountries: includedGeo?.countries ?? null, excludedCountries: excludedGeo?.countries ?? null,
      locationTypes: includedGeo?.locationTypes ?? null,
      includedRegionCount: includedGeo?.regions?.count ?? null, includedCityCount: includedGeo?.cities?.count ?? null,
      includedCustomLocationCount: includedGeo?.customLocations?.count ?? null,
      includedDetailHash: includedDetail.length ? digest(includedDetail) : null,
      excludedDetailCount: excludedDetail.length ? excludedDetail.reduce((count, item) => count + item.count, 0) : null,
      excludedDetailHash: excludedDetail.length ? digest(excludedDetail) : null }),
    age: Object.freeze({ state: ageMinimum !== null || ageMaximum !== null ? "known" : "missing", minimum: ageMinimum, maximum: ageMaximum }),
    gender: Object.freeze({ state: genderValues ? "known" : "missing", values: genderValues }),
    platform: Object.freeze({ state: publisherPlatforms || devicePlatforms ? "known" : "missing", publisherPlatforms, devicePlatforms }),
    placement: Object.freeze({ state: facebook || instagram || messenger || audienceNetwork ? "known" : "missing",
      facebook, instagram, messenger, audienceNetwork }),
    customAudience: Object.freeze({ state: includedAudience || excludedAudience ? "known" : "missing",
      includedCount: includedAudience?.count ?? null, excludedCount: excludedAudience?.count ?? null,
      includedSetHash: includedAudience?.hash ?? null, excludedSetHash: excludedAudience?.hash ?? null }),
  });
  return Object.freeze({ summary, signature: digest(summary) });
}

/** Revalidates a supposedly canonical summary at the persistence boundary. */
export function assertCanonicalMetaTargetingEvidence(summary: unknown, signature: unknown): asserts summary is CanonicalMetaTargetingSummary {
  const invalid = (): never => { throw new MetaTargetingEvidenceError("malformed"); };
  if (!exact(summary, ["version", "state", "source", "geo", "age", "gender", "platform", "placement", "customAudience"])) invalid();
  const candidate = summary as Record<string, unknown>;
  if (candidate.version !== META_TARGETING_SUMMARY_VERSION
    || !["ready", "partial", "missing", "unsupported"].includes(String(candidate.state))
    || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature) || digest(candidate) !== signature) invalid();
  const source = candidate.source;
  if (!exact(source, ["fieldState", "sourceHash", "missingFields", "knownNullFields", "unsupportedFields"])
    || !["present", "missing", "known_null"].includes(String(source.fieldState))
    || typeof source.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(source.sourceHash)
    || !requiredStringArray(source.missingFields) || !requiredStringArray(source.knownNullFields)
    || !requiredStringArray(source.unsupportedFields, /^[a-z][a-z0-9_.]{0,128}$/)) invalid();
  const geo = candidate.geo;
  if (!exact(geo, ["state", "includedCountries", "excludedCountries", "locationTypes", "includedRegionCount",
    "includedCityCount", "includedCustomLocationCount", "includedDetailHash", "excludedDetailCount", "excludedDetailHash"])
    || !["known", "missing"].includes(String(geo.state))
    || !nullableStringArray(geo.includedCountries, COUNTRY) || !nullableStringArray(geo.excludedCountries, COUNTRY)
    || !nullableStringArray(geo.locationTypes, /^(?:home|recent)$/)
    || !nullableCount(geo.includedRegionCount) || !nullableCount(geo.includedCityCount)
    || !nullableCount(geo.includedCustomLocationCount) || !nullableCount(geo.excludedDetailCount)
    || !nullableHash(geo.includedDetailHash) || !nullableHash(geo.excludedDetailHash)) invalid();
  const ageValue = candidate.age;
  if (!exact(ageValue, ["state", "minimum", "maximum"]) || !["known", "missing"].includes(String(ageValue.state))
    || !(ageValue.minimum === null || Number.isSafeInteger(ageValue.minimum) && (ageValue.minimum as number) >= 13 && (ageValue.minimum as number) <= 65)
    || !(ageValue.maximum === null || Number.isSafeInteger(ageValue.maximum) && (ageValue.maximum as number) >= 13 && (ageValue.maximum as number) <= 65)) invalid();
  const genderValue = candidate.gender;
  if (!exact(genderValue, ["state", "values"]) || !["known", "missing"].includes(String(genderValue.state))
    || !nullableStringArray(genderValue.values, /^(?:female|male)$/)) invalid();
  const platformValue = candidate.platform;
  if (!exact(platformValue, ["state", "publisherPlatforms", "devicePlatforms"])
    || !["known", "missing"].includes(String(platformValue.state))
    || !nullableStringArray(platformValue.publisherPlatforms) || !nullableStringArray(platformValue.devicePlatforms)) invalid();
  const placementValue = candidate.placement;
  if (!exact(placementValue, ["state", "facebook", "instagram", "messenger", "audienceNetwork"])
    || !["known", "missing"].includes(String(placementValue.state))
    || !nullableStringArray(placementValue.facebook) || !nullableStringArray(placementValue.instagram)
    || !nullableStringArray(placementValue.messenger) || !nullableStringArray(placementValue.audienceNetwork)) invalid();
  const audienceValue = candidate.customAudience;
  if (!exact(audienceValue, ["state", "includedCount", "excludedCount", "includedSetHash", "excludedSetHash"])
    || !["known", "missing"].includes(String(audienceValue.state))
    || !nullableCount(audienceValue.includedCount) || !nullableCount(audienceValue.excludedCount)
    || !nullableHash(audienceValue.includedSetHash) || !nullableHash(audienceValue.excludedSetHash)) invalid();
}
