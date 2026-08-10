import { describe, expect, it } from "vitest";
import {
  META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
  MetaAnalysisConfigSnapshotError,
  normalizeMetaAnalysisConfigSnapshotV2,
  projectLegacyMetaChangeSnapshotConfig,
  projectMetaAnalysisConfig,
  type MetaAnalysisConfigSnapshotV2Input,
} from "@/domain/meta/analysis-config-projection";
import { normalizeMetaChangeSnapshot, type MetaChangeSnapshotInput } from "@/domain/meta/snapshot-diff";

function input(): MetaAnalysisConfigSnapshotV2Input {
  return {
    version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
    workspaceId: "workspace_primary", externalAccountId: "act_123", capturedAt: "2026-08-10T12:00:00.000Z",
    campaigns: [{ externalCampaignId: "campaign_primary", objective: { state: "known", value: "OUTCOME_LEADS" } }],
    adSets: [{ externalAdSetId: "adset_primary", externalCampaignId: "campaign_primary",
      optimizationGoal: { state: "known", value: "LEAD_GENERATION" } }],
  };
}

describe("Meta analysis config snapshot v2", () => {
  it("freezes reviewed objective and optimization mappings in a byte-stable replay snapshot", () => {
    const first = normalizeMetaAnalysisConfigSnapshotV2(input());
    const replay = normalizeMetaAnalysisConfigSnapshotV2(structuredClone(input()));
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ objectiveMappingVersion: "meta-objective-mapping/1.0.0",
      optimizationMappingVersion: "meta-ad-set-optimization-mapping/1.0.0",
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      capabilities: { canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false } });
    expect(projectMetaAnalysisConfig(first, "campaign_primary")).toMatchObject({
      objective: { state: "known", value: "lead_generation" },
      optimizationEvent: { state: "known", value: "lead" },
    });
  });

  it("keeps missing and unmapped fields reason-coded rather than guessing", () => {
    const snapshot = normalizeMetaAnalysisConfigSnapshotV2({ ...input(), campaigns: [{ externalCampaignId: "campaign_primary",
      objective: { state: "known", value: null } }], adSets: [{ externalAdSetId: "adset_primary",
      externalCampaignId: "campaign_primary", optimizationGoal: { state: "known", value: "OFFSITE_CONVERSIONS" } }] });
    expect(projectMetaAnalysisConfig(snapshot, "campaign_primary")).toMatchObject({
      objective: { state: "unknown", reason: "objective_missing" },
      optimizationEvent: { state: "unknown", reason: "ambiguous_ad_set_optimization_goals" },
      adSetOptimizationEvents: [{ optimizationEvent: { state: "unknown", reason: "optimization_goal_unmapped" } }],
    });
  });

  it("marks mixed and partially unknown ad-set goals explicitly", () => {
    const mixed = normalizeMetaAnalysisConfigSnapshotV2({ ...input(), adSets: [
      { externalAdSetId: "adset_a", externalCampaignId: "campaign_primary", optimizationGoal: { state: "known", value: "LEAD_GENERATION" } },
      { externalAdSetId: "adset_b", externalCampaignId: "campaign_primary", optimizationGoal: { state: "known", value: "LINK_CLICKS" } },
    ] });
    expect(projectMetaAnalysisConfig(mixed, "campaign_primary").optimizationEvent)
      .toEqual({ state: "unknown", reason: "mixed_ad_set_optimization_goals" });
    const ambiguous = normalizeMetaAnalysisConfigSnapshotV2({ ...input(), adSets: [
      { externalAdSetId: "adset_a", externalCampaignId: "campaign_primary", optimizationGoal: { state: "known", value: "LEAD_GENERATION" } },
      { externalAdSetId: "adset_b", externalCampaignId: "campaign_primary", optimizationGoal: { state: "unknown", reason: "field_not_returned" } },
    ] });
    expect(projectMetaAnalysisConfig(ambiguous, "campaign_primary").optimizationEvent)
      .toEqual({ state: "unknown", reason: "ambiguous_ad_set_optimization_goals" });
  });

  it("rejects tampering and preserves v1 replay as explicit unknowns", () => {
    const snapshot = normalizeMetaAnalysisConfigSnapshotV2(input());
    expect(() => projectMetaAnalysisConfig({ ...snapshot, snapshotHash: "0".repeat(64) }, "campaign_primary"))
      .toThrowError(expect.objectContaining<Partial<MetaAnalysisConfigSnapshotError>>({ code: "inauthentic_snapshot" }));
    const v1: MetaChangeSnapshotInput = {
      schemaVersion: 1, workspaceId: "workspace_primary", externalAccountId: "act_123", capturedAt: "2026-08-10T12:00:00.000Z",
      campaigns: [{ externalCampaignId: "campaign_primary", configuredStatus: { state: "known", value: "ACTIVE" },
        effectiveStatus: { state: "known", value: "ACTIVE" }, campaignBudgetOptimization: { state: "known", value: false },
        dailyBudgetMinor: { state: "known", value: null }, lifetimeBudgetMinor: { state: "known", value: null } }],
      adSets: [], ads: [],
    };
    expect(projectLegacyMetaChangeSnapshotConfig(normalizeMetaChangeSnapshot(v1), "campaign_primary")).toMatchObject({
      objective: { state: "unknown", reason: "legacy_snapshot_missing_objective" },
      optimizationEvent: { state: "unknown", reason: "legacy_snapshot_missing_optimization_goal" },
    });
  });

  it("rejects malformed source observations as a typed snapshot error", () => {
    const malformed = structuredClone(input()) as unknown as { campaigns: Array<{ objective: unknown }> };
    malformed.campaigns[0]!.objective = null;
    expect(() => normalizeMetaAnalysisConfigSnapshotV2(malformed as unknown as MetaAnalysisConfigSnapshotV2Input))
      .toThrowError(expect.objectContaining<Partial<MetaAnalysisConfigSnapshotError>>({ code: "invalid_snapshot" }));
  });
});
