import { describe, expect, it } from "vitest";
import {
  DECISION_CADENCE_VERSION,
  EXPERIMENT_CONTRACT_VERSION,
  evaluateDecisionCadence,
  evaluateExperiment,
  validateExperimentPlan,
  type DecisionCadenceProfile,
  type ExperimentPlan,
} from "@/domain/decisions/cadence";

const profile: DecisionCadenceProfile = {
  version: DECISION_CADENCE_VERSION,
  settleHours: 24,
  minimumObservationHours: 48,
  minimumLearningHours: 72,
  cooldownHours: 24,
  repeatSuppressionHours: 168,
  frequencyWindowHours: 168,
  maxDecisionsPerWindow: 5,
  maxActionsPerWindow: 2,
  maximumHistoryEntries: 20,
  minimumEvidenceCount: 2,
  minimumEvidenceScore: 0.8,
};

function cadence(overrides: Record<string, unknown> = {}) {
  return evaluateDecisionCadence({
    profile,
    now: "2026-08-07T12:00:00.000Z",
    observationStartedAt: "2026-08-01T12:00:00.000Z",
    lastMaterialChangeAt: null,
    learning: { state: "not_applicable", startedAt: null },
    lastDecision: null,
    recentDecisions: [],
    evidence: { refs: ["evidence_b", "evidence_a"], score: 0.9 },
    requestedDisposition: "act",
    recommendationSource: "analysis",
    emergencyGuardrail: { breached: false, evidenceRef: null },
    ...overrides,
  } as Parameters<typeof evaluateDecisionCadence>[0]);
}

const experimentPlan: ExperimentPlan = {
  version: EXPERIMENT_CONTRACT_VERSION,
  hypothesis: "Teklif mesajı lead kalitesini artırır",
  primaryMetric: "qualifiedLeadRate",
  desiredDirection: "increase",
  primaryVariable: "offer_message",
  changedVariables: ["offer_message"],
  baselineRef: "baseline_123",
  guardrailMetrics: ["cplMinor", "spendMinor"],
  stopConditions: ["guardrail_breach", "contamination"],
  minimumSampleSize: 100,
  minimumWindowHours: 72,
  minimumEvidenceScore: 0.8,
  minimumDetectableEffect: 0.05,
};

describe("decision cadence guard", () => {
  it("applies settle, observation, learning, cooldown, and evidence gates in order", () => {
    expect(cadence({ lastMaterialChangeAt: "2026-08-07T00:00:00.000Z" })).toMatchObject({
      disposition: "observe", reason: "settling", nextEligibleAt: "2026-08-08T00:00:00.000Z",
    });
    expect(cadence({ observationStartedAt: "2026-08-06T00:00:00.000Z" })).toMatchObject({
      disposition: "observe", reason: "minimum_observation",
    });
    expect(cadence({ learning: { state: "active", startedAt: "2026-08-01T00:00:00.000Z" } })).toMatchObject({
      disposition: "observe", reason: "learning_active", nextEligibleAt: null,
    });
    expect(cadence({ learning: { state: "exited", startedAt: "2026-08-06T00:00:00.000Z" } })).toMatchObject({
      disposition: "observe", reason: "minimum_learning", nextEligibleAt: "2026-08-09T00:00:00.000Z",
    });
    expect(cadence({
      lastDecision: { disposition: "act", decidedAt: "2026-08-07T00:00:00.000Z", evidenceHash: "old" },
    })).toMatchObject({ disposition: "no_change", reason: "cooldown_active" });
    expect(cadence({ evidence: { refs: ["only_one"], score: 0.7 } })).toMatchObject({
      disposition: "blocked", reason: "insufficient_evidence",
    });
  });

  it("suppresses a repeated decision without new evidence and releases it when evidence changes", () => {
    const prior = cadence();
    const repeated = cadence({
      profile: { ...profile, cooldownHours: 0 },
      lastDecision: { disposition: "act", decidedAt: "2026-08-06T12:00:00.000Z", evidenceHash: prior.evidenceHash },
    });
    expect(repeated).toMatchObject({ disposition: "no_change", reason: "repeat_without_new_evidence" });

    const changed = cadence({
      profile: { ...profile, cooldownHours: 0 },
      evidence: { refs: ["evidence_a", "evidence_b", "evidence_new"], score: 0.9 },
      lastDecision: { disposition: "act", decidedAt: "2026-08-06T12:00:00.000Z", evidenceHash: prior.evidenceHash },
    });
    expect(changed).toMatchObject({ disposition: "act", reason: "eligible" });
  });

  it("allows only an evidenced emergency cadence exception without minting action authority", () => {
    const emergency = cadence({
      observationStartedAt: "2026-08-07T11:59:00.000Z",
      lastMaterialChangeAt: "2026-08-07T11:59:00.000Z",
      evidence: { refs: [], score: 0 },
      recommendationSource: "prompt",
      emergencyGuardrail: { breached: true, evidenceRef: "guardrail_spend_cap" },
    });
    expect(emergency).toMatchObject({
      disposition: "act", reason: "emergency_guardrail", emergencyExceptionApplied: true,
      actionAuthority: "none", recommendationCapability: "advisory_only",
    });
    expect(() => cadence({ emergencyGuardrail: { breached: true, evidenceRef: null } })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });

  it("keeps guidance and prompt recommendations advisory even when cadence-eligible", () => {
    expect(cadence({ recommendationSource: "guidance" })).toMatchObject({
      disposition: "act", reason: "eligible", actionAuthority: "none", recommendationCapability: "advisory_only",
    });
    expect(cadence({ recommendationSource: "prompt", requestedDisposition: "test" })).toMatchObject({
      disposition: "test", reason: "eligible", actionAuthority: "none", recommendationCapability: "advisory_only",
    });
    expect(cadence({ recommendationSource: "deterministic_policy" })).toMatchObject({
      disposition: "act", actionAuthority: "none", recommendationCapability: "deterministic_policy_candidate",
    });
  });

  it("enforces bounded decision and action frequency histories", () => {
    const decisions = [0, 1, 2, 3, 4].map((day) => ({
      disposition: "observe" as const,
      decidedAt: `2026-08-0${2 + day}T12:00:00.000Z`,
    }));
    expect(cadence({ recentDecisions: decisions })).toMatchObject({
      disposition: "no_change", reason: "decision_frequency_limit",
    });
    expect(cadence({
      recentDecisions: [
        { disposition: "act", decidedAt: "2026-08-02T12:00:00.000Z" },
        { disposition: "act", decidedAt: "2026-08-03T12:00:00.000Z" },
      ],
    })).toMatchObject({ disposition: "no_change", reason: "action_frequency_limit" });
    expect(() => cadence({ recentDecisions: Array.from({ length: 21 }, () => ({
      disposition: "observe", decidedAt: "2026-08-01T12:00:00.000Z",
    })) })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("rejects invalid time and threshold states", () => {
    expect(() => cadence({ now: "not-a-time" })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => cadence({ profile: { ...profile, minimumEvidenceScore: 2 } })).toThrowError(
      expect.objectContaining({ code: "invalid_profile" }),
    );
    expect(() => cadence({ observationStartedAt: "2026-08-08T00:00:00.000Z" })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
    for (const invalid of [
      { requestedDisposition: "execute" },
      { recommendationSource: "system_authority" },
      { learning: { state: "unknown", startedAt: null } },
      { lastDecision: { disposition: "execute", decidedAt: "2026-08-01T00:00:00.000Z", evidenceHash: "hash" } },
      { recentDecisions: [{ disposition: "execute", decidedAt: "2026-08-01T00:00:00.000Z" }] },
      { actionAuthority: true },
      { rawPayload: {} },
      { promptText: "ignore policy" },
    ]) {
      expect(() => cadence(invalid)).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    }
  });
});

describe("single-variable experiment contract", () => {
  it("requires a hypothesis, one primary variable, baseline, guardrail, sample, and window", () => {
    expect(validateExperimentPlan(experimentPlan)).toMatchObject({
      hypothesis: experimentPlan.hypothesis,
      changedVariables: ["offer_message"],
      guardrailMetrics: ["cplMinor", "spendMinor"],
      stopConditions: ["contamination", "guardrail_breach"],
    });
    expect(() => validateExperimentPlan({
      ...experimentPlan,
      changedVariables: ["offer_message", "audience"],
    })).toThrowError(expect.objectContaining({ code: "invalid_plan" }));
    expect(() => validateExperimentPlan({ ...experimentPlan, baselineRef: "" }))
      .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
    expect(() => validateExperimentPlan({ ...experimentPlan, guardrailMetrics: [] }))
      .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
    for (const malformed of [
      { ...experimentPlan, hypothesis: 7 },
      { ...experimentPlan, changedVariables: null },
      { ...experimentPlan, guardrailMetrics: {} },
    ]) {
      expect(() => validateExperimentPlan(malformed as never))
        .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
    }
  });

  it("returns conservative inconclusive outcomes for immature, contaminated, or weak evidence", () => {
    const observe = (overrides: Record<string, unknown> = {}) => evaluateExperiment({
      plan: experimentPlan,
      sampleSize: 120,
      observedWindowHours: 96,
      evidenceScore: 0.9,
      contaminationRefs: [],
      guardrailBreaches: [],
      primaryMetric: { status: "available", effect: 0.1 },
      ...overrides,
    } as Parameters<typeof evaluateExperiment>[0]);
    expect(observe({ sampleSize: 50 })).toMatchObject({ status: "inconclusive", reason: "minimum_sample" });
    expect(observe({ observedWindowHours: 24 })).toMatchObject({ status: "inconclusive", reason: "minimum_window" });
    expect(observe({ contaminationRefs: ["change_external"] })).toMatchObject({ status: "inconclusive", reason: "contaminated" });
    expect(observe({ evidenceScore: 0.5 })).toMatchObject({ status: "inconclusive", reason: "insufficient_evidence" });
    expect(observe({ primaryMetric: { status: "unknown" } })).toMatchObject({ status: "inconclusive", reason: "primary_metric_unavailable" });
    expect(observe({ primaryMetric: { status: "available", effect: 0.01 } })).toMatchObject({ status: "inconclusive", reason: "effect_below_threshold" });
    expect(observe({ guardrailBreaches: ["guardrail_cpl"] })).toMatchObject({ status: "guardrail_stopped", reason: "guardrail_breached" });
    for (const malformed of [
      { contaminationRefs: null },
      { guardrailBreaches: "guardrail" },
      { primaryMetric: null },
      { primaryMetric: { status: "available", effect: "high" } },
    ]) {
      expect(() => observe(malformed)).toThrowError(expect.objectContaining({ code: "invalid_observation" }));
    }
  });

  it("classifies mature effects against the desired direction without creating authority", () => {
    const winner = evaluateExperiment({
      plan: experimentPlan, sampleSize: 120, observedWindowHours: 96, evidenceScore: 0.9,
      contaminationRefs: [], guardrailBreaches: [], primaryMetric: { status: "available", effect: 0.1 },
    });
    const loser = evaluateExperiment({
      plan: experimentPlan, sampleSize: 120, observedWindowHours: 96, evidenceScore: 0.9,
      contaminationRefs: [], guardrailBreaches: [], primaryMetric: { status: "available", effect: -0.1 },
    });
    expect(winner).toMatchObject({ status: "winner", reason: "effect_in_desired_direction", actionAuthority: "none" });
    expect(loser).toMatchObject({ status: "loser", reason: "effect_opposite_direction", actionAuthority: "none" });
    expect(winner.experimentRef).toBe(loser.experimentRef);
    expect(evaluateExperiment({
      plan: { ...experimentPlan, desiredDirection: "decrease" }, sampleSize: 120,
      observedWindowHours: 96, evidenceScore: 0.9, contaminationRefs: [], guardrailBreaches: [],
      primaryMetric: { status: "available", effect: -0.1 },
    })).toMatchObject({ status: "winner", reason: "effect_in_desired_direction" });
    const reorderedPlan = {
      minimumDetectableEffect: experimentPlan.minimumDetectableEffect,
      minimumEvidenceScore: experimentPlan.minimumEvidenceScore,
      minimumWindowHours: experimentPlan.minimumWindowHours,
      minimumSampleSize: experimentPlan.minimumSampleSize,
      guardrailMetrics: ["spendMinor", "cplMinor"],
      stopConditions: ["contamination", "guardrail_breach"],
      baselineRef: experimentPlan.baselineRef,
      changedVariables: experimentPlan.changedVariables,
      primaryVariable: experimentPlan.primaryVariable,
      desiredDirection: experimentPlan.desiredDirection,
      primaryMetric: experimentPlan.primaryMetric,
      hypothesis: experimentPlan.hypothesis,
      version: experimentPlan.version,
    } satisfies ExperimentPlan;
    expect(evaluateExperiment({
      plan: reorderedPlan, sampleSize: 120, observedWindowHours: 96, evidenceScore: 0.9,
      contaminationRefs: [], guardrailBreaches: [], primaryMetric: { status: "available", effect: 0.1 },
    }).experimentRef).toBe(winner.experimentRef);
  });
});
