import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { calculateRobustCohort, type CohortDirection, type CohortCompatibilityProfile, type RobustCohortResult } from "@/analyses/cohort-calculator";
import { ANALYSIS_METRICS, FUNNEL_STAGES, type AnalysisMetric, type FunnelStage } from "@/analyses/schema";
import { assertDeterministicFeatureSnapshot, type DeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CAPABILITIES = Object.freeze({ canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false, canPublish: false, canApprove: false, canExecute: false, canAccessNetwork: false } as const);

export class RobustCohortDiagnosticRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "insufficient_evidence" | "corrupt_store") {
    super(`Robust cohort diagnostic reddedildi: ${code}`); this.name = "RobustCohortDiagnosticRepositoryError";
  }
}

type CandidateRow = Readonly<{
  evidence_id: string; evidence_hash: string; entity_ref: string; feature_ref: string; feature_hash: string; feature_payload: unknown;
}>;
function fail(code: RobustCohortDiagnosticRepositoryError["code"]): never { throw new RobustCohortDiagnosticRepositoryError(code); }
function rows<T extends Row>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function instant(value: string): string { if (!Number.isFinite(Date.parse(value))) fail("invalid_input"); return new Date(value).toISOString(); }

/**
 * Server-private A10.5b materializer. The caller can name only its target
 * frozen evidence and requested metric/funnel; all cohort members are selected
 * under one DB snapshot from the exact tenant/account/profile compatibility key.
 */
export class DrizzleRobustCohortDiagnosticRepository {
  constructor(private readonly database: Database) {}

  async materialize(input: Readonly<{
    workspaceId: string; targetEvidenceId: string; metricKey: AnalysisMetric; funnel: FunnelStage;
    direction: CohortDirection; minimumSampleSize: number; findingThresholdRobustZ: number; occurredAt: string;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; cohortRef: string; cohortHash: string; result: RobustCohortResult; capabilities: typeof CAPABILITIES }>> {
    const valid = !!input && !Object.keys(input).some((key) => !["workspaceId", "targetEvidenceId", "metricKey", "funnel", "direction", "minimumSampleSize", "findingThresholdRobustZ", "occurredAt"].includes(key)) && UUID.test(input.workspaceId) && UUID.test(input.targetEvidenceId)
      && (ANALYSIS_METRICS as readonly string[]).includes(input.metricKey) && (FUNNEL_STAGES as readonly string[]).includes(input.funnel)
      && ["higher_is_better", "lower_is_better"].includes(input.direction) && Number.isSafeInteger(input.minimumSampleSize) && input.minimumSampleSize >= 1
      && Number.isFinite(input.findingThresholdRobustZ) && input.findingThresholdRobustZ > 0;
    if (!valid) fail("invalid_input");
    const occurredAt = instant(input.occurredAt);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for share`)).length !== 1) fail("not_found");
      const selected = rows<CandidateRow>(await tx.execute(sql`
        with target as (
          select evidence.workspace_id, evidence.id, context.ad_account_id, evidence.objective, evidence.funnel,
            evidence.optimization_event, evidence.category_composition_hash, evidence.policy_set_hash
          from frozen_diagnostic_evidence evidence
          join effective_campaign_contexts context on context.workspace_id = evidence.workspace_id and context.id = evidence.context_id
          where evidence.workspace_id = ${input.workspaceId}::uuid and evidence.id = ${input.targetEvidenceId}::uuid
            and evidence.entity_type = 'campaign' and evidence.objective is not null and evidence.funnel = ${input.funnel}
            and evidence.optimization_event is not null
            and not exists (select 1 from effective_campaign_context_invalidations invalidation where invalidation.workspace_id = evidence.workspace_id and invalidation.context_id = evidence.context_id)
          for share
        ), ranked as (
          select distinct on (evidence.entity_ref) evidence.id, evidence.evidence_hash, evidence.entity_ref, evidence.feature_manifest
          from frozen_diagnostic_evidence evidence
          join effective_campaign_contexts context on context.workspace_id = evidence.workspace_id and context.id = evidence.context_id
          join target on target.workspace_id = evidence.workspace_id and target.ad_account_id = context.ad_account_id
            and target.objective = evidence.objective and target.funnel = evidence.funnel and target.optimization_event = evidence.optimization_event
            and target.category_composition_hash = evidence.category_composition_hash and target.policy_set_hash = evidence.policy_set_hash
          where evidence.workspace_id = ${input.workspaceId}::uuid and evidence.entity_type = 'campaign'
            and not exists (select 1 from effective_campaign_context_invalidations invalidation where invalidation.workspace_id = evidence.workspace_id and invalidation.context_id = evidence.context_id)
          order by evidence.entity_ref, evidence.captured_at desc, evidence.id desc
        )
        select ranked.id::text as evidence_id, ranked.evidence_hash, ranked.entity_ref, feature.feature_ref, feature.feature_hash, feature.feature_payload
        from ranked
        join lateral jsonb_to_recordset(ranked.feature_manifest) as manifest(ref text, hash text) on true
        join deterministic_feature_snapshots feature on feature.workspace_id = ${input.workspaceId}::uuid and feature.feature_ref = manifest.ref and feature.feature_hash = manifest.hash
        where feature.role = 'primary' and feature.quality_status = 'ready' and feature.settled = true
          and not exists (select 1 from deterministic_feature_snapshot_invalidations invalidation where invalidation.workspace_id = feature.workspace_id and invalidation.feature_snapshot_id = feature.id)
        order by ranked.entity_ref, feature.feature_ref
        for share
      `));
      if (selected.length === 0) fail("not_found");
      const grouped = new Map<string, CandidateRow[]>();
      for (const row of selected) grouped.set(row.evidence_id, [...(grouped.get(row.evidence_id) ?? []), row]);
      const targetRows = grouped.get(input.targetEvidenceId);
      if (!targetRows || targetRows.length !== 1 || [...grouped.values()].some((entries) => entries.length !== 1)) fail("insufficient_evidence");
      const profileRow = rows<Readonly<{ objective: unknown; funnel: unknown; optimization_event: unknown; category_composition_hash: unknown; policy_set_hash: unknown }>>(await tx.execute(sql`
        select objective, funnel, optimization_event, category_composition_hash, policy_set_hash
        from frozen_diagnostic_evidence where workspace_id = ${input.workspaceId}::uuid and id = ${input.targetEvidenceId}::uuid limit 2 for share
      `))[0];
      if (!profileRow || typeof profileRow.objective !== "string" || profileRow.funnel !== input.funnel || typeof profileRow.optimization_event !== "string"
        || typeof profileRow.category_composition_hash !== "string" || typeof profileRow.policy_set_hash !== "string" || !HASH.test(profileRow.category_composition_hash) || !HASH.test(profileRow.policy_set_hash)) fail("corrupt_store");
      const profile: CohortCompatibilityProfile = Object.freeze({ objective: profileRow.objective as CohortCompatibilityProfile["objective"], funnel: input.funnel, optimizationEvent: profileRow.optimization_event as CohortCompatibilityProfile["optimizationEvent"], metricKey: input.metricKey, categoryProfileHash: profileRow.category_composition_hash, policySetHash: profileRow.policy_set_hash });
      const members = [...grouped.values()].map((entries) => {
        const row = entries[0]!; let feature: DeterministicFeatureSnapshot;
        try { assertDeterministicFeatureSnapshot(row.feature_payload); feature = row.feature_payload as DeterministicFeatureSnapshot; } catch { return fail("corrupt_store"); }
        if (feature.featureRef !== row.feature_ref || feature.featureHash !== row.feature_hash || feature.scope.workspaceId !== input.workspaceId || feature.scope.entityLevel !== "campaign" || feature.scope.externalEntityId !== row.entity_ref) fail("corrupt_store");
        const metric = feature.metricResult.metrics.find((candidate) => candidate.metric === input.metricKey);
        if (!metric || metric.status !== "available" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(metric.valueDecimal)) fail("insufficient_evidence");
        const value = Number(metric.valueDecimal);
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail("corrupt_store");
        return Object.freeze({ entityRef: row.entity_ref, profile, value, sampleSize: feature.sampleSize, sourceSnapshotRef: row.feature_ref, evidenceId: row.evidence_id, evidenceHash: row.evidence_hash, featureHash: row.feature_hash });
      }).sort((left, right) => left.entityRef.localeCompare(right.entityRef));
      if (new Set(members.map((member) => member.entityRef)).size !== members.length
        || new Set(members.map((member) => member.evidenceHash)).size !== members.length
        || new Set(members.map((member) => member.featureHash)).size !== members.length) fail("insufficient_evidence");
      const core = { contractVersion: "robust-cohort-diagnostic-asset/1.0.0", targetEvidenceId: input.targetEvidenceId, profile, direction: input.direction, minimumMemberCount: 4, minimumSampleSize: input.minimumSampleSize, findingThresholdRobustZ: input.findingThresholdRobustZ, members: members.map(({ evidenceId, evidenceHash, featureHash, ...member }) => ({ ...member, evidenceId, evidenceHash, featureHash })), occurredAt };
      const cohortHash = digest(core); const cohortRef = `cohort_${cohortHash.slice(0, 24)}`;
      const result = calculateRobustCohort({ cohortRef, profile, direction: input.direction, minimumMemberCount: 4, minimumSampleSize: input.minimumSampleSize, findingThresholdRobustZ: input.findingThresholdRobustZ, observations: members });
      const memberEvidenceRefs = members.map((member) => ({ evidenceRef: `evidence_${member.evidenceHash.slice(0, 24)}`, evidenceHash: member.evidenceHash, featureRef: member.sourceSnapshotRef, featureHash: member.featureHash }));
      const inserted = rows<Readonly<{ id: string }>>(await tx.execute(sql`
        insert into robust_cohort_diagnostic_assets (workspace_id, target_evidence_id, cohort_ref, cohort_hash, profile, member_evidence_refs, result_payload, capabilities, occurred_at)
        values (${input.workspaceId}::uuid, ${input.targetEvidenceId}::uuid, ${cohortRef}, ${cohortHash}, ${JSON.stringify(profile)}::jsonb, ${JSON.stringify(memberEvidenceRefs)}::jsonb, ${JSON.stringify(result)}::jsonb, ${JSON.stringify(CAPABILITIES)}::jsonb, ${occurredAt}::timestamptz)
        on conflict (workspace_id, cohort_hash) do nothing returning id::text
      `));
      if (inserted.length > 1) fail("corrupt_store");
      return Object.freeze({ outcome: inserted.length === 1 ? "inserted" as const : "unchanged" as const, cohortRef, cohortHash, result, capabilities: CAPABILITIES });
    });
  }
}
