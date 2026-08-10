import { describe, expect, it } from "vitest";
import { calculateRobustCohort, RobustCohortContractError, type RobustCohortInput } from "@/analyses/cohort-calculator";

const profile = Object.freeze({ objectiveRef: "objective_lead_generation", funnelRef: "funnel_lead", optimizationEventRef: "event_lead",
  metricKey: "metric_cpl", categoryProfileHash: "a".repeat(64), policySetHash: "b".repeat(64) });
function input(): RobustCohortInput {
  return { cohortRef: "cohort_lead_cpl", profile, direction: "lower_is_better", minimumMemberCount: 3,
    minimumSampleSize: 10, findingThresholdRobustZ: 2.5, observations: [
      { entityRef: "campaign_alpha", profile, value: 10, sampleSize: 20, sourceSnapshotRef: "snapshot_alpha" },
      { entityRef: "campaign_beta", profile, value: 11, sampleSize: 20, sourceSnapshotRef: "snapshot_beta" },
      { entityRef: "campaign_gamma", profile, value: 12, sampleSize: 20, sourceSnapshotRef: "snapshot_gamma" },
      { entityRef: "campaign_delta", profile, value: 30, sampleSize: 20, sourceSnapshotRef: "snapshot_delta" },
    ] };
}

describe("robust cohort calculator", () => {
  it("uses MAD and returns a stable adverse outlier finding", () => {
    const result = calculateRobustCohort(input());
    expect(result).toMatchObject({ cohortId: expect.stringMatching(/^cohort_[a-f0-9]{24}$/), median: 11.5, medianAbsoluteDeviation: 1 });
    expect(result.assessments.find((assessment) => assessment.entityRef === "campaign_delta")).toMatchObject({ status: "finding", reason: "outlier_against_cohort" });
  });

  it("is byte-stable when observations arrive in another order", () => {
    const first = calculateRobustCohort(input());
    const source = input(); const second = calculateRobustCohort({ ...source, observations: [...source.observations].reverse() });
    expect(second).toEqual(first);
  });

  it("rejects mixed objective/config/category/policy profiles instead of comparing them", () => {
    const source = input();
    expect(() => calculateRobustCohort({ ...source, observations: [{ ...source.observations[0]!, profile: { ...profile, objectiveRef: "objective_sales" } }, ...source.observations.slice(1)] }))
      .toThrow("karıştıramaz");
  });

  it("does not turn low samples or zero dispersion into findings", () => {
    const source = input();
    const short = calculateRobustCohort({ ...source, observations: source.observations.map((observation) => ({ ...observation, sampleSize: 2 })) });
    expect(short.assessments.every((assessment) => assessment.status === "insufficient_data" && assessment.reason === "below_minimum_sample")).toBe(true);
    const flat = calculateRobustCohort({ ...source, observations: source.observations.map((observation) => ({ ...observation, value: 12 })) });
    expect(flat.assessments.every((assessment) => assessment.status === "insufficient_data" && assessment.reason === "zero_mad")).toBe(true);
  });

  it("rejects duplicate entities and non-finite values", () => {
    const source = input();
    expect(() => calculateRobustCohort({ ...source, observations: [source.observations[0]!, source.observations[0]!] })).toThrow(RobustCohortContractError);
    expect(() => calculateRobustCohort({ ...source, observations: [{ ...source.observations[0]!, value: Number.NaN }, ...source.observations.slice(1)] })).toThrow("sonlu");
  });
});
