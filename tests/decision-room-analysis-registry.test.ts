import { describe, expect, it } from "vitest";
import {
  ANALYSIS_TEMPLATE_DEFINITION_VERSION,
  ANALYSIS_TIMEFRAME_DEFINITION_VERSION,
  DecisionRoomAnalysisRegistryError,
  analysisAssetDefinitionHash,
  validateAnalysisTemplateDefinition,
  validateAnalysisTimeframeDefinition,
  type AnalysisTemplateDefinition,
} from "@/application/decision-room-analysis-registry";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";

const timeframe = {
  version: ANALYSIS_TIMEFRAME_DEFINITION_VERSION,
  timeframeRef: "timeframe_daily",
  revision: 1,
  timeframe: { kind: "rolling" as const, days: 7, timezone: "Europe/Istanbul" },
  comparison: "previous_period" as const,
  anchors: {},
};

function template(): AnalysisTemplateDefinition {
  return {
    version: ANALYSIS_TEMPLATE_DEFINITION_VERSION,
    templateRef: "template_daily",
    revision: 1,
    timeframeRef: timeframe.timeframeRef,
    timeframeDefinitionHash: analysisAssetDefinitionHash(timeframe),
    contextHash: "a".repeat(64),
    requestedPasses: ["entity"],
    hierarchy: [{ entityRef: "campaign_safe", entityType: "campaign", parentEntityRef: null }],
    checks: [{
      checkKey: "spend_guard", passKey: "entity", entityRef: "campaign_safe", entityType: "campaign",
      parentEntityRef: null, hierarchyPathRefs: ["campaign_safe"], driverEvidenceRefs: [],
      externalEntityId: "238000000000001", metaConnectionId: "20000000-0000-4000-8000-000000000002",
      adAccountId: "30000000-0000-4000-8000-000000000003", attributionLabel: "7d_click_1d_view",
      expectedCurrency: "TRY",
      spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1000", minimumSample: 1 },
      maxRowsPerQuery: 50, expectedSnapshotRefs: ["snapshot_safe"],
    }],
    cadence: {
      profile: {
        version: DECISION_CADENCE_VERSION, settleHours: 0, minimumObservationHours: 0,
        minimumLearningHours: 0, cooldownHours: 24, repeatSuppressionHours: 24,
        frequencyWindowHours: 24, maxDecisionsPerWindow: 5, maxActionsPerWindow: 2,
        maximumHistoryEntries: 20, minimumEvidenceCount: 1, minimumEvidenceScore: 0.5,
      },
      observationStartedAt: "2026-08-01T00:00:00.000Z", lastMaterialChangeAt: null,
      learning: { state: "not_applicable", startedAt: null }, lastDecision: null, recentDecisions: [],
      requestedDisposition: "act", emergencyGuardrail: { breached: false, evidenceRef: null },
    },
  };
}

describe("Decision Room persisted analysis definitions", () => {
  it("validates versioned timeframe/template definitions and hashes canonical key order", () => {
    expect(validateAnalysisTimeframeDefinition(timeframe, "2026-08-07T12:00:00Z")).toBe(timeframe);
    expect(validateAnalysisTemplateDefinition(template()).templateRef).toBe("template_daily");
    expect(analysisAssetDefinitionHash({ b: 2, a: 1 })).toBe(analysisAssetDefinitionHash({ a: 1, b: 2 }));
  });

  it("fails closed on skipped revisions, malformed refs and authority material", () => {
    expect(() => validateAnalysisTimeframeDefinition({ ...timeframe, revision: 0 }, "2026-08-07T12:00:00Z"))
      .toThrow(DecisionRoomAnalysisRegistryError);
    expect(() => validateAnalysisTemplateDefinition({ ...template(), templateRef: "not allowed" }))
      .toThrow(DecisionRoomAnalysisRegistryError);
    expect(() => validateAnalysisTemplateDefinition({
      ...template(),
      cadence: { ...template().cadence, canExecuteWrite: true },
    } as unknown as AnalysisTemplateDefinition)).toThrow(DecisionRoomAnalysisRegistryError);
  });

  it("requires anchored timeframes to be resolvable at publication", () => {
    expect(() => validateAnalysisTimeframeDefinition({
      ...timeframe,
      timeframe: { kind: "action_relative", beforeDays: 2, afterDays: 2, timezone: "Europe/Istanbul" },
    }, "2026-08-07T12:00:00Z")).toThrow(DecisionRoomAnalysisRegistryError);
  });
});
