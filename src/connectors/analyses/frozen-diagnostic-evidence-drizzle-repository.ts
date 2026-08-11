import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { FUNNEL_STAGES, type FunnelStage } from "@/analyses/schema";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const HASH = /^[a-f0-9]{64}$/;
export const DIAGNOSTIC_CATEGORY_COHORT_PROFILE_VERSION = "diagnostic-category-cohort-profile/1.0.0" as const;

export class FrozenDiagnosticEvidenceRepositoryError extends Error {
  constructor(readonly code: "insufficient_evidence" | "corrupt_store") {
    super(`Frozen diagnostic evidence reddedildi: ${code}`); this.name = "FrozenDiagnosticEvidenceRepositoryError";
  }
}
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function rows<T extends Row>(value: unknown): readonly T[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new FrozenDiagnosticEvidenceRepositoryError("corrupt_store"); return value.rows as readonly T[]; }

type FrozenCategory = EffectiveCampaignContext["categories"][number];

function canonicalCategoryMaterial(category: FrozenCategory): Readonly<Record<string, unknown>> {
  const definitions = [...category.effectiveDefinitions]
    .map((definition) => Object.freeze({ key: definition.key, version: definition.version }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.version - right.version);
  const bindings = [...(category.profileBindings ?? [])]
    .map((binding) => Object.freeze({ categoryRef: binding.categoryRef, profileRef: binding.profileRef,
      profileVersion: binding.profileVersion, profileHash: binding.profileHash }))
    .sort((left, right) => left.categoryRef.localeCompare(right.categoryRef));
  const expectedRefs = definitions.map((definition) => categoryDefinitionPublicRef(category.dimension.key, definition.key)).sort();
  if (definitions.length === 0 || bindings.length !== definitions.length
    || bindings.some((binding) => !HASH.test(binding.profileHash) || !binding.profileRef.trim())
    || expectedRefs.some((categoryRef, index) => categoryRef !== bindings[index]?.categoryRef)) {
    throw new FrozenDiagnosticEvidenceRepositoryError("corrupt_store");
  }
  return Object.freeze({ categorySchemaVersion: category.schemaVersion,
    dimension: Object.freeze({ key: category.dimension.key, version: category.dimension.version,
      cardinality: category.dimension.cardinality }), effectiveDefinitions: Object.freeze(definitions),
    profileBindings: Object.freeze(bindings) });
}

/**
 * Compatibility identity deliberately excludes subject path and assignment IDs.
 * The original resolution hash remains separately committed as exact evidence.
 */
export function deriveDiagnosticCategoryCohortProfileHash(categories: EffectiveCampaignContext["categories"]): string {
  if (categories.length === 0) throw new FrozenDiagnosticEvidenceRepositoryError("corrupt_store");
  const dimensions = [...categories].sort((left, right) => left.dimension.key.localeCompare(right.dimension.key))
    .map(canonicalCategoryMaterial);
  if (new Set(categories.map((category) => category.dimension.key)).size !== categories.length) {
    throw new FrozenDiagnosticEvidenceRepositoryError("corrupt_store");
  }
  return digest({ contractVersion: DIAGNOSTIC_CATEGORY_COHORT_PROFILE_VERSION, dimensions });
}

/** Only an exact, single-valued, canonical funnel_intent classification is usable. */
export function deriveFrozenDiagnosticFunnel(categories: EffectiveCampaignContext["categories"]): FunnelStage | null {
  const candidates = categories.filter((category) => category.dimension.key === "funnel_intent");
  if (candidates.length !== 1) return null;
  const candidate = candidates[0]!;
  if (candidate.dimension.cardinality !== "single" || candidate.effectiveDefinitions.length !== 1
    || candidate.profileBindings?.length !== 1) return null;
  const definition = candidate.effectiveDefinitions[0]!;
  const binding = candidate.profileBindings[0]!;
  if (!(FUNNEL_STAGES as readonly string[]).includes(definition.key)
    || binding.categoryRef !== categoryDefinitionPublicRef("funnel_intent", definition.key)
    || !HASH.test(binding.profileHash)) return null;
  return definition.key as FunnelStage;
}

/** Server-private, fail-closed A10 input materializer. It performs no diagnostic calculation. */
export class DrizzleFrozenDiagnosticEvidenceRepository {
  async saveInTransaction(database: Database, input: Readonly<{ contextId: string; context: EffectiveCampaignContext }>): Promise<"inserted" | "unchanged"> {
    const { context, contextId } = input;
    if (context.data.trustStatus !== "ready" || context.data.blockers.length !== 0 || context.data.featureRefs.length === 0 || context.data.windowRefs.length === 0 || context.metaAnalysisConfigEvidence === undefined || context.categories.length === 0) throw new FrozenDiagnosticEvidenceRepositoryError("insufficient_evidence");
    const found = rows<{ feature_ref: string; feature_hash: string; window_ref: string; window_hash: string; context_hash: string; captured_at: string }>(await database.execute(sql`
      select feature.feature_ref, feature.feature_hash, window.window_ref, window.window_hash, context.context_hash, context.captured_at::text
      from effective_campaign_contexts context
      join deterministic_feature_snapshots feature on feature.workspace_id = context.workspace_id and feature.feature_ref = any(${context.data.featureRefs}::text[])
      join deterministic_window_snapshots window on window.workspace_id = context.workspace_id and window.window_ref = any(${context.data.windowRefs}::text[])
      where context.workspace_id = ${context.workspaceId}::uuid and context.id = ${contextId}::uuid
        and context.context_hash = ${context.contextHash} and context.captured_at = ${context.capturedAt}::timestamptz
        and feature.meta_connection_id = context.meta_connection_id and feature.ad_account_id = context.ad_account_id
        and window.meta_connection_id = context.meta_connection_id and window.ad_account_id = context.ad_account_id
      order by feature.feature_ref, window.window_ref for share
    `));
    const expected = context.data.featureRefs.length * context.data.windowRefs.length;
    if (found.length !== expected || found.some((row) => row.context_hash !== context.contextHash)) throw new FrozenDiagnosticEvidenceRepositoryError("insufficient_evidence");
    const features = [...new Map(found.map((row) => [row.feature_ref, { ref: row.feature_ref, hash: row.feature_hash }])).values()].sort((a, b) => a.ref.localeCompare(b.ref));
    const windows = [...new Map(found.map((row) => [row.window_ref, { ref: row.window_ref, hash: row.window_hash }])).values()].sort((a, b) => a.ref.localeCompare(b.ref));
    if (features.length !== context.data.featureRefs.length || windows.length !== context.data.windowRefs.length || features.some((x) => !HASH.test(x.hash)) || windows.some((x) => !HASH.test(x.hash))) throw new FrozenDiagnosticEvidenceRepositoryError("corrupt_store");
    const categoryCompositionHash = digest(context.categories.map((x) => ({ dimension: x.dimension, resolutionHash: x.resolutionHash, profileBindings: x.profileBindings ?? [] })));
    const categoryCohortProfileHash = deriveDiagnosticCategoryCohortProfileHash(context.categories);
    const policySetHash = digest(context.policies);
    const objective = context.meta.objective.state === "known" ? context.meta.objective.value : null;
    const funnel = deriveFrozenDiagnosticFunnel(context.categories);
    const optimizationEvent = context.meta.optimizationEvent.state === "known" ? context.meta.optimizationEvent.value : null;
    const core = { contextHash: context.contextHash, capturedAt: context.capturedAt, entityType: context.identity.entityType, entityRef: context.identity.entityRef, hierarchyRefs: context.identity.hierarchyRefs, features, windows, objective, funnel, optimizationEvent, categoryCompositionHash, categoryCohortProfileHash, policySetHash, config: context.metaAnalysisConfigEvidence.snapshot, sourceRefs: context.data.snapshotRefs };
    const evidenceHash = digest(core);
    const result = rows<{ id: string }>(await database.execute(sql`
      insert into frozen_diagnostic_evidence (workspace_id, context_id, context_ref, context_hash, evidence_hash, captured_at, entity_type, entity_ref, hierarchy_refs, feature_manifest, window_manifest, objective, funnel, optimization_event, category_composition_hash, category_cohort_profile_hash, policy_set_hash, creative_binding_hash, canonical_config_evidence, source_refs, capabilities)
      values (${context.workspaceId}::uuid, ${contextId}::uuid, ${`context_${context.contextHash.slice(0, 24)}`}, ${context.contextHash}, ${evidenceHash}, ${context.capturedAt}::timestamptz, ${context.identity.entityType}, ${context.identity.entityRef}, ${JSON.stringify(context.identity.hierarchyRefs)}::jsonb, ${JSON.stringify(features)}::jsonb, ${JSON.stringify(windows)}::jsonb, ${objective}, ${funnel}, ${optimizationEvent}, ${categoryCompositionHash}, ${categoryCohortProfileHash}, ${policySetHash}, null, ${JSON.stringify(context.metaAnalysisConfigEvidence.snapshot)}::jsonb, ${JSON.stringify(context.data.snapshotRefs)}::jsonb, '{"canAuthorizeAction":false,"canExecuteWrite":false,"canWriteMeta":false,"canPublish":false,"canApprove":false,"canExecute":false,"canAccessNetwork":false}'::jsonb)
      on conflict (context_id) do nothing returning id::text
    `));
    return result.length === 1 ? "inserted" : result.length === 0 ? "unchanged" : (() => { throw new FrozenDiagnosticEvidenceRepositoryError("corrupt_store"); })();
  }
}
