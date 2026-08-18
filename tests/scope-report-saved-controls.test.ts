import { describe, expect, it } from "vitest";
import { parseSavedScopeReportList } from "@/app/dashboard/scope-report-saved-controls";

const item = Object.freeze({
  version: "saved-scope-report/1.0.0",
  workspaceId: "11111111-1111-4111-a111-111111111111",
  reportRef: `scope_report_saved_${"a".repeat(24)}`,
  commandRef: `scope_report_save_${"b".repeat(64)}`,
  revisionNumber: 1,
  previousRevisionHash: "GENESIS",
  revisionHash: "c".repeat(64),
  state: "active",
  label: "Haftalık lead",
  query: {
    slice: "slice_yerli",
    start: "2026-08-01",
    end: "2026-08-18",
    granularity: "week",
    level: "ad_set",
    metric: null,
    action: "lead",
    sort: "entity",
    direction: "desc",
  },
  createdByActorId: "22222222-2222-4222-a222-222222222222",
  createdAt: "2026-08-18T08:00:00.000Z",
  authority: { canWriteMeta: false, canApprove: false, canExecute: false },
});

describe("saved scope report controls", () => {
  it("accepts only the closed no-authority saved query read model", () => {
    expect(parseSavedScopeReportList({ items: [item] })?.[0]?.query.slice).toBe(
      "slice_yerli",
    );
    expect(
      parseSavedScopeReportList({
        items: [
          { ...item, query: { ...item.query, slice: "workspace_internal" } },
        ],
      }),
    ).toBeNull();
    expect(
      parseSavedScopeReportList({
        items: [
          { ...item, authority: { ...item.authority, canExecute: true } },
        ],
      }),
    ).toBeNull();
    expect(
      parseSavedScopeReportList({
        items: [{ ...item, rawInternalId: "secret" }],
      }),
    ).toBeNull();
  });
});
