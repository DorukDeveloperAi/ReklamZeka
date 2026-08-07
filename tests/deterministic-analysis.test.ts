import { describe, expect, it } from "vitest";
import {
  analyze,
  DeterministicAnalysisContractError,
  type DeterministicAnalysisInput,
} from "@/analyses/deterministic-analysis";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";

const window = resolveAnalysisTimeframe({
  timeframe: { kind: "rolling", days: 7, timezone: "Europe/Istanbul" },
  comparison: "previous_period",
  asOf: "2026-08-07T08:00:00.000Z",
});

function input(): DeterministicAnalysisInput {
  return {
    definitionRef: "analysis_definition:daily-sales@v1",
    contextRef: "context:4b2b850f",
    snapshotRefs: ["snapshot:b", "snapshot:a"],
    resolvedTimeframe: window,
    candidates: [
      {
        checkKey: "roas_floor",
        entityRef: "campaign:b36f",
        metricKey: "roas",
        status: "finding",
        sourceSnapshotRefs: ["snapshot:b", "snapshot:a"],
      },
      {
        checkKey: "minimum_sample",
        entityRef: "campaign:a12c",
        metricKey: "spendMinor",
        status: "insufficient_data",
        missingDataReason: "comparison_window_not_loaded",
        sourceSnapshotRefs: ["snapshot:a"],
      },
    ],
  };
}

describe("deterministic analysis contract", () => {
  it("produces byte-stable IDs and order independent of input ordering", () => {
    const first = analyze(input());
    const original = input();
    const second = analyze({
      ...original,
      snapshotRefs: [...original.snapshotRefs].reverse(),
      candidates: [...original.candidates].reverse().map((candidate) => ({
        ...candidate,
        sourceSnapshotRefs: [...candidate.sourceSnapshotRefs].reverse(),
      })),
    });

    expect(second).toEqual(first);
    expect(first.runId).toMatch(/^analysis_[a-f0-9]{24}$/);
    expect(first.records.map((record) => record.entityRef)).toEqual(["campaign:a12c", "campaign:b36f"]);
    expect(first.records.every((record) => /^finding_[a-f0-9]{24}$/.test(record.recordId))).toBe(true);
  });

  it("requires an explicit reason when data is insufficient", () => {
    const invalid = input();
    expect(() => analyze({
      ...invalid,
      candidates: [{
        ...invalid.candidates[1]!,
        missingDataReason: undefined,
      }],
    })).toThrow("Eksik veri kaydı sebepsiz olamaz");
  });

  it("requires every record to cite a run-scoped snapshot", () => {
    const invalid = input();
    expect(() => analyze({
      ...invalid,
      candidates: [{ ...invalid.candidates[0]!, sourceSnapshotRefs: ["snapshot:foreign"] }],
    })).toThrow(DeterministicAnalysisContractError);
  });

  it("rejects duplicate candidates instead of silently collapsing evidence", () => {
    const invalid = input();
    expect(() => analyze({
      ...invalid,
      candidates: [invalid.candidates[0]!, invalid.candidates[0]!],
    })).toThrow("birden fazla kez");
  });

  it("rejects a caller-forged resolved timeframe before producing IDs", () => {
    const invalid = input();
    expect(() => analyze({
      ...invalid,
      resolvedTimeframe: { ...invalid.resolvedTimeframe, inclusiveDayCount: 700 },
    })).toThrow("inclusiveDayCount");
  });
});
