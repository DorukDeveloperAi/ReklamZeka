import { describe, expect, it } from "vitest";

import { buildMetaDataHealthReport, type MetaDataHealthAccountEvidence } from "@/domain/meta/data-health";
import { projectMetaDataHealthObservationEvents } from "@/domain/meta/data-health-observation-lifecycle";
import { publicSource } from "@/domain/source/public-source";

const workspaceRef = `workspace_${"a".repeat(24)}`; const accountRef = `account_${"b".repeat(24)}`;
const now = "2026-08-17T12:00:00.000Z";
function report(healthy: boolean) {
  const source = (kind: "canonical_meta_mirror" | "canonical_performance" | "derived_trust") => publicSource({ kind,
    state: "ready", observedAt: now, freshnessAt: now, freshnessThresholdMinutes: 1440, reasonCodes: [] });
  const account: MetaDataHealthAccountEvidence = { accountRef, currency: "TRY", sources: { mirror: source("canonical_meta_mirror"),
    performance: source("canonical_performance"), trust: source("derived_trust") }, requiredDates: ["2026-08-16"],
    observedDates: healthy ? ["2026-08-16"] : [], requiredFields: ["campaign"], observedFields: ["campaign"] };
  return buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now, accounts: [account] });
}
function head(event: ReturnType<typeof projectMetaDataHealthObservationEvents>[number]) { return { workspaceRef: event.workspaceRef,
  fingerprint: event.fingerprint, sequence: event.sequence, state: event.state, evidenceHash: event.evidenceHash, eventHash: event.eventHash }; }

describe("Meta data health observation lifecycle", () => {
  it("appends same-fingerprint observations idempotently and resolves then reopens", () => {
    const opened = projectMetaDataHealthObservationEvents({ workspaceRef, report: report(false), previousHeads: [], occurredAt: now });
    const replay = projectMetaDataHealthObservationEvents({ workspaceRef, report: report(false), previousHeads: [], occurredAt: now });
    expect(opened).toEqual(replay); expect(opened[0]).toMatchObject({ event: "opened", sequence: 1, state: "open",
      developmentLog: { state: "proposed", canTriage: false, canCreateTask: false } });
    const observed = projectMetaDataHealthObservationEvents({ workspaceRef, report: report(false), previousHeads: [head(opened[0]!)], occurredAt: "2026-08-18T12:00:00.000Z" });
    const observedReplay = projectMetaDataHealthObservationEvents({ workspaceRef, report: report(false), previousHeads: [head(opened[0]!)], occurredAt: "2026-08-18T12:00:00.000Z" });
    expect(observedReplay[0]!.eventHash).toBe(observed[0]!.eventHash);
    expect(observed[0]).toMatchObject({ fingerprint: opened[0]!.fingerprint, event: "observed", sequence: 2 });
    const resolved = projectMetaDataHealthObservationEvents({ workspaceRef, report: report(true), previousHeads: [head(observed[0]!)], occurredAt: "2026-08-19T12:00:00.000Z" });
    expect(resolved[0]).toMatchObject({ event: "resolved", state: "resolved", observation: null });
    const reopened = projectMetaDataHealthObservationEvents({ workspaceRef, report: report(false), previousHeads: [head(resolved[0]!)], occurredAt: "2026-08-20T12:00:00.000Z" });
    expect(reopened[0]).toMatchObject({ event: "reopened", state: "open", sequence: 4 });
  });

  it("rejects a foreign tenant head", () => {
    const opened = projectMetaDataHealthObservationEvents({ workspaceRef, report: report(false), previousHeads: [], occurredAt: now });
    expect(() => projectMetaDataHealthObservationEvents({ workspaceRef, report: report(false), previousHeads: [
      { ...head(opened[0]!), workspaceRef: `workspace_${"c".repeat(24)}` }], occurredAt: now }))
      .toThrowError(expect.objectContaining({ code: "workspace_scope_mismatch" }));
    expect(() => projectMetaDataHealthObservationEvents({ workspaceRef, report: { ...report(false), reportHash: "f".repeat(64) },
      previousHeads: [], occurredAt: now })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => projectMetaDataHealthObservationEvents({ workspaceRef: `workspace_${"c".repeat(24)}`, report: report(false),
      previousHeads: [], occurredAt: now })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});
