import { describe, expect, it } from "vitest";
import {
  buildOutcomeProxyMappingPlan,
  OutcomeProxyMappingError,
  type OutcomeProxyMapping,
  type OutcomeProxyMappingInput,
} from "../src/domain/budget/outcome-proxy-mapping";

const target: OutcomeProxyMappingInput["target"] = {
  targetRef: "target.qualified_patient",
  outcomeRef: "qualified_patient",
  direction: "maximize",
  targetValueDecimal: "120",
  unitRef: "patient",
  timeframeRef: "monthly_2026_08",
};

function mapping(patch: Partial<OutcomeProxyMapping> = {}): OutcomeProxyMapping {
  const base: OutcomeProxyMapping = {
    mappingRef: "mapping.qualified_patient.lead",
    outcomeRef: "qualified_patient",
    timeframeRef: "monthly_2026_08",
    proxy: {
      metricRef: "meta.lead",
      entityLevel: "campaign",
      aggregation: "sum",
      attributionWindowRef: "meta.7d_click_1d_view",
    },
    scope: { categoryRefs: ["category.health_tourism"], objectiveRefs: ["objective.leads"] },
    evidence: {
      sampleSize: 240,
      coverageBps: 9600,
      observedFromAt: "2026-07-01T00:00:00.000Z",
      observedThroughAt: "2026-08-06T11:00:00.000Z",
      retrievedAt: "2026-08-06T11:00:00.000Z",
      proxyToOutcomeLagMinutes: 1440,
      confidenceBps: 8300,
    },
    review: {
      status: "approved",
      reviewerRef: "user.owner",
      reviewedAt: "2026-08-01T09:00:00.000Z",
      reviewDueAt: "2026-09-01T00:00:00.000Z",
    },
    provenance: {
      sourceKind: "owner_instruction",
      sourceRef: "instruction.patient_quality.v2",
      configuredByRef: "user.owner",
      configuredAt: "2026-07-31T09:00:00.000Z",
    },
  };
  return { ...base, ...patch };
}

function request(patch: Partial<OutcomeProxyMappingInput> = {}): OutcomeProxyMappingInput {
  return {
    target,
    context: { categoryRef: "category.health_tourism", objectiveRef: "objective.leads" },
    asOfAt: "2026-08-06T12:00:00.000Z",
    mappings: [mapping()],
    policy: {
      minimumSampleSize: 100,
      minimumCoverageBps: 9000,
      maximumLagMinutes: 2880,
      minimumConfidenceBps: 7500,
      maximumEvidenceFreshnessMinutes: 180,
    },
    ...patch,
  };
}

describe("business outcome to Meta proxy mapping gate", () => {
  it("keeps the business target and Meta proxy explicitly separate", () => {
    const result = buildOutcomeProxyMappingPlan(request());

    expect(result).toMatchObject({ status: "ready", actionAuthority: "none", suppressionReasons: [] });
    expect(result.target).toEqual(target);
    expect(result.selected).toMatchObject({
      mappingRef: "mapping.qualified_patient.lead",
      proxy: mapping().proxy,
    });
    expect(result.selected).toMatchObject({
      timeframeRef: "monthly_2026_08",
      provenance: { sourceKind: "owner_instruction", sourceRef: "instruction.patient_quality.v2" },
      evidence: { sampleSize: 240, coverageBps: 9600, proxyToOutcomeLagMinutes: 1440, confidenceBps: 8300 },
      review: { status: "approved" },
    });
    expect(result.selected?.proxy.metricRef).not.toBe(result.target.outcomeRef);
  });

  it("has no implicit default mapping", () => {
    const result = buildOutcomeProxyMappingPlan(request({ mappings: [] }));
    expect(result).toMatchObject({ status: "suppressed", selected: null, suppressionReasons: ["missing_mapping"], actionAuthority: "none" });
  });

  it("suppresses instead of choosing between multiple eligible mappings", () => {
    const result = buildOutcomeProxyMappingPlan(request({
      mappings: [mapping(), mapping({ mappingRef: "mapping.qualified_patient.lp_view", proxy: { ...mapping().proxy, metricRef: "meta.landing_page_view" } })],
    }));
    expect(result.status).toBe("suppressed");
    expect(result.selected).toBeNull();
    expect(result.suppressionReasons).toEqual(["ambiguous_mapping"]);
  });

  it("evaluates scope, timeframe, evidence, lag, confidence, review and freshness together", () => {
    const weak = mapping({
      timeframeRef: "weekly_2026_32",
      scope: { categoryRefs: ["category.local"], objectiveRefs: ["objective.awareness"] },
      evidence: {
        ...mapping().evidence,
        sampleSize: 5,
        coverageBps: 4000,
        observedThroughAt: "2026-08-05T00:00:00.000Z",
        retrievedAt: "2026-08-05T00:00:00.000Z",
        proxyToOutcomeLagMinutes: 5000,
        confidenceBps: 3000,
      },
      review: { status: "pending", reviewerRef: null, reviewedAt: null, reviewDueAt: "2026-08-06T11:00:00.000Z" },
    });
    const result = buildOutcomeProxyMappingPlan(request({ mappings: [weak] }));

    expect(result).toMatchObject({ status: "suppressed", selected: null, suppressionReasons: ["missing_mapping"] });
    expect(result.evaluations[0]?.suppressionReasons).toEqual([
      "timeframe_mismatch",
      "category_scope_mismatch",
      "objective_scope_mismatch",
      "review_pending",
      "review_stale",
      "evidence_stale",
      "insufficient_sample",
      "insufficient_coverage",
      "excessive_lag",
      "insufficient_confidence",
    ]);
  });

  it.each([
    ["review_pending", { review: { status: "pending", reviewerRef: null, reviewedAt: null, reviewDueAt: "2026-09-01T00:00:00.000Z" } }],
    ["review_rejected", { review: { status: "rejected", reviewerRef: "user.owner", reviewedAt: "2026-08-01T09:00:00.000Z", reviewDueAt: "2026-09-01T00:00:00.000Z" } }],
    ["review_stale", { review: { ...mapping().review, reviewDueAt: "2026-08-06T11:59:59.000Z" } }],
    ["evidence_stale", { evidence: { ...mapping().evidence, observedThroughAt: "2026-08-06T08:59:59.000Z" } }],
    ["insufficient_sample", { evidence: { ...mapping().evidence, sampleSize: 99 } }],
    ["insufficient_coverage", { evidence: { ...mapping().evidence, coverageBps: 8999 } }],
    ["excessive_lag", { evidence: { ...mapping().evidence, proxyToOutcomeLagMinutes: 2881 } }],
    ["insufficient_confidence", { evidence: { ...mapping().evidence, confidenceBps: 7499 } }],
  ] as const)("suppresses an otherwise relevant mapping for %s", (reason, patch) => {
    const result = buildOutcomeProxyMappingPlan(request({ mappings: [mapping(patch as Partial<OutcomeProxyMapping>)] }));
    expect(result.status).toBe("suppressed");
    expect(result.suppressionReasons).toEqual(["no_eligible_mapping"]);
    expect(result.evaluations[0]?.suppressionReasons).toContain(reason);
  });

  it("rejects a proxy that aliases the business outcome and invalid future evidence", () => {
    expect(() => buildOutcomeProxyMappingPlan(request({
      mappings: [mapping({ proxy: { ...mapping().proxy, metricRef: "qualified_patient" } })],
    }))).toThrowError(expect.objectContaining({ code: "invalid_mapping" }));
    expect(() => buildOutcomeProxyMappingPlan(request({
      mappings: [mapping({ evidence: { ...mapping().evidence, retrievedAt: "2026-08-07T00:00:00.000Z" } })],
    }))).toThrowError(OutcomeProxyMappingError);
  });

  it("rejects duplicate mappings, hidden fields and absent configurable thresholds", () => {
    expect(() => buildOutcomeProxyMappingPlan(request({ mappings: [mapping(), mapping()] }))).toThrowError(expect.objectContaining({ code: "invalid_mapping" }));
    expect(() => buildOutcomeProxyMappingPlan({ ...request(), execute: true } as never)).toThrowError(expect.objectContaining({ code: "invalid_contract" }));
    const { maximumLagMinutes: _removed, ...incompletePolicy } = request().policy;
    expect(() => buildOutcomeProxyMappingPlan(request({ policy: incompletePolicy as never }))).toThrowError(expect.objectContaining({ code: "invalid_contract" }));
  });
});
