export const META_TARGETING_SHAPE_CANARY_VERSION = "meta-targeting-shape-canary/1.0.0" as const;

type JsonObject = Readonly<Record<string, unknown>>;

type ValueTypeCounts = Readonly<{
  absent: number;
  null: number;
  string: number;
  number: number;
  boolean: number;
  array: number;
  object: number;
  other: number;
}>;

type FieldShape = Readonly<{
  valueTypes: ValueTypeCounts;
  itemCount: number;
  itemTypes: ValueTypeCounts;
}>;

type IdentityShape = Readonly<{
  key: ValueTypeCounts;
  id: ValueTypeCounts;
  customLocationId: ValueTypeCounts;
  objectsWithStableKey: number;
}>

export type MetaTargetingGeoSideShape = Readonly<{
  collection: ValueTypeCounts;
  locationTypes: FieldShape;
  countries: FieldShape;
  regions: FieldShape;
  regionIdentity: IdentityShape;
  cities: FieldShape;
  cityIdentity: IdentityShape;
  customLocations: FieldShape;
  customLocationIdentity: IdentityShape;
}>;

export type MetaTargetingShapeCanaryResult = Readonly<{
  version: typeof META_TARGETING_SHAPE_CANARY_VERSION;
  sampledAdSets: number;
  targeting: ValueTypeCounts;
  includedGeo: MetaTargetingGeoSideShape;
  excludedGeo: MetaTargetingGeoSideShape;
}>;

const TYPES = ["absent", "null", "string", "number", "boolean", "array", "object", "other"] as const;
type ValueType = typeof TYPES[number];

function blankTypes(): Record<ValueType, number> {
  return { absent: 0, null: 0, string: 0, number: 0, boolean: 0, array: 0, object: 0, other: 0 };
}

function valueType(value: unknown, present = true): ValueType {
  if (!present) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "other";
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observe(target: Record<ValueType, number>, value: unknown, present = true): void {
  target[valueType(value, present)] += 1;
}

function fieldShape(parents: readonly JsonObject[], field: string): FieldShape {
  const valueTypes = blankTypes();
  const itemTypes = blankTypes();
  let itemCount = 0;
  for (const parent of parents) {
    const present = Object.hasOwn(parent, field);
    const value = parent[field];
    observe(valueTypes, value, present);
    if (!Array.isArray(value)) continue;
    itemCount += value.length;
    for (const item of value) observe(itemTypes, item);
  }
  return { valueTypes, itemCount, itemTypes };
}

function arrayObjects(parents: readonly JsonObject[], field: string): readonly JsonObject[] {
  return parents.flatMap((parent) => {
    const value = parent[field];
    return Array.isArray(value) ? value.filter(isObject) : [];
  });
}

function identityShape(objects: readonly JsonObject[], stableFields: readonly string[]): IdentityShape {
  const key = blankTypes();
  const id = blankTypes();
  const customLocationId = blankTypes();
  let objectsWithStableKey = 0;
  for (const object of objects) {
    observe(key, object.key, Object.hasOwn(object, "key"));
    observe(id, object.id, Object.hasOwn(object, "id"));
    observe(customLocationId, object.custom_location_id, Object.hasOwn(object, "custom_location_id"));
    if (stableFields.some((field) => typeof object[field] === "string" && object[field]!.length > 0)) {
      objectsWithStableKey += 1;
    }
  }
  return { key, id, customLocationId, objectsWithStableKey };
}

function geoSideShape(targetingObjects: readonly JsonObject[], field: string): MetaTargetingGeoSideShape {
  const collection = blankTypes();
  const geoObjects: JsonObject[] = [];
  for (const targeting of targetingObjects) {
    const present = Object.hasOwn(targeting, field);
    const value = targeting[field];
    observe(collection, value, present);
    if (isObject(value)) geoObjects.push(value);
  }
  const regions = arrayObjects(geoObjects, "regions");
  const cities = arrayObjects(geoObjects, "cities");
  const customLocations = arrayObjects(geoObjects, "custom_locations");
  return {
    collection,
    locationTypes: fieldShape(geoObjects, "location_types"),
    countries: fieldShape(geoObjects, "countries"),
    regions: fieldShape(geoObjects, "regions"),
    regionIdentity: identityShape(regions, ["key"]),
    cities: fieldShape(geoObjects, "cities"),
    cityIdentity: identityShape(cities, ["key"]),
    customLocations: fieldShape(geoObjects, "custom_locations"),
    customLocationIdentity: identityShape(customLocations, ["key", "id", "custom_location_id"]),
  };
}

/**
 * Reduces live targeting payloads to a fixed structural vocabulary. It never
 * copies keys outside the allowlist or any source value into the returned result.
 */
export function redactMetaAdSetTargetingShape(records: readonly unknown[]): MetaTargetingShapeCanaryResult {
  const targeting = blankTypes();
  const targetingObjects: JsonObject[] = [];
  for (const record of records) {
    if (!isObject(record)) {
      observe(targeting, undefined, false);
      continue;
    }
    const present = Object.hasOwn(record, "targeting");
    const value = record.targeting;
    observe(targeting, value, present);
    if (isObject(value)) targetingObjects.push(value);
  }
  return {
    version: META_TARGETING_SHAPE_CANARY_VERSION,
    sampledAdSets: records.length,
    targeting,
    includedGeo: geoSideShape(targetingObjects, "geo_locations"),
    excludedGeo: geoSideShape(targetingObjects, "excluded_geo_locations"),
  };
}
