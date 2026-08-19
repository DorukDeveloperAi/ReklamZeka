import { describe, expect, it } from "vitest";

import { buildMetaDataHealthReport, META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS, META_DATA_HEALTH_MAX_PROJECTED_EVENTS, META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS, type MetaDataHealthAccountEvidence } from "@/domain/meta/data-health";
import { projectMetaDataHealthObservationEvents } from "@/domain/meta/data-health-observation-lifecycle";
import { eligibleDataHealthScopeRefs } from "@/connectors/meta/data-health-finding-development-log-drizzle-repository";
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
function denseReport(state: "partial" | "stale", occurredAt: string, accountOffset = 0) {
  const source = (kind: "canonical_meta_mirror" | "canonical_performance" | "derived_trust") => publicSource({ kind,
    state, observedAt: occurredAt, freshnessAt: occurredAt, freshnessThresholdMinutes: 1440, reasonCodes: [`${kind}_${state}`] });
  const accounts = Array.from({ length: 250 }, (_, index): MetaDataHealthAccountEvidence => ({
    accountRef: `account_${(index + accountOffset).toString(16).padStart(24, "0")}`, currency: null,
    sources: { mirror: source("canonical_meta_mirror"), performance: source("canonical_performance"), trust: source("derived_trust") },
    requiredDates: ["2026-08-16"], observedDates: [], requiredFields: ["campaign"], observedFields: [],
  }));
  return buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: occurredAt, accounts });
}
function apply(events: readonly ReturnType<typeof projectMetaDataHealthObservationEvents>[number][], previous: readonly ReturnType<typeof head>[]) {
  const next = new Map(previous.map(item => [item.fingerprint, item]));
  for (const event of events) next.set(event.fingerprint, head(event));
  return [...next.values()];
}

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

  it("retains source-state history beyond current observations while keeping the next 250-account projection bounded", () => {
    const firstAt = "2026-08-17T12:00:00.000Z";
    const first = projectMetaDataHealthObservationEvents({ workspaceRef, report: denseReport("partial", firstAt), previousHeads: [], occurredAt: firstAt });
    expect(first).toHaveLength(META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS - 1);
    const firstHeads = apply(first, []);
    const staleAt = "2026-08-18T12:00:00.000Z";
    const second = projectMetaDataHealthObservationEvents({ workspaceRef, report: denseReport("stale", staleAt), previousHeads: firstHeads, occurredAt: staleAt });
    expect(second).toHaveLength(2_250);
    const retained = apply(second, firstHeads);
    expect(retained).toHaveLength(2_250);
    const third = projectMetaDataHealthObservationEvents({ workspaceRef, report: denseReport("stale", "2026-08-19T12:00:00.000Z"), previousHeads: retained, occurredAt: "2026-08-19T12:00:00.000Z" });
    expect(third).toHaveLength(META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS - 1);
    expect(META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS).toBe(4_751);
    expect(META_DATA_HEALTH_MAX_PROJECTED_EVENTS).toBe(6_252);
    const tooManyHeads = Array.from({ length: META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS + 1 }, (_, index) => ({
      workspaceRef, fingerprint: `data_quality_${index.toString(16).padStart(32, "0")}`, sequence: 1, state: "open" as const,
      evidenceHash: "a".repeat(64), eventHash: "b".repeat(64),
    }));
    expect(() => projectMetaDataHealthObservationEvents({ workspaceRef, report: report(false), previousHeads: tooManyHeads, occurredAt: now }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("does not load or resolve retained heads from an unrelated rotating account cohort", () => {
    // This represents a ledger which has reached its bounded, retained history
    // capacity for a *different* 250-account cohort.  The account observations
    // need not be currently open for the storage selection invariant: a later
    // report may only load its workspace head and its own account scopes.
    const retained = [
      {
        workspaceRef,
        scopeRef: workspaceRef,
        fingerprint: `data_quality_${"f".repeat(32)}`,
        sequence: 1,
        state: "resolved" as const,
        evidenceHash: "a".repeat(64),
        eventHash: "b".repeat(64),
      },
      ...Array.from({ length: 250 * 19 }, (_, index) => ({
        workspaceRef,
        scopeRef: `account_${Math.floor(index / 19).toString(16).padStart(24, "0")}`,
        fingerprint: `data_quality_${index.toString(16).padStart(32, "0")}`,
        sequence: 1,
        state: "resolved" as const,
        evidenceHash: "a".repeat(64),
        eventHash: "b".repeat(64),
      })),
    ];
    expect(retained).toHaveLength(META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS);
    const secondReport = denseReport("partial", "2026-08-18T12:00:00.000Z", 250);
    const currentScopes = new Set(eligibleDataHealthScopeRefs(secondReport, workspaceRef));
    const eligible = retained.filter(item => currentScopes.has(item.scopeRef));
    // The workspace scope is always eligible; as it is already resolved and
    // absent from this report it must remain untouched.  None of the 4,750
    // historical account heads is loaded or resolved by this cohort.
    expect(eligible).toHaveLength(1);
    const secondEvents = projectMetaDataHealthObservationEvents({ workspaceRef, report: secondReport, previousHeads: eligible, occurredAt: "2026-08-18T12:00:00.000Z" });
    expect(secondEvents).toHaveLength(1_500);
    expect(retained).toHaveLength(META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS);
    const secondHeads = apply(secondEvents, []);
    const third = projectMetaDataHealthObservationEvents({ workspaceRef, report: secondReport, previousHeads: secondHeads, occurredAt: "2026-08-19T12:00:00.000Z" });
    expect(third).toHaveLength(1_500);
  });
});
