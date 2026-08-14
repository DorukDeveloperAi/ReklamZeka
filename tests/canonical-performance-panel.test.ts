import { describe, expect, it } from "vitest";
import { canonicalPerformancePanelProjection } from "@/app/dashboard/canonical-performance-panel";

const readyWindow = {
  days: 7, state: "ready", observedDays: 7, missingDays: [], freshnessAt: "2026-08-14T10:00:00.000Z",
  attribution: "7d_click", currency: "TRY", spend: { valueDecimal: "70000", currency: "TRY" }, outcome: { valueDecimal: "14" }, cpa: { valueDecimal: "5000", currency: "TRY" }, reasonCodes: [],
};
const partialWindow = { ...readyWindow, state: "partial", observedDays: 5, missingDays: ["2026-08-13", "2026-08-14"], spend: null, outcome: null, cpa: null, reasonCodes: ["coverage_incomplete"] };
const account = (suffix: string, name: string, seven: Record<string, unknown> = readyWindow) => ({ accountRef: `account_${suffix.repeat(24)}`, name, currency: "TRY", windows: [seven, { ...seven, days: 30, state: "partial", observedDays: 7, missingDays: ["2026-07-01"], spend: null, outcome: null, cpa: null, reasonCodes: ["coverage_incomplete"] }] });
const payload = (overrides: Record<string, unknown> = {}) => ({ version: "canonical-performance-read/1.0.0", state: "partial", accounts: [account("a", "Hazır hesap"), account("b", "Kısmi hesap", partialWindow)], authority: { actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false }, source: { contractVersion: "public-source/1.0.0", kind: "canonical_performance", state: "partial", observedAt: "2026-08-14T10:00:00.000Z", freshnessAt: "2026-08-14T10:00:00.000Z", freshnessThresholdMinutes: null, reasonCodes: ["coverage_incomplete"] }, ...overrides });

describe("canonical performance dashboard projection", () => {
  it("keeps each account window separate and preserves a partial portfolio source", () => {
    const result = canonicalPerformancePanelProjection(payload());
    expect(result).toMatchObject({ source: { state: "partial", reasonCodes: ["coverage_incomplete"] }, accounts: [{ name: "Hazır hesap" }, { name: "Kısmi hesap" }] });
    expect(result?.accounts[0]?.windows.find((window) => window.days === 7)?.state).toBe("ready");
    expect(result?.accounts[1]?.windows.find((window) => window.days === 7)?.state).toBe("partial");
  });

  it("fails closed if public source provenance is missing, mismatched or claims write authority", () => {
    expect(canonicalPerformancePanelProjection({ ...payload(), source: undefined })).toBeNull();
    expect(canonicalPerformancePanelProjection(payload({ source: { ...payload().source, kind: "historical" } }))).toBeNull();
    expect(canonicalPerformancePanelProjection(payload({ authority: { ...payload().authority, canWriteMeta: true } }))).toBeNull();
  });

  it("rejects malformed account references and ambiguous window cardinality", () => {
    expect(canonicalPerformancePanelProjection(payload({ accounts: [{ ...account("a", "A"), accountRef: "act_123" }] }))).toBeNull();
    expect(canonicalPerformancePanelProjection(payload({ accounts: [{ ...account("a", "A"), windows: [readyWindow, readyWindow] }] }))).toBeNull();
  });
});
