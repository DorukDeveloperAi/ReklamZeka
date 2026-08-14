import { createHash } from "node:crypto";

export const CREATIVE_DIAGNOSTIC_CONFIG_SNAPSHOT_VERSION = "creative-diagnostic-config-snapshot/1.0.0" as const;
export type CreativeDiagnosticKnownField = Readonly<{ state: "known"; ref: string; sourceRef: string; sourceHash: string }>;
export type CreativeDiagnosticUnknownField = Readonly<{ state: "unknown"; reason: "not_observed" | "unsupported" | "ambiguous" }>;
export type CreativeDiagnosticConfigField = CreativeDiagnosticKnownField | CreativeDiagnosticUnknownField;
export type CreativeDiagnosticConfigSnapshot = Readonly<{
  contractVersion: typeof CREATIVE_DIAGNOSTIC_CONFIG_SNAPSHOT_VERSION;
  bindingRef: string;
  bindingHash: string;
  creativeContentHash: string;
  objective: CreativeDiagnosticConfigField;
  optimization: CreativeDiagnosticConfigField;
  billing: CreativeDiagnosticConfigField;
  destination: CreativeDiagnosticConfigField;
  snapshotHash: string;
}>;

export class CreativeDiagnosticConfigSnapshotError extends Error {
  constructor(message: string) { super(message); this.name = "CreativeDiagnosticConfigSnapshotError"; }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function opaqueRef(value: unknown, label: string): string { if (typeof value !== "string" || !REF.test(value)) throw new CreativeDiagnosticConfigSnapshotError(`${label} opaque ref olmalıdır`); return value; }
function hash(value: unknown, label: string): string { if (typeof value !== "string" || !HASH.test(value)) throw new CreativeDiagnosticConfigSnapshotError(`${label} SHA-256 olmalıdır`); return value; }
function field(value: unknown, label: string): CreativeDiagnosticConfigField {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CreativeDiagnosticConfigSnapshotError(`${label} alanı geçersiz`);
  const record = value as Record<string, unknown>;
  if (record.state === "known") {
    if (Object.keys(record).sort().join(",") !== "ref,sourceHash,sourceRef,state") throw new CreativeDiagnosticConfigSnapshotError(`${label} known alanı exact shape olmalıdır`);
    const sourceRef = opaqueRef(record.sourceRef, `${label}.sourceRef`);
    if (sourceRef === "promoted_object") throw new CreativeDiagnosticConfigSnapshotError(`${label} promoted_object ile türetilemez`);
    return Object.freeze({ state: "known", ref: opaqueRef(record.ref, `${label}.ref`), sourceRef, sourceHash: hash(record.sourceHash, `${label}.sourceHash`) });
  }
  if (record.state === "unknown") {
    if (Object.keys(record).sort().join(",") !== "reason,state" || !["not_observed", "unsupported", "ambiguous"].includes(String(record.reason))) throw new CreativeDiagnosticConfigSnapshotError(`${label} unknown alanı exact shape olmalıdır`);
    return Object.freeze({ state: "unknown", reason: record.reason as CreativeDiagnosticUnknownField["reason"] });
  }
  throw new CreativeDiagnosticConfigSnapshotError(`${label} state geçersiz`);
}

/**
 * This boundary intentionally has no promoted_object or derived destination
 * input. Callers must either present a direct mirror observation or preserve
 * the explicit unknown reason.
 */
export function createCreativeDiagnosticConfigSnapshot(input: Readonly<{
  bindingRef: string; bindingHash: string; creativeContentHash: string;
  objective: CreativeDiagnosticConfigField; optimization: CreativeDiagnosticConfigField;
  billing: CreativeDiagnosticConfigField; destination: CreativeDiagnosticConfigField;
}>): CreativeDiagnosticConfigSnapshot {
  if (!input || Object.keys(input).sort().join(",") !== "billing,bindingHash,bindingRef,creativeContentHash,destination,objective,optimization") throw new CreativeDiagnosticConfigSnapshotError("snapshot exact shape olmalıdır");
  const core = Object.freeze({ contractVersion: CREATIVE_DIAGNOSTIC_CONFIG_SNAPSHOT_VERSION, bindingRef: opaqueRef(input.bindingRef, "bindingRef"), bindingHash: hash(input.bindingHash, "bindingHash"), creativeContentHash: hash(input.creativeContentHash, "creativeContentHash"), objective: field(input.objective, "objective"), optimization: field(input.optimization, "optimization"), billing: field(input.billing, "billing"), destination: field(input.destination, "destination") });
  return Object.freeze({ ...core, snapshotHash: digest(core) });
}
