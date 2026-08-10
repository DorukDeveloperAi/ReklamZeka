import { describe, expect, it, vi } from "vitest";
import { BusinessOutcomeContextComposer } from "@/application/business-outcome-context-composer";
import { buildBusinessOutcomeEvidence } from "@/analyses/business-outcome-evidence";
import type { EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";

const baseContext: EffectiveCampaignContextInput = { workspaceId: "workspace_primary", capturedAt: "2026-08-10T13:00:00.000Z", identity: { connectionRef: "connection_primary", accountRef: "account_primary", campaignRef: "campaign_primary", entityRef: "campaign_primary", entityType: "campaign", hierarchyRefs: ["campaign_primary"] }, meta: { objective: { state: "known", value: "lead_generation" }, optimizationEvent: { state: "known", value: "lead" }, configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" }, budgetOwnerRef: { state: "known", value: null }, targetingSignature: { state: "unknown", reason: "not_observed" }, actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null } }, categories: [], guidance: buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId: "workspace_primary", sources: [], cards: [], sets: [], bindings: [] }), { workspaceId: "workspace_primary", accountId: "account_primary", objective: "lead_generation", internalCategoryIds: [], entity: { type: "campaign", id: "campaign_primary" }, topics: [], requiredTopics: [], evaluatedAt: "2026-08-10T12:00:00.000Z", budget: { maxCards: 10, maxSources: 10, maxCharacters: 1000 } }), policies: [], cadence: { profileRef: "cadence_primary", decision: "observe", reason: "stable", cooldownUntil: null }, data: { trustStatus: "ready", snapshotRefs: ["snapshot_primary"], featureRefs: [], windowRefs: [], blockers: [] }, history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] }, versions: { metaCatalog: "meta", categoryResolver: "category", guidanceRegistry: "guidance", metricCatalog: "metric", formulaCatalog: "formula", timeframeResolver: "timeframe" } };
const evidence = buildBusinessOutcomeEvidence({ entityRef: "campaign_primary", sourceHeadHash: "a".repeat(64), windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-10T00:00:00.000Z", materializedAt: "2026-08-10T12:00:00.000Z", signals: [] });
describe("BusinessOutcomeContextComposer", () => {
  it("derives tenant/entity from the base context and persists only repository materialized evidence", async () => {
    const materialize = vi.fn(async () => evidence); const save = vi.fn(async () => ({ outcome: "inserted" as const, record: {} }));
    const composer = new BusinessOutcomeContextComposer({ materialize }, { save });
    const result = await composer.composeAndSave({ baseContext, windowStart: evidence.windowStart, windowEnd: evidence.windowEnd });
    expect(materialize).toHaveBeenCalledWith({ workspaceId: "workspace_primary", entityRef: "campaign_primary", windowStart: evidence.windowStart, windowEnd: evidence.windowEnd });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ history: expect.objectContaining({ outcomeEvidence: [evidence] }) }));
    expect(result).toMatchObject({ capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
  });
  it("rejects pre-bound, cross-entity and future evidence before persistence", async () => {
    const materialize = vi.fn(async () => evidence); const save = vi.fn(); const composer = new BusinessOutcomeContextComposer({ materialize }, { save });
    await expect(composer.composeAndSave({ baseContext: { ...baseContext, history: { ...baseContext.history, outcomeEvidence: [evidence] } }, windowStart: evidence.windowStart, windowEnd: evidence.windowEnd })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(new BusinessOutcomeContextComposer({ materialize: async () => ({ ...evidence, entityRef: "campaign_other" }) }, { save }).composeAndSave({ baseContext, windowStart: evidence.windowStart, windowEnd: evidence.windowEnd })).rejects.toMatchObject({ code: "scope_mismatch" });
    await expect(new BusinessOutcomeContextComposer({ materialize: async () => ({ ...evidence, materializedAt: "2026-08-10T14:00:00.000Z" }) }, { save }).composeAndSave({ baseContext, windowStart: evidence.windowStart, windowEnd: evidence.windowEnd })).rejects.toMatchObject({ code: "stale_base_context" });
    expect(save).not.toHaveBeenCalled();
  });
});
