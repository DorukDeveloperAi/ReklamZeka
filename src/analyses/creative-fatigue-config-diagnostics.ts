import { createHash } from "node:crypto";

export const CREATIVE_FATIGUE_CONFIG_DIAGNOSTIC_VERSION = "creative-fatigue-config-diagnostics/1.0.0" as const;

export type CreativeDiagnosticState = "finding" | "clear" | "insufficient_data";
export type CreativeConfig = Readonly<{
  objectiveRef: string;
  optimizationEventRef: string;
  billingEventRef: string;
  destinationRef: string;
}>;
export type CreativeFatigueObservation = Readonly<{
  date: string;
  frequency: number;
  ctr: number;
  impressions: number;
  settled: boolean;
  sourceSnapshotRef: string;
}>;
export type CreativeFatigueConfigDiagnostic = Readonly<{
  contractVersion: typeof CREATIVE_FATIGUE_CONFIG_DIAGNOSTIC_VERSION;
  diagnosticId: string;
  creativeRef: string;
  fatigue: Readonly<{
    state: CreativeDiagnosticState;
    reason: "minimum_days_not_met" | "unsettled_observation" | "minimum_impressions_not_met" | "frequency_and_ctr_not_degraded" | "frequency_ctr_degradation";
    baselineFrequency: number | null;
    recentFrequency: number | null;
    baselineCtr: number | null;
    recentCtr: number | null;
  }>;
  configuration: Readonly<{
    state: "clear" | "finding";
    mismatchedFields: readonly (keyof CreativeConfig)[];
  }>;
  sourceSnapshotRefs: readonly string[];
  capabilities: Readonly<{ canAuthorizeAction: false; canExecuteWrite: false; canWriteMeta: false }>;
}>;

export class CreativeFatigueConfigDiagnosticError extends Error {
  constructor(message: string) { super(message); this.name = "CreativeFatigueConfigDiagnosticError"; }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
function ref(value: string, label: string): void { if (!REF.test(value)) throw new CreativeFatigueConfigDiagnosticError(`${label} opaque ref olmalıdır`); }
function date(value: string): void { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new CreativeFatigueConfigDiagnosticError("date ISO günü olmalıdır"); }
function positive(value: number, label: string, zero = false): void { if (!Number.isFinite(value) || (zero ? value < 0 : value <= 0)) throw new CreativeFatigueConfigDiagnosticError(`${label} sonlu ${zero ? "negatif olmayan" : "pozitif"} sayı olmalıdır`); }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function average(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function validateConfig(config: CreativeConfig): void { for (const [key, value] of Object.entries(config)) ref(value, key); }

/**
 * Safe L2/L3 diagnostic: it identifies review-worthy creative fatigue and
 * configuration drift, but has no action recommendation or write authority.
 */
export function diagnoseCreativeFatigueAndConfig(input: Readonly<{
  creativeRef: string;
  expectedConfig: CreativeConfig;
  observedConfig: CreativeConfig;
  minimumDays: number;
  minimumImpressions: number;
  minimumFrequencyIncreaseFraction: number;
  minimumCtrDeclineFraction: number;
  observations: readonly CreativeFatigueObservation[];
}>): CreativeFatigueConfigDiagnostic {
  ref(input.creativeRef, "creativeRef"); validateConfig(input.expectedConfig); validateConfig(input.observedConfig);
  if (!Number.isSafeInteger(input.minimumDays) || input.minimumDays < 2 || input.minimumDays % 2 !== 0) throw new CreativeFatigueConfigDiagnosticError("minimumDays çift ve en az 2 olmalıdır");
  positive(input.minimumImpressions, "minimumImpressions"); positive(input.minimumFrequencyIncreaseFraction, "minimumFrequencyIncreaseFraction"); positive(input.minimumCtrDeclineFraction, "minimumCtrDeclineFraction");
  const observations = input.observations.map((entry) => {
    date(entry.date); ref(entry.sourceSnapshotRef, "sourceSnapshotRef"); positive(entry.frequency, "frequency", true); positive(entry.ctr, "ctr", true); positive(entry.impressions, "impressions", true);
    return Object.freeze({ ...entry });
  }).sort((left, right) => left.date.localeCompare(right.date));
  if (new Set(observations.map((entry) => entry.date)).size !== observations.length) throw new CreativeFatigueConfigDiagnosticError("Her gün için yalnız bir observation olabilir");
  const sourceSnapshotRefs = [...new Set(observations.map((entry) => entry.sourceSnapshotRef))].sort();
  let fatigue: CreativeFatigueConfigDiagnostic["fatigue"];
  if (observations.length < input.minimumDays) {
    fatigue = Object.freeze({ state: "insufficient_data", reason: "minimum_days_not_met", baselineFrequency: null, recentFrequency: null, baselineCtr: null, recentCtr: null });
  } else if (observations.some((entry) => !entry.settled)) {
    fatigue = Object.freeze({ state: "insufficient_data", reason: "unsettled_observation", baselineFrequency: null, recentFrequency: null, baselineCtr: null, recentCtr: null });
  } else if (observations.reduce((sum, entry) => sum + entry.impressions, 0) < input.minimumImpressions) {
    fatigue = Object.freeze({ state: "insufficient_data", reason: "minimum_impressions_not_met", baselineFrequency: null, recentFrequency: null, baselineCtr: null, recentCtr: null });
  } else {
    const window = observations.slice(-input.minimumDays); const middle = window.length / 2;
    const baseline = window.slice(0, middle); const recent = window.slice(middle);
    const baselineFrequency = average(baseline.map((entry) => entry.frequency)); const recentFrequency = average(recent.map((entry) => entry.frequency));
    const baselineCtr = average(baseline.map((entry) => entry.ctr)); const recentCtr = average(recent.map((entry) => entry.ctr));
    const frequencyIncrease = baselineFrequency === 0 ? 0 : (recentFrequency - baselineFrequency) / baselineFrequency;
    const ctrDecline = baselineCtr === 0 ? 0 : (baselineCtr - recentCtr) / baselineCtr;
    const degraded = frequencyIncrease >= input.minimumFrequencyIncreaseFraction && ctrDecline >= input.minimumCtrDeclineFraction;
    fatigue = Object.freeze({ state: degraded ? "finding" : "clear", reason: degraded ? "frequency_ctr_degradation" : "frequency_and_ctr_not_degraded", baselineFrequency, recentFrequency, baselineCtr, recentCtr });
  }
  const mismatchedFields = (Object.keys(input.expectedConfig) as (keyof CreativeConfig)[]).filter((key) => input.expectedConfig[key] !== input.observedConfig[key]).sort();
  const configuration = Object.freeze({ state: mismatchedFields.length === 0 ? "clear" as const : "finding" as const, mismatchedFields: Object.freeze(mismatchedFields) });
  const core = { contractVersion: CREATIVE_FATIGUE_CONFIG_DIAGNOSTIC_VERSION, creativeRef: input.creativeRef, expectedConfig: input.expectedConfig,
    observedConfig: input.observedConfig, minimumDays: input.minimumDays, minimumImpressions: input.minimumImpressions,
    minimumFrequencyIncreaseFraction: input.minimumFrequencyIncreaseFraction, minimumCtrDeclineFraction: input.minimumCtrDeclineFraction,
    observations, fatigue, configuration, sourceSnapshotRefs };
  return Object.freeze({ contractVersion: CREATIVE_FATIGUE_CONFIG_DIAGNOSTIC_VERSION, diagnosticId: `creative_diagnostic_${digest(core).slice(0, 24)}`,
    creativeRef: input.creativeRef, fatigue, configuration, sourceSnapshotRefs: Object.freeze(sourceSnapshotRefs),
    capabilities: Object.freeze({ canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false }) });
}
