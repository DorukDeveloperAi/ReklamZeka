import { afterEach, describe, expect, it, vi } from "vitest";

import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import type { EffectiveAnalysisContextFacts, EffectiveAnalysisContextReadySource, RepositoryVerifiedAuthority } from
  "@/application/effective-analysis-context-composer";
import { EffectiveAnalysisContextComposerError } from "@/application/effective-analysis-context-composer";
import { DrizzleCurrentEffectiveAnalysisContextSourceReader } from "@/connectors/analyses/current-effective-analysis-context-source-drizzle-reader";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { bindCategoryProfiles, createCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension } from "@/domain/categories/registry";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";
import { META_ANALYSIS_CONFIG_SNAPSHOT_VERSION, normalizeMetaAnalysisConfigSnapshotV2 } from "@/domain/meta/analysis-config-projection";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";

const workspaceId = "workspace_private_composer_root";
const request = Object.freeze({ workspaceId, accountRef: "account_primary", entityType: "campaign" as const,
  entityRef: "campaign_primary" });

function category() {
  const dimension: CategoryDimension = { id: "dimension_primary", workspaceId, key: "service", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null };
  const definition: CategoryDefinition = { id: "definition_primary", workspaceId, dimensionId: dimension.id,
    key: "lead", label: "Lead", version: 1, archivedAt: null };
  const frozen = resolveEffectiveCategory({ dimension, definitions: [definition], path: { workspaceId,
    nodes: [{ level: "campaign", id: request.entityRef }] }, assignments: [{
    id: "assignment_primary", workspaceId, dimensionId: dimension.id, definitionId: definition.id,
    entity: { level: "campaign", id: request.entityRef }, operation: "add", source: "manual", manualLock: false,
    evidence: [{ kind: "owner", ref: "owner_evidence" }], confidence: 1, version: 1, archivedAt: null,
  }] }).frozenContext;
  return bindCategoryProfiles(frozen, [createCategoryProfile({ workspaceRef: "workspace_private_composer_root",
    profileRef: "category_profile_lead", categoryRef: categoryDefinitionPublicRef("service", "lead"), parentCategoryRef: null,
    label: "Lead", description: "Lead profile", color: "#A31F34", ownerRef: "actor_owner", status: "active",
    bindings: { analysisPlaybookRefs: ["analysis_playbook_lead"], ruleInstructionBundleRefs: [], budgetPolicyRefs: [],
      transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] },
  })]);
}

function guidance() {
  return buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId,
    sources: [{ id: "source_primary", workspaceId, sourceType: "owner_statement", title: "Owner", sourceRef: "owner:primary",
      sourceUrl: null, content: "Protect quality", author: "owner", capturedAt: "2026-08-01T00:00:00.000Z",
      reviewedAt: "2026-08-02T00:00:00.000Z", reviewBy: null, status: "published", version: 1 }],
    cards: [{ id: "card_primary", workspaceId, sourceType: "owner_statement", sourceIds: ["source_primary"], title: "Quality",
      body: "Protect lead quality", rationale: null, strength: "must", topic: "quality", decisionKey: null, positionKey: null,
      authority: "guidance_only", status: "published", effectiveFrom: null, effectiveTo: null, ownerRef: "owner_primary", version: 1 }],
    sets: [], bindings: [{ id: "binding_primary", workspaceId, cardId: "card_primary", facet: "global", value: null,
      entityType: null, mode: "default", priority: 1, version: 1 }],
  }), { workspaceId, accountId: request.accountRef, objective: "lead_generation", internalCategoryIds: ["definition_primary"],
    entity: { type: "campaign", id: request.entityRef }, topics: ["quality"], requiredTopics: ["quality"],
    evaluatedAt: "2026-08-10T15:00:00.000Z", budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 } });
}

function facts(): EffectiveAnalysisContextFacts {
  return { identity: { connectionRef: "connection_primary", campaignRef: request.entityRef, hierarchyRefs: [request.entityRef] },
    meta: { configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: request.entityRef }, targetingSignature: { state: "unknown", reason: "not_observed" },
      actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null } },
    metaAnalysisConfigSnapshot: normalizeMetaAnalysisConfigSnapshotV2({ version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
      workspaceId, externalAccountId: request.accountRef, capturedAt: "2026-08-10T15:00:00.000Z",
      campaigns: [{ externalCampaignId: request.entityRef, objective: { state: "known", value: "OUTCOME_LEADS" } }], adSets: [] }),
    guidance: guidance(), cadence: { profileRef: "cadence_primary", decision: "observe", reason: "stable", cooldownUntil: null },
    cadenceEvidence: { profileRevision: 1, profileVersion: DECISION_CADENCE_VERSION, profileHash: "a".repeat(64) },
    data: { trustStatus: "not_ready", snapshotRefs: ["snapshot_primary"], featureRefs: [], windowRefs: [], blockers: ["analysis_window_not_bound"] },
    history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: { metaCatalog: "meta_catalog", categoryResolver: "category_resolver", guidanceRegistry: "guidance_registry",
      metricCatalog: "metric_catalog", formulaCatalog: "formula_catalog", timeframeResolver: "timeframe_resolver", promotionRegistry: "b".repeat(64) },
  };
}

function authority(): RepositoryVerifiedAuthority {
  return { compose: (base) => {
    const context = buildEffectiveCampaignContext({ ...base, versions: { ...base.versions, instructionPolicyRegistry: "c".repeat(64), policyAuthority: "d".repeat(64) },
      policyAuthorityEvidence: { snapshotRef: "authority_snapshot_primary", snapshotHash: "e".repeat(64), catalogHash: "f".repeat(64),
        scopeHash: "1".repeat(64), accountGroupBindingHashes: [], topicBindingHashes: [], manualLockBindingHashes: [], semanticBindingHashes: [] } });
    return { context, validationBoundary: { contractIntegrity: "self_hash_validated" as const, productionAuthoritySourceBound: true as const },
      authority: { canExecute: false, canWriteMeta: false, canApprove: false, canSchedule: false,
        canCallTool: false, canAccessNetwork: false, canQuerySql: false } };
  } };
}

function readySource(): EffectiveAnalysisContextReadySource {
  return { status: "ready", capturedAt: "2026-08-10T15:00:00.000Z", facts: facts(),
    categories: { workspaceId, dimensions: [{ frozenContext: category() }] },
    lifecycle: { registryHash: "c".repeat(64), current: [], history: [], diffs: [] }, authority: authority() };
}

afterEach(() => vi.restoreAllMocks());

describe("createDrizzleEffectiveAnalysisContextComposer", () => {
  it("wires concrete shared-database source and writer through the evidence-bound ready path", async () => {
    const source = vi.spyOn(DrizzleCurrentEffectiveAnalysisContextSourceReader.prototype, "loadCurrent")
      .mockResolvedValue(readySource());
    const save = vi.spyOn(DrizzleEffectiveCampaignContextRepository.prototype, "save").mockImplementation(async (context) => ({
      outcome: "inserted", record: { context, sourceComponents: [], invalidated: false },
    }));
    const composer = createDrizzleEffectiveAnalysisContextComposer({ database: {} as never });

    const result = await composer.composeAndSave(request);

    expect(source).toHaveBeenCalledWith(request);
    expect(save).toHaveBeenCalledWith(result.context, { mode: "evidence_bound" });
    expect(result.context.data.trustStatus).toBe("not_ready");
  });

  it("keeps rejected and invalidated persistence outcomes fail-closed", async () => {
    const source = vi.spyOn(DrizzleCurrentEffectiveAnalysisContextSourceReader.prototype, "loadCurrent");
    const save = vi.spyOn(DrizzleEffectiveCampaignContextRepository.prototype, "save");
    const composer = createDrizzleEffectiveAnalysisContextComposer({ database: {} as never });
    source.mockResolvedValue({ status: "not_ready", capturedAt: "2026-08-10T15:00:00.000Z", reason: "current_source_bundle_unavailable",
      capabilities: { canCompose: false, canAuthorizeAction: false, canExecute: false, canExecuteWrite: false, canWriteMeta: false,
        canApprove: false, canSchedule: false, canCallTool: false, canAccessNetwork: false, canQuerySql: false } });
    await expect(composer.composeAndSave(request)).rejects.toMatchObject({ code: "source_rejected" } satisfies Partial<EffectiveAnalysisContextComposerError>);
    expect(save).not.toHaveBeenCalled();

    source.mockResolvedValue(readySource());
    save.mockImplementation(async (context) => ({ outcome: "inserted", record: { context, sourceComponents: [], invalidated: true } }));
    await expect(composer.composeAndSave(request)).rejects.toMatchObject({ code: "invalidated_save" } satisfies Partial<EffectiveAnalysisContextComposerError>);
  });
});
