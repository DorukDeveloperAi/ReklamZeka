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
]);
const policyProjection = new Set(["effective_campaign_contexts.context_payload"]);
const opaquePolicyContext = new Set([
  "action_proposal_bundles.bundle_payload",
  "action_proposal_units.unit_payload",
  "action_proposal_units.action_plan_payload",
  "action_proposal_units.summary_payload",
  "action_execution_attempts.admission_payload",
  "action_execution_events.event_payload",
  "robust_cohort_diagnostic_assets.profile",
  "robust_cohort_diagnostic_assets.member_evidence_refs",
  "robust_cohort_diagnostic_assets.result_payload",
  "robust_cohort_diagnostic_assets.capabilities",
  "creative_diagnostic_definition_revisions.definition_payload",
  "meta_creative_config_snapshots.config_payload",
  "meta_creative_window_insight_snapshots.daily_coverage",
  "creative_fatigue_config_diagnostic_assets.result_payload",
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
