import { describe, expect, it } from "vitest";
import {
  createSavedScopeReportRevision,
  normalizeSavedScopeReportQuery,
  SavedScopeReportError,
  verifySavedScopeReportRevision,
} from "@/domain/slices/scope-report-saved";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = () => ({
  slice: "slice_main",
  start: "2026-08-01",
  end: "2026-08-18",
  granularity: "week" as const,
  level: "ad_set" as const,
  metric: null,
  action: "lead",
  sort: "entity" as const,
  direction: "desc" as const,
});
describe("saved scope report", () => {
  it("creates deterministic immutable no-authority revisions", () => {
    const revision = createSavedScopeReportRevision({
      workspaceId: id(1),
      reportRef: `scope_report_saved_${"a".repeat(24)}`,
      commandRef: `scope_report_save_${"b".repeat(64)}`,
      revisionNumber: 1,
      previousRevisionHash: "GENESIS",
      state: "active",
      label: "Haftalık lead",
      query: query(),
      createdByActorId: id(2),
      createdAt: "2026-08-18T08:00:00.000Z",
    });
    expect(verifySavedScopeReportRevision(revision)).toBe(true);
    expect(revision.authority).toEqual({
      canWriteMeta: false,
      canApprove: false,
      canExecute: false,
    });
    expect(Object.isFrozen(revision)).toBe(true);
    expect(revision.revisionHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects invalid calendars, oversized periods and extra keys", () => {
    expect(() =>
      normalizeSavedScopeReportQuery({ ...query(), start: "2026-02-30" }),
    ).toThrow(SavedScopeReportError);
    expect(() =>
      normalizeSavedScopeReportQuery({
        ...query(),
        start: "2024-01-01",
        end: "2026-01-01",
      }),
    ).toThrow(SavedScopeReportError);
    expect(() =>
      normalizeSavedScopeReportQuery({ ...query(), workspaceId: id(1) }),
    ).toThrow(SavedScopeReportError);
  });
  it("requires exact chains and detects tamper", () => {
    const first = createSavedScopeReportRevision({
      workspaceId: id(1),
      reportRef: `scope_report_saved_${"a".repeat(24)}`,
      commandRef: `scope_report_save_${"b".repeat(64)}`,
      revisionNumber: 1,
      previousRevisionHash: "GENESIS",
      state: "active",
      label: "Rapor",
      query: query(),
      createdByActorId: id(2),
      createdAt: "2026-08-18T08:00:00.000Z",
    });
    const next = createSavedScopeReportRevision({
      workspaceId: first.workspaceId,
      reportRef: first.reportRef,
      label: first.label,
      query: first.query,
      createdByActorId: first.createdByActorId,
      commandRef: `scope_report_save_${"c".repeat(64)}`,
      revisionNumber: 2,
      previousRevisionHash: first.revisionHash,
      state: "archived",
      createdAt: "2026-08-18T08:01:00.000Z",
    });
    expect(verifySavedScopeReportRevision(next)).toBe(true);
    expect(verifySavedScopeReportRevision({ ...next, label: "Başka" })).toBe(
      false,
    );
    expect(() =>
      createSavedScopeReportRevision({
        workspaceId: first.workspaceId,
        reportRef: first.reportRef,
        commandRef: first.commandRef,
        state: first.state,
        label: first.label,
        query: first.query,
        createdByActorId: first.createdByActorId,
        createdAt: first.createdAt,
        revisionNumber: 2,
        previousRevisionHash: "GENESIS",
      }),
    ).toThrow(SavedScopeReportError);
  });
});
