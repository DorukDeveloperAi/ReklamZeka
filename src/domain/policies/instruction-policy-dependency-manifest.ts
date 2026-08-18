import { CATEGORY_JSONB_MANIFEST } from "@/domain/categories/category-dependency-manifest";

export const INSTRUCTION_POLICY_DEPENDENCY_MANIFEST_VERSION =
  "instruction-policy-dependency-manifest/1.0.0" as const;

export type InstructionPolicyJsonbPolicy =
  | "policy_contract"
  | "policy_projection"
  | "opaque_policy_context"
  | "policy_absent";

const policyContract = new Set([
  "strict_instruction_policy_revisions.policy_payload",
  "tenant_authority_snapshots.snapshot_payload",
  "account_group_revisions.payload",
  "policy_authority_catalog_revisions.payload",
  "policy_manual_lock_revisions.payload",
  "authority_topic_revisions.payload",
  "policy_semantic_binding_revisions.payload",
  "candidate_preview_binding_revisions.decision",
  "candidate_preview_binding_revisions.payload",
  "decision_cadence_profile_revisions.profile_payload",
  "progressive_formalization_revisions.revision_payload",
  // Human-published ceiling constraints are a closed policy contract. They
  // carry no execution authority but must remain visible to policy impact.
  "budget_ceiling_policy_revisions.policy_payload",
]);
const policyProjection = new Set(["effective_campaign_contexts.context_payload"]);
const opaquePolicyContext = new Set([
  "action_proposal_bundles.bundle_payload",
  "action_proposal_units.unit_payload",
  "action_proposal_units.action_plan_payload",
  "action_proposal_units.summary_payload",
  "action_execution_attempts.admission_payload",
  "action_execution_events.event_payload",
  "p06_execution_runs.request_payload",
  "p06_execution_events.payload",
  "p06_execution_observations.observed_value",
  "p06_execution_gate_snapshots.payload",
  "p06_rollback_proposals.payload",
  // Append-only gate audit and skill-catalog snapshots are private historical
  // context. Policy impact must not infer mutable authority from them.
  "action_preparation_gate_snapshots.snapshot_payload",
  "orchestrator_profile_revisions.payload",
  "orchestrator_playbook_revisions.payload",
  "orchestrator_interview_kit_revisions.payload",
  "orchestrator_interview_kit_revisions.source_snapshot",
  "orchestrator_conversation_turns.profile_snapshot",
  "orchestrator_conversation_turns.manifest_snapshots",
  "orchestrator_conversation_turns.playbook_snapshots",
  "orchestrator_conversation_turns.interview_kit_snapshots",
  // Immutable aggregate turn evidence is historical context only; it cannot
  // become a policy authority dependency during impact evaluation.
  "orchestrator_conversation_turns.evidence_context_snapshot",
  "orchestrator_conversation_turns.skill_run_snapshot",
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
  "frozen_diagnostic_evidence.capabilities",
  "finding_lifecycle_events.observation_payload",
  "development_log_events.payload",
  "guide_revisions.strict_payload",
  "guide_revisions.schedule_payload",
  "guide_budget_contracts.contract_payload",
  "guide_lifecycle_events.payload",
  "guide_runs.trigger_payload",
  "guide_run_events.payload",
  "guide_run_heads.run_payload",
  "guide_run_artifacts.payload",
  "guide_run_artifacts.authority",
]);

const policyAuthorityJsonbColumns = Object.freeze([...policyContract]
  .filter((key) => !CATEGORY_JSONB_MANIFEST.some((entry) => `${entry.table}.${entry.column}` === key))
  .map((key) => {
    const [table, column] = key.split(".");
    return Object.freeze({ table: table!, column: column! });
  }));

export const INSTRUCTION_POLICY_JSONB_MANIFEST = Object.freeze([...CATEGORY_JSONB_MANIFEST, ...policyAuthorityJsonbColumns].map((entry) => {
  const key = `${entry.table}.${entry.column}`;
  const policy: InstructionPolicyJsonbPolicy = policyContract.has(key) ? "policy_contract"
    : policyProjection.has(key) ? "policy_projection"
      : opaquePolicyContext.has(key) ? "opaque_policy_context" : "policy_absent";
  return Object.freeze({ table: entry.table, column: entry.column, policy });
}));

export function assessInstructionPolicyJsonbCatalog(
  actual: readonly Readonly<{ table: unknown; column: unknown }>[],
): Readonly<{ unclassifiedColumns: number; missingManifestColumns: number }> {
  const expected = new Set(INSTRUCTION_POLICY_JSONB_MANIFEST.map((entry) => `${entry.table}.${entry.column}`));
  const seen = new Set<string>(); let invalidRows = 0;
  for (const row of actual) {
    if (typeof row.table !== "string" || typeof row.column !== "string" || !row.table || !row.column) {
      invalidRows += 1;
    } else seen.add(`${row.table}.${row.column}`);
  }
  let unclassifiedColumns = invalidRows; let missingManifestColumns = 0;
  for (const key of seen) if (!expected.has(key)) unclassifiedColumns += 1;
  for (const key of expected) if (!seen.has(key)) missingManifestColumns += 1;
  return Object.freeze({ unclassifiedColumns, missingManifestColumns });
}
