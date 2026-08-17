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
  "promotion_template_authoring_revisions.template_payload",
  "promotion_template_authoring_revisions.binding_payload",
  "promotion_template_authoring_revisions.published_template_payload",
  "promotion_template_authoring_revisions.published_binding_payload",
  "category_profile_revisions.profile_payload",
  "strict_instruction_policy_revisions.policy_payload",
  "progressive_formalization_revisions.revision_payload",
  "tenant_authority_snapshots.snapshot_payload",
  "account_group_revisions.payload",
  "policy_authority_catalog_revisions.payload",
  "policy_manual_lock_revisions.payload",
  "authority_topic_revisions.payload",
  "policy_semantic_binding_revisions.payload",
  "decision_cadence_profile_revisions.profile_payload",
  "experiment_record_revisions.plan_payload",
  "experiment_record_revisions.outcome_payload",
]);

const categoryProjection = new Set([
  "effective_campaign_contexts.context_payload",
  "action_guardrail_policy_revisions.internal_category_refs",
  "autonomy_rule_revisions.artifact_payload",
  "action_guardrail_policy_revisions.artifact_payload",
]);

const opaqueCategoryContext = new Set([
  // Immutable historical run snapshot. Category selection is retained for replay,
  // never interpreted as a mutable category dependency by archive operations.
  "decision_room_run_analysis_assets.agenda_payload",
  "action_proposal_bundles.bundle_payload",
  "action_proposal_units.unit_payload",
  "action_proposal_units.action_plan_payload",
  "action_proposal_units.summary_payload",
  // The admission ledger duplicates an already-frozen proposal/write-spec for
  // replay; archive handling must retain it as opaque historical context.
  "action_execution_attempts.admission_payload",
  "action_execution_events.event_payload",
  // Private gate audit binds frozen hashes and a server-disabled flag; it is
  // historical evidence, never a mutable category selection source.
  "action_preparation_gate_snapshots.snapshot_payload",
  // Skill catalog revisions and the turn-bound catalog snapshots are immutable
  // UI/runtime history, not category dependency inputs.
  "orchestrator_profile_revisions.payload",
  "orchestrator_playbook_revisions.payload",
  "orchestrator_interview_kit_revisions.payload",
  "orchestrator_interview_kit_revisions.source_snapshot",
  "orchestrator_conversation_turns.profile_snapshot",
  "orchestrator_conversation_turns.manifest_snapshots",
  "orchestrator_conversation_turns.playbook_snapshots",
  "orchestrator_conversation_turns.interview_kit_snapshots",
  // Turn evidence is a bounded aggregate replay snapshot; it intentionally
  // contains no mutable category edge for archive evaluation.
  "orchestrator_conversation_turns.evidence_context_snapshot",
  // Selected SkillRun receipts bind only aggregate evidence availability and
  // immutable release manifest hashes; archive never treats them as category edges.
  "orchestrator_conversation_turns.skill_run_snapshot",
  // A cohort diagnostic is an immutable replay artifact. Its compatibility
  // profile/member hashes are historical commitments, not mutable archive edges.
  "robust_cohort_diagnostic_assets.profile",
  "robust_cohort_diagnostic_assets.equivalence_scope",
  "robust_cohort_diagnostic_assets.member_evidence_refs",
  "robust_cohort_diagnostic_assets.result_payload",
  "robust_cohort_diagnostic_assets.capabilities",
  // Creative diagnostic persistence commits historical config/window/result
  // hashes. None exposes a mutable category-reference edge.
  "creative_diagnostic_definition_revisions.definition_payload",
  "creative_diagnostic_settlement_policy_revisions.payload",
  "meta_creative_config_snapshots.config_payload",
  "meta_creative_window_insight_snapshots.daily_coverage",
  "creative_fatigue_config_diagnostic_assets.result_payload",
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
  "category_profile_revisions.profile_payload",
  "strict_instruction_policy_revisions.policy_payload",
  "progressive_formalization_revisions.revision_payload",
  "tenant_authority_snapshots.snapshot_payload",
  "account_group_revisions.payload",
  "policy_authority_catalog_revisions.payload",
  "policy_manual_lock_revisions.payload",
  "authority_topic_revisions.payload",
  "policy_semantic_binding_revisions.payload",
  "normalization_workbench_revisions.revision_payload",
  // Conversation page guides are UI navigation snapshots only; they do not
  // carry a mutable category edge.
  "orchestrator_conversation_turns.page_guide",
  // Slice-rule drafts retain their own immutable scope vocabulary. Category
  // archive must not infer an internal category link from opaque refs here.
  "slice_rule_workspace_drafts.draft_payload",
  // Advisory budget-pool trees and bindings constrain market/caps only. They
  // carry no internal category or strict-policy reference that archive impact
  // may interpret as a mutable dependency.
  "budget_pool_hierarchy_revisions.hierarchy_payload",
  "slice_rule_budget_pool_bindings.binding_payload",
  // Entity bindings freeze server-resolved hierarchy and source evidence only;
  // archive impact must not invent a category dependency from this evidence.
  "slice_rule_allocation_entity_bindings.source_evidence",
  "slice_rule_allocation_entity_bindings.binding_payload",
  // Rule-to-budget provenance pins immutable hashes only; no category edge is
  // inferred by archive impact from this advisory linkage.
  "slice_rule_budget_proposal_bindings.binding_payload",
  // A selected scenario allocation and the later ActionUnit provenance edge
  // pin immutable draft/proposal/action hashes. Category archive must not
  // reinterpret their historical evidence as a current mutable category link.
  "slice_rule_scenario_allocation_selections.selection_evidence",
  "slice_rule_scenario_allocation_selections.selection_payload",
  "slice_rule_budget_action_unit_bindings.binding_payload",
  "action_preparation_gate_snapshots.snapshot_payload",
  "orchestrator_profile_revisions.payload",
  "orchestrator_playbook_revisions.payload",
  "orchestrator_interview_kit_revisions.payload",
  "orchestrator_interview_kit_revisions.source_snapshot",
  "orchestrator_conversation_turns.profile_snapshot",
  "orchestrator_conversation_turns.manifest_snapshots",
  "orchestrator_conversation_turns.playbook_snapshots",
  "orchestrator_conversation_turns.interview_kit_snapshots",
  "orchestrator_conversation_turns.evidence_context_snapshot",
  "orchestrator_conversation_turns.skill_run_snapshot",
  // Delivery/payment alert records are historical evidence and checklist
  // state, never category or policy selection inputs.
  "delivery_health_alert_ledger_records.checklist_payload",
  "delivery_health_alert_ledger_records.record_payload",
  // Candidate-preview authority evidence pins a policy/guidance/snapshot basis;
  // it carries no category reference, so archive impact has no category edge.
  "candidate_preview_binding_revisions.decision",
  "candidate_preview_binding_revisions.payload",
  "guidance_cards.source_ids",
  "guidance_sets.ordered_card_ids",
  // Campaign guidance selection stores guidance topic labels and pack limits,
  // not internal category references. Archive impact therefore has no
  // category edge to resolve from these immutable selection facts.
  "guidance_campaign_selection_revisions.topics",
  "guidance_campaign_selection_revisions.required_topics",
  "guidance_campaign_selection_revisions.budget",
  "advised_practice_definitions.payload",
  "advised_practice_events.payload",
  "effective_campaign_contexts.snapshot_refs",
  "effective_campaign_contexts.context_payload",
  // Frozen diagnostic evidence carries immutable hashes/manifests for replay;
  // it has no mutable category-reference edge beyond the context it commits to.
  "frozen_diagnostic_evidence.hierarchy_refs",
  "frozen_diagnostic_evidence.feature_manifest",
  "frozen_diagnostic_evidence.window_manifest",
  "frozen_diagnostic_evidence.canonical_config_evidence",
  "frozen_diagnostic_evidence.source_refs",
  "frozen_diagnostic_evidence.capabilities",
  "robust_cohort_diagnostic_assets.profile",
  "robust_cohort_diagnostic_assets.equivalence_scope",
  "robust_cohort_diagnostic_assets.member_evidence_refs",
  "robust_cohort_diagnostic_assets.result_payload",
  "robust_cohort_diagnostic_assets.capabilities",
  "creative_diagnostic_definition_revisions.definition_payload",
  "creative_diagnostic_settlement_policy_revisions.payload",
  "meta_creative_config_snapshots.config_payload",
  "meta_creative_window_insight_snapshots.daily_coverage",
  "creative_fatigue_config_diagnostic_assets.result_payload",
  "creative_fatigue_config_diagnostic_assets.capabilities",
  "budget_proposal_versions.proposal_payload",
  "budget_proposal_alternatives.alternative_payload",
  "analysis_timeframe_definitions.definition_payload",
  "decision_cadence_profile_revisions.profile_payload",
  "experiment_record_revisions.plan_payload",
  "experiment_record_revisions.outcome_payload",
  // Compact outcome evidence has no category interpretation; retain it as an opaque, immutable source fact.
  "business_outcome_evidence_snapshots.evidence_payload",
  "analysis_template_definitions.definition_payload",
  "decision_room_run_analysis_assets.resolved_timeframe",
  "decision_room_run_analysis_assets.agenda_payload",
  "guidance_analysis_run_bindings.selected_set_refs",
  "guidance_analysis_run_bindings.card_refs",
  "guidance_analysis_run_bindings.source_refs",
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
  // L2 feature payloads carry only canonical metrics/source hashes; no mutable category or policy edge.
  "deterministic_feature_snapshots.quality_reason_codes",
  "deterministic_feature_snapshots.metric_result",
  "deterministic_feature_snapshots.feature_payload",
  // L3 window payload is an immutable feature-hash envelope, not a category/policy dependency.
  "deterministic_window_snapshots.window_payload",
  "audit_events.metadata",
  "insights.evidence",
  "operational_events.tags",
  "audience_preset_revisions.payload",
  "promotion_template_revisions.actor_type_scope",
  "promotion_template_revisions.payload",
  "promotion_template_bindings.payload",
  "audience_preset_authoring_revisions.preset_payload",
  "audience_preset_authoring_revisions.published_preset_payload",
  "promotion_template_authoring_revisions.preset_payload",
  "promotion_template_authoring_revisions.template_payload",
  "promotion_template_authoring_revisions.binding_payload",
  "promotion_template_authoring_revisions.published_template_payload",
  "promotion_template_authoring_revisions.published_binding_payload",
  "action_approval_policy_snapshots.policy_payload",
  "action_proposal_bundles.bundle_payload",
  "action_proposal_units.unit_payload",
  "action_proposal_units.action_plan_payload",
  "action_proposal_units.summary_payload",
  "action_approval_decision_events.command_payload",
  "action_approval_decision_events.event_payloads",
  "action_approval_evidence_grants.grant_payload",
  "action_execution_attempts.admission_payload",
  "action_execution_events.event_payload",
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
  // Immutable finding, slice, Guide and Guide Run envelopes may carry public
  // evidence references. They are historical context, never mutable category
  // authority for archive-impact decisions.
  "finding_lifecycle_events.observation_payload",
  "development_log_events.payload",
  "slice_resolution_snapshot_members.market_evidence_refs",
  "slice_resolution_snapshot_members.matched_dimension_ids",
  "slice_resolution_snapshot_members.matched_dimension_evidence_refs",
  "guide_revisions.strict_payload",
  "guide_revisions.schedule_payload",
  "guide_budget_contracts.contract_payload",
  "guide_lifecycle_events.payload",
  "guide_runs.trigger_payload",
  "guide_run_events.payload",
  "guide_run_heads.run_payload",
  "guide_run_artifacts.payload",
  "guide_run_artifacts.authority",
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
