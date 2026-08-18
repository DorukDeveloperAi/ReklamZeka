import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DrizzleGuideRunCandidateStagingContextRepository } from "@/connectors/guides/guide-run-candidate-staging-context-drizzle-repository";
import { parseGuideRunStatusCandidate } from "@/connectors/guides/guide-run-status-action-stager";
import type { CurrentSliceEvidence, OperationReadTransaction } from "@/connectors/operations/operation-read-drizzle-repository";
import * as schema from "@/db/schema";
import { buildActionPlan } from "@/domain/actions/autonomy-valve";
import { createP06LimitedAutonomyAdmission } from "@/domain/actions/p06-limited-autonomy-admission";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";
import { metaPublicReference } from "@/domain/meta/public-reference";

type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const one = (rows: readonly Row[]) => rows.length === 1 ? rows[0]! : null;
const text = (row: Row, key: string) => typeof row[key] === "string" ? row[key] as string : fail("corrupt_store");
const fail = (code: P06LimitedAutonomyAdmissionRepositoryError["code"]): never => { throw new P06LimitedAutonomyAdmissionRepositoryError(code); };
const required = <T>(value: T | null | undefined, code: P06LimitedAutonomyAdmissionRepositoryError["code"] = "corrupt_store"): T => value ?? fail(code);

export class P06LimitedAutonomyAdmissionRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "context_rejected" | "quota_exhausted" | "conflict" | "corrupt_store") {
    super(`Limited autonomy admission persistence rejected: ${code}`); this.name = "P06LimitedAutonomyAdmissionRepositoryError";
  }
}

type CurrentSlicePort = Readonly<{ currentSliceEvidenceInTransaction(transaction: OperationReadTransaction, workspaceId: string, sliceRef: string | null): Promise<CurrentSliceEvidence> }>;

/**
 * Server-private, non-executable materializer. It reserves one run quota slot
 * but never creates an approval, execution run, lease, or network capability.
 */
export class DrizzleP06LimitedAutonomyAdmissionRepository {
  constructor(private readonly database: Database,
    private readonly contexts: Pick<DrizzleGuideRunCandidateStagingContextRepository, "loadInTransaction">,
    private readonly scopes: CurrentSlicePort) {}

  async reserve(input: Readonly<{ workspaceId: string; runRef: string }>) {
    if (!UUID.test(input.workspaceId) || !REF.test(input.runRef)) fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const sourceResult = await tx.execute(sql`
        select r.id::text run_id,r.guide_revision_id::text guide_revision_id,a.id::text artifact_id,
          a.payload->'disposition'->'candidate'->>'candidateHash' candidate_hash,
          a.payload->'disposition'->'candidate'->>'action' action,
          a.payload->'disposition'->'candidate'->'stageable'->>'entityRef' member_ref,
          a.payload->'disposition'->'candidate'->'stageable'->>'membershipHash' membership_hash,
          a.payload->'disposition'->'candidate'->'stageable'->'typedAction' typed_action,
          gr.slice_ref,gr.market_key
        from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id and h.state='completed'
        join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id and a.kind='disposition'
        join guide_revisions gr on gr.workspace_id=r.workspace_id and gr.id=r.guide_revision_id and gr.mode='limited_autonomy'
        join guide_heads gh on gh.workspace_id=r.workspace_id and gh.guide_id=r.guide_id and gh.current_active_revision_id=r.guide_revision_id
        join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null
        join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active'
        where r.workspace_id=${input.workspaceId}::uuid and r.run_ref=${input.runRef}
          and a.payload->'disposition'->'candidate'->>'routing'='limited_autonomy_review'
        order by a.created_at,a.id limit 2 for update of r,h,a,gr,gh,g,w
      `);
      const source = required(one(sourceResult.rows as Row[]), "not_found");
      const existing = one((await tx.execute(sql`select id::text,admission_hash,quota_ordinal from p06_limited_autonomy_admissions
        where workspace_id=${input.workspaceId}::uuid and disposition_artifact_id=${text(source,"artifact_id")}::uuid limit 2`)).rows as Row[]);
      if (existing) return Object.freeze({ admissionId: text(existing,"id"), admissionHash: text(existing,"admission_hash"), quotaOrdinal: Number(existing.quota_ordinal), replay: true });
      if (text(source,"action") !== "status_pause" || !source.typed_action || typeof source.typed_action !== "object" || Array.isArray(source.typed_action)) fail("context_rejected");
      const memberRef = text(source,"member_ref"), membershipHash = text(source,"membership_hash"), sliceRef = text(source,"slice_ref");
      if (!REF.test(memberRef) || !HASH.test(membershipHash) || !REF.test(sliceRef) || source.market_key !== "yerli" && source.market_key !== "yabanci") fail("corrupt_store");
      const publicIntent = parseGuideRunStatusCandidate({ action: "status_pause", typedAction: source.typed_action as Record<string, unknown>, memberRef });
      let scope: CurrentSliceEvidence;
      try { scope = await this.scopes.currentSliceEvidenceInTransaction(tx as OperationReadTransaction, input.workspaceId, sliceRef); }
      catch { return fail("context_rejected"); }
      if (scope.sliceRef !== sliceRef || scope.market?.key !== source.market_key || scope.revisionRef === null || scope.definitionHash === null) fail("context_rejected");
      const evaluation = required(scope.resolution?.included.find((item) => item.entityLevel === "ad_set" && item.entityRef === memberRef), "context_rejected");
      const memberId = required(scope.adSetIds.find((id) => metaPublicReference("ad_set", input.workspaceId, id) === memberRef), "context_rejected");
      if (guideRunMembershipEvidenceHash({ sliceRef, revisionRef: required(scope.revisionRef), definitionHash: required(scope.definitionHash), membership: evaluation }) !== membershipHash) fail("context_rejected");
      const entityRow = required(one((await tx.execute(sql`select external_ad_set_id entity_ref from meta_ad_sets where workspace_id=${input.workspaceId}::uuid and id=${memberId}::uuid limit 2`)).rows as Row[]), "context_rejected");
      const entityRef = text(entityRow,"entity_ref");
      if (!REF.test(entityRef)) fail("context_rejected");
      const intent = Object.freeze({ ...publicIntent, entity: Object.freeze({ level: "adset" as const, ref: entityRef }) });
      const nowRow = one((await tx.execute(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`)).rows as Row[]);
      const admittedAt = nowRow ? text(nowRow,"now") : fail("corrupt_store");
      let context: Awaited<ReturnType<DrizzleGuideRunCandidateStagingContextRepository["loadInTransaction"]>>;
      const market = source.market_key === "yerli" ? "yerli" as const : source.market_key === "yabanci" ? "yabanci" as const : fail("corrupt_store");
      try { context = await this.contexts.loadInTransaction(tx, { workspaceId: input.workspaceId, guideRevisionId: text(source,"guide_revision_id"), entityRef,
        actionHash: digest(intent), sliceRef, market, action: "status_pause", at: admittedAt, authority: "limited_autonomy" }); }
      catch { return fail("context_rejected"); }
      if (context.currentStatus !== "ACTIVE" || context.entityRef !== entityRef) fail("context_rejected");
      const actionPlan = buildActionPlan(intent, { workspaceRef: context.workspaceRef, accountGroupRef: null, accountRef: context.accountRef,
        internalCategoryRefs: context.protection.protectedInternalCategoryRefs, campaignRef: context.campaignRef, entity: intent.entity,
        evaluatedAt: admittedAt, rules: context.rules, budgetLimits: null, protection: context.protection, frozenContextHash: context.contextHash });
      if (actionPlan.disposition !== "policy_limited_candidate") fail("context_rejected");
      const cap = required([...actionPlan.trace].reverse().find((item) => item.maximumActionsPerRun !== null)?.maximumActionsPerRun, "context_rejected");
      const ruleResult = await tx.execute(sql`with latest as (select distinct on(rule_ref) rule_ref,revision,state,mode,scope_level,scope_ref,action_type,kill_switch,effective_from,expires_at,maximum_actions_per_run,canonical_hash
        from autonomy_rule_revisions where workspace_id=${input.workspaceId}::uuid and state in ('published','disabled') order by rule_ref,revision desc)
        select canonical_hash from latest where state='published' and mode='policy_limited' and not kill_switch and effective_from<=${admittedAt}::timestamptz
          and (expires_at is null or expires_at>${admittedAt}::timestamptz) order by canonical_hash`);
      const ruleRows = ruleResult.rows as Row[];
      if (ruleRows.length !== 2 || ruleRows.some((row) => !HASH.test(text(row,"canonical_hash")))) fail("context_rejected");
      const autonomyEvidenceHash = digest({ ruleHashes: ruleRows.map((row) => text(row,"canonical_hash")) });
      const counted = required(one((await tx.execute(sql`select count(*)::integer reserved from p06_limited_autonomy_admissions where workspace_id=${input.workspaceId}::uuid and run_id=${text(source,"run_id")}::uuid`)).rows as Row[]));
      const reserved = Number(counted.reserved);
      if (!Number.isSafeInteger(reserved) || reserved >= cap) fail("quota_exhausted");
      const admission = createP06LimitedAutonomyAdmission({ memberRef, membershipHash, entityRef, accountRef: context.accountRef, campaignRef: context.campaignRef,
        actionPlan, contextHash: context.contextHash, effectiveGuideSetHash: context.effectiveGuideSetHash, resolutionHash: context.resolutionHash,
        dataHealthReportHash: context.dataHealthReportHash, approvalPolicyHash: context.approvalPolicyHash,
        protectionHash: digest(context.protection), autonomyEvidenceHash,
        maximumActionsPerRun: cap, actionsAlreadyReserved: reserved, admittedAt, expiresAt: new Date(Date.parse(admittedAt) + 300_000).toISOString() });
      const payload = admission.payload as Record<string, unknown>;
      const inserted = required(one((await tx.execute(sql`insert into p06_limited_autonomy_admissions(workspace_id,run_id,guide_revision_id,disposition_artifact_id,
        member_ref,membership_hash,entity_ref,account_ref,campaign_ref,action_type,expected_status,desired_status,context_hash,effective_guide_set_hash,resolution_hash,
        data_health_report_hash,approval_policy_hash,protection_hash,autonomy_evidence_hash,action_plan_hash,maximum_actions_per_run,quota_ordinal,admitted_at,expires_at,admission_hash,admission_payload)
        values(${input.workspaceId}::uuid,${text(source,"run_id")}::uuid,${text(source,"guide_revision_id")}::uuid,${text(source,"artifact_id")}::uuid,
          ${memberRef},${membershipHash},${entityRef},${context.accountRef},${context.campaignRef},'status_pause','ACTIVE','PAUSED',${context.contextHash},${context.effectiveGuideSetHash},${context.resolutionHash},
          ${context.dataHealthReportHash},${context.approvalPolicyHash},${digest(context.protection)},${autonomyEvidenceHash},${actionPlan.planHash},${cap},${reserved+1},${admittedAt}::timestamptz,${String(payload.expiresAt)}::timestamptz,
          ${admission.admissionHash},${JSON.stringify(payload)}::jsonb) returning id::text,admission_hash,quota_ordinal`)).rows as Row[]), "conflict");
      return Object.freeze({ admissionId: text(inserted,"id"), admissionHash: text(inserted,"admission_hash"), quotaOrdinal: Number(inserted.quota_ordinal), replay: false });
    });
  }
}
