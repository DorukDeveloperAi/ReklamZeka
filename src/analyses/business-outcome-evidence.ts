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

/** Validates a persisted compact evidence envelope before it can enter an L5 context. */
export function validateBusinessOutcomeEvidence(value: unknown): BusinessOutcomeEvidenceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("corrupt_source");
  const candidate = value as Record<string, unknown>;
  const allowed = ["version", "evidenceRef", "evidenceHash", "entityRef", "sourceHeadHash", "sourceManifestHash", "windowStart", "windowEnd", "materializedAt", "summary"];
  if (Object.keys(candidate).length !== allowed.length || Object.keys(candidate).some((key) => !allowed.includes(key)) || candidate.version !== BUSINESS_OUTCOME_EVIDENCE_VERSION
    || typeof candidate.evidenceRef !== "string" || !/^outcome_evidence_[a-f0-9]{24}$/.test(candidate.evidenceRef) || typeof candidate.evidenceHash !== "string" || !HASH.test(candidate.evidenceHash)
    || !candidate.summary || typeof candidate.summary !== "object" || Array.isArray(candidate.summary)) fail("corrupt_source");
  const summary = candidate.summary as Record<string, unknown>; const summaryKeys = ["signalCount", "batchCount", "totals", "revenueMinorByCurrency", "verifiedSignalCount", "unmappedSignalCount", "metaProxyEligible"];
  if (Object.keys(summary).length !== summaryKeys.length || Object.keys(summary).some((key) => !summaryKeys.includes(key)) || summary.metaProxyEligible !== false
    || !Number.isSafeInteger(summary.signalCount) || (summary.signalCount as number) < 0 || !Number.isSafeInteger(summary.batchCount) || (summary.batchCount as number) < 0
    || !Number.isSafeInteger(summary.verifiedSignalCount) || !Number.isSafeInteger(summary.unmappedSignalCount) || (summary.verifiedSignalCount as number) + (summary.unmappedSignalCount as number) !== summary.signalCount
    || !summary.totals || typeof summary.totals !== "object" || Array.isArray(summary.totals) || !summary.revenueMinorByCurrency || typeof summary.revenueMinorByCurrency !== "object" || Array.isArray(summary.revenueMinorByCurrency)) fail("corrupt_source");
  const totals = summary.totals as Record<string, unknown>; const outcomes: BusinessOutcomeKind[] = ["qualified_lead", "appointment", "sale", "revenue", "invalid_lead"];
  if (Object.keys(totals).length !== outcomes.length || outcomes.some((outcome) => !Number.isSafeInteger(totals[outcome]) || (totals[outcome] as number) < 0)) fail("corrupt_source");
  const revenueMinorByCurrency = summary.revenueMinorByCurrency as Record<string, unknown>;
  if (Object.entries(revenueMinorByCurrency).some(([currency, amount]) => !CURRENCY.test(currency) || !Number.isSafeInteger(amount) || (amount as number) < 0)) fail("corrupt_source");
  const entityRef = ref(candidate.entityRef, "corrupt_source"); const sourceHeadHash = typeof candidate.sourceHeadHash === "string" && HASH.test(candidate.sourceHeadHash) ? candidate.sourceHeadHash : fail("corrupt_source");
  const sourceManifestHash = typeof candidate.sourceManifestHash === "string" && HASH.test(candidate.sourceManifestHash) ? candidate.sourceManifestHash : fail("corrupt_source");
  const core = Object.freeze({ version: BUSINESS_OUTCOME_EVIDENCE_VERSION, entityRef, sourceHeadHash, sourceManifestHash,
    windowStart: instant(candidate.windowStart, "corrupt_source"), windowEnd: instant(candidate.windowEnd, "corrupt_source"), materializedAt: instant(candidate.materializedAt, "corrupt_source"),
    summary: Object.freeze({ signalCount: summary.signalCount as number, batchCount: summary.batchCount as number,
      totals: Object.freeze(Object.fromEntries(outcomes.map((outcome) => [outcome, totals[outcome] as number])) as Record<BusinessOutcomeKind, number>),
      revenueMinorByCurrency: Object.freeze(Object.fromEntries(Object.entries(revenueMinorByCurrency).sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) => [currency, amount as number]))),
      verifiedSignalCount: summary.verifiedSignalCount as number, unmappedSignalCount: summary.unmappedSignalCount as number, metaProxyEligible: false as const }) });
  if (Date.parse(core.windowStart) >= Date.parse(core.windowEnd) || hash(core) !== candidate.evidenceHash || candidate.evidenceRef !== `outcome_evidence_${candidate.evidenceHash.slice(0, 24)}`) fail("corrupt_source");
  return Object.freeze({ ...core, evidenceRef: candidate.evidenceRef, evidenceHash: candidate.evidenceHash });
}
