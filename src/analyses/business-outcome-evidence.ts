import { createHash } from "node:crypto";
import type { BusinessOutcomeKind } from "@/analyses/business-outcome-signal";

export const BUSINESS_OUTCOME_EVIDENCE_VERSION = "business-outcome-evidence/1.0.0" as const;
export type BusinessOutcomeEvidenceSignal = Readonly<{
  batchId: string;
  signalRef: string;
  entityRef: string;
  occurredAt: string;
  outcome: BusinessOutcomeKind;
  quantity: number;
  valueMinor: number | null;
  currency: string | null;
  mappingStatus: "verified" | "unmapped";
}>;
export type BusinessOutcomeEvidenceSnapshot = Readonly<{
  version: typeof BUSINESS_OUTCOME_EVIDENCE_VERSION;
  evidenceRef: string;
  evidenceHash: string;
  entityRef: string;
  sourceHeadHash: string;
  sourceManifestHash: string;
  windowStart: string;
  windowEnd: string;
  materializedAt: string;
  summary: Readonly<{
    signalCount: number;
    batchCount: number;
    totals: Readonly<Record<BusinessOutcomeKind, number>>;
    revenueMinorByCurrency: Readonly<Record<string, number>>;
    verifiedSignalCount: number;
    unmappedSignalCount: number;
    metaProxyEligible: false;
  }>;
}>;

export class BusinessOutcomeEvidenceError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_source") { super(`Business outcome evidence rejected: ${code}`); this.name = "BusinessOutcomeEvidenceError"; }
}
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
function fail(code: BusinessOutcomeEvidenceError["code"]): never { throw new BusinessOutcomeEvidenceError(code); }
function instant(value: unknown, code: BusinessOutcomeEvidenceError["code"]): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code); return value; }
function ref(value: unknown, code: BusinessOutcomeEvidenceError["code"]): string { if (typeof value !== "string" || !REF.test(value)) fail(code); return value; }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

/** Deterministic L4 evidence envelope. It excludes raw imports, owners and all action authority. */
export function buildBusinessOutcomeEvidence(input: Readonly<{
  entityRef: string;
  sourceHeadHash: string;
  windowStart: string;
  windowEnd: string;
  materializedAt: string;
  signals: readonly BusinessOutcomeEvidenceSignal[];
}>): BusinessOutcomeEvidenceSnapshot {
  const entityRef = ref(input.entityRef, "invalid_input");
  if (!HASH.test(input.sourceHeadHash)) fail("invalid_input");
  const windowStart = instant(input.windowStart, "invalid_input"); const windowEnd = instant(input.windowEnd, "invalid_input"); const materializedAt = instant(input.materializedAt, "invalid_input");
  if (Date.parse(windowStart) >= Date.parse(windowEnd)) fail("invalid_input");
  if (!Array.isArray(input.signals) || input.signals.length > 10_000) fail("invalid_input");
  const totals: Record<BusinessOutcomeKind, number> = { qualified_lead: 0, appointment: 0, sale: 0, revenue: 0, invalid_lead: 0 };
  const revenueMinorByCurrency: Record<string, number> = {};
  const signalRefs = new Set<string>(); const batchRefs = new Set<string>(); let verifiedSignalCount = 0;
  const manifest = input.signals.map((signal) => {
    const signalRef = ref(signal.signalRef, "corrupt_source"); const batchId = ref(signal.batchId, "corrupt_source");
    if (ref(signal.entityRef, "corrupt_source") !== entityRef || !["qualified_lead", "appointment", "sale", "revenue", "invalid_lead"].includes(signal.outcome)
      || !Number.isSafeInteger(signal.quantity) || signal.quantity < 1 || !["verified", "unmapped"].includes(signal.mappingStatus)) fail("corrupt_source");
    const occurredAt = instant(signal.occurredAt, "corrupt_source");
    if (Date.parse(occurredAt) < Date.parse(windowStart) || Date.parse(occurredAt) >= Date.parse(windowEnd) || signalRefs.has(signalRef)) fail("corrupt_source");
    const outcome: BusinessOutcomeKind = signal.outcome;
    signalRefs.add(signalRef); batchRefs.add(batchId); totals[outcome] += signal.quantity;
    if (signal.mappingStatus === "verified") verifiedSignalCount += 1;
    if (signal.outcome === "revenue") {
      if (!Number.isSafeInteger(signal.valueMinor) || signal.valueMinor < 0 || signal.currency === null || !CURRENCY.test(signal.currency)) fail("corrupt_source");
      revenueMinorByCurrency[signal.currency] = (revenueMinorByCurrency[signal.currency] ?? 0) + signal.valueMinor;
    } else if (signal.valueMinor !== null || signal.currency !== null) fail("corrupt_source");
    return { batchId, signalRef, occurredAt, outcome: signal.outcome, quantity: signal.quantity, valueMinor: signal.valueMinor, currency: signal.currency, mappingStatus: signal.mappingStatus };
  }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.signalRef.localeCompare(right.signalRef));
  const sourceManifestHash = hash({ entityRef, sourceHeadHash: input.sourceHeadHash, windowStart, windowEnd, signals: manifest });
  const core = Object.freeze({ version: BUSINESS_OUTCOME_EVIDENCE_VERSION, entityRef, sourceHeadHash: input.sourceHeadHash, sourceManifestHash,
    windowStart, windowEnd, materializedAt, summary: Object.freeze({ signalCount: manifest.length, batchCount: batchRefs.size,
      totals: Object.freeze(totals), revenueMinorByCurrency: Object.freeze(revenueMinorByCurrency), verifiedSignalCount,
      unmappedSignalCount: manifest.length - verifiedSignalCount, metaProxyEligible: false as const }) });
  const evidenceHash = hash(core);
  return Object.freeze({ ...core, evidenceRef: `outcome_evidence_${evidenceHash.slice(0, 24)}`, evidenceHash });
}
