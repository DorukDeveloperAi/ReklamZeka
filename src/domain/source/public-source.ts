/**
 * Public provenance metadata carried beside a read response.  It is deliberately
 * independent from a response's domain payload so a client cannot mistake a
 * successful transport response for canonical evidence.
 */
export const PUBLIC_SOURCE_CONTRACT_VERSION = "public-source/1.0.0" as const;

export type PublicSourceKind =
  | "canonical_meta_mirror"
  | "canonical_performance"
  | "derived_trust"
  | "graph_capability"
  | "internal_ledger"
  | "historical";

export type PublicSourceState =
  | "ready"
  | "partial"
  | "stale"
  | "empty"
  | "unavailable"
  | "demo";

export type PublicSource = Readonly<{
  contractVersion: typeof PUBLIC_SOURCE_CONTRACT_VERSION;
  kind: PublicSourceKind;
  state: PublicSourceState;
  observedAt: string | null;
  freshnessAt: string | null;
  freshnessThresholdMinutes: number | null;
  reasonCodes: readonly string[];
}>;

export type PublicSourceResponse<T extends object> = Readonly<T & { source: PublicSource }>;
export type PublicSourceFailure = Readonly<{ source: PublicSource; error: Readonly<{ code: string; message: string }> }>;

function isoOrNull(value: string | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("invalid_public_source");
  }
  return value;
}

function reasons(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.some((code) => typeof code !== "string" || !code.trim())) {
    throw new Error("invalid_public_source");
  }
  return Object.freeze([...new Set(value)].sort());
}

/** Build the stable source marker without permitting ambiguous freshness data. */
export function publicSource(input: Omit<PublicSource, "contractVersion" | "reasonCodes"> & { reasonCodes: readonly string[] }): PublicSource {
  if (![
    "canonical_meta_mirror", "canonical_performance", "derived_trust", "graph_capability", "internal_ledger", "historical",
  ].includes(input.kind)) throw new Error("invalid_public_source");
  if (!["ready", "partial", "stale", "empty", "unavailable", "demo"].includes(input.state)) {
    throw new Error("invalid_public_source");
  }
  if (input.freshnessThresholdMinutes !== null
    && (!Number.isSafeInteger(input.freshnessThresholdMinutes) || input.freshnessThresholdMinutes < 1)) {
    throw new Error("invalid_public_source");
  }
  return Object.freeze({ contractVersion: PUBLIC_SOURCE_CONTRACT_VERSION, kind: input.kind, state: input.state,
    observedAt: isoOrNull(input.observedAt), freshnessAt: isoOrNull(input.freshnessAt),
    freshnessThresholdMinutes: input.freshnessThresholdMinutes, reasonCodes: reasons(input.reasonCodes) });
}

/**
 * Enrich rather than replace the existing public payload.  Package 1 changes
 * API provenance without silently changing the payload fields that current
 * clients validate; a later UI package will consume `source` directly.
 */
export function withPublicSource<T extends object>(result: T, source: PublicSource): PublicSourceResponse<T> {
  return Object.freeze({ ...result, source });
}

export function publicSourceFailure(source: PublicSource, code: string, message: string): PublicSourceFailure {
  if (!code || !message || source.state !== "unavailable") throw new Error("invalid_public_source");
  return Object.freeze({ source, error: Object.freeze({ code, message }) });
}
