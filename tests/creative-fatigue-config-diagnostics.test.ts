import { describe, expect, it } from "vitest";
import { diagnoseCreativeFatigueAndConfig, CreativeFatigueConfigDiagnosticError } from "@/analyses/creative-fatigue-config-diagnostics";

const config = Object.freeze({ objectiveRef: "objective_lead", optimizationEventRef: "event_lead", billingEventRef: "billing_impression", destinationRef: "destination_landing" });
function input() { return { creativeRef: "creative_primary", expectedConfig: config, observedConfig: config, minimumDays: 4, minimumImpressions: 1_000,
  minimumFrequencyIncreaseFraction: 0.2, minimumCtrDeclineFraction: 0.2, observations: [
    { date: "2026-08-01", frequency: 1, ctr: 0.04, impressions: 500, settled: true, sourceSnapshotRef: "snapshot_01" },
    { date: "2026-08-02", frequency: 1.1, ctr: 0.04, impressions: 500, settled: true, sourceSnapshotRef: "snapshot_02" },
    { date: "2026-08-03", frequency: 1.5, ctr: 0.028, impressions: 600, settled: true, sourceSnapshotRef: "snapshot_03" },
    { date: "2026-08-04", frequency: 1.6, ctr: 0.025, impressions: 600, settled: true, sourceSnapshotRef: "snapshot_04" },
  ] }; }

describe("creative fatigue/config diagnostics", () => {
  it("finds paired frequency growth and CTR degradation without granting action authority", () => {
    expect(diagnoseCreativeFatigueAndConfig(input())).toMatchObject({ fatigue: { state: "finding", reason: "frequency_ctr_degradation" }, configuration: { state: "clear" }, capabilities: { canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false } });
  });
  it("is stable independent of input order and marks config drift separately", () => {
    const first = diagnoseCreativeFatigueAndConfig(input()); const source = input();
    const second = diagnoseCreativeFatigueAndConfig({ ...source, observedConfig: { ...config, destinationRef: "destination_other" }, observations: [...source.observations].reverse() });
    const third = diagnoseCreativeFatigueAndConfig({ ...source, observedConfig: { ...config, destinationRef: "destination_other" } });
    expect(second).toEqual(third); expect(second.diagnosticId).not.toBe(first.diagnosticId); expect(second.configuration).toEqual({ state: "finding", mismatchedFields: ["destinationRef"] });
  });
  it("does not overclaim on missing settled evidence or insufficient impressions", () => {
    const source = input();
    expect(diagnoseCreativeFatigueAndConfig({ ...source, observations: source.observations.slice(0, 3) }).fatigue).toMatchObject({ state: "insufficient_data", reason: "minimum_days_not_met" });
    expect(diagnoseCreativeFatigueAndConfig({ ...source, observations: [{ ...source.observations[0]!, settled: false }, ...source.observations.slice(1)] }).fatigue).toMatchObject({ state: "insufficient_data", reason: "unsettled_observation" });
    expect(diagnoseCreativeFatigueAndConfig({ ...source, minimumImpressions: 100_000 }).fatigue).toMatchObject({ state: "insufficient_data", reason: "minimum_impressions_not_met" });
  });
  it("rejects duplicate days, malformed refs and invalid window definitions", () => {
    const source = input();
    expect(() => diagnoseCreativeFatigueAndConfig({ ...source, observations: [source.observations[0]!, source.observations[0]!] })).toThrow(CreativeFatigueConfigDiagnosticError);
    expect(() => diagnoseCreativeFatigueAndConfig({ ...source, creativeRef: "bad ref" })).toThrow("opaque ref");
    expect(() => diagnoseCreativeFatigueAndConfig({ ...source, minimumDays: 3 })).toThrow("çift");
  });
});
