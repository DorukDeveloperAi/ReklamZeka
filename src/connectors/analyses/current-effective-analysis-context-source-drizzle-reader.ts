import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { EffectiveAnalysisContextNotReadySource, EffectiveAnalysisContextRequest,
  EffectiveAnalysisContextSource } from "@/application/effective-analysis-context-composer";
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

const NO_SOURCE_CAPABILITIES = Object.freeze({
  canCompose: false as const, canAuthorizeAction: false as const, canExecute: false as const,
  canExecuteWrite: false as const, canWriteMeta: false as const,
  canApprove: false as const, canSchedule: false as const, canCallTool: false as const,
  canAccessNetwork: false as const, canQuerySql: false as const,
});

export type CurrentCategoryCompositionSnapshotResolver = Readonly<{
  resolveInTransaction(transaction: Database, workspaceRef: string, workspaceId: string,
    target: CategoryHierarchyTarget): Promise<CurrentCategoryComposition>;
}>;

const currentCategoryCompositionSnapshotResolver: CurrentCategoryCompositionSnapshotResolver = Object.freeze({
  resolveInTransaction: (transaction, workspaceRef, workspaceId, target) =>
    resolveCurrentCategoryCompositionInSnapshot(
      DrizzleCurrentCategoryCompositionReader.inTransaction(transaction, workspaceRef), workspaceId, target),
});

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
    private readonly categoryResolver: CurrentCategoryCompositionSnapshotResolver = currentCategoryCompositionSnapshotResolver) {}

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
      const categories = await this.categoryResolver.resolveInTransaction(tx, workspaceRefs[0]!.workspace_ref,
        input.workspaceId, categoryTarget(input, hierarchy));
      if (categories.workspaceId !== input.workspaceId || categories.dimensions.length === 0
        || categories.dimensions.some((dimension) => dimension.frozenContext.path.at(-1)?.id !== input.entityRef)) {
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
      const unavailable: EffectiveAnalysisContextNotReadySource = Object.freeze({
        status: "not_ready", capturedAt, reason: "current_source_bundle_unavailable", capabilities: NO_SOURCE_CAPABILITIES,
      });
      return unavailable;
    });
  }
}
