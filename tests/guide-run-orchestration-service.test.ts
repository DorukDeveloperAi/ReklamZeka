import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  GuideRunOrchestrationService, InMemoryGuideRunStore,
  type FrozenGuideRunScope, type GuideRunArtifact, type GuideRunArtifactPort,
} from "@/application/guide-run-orchestration-service";
import { createGuideRevision } from "@/domain/guides/guide-revision";

const hash = "a".repeat(64);
const leaseToken = "123e4567-e89b-42d3-a456-426614174000";
const at = "2026-08-17T06:00:02.000Z";
function canonicalHash(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)])) : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function guide(mode: "observe_analyze" | "recommend" | "prepare_human_approval" = "prepare_human_approval") {
  return createGuideRevision({ workspaceRef: "workspace_main", guideRef: "guide_main", revision: 1, previousRevisionHash: null,
    sliceRef: "slice_main", market: "yerli", freeText: "Günlük inceleme", strict: { budgetRefs: [], rollbackConditions: [], budgetInterpretation: null },
    schedule: { frequency: "daily", timezone: "UTC", localTime: "06:00" }, mode,
    actionAllowlist: mode === "observe_analyze" || mode === "recommend" ? [] : ["budget_increase"] });
}
class Artifacts implements GuideRunArtifactPort {
  readonly values: GuideRunArtifact[] = [];
  async list(runRef: string) { return this.values.filter((value) => value.runRef === runRef); }
  async append(value: GuideRunArtifact) { if (!this.values.some((item) => item.artifactRef === value.artifactRef)) this.values.push(value); }
}
function scope(): FrozenGuideRunScope {
  const members = Object.freeze([{ memberRef: "campaign_alpha", membershipHash: "c".repeat(64) }, { memberRef: "campaign_beta", membershipHash: "d".repeat(64) }]);
  return Object.freeze({ runRef: "", guideRevisionHash: "", sliceRef: "slice_main", sliceDefinitionHash: "b".repeat(64), sliceSnapshotHash: "", members });
}
function service(input: Readonly<{ failFirst?: boolean; malicious?: boolean; outcome?: "no_change" | "finding"; dataQuality?: "ready" | "missing" | "stale" }> = {}) {
  const store = new InMemoryGuideRunStore(); const artifacts = new Artifacts(); const calls: string[] = []; let frozen: FrozenGuideRunScope | null = null;
  const value = new GuideRunOrchestrationService(store, {
    async loadOrFreeze({ run, guide: revision }) {
      calls.push("freeze");
      const base = scope(); const snapshot = canonicalHash({ guideRevisionHash: revision.revisionHash, sliceRef: "slice_main", sliceDefinitionHash: base.sliceDefinitionHash, members: [...base.members] });
      frozen ??= Object.freeze({ ...base, runRef: run.runRef, guideRevisionHash: revision.revisionHash, sliceSnapshotHash: snapshot });
      return frozen;
    },
  }, {
    async analyze(context) {
      calls.push(`member:${context.member.memberRef}`);
      expect(context.authority).toEqual({ canMutateGuide: false, canApprove: false, canExecute: false, canWriteMeta: false });
      if (input.failFirst && context.member.memberRef === "campaign_alpha") throw new Error("source unavailable");
      if (input.malicious) return { outcome: "finding", evidenceHash: hash, findingRef: "finding_member_one", injected: true } as never;
      return { outcome: input.outcome ?? "finding", evidenceHash: hash, findingRef: input.outcome === "no_change" ? null : "finding_member_one" };
    },
  }, {
    async synthesize(context) {
      calls.push("holistic");
      expect(context.authority.canWriteMeta).toBe(false);
      expect(context.members).toHaveLength(2);
      return { outcome: input.outcome ?? "finding", dataQuality: input.dataQuality ?? "ready", evidenceHash: "e".repeat(64),
        recommendationRef: input.outcome === "no_change" ? null : "recommendation_one",
        candidate: input.outcome === "no_change" ? null : { candidateRef: "candidate_budget_one", candidateHash: "f".repeat(64), action: "budget_increase" as const } };
    },
  }, {
    async resolve() { return { dataQuality: input.dataQuality ?? "ready", evidenceHash: "9".repeat(64) } as const; },
  }, artifacts);
  return { value, store, artifacts, calls };
}

describe("GuideRunOrchestrationService", () => {
  it("replays fire idempotently then preserves frozen membership through member-first holistic execution", async () => {
    const fixture = service(); const revision = guide();
    const fire = { guide: revision, trigger: { kind: "scheduled" as const, scheduledFor: "2026-08-17T06:00:00.000Z" }, occurredAt: at };
    const due = await fixture.value.fire(fire); const replay = await fixture.value.fire(fire);
    expect(replay.runRef).toBe(due.runRef);
    const claimed = await fixture.value.claim(due, { leaseToken, leaseUntil: "2026-08-17T07:00:00.000Z", occurredAt: at });
    const result = await fixture.value.execute({ run: claimed, guide: revision, leaseToken, occurredAt: "2026-08-17T06:00:03.000Z" });
    expect(result.run.events.map((event) => event.toState)).toEqual(["due", "claimed", "scope_frozen", "analyzing", "recorded", "staged", "completed"]);
    expect(result.disposition.authority).toEqual({ canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false });
    expect(fixture.calls).toEqual(["freeze", "member:campaign_alpha", "member:campaign_beta", "holistic"]);
    expect(fixture.artifacts.values.every((artifact) => artifact.immutable && artifact.runRef === due.runRef)).toBe(true);
    expect(fixture.artifacts.values.filter((artifact) => artifact.kind === "finding_observation")).toHaveLength(2);
    expect(fixture.artifacts.values.filter((artifact) => artifact.kind === "development_log_intent")).toHaveLength(1);
    const intent = fixture.artifacts.values.find((artifact) => artifact.kind === "development_log_intent")!;
    expect(intent.payload).toMatchObject({ category: "agent_proposed_analysis", candidateRef: "candidate_budget_one", authority: { canWriteMeta: false } });
  });

  it("records partial member failure as evidence and never silently turns it into zero members", async () => {
    const fixture = service({ failFirst: true }); const revision = guide();
    const due = await fixture.value.fire({ guide: revision, trigger: { kind: "manual", requestRef: "request_retry_one" }, occurredAt: at });
    const claimed = await fixture.value.claim(due, { leaseToken, leaseUntil: "2026-08-17T07:00:00.000Z", occurredAt: at });
    const result = await fixture.value.execute({ run: claimed, guide: revision, leaseToken, occurredAt: "2026-08-17T06:00:03.000Z" });
    expect(result.partial).toBe(true);
    expect(fixture.artifacts.values.some((artifact) => artifact.kind === "member_failure")).toBe(true);
    expect(fixture.calls).toContain("member:campaign_beta");
  });

  it("uses data health and mode only for held, staged, or no-action dispositions", async () => {
    const held = service({ dataQuality: "stale" }); const revision = guide();
    const due = await held.value.fire({ guide: revision, trigger: { kind: "manual", requestRef: "request_health_one" }, occurredAt: at });
    const claim = await held.value.claim(due, { leaseToken, leaseUntil: "2026-08-17T07:00:00.000Z", occurredAt: at });
    expect((await held.value.execute({ run: claim, guide: revision, leaseToken, occurredAt: "2026-08-17T06:00:03.000Z" })).disposition).toMatchObject({ state: "held", reason: "data_stale" });

    const noChange = service({ outcome: "no_change" }); const recommend = guide("recommend");
    const due2 = await noChange.value.fire({ guide: recommend, trigger: { kind: "manual", requestRef: "request_no_change" }, occurredAt: at });
    const claim2 = await noChange.value.claim(due2, { leaseToken, leaseUntil: "2026-08-17T07:00:00.000Z", occurredAt: at });
    expect((await noChange.value.execute({ run: claim2, guide: recommend, leaseToken, occurredAt: "2026-08-17T06:00:03.000Z" })).disposition).toMatchObject({ state: "no_action", reason: "nothing_to_do" });
  });

  it("renews and reclaims an expired lease, rejecting stale execution", async () => {
    const fixture = service(); const revision = guide(); const due = await fixture.value.fire({ guide: revision,
      trigger: { kind: "manual", requestRef: "request_lease_one" }, occurredAt: at });
    const claim = await fixture.value.claim(due, { leaseToken, leaseUntil: "2026-08-17T06:10:00.000Z", occurredAt: at });
    const renewed = await fixture.value.renew(claim, { leaseToken, leaseUntil: "2026-08-17T06:20:00.000Z", occurredAt: "2026-08-17T06:05:00.000Z" });
    const replacement = "223e4567-e89b-42d3-a456-426614174000";
    const reclaimed = await fixture.value.reclaim(renewed, { leaseToken: replacement, leaseUntil: "2026-08-17T06:30:00.000Z", occurredAt: "2026-08-17T06:20:00.000Z" });
    await expect(fixture.value.execute({ run: reclaimed, guide: revision, leaseToken, occurredAt: "2026-08-17T06:21:00.000Z" })).rejects.toMatchObject({ code: "lease_lost" });
  });

  it("fences a wrong lease before scope or any Agent/artifact side effect", async () => {
    const fixture = service(); const revision = guide(); const due = await fixture.value.fire({ guide: revision,
      trigger: { kind: "manual", requestRef: "request_wrong_lease" }, occurredAt: at });
    const claimed = await fixture.value.claim(due, { leaseToken, leaseUntil: "2026-08-17T07:00:00.000Z", occurredAt: at });
    await expect(fixture.value.execute({ run: claimed, guide: revision, leaseToken: "223e4567-e89b-42d3-a456-426614174000", occurredAt: "2026-08-17T06:00:03.000Z" }))
      .rejects.toMatchObject({ code: "lease_lost" });
    expect(fixture.calls).toEqual([]); expect(fixture.artifacts.values).toEqual([]);
  });

  it("rejects hostile Agent output before a member-analysis record is written", async () => {
    const fixture = service({ malicious: true }); const revision = guide(); const due = await fixture.value.fire({ guide: revision,
      trigger: { kind: "manual", requestRef: "request_malicious_agent" }, occurredAt: at });
    const claimed = await fixture.value.claim(due, { leaseToken, leaseUntil: "2026-08-17T07:00:00.000Z", occurredAt: at });
    await expect(fixture.value.execute({ run: claimed, guide: revision, leaseToken, occurredAt: "2026-08-17T06:00:03.000Z" }))
      .rejects.toMatchObject({ code: "agent_contract" });
    expect(fixture.artifacts.values.some((artifact) => artifact.kind === "member_analysis" || artifact.kind === "member_failure")).toBe(false);
  });

  it("rejects forged self-consistent payloads and recomputed-hash records with a wrong artifact identity", async () => {
    const fixture = service(); const revision = guide(); const due = await fixture.value.fire({ guide: revision,
      trigger: { kind: "manual", requestRef: "request_forged_artifact" }, occurredAt: at });
    const claimed = await fixture.value.claim(due, { leaseToken, leaseUntil: "2026-08-17T07:00:00.000Z", occurredAt: at });
    const completed = (await fixture.value.execute({ run: claimed, guide: revision, leaseToken, occurredAt: "2026-08-17T06:00:03.000Z" })).run;
    const original = fixture.artifacts.values.find((artifact) => artifact.kind === "development_log_intent")!;
    const forgedPayload = { ...(original.payload as object), candidateRef: null };
    fixture.artifacts.values.splice(fixture.artifacts.values.indexOf(original), 1, { ...original, payload: forgedPayload as never,
      payloadHash: canonicalHash(forgedPayload), artifactRef: "guide_run_artifact_forged" });
    await expect(fixture.value.execute({ run: completed, guide: revision, leaseToken, occurredAt: "2026-08-17T06:00:04.000Z" })).rejects.toMatchObject({ code: "artifact_corrupt" });
  });
});
