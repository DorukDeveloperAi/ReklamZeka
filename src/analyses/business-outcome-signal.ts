import { createHash } from "node:crypto";

export const BUSINESS_OUTCOME_SIGNAL_VERSION = "business-outcome-signal/1.0.0" as const;
export type BusinessOutcomeKind = "qualified_lead" | "appointment" | "sale" | "revenue" | "invalid_lead";
export type BusinessOutcomeSignal = Readonly<{
  signalRef: string;
  entityRef: string;
  occurredAt: string;
  outcome: BusinessOutcomeKind;
  quantity: number;
  valueMinor: number | null;
  currency: string | null;
  metaEntityRef: string | null;
  mappingStatus: "verified" | "unmapped";
}>;
export type BusinessOutcomeSignalBatch = Readonly<{
  contractVersion: typeof BUSINESS_OUTCOME_SIGNAL_VERSION;
  batchId: string;
  source: Readonly<{ kind: "manual" | "csv"; sourceRef: string; contentHash: string; observedAt: string }>;
  signals: readonly BusinessOutcomeSignal[];
}>;
export type BusinessOutcomeSummary = Readonly<{
  batchId: string;
  totals: Readonly<Record<BusinessOutcomeKind, number>>;
  revenueMinor: number;
  mappedSignalCount: number;
  unmappedSignalCount: number;
  /** Never substitute a Meta metric when attribution has not been verified. */
  metaProxyEligible: false;
}>;

export class BusinessOutcomeSignalError extends Error {
  constructor(message: string) { super(message); this.name = "BusinessOutcomeSignalError"; }
}
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
function ref(value: string, label: string): void { if (!REF.test(value)) throw new BusinessOutcomeSignalError(`${label} opaque ref olmalıdır`); }
function instant(value: string, label: string): void { if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new BusinessOutcomeSignalError(`${label} canonical ISO instant olmalıdır`); }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

/**
 * Canonicalizes owner-entered or CSV-derived business outcomes. The data remains
 * business evidence only: a missing or even verified mapping never changes a Meta metric.
 */
export function createBusinessOutcomeSignalBatch(input: Readonly<{
  source: BusinessOutcomeSignalBatch["source"];
  signals: readonly BusinessOutcomeSignal[];
}>): BusinessOutcomeSignalBatch {
  if (!input.source || !["manual", "csv"].includes(input.source.kind)) throw new BusinessOutcomeSignalError("source kind geçersizdir");
  ref(input.source.sourceRef, "sourceRef"); instant(input.source.observedAt, "observedAt");
  if (!HASH.test(input.source.contentHash)) throw new BusinessOutcomeSignalError("contentHash SHA-256 olmalıdır");
  if (!Array.isArray(input.signals) || input.signals.length === 0 || input.signals.length > 10_000) throw new BusinessOutcomeSignalError("signals 1..10000 aralığında olmalıdır");
  const signals = input.signals.map((signal) => {
    ref(signal.signalRef, "signalRef"); ref(signal.entityRef, "entityRef"); instant(signal.occurredAt, "occurredAt");
    if (!(["qualified_lead", "appointment", "sale", "revenue", "invalid_lead"] as const).includes(signal.outcome)
      || !Number.isSafeInteger(signal.quantity) || signal.quantity < 1) throw new BusinessOutcomeSignalError("outcome veya quantity geçersizdir");
    if (signal.outcome === "revenue") {
      if (!Number.isSafeInteger(signal.valueMinor) || signal.valueMinor < 0 || signal.currency === null || !CURRENCY.test(signal.currency)) throw new BusinessOutcomeSignalError("revenue value/currency zorunludur");
    } else if (signal.valueMinor !== null || signal.currency !== null) throw new BusinessOutcomeSignalError("yalnız revenue value/currency taşıyabilir");
    if (!(["verified", "unmapped"] as const).includes(signal.mappingStatus)) throw new BusinessOutcomeSignalError("mappingStatus geçersizdir");
    if (signal.mappingStatus === "verified") { if (signal.metaEntityRef === null) throw new BusinessOutcomeSignalError("verified mapping metaEntityRef ister"); ref(signal.metaEntityRef, "metaEntityRef"); }
    else if (signal.metaEntityRef !== null) throw new BusinessOutcomeSignalError("unmapped signal metaEntityRef taşıyamaz");
    return Object.freeze({ ...signal });
  }).sort((left, right) => compare(left.signalRef, right.signalRef));
  if (new Set(signals.map((signal) => signal.signalRef)).size !== signals.length) throw new BusinessOutcomeSignalError("signalRef benzersiz olmalıdır");
  const core = { contractVersion: BUSINESS_OUTCOME_SIGNAL_VERSION, source: input.source, signals };
  return Object.freeze({ ...core, batchId: `outcome_batch_${hash(core).slice(0, 24)}`, signals: Object.freeze(signals), source: Object.freeze({ ...input.source }) });
}

export function summarizeBusinessOutcomeSignals(batch: BusinessOutcomeSignalBatch): BusinessOutcomeSummary {
  if (batch.contractVersion !== BUSINESS_OUTCOME_SIGNAL_VERSION || !/^outcome_batch_[a-f0-9]{24}$/.test(batch.batchId)) throw new BusinessOutcomeSignalError("batch authentic değildir");
  const rebuilt = createBusinessOutcomeSignalBatch({ source: batch.source, signals: batch.signals });
  if (rebuilt.batchId !== batch.batchId) throw new BusinessOutcomeSignalError("batch hash uyuşmuyor");
  const totals: Record<BusinessOutcomeKind, number> = { qualified_lead: 0, appointment: 0, sale: 0, revenue: 0, invalid_lead: 0 };
  let revenueMinor = 0; let mappedSignalCount = 0;
  for (const signal of batch.signals) { totals[signal.outcome] += signal.quantity; revenueMinor += signal.valueMinor ?? 0; if (signal.mappingStatus === "verified") mappedSignalCount += 1; }
  return Object.freeze({ batchId: batch.batchId, totals: Object.freeze(totals), revenueMinor, mappedSignalCount,
    unmappedSignalCount: batch.signals.length - mappedSignalCount, metaProxyEligible: false });
}
