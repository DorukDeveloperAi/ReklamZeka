import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { META_INSIGHT_CAPABILITY_CATALOG_VERSION } from "@/domain/meta/insights/capability-catalog";
import { META_METRIC_FORMULA_CATALOG_VERSION } from "@/domain/meta/insights/metric-engine";
import { TIMEFRAME_RESOLVER_VERSION } from "@/analyses/timeframe-resolver";
import { CATEGORY_PROFILE_VERSION } from "@/domain/categories/category-profile";
import type { EffectiveAnalysisContextFacts, EffectiveAnalysisContextRequest,
  EffectiveAnalysisContextSource, EffectiveAnalysisContextReadySource, RepositoryVerifiedAuthority } from "@/application/effective-analysis-context-composer";
import { DrizzleCurrentCategoryCompositionReader, resolveCurrentCategoryCompositionInSnapshot,
  type CurrentCategoryComposition } from "@/application/current-category-composition-resolver";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { buildEffectiveGuidancePack, type EffectiveGuidancePack } from "@/domain/guidance/registry";
import { projectMetaAnalysisConfig } from "@/domain/meta/analysis-config-projection";
import type { CategoryHierarchyTarget } from "@/domain/categories/service";
import { CurrentDecisionCadenceReader, type CurrentDecisionCadence } from "@/connectors/decisions/current-decision-cadence-reader";
import { CurrentReviewedGuidanceReader, type CurrentReviewedGuidanceManifest } from "@/connectors/guidance/current-reviewed-guidance-reader";
import { CurrentGuidanceCampaignSelectionReader } from "@/connectors/guidance/current-guidance-campaign-selection-reader";
import type { GuidanceCampaignSelection } from "@/connectors/guidance/guidance-campaign-selection-drizzle-repository";
import { CurrentMetaHierarchyConfigReader, type CurrentMetaHierarchyConfig } from "@/connectors/meta/current-meta-hierarchy-config-reader";
import { DrizzleInstructionPolicyLifecycleRepository } from "@/connectors/policies/instruction-policy-lifecycle-drizzle-repository";
import { DrizzleTrustedPolicyAuthorityRepository, type LoadedTrustedPolicyAuthority } from "@/connectors/policies/trusted-policy-authority-drizzle-repository";
import { DrizzlePromotionTemplateLifecycleRepository } from "@/connectors/meta/promotion/promotion-template-lifecycle-drizzle-repository";
import type { PromotionTemplateLifecycleState } from "@/application/promotion-template-lifecycle-service";
import type { InstructionPolicyLifecycleState } from "@/application/instruction-policy-lifecycle-service";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_REF = /^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$/;

function rows(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new Error("invalid_store_result");
  }
  return value.rows as readonly Readonly<Record<string, unknown>>[];
}

function inputIsValid(input: EffectiveAnalysisContextRequest): boolean {
  return UUID.test(input.workspaceId) && input.accountRef.trim().length > 0 && input.entityRef.trim().length > 0
    && ["campaign", "ad_set", "ad", "creative"].includes(input.entityType);
}

export type CurrentCategoryCompositionSnapshotResolver = Readonly<{
  resolveInTransaction(transaction: Database, workspaceRef: string, workspaceId: string,
    target: CategoryHierarchyTarget): Promise<CurrentCategoryComposition>;
}>;

type CurrentInstructionPolicyLifecycleSnapshotReader = Readonly<{
  inspectInTransaction(transaction: Database, workspaceId: string, capturedAt: string): Promise<InstructionPolicyLifecycleState>;
}>;

type CurrentTrustedPolicyAuthoritySnapshotReader = Readonly<{
  loadInTransaction(transaction: Database, input: Readonly<{ workspaceId: string; accountRef: string;
    evaluatedAt: string }>): Promise<LoadedTrustedPolicyAuthority>;
}>;

type CurrentPromotionRegistrySnapshotReader = Readonly<{
  inspectInTransaction(transaction: Pick<Database, "execute">, workspaceId: string): Promise<PromotionTemplateLifecycleState>;
}>;

const currentCategoryCompositionSnapshotResolver: CurrentCategoryCompositionSnapshotResolver = Object.freeze({
  resolveInTransaction: (transaction, workspaceRef, workspaceId, target) =>
    resolveCurrentCategoryCompositionInSnapshot(
      DrizzleCurrentCategoryCompositionReader.inTransaction(transaction, workspaceRef), workspaceId, target),
});

const UNKNOWN_META = Object.freeze({ state: "unknown" as const, reason: "not_available_in_current_hierarchy" });

function cadenceFacts(cadence: CurrentDecisionCadence): EffectiveAnalysisContextFacts["cadence"] {
  const decision = cadence.decision.reason === "eligible" ? "eligible" : cadence.decision.disposition;
  if (decision !== "eligible" && decision !== "observe" && decision !== "no_change" && decision !== "blocked") {
    throw new Error("cadence_unavailable");
  }
  return Object.freeze({ profileRef: cadence.profileRef, decision, reason: cadence.decision.reason,
    cooldownUntil: cadence.decision.nextEligibleAt });
}

/**
 * Converts only repository-verified values from the single source snapshot to
 * the composer bundle. Data deliberately remains unready until an analysis
 * window is bound; its sole reference is the public Meta source snapshot.
 */
export function buildReadyEffectiveAnalysisContextSourceInSnapshot(input: Readonly<{
  request: EffectiveAnalysisContextRequest;
  capturedAt: string;
  hierarchy: CurrentMetaHierarchyConfig;
  categoryTarget: CategoryHierarchyTarget;
  categories: CurrentCategoryComposition;
  guidance: EffectiveGuidancePack;
  cadence: CurrentDecisionCadence;
  lifecycle: InstructionPolicyLifecycleState;
  authority: LoadedTrustedPolicyAuthority;
  promotion: PromotionTemplateLifecycleState;
}>): EffectiveAnalysisContextReadySource {
  const { request, capturedAt, hierarchy, categoryTarget, categories, guidance, cadence, lifecycle, authority, promotion } = input;
  if (hierarchy.capturedAt !== capturedAt || hierarchy.identity.accountRef !== request.accountRef
    || hierarchy.identity.hierarchyRefs.at(-1) !== request.entityRef || categories.workspaceId !== request.workspaceId
    || categories.dimensions.length === 0 || categories.dimensions.some((dimension) => dimension.frozenContext.path.at(-1)?.id !== categoryTarget.id)
    || guidance.workspaceId !== request.workspaceId || guidance.evaluatedAt !== capturedAt
    || cadence.decision.evaluatedAt !== capturedAt || !/^[a-f0-9]{64}$/.test(lifecycle.registryHash)
    || !/^[a-f0-9]{64}$/.test(promotion.registryHash)
    || authority.authoritySnapshot.workspaceId !== request.workspaceId
    || !Number.isFinite(Date.parse(authority.scope.evaluatedAt))
    || new Date(authority.scope.evaluatedAt).toISOString() !== authority.scope.evaluatedAt
    || Date.parse(authority.scope.evaluatedAt) > Date.parse(capturedAt)
    || authority.authoritySnapshot.verifiedAt > capturedAt || authority.authoritySnapshot.expiresAt <= capturedAt
    || authority.catalog.instructionPolicyRegistryHash !== lifecycle.registryHash) throw new Error("current_source_bundle_unavailable");
  const facts: EffectiveAnalysisContextFacts = Object.freeze({
    identity: hierarchy.identity,
    meta: Object.freeze({ configuredStatus: UNKNOWN_META, effectiveStatus: UNKNOWN_META, budgetOwnerRef: UNKNOWN_META,
      targetingSignature: UNKNOWN_META, actorRef: UNKNOWN_META, destinationRef: UNKNOWN_META }),
    metaAnalysisConfigSnapshot: hierarchy.metaAnalysisConfigSnapshot,
    guidance,
    cadence: cadenceFacts(cadence),
    cadenceEvidence: Object.freeze({ profileRevision: cadence.profileRevision, profileVersion: cadence.profileVersion, profileHash: cadence.profileHash }),
    data: Object.freeze({ trustStatus: "not_ready" as const, snapshotRefs: Object.freeze([hierarchy.sourceSnapshotEvidence.publicRef]),
      featureRefs: Object.freeze([]), windowRefs: Object.freeze([]), blockers: Object.freeze(["analysis_window_not_bound"]) }),
    history: Object.freeze({ changeRefs: Object.freeze([]), decisionRefs: Object.freeze([]), experimentRefs: Object.freeze([]),
      practiceRefs: Object.freeze([]), outcomeRefs: Object.freeze([]) }),
    versions: Object.freeze({ metaCatalog: hierarchy.metaAnalysisConfigSnapshot.version, categoryResolver: CATEGORY_PROFILE_VERSION,
      guidanceRegistry: guidance.registryHash, metricCatalog: META_INSIGHT_CAPABILITY_CATALOG_VERSION,
      formulaCatalog: META_METRIC_FORMULA_CATALOG_VERSION, timeframeResolver: TIMEFRAME_RESOLVER_VERSION,
      promotionRegistry: promotion.registryHash }),
  });
  const source: EffectiveAnalysisContextReadySource = Object.freeze({ status: "ready", capturedAt, facts,
    categories: Object.freeze({ workspaceId: categories.workspaceId, target: categoryTarget, dimensions: categories.dimensions.map((dimension) =>
      Object.freeze({ frozenContext: dimension.frozenContext })) }), lifecycle,
    authority: authority as RepositoryVerifiedAuthority });
  // Prove all pre-authority evidence is already a valid persistence payload.
  const projection = projectMetaAnalysisConfig(facts.metaAnalysisConfigSnapshot, facts.identity.campaignRef);
  buildEffectiveCampaignContext({ workspaceId: request.workspaceId, capturedAt, identity: { connectionRef: facts.identity.connectionRef,
    accountRef: request.accountRef, campaignRef: facts.identity.campaignRef, entityRef: request.entityRef,
    entityType: request.entityType, hierarchyRefs: facts.identity.hierarchyRefs }, meta: { ...facts.meta,
    objective: projection.objective, optimizationEvent: projection.optimizationEvent },
  metaAnalysisConfigEvidence: { snapshot: facts.metaAnalysisConfigSnapshot }, categories: source.categories.dimensions.map((entry) => entry.frozenContext),
  guidance: facts.guidance, policies: [], cadence: facts.cadence, cadenceEvidence: facts.cadenceEvidence,
  data: facts.data, history: facts.history, versions: facts.versions });
  return source;
}

function categoryTarget(input: EffectiveAnalysisContextRequest, hierarchy: CurrentMetaHierarchyConfig): CategoryHierarchyTarget {
  const path = hierarchy.identity.hierarchyRefs;
  const expectedDepth = { campaign: 1, ad_set: 2, ad: 3, creative: 4 }[input.entityType];
  if (path.length !== expectedDepth || path[0] !== hierarchy.identity.campaignRef || path.at(-1) !== input.entityRef) {
    throw new Error("corrupt_store");
  }
  if (input.entityType === "creative") {
    const viaAdId = path[2];
    if (!viaAdId) throw new Error("corrupt_store");
    return Object.freeze({ level: "creative", id: input.entityRef, viaAdId });
  }
  return Object.freeze({ level: input.entityType, id: input.entityRef });
}

/**
 * Category assignments are persisted against internal Meta hierarchy UUIDs,
 * while the immutable hierarchy reader intentionally exposes only external
 * refs. Resolve the complete path in this same RR/RO snapshot and accept
 * exactly one tenant-bound path—never an arbitrary external-ref match.
 */
export async function resolvedCategoryTarget(transaction: Pick<Database, "execute">, workspaceId: string,
  input: EffectiveAnalysisContextRequest, hierarchy: CurrentMetaHierarchyConfig): Promise<CategoryHierarchyTarget> {
  const external = categoryTarget(input, hierarchy);
  const result = input.entityType === "campaign" ? await transaction.execute(sql`
    select campaign.id::text as entity_id from ad_campaigns campaign
    join ad_accounts account on account.workspace_id = campaign.workspace_id and account.id = campaign.ad_account_id
    where campaign.workspace_id = ${workspaceId}::uuid and account.external_account_id = ${input.accountRef}
      and campaign.external_campaign_id = ${external.id} and campaign.disappeared_at is null limit 2
  `) : input.entityType === "ad_set" ? await transaction.execute(sql`
    select ad_set.id::text as entity_id from meta_ad_sets ad_set
    join ad_campaigns campaign on campaign.workspace_id = ad_set.workspace_id and campaign.id = ad_set.campaign_id
    join ad_accounts account on account.workspace_id = campaign.workspace_id and account.id = campaign.ad_account_id
    where ad_set.workspace_id = ${workspaceId}::uuid and account.external_account_id = ${input.accountRef}
      and campaign.external_campaign_id = ${hierarchy.identity.campaignRef} and ad_set.external_ad_set_id = ${external.id}
      and campaign.disappeared_at is null and ad_set.disappeared_at is null limit 2
  `) : input.entityType === "ad" ? await transaction.execute(sql`
    select ad.id::text as entity_id from meta_ads ad
    join meta_ad_sets ad_set on ad_set.workspace_id = ad.workspace_id and ad_set.id = ad.ad_set_id
    join ad_campaigns campaign on campaign.workspace_id = ad_set.workspace_id and campaign.id = ad_set.campaign_id
    join ad_accounts account on account.workspace_id = campaign.workspace_id and account.id = campaign.ad_account_id
    where ad.workspace_id = ${workspaceId}::uuid and account.external_account_id = ${input.accountRef}
      and campaign.external_campaign_id = ${hierarchy.identity.campaignRef} and ad_set.external_ad_set_id = ${hierarchy.identity.hierarchyRefs[1]}
      and ad.external_ad_id = ${external.id} and campaign.disappeared_at is null and ad_set.disappeared_at is null and ad.disappeared_at is null limit 2
  `) : await transaction.execute(sql`
    select creative.id::text as entity_id, ad.id::text as ad_id from meta_creatives creative
    join meta_ads ad on ad.workspace_id = creative.workspace_id and ad.creative_id = creative.id
    join meta_ad_sets ad_set on ad_set.workspace_id = ad.workspace_id and ad_set.id = ad.ad_set_id
    join ad_campaigns campaign on campaign.workspace_id = ad_set.workspace_id and campaign.id = ad_set.campaign_id
    join ad_accounts account on account.workspace_id = campaign.workspace_id and account.id = campaign.ad_account_id
    where creative.workspace_id = ${workspaceId}::uuid and account.external_account_id = ${input.accountRef}
      and campaign.external_campaign_id = ${hierarchy.identity.campaignRef} and ad_set.external_ad_set_id = ${hierarchy.identity.hierarchyRefs[1]}
      and ad.external_ad_id = ${hierarchy.identity.hierarchyRefs[2]} and creative.external_creative_id = ${external.id}
      and campaign.disappeared_at is null and ad_set.disappeared_at is null and ad.disappeared_at is null and creative.disappeared_at is null limit 2
  `);
  const candidates = rows(result);
  if (candidates.length !== 1 || typeof candidates[0]!.entity_id !== "string" || !UUID.test(candidates[0]!.entity_id)) {
    throw new Error("category_hierarchy_unavailable");
  }
  if (input.entityType === "creative") {
    if (typeof candidates[0]!.ad_id !== "string" || !UUID.test(candidates[0]!.ad_id)) throw new Error("category_hierarchy_unavailable");
    return Object.freeze({ level: "creative", id: candidates[0]!.entity_id, viaAdId: candidates[0]!.ad_id });
  }
  return Object.freeze({ level: input.entityType, id: candidates[0]!.entity_id });
}

/**
 * Builds only from evidence already obtained in the caller-owned source
 * snapshot. It never accepts a caller-supplied selection or fallback scope.
 * The surrounding source remains `not_ready` until every other component is
 * transaction-local too.
 */
export function buildSelectedEffectiveGuidancePackInSnapshot(input: Readonly<{
  request: EffectiveAnalysisContextRequest;
  capturedAt: string;
  hierarchy: CurrentMetaHierarchyConfig;
  categories: CurrentCategoryComposition;
  guidance: CurrentReviewedGuidanceManifest;
  selection: GuidanceCampaignSelection;
}>): EffectiveGuidancePack {
  const { request, capturedAt, hierarchy, categories, guidance, selection } = input;
  if (guidance.capturedAt !== capturedAt || guidance.registry.workspaceId !== request.workspaceId
    || guidance.registry.registryHash !== guidance.registryHash || categories.workspaceId !== request.workspaceId) {
    throw new Error("corrupt_store");
  }
  const selected = guidance.reviewedSets.filter((set) => set.setRef === selection.selectedSetRef
    && set.setVersion === selection.selectedSetVersion && set.setHash === selection.selectedSetHash);
  if (selected.length !== 1 || !guidance.registry.sets.some((set) => set.id === selection.selectedSetRef
    && set.version === selection.selectedSetVersion && set.reviewStatus === "reviewed")) {
    throw new Error("guidance_selection_unavailable");
  }
  let meta;
  try { meta = projectMetaAnalysisConfig(hierarchy.metaAnalysisConfigSnapshot, hierarchy.identity.campaignRef); }
  catch { throw new Error("meta_scope_unavailable"); }
  if (meta.externalCampaignId !== hierarchy.identity.campaignRef
    || hierarchy.identity.accountRef !== request.accountRef || hierarchy.identity.hierarchyRefs.at(-1) !== request.entityRef) {
    throw new Error("meta_scope_unavailable");
  }
  const internalCategoryIds = categories.dimensions.flatMap((dimension) => dimension.values.map((definition) =>
    categoryDefinitionPublicRef(dimension.frozenContext.dimension.key, definition.key))).sort();
  if (internalCategoryIds.length === 0 || new Set(internalCategoryIds).size !== internalCategoryIds.length) {
    throw new Error("category_scope_unavailable");
  }
  try {
    const pack = buildEffectiveGuidancePack(guidance.registry, {
      workspaceId: request.workspaceId, accountId: request.accountRef,
      objective: meta.objective.state === "known" ? meta.objective.value : null,
      optimization: meta.optimizationEvent.state === "known" ? meta.optimizationEvent.value : null,
      internalCategoryIds, entity: { type: request.entityType, id: request.entityRef },
      topics: selection.topics, requiredTopics: selection.requiredTopics,
      guidanceSetIds: [selection.selectedSetRef], evaluatedAt: capturedAt, budget: selection.budget,
    });
    if (pack.registryHash !== guidance.registryHash || pack.selectedSets.length !== 1
      || pack.selectedSets[0]!.setId !== selection.selectedSetRef
      || pack.selectedSets[0]!.setVersion !== selection.selectedSetVersion
      || pack.selectedSets[0]!.setHash !== selection.selectedSetHash) throw new Error("guidance_pack_unavailable");
    return pack;
  } catch (error) {
    if (error instanceof Error && error.message === "guidance_pack_unavailable") throw error;
    throw new Error("guidance_pack_unavailable");
  }
}

/**
 * Server-private current-source checkpoint. It proves the active tenant and
 * account scope in one short repeatable/read-only transaction, then deliberately
 * reports not_ready: there is not yet a single transaction-local reader for
 * every config, guidance, data/history, category, lifecycle, and authority
 * component required for a valid context bundle.
 */
export class DrizzleCurrentEffectiveAnalysisContextSourceReader {
  constructor(private readonly database: Database,
    private readonly hierarchyReader: Pick<CurrentMetaHierarchyConfigReader, "readCurrent"> = new CurrentMetaHierarchyConfigReader(),
    private readonly cadenceReader: Pick<CurrentDecisionCadenceReader, "readCurrentInTransaction"> = new CurrentDecisionCadenceReader(database),
    private readonly guidanceReader: Pick<CurrentReviewedGuidanceReader, "readCurrentInTransaction"> = new CurrentReviewedGuidanceReader(),
    private readonly selectionReader: Pick<CurrentGuidanceCampaignSelectionReader, "readCurrentInTransaction"> = new CurrentGuidanceCampaignSelectionReader(),
    private readonly categoryResolver: CurrentCategoryCompositionSnapshotResolver = currentCategoryCompositionSnapshotResolver,
    private readonly lifecycleReader: CurrentInstructionPolicyLifecycleSnapshotReader = new DrizzleInstructionPolicyLifecycleRepository(database),
    private readonly authorityReader: CurrentTrustedPolicyAuthoritySnapshotReader = new DrizzleTrustedPolicyAuthorityRepository(database),
    private readonly promotionReader: CurrentPromotionRegistrySnapshotReader = new DrizzlePromotionTemplateLifecycleRepository(database)) {}

  async loadCurrent(input: EffectiveAnalysisContextRequest): Promise<EffectiveAnalysisContextSource> {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 4
      || !inputIsValid(input)) throw new Error("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      await tx.execute(sql`set transaction isolation level repeatable read, read only`);
      const scope = rows(await tx.execute(sql`
        select to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as captured_at
        from workspaces workspace
        join ad_accounts account on account.workspace_id = workspace.id
          and account.external_account_id = ${input.accountRef}
        where workspace.id = ${input.workspaceId}::uuid and workspace.lifecycle_state = 'active'
        limit 2
      `));
      if (scope.length !== 1 || typeof scope[0]!.captured_at !== "string") throw new Error("scope_not_found");
      const capturedAt = scope[0]!.captured_at;
      if (!Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt) throw new Error("corrupt_store");
      // This is validation only: the broader source bundle remains deliberately unavailable.
      const hierarchy: CurrentMetaHierarchyConfig = await this.hierarchyReader.readCurrent(tx, input);
      if (hierarchy.capturedAt !== capturedAt || hierarchy.identity.accountRef !== input.accountRef
        || hierarchy.identity.hierarchyRefs.at(-1) !== input.entityRef) throw new Error("corrupt_store");
      // This is persisted, validated category profile evidence—not an input
      // from a route or the caller. A non-unique current ref is not trusted.
      const workspaceRefs = rows(await tx.execute(sql`
        select distinct current_profile.workspace_ref
        from (
          select distinct on (profile.category_definition_id)
            profile.category_definition_id, profile.workspace_ref, profile.status
          from category_profile_revisions profile
          where profile.workspace_id = ${input.workspaceId}::uuid
          order by profile.category_definition_id, profile.version desc
        ) current_profile
        join category_definitions definition on definition.workspace_id = ${input.workspaceId}::uuid
          and definition.id = current_profile.category_definition_id and definition.archived_at is null
        where current_profile.status = 'active'
        limit 2
      `));
      if (workspaceRefs.length !== 1 || typeof workspaceRefs[0]!.workspace_ref !== "string"
        || !WORKSPACE_REF.test(workspaceRefs[0]!.workspace_ref)) throw new Error("category_scope_unavailable");
      const resolvedTarget = await resolvedCategoryTarget(tx, input.workspaceId, input, hierarchy);
      const categories = await this.categoryResolver.resolveInTransaction(tx, workspaceRefs[0]!.workspace_ref,
        input.workspaceId, resolvedTarget);
      if (categories.workspaceId !== input.workspaceId || categories.dimensions.length === 0
        || categories.dimensions.some((dimension) => dimension.frozenContext.path.at(-1)?.id !== resolvedTarget.id)) {
        throw new Error("corrupt_store");
      }
      const cadence: CurrentDecisionCadence = await this.cadenceReader.readCurrentInTransaction(tx, {
        workspaceId: input.workspaceId, accountRef: input.accountRef, campaignRef: hierarchy.identity.campaignRef,
      }, capturedAt);
      if (cadence.decision.evaluatedAt !== capturedAt || cadence.decision.actionAuthority !== "none") {
        throw new Error("corrupt_store");
      }
      const guidance: CurrentReviewedGuidanceManifest = await this.guidanceReader.readCurrentInTransaction(
        tx, input.workspaceId, capturedAt,
      );
      if (guidance.capturedAt !== capturedAt || !Array.isArray(guidance.reviewedSets)) throw new Error("corrupt_store");
      const selection: GuidanceCampaignSelection = await this.selectionReader.readCurrentInTransaction(tx, {
        workspaceId: input.workspaceId, accountRef: input.accountRef, campaignRef: hierarchy.identity.campaignRef,
      }, capturedAt);
      if (selection.effectiveAt > capturedAt) throw new Error("corrupt_store");
      // The selected advisory pack is now proven inside this exact snapshot.
      // It is intentionally not surfaced until data/history/lifecycle/authority
      // closure is equally source-bound.
      const pack = buildSelectedEffectiveGuidancePackInSnapshot({ request: input, capturedAt, hierarchy, categories, guidance, selection });
      if (pack.evaluatedAt !== capturedAt) throw new Error("guidance_pack_unavailable");
      // Both policy history and authority backing must be read from this very
      // snapshot. The authority repository only yields a repository-verified
      // proof; no capability or composition result is surfaced here.
      const lifecycle = await this.lifecycleReader.inspectInTransaction(tx, input.workspaceId, capturedAt);
      const authority = await this.authorityReader.loadInTransaction(tx, {
        workspaceId: input.workspaceId, accountRef: input.accountRef, evaluatedAt: capturedAt,
      });
      if (!/^[a-f0-9]{64}$/.test(lifecycle.registryHash)
        || authority.authoritySnapshot.workspaceId !== input.workspaceId
        || !Number.isFinite(Date.parse(authority.scope.evaluatedAt))
        || new Date(authority.scope.evaluatedAt).toISOString() !== authority.scope.evaluatedAt
        || Date.parse(authority.scope.evaluatedAt) > Date.parse(capturedAt)
        || authority.authoritySnapshot.verifiedAt > capturedAt || authority.authoritySnapshot.expiresAt <= capturedAt
        || authority.catalog.instructionPolicyRegistryHash !== lifecycle.registryHash) {
        throw new Error("policy_authority_unavailable");
      }
      const promotion = await this.promotionReader.inspectInTransaction(tx, input.workspaceId);
      return buildReadyEffectiveAnalysisContextSourceInSnapshot({ request: input, capturedAt, hierarchy, categoryTarget: resolvedTarget, categories,
        guidance: pack, cadence, lifecycle, authority, promotion });
    });
  }
}
