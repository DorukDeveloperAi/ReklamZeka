import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleCurrentEffectiveAnalysisContextSourceReader, resolvedCategoryTarget } from "@/connectors/analyses/current-effective-analysis-context-source-drizzle-reader";
import type { CurrentDecisionCadence } from "@/connectors/decisions/current-decision-cadence-reader";
import type { CurrentReviewedGuidanceManifest } from "@/connectors/guidance/current-reviewed-guidance-reader";
import type { GuidanceCampaignSelection } from "@/connectors/guidance/guidance-campaign-selection-drizzle-repository";
import type { CurrentMetaHierarchyConfig } from "@/connectors/meta/current-meta-hierarchy-config-reader";
import { createGuidanceRegistry } from "@/domain/guidance/registry";
import { normalizeMetaAnalysisConfigSnapshotV2, META_ANALYSIS_CONFIG_SNAPSHOT_VERSION } from "@/domain/meta/analysis-config-projection";
import { bindCategoryProfiles, createCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension } from "@/domain/categories/registry";

const input = Object.freeze({ workspaceId: "61b10d7d-132c-4c6d-b49f-cddc9b10d025", accountRef: "account_primary",
  entityType: "campaign" as const, entityRef: "campaign_primary" });
const campaignId = "11111111-1111-4111-8111-111111111111";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

function categoryComposition(targetId: string = input.entityRef) {
  const dimension: CategoryDimension = { id: "dimension_primary", workspaceId: input.workspaceId, key: "service", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null };
  const definition: CategoryDefinition = { id: "definition_primary", workspaceId: input.workspaceId, dimensionId: dimension.id,
    key: "lead", label: "Lead", version: 1, archivedAt: null };
  const frozen = resolveEffectiveCategory({ dimension, definitions: [definition], path: { workspaceId: input.workspaceId,
    nodes: [{ level: "campaign", id: targetId }] }, assignments: [{ id: "assignment_primary", workspaceId: input.workspaceId,
      dimensionId: dimension.id, definitionId: definition.id, entity: { level: "campaign", id: targetId }, operation: "add",
      source: "manual", manualLock: false, evidence: [{ kind: "owner", ref: "owner_evidence" }], confidence: 1, version: 1, archivedAt: null }] }).frozenContext;
  return { workspaceId: input.workspaceId, dimensions: [{ values: [definition], frozenContext: bindCategoryProfiles(frozen,
    [createCategoryProfile({ workspaceRef: "workspace_primary", profileRef: "category_profile_lead",
      categoryRef: categoryDefinitionPublicRef("service", "lead"), parentCategoryRef: null, label: "Lead", description: "Lead profile",
      color: "#A31F34", ownerRef: "actor_owner", status: "active", bindings: { analysisPlaybookRefs: ["analysis_playbook_lead"], ruleInstructionBundleRefs: [],
        budgetPolicyRefs: [], transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] } })]) }] };
}

describe("DrizzleCurrentEffectiveAnalysisContextSourceReader", () => {
  it.each([
    ["campaign", ["campaign_primary"], { level: "campaign", id: campaignId }],
    ["ad_set", ["campaign_primary", "ad_set_primary"], { level: "ad_set", id: campaignId }],
    ["ad", ["campaign_primary", "ad_set_primary", "ad_primary"], { level: "ad", id: campaignId }],
    ["creative", ["campaign_primary", "ad_set_primary", "ad_primary", "creative_primary"], { level: "creative", id: campaignId, viaAdId: "22222222-2222-4222-8222-222222222222" }],
  ] as const)("resolves an exact tenant-bound internal category target for %s", async (entityType, hierarchyRefs, expected) => {
    const execute = vi.fn(async () => ({ rows: [entityType === "creative"
      ? { entity_id: campaignId, ad_id: "22222222-2222-4222-8222-222222222222" } : { entity_id: campaignId }] }));
    const hierarchy = { identity: { accountRef: input.accountRef, campaignRef: "campaign_primary", hierarchyRefs } } as unknown as CurrentMetaHierarchyConfig;
    await expect(resolvedCategoryTarget({ execute } as never, input.workspaceId,
      { ...input, entityType, entityRef: hierarchyRefs.at(-1)! }, hierarchy)).resolves.toEqual(expected);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([[[]], [[{ entity_id: campaignId }, { entity_id: campaignId }]]])("rejects missing or ambiguous category hierarchy candidates", async (candidates) => {
    const execute = vi.fn(async () => ({ rows: candidates }));
    const hierarchy = { identity: { accountRef: input.accountRef, campaignRef: input.entityRef, hierarchyRefs: [input.entityRef] } } as unknown as CurrentMetaHierarchyConfig;
    await expect(resolvedCategoryTarget({ execute } as never, input.workspaceId, input, hierarchy))
      .rejects.toThrow("category_hierarchy_unavailable");
  });

  it("uses one repeatable read-only scope snapshot and returns an evidence-bound ready bundle", async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: execute.mock.calls.length === 2
      ? [{ captured_at: "2026-08-10T15:00:00.000Z" }]
      : execute.mock.calls.length === 3 ? [{ workspace_ref: "workspace_primary" }]
        : execute.mock.calls.length === 4 ? [{ entity_id: campaignId }]
        : [] }));
    const database = { execute, transaction: vi.fn(async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute })) };
    const metaAnalysisConfigSnapshot = normalizeMetaAnalysisConfigSnapshotV2({ version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
      workspaceId: input.workspaceId, externalAccountId: input.accountRef, capturedAt: "2026-08-10T15:00:00.000Z",
      campaigns: [{ externalCampaignId: input.entityRef, objective: { state: "known", value: "OUTCOME_LEADS" } }], adSets: [] });
    const hierarchy: CurrentMetaHierarchyConfig = { capturedAt: "2026-08-10T15:00:00.000Z", identity: {
      connectionRef: "connection_primary", accountRef: input.accountRef, campaignRef: input.entityRef, hierarchyRefs: [input.entityRef] },
      metaAnalysisConfigSnapshot, sourceSnapshotEvidence: { snapshotId: "11111111-1111-4111-8111-111111111111",
        publicRef: "snapshot_primary", snapshotHash: "e".repeat(64), capturedAt: "2026-08-10T14:00:00.000Z" } };
    const readCurrent = vi.fn(async () => hierarchy);
    const readCurrentInTransaction = vi.fn(async () => ({ profileRef: "cadence_primary", profileRevision: 1,
      profileVersion: "decision-cadence/1.0.0", profileHash: "d".repeat(64), decision: {
      disposition: "blocked", reason: "insufficient_evidence", nextEligibleAt: null,
      evaluatedAt: "2026-08-10T15:00:00.000Z", actionAuthority: "none",
    } } as CurrentDecisionCadence));
    const registry = createGuidanceRegistry({ workspaceId: input.workspaceId, sources: [{ id: "source_primary", workspaceId: input.workspaceId,
      sourceType: "owner_statement", title: "Source", sourceRef: "source:primary", sourceUrl: null, content: "Reviewed source",
      author: null, capturedAt: null, reviewedAt: null, reviewBy: null, status: "published", version: 1 }], cards: [{ id: "card_primary",
      workspaceId: input.workspaceId, sourceType: "owner_statement", sourceIds: ["source_primary"], title: "Quality", body: "Protect quality",
      rationale: null, strength: "should", topic: "quality", decisionKey: null, positionKey: null, authority: "guidance_only", status: "published",
      effectiveFrom: null, effectiveTo: null, ownerRef: "owner_primary", version: 1 }], bindings: [{ id: "binding_primary", workspaceId: input.workspaceId,
      cardId: "card_primary", facet: "global", value: null, entityType: null, mode: "default", priority: 1, version: 1 }], sets: [{ id: "set_primary",
      workspaceId: input.workspaceId, name: "Primary", orderedCardIds: ["card_primary"], reviewStatus: "reviewed", version: 1 }] });
    const setHash = digest(registry.sets[0]);
    const readCurrentGuidance = vi.fn(async () => ({ capturedAt: "2026-08-10T15:00:00.000Z", registryHash: registry.registryHash, registry,
      reviewedSets: [{ setRef: "set_primary", setVersion: 1, setHash, cards: [] }] } as CurrentReviewedGuidanceManifest));
    const readCurrentSelection = vi.fn(async () => ({ selectionRef: "guidance_selection_primary", revision: 1,
      selectedSetRef: "set_primary", selectedSetVersion: 1, selectedSetHash: setHash, topics: ["quality"],
      requiredTopics: [], budget: { maxCards: 10, maxSources: 20, maxCharacters: 1000 }, sourceSelectionHash: "b".repeat(64),
      effectiveAt: "2026-08-10T15:00:00.000Z", previousSelectionHash: "GENESIS", selectionHash: "c".repeat(64) } as GuidanceCampaignSelection));
    const resolveInTransaction = vi.fn(async () => categoryComposition(campaignId));
    const inspectInTransaction = vi.fn(async () => ({ registryHash: "a".repeat(64), current: [], history: [], diffs: [] }));
    const loadInTransaction = vi.fn(async () => ({ scope: { evaluatedAt: "2026-08-10T14:00:00.000Z" }, catalog: { instructionPolicyRegistryHash: "a".repeat(64) }, authoritySnapshot: {
      workspaceId: input.workspaceId, verifiedAt: "2026-08-10T14:00:00.000Z", expiresAt: "2026-08-10T16:00:00.000Z",
    } }));
    const result = await new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never,
      { readCurrent }, { readCurrentInTransaction }, { readCurrentInTransaction: readCurrentGuidance },
      { readCurrentInTransaction: readCurrentSelection }, { resolveInTransaction } as never,
      { inspectInTransaction } as never, { loadInTransaction } as never).loadCurrent(input);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never).sql.toLowerCase()).toContain("repeatable read, read only");
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.facts.data).toEqual({ trustStatus: "not_ready", snapshotRefs: ["snapshot_primary"],
        featureRefs: [], windowRefs: [], blockers: ["analysis_window_not_bound"] });
      expect(result.facts.history).toEqual({ changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] });
      expect(result.facts.cadenceEvidence).toEqual({ profileRevision: 1, profileVersion: "decision-cadence/1.0.0", profileHash: "d".repeat(64) });
      expect(result.facts.versions.promotionRegistry).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(execute).toHaveBeenCalledTimes(6);
    expect(readCurrent).toHaveBeenCalledWith(expect.anything(), input);
    expect(readCurrentInTransaction).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: input.workspaceId, accountRef: input.accountRef, campaignRef: input.entityRef,
    }, "2026-08-10T15:00:00.000Z");
    expect(readCurrentGuidance).toHaveBeenCalledWith(expect.anything(), input.workspaceId, "2026-08-10T15:00:00.000Z");
    expect(readCurrentSelection).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: input.workspaceId, accountRef: input.accountRef, campaignRef: input.entityRef,
    }, "2026-08-10T15:00:00.000Z");
    expect(resolveInTransaction).toHaveBeenCalledWith(expect.anything(), "workspace_primary", input.workspaceId,
      { level: "campaign", id: campaignId });
    expect(inspectInTransaction).toHaveBeenCalledWith(expect.anything(), input.workspaceId, "2026-08-10T15:00:00.000Z");
    expect(loadInTransaction).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: input.workspaceId, accountRef: input.accountRef, evaluatedAt: "2026-08-10T15:00:00.000Z",
    });
  });

  it("rejects future or expired authority evidence before a source can advance", async () => {
    const execute = vi.fn(async () => ({ rows: execute.mock.calls.length === 2
      ? [{ captured_at: "2026-08-10T15:00:00.000Z" }]
      : execute.mock.calls.length === 3 ? [{ workspace_ref: "workspace_primary" }]
        : execute.mock.calls.length === 4 ? [{ entity_id: campaignId }] : [] }));
    const database = { execute, transaction: async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute }) };
    const hierarchy: CurrentMetaHierarchyConfig = { capturedAt: "2026-08-10T15:00:00.000Z", identity: {
      connectionRef: "connection_primary", accountRef: input.accountRef, campaignRef: input.entityRef, hierarchyRefs: [input.entityRef] },
      metaAnalysisConfigSnapshot: normalizeMetaAnalysisConfigSnapshotV2({ version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
        workspaceId: input.workspaceId, externalAccountId: input.accountRef, capturedAt: "2026-08-10T15:00:00.000Z",
        campaigns: [{ externalCampaignId: input.entityRef, objective: { state: "known", value: "OUTCOME_LEADS" } }], adSets: [] }), sourceSnapshotEvidence: {} as never };
    const registry = createGuidanceRegistry({ workspaceId: input.workspaceId, sources: [{ id: "source_primary", workspaceId: input.workspaceId,
      sourceType: "owner_statement", title: "Source", sourceRef: "source:primary", sourceUrl: null, content: "Reviewed source", author: null,
      capturedAt: null, reviewedAt: null, reviewBy: null, status: "published", version: 1 }], cards: [{ id: "card_primary", workspaceId: input.workspaceId,
      sourceType: "owner_statement", sourceIds: ["source_primary"], title: "Quality", body: "Protect quality", rationale: null, strength: "should",
      topic: "quality", decisionKey: null, positionKey: null, authority: "guidance_only", status: "published", effectiveFrom: null,
      effectiveTo: null, ownerRef: "owner_primary", version: 1 }], bindings: [{ id: "binding_primary", workspaceId: input.workspaceId,
      cardId: "card_primary", facet: "global", value: null, entityType: null, mode: "default", priority: 1, version: 1 }], sets: [{ id: "set_primary",
      workspaceId: input.workspaceId, name: "Primary", orderedCardIds: ["card_primary"], reviewStatus: "reviewed", version: 1 }] });
    const setHash = digest(registry.sets[0]);
    await expect(new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never,
      { readCurrent: vi.fn(async () => hierarchy) }, { readCurrentInTransaction: vi.fn(async () => ({ decision: {
        evaluatedAt: hierarchy.capturedAt, actionAuthority: "none" } })) } as never,
      { readCurrentInTransaction: vi.fn(async () => ({ capturedAt: hierarchy.capturedAt, registryHash: registry.registryHash, registry,
        reviewedSets: [{ setRef: "set_primary", setVersion: 1, setHash, cards: [] }] })) },
      { readCurrentInTransaction: vi.fn(async () => ({ selectionRef: "guidance_selection_primary", revision: 1, selectedSetRef: "set_primary",
        selectedSetVersion: 1, selectedSetHash: setHash, topics: ["quality"], requiredTopics: [], budget: { maxCards: 10, maxSources: 20,
          maxCharacters: 1000 }, sourceSelectionHash: "b".repeat(64), effectiveAt: hierarchy.capturedAt, previousSelectionHash: "GENESIS",
        selectionHash: "c".repeat(64) })) },
      { resolveInTransaction: vi.fn(async () => ({ workspaceId: input.workspaceId, dimensions: [{ values: [{ key: "lead" }],
        frozenContext: { dimension: { key: "service" }, path: [{ id: campaignId }] } }] })) } as never,
      { inspectInTransaction: vi.fn(async () => ({ registryHash: "a".repeat(64), current: [], history: [], diffs: [] })) } as never,
      { loadInTransaction: vi.fn(async () => ({ scope: { evaluatedAt: "2026-08-10T16:00:00.000Z" }, catalog: { instructionPolicyRegistryHash: "a".repeat(64) }, authoritySnapshot: {
        workspaceId: input.workspaceId, verifiedAt: "2026-08-10T14:00:00.000Z", expiresAt: "2026-08-10T17:00:00.000Z" } })) } as never).loadCurrent(input))
      .rejects.toThrow("policy_authority_unavailable");
  });

  it("does not claim a source scope when the tenant/account read is missing or ambiguous", async () => {
    for (const rows of [[], [{ captured_at: "2026-08-10T15:00:00.000Z" }, { captured_at: "2026-08-10T15:00:00.000Z" }]]) {
      const execute = vi.fn(async (_query: unknown) => ({ rows }));
      const database = { execute, transaction: async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute }) };
      await expect(new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never).loadCurrent(input)).rejects.toThrow("scope_not_found");
    }
  });
});
