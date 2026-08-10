import { describe, expect, it, vi } from "vitest";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { EffectiveAnalysisContextComposer, EffectiveAnalysisContextComposerError,
  type EffectiveAnalysisContextFacts, type RepositoryVerifiedAuthority } from "@/application/effective-analysis-context-composer";
import { CurrentCategoryCompositionResolver } from "@/application/current-category-composition-resolver";
import { bindCategoryProfiles, createCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension } from "@/domain/categories/registry";
import { buildEffectiveGuidancePack, createGuidanceRegistry, type GuidanceCard, type GuidanceSource } from "@/domain/guidance/registry";
import { normalizeMetaAnalysisConfigSnapshotV2, META_ANALYSIS_CONFIG_SNAPSHOT_VERSION } from "@/domain/meta/analysis-config-projection";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";

const workspaceId = "workspace_private_composer";
const request = Object.freeze({ workspaceId, accountRef: "account_primary", entityType: "campaign" as const,
  entityRef: "campaign_primary", capturedAt: "2026-08-10T15:00:00.000Z" });

function category() {
  const dimension: CategoryDimension = { id: "dimension_primary", workspaceId, key: "service", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null };
  const definition: CategoryDefinition = { id: "definition_primary", workspaceId, dimensionId: dimension.id,
    key: "lead", label: "Lead", version: 1, archivedAt: null };
  const frozen = resolveEffectiveCategory({ dimension, definitions: [definition],
    path: { workspaceId, nodes: [{ level: "campaign", id: "campaign_primary" }] }, assignments: [{
      id: "assignment_primary", workspaceId, dimensionId: dimension.id, definitionId: definition.id,
      entity: { level: "campaign", id: "campaign_primary" }, operation: "add", source: "manual", manualLock: false,
      evidence: [{ kind: "owner", ref: "owner_evidence" }], confidence: 1, version: 1, archivedAt: null,
    }] }).frozenContext;
  return bindCategoryProfiles(frozen, [createCategoryProfile({ workspaceRef: "workspace_private_composer",
    profileRef: "category_profile_lead", categoryRef: categoryDefinitionPublicRef("service", "lead"), parentCategoryRef: null,
    label: "Lead", description: "Lead profile", color: "#A31F34", ownerRef: "actor_owner", status: "active",
    bindings: { analysisPlaybookRefs: ["analysis_playbook_lead"], ruleInstructionBundleRefs: [], budgetPolicyRefs: [],
      transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] },
  })]);
}

function guidance() {
  const source: GuidanceSource = { id: "source_primary", workspaceId, sourceType: "owner_statement", title: "Owner",
    sourceRef: "owner:primary", sourceUrl: null, content: "Protect quality", author: "owner",
    capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z", reviewBy: null, status: "published", version: 1 };
  const card: GuidanceCard = { id: "card_primary", workspaceId, sourceType: "owner_statement", sourceIds: [source.id],
    title: "Quality", body: "Protect lead quality", rationale: null, strength: "must", topic: "quality", decisionKey: null,
    positionKey: null, authority: "guidance_only", status: "published", effectiveFrom: null, effectiveTo: null,
    ownerRef: "owner_primary", version: 1 };
  return buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId, sources: [source], cards: [card], sets: [], bindings: [{
    id: "binding_primary", workspaceId, cardId: card.id, facet: "global", value: null, entityType: null,
    mode: "default", priority: 1, version: 1,
  }] }), { workspaceId, accountId: "account_primary", objective: "lead_generation", internalCategoryIds: ["definition_primary"],
    entity: { type: "campaign", id: "campaign_primary" }, topics: ["quality"], requiredTopics: ["quality"],
    evaluatedAt: "2026-08-10T14:00:00.000Z", budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 } });
}

function facts(): EffectiveAnalysisContextFacts {
  return { identity: { connectionRef: "connection_primary", campaignRef: "campaign_primary", hierarchyRefs: ["campaign_primary"] },
    meta: { configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: "campaign_primary" }, targetingSignature: { state: "unknown", reason: "not_observed" },
      actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null } },
    metaAnalysisConfigSnapshot: normalizeMetaAnalysisConfigSnapshotV2({ version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
      workspaceId, externalAccountId: "account_primary", capturedAt: "2026-08-10T14:00:00.000Z",
      campaigns: [{ externalCampaignId: "campaign_primary", objective: { state: "known", value: "OUTCOME_LEADS" } }],
      adSets: [{ externalAdSetId: "adset_primary", externalCampaignId: "campaign_primary", optimizationGoal: { state: "known", value: "LEAD_GENERATION" } }],
    }), guidance: guidance(), cadence: { profileRef: "cadence_primary", decision: "observe", reason: "stable", cooldownUntil: null },
    cadenceEvidence: { profileRevision: 1, profileVersion: DECISION_CADENCE_VERSION, profileHash: "a".repeat(64) },
    data: { trustStatus: "ready", snapshotRefs: ["snapshot_primary"], featureRefs: [], windowRefs: [], blockers: [] },
    history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: { metaCatalog: "meta_catalog", categoryResolver: "category_resolver", guidanceRegistry: "guidance_registry",
      metricCatalog: "metric_catalog", formulaCatalog: "formula_catalog", timeframeResolver: "timeframe_resolver", promotionRegistry: "b".repeat(64) },
  };
}

function categoryResolver() {
  const frozen = category();
  return { resolve: vi.fn(async () => ({ workspaceId, dimensions: [{ frozenContext: frozen, values: [] }] })) } as unknown as CurrentCategoryCompositionResolver;
}

function authority(): RepositoryVerifiedAuthority {
  return { compose: (base) => {
    const context = buildEffectiveCampaignContext({ ...base, versions: { ...base.versions, instructionPolicyRegistry: "c".repeat(64), policyAuthority: "d".repeat(64) },
      policyAuthorityEvidence: { snapshotRef: "authority_snapshot_primary", snapshotHash: "e".repeat(64), catalogHash: "f".repeat(64),
        scopeHash: "1".repeat(64), accountGroupBindingHashes: [], topicBindingHashes: [], manualLockBindingHashes: [], semanticBindingHashes: [] } });
    return { context, validationBoundary: { contractIntegrity: "self_hash_validated", productionAuthoritySourceBound: true },
      authority: { canExecute: false, canWriteMeta: false, canApprove: false, canSchedule: false,
        canCallTool: false, canAccessNetwork: false, canQuerySql: false } };
  } };
}

function composer(options: Readonly<{ invalidated?: boolean; authority?: RepositoryVerifiedAuthority }> = {}) {
  const save = vi.fn(async (context) => ({ outcome: "inserted" as const,
    record: { context, sourceComponents: [], invalidated: options.invalidated ?? false } }));
  const instance = new EffectiveAnalysisContextComposer({ loadCurrent: vi.fn(async () => facts()) }, categoryResolver(),
    { loadAuthority: vi.fn(async () => options.authority ?? authority()) }, { inspect: vi.fn(async () => ({ registryHash: "c".repeat(64), current: [], history: [], diffs: [] })) }, { save });
  return { instance, save };
}

describe("EffectiveAnalysisContextComposer", () => {
  it("accepts only scope input, derives config/category/authority evidence, and persists evidence-bound", async () => {
    const { instance, save } = composer();
    const result = await instance.composeAndSave(request);
    expect(result.context.meta.objective).toEqual({ state: "known", value: "lead_generation" });
    expect(result.context.metaAnalysisConfigEvidence?.snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.context.categories).toHaveLength(1);
    expect(result.context.policyAuthorityEvidence?.snapshotRef).toBe("authority_snapshot_primary");
    expect(result.context.capabilities).toEqual({ containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false });
    expect(save).toHaveBeenCalledWith(result.context, { mode: "evidence_bound" });
  });

  it("rejects caller-injected context fields and an authority closure without production proof", async () => {
    await expect(composer().instance.composeAndSave({ ...request, context: {} } as unknown as typeof request))
      .rejects.toMatchObject({ code: "invalid_input" } satisfies Partial<EffectiveAnalysisContextComposerError>);
    const unbound = { ...authority(), compose: (base: Parameters<RepositoryVerifiedAuthority["compose"]>[0]) => ({
      ...authority().compose(base, { registryHash: "c".repeat(64), current: [], history: [], diffs: [] }),
      validationBoundary: { contractIntegrity: "self_hash_validated" as const, productionAuthoritySourceBound: false },
    }) } as unknown as RepositoryVerifiedAuthority;
    await expect(composer({ authority: unbound }).instance.composeAndSave(request))
      .rejects.toMatchObject({ code: "authority_rejected" } satisfies Partial<EffectiveAnalysisContextComposerError>);
  });

  it("rejects a save that is already invalidated", async () => {
    await expect(composer({ invalidated: true }).instance.composeAndSave(request))
      .rejects.toMatchObject({ code: "invalidated_save" } satisfies Partial<EffectiveAnalysisContextComposerError>);
  });
});
