import { createHash } from "node:crypto";

export const ROBUST_COHORT_CONTRACT_VERSION = "robust-cohort/1.0.0" as const;

export type CohortDirection = "higher_is_better" | "lower_is_better";
export type CohortAssessmentStatus = "finding" | "clear" | "insufficient_data";

/**
 * The full comparison identity. A cohort is never formed across objectives,
 * optimization events, metric definitions, category policies, or policy sets.
 */
export type CohortCompatibilityProfile = Readonly<{
  objectiveRef: string;
  funnelRef: string;
  optimizationEventRef: string;
  metricKey: string;
  categoryProfileHash: string;
  policySetHash: string;
}>;

export type CohortObservation = Readonly<{
  entityRef: string;
  profile: CohortCompatibilityProfile;
  value: number;
  sampleSize: number;
  sourceSnapshotRef: string;
}>;

export type RobustCohortInput = Readonly<{
  cohortRef: string;
  profile: CohortCompatibilityProfile;
  direction: CohortDirection;
  minimumMemberCount: number;
  minimumSampleSize: number;
  findingThresholdRobustZ: number;
  observations: readonly CohortObservation[];
}>;

export type RobustCohortAssessment = Readonly<{
  entityRef: string;
  value: number;
  sampleSize: number;
  sourceSnapshotRef: string;
  robustZ: number | null;
  status: CohortAssessmentStatus;
  reason: "below_minimum_sample" | "insufficient_compatible_members" | "zero_mad" | "within_threshold" | "outlier_against_cohort";
}>;

export type RobustCohortResult = Readonly<{
  contractVersion: typeof ROBUST_COHORT_CONTRACT_VERSION;
  cohortId: string;
  cohortRef: string;
  profile: CohortCompatibilityProfile;
  direction: CohortDirection;
  median: number | null;
  medianAbsoluteDeviation: number | null;
  assessments: readonly RobustCohortAssessment[];
}>;

export class RobustCohortContractError extends Error {
  constructor(message: string) { super(message); this.name = "RobustCohortContractError"; }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;

function requireRef(value: string, label: string): void {
  if (!REF.test(value)) throw new RobustCohortContractError(`${label} geçerli bir opaque ref olmalıdır`);
}
function requireHash(value: string, label: string): void {
  if (!HASH.test(value)) throw new RobustCohortContractError(`${label} geçerli bir SHA-256 hash olmalıdır`);
}
function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RobustCohortContractError(`${label} pozitif tam sayı olmalıdır`);
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[center]! : (sorted[center - 1]! + sorted[center]!) / 2;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function equalProfile(left: CohortCompatibilityProfile, right: CohortCompatibilityProfile): boolean {
  return left.objectiveRef === right.objectiveRef && left.funnelRef === right.funnelRef
    && left.optimizationEventRef === right.optimizationEventRef && left.metricKey === right.metricKey
    && left.categoryProfileHash === right.categoryProfileHash && left.policySetHash === right.policySetHash;
}
function validateProfile(profile: CohortCompatibilityProfile): void {
  requireRef(profile.objectiveRef, "objectiveRef"); requireRef(profile.funnelRef, "funnelRef");
  requireRef(profile.optimizationEventRef, "optimizationEventRef"); requireRef(profile.metricKey, "metricKey");
  requireHash(profile.categoryProfileHash, "categoryProfileHash"); requireHash(profile.policySetHash, "policySetHash");
}

/**
 * Pure, robust cohort analysis. It deliberately rejects mixed profiles and
 * emits insufficient-data instead of treating a zero-MAD or short sample as a finding.
 */
export function calculateRobustCohort(input: RobustCohortInput): RobustCohortResult {
  requireRef(input.cohortRef, "cohortRef"); validateProfile(input.profile);
  if (input.direction !== "higher_is_better" && input.direction !== "lower_is_better") {
    throw new RobustCohortContractError("direction geçersizdir");
  }
  requirePositiveInteger(input.minimumMemberCount, "minimumMemberCount");
  requirePositiveInteger(input.minimumSampleSize, "minimumSampleSize");
  if (!Number.isFinite(input.findingThresholdRobustZ) || input.findingThresholdRobustZ <= 0) {
    throw new RobustCohortContractError("findingThresholdRobustZ pozitif sonlu sayı olmalıdır");
  }
  if (input.observations.length === 0) throw new RobustCohortContractError("En az bir observation zorunludur");

  const observations = input.observations.map((observation) => {
    requireRef(observation.entityRef, "entityRef"); requireRef(observation.sourceSnapshotRef, "sourceSnapshotRef");
    validateProfile(observation.profile);
    if (!equalProfile(observation.profile, input.profile)) {
      throw new RobustCohortContractError("Cohort farklı objective/config/category/policy profile'larını karıştıramaz");
    }
    if (!Number.isFinite(observation.value)) throw new RobustCohortContractError("value sonlu sayı olmalıdır");
    requirePositiveInteger(observation.sampleSize, "sampleSize");
    return Object.freeze({ ...observation });
  }).sort((left, right) => compare(left.entityRef, right.entityRef));
  if (new Set(observations.map((observation) => observation.entityRef)).size !== observations.length) {
    throw new RobustCohortContractError("Bir entity cohort içinde yalnız bir observation taşıyabilir");
  }

  const eligible = observations.filter((observation) => observation.sampleSize >= input.minimumSampleSize);
  const insufficientMembers = eligible.length < input.minimumMemberCount;
  const cohortMedian = insufficientMembers ? null : median(eligible.map((observation) => observation.value));
  const mad = cohortMedian === null ? null : median(eligible.map((observation) => Math.abs(observation.value - cohortMedian)));
  const zeroMad = mad === 0;
  const assessments = observations.map((observation): RobustCohortAssessment => {
    if (observation.sampleSize < input.minimumSampleSize) return Object.freeze({ ...observation, robustZ: null,
      status: "insufficient_data", reason: "below_minimum_sample" });
    if (insufficientMembers) return Object.freeze({ ...observation, robustZ: null,
      status: "insufficient_data", reason: "insufficient_compatible_members" });
    if (zeroMad) return Object.freeze({ ...observation, robustZ: null, status: "insufficient_data", reason: "zero_mad" });
    const robustZ = 0.67448975 * (observation.value - cohortMedian!) / mad!;
    const adverse = input.direction === "higher_is_better"
      ? robustZ <= -input.findingThresholdRobustZ : robustZ >= input.findingThresholdRobustZ;
    return Object.freeze({ ...observation, robustZ, status: adverse ? "finding" : "clear",
      reason: adverse ? "outlier_against_cohort" : "within_threshold" });
  });
  const canonical = { contractVersion: ROBUST_COHORT_CONTRACT_VERSION, cohortRef: input.cohortRef, profile: input.profile,
    direction: input.direction, minimumMemberCount: input.minimumMemberCount, minimumSampleSize: input.minimumSampleSize,
    findingThresholdRobustZ: input.findingThresholdRobustZ, observations };
  return Object.freeze({ contractVersion: ROBUST_COHORT_CONTRACT_VERSION, cohortId: `cohort_${hash(canonical).slice(0, 24)}`,
    cohortRef: input.cohortRef, profile: Object.freeze({ ...input.profile }), direction: input.direction,
    median: cohortMedian, medianAbsoluteDeviation: mad, assessments: Object.freeze(assessments) });
}
