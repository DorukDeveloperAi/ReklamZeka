import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildEffectiveCampaignContext, type EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import {
  DrizzleEffectiveCampaignContextRepository,
  EffectiveCampaignContextRepositoryError,
  sourceComponentsOf,
} from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { bindCategoryProfiles, createCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension } from "@/domain/categories/registry";
import {
  buildEffectiveGuidancePack,
  createGuidanceRegistry,
  type GuidanceCard,
  type GuidanceSource,
} from "@/domain/guidance/registry";
import {
  META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
  normalizeMetaAnalysisConfigSnapshotV2,
} from "@/domain/meta/analysis-config-projection";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";

const workspaceId = "00000000-0000-0000-0000-000000000101";
const snapshotRef = "snapshot_aaaaaaaaaaaaaaaaaaaa";

function guidance() {
  const source: GuidanceSource = {
    id: "source-1", workspaceId, sourceType: "owner_statement", title: "Owner",
    sourceRef: "owner:1", sourceUrl: null, content: "Protect budget", author: "owner",
    capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z",
    reviewBy: null, status: "published", version: 1,
  };
  const card: GuidanceCard = {
    id: "card-1", workspaceId, sourceType: "owner_statement", sourceIds: [source.id],
    title: "Protection", body: "Do not reallocate protected budget", rationale: null,
    strength: "must", topic: "budget", decisionKey: null, positionKey: null,
    authority: "guidance_only", status: "published", effectiveFrom: null, effectiveTo: null,
    ownerRef: "owner-1", version: 1,
  };
  const registry = createGuidanceRegistry({
    workspaceId, sources: [source], cards: [card], sets: [],
    bindings: [{
      id: "binding-1", workspaceId, cardId: card.id, facet: "global", value: null,
      entityType: null, mode: "default", priority: 10, version: 1,
    }],
  });
  return buildEffectiveGuidancePack(registry, {
    workspaceId, accountId: "account-1", objective: "lead_generation", internalCategoryIds: ["category-1"],
    entity: { type: "campaign", id: "campaign-1" }, topics: ["budget"], requiredTopics: ["budget"],
    evaluatedAt: "2026-08-07T12:00:00.000Z",
    budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
  });
}

function category() {
  const dimension: CategoryDimension = {
    id: "dimension-1", workspaceId, key: "protection", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null,
  };
  const definition: CategoryDefinition = {
    id: "category-1", workspaceId, dimensionId: dimension.id, key: "protected",
    label: "Protected", version: 1, archivedAt: null,
  };
  const frozen = resolveEffectiveCategory({
    dimension, definitions: [definition], path: { workspaceId, nodes: [{ level: "campaign", id: "campaign-1" }] },
    assignments: [{
      id: "assignment-1", workspaceId, dimensionId: dimension.id, definitionId: definition.id,
      entity: { level: "campaign", id: "campaign-1" }, operation: "add", source: "manual",
      manualLock: true, evidence: [{ kind: "owner", ref: "statement-1" }], confidence: 1,
      version: 1, archivedAt: null,
    }],
  }).frozenContext;
  return bindCategoryProfiles(frozen, [createCategoryProfile({ workspaceRef: "workspace_context_test",
    profileRef: "category_profile_protected", categoryRef: categoryDefinitionPublicRef("protection", "protected"),
    parentCategoryRef: null, label: "Protected", description: "Protected budget profile", color: "#A31F34",
    ownerRef: "actor_context_owner", status: "active", bindings: {
      analysisPlaybookRefs: ["analysis_playbook_protection_v1"], ruleInstructionBundleRefs: [],
      budgetPolicyRefs: ["budget_policy_protection_v1"], transferPolicyRefs: ["transfer_policy_protection_v1"],
      schedulePolicyRefs: [], actionPolicyRefs: ["guardrail_protection_v1"], creativePolicyRefs: [],
    } })]);
}

function context(options: Readonly<{ evidenceBound?: boolean }> = {}) {
  const input: EffectiveCampaignContextInput = {
    workspaceId, capturedAt: "2026-08-07T12:00:00.000Z",
    identity: {
      connectionRef: "connection-1", accountRef: "account-1", campaignRef: "campaign-1",
      entityRef: "campaign-1", entityType: "campaign", hierarchyRefs: ["campaign-1"],
    },
    meta: {
      objective: { state: "known", value: "lead_generation" },
      optimizationEvent: { state: "known", value: "lead" },
      configuredStatus: { state: "known", value: "ACTIVE" },
      effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: "campaign-1" },
      targetingSignature: { state: "unknown", reason: "not_observed" },
      actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null },
    },
    categories: [category()], guidance: guidance(), policies: [],
    cadence: { profileRef: options.evidenceBound ? "cadence_primary" : "cadence-1", decision: "observe", reason: "stable_window", cooldownUntil: null },
    data: {
      trustStatus: "ready", snapshotRefs: [snapshotRef], featureRefs: [], windowRefs: [], blockers: [],
    },
    history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: {
      metaCatalog: "meta-v1", categoryResolver: "category-v1", guidanceRegistry: "guidance-v1",
      metricCatalog: "metric-v1", formulaCatalog: "formula-v1", timeframeResolver: "timeframe-v1",
      instructionPolicyRegistry: "9".repeat(64),
      promotionRegistry: "8".repeat(64),
    },
  };
  if (!options.evidenceBound) return buildEffectiveCampaignContext(input);
  const snapshot = normalizeMetaAnalysisConfigSnapshotV2({
    version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION, workspaceId, externalAccountId: "account-1",
    capturedAt: "2026-08-07T11:00:00.000Z",
    campaigns: [{ externalCampaignId: "campaign-1", objective: { state: "known", value: "OUTCOME_LEADS" } }],
    adSets: [{ externalAdSetId: "adset-1", externalCampaignId: "campaign-1", optimizationGoal: { state: "known", value: "LEAD_GENERATION" } }],
  });
  return buildEffectiveCampaignContext({ ...input, metaAnalysisConfigEvidence: { snapshot }, cadenceEvidence: {
    profileRevision: 3, profileVersion: DECISION_CADENCE_VERSION, profileHash: "7".repeat(64),
  } });
}

describe("effective campaign context persistence contract", () => {
  it("derives deterministic exact source component/version references", () => {
    const components = sourceComponentsOf(context());
    expect(components).toContainEqual({
      componentType: "source_snapshot", componentRef: snapshotRef, componentVersion: snapshotRef,
    });
    expect(components).toContainEqual({
      componentType: "category_resolution", componentRef: "dimension-1",
      componentVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(components).toContainEqual({
      componentType: "category_profile", componentRef: "category_profile_protected",
      componentVersion: context().categories[0]?.profileBindings?.[0]?.profileHash,
    });
    expect(components).toContainEqual({
      componentType: "metric_catalog", componentRef: "metric-catalog", componentVersion: "metric-v1",
    });
    expect(components).toContainEqual({ componentType: "instruction_policy",
      componentRef: "instruction-policy-registry", componentVersion: "9".repeat(64) });
    expect(components).toContainEqual({ componentType: "promotion_registry",
      componentRef: "promotion_registry_workspace", componentVersion: "8".repeat(64) });
    expect(sourceComponentsOf(context())).toEqual(components);
  });

  it("adds an exact business-outcome evidence source component for selective head invalidation", async () => {
    const { buildBusinessOutcomeEvidence } = await import("@/analyses/business-outcome-evidence");
    const evidence = buildBusinessOutcomeEvidence({ entityRef: "campaign_primary", sourceHeadHash: "a".repeat(64),
      windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-07T00:00:00.000Z", materializedAt: "2026-08-07T12:00:00.000Z", signals: [] });
    const existing = context(); const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...input } = existing;
    const frozen = buildEffectiveCampaignContext({ ...input, history: { ...input.history, outcomeEvidence: [evidence] } });
    expect(sourceComponentsOf(frozen)).toContainEqual({ componentType: "business_outcome_evidence", componentRef: "campaign_primary", componentVersion: "a".repeat(64) });
  });

  it("binds Meta config and cadence evidence to exact top-level values and source components", () => {
    const frozen = context({ evidenceBound: true });
    expect(frozen.metaAnalysisConfigEvidence?.snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(frozen.cadenceEvidence).toEqual({ profileRevision: 3, profileVersion: DECISION_CADENCE_VERSION, profileHash: "7".repeat(64) });
    expect(sourceComponentsOf(frozen)).toContainEqual({ componentType: "cadence_profile", componentRef: "cadence_primary", componentVersion: "7".repeat(64) });

    const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...input } = frozen;
    expect(() => buildEffectiveCampaignContext({ ...input, meta: { ...input.meta,
      objective: { state: "known", value: "sales" },
    } })).toThrowError(expect.objectContaining({ code: "inauthentic_component" }));
  });

  it("rejects an inauthentic context before opening a database transaction", async () => {
    const database = { transaction: vi.fn() };
    const repository = new DrizzleEffectiveCampaignContextRepository(database as never);
    await expect(repository.save({ ...context(), contextHash: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "invalid_input" } satisfies Partial<EffectiveCampaignContextRepositoryError>);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("requires both frozen evidence families only for explicit evidence-bound persistence", async () => {
    const database = { transaction: vi.fn() };
    const repository = new DrizzleEffectiveCampaignContextRepository(database as never);
    await expect(repository.save(context(), { mode: "evidence_bound" }))
      .rejects.toMatchObject({ code: "invalid_input" } satisfies Partial<EffectiveCampaignContextRepositoryError>);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects a newly persisted legacy payload while old v1 replay remains buildable", async () => {
    const current = context();
    const { schemaVersion: _schema, contextHash: _contextHash, capabilities: _capabilities,
      ...currentInput } = current;
    const { instructionPolicyRegistry: _policy, promotionRegistry: _promotion, ...legacyVersions } = current.versions;
    const legacy = buildEffectiveCampaignContext({ ...currentInput, versions: legacyVersions });
    expect(legacy.versions).not.toHaveProperty("instructionPolicyRegistry");
    expect(sourceComponentsOf(legacy).some((component) => component.componentType === "instruction_policy")).toBe(false);
    expect(sourceComponentsOf(legacy).some((component) => component.componentType === "promotion_registry")).toBe(false);

    const executeResults = [{ rows: [{ id: workspaceId }] }, { rows: [{
      metaConnectionId: "00000000-0000-0000-0000-000000000201",
      adAccountId: "00000000-0000-0000-0000-000000000202",
      campaignId: "00000000-0000-0000-0000-000000000203",
    }] }];
    const select = vi.fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => [{ publicRef: snapshotRef,
        capturedAt: new Date("2026-08-07T11:00:00.000Z") }]) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) });
    const transaction = { execute: vi.fn(async () => executeResults.shift()), select };
    const database = { transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    await expect(new DrizzleEffectiveCampaignContextRepository(database as never).save(legacy))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("keeps the generated migration create-only, private and source-scope indexed", () => {
    const migration = readFileSync("drizzle/20260807134751_handy_nekra.sql", "utf8");
    for (const table of [
      "effective_campaign_contexts",
      "effective_campaign_context_components",
      "effective_campaign_context_invalidations",
    ]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM PUBLIC, anon, authenticated`);
    }
    expect(migration).toContain("effective_campaign_context_components_lookup_idx");
    expect(migration).toContain("effective_campaign_context_components_context_scope_fk");
    expect(migration.indexOf("effective_campaign_contexts_workspace_id_unique"))
      .toBeLessThan(migration.indexOf("effective_campaign_context_components_context_scope_fk"));
    for (const [indexName, foreignKeyName] of [
      ["meta_connections_workspace_id_unique", "effective_campaign_contexts_connection_scope_fk"],
      ["ad_accounts_workspace_id_unique", "effective_campaign_contexts_account_scope_fk"],
      ["ad_campaigns_workspace_id_unique", "effective_campaign_contexts_campaign_scope_fk"],
    ]) {
      expect(migration.indexOf(indexName!)).toBeLessThan(migration.indexOf(foreignKeyName!));
    }
    expect(migration).toContain("effective_campaign_contexts_payload_scope_exact");
    expect(migration).toContain("effective_campaign_contexts_no_authority");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
    expect(migration).not.toContain("DROP CONSTRAINT");
  });

  it("makes A09 policy composition source-bound, append-only and legacy-optional", () => {
    const migration = readFileSync("drizzle/20260810190000_effective_context_policy_composition.sql", "utf8");
    const repository = readFileSync("src/connectors/analyses/effective-campaign-context-drizzle-repository.ts", "utf8");
    for (const table of ["effective_campaign_policy_compositions", "effective_campaign_policy_composition_items"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("effective_campaign_policy_compositions_context_scope_fk");
    expect(migration).toContain("effective_campaign_policy_compositions_workspace_id_unique");
    expect(migration).toContain("effective_campaign_policy_composition_items_revision_scope_fk");
    expect(migration).toContain("effective_campaign_policy_composition_immutable");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/);
    expect(repository).toContain("policy_authority_bindings binding");
    expect(repository).toContain("snapshot.snapshot_ref = ${evidence.snapshotRef}");
    expect(repository).toContain("snapshot.snapshot_payload #>> '{policyAuthority,scope,scopeHash}' = ${evidence.scopeHash}");
    expect(repository).toContain("catalog.revision_hash = ${evidence.catalogHash}");
    expect(repository).toContain("catalog.payload #>> '{instructionPolicyRegistryHash}' = ${context.versions.instructionPolicyRegistry}");
    expect(repository).not.toContain("tenant_authority_snapshot_heads head");
    expect(repository).toContain("if (current.has(row.policy_ref)) throw new EffectiveCampaignContextRepositoryError");
    expect(repository).toContain("if (evidence === undefined) return null");
    expect(repository).not.toContain("order by policy_ref, policy_version desc");
  });
});
