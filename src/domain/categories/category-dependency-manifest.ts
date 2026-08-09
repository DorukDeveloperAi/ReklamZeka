/**
 * Versioned inventory of every JSONB column in the application-owned public
 * schema. Category archive preview compares this list with pg_catalog on every
 * request so a newly introduced JSONB surface cannot silently bypass dependency
 * analysis.
 */
export const CATEGORY_DEPENDENCY_MANIFEST_VERSION = "category-dependency-manifest/1.0.0" as const;

export type CategoryJsonbPolicy =
  | "category_contract"
  | "category_projection"
  | "opaque_category_context"
  | "category_absent";

export type CategoryJsonbManifestEntry = Readonly<{
  table: string;
  column: string;
  policy: CategoryJsonbPolicy;
}>;

const categoryContract = new Set([
  "advised_practice_definitions.payload",
  "budget_proposal_versions.proposal_payload",
  "budget_proposal_alternatives.alternative_payload",
  "promotion_template_revisions.payload",
  "promotion_template_bindings.payload",
]);

const categoryProjection = new Set([
  "effective_campaign_contexts.context_payload",
  "action_guardrail_policy_revisions.internal_category_refs",
  "autonomy_rule_revisions.artifact_payload",
  "action_guardrail_policy_revisions.artifact_payload",
]);

const opaqueCategoryContext = new Set([
  "action_proposal_bundles.bundle_payload",
  "action_proposal_units.unit_payload",
  "action_proposal_units.action_plan_payload",
  "action_proposal_units.summary_payload",
]);

const columns = [
  "meta_connections.granted_scopes",
  "meta_connections.enabled_capabilities",
  "meta_connections.capability_snapshot",
  "local_agent_sessions.allowed_tools",
  "ad_accounts.permission_snapshot",
  "ad_accounts.capability_snapshot",
  "ad_accounts.unsupported_fields",
  "ad_accounts.provenance",
  "ad_campaigns.status_issues",
  "ad_campaigns.unsupported_fields",
  "ad_campaigns.special_ad_categories",
  "ad_campaigns.provenance",
  "meta_ad_sets.status_issues",
  "meta_ad_sets.unsupported_fields",
  "meta_ad_sets.attribution_spec",
  "meta_ad_sets.promoted_object",
  "meta_ad_sets.targeting_summary",
  "meta_ad_sets.provenance",
  "meta_assets.permission_snapshot",
  "meta_assets.capability_snapshot",
  "meta_assets.unsupported_fields",
  "meta_assets.provenance",
  "meta_posts.unsupported_fields",
  "meta_posts.provenance",
  "meta_change_snapshots.canonical_payload",
  "meta_change_snapshots.safe_aggregate",
  "meta_change_events.before_value",
  "meta_change_events.after_value",
  "meta_creatives.content_provenance",
  "meta_creatives.dynamic_variants",
  "meta_creatives.unsupported_fields",
  "meta_creatives.provenance",
  "meta_ads.status_issues",
  "meta_ads.unsupported_fields",
  "meta_ads.review_feedback",
  "meta_ads.tracking_specs",
  "meta_ads.provenance",
  "category_assignments.evidence",
  "guidance_cards.source_ids",
  "guidance_sets.ordered_card_ids",
  "advised_practice_definitions.payload",
  "advised_practice_events.payload",
  "effective_campaign_contexts.snapshot_refs",
  "effective_campaign_contexts.context_payload",
  "budget_proposal_versions.proposal_payload",
  "budget_proposal_alternatives.alternative_payload",
  "analysis_timeframe_definitions.definition_payload",
  "analysis_template_definitions.definition_payload",
  "decision_room_run_analysis_assets.resolved_timeframe",
  "meta_asset_edges.capability_snapshot",
  "meta_asset_edges.provenance",
  "meta_asset_discoveries.provenance",
  "meta_ad_creative_bindings.provenance",
  "meta_portfolio_sync_runs.request_context",
  "meta_sync_streams.checkpoint",
  "meta_sync_streams.last_error",
  "meta_sync_runs.checkpoint",
  "meta_sync_runs.error_detail",
  "meta_sync_slices.checkpoint",
  "meta_sync_slices.error_detail",
  "meta_daily_insights.attribution_window",
  "meta_daily_insights.field_availability",
  "meta_daily_insights.metric_provenance",
  "meta_daily_insight_metrics.value_json",
  "meta_daily_insight_metrics.provenance",
  "meta_daily_insight_metrics.availability",
  "audit_events.metadata",
  "insights.evidence",
  "operational_events.tags",
  "audience_preset_revisions.payload",
  "promotion_template_revisions.actor_type_scope",
  "promotion_template_revisions.payload",
  "promotion_template_bindings.payload",
  "action_approval_policy_snapshots.policy_payload",
  "action_proposal_bundles.bundle_payload",
  "action_proposal_units.unit_payload",
  "action_proposal_units.action_plan_payload",
  "action_proposal_units.summary_payload",
  "action_approval_decision_events.command_payload",
  "action_approval_decision_events.event_payloads",
  "action_approval_evidence_grants.grant_payload",
  "autonomy_rule_revisions.source_guidance_refs",
  "autonomy_rule_revisions.artifact_payload",
  "action_guardrail_policy_revisions.action_types",
  "action_guardrail_policy_revisions.account_refs",
  "action_guardrail_policy_revisions.campaign_refs",
  "action_guardrail_policy_revisions.entities",
  "action_guardrail_policy_revisions.internal_category_refs",
  "action_guardrail_policy_revisions.geo_refs",
  "action_guardrail_policy_revisions.clauses",
  "action_guardrail_policy_revisions.source_guidance_refs",
  "action_guardrail_policy_revisions.artifact_payload",
  "approval_policy_definition_revisions.policy_payload",
  "approval_policy_definition_revisions.artifact_payload",
  "meta_compatibility_artifact_revisions.artifact_payload",
] as const;

export const CATEGORY_JSONB_MANIFEST: readonly CategoryJsonbManifestEntry[] = Object.freeze(columns.map((key) => {
  const [table, column] = key.split(".");
  const policy: CategoryJsonbPolicy = categoryContract.has(key) ? "category_contract"
    : categoryProjection.has(key) ? "category_projection"
      : opaqueCategoryContext.has(key) ? "opaque_category_context" : "category_absent";
  return Object.freeze({ table: table!, column: column!, policy });
}));

export type CategoryJsonbCatalogAssessment = Readonly<{
  unclassifiedColumns: number;
  missingManifestColumns: number;
}>;

export function assessCategoryJsonbCatalog(
  actual: readonly Readonly<{ table: unknown; column: unknown }>[],
): CategoryJsonbCatalogAssessment {
  const expected = new Set(CATEGORY_JSONB_MANIFEST.map((entry) => `${entry.table}.${entry.column}`));
  const seen = new Set<string>();
  let invalidRows = 0;
  for (const row of actual) {
    if (typeof row.table !== "string" || typeof row.column !== "string" || !row.table || !row.column) {
      invalidRows += 1;
      continue;
    }
    seen.add(`${row.table}.${row.column}`);
  }
  let unclassifiedColumns = invalidRows;
  for (const key of seen) if (!expected.has(key)) unclassifiedColumns += 1;
  let missingManifestColumns = 0;
  for (const key of expected) if (!seen.has(key)) missingManifestColumns += 1;
  return Object.freeze({ unclassifiedColumns, missingManifestColumns });
}
