import { describe, expect, it } from "vitest";
import { CreativeFatigueConfigDiagnosticV2Error, diagnoseCreativeFatigueV2 } from "@/analyses/creative-fatigue-config-diagnostics-v2";

function window(startDate: string, endDate: string, frequency: number, clicks: number, impressions: number) {
  const days = startDate === "2026-08-01" ? ["2026-08-01", "2026-08-02"] : ["2026-08-03", "2026-08-04"];
  return { startDate, endDate, frequency, clicks, impressions, sourceSnapshotRef: `snapshot_${startDate.slice(-2)}`, dailyCoverage: days.map((date) => ({ date, settled: true, sourceSnapshotRef: `daily_${date.slice(-2)}` })) };
}
function input() { return { subjectRef: "ad_binding_primary", baseline: window("2026-08-01", "2026-08-02", 1, 80, 2_000), recent: window("2026-08-03", "2026-08-04", 1.4, 40, 2_000), minimumImpressions: 1_000, minimumFrequencyIncreaseFraction: 0.2, minimumCtrDeclineFraction: 0.2 }; }

describe("creative fatigue V2", () => {
  it("uses direct all-days frequency and ratio-of-sums CTR, never daily averages", () => {
    const result = diagnoseCreativeFatigueV2(input());
    expect(result).toMatchObject({ contractVersion: "creative-fatigue-config-diagnostics/2.0.0", state: "finding", baseline: { frequency: 1, ctr: 0.04 }, recent: { frequency: 1.4, ctr: 0.02 }, capabilities: { canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false, canAccessNetwork: false } });
  });
  it("rejects non-adjacent, incomplete and unsettled windows instead of estimating", () => {
    expect(() => diagnoseCreativeFatigueV2({ ...input(), recent: window("2026-08-04", "2026-08-05", 1.4, 40, 2_000) })).toThrow(CreativeFatigueConfigDiagnosticV2Error);
    expect(() => diagnoseCreativeFatigueV2({ ...input(), baseline: { ...input().baseline, dailyCoverage: [input().baseline.dailyCoverage[0]!] } })).toThrow("tam ve tekil");
    expect(diagnoseCreativeFatigueV2({ ...input(), recent: { ...input().recent, dailyCoverage: [{ ...input().recent.dailyCoverage[0]!, settled: false }, input().recent.dailyCoverage[1]!] } }).state).toBe("insufficient_data");
  });
  it("is deterministic and does not infer a frequency from impressions", () => {
    const first = diagnoseCreativeFatigueV2(input());
    const second = diagnoseCreativeFatigueV2(input());
    expect(first).toEqual(second);
    expect(() => diagnoseCreativeFatigueV2({ ...input(), baseline: { ...input().baseline, frequency: Number.NaN } })).toThrow(CreativeFatigueConfigDiagnosticV2Error);
  });
});
