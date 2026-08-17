import { createHash } from "node:crypto";

/**
 * A slice is a versioned read scope only. It deliberately has no schedule,
 * Guide, authority, budget or action fields; those belong to later layers.
 */
export const SLICE_DEFINITION_VERSION = "slice-definition/1.0.0" as const;

export type SliceEntityLevel = "organization_campaign" | "campaign" | "ad_set";
export type CanonicalMarketKey = "yerli" | "yabanci";

export type SliceValuePredicate = Readonly<{ valueId: string; key: string }>;
export type SliceDimensionPredicate = Readonly<{
  dimensionId: string;
  key: string;
  /** Values inside one dimension are OR-ed. Dimensions themselves are AND-ed. */
  values: readonly SliceValuePredicate[];
}>;

/** IDs bind this definition to the tenant catalogue. `key` is audit-safe text. */
export type SliceMarketBinding = Readonly<{
  dimensionId: string;
  valueId: string;
  key: CanonicalMarketKey;
}>;

export type SliceDefinitionDraft = Readonly<{
  sliceRef: string;
  revisionRef: string;
  revisionNumber: number;
  market: SliceMarketBinding;
  predicates: readonly SliceDimensionPredicate[];
  explicitIncludeEntityRefs?: readonly string[];
  explicitExcludeEntityRefs?: readonly string[];
}>;

export type SliceRevision = Readonly<{
  version: typeof SLICE_DEFINITION_VERSION;
  sliceRef: string;
  revisionRef: string;
  revisionNumber: number;
  market: SliceMarketBinding;
  predicates: readonly SliceDimensionPredicate[];
  explicitIncludeEntityRefs: readonly string[];
  explicitExcludeEntityRefs: readonly string[];
  definitionHash: string;
}>;

export class SliceDefinitionError extends Error {
  constructor(readonly code: "invalid_definition" | "invalid_reference" | "duplicate_dimension") {
    super(`Slice definition rejected: ${code}`);
    this.name = "SliceDefinitionError";
  }
}

const REF = /^[a-z][a-z0-9]{0,63}_[a-z0-9][a-z0-9_.:-]{0,190}$/;
const KEY = /^[a-z][a-z0-9_.:-]{0,127}$/;

function fail(code: SliceDefinitionError["code"]): never { throw new SliceDefinitionError(code); }
function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) fail("invalid_reference");
  return value;
}
function key(value: unknown): string {
  if (typeof value !== "string" || !KEY.test(value)) fail("invalid_definition");
  return value;
}
function freeze<T>(value: T): T { return Object.freeze(value); }
/** Deliberately locale-independent: public hashes/order must not vary by host locale. */
export function compareSliceText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareSliceText(left, right)).map(([name, child]) => [name, stable(child)]));
  return value;
}
export function stableSliceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function normalizedRefs(value: readonly string[] | undefined): readonly string[] {
  if (value === undefined) return freeze([]);
  if (!Array.isArray(value)) fail("invalid_definition");
  return freeze([...new Set(value.map(ref))].sort(compareSliceText));
}

function normalizedMarket(value: SliceMarketBinding): SliceMarketBinding {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3
    || !("dimensionId" in value) || !("valueId" in value) || !("key" in value)
    || (value.key !== "yerli" && value.key !== "yabanci")) fail("invalid_definition");
  return freeze({ dimensionId: ref(value.dimensionId), valueId: ref(value.valueId), key: value.key });
}

function normalizedPredicates(value: readonly SliceDimensionPredicate[], marketDimensionId: string): readonly SliceDimensionPredicate[] {
  if (!Array.isArray(value)) fail("invalid_definition");
  const seen = new Set<string>();
  const predicates = value.map((predicate) => {
    if (!predicate || typeof predicate !== "object" || Array.isArray(predicate)
      || Object.keys(predicate).length !== 3 || !("dimensionId" in predicate) || !("key" in predicate) || !("values" in predicate)
      || !Array.isArray(predicate.values) || predicate.values.length === 0) fail("invalid_definition");
    const dimensionId = ref(predicate.dimensionId);
    // Market is a hard, separately-ID-bound slice boundary. It can never be
    // weakened or duplicated as an ordinary OR predicate.
    if (dimensionId === marketDimensionId) fail("invalid_definition");
    if (seen.has(dimensionId)) fail("duplicate_dimension");
    seen.add(dimensionId);
    const rawValues: readonly unknown[] = predicate.values;
    const values: SliceValuePredicate[] = rawValues.map((value: unknown): SliceValuePredicate => {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2
        || !("valueId" in value) || !("key" in value)) fail("invalid_definition");
      return freeze({ valueId: ref(value.valueId), key: key(value.key) });
    }).sort((left: SliceValuePredicate, right: SliceValuePredicate) => compareSliceText(left.valueId, right.valueId) || compareSliceText(left.key, right.key));
    if (new Set(values.map((item) => item.valueId)).size !== values.length) fail("invalid_definition");
    return freeze({ dimensionId, key: key(predicate.key), values: freeze(values) });
  }).sort((left, right) => compareSliceText(left.dimensionId, right.dimensionId));
  return freeze(predicates);
}

/** Creates a normalised, immutable revision that a persistence adapter may store. */
export function createSliceRevision(draft: SliceDefinitionDraft): SliceRevision {
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.keys(draft).some((name) => ![
    "sliceRef", "revisionRef", "revisionNumber", "market", "predicates", "explicitIncludeEntityRefs", "explicitExcludeEntityRefs",
  ].includes(name)) || !Number.isInteger(draft.revisionNumber) || draft.revisionNumber < 1) fail("invalid_definition");
  const explicitIncludeEntityRefs = normalizedRefs(draft.explicitIncludeEntityRefs);
  const explicitExcludeEntityRefs = normalizedRefs(draft.explicitExcludeEntityRefs);
  const normalizedMarketBinding = normalizedMarket(draft.market);
  const normalized = {
    version: SLICE_DEFINITION_VERSION,
    sliceRef: ref(draft.sliceRef),
    revisionRef: ref(draft.revisionRef),
    revisionNumber: draft.revisionNumber,
    market: normalizedMarketBinding,
    predicates: normalizedPredicates(draft.predicates, normalizedMarketBinding.dimensionId),
    explicitIncludeEntityRefs,
    explicitExcludeEntityRefs,
  } as const;
  return freeze({ ...normalized, definitionHash: stableSliceHash(normalized) });
}
