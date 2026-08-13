import { describe, expect, it } from "vitest";
import { parseTemporalEvaluationCandidates } from "@/app/dashboard/slice-rule-workspace-panel";

const base = {
  contractVersion: "temporal-recommendation-read/1.0.0",
  items: [],
  candidates: [{ candidateRef: `temporal_candidate_${"a".repeat(24)}`, ruleSeriesRef: "series_demo", reviewCadence: "weekly", windowRef: `window_${"b".repeat(24)}`, capturedAt: "2026-08-13T00:00:00.000Z" }],
  authority: { readOnly: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false },
};
describe("slice rule temporal evaluation panel", () => {
  it("renders only opaque, server-derived temporal candidates", () => {
    expect(parseTemporalEvaluationCandidates(base)).toHaveLength(1);
  });
  it("fails closed when a candidate or authority is widened", () => {
    expect(() => parseTemporalEvaluationCandidates({ ...base, candidates: [{ ...base.candidates[0], candidateRef: "context_private" }] })).toThrow();
    expect(() => parseTemporalEvaluationCandidates({ ...base, authority: { ...base.authority, canExecute: true } })).toThrow();
  });
});
