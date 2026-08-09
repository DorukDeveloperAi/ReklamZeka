import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import type { InstructionPolicyLifecycleState, InstructionPolicyPublicRevision } from "@/application/instruction-policy-lifecycle-service";
import {
  composeTrustedPolicyContext,
  createFrozenPolicyManualLock,
  createPolicyScopeSnapshot,
  createTrustedPolicyCatalog,
  VALIDATED_META_OBJECTIVE_MAPPING_HASH,
  TrustedPolicyCompositionError,
  type TrustedPolicyBinding,
} from "@/application/trusted-policy-composition";
import { bindCategoryProfiles, createCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { resolveEffectiveCategory, type FrozenCategoryContext } from "@/domain/categories/registry";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";
import { parseStrictInstructionPolicy, type StrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";
import { META_OBJECTIVE_MAPPING_VERSION, type CanonicalMetaObjective } from "@/domain/meta/objective-mapping";

const workspaceId = "workspace-db";
const workspaceRef = "workspace_primary";
const capturedAt = "2026-08-09T12:00:00.000Z";
const rawText = "Bütçe kararını güvenli sınırlar içinde tut.";
const rawTextHash = createHash("sha256").update(rawText).digest("hex");

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

function policy(policyRef: string, status: "draft" | "published" | "paused" | "archived", policyVersion: number,
  previousVersionHash: string | null, priority = 10, internalCategoryRefs: readonly string[] = []): StrictInstructionPolicy {
  return parseStrictInstructionPolicy({
    dslVersion: "strict-instruction-policy/1.0.0", workspaceRef, policyRef, policyVersion, previousVersionHash,
    policyType: "preference", owner: { actorRef: "actor_owner", role: "owner" }, status,
    reasonCode: status === "draft" ? "normalized" : status, priority,
    effectiveDates: { from: "2026-08-01T00:00:00.000Z", until: null },
    scope: { global: internalCategoryRefs.length === 0, accountGroupRefs: [], accountRefs: [], objectiveRefs: [],
      internalCategoryRefs, entities: [], topicRefs: [] },
    source: { rawProvenanceRef: `provenance_${policyRef.slice("policy_".length)}`, rawTextHash,
      promotedFromGuidanceRefs: [] },
    clause: { kind: "preference", subjectRef: "subject_budget_direction", preferredRefs: ["option_hold"],
      weightBasisPoints: 5_000 },
  });
}

function revision(policy: StrictInstructionPolicy, recordedAt: string): InstructionPolicyPublicRevision {
  return { policy, rawProvenance: { provenanceRef: policy.source.rawProvenanceRef, rawText, rawTextHash,
    capturedByActorRef: "actor_owner", capturedAt: "2026-08-09T09:00:00.000Z" }, recordedAt };
}

function lifecycle(entries: readonly Readonly<{ policyRef: string; status?: "published" | "paused" | "archived";
  priority?: number; internalCategoryRefs?: readonly string[] }>[]): InstructionPolicyLifecycleState {
  const history: InstructionPolicyPublicRevision[] = [];
  for (const entry of entries) {
    const draft = policy(entry.policyRef, "draft", 1, null, entry.priority, entry.internalCategoryRefs);
    const current = policy(entry.policyRef, entry.status ?? "published", 2, draft.canonicalHash, entry.priority,
      entry.internalCategoryRefs);
    history.push(revision(draft, "2026-08-09T09:00:00.000Z"), revision(current, "2026-08-09T10:00:00.000Z"));
  }
  history.sort((left, right) => left.policy.policyRef.localeCompare(right.policy.policyRef)
    || left.policy.policyVersion - right.policy.policyVersion);
  const current = history.filter((entry) => entry.policy.policyVersion === 2);
  return { registryHash: digest(current.map((entry) => ({ policyRef: entry.policy.policyRef,
    policyVersion: entry.policy.policyVersion, canonicalHash: entry.policy.canonicalHash, status: entry.policy.status }))),
    current, history, diffs: entries.map((entry) => ({ policyRef: entry.policyRef, fromVersion: 1, toVersion: 2,
      changedPaths: ["status"] })) };
}

function category(withProfile = false): FrozenCategoryContext {
  const resolved = resolveEffectiveCategory({
    dimension: { id: "dimension_type", workspaceId, key: "campaign_type", version: 1, cardinality: "single",
      allowedEntityLevels: ["campaign"], archivedAt: null },
    definitions: [{ id: "definition_evergreen", workspaceId, dimensionId: "dimension_type", key: "evergreen",
      label: "Evergreen", version: 1, archivedAt: null }],
    assignments: [{ id: "assignment_evergreen", workspaceId, dimensionId: "dimension_type",
      definitionId: "definition_evergreen", entity: { level: "campaign", id: "campaign_primary" }, operation: "add",
      source: "manual", manualLock: true, evidence: [{ kind: "owner", ref: "evidence_owner" }], confidence: 1,
      version: 1, archivedAt: null }],
    path: { workspaceId, nodes: [{ level: "campaign", id: "campaign_primary" }] },
  }).frozenContext;
  if (!withProfile) return resolved;
  return bindCategoryProfiles(resolved, [createCategoryProfile({ workspaceRef, profileRef: "category_profile_evergreen",
    categoryRef: categoryDefinitionPublicRef("campaign_type", "evergreen"), parentCategoryRef: null,
    label: "Evergreen", description: "Always-on campaign", color: "#112233", ownerRef: "actor_owner", status: "active",
    bindings: { analysisPlaybookRefs: ["analysis_playbook_evergreen"], ruleInstructionBundleRefs: ["instruction_bundle_evergreen"],
      budgetPolicyRefs: [], transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] } })]);
}

function guidance() {
  const registry = createGuidanceRegistry({ workspaceId,
    sources: [{ id: "source_owner", workspaceId, sourceType: "owner_statement", title: "Owner", sourceRef: "owner:1",
      sourceUrl: null, content: "Bütçeyi koru", author: "owner", capturedAt: "2026-08-01T00:00:00.000Z",
      reviewedAt: "2026-08-02T00:00:00.000Z", reviewBy: null, status: "published", version: 1 }],
    cards: [], sets: [], bindings: [] });
  return buildEffectiveGuidancePack(registry, { workspaceId, accountId: "account_primary", objective: "lead_generation",
    internalCategoryIds: ["definition_evergreen"], entity: { type: "campaign", id: "campaign_primary" }, topics: [],
    requiredTopics: [], evaluatedAt: capturedAt, budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 } });
}

function baseContext(withProfile = false): EffectiveCampaignContextInput {
  return { workspaceId, capturedAt, identity: { connectionRef: "connection_primary", accountRef: "account_primary",
    campaignRef: "campaign_primary", entityRef: "campaign_primary", entityType: "campaign", hierarchyRefs: ["campaign_primary"] },
  meta: { objective: { state: "known", value: "lead_generation" }, optimizationEvent: { state: "known", value: "lead" },
    configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
    budgetOwnerRef: { state: "known", value: "campaign_primary" }, targetingSignature: { state: "unknown", reason: "not_observed" },
    actorRef: { state: "known", value: "actor_primary" }, destinationRef: { state: "known", value: null } },
  categories: [category(withProfile)], guidance: guidance(), policies: [],
  cadence: { profileRef: "cadence_primary", decision: "no_change", reason: "stable", cooldownUntil: null },
  data: { trustStatus: "ready", snapshotRefs: ["snapshot_primary"], featureRefs: [], windowRefs: [], blockers: [] },
  history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
  versions: { metaCatalog: "meta-v1", categoryResolver: "category-v1", guidanceRegistry: "guidance-v1",
    metricCatalog: "metric-v1", formulaCatalog: "formula-v1", timeframeResolver: "timeframe-v1" } };
}

function binding(current: InstructionPolicyPublicRevision, authorityTier: TrustedPolicyBinding["authorityTier"],
  positionKey: string, extra: Partial<Pick<TrustedPolicyBinding, "categoryProfileRef" | "categoryProfileVersion"
    | "categoryProfileHash" | "manualLockRef">> = {}): TrustedPolicyBinding {
  return { policyRef: current.policy.policyRef, policyVersion: current.policy.policyVersion,
    policyHash: current.policy.canonicalHash, authorityTier,
    decision: { decisionKey: "budget_direction", positionKey }, categoryProfileRef: extra.categoryProfileRef ?? null,
    categoryProfileVersion: extra.categoryProfileVersion ?? null, categoryProfileHash: extra.categoryProfileHash ?? null,
    manualLockRef: extra.manualLockRef ?? null };
}

function scope(canonicalObjective: CanonicalMetaObjective | null = "lead_generation", objectiveRefs = ["objective_leads"]) {
  return createPolicyScopeSnapshot({ workspaceRef, evaluatedAt: capturedAt,
    accountGroupRefs: ["account_group_primary"], objectiveRefs, topicRefs: ["topic_budget"], canonicalObjective });
}

describe("trusted policy frozen-context composition", () => {
  it("projects exact published resolver trace and registry identity without raw material or authority", () => {
    const state = lifecycle([{ policyRef: "policy_metric" }, { policyRef: "policy_safety" }]);
    const byRef = new Map(state.current.map((entry) => [entry.policy.policyRef, entry] as const));
    const catalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_primary", catalogVersion: 1,
      instructionPolicyRegistryHash: state.registryHash, bindings: [
        binding(byRef.get("policy_metric")!, "metric_rule", "increase"),
        binding(byRef.get("policy_safety")!, "system_hard_safety", "hold"),
      ] });
    const result = composeTrustedPolicyContext({ baseContext: baseContext(), workspaceRef, lifecycle: state, catalog,
      scope: scope(), manualLocks: [] });
    expect(result.context.versions.instructionPolicyRegistry).toBe(state.registryHash);
    expect(result.context.policies).toEqual([
      { policyRef: "policy_metric", state: "suppressed", reason: "suppressed_by_higher_precedence" },
      { policyRef: "policy_safety", state: "applied", reason: "applied" },
    ]);
    expect(result.resolution.suppressed[0]).toMatchObject({ policyRef: "policy_metric", byPolicyRef: "policy_safety" });
    expect(JSON.stringify(result)).not.toContain(rawText);
    expect(result.authority).toEqual({ canExecute: false, canWriteMeta: false, canApprove: false, canSchedule: false,
      canCallTool: false, canAccessNetwork: false, canQuerySql: false });
    expect(result.evidence).toMatchObject({ validatedCatalogHash: catalog.catalogHash,
      objectiveMappingVersion: META_OBJECTIVE_MAPPING_VERSION,
      objectiveMappingHash: VALIDATED_META_OBJECTIVE_MAPPING_HASH, canonicalObjective: "lead_generation" });
    expect(result.validationBoundary).toEqual({ contractIntegrity: "self_hash_validated",
      productionAuthoritySourceBound: false });
  });

  it("keeps an equal-precedence semantic conflict parked in the frozen context", () => {
    const state = lifecycle([{ policyRef: "policy_first" }, { policyRef: "policy_second" }]);
    const catalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_conflict", catalogVersion: 1,
      instructionPolicyRegistryHash: state.registryHash, bindings: [binding(state.current[0]!, "metric_rule", "increase"),
        binding(state.current[1]!, "metric_rule", "decrease")] });
    const result = composeTrustedPolicyContext({ baseContext: baseContext(), workspaceRef, lifecycle: state, catalog,
      scope: scope(), manualLocks: [] });
    expect(result.resolution.state).toBe("PARKED_CONFLICT");
    expect(result.context.policies).toEqual([
      { policyRef: "policy_first", state: "parked_conflict", reason: "parked_conflict" },
      { policyRef: "policy_second", state: "parked_conflict", reason: "parked_conflict" },
    ]);
  });

  it("requires exact current lifecycle revision, registry hash and unambiguous trusted binding", () => {
    const state = lifecycle([{ policyRef: "policy_metric" }]); const current = state.current[0]!;
    const catalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_primary", catalogVersion: 1,
      instructionPolicyRegistryHash: state.registryHash, bindings: [binding(current, "metric_rule", "hold")] });
    const compose = (overrides: Partial<Parameters<typeof composeTrustedPolicyContext>[0]> = {}) =>
      composeTrustedPolicyContext({ baseContext: baseContext(), workspaceRef, lifecycle: state, catalog,
        scope: scope(), manualLocks: [], ...overrides });
    expect(() => compose({ lifecycle: { ...state, registryHash: "f".repeat(64) } }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "inauthentic_lifecycle" }));
    expect(() => compose({ lifecycle: { ...state, current: [{ ...current,
      policy: { ...current.policy, canonicalHash: "e".repeat(64) } }] } }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "inauthentic_lifecycle" }));
    expect(() => createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_primary", catalogVersion: 1,
      instructionPolicyRegistryHash: state.registryHash, bindings: [binding(current, "metric_rule", "hold"),
        binding(current, "metric_rule", "increase")] }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "ambiguous_binding" }));
    expect(() => compose({ catalog: { ...catalog, catalogHash: "d".repeat(64) } }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "inauthentic_catalog" }));
  });

  it("fails closed for cross-tenant, stale, paused/archived and mismatched frozen-path inputs", () => {
    const state = lifecycle([{ policyRef: "policy_metric" }]); const current = state.current[0]!;
    const catalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_primary", catalogVersion: 1,
      instructionPolicyRegistryHash: state.registryHash, bindings: [binding(current, "metric_rule", "hold")] });
    const valid = { baseContext: baseContext(), workspaceRef, lifecycle: state, catalog, scope: scope(), manualLocks: [] } as const;
    expect(() => composeTrustedPolicyContext({ ...valid, workspaceRef: "workspace_other" }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "inauthentic_lifecycle" }));
    for (const status of ["paused", "archived"] as const) {
      const inactive = lifecycle([{ policyRef: "policy_metric", status }]);
      expect(() => composeTrustedPolicyContext({ ...valid, lifecycle: inactive }))
        .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "stale_binding" }));
      const inactiveCatalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: `policy_catalog_${status}`, catalogVersion: 2,
        instructionPolicyRegistryHash: inactive.registryHash,
        bindings: [binding(inactive.current[0]!, "metric_rule", "hold")] });
      expect(() => composeTrustedPolicyContext({ ...valid, lifecycle: inactive, catalog: inactiveCatalog }))
        .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "stale_binding" }));
    }
    const wrongPath = baseContext();
    expect(() => composeTrustedPolicyContext({ ...valid, baseContext: { ...wrongPath,
      categories: [{ ...wrongPath.categories[0]!, path: [{ level: "campaign", id: "campaign_other" }] }] } }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "scope_mismatch" }));
  });

  it("binds canonical objective evidence to the frozen Meta objective and reviewed mapping catalog", () => {
    const state = lifecycle([{ policyRef: "policy_metric" }]); const current = state.current[0]!;
    const catalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_objective", catalogVersion: 1,
      instructionPolicyRegistryHash: state.registryHash, bindings: [binding(current, "metric_rule", "hold")] });
    const valid = { baseContext: baseContext(), workspaceRef, lifecycle: state, catalog, manualLocks: [] } as const;
    expect(() => composeTrustedPolicyContext({ ...valid, scope: scope("sales") }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "scope_mismatch" }));
    const mapped = scope();
    expect(() => composeTrustedPolicyContext({ ...valid, scope: { ...mapped,
      objectiveEvidence: { ...mapped.objectiveEvidence, mappingHash: "a".repeat(64) } } }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "inauthentic_scope" }));

    const unknown = baseContext();
    const unknownBase = { ...unknown, meta: { ...unknown.meta,
      objective: { state: "unknown" as const, reason: "not_observed" } } };
    expect(() => composeTrustedPolicyContext({ ...valid, baseContext: unknownBase, scope: scope() }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "scope_mismatch" }));
    expect(() => composeTrustedPolicyContext({ ...valid, baseContext: unknownBase,
      scope: scope(null, ["objective_leads"]) }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "scope_mismatch" }));
  });

  it("requires exact current manual-lock proof and frozen CategoryProfile identity", () => {
    const state = lifecycle([{ policyRef: "policy_locked" }]); const current = state.current[0]!;
    const catalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_locked", catalogVersion: 1,
      instructionPolicyRegistryHash: state.registryHash, bindings: [binding(current, "user_locked_instruction", "hold",
        { manualLockRef: "policy_lock_primary" })] });
    const valid = { baseContext: baseContext(), workspaceRef, lifecycle: state, catalog, scope: scope() } as const;
    expect(() => composeTrustedPolicyContext({ ...valid, manualLocks: [] }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "missing_manual_lock" }));
    const lock = createFrozenPolicyManualLock({ workspaceRef, lockRef: "policy_lock_primary", policyRef: current.policy.policyRef,
      policyVersion: current.policy.policyVersion, policyHash: current.policy.canonicalHash, evaluatedAt: capturedAt });
    expect(composeTrustedPolicyContext({ ...valid, manualLocks: [lock] }).resolution.applied[0]?.policyRef)
      .toBe("policy_locked");
    expect(() => composeTrustedPolicyContext({ ...valid, manualLocks: [{ ...lock, lockHash: "a".repeat(64) }] }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "inauthentic_manual_lock" }));

    const categoryState = lifecycle([{ policyRef: "policy_category",
      internalCategoryRefs: [categoryDefinitionPublicRef("campaign_type", "evergreen")] }]);
    const categoryPolicy = categoryState.current[0]!;
    const frozenProfile = baseContext(true).categories[0]!.profileBindings![0]!;
    const categoryCatalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_category", catalogVersion: 1,
      instructionPolicyRegistryHash: categoryState.registryHash,
      bindings: [binding(categoryPolicy, "internal_category_playbook", "hold",
        { categoryProfileRef: frozenProfile.profileRef, categoryProfileVersion: frozenProfile.profileVersion,
          categoryProfileHash: frozenProfile.profileHash })] });
    expect(() => composeTrustedPolicyContext({ baseContext: baseContext(), workspaceRef, lifecycle: categoryState,
      catalog: categoryCatalog, scope: scope(), manualLocks: [] }))
      .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "stale_binding" }));
    expect(composeTrustedPolicyContext({ baseContext: baseContext(true), workspaceRef, lifecycle: categoryState,
      catalog: categoryCatalog, scope: scope(), manualLocks: [] }).evidence.categoryResolutionHashes).toHaveLength(1);
    for (const staleBinding of [
      { categoryProfileVersion: frozenProfile.profileVersion + 1, categoryProfileHash: frozenProfile.profileHash },
      { categoryProfileVersion: frozenProfile.profileVersion, categoryProfileHash: "b".repeat(64) },
    ]) {
      const staleCatalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: "policy_catalog_category_stale",
        catalogVersion: 2, instructionPolicyRegistryHash: categoryState.registryHash,
        bindings: [binding(categoryPolicy, "internal_category_playbook", "hold", {
          categoryProfileRef: frozenProfile.profileRef, ...staleBinding })] });
      expect(() => composeTrustedPolicyContext({ baseContext: baseContext(true), workspaceRef, lifecycle: categoryState,
        catalog: staleCatalog, scope: scope(), manualLocks: [] }))
        .toThrowError(expect.objectContaining<Partial<TrustedPolicyCompositionError>>({ code: "stale_binding" }));
    }
  });
});
