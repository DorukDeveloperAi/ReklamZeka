import { createHash } from "node:crypto";

export const DECISION_CADENCE_VERSION = "decision-cadence/1.0.0" as const;
export const EXPERIMENT_CONTRACT_VERSION = "decision-experiment/1.0.0" as const;

export type DecisionDisposition = "act" | "test" | "observe" | "no_change" | "blocked";

export type DecisionCadenceProfile = Readonly<{
  version: typeof DECISION_CADENCE_VERSION;
  settleHours: number;
  minimumObservationHours: number;
  minimumLearningHours: number;
  cooldownHours: number;
  repeatSuppressionHours: number;
  frequencyWindowHours: number;
  maxDecisionsPerWindow: number;
  maxActionsPerWindow: number;
  maximumHistoryEntries: number;
  minimumEvidenceCount: number;
  minimumEvidenceScore: number;
}>;

export type DecisionCadenceResult = Readonly<{
  version: typeof DECISION_CADENCE_VERSION;
  disposition: DecisionDisposition;
  reason:
    | "emergency_guardrail"
    | "settling"
    | "minimum_observation"
    | "learning_active"
    | "minimum_learning"
    | "cooldown_active"
    | "repeat_without_new_evidence"
    | "decision_frequency_limit"
    | "action_frequency_limit"
    | "insufficient_evidence"
    | "eligible";
  evaluatedAt: string;
  nextEligibleAt: string | null;
  evidenceHash: string;
  emergencyExceptionApplied: boolean;
  recommendationCapability: "advisory_only" | "deterministic_policy_candidate";
  /** Cadence eligibility is never approval or execution authority. */
  actionAuthority: "none";
  resultRef: string;
}>;

export class DecisionCadenceError extends Error {
  constructor(readonly code: "invalid_profile" | "invalid_input") {
    super("Karar cadence girdisi güvenli biçimde değerlendirilemedi");
    this.name = "DecisionCadenceError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new DecisionCadenceError("invalid_input");
  }
}

function experimentExactKeys(value: unknown, allowed: readonly string[], code: "invalid_plan" | "invalid_observation"): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ExperimentContractError(code);
  }
}

function validTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new DecisionCadenceError("invalid_input");
  return parsed;
}

function hoursAfter(value: string, hours: number): string {
  return new Date(validTime(value) + hours * 3_600_000).toISOString();
}

function elapsedHours(from: string, to: string): number {
  return (validTime(to) - validTime(from)) / 3_600_000;
}

function assertProfile(profile: DecisionCadenceProfile): void {
  exactKeys(profile, [
    "version", "settleHours", "minimumObservationHours", "minimumLearningHours", "cooldownHours",
    "repeatSuppressionHours", "frequencyWindowHours", "maxDecisionsPerWindow", "maxActionsPerWindow",
    "maximumHistoryEntries", "minimumEvidenceCount", "minimumEvidenceScore",
  ]);
  if (profile.version !== DECISION_CADENCE_VERSION) throw new DecisionCadenceError("invalid_profile");
  for (const value of [
    profile.settleHours,
    profile.minimumObservationHours,
    profile.minimumLearningHours,
    profile.cooldownHours,
    profile.repeatSuppressionHours,
    profile.frequencyWindowHours,
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 24 * 365) throw new DecisionCadenceError("invalid_profile");
  }
  if (!Number.isInteger(profile.minimumEvidenceCount) || profile.minimumEvidenceCount < 1
    || !Number.isInteger(profile.maxDecisionsPerWindow) || profile.maxDecisionsPerWindow < 1
    || !Number.isInteger(profile.maxActionsPerWindow) || profile.maxActionsPerWindow < 1
    || profile.maxActionsPerWindow > profile.maxDecisionsPerWindow
    || !Number.isInteger(profile.maximumHistoryEntries) || profile.maximumHistoryEntries < profile.maxDecisionsPerWindow
    || !Number.isFinite(profile.minimumEvidenceScore) || profile.minimumEvidenceScore < 0 || profile.minimumEvidenceScore > 1) {
    throw new DecisionCadenceError("invalid_profile");
  }
}

function evidenceHash(refs: readonly string[], score: number): string {
  return sha256(JSON.stringify({ refs: [...new Set(refs)].sort(codePointCompare), score }));
}

function cadenceResult(input: Omit<DecisionCadenceResult, "version" | "actionAuthority" | "resultRef">): DecisionCadenceResult {
  const envelope = { version: DECISION_CADENCE_VERSION, ...input, actionAuthority: "none" as const };
  return Object.freeze({
    ...envelope,
    resultRef: `cadence_${sha256(JSON.stringify(envelope)).slice(0, 20)}`,
  });
}

export function evaluateDecisionCadence(input: Readonly<{
  profile: DecisionCadenceProfile;
  now: string;
  observationStartedAt: string;
  lastMaterialChangeAt: string | null;
  learning: Readonly<{
    state: "not_applicable" | "active" | "exited";
    startedAt: string | null;
  }>;
  lastDecision: Readonly<{
    disposition: DecisionDisposition;
    decidedAt: string;
    evidenceHash: string;
  }> | null;
  recentDecisions: readonly Readonly<{
    disposition: DecisionDisposition;
    decidedAt: string;
  }>[];
  evidence: Readonly<{
    refs: readonly string[];
    score: number;
  }>;
  requestedDisposition: "act" | "test";
  recommendationSource: "deterministic_policy" | "analysis" | "guidance" | "prompt";
  emergencyGuardrail: Readonly<{
    breached: boolean;
    evidenceRef: string | null;
  }>;
}>): DecisionCadenceResult {
  exactKeys(input, [
    "profile", "now", "observationStartedAt", "lastMaterialChangeAt", "learning", "lastDecision",
    "recentDecisions", "evidence", "requestedDisposition", "recommendationSource", "emergencyGuardrail",
  ]);
  exactKeys(input.learning, ["state", "startedAt"]);
  exactKeys(input.evidence, ["refs", "score"]);
  exactKeys(input.emergencyGuardrail, ["breached", "evidenceRef"]);
  if (input.lastDecision) exactKeys(input.lastDecision, ["disposition", "decidedAt", "evidenceHash"]);
  if (!Array.isArray(input.recentDecisions)) throw new DecisionCadenceError("invalid_input");
  for (const decision of input.recentDecisions) exactKeys(decision, ["disposition", "decidedAt"]);
  assertProfile(input.profile);
  const now = validTime(input.now);
  validTime(input.observationStartedAt);
  if (validTime(input.observationStartedAt) > now) throw new DecisionCadenceError("invalid_input");
  if (!Number.isFinite(input.evidence.score) || input.evidence.score < 0 || input.evidence.score > 1
    || !Array.isArray(input.evidence.refs)
    || input.evidence.refs.some((ref) => typeof ref !== "string" || !ref.trim())) throw new DecisionCadenceError("invalid_input");
  if (input.lastMaterialChangeAt && validTime(input.lastMaterialChangeAt) > now) throw new DecisionCadenceError("invalid_input");
  if (!(["act", "test"] as const).includes(input.requestedDisposition)
    || !(["deterministic_policy", "analysis", "guidance", "prompt"] as const).includes(input.recommendationSource)
    || !(["not_applicable", "active", "exited"] as const).includes(input.learning.state)) {
    throw new DecisionCadenceError("invalid_input");
  }
  if (input.lastDecision && (!(["act", "test", "observe", "no_change", "blocked"] as const).includes(input.lastDecision.disposition)
    || validTime(input.lastDecision.decidedAt) > now || typeof input.lastDecision.evidenceHash !== "string"
    || !input.lastDecision.evidenceHash.trim())) {
    throw new DecisionCadenceError("invalid_input");
  }
  if (!Array.isArray(input.recentDecisions) || input.recentDecisions.length > input.profile.maximumHistoryEntries
    || input.recentDecisions.some((decision) => !["act", "test", "observe", "no_change", "blocked"].includes(decision.disposition)
      || validTime(decision.decidedAt) > now)) throw new DecisionCadenceError("invalid_input");
  if (input.learning.state === "not_applicable" && input.learning.startedAt !== null) throw new DecisionCadenceError("invalid_input");
  if (input.learning.state !== "not_applicable" && (!input.learning.startedAt || validTime(input.learning.startedAt) > now)) {
    throw new DecisionCadenceError("invalid_input");
  }
  if (typeof input.emergencyGuardrail.breached !== "boolean"
    || (input.emergencyGuardrail.evidenceRef !== null && typeof input.emergencyGuardrail.evidenceRef !== "string")
    || input.emergencyGuardrail.breached !== Boolean(input.emergencyGuardrail.evidenceRef?.trim())) {
    throw new DecisionCadenceError("invalid_input");
  }

  const currentEvidenceHash = evidenceHash(input.evidence.refs, input.evidence.score);
  const base = {
    evaluatedAt: new Date(now).toISOString(),
    evidenceHash: currentEvidenceHash,
    recommendationCapability: input.recommendationSource === "deterministic_policy"
      ? "deterministic_policy_candidate" as const
      : "advisory_only" as const,
  };
  if (input.emergencyGuardrail.breached) {
    return cadenceResult({
      ...base,
      disposition: "act",
      reason: "emergency_guardrail",
      nextEligibleAt: null,
      emergencyExceptionApplied: true,
    });
  }

  if (input.lastMaterialChangeAt && elapsedHours(input.lastMaterialChangeAt, input.now) < input.profile.settleHours) {
    return cadenceResult({
      ...base, disposition: "observe", reason: "settling",
      nextEligibleAt: hoursAfter(input.lastMaterialChangeAt, input.profile.settleHours), emergencyExceptionApplied: false,
    });
  }
  if (elapsedHours(input.observationStartedAt, input.now) < input.profile.minimumObservationHours) {
    return cadenceResult({
      ...base, disposition: "observe", reason: "minimum_observation",
      nextEligibleAt: hoursAfter(input.observationStartedAt, input.profile.minimumObservationHours), emergencyExceptionApplied: false,
    });
  }
  if (input.learning.state === "active") {
    return cadenceResult({
      ...base, disposition: "observe", reason: "learning_active",
      nextEligibleAt: null, emergencyExceptionApplied: false,
    });
  }
  if (input.learning.state === "exited" && elapsedHours(input.learning.startedAt!, input.now) < input.profile.minimumLearningHours) {
    return cadenceResult({
      ...base, disposition: "observe", reason: "minimum_learning",
      nextEligibleAt: hoursAfter(input.learning.startedAt!, input.profile.minimumLearningHours), emergencyExceptionApplied: false,
    });
  }
  if (input.lastDecision && ["act", "test"].includes(input.lastDecision.disposition)
    && elapsedHours(input.lastDecision.decidedAt, input.now) < input.profile.cooldownHours) {
    return cadenceResult({
      ...base, disposition: "no_change", reason: "cooldown_active",
      nextEligibleAt: hoursAfter(input.lastDecision.decidedAt, input.profile.cooldownHours), emergencyExceptionApplied: false,
    });
  }
  if (input.lastDecision && input.lastDecision.disposition === input.requestedDisposition
    && input.lastDecision.evidenceHash === currentEvidenceHash
    && elapsedHours(input.lastDecision.decidedAt, input.now) < input.profile.repeatSuppressionHours) {
    return cadenceResult({
      ...base, disposition: "no_change", reason: "repeat_without_new_evidence",
      nextEligibleAt: hoursAfter(input.lastDecision.decidedAt, input.profile.repeatSuppressionHours), emergencyExceptionApplied: false,
    });
  }
  const withinFrequencyWindow = input.recentDecisions
    .filter((decision) => elapsedHours(decision.decidedAt, input.now) < input.profile.frequencyWindowHours)
    .sort((left, right) => validTime(left.decidedAt) - validTime(right.decidedAt));
  if (withinFrequencyWindow.length >= input.profile.maxDecisionsPerWindow) {
    return cadenceResult({
      ...base, disposition: "no_change", reason: "decision_frequency_limit",
      nextEligibleAt: hoursAfter(withinFrequencyWindow[0]!.decidedAt, input.profile.frequencyWindowHours), emergencyExceptionApplied: false,
    });
  }
  const recentActions = withinFrequencyWindow.filter((decision) => decision.disposition === "act");
  if (input.requestedDisposition === "act" && recentActions.length >= input.profile.maxActionsPerWindow) {
    return cadenceResult({
      ...base, disposition: "no_change", reason: "action_frequency_limit",
      nextEligibleAt: hoursAfter(recentActions[0]!.decidedAt, input.profile.frequencyWindowHours), emergencyExceptionApplied: false,
    });
  }
  if (new Set(input.evidence.refs).size < input.profile.minimumEvidenceCount
    || input.evidence.score < input.profile.minimumEvidenceScore) {
    return cadenceResult({
      ...base, disposition: "blocked", reason: "insufficient_evidence",
      nextEligibleAt: null, emergencyExceptionApplied: false,
    });
  }
  return cadenceResult({
    ...base,
    disposition: input.requestedDisposition,
    reason: "eligible",
    nextEligibleAt: null,
    emergencyExceptionApplied: false,
  });
}

export type ExperimentPlan = Readonly<{
  version: typeof EXPERIMENT_CONTRACT_VERSION;
  hypothesis: string;
  primaryMetric: string;
  desiredDirection: "increase" | "decrease";
  primaryVariable: string;
  changedVariables: readonly string[];
  baselineRef: string;
  guardrailMetrics: readonly string[];
  stopConditions: readonly ("guardrail_breach" | "contamination")[];
  minimumSampleSize: number;
  minimumWindowHours: number;
  minimumEvidenceScore: number;
  minimumDetectableEffect: number;
}>;

export type ExperimentOutcome = Readonly<{
  version: typeof EXPERIMENT_CONTRACT_VERSION;
  status: "winner" | "loser" | "inconclusive" | "guardrail_stopped";
  reason: "effect_in_desired_direction" | "effect_opposite_direction" | "effect_below_threshold" | "minimum_sample" | "minimum_window" | "contaminated" | "primary_metric_unavailable" | "insufficient_evidence" | "guardrail_breached";
  experimentRef: string;
  actionAuthority: "none";
}>;

export class ExperimentContractError extends Error {
  constructor(readonly code: "invalid_plan" | "invalid_observation") {
    super("Deney sözleşmesi güvenli biçimde değerlendirilemedi");
    this.name = "ExperimentContractError";
  }
}

function experimentRef(plan: ExperimentPlan): string {
  const canonical = {
    version: plan.version,
    hypothesis: plan.hypothesis,
    primaryMetric: plan.primaryMetric,
    desiredDirection: plan.desiredDirection,
    primaryVariable: plan.primaryVariable,
    changedVariables: [...plan.changedVariables].sort(codePointCompare),
    baselineRef: plan.baselineRef,
    guardrailMetrics: [...new Set(plan.guardrailMetrics)].sort(codePointCompare),
    stopConditions: [...new Set(plan.stopConditions)].sort(codePointCompare),
    minimumSampleSize: plan.minimumSampleSize,
    minimumWindowHours: plan.minimumWindowHours,
    minimumEvidenceScore: plan.minimumEvidenceScore,
    minimumDetectableEffect: plan.minimumDetectableEffect,
  };
  return `experiment_${sha256(JSON.stringify(canonical)).slice(0, 20)}`;
}

export function validateExperimentPlan(plan: ExperimentPlan): ExperimentPlan {
  experimentExactKeys(plan, [
    "version", "hypothesis", "primaryMetric", "desiredDirection", "primaryVariable", "changedVariables",
    "baselineRef", "guardrailMetrics", "stopConditions", "minimumSampleSize", "minimumWindowHours",
    "minimumEvidenceScore", "minimumDetectableEffect",
  ], "invalid_plan");
  if (plan.version !== EXPERIMENT_CONTRACT_VERSION
    || typeof plan.hypothesis !== "string" || !plan.hypothesis.trim()
    || typeof plan.primaryMetric !== "string" || !plan.primaryMetric.trim()
    || typeof plan.primaryVariable !== "string" || !plan.primaryVariable.trim()
    || typeof plan.baselineRef !== "string" || !plan.baselineRef.trim()
    || !(["increase", "decrease"] as const).includes(plan.desiredDirection)
    || !Array.isArray(plan.changedVariables) || plan.changedVariables.length !== 1
    || plan.changedVariables[0] !== plan.primaryVariable
    || !Array.isArray(plan.guardrailMetrics) || plan.guardrailMetrics.length < 1
    || plan.guardrailMetrics.some((metric) => typeof metric !== "string" || !metric.trim())
    || !Array.isArray(plan.stopConditions) || plan.stopConditions.length < 1
    || !plan.stopConditions.includes("guardrail_breach")
    || plan.stopConditions.some((condition) => !["guardrail_breach", "contamination"].includes(condition))
    || !Number.isInteger(plan.minimumSampleSize) || plan.minimumSampleSize < 1
    || !Number.isFinite(plan.minimumWindowHours) || plan.minimumWindowHours <= 0
    || !Number.isFinite(plan.minimumEvidenceScore) || plan.minimumEvidenceScore < 0 || plan.minimumEvidenceScore > 1
    || !Number.isFinite(plan.minimumDetectableEffect) || plan.minimumDetectableEffect < 0) {
    throw new ExperimentContractError("invalid_plan");
  }
  return Object.freeze({
    ...plan,
    hypothesis: plan.hypothesis.trim(),
    primaryMetric: plan.primaryMetric.trim(),
    primaryVariable: plan.primaryVariable.trim(),
    changedVariables: Object.freeze([...plan.changedVariables]),
    guardrailMetrics: Object.freeze([...new Set(plan.guardrailMetrics)].sort(codePointCompare)),
    stopConditions: Object.freeze([...new Set(plan.stopConditions)].sort(codePointCompare)) as ExperimentPlan["stopConditions"],
  });
}

export function evaluateExperiment(input: Readonly<{
  plan: ExperimentPlan;
  sampleSize: number;
  observedWindowHours: number;
  evidenceScore: number;
  contaminationRefs: readonly string[];
  guardrailBreaches: readonly string[];
  primaryMetric: Readonly<{ status: "available"; effect: number } | { status: "unknown" }>;
}>): ExperimentOutcome {
  experimentExactKeys(input, [
    "plan", "sampleSize", "observedWindowHours", "evidenceScore", "contaminationRefs",
    "guardrailBreaches", "primaryMetric",
  ], "invalid_observation");
  if (!input.primaryMetric || typeof input.primaryMetric !== "object" || Array.isArray(input.primaryMetric)) {
    throw new ExperimentContractError("invalid_observation");
  }
  experimentExactKeys(
    input.primaryMetric,
    input.primaryMetric.status === "available" ? ["status", "effect"] : ["status"],
    "invalid_observation",
  );
  const plan = validateExperimentPlan(input.plan);
  if (!Number.isInteger(input.sampleSize) || input.sampleSize < 0
    || !Number.isFinite(input.observedWindowHours) || input.observedWindowHours < 0
    || !Number.isFinite(input.evidenceScore) || input.evidenceScore < 0 || input.evidenceScore > 1
    || !Array.isArray(input.contaminationRefs)
    || input.contaminationRefs.some((ref) => typeof ref !== "string" || !ref.trim())
    || !Array.isArray(input.guardrailBreaches)
    || input.guardrailBreaches.some((ref) => typeof ref !== "string" || !ref.trim())
    || !(["available", "unknown"] as const).includes(input.primaryMetric.status)
    || (input.primaryMetric.status === "available" && !Number.isFinite(input.primaryMetric.effect))) {
    throw new ExperimentContractError("invalid_observation");
  }
  const result = (status: ExperimentOutcome["status"], reason: ExperimentOutcome["reason"]): ExperimentOutcome => Object.freeze({
    version: EXPERIMENT_CONTRACT_VERSION,
    status,
    reason,
    experimentRef: experimentRef(plan),
    actionAuthority: "none",
  });
  if (input.guardrailBreaches.length > 0) return result("guardrail_stopped", "guardrail_breached");
  if (input.contaminationRefs.length > 0) return result("inconclusive", "contaminated");
  if (input.sampleSize < plan.minimumSampleSize) return result("inconclusive", "minimum_sample");
  if (input.observedWindowHours < plan.minimumWindowHours) return result("inconclusive", "minimum_window");
  if (input.evidenceScore < plan.minimumEvidenceScore) return result("inconclusive", "insufficient_evidence");
  if (input.primaryMetric.status === "unknown") return result("inconclusive", "primary_metric_unavailable");
  if (Math.abs(input.primaryMetric.effect) < plan.minimumDetectableEffect) return result("inconclusive", "effect_below_threshold");
  const desired = plan.desiredDirection === "increase"
    ? input.primaryMetric.effect > 0
    : input.primaryMetric.effect < 0;
  return desired
    ? result("winner", "effect_in_desired_direction")
    : result("loser", "effect_opposite_direction");
}
