import { createHash } from "node:crypto";

/**
 * V2 deliberately accepts only source-grain, all-days window values.  Daily
 * rows are coverage evidence, not inputs to a frequency/CTR average.
 */
export const CREATIVE_FATIGUE_CONFIG_DIAGNOSTIC_V2_VERSION = "creative-fatigue-config-diagnostics/2.0.0" as const;

export type CreativeFatigueWindowV2 = Readonly<{
  startDate: string;
  endDate: string;
  frequency: number;
  clicks: number;
  impressions: number;
  sourceSnapshotRef: string;
  dailyCoverage: readonly Readonly<{ date: string; settled: boolean; sourceSnapshotRef: string }>[];
}>;

export type CreativeFatigueV2 = Readonly<{
  contractVersion: typeof CREATIVE_FATIGUE_CONFIG_DIAGNOSTIC_V2_VERSION;
  diagnosticId: string;
  subjectRef: string;
  state: "finding" | "clear" | "insufficient_data";
  reason: "coverage_incomplete" | "unsettled_coverage" | "minimum_impressions_not_met" | "frequency_and_ctr_not_degraded" | "frequency_ctr_degradation";
  baseline: Readonly<{ frequency: number; ctr: number; impressions: number }> | null;
  recent: Readonly<{ frequency: number; ctr: number; impressions: number }> | null;
  sourceSnapshotRefs: readonly string[];
  capabilities: Readonly<{ canAuthorizeAction: false; canExecuteWrite: false; canWriteMeta: false; canAccessNetwork: false }>;
}>;

export class CreativeFatigueConfigDiagnosticV2Error extends Error {
  constructor(message: string) { super(message); this.name = "CreativeFatigueConfigDiagnosticV2Error"; }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
function ref(value: string, label: string): void { if (!REF.test(value)) throw new CreativeFatigueConfigDiagnosticV2Error(`${label} opaque ref olmalıdır`); }
function day(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CreativeFatigueConfigDiagnosticV2Error("tarih ISO günü olmalıdır");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new CreativeFatigueConfigDiagnosticV2Error("tarih ISO günü olmalıdır");
}
function nonNegative(value: number, label: string): void { if (!Number.isFinite(value) || value < 0) throw new CreativeFatigueConfigDiagnosticV2Error(`${label} negatif olmayan sonlu sayı olmalıdır`); }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function calendarDays(startDate: string, endDate: string): readonly string[] {
  const values: string[] = []; const cursor = new Date(`${startDate}T00:00:00.000Z`); const end = new Date(`${endDate}T00:00:00.000Z`);
  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) values.push(cursor.toISOString().slice(0, 10));
  return values;
}
function validateWindow(window: CreativeFatigueWindowV2): void {
  day(window.startDate); day(window.endDate); if (window.startDate > window.endDate) throw new CreativeFatigueConfigDiagnosticV2Error("pencere tarihleri sıralı olmalıdır");
  ref(window.sourceSnapshotRef, "sourceSnapshotRef"); nonNegative(window.frequency, "frequency"); nonNegative(window.clicks, "clicks"); nonNegative(window.impressions, "impressions");
  const expected = calendarDays(window.startDate, window.endDate);
  if (window.dailyCoverage.length !== expected.length || new Set(window.dailyCoverage.map((entry) => entry.date)).size !== expected.length) throw new CreativeFatigueConfigDiagnosticV2Error("daily coverage pencereyi tam ve tekil kapsamalıdır");
  for (const entry of window.dailyCoverage) { day(entry.date); ref(entry.sourceSnapshotRef, "dailyCoverage.sourceSnapshotRef"); }
  if (window.dailyCoverage.some((entry) => !expected.includes(entry.date))) throw new CreativeFatigueConfigDiagnosticV2Error("daily coverage pencere dışına taşamaz");
}

export function diagnoseCreativeFatigueV2(input: Readonly<{
  subjectRef: string;
  baseline: CreativeFatigueWindowV2;
  recent: CreativeFatigueWindowV2;
  minimumImpressions: number;
  minimumFrequencyIncreaseFraction: number;
  minimumCtrDeclineFraction: number;
}>): CreativeFatigueV2 {
  ref(input.subjectRef, "subjectRef"); validateWindow(input.baseline); validateWindow(input.recent);
  if (input.baseline.endDate >= input.recent.startDate || calendarDays(input.baseline.startDate, input.baseline.endDate).length !== calendarDays(input.recent.startDate, input.recent.endDate).length) throw new CreativeFatigueConfigDiagnosticV2Error("pencereler eşit uzunlukta ve bitişik olmalıdır");
  if (calendarDays(input.baseline.startDate, input.baseline.endDate).at(-1)! !== new Date(new Date(`${input.recent.startDate}T00:00:00.000Z`).getTime() - 86_400_000).toISOString().slice(0, 10)) throw new CreativeFatigueConfigDiagnosticV2Error("pencereler bitişik olmalıdır");
  for (const [label, value] of [["minimumImpressions", input.minimumImpressions], ["minimumFrequencyIncreaseFraction", input.minimumFrequencyIncreaseFraction], ["minimumCtrDeclineFraction", input.minimumCtrDeclineFraction]] as const) if (!Number.isFinite(value) || value <= 0) throw new CreativeFatigueConfigDiagnosticV2Error(`${label} pozitif sonlu sayı olmalıdır`);
  const refs = [...new Set([input.baseline.sourceSnapshotRef, input.recent.sourceSnapshotRef, ...input.baseline.dailyCoverage.map((entry) => entry.sourceSnapshotRef), ...input.recent.dailyCoverage.map((entry) => entry.sourceSnapshotRef)])].sort();
  const capabilities = Object.freeze({ canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false, canAccessNetwork: false } as const);
  let state: CreativeFatigueV2["state"]; let reason: CreativeFatigueV2["reason"]; let baseline: CreativeFatigueV2["baseline"] = null; let recent: CreativeFatigueV2["recent"] = null;
  if (input.baseline.dailyCoverage.some((entry) => !entry.settled) || input.recent.dailyCoverage.some((entry) => !entry.settled)) { state = "insufficient_data"; reason = "unsettled_coverage"; }
  else if (input.baseline.impressions < input.minimumImpressions || input.recent.impressions < input.minimumImpressions || input.baseline.impressions === 0 || input.recent.impressions === 0) { state = "insufficient_data"; reason = "minimum_impressions_not_met"; }
  else {
    baseline = Object.freeze({ frequency: input.baseline.frequency, ctr: input.baseline.clicks / input.baseline.impressions, impressions: input.baseline.impressions });
    recent = Object.freeze({ frequency: input.recent.frequency, ctr: input.recent.clicks / input.recent.impressions, impressions: input.recent.impressions });
    const degraded = baseline.frequency > 0 && baseline.ctr > 0 && (recent.frequency - baseline.frequency) / baseline.frequency >= input.minimumFrequencyIncreaseFraction && (baseline.ctr - recent.ctr) / baseline.ctr >= input.minimumCtrDeclineFraction;
    state = degraded ? "finding" : "clear"; reason = degraded ? "frequency_ctr_degradation" : "frequency_and_ctr_not_degraded";
  }
  const core = { contractVersion: CREATIVE_FATIGUE_CONFIG_DIAGNOSTIC_V2_VERSION, ...input, baseline, recent, state, reason, refs };
  return Object.freeze({ contractVersion: CREATIVE_FATIGUE_CONFIG_DIAGNOSTIC_V2_VERSION, diagnosticId: `creative_diagnostic_${digest(core).slice(0, 24)}`, subjectRef: input.subjectRef, state, reason, baseline, recent, sourceSnapshotRefs: Object.freeze(refs), capabilities });
}
