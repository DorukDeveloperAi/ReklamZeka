import "server-only";

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { P06StatusExecutionDispatchAuthority } from "@/application/p06-status-execution-worker";
import type { GuideBudgetActionAdmissionGate } from "@/connectors/actions/action-execution-admission-source-drizzle-repository";
import * as schema from "@/db/schema";
import type { TypedActionIntent } from "@/domain/actions/autonomy-valve";
import { p06ExecutionV2Digest } from "@/domain/actions/p06-execution-v2";

type Database = NodePgDatabase<typeof schema>;
const EXECUTION = /^p06_execution_[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID_HEX = /^[a-f0-9]{32}$/;

/**
 * Final Guide-budget authority check. The immutable approval/admission row is
 * only evidence: this boundary replays the canonical P04 Guide gate at the
 * database clock immediately after claim and again immediately before write.
 */
export class DrizzleP06GuideBudgetExecutionDispatchAuthorityRepository implements P06StatusExecutionDispatchAuthority {
  constructor(private readonly database: Pick<Database, "transaction">, private readonly guideGate: GuideBudgetActionAdmissionGate) {}

  async revalidate(input: Parameters<P06StatusExecutionDispatchAuthority["revalidate"]>[0]) {
    const denied = (reason: string) => Object.freeze({ allowed: false, authorityHash: p06ExecutionV2Digest({
      version: "p06-guide-budget-dispatch-authority/1.0.0", phase: input.phase, executionRef: input.executionRef, allowed: false, reason }) });
    if (!EXECUTION.test(input.executionRef) || (input.phase !== "post_claim" && input.phase !== "pre_dispatch")
      || (input.request.action !== "budget_decrease" && input.request.action !== "budget_increase")) return denied("invalid_identity");
    return this.database.transaction(async (tx) => {
      const result = await tx.execute(sql`
        select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') authorized_at,
          r.workspace_id::text workspace_id,r.request_hash,r.admission_hash,r.write_spec_hash,r.dry_run_hash,
          r.action_plan_hash,r.context_hash,r.policy_hash,r.budget_kind,r.currency,
          a.id::text attempt_id,a.admission_hash attempt_admission_hash,a.write_spec_hash attempt_write_spec_hash,
          u.unit_ref,u.unit_hash,u.source_hash,u.context_hash unit_context_hash,u.action_plan_hash unit_action_plan_hash,
          u.action_hash,u.action_plan_payload,u.expires_at,bundle.plan_ref,bundle.plan_revision,bundle.plan_hash,
          g.grant_hash,connection.lifecycle_generation connection_generation
        from p06_execution_runs r
        join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
        join action_execution_attempts a on a.workspace_id=r.workspace_id and a.id=r.action_execution_attempt_id
          and a.bundle_id=r.proposal_bundle_id and a.unit_id=r.action_unit_id and a.decision_event_id=r.decision_event_id
          and a.approval_grant_id=r.approval_grant_id and a.admission_hash=r.admission_hash and a.write_spec_hash=r.write_spec_hash
        join action_proposal_units u on u.workspace_id=r.workspace_id and u.id=r.action_unit_id
          and u.bundle_id=r.proposal_bundle_id and u.unit_hash=r.action_unit_hash and u.context_hash=r.context_hash
          and u.action_plan_hash=r.action_plan_hash and u.expires_at>statement_timestamp()
          and u.account_ref=r.request_payload->>'accountRef' and u.entity_ref=r.request_payload->>'entityRef'
          and u.action_type=r.request_payload->>'action'
        join action_proposal_bundles bundle on bundle.workspace_id=r.workspace_id and bundle.id=r.proposal_bundle_id
          and bundle.plan_hash=r.proposal_hash
        join action_approval_decision_events decision on decision.workspace_id=r.workspace_id and decision.id=r.decision_event_id
          and decision.bundle_id=bundle.id and decision.unit_id=u.id and decision.command_kind='approve' and decision.unit_hash=u.unit_hash
        join action_approval_evidence_grants g on g.workspace_id=r.workspace_id and g.id=r.approval_grant_id
          and g.decision_event_id=decision.id and g.bundle_id=bundle.id and g.unit_id=u.id and g.unit_hash=u.unit_hash
          and g.approved_at<=statement_timestamp() and g.expires_at>statement_timestamp()
          and g.capability='approval_evidence_only' and g.can_execute=false
        join action_approval_policy_snapshots policy on policy.workspace_id=r.workspace_id
          and policy.id=bundle.policy_snapshot_id and policy.policy_hash=r.policy_hash
        join ad_accounts account on account.workspace_id=r.workspace_id and account.id=u.ad_account_id
          and account.external_account_id=r.request_payload->>'accountRef' and account.disappeared_at is null
        join data_sources source on source.workspace_id=account.workspace_id and source.id=account.data_source_id and source.platform='meta_ads'
        join meta_connections connection on connection.workspace_id=source.workspace_id and connection.id=source.meta_connection_id
          and connection.status='active' and connection.disconnected_at is null and connection.revoked_at is null
          and connection.secret_disabled_at is null and connection.secret_destroyed_at is null
          and (connection.token_expires_at is null or connection.token_expires_at>statement_timestamp())
          and (connection.data_access_expires_at is null or connection.data_access_expires_at>statement_timestamp())
        where r.execution_ref=${input.executionRef} and r.route='guide_budget_human_approved'
          and r.guide_run_action_binding_id is null and r.effective_guide_set_hash is null and r.resolution_hash is null
          and r.request_payload->>'workspaceRef'=${input.request.workspaceRef}
          and r.request_payload->>'accountRef'=${input.request.accountRef}
          and r.request_payload->>'entityRef'=${input.request.entityRef}
          and r.request_payload->>'action'=${input.request.action}
          and r.request_payload->>'budgetKind'=${input.request.budgetKind ?? null}
          and r.request_payload->>'currency'=${input.request.currency ?? null}
        for share of r,a,u,bundle,decision,g,policy,account,source,connection limit 2
      `);
      const row = result.rows.length === 1 ? result.rows[0] as Record<string, unknown> : null;
      const identity = row && typeof row.plan_ref === "string"
        ? /^guide_budget_([a-f0-9]{32})_([a-f0-9]{64})$/.exec(row.plan_ref) : null;
      let gateAccepted = false;
      if (row && identity && UUID_HEX.test(identity[1]!) && HASH.test(identity[2]!) && identity[2] === row.dry_run_hash
        && row.admission_hash === row.attempt_admission_hash && row.write_spec_hash === row.attempt_write_spec_hash
        && row.context_hash === row.unit_context_hash && row.action_plan_hash === row.unit_action_plan_hash
        && row.action_plan_payload && typeof row.action_plan_payload === "object" && !Array.isArray(row.action_plan_payload)) {
        const plan = row.action_plan_payload as Record<string, unknown>;
        const action = plan.action as Extract<TypedActionIntent, { kind: "budget_change" }>;
        try {
          gateAccepted = await this.guideGate.revalidatePersisted({ workspaceId: String(row.workspace_id),
            guideRevisionId: `${identity[1]!.slice(0,8)}-${identity[1]!.slice(8,12)}-${identity[1]!.slice(12,16)}-${identity[1]!.slice(16,20)}-${identity[1]!.slice(20)}`,
            binding: { unitRef: String(row.unit_ref), plan: { planRef: String(row.plan_ref), revision: Number(row.plan_revision), planHash: String(row.plan_hash) },
              sourceHash: String(row.source_hash), contextHash: String(row.unit_context_hash), actionPlanHash: String(row.unit_action_plan_hash),
              actionHash: String(row.action_hash), action, expiresAt: new Date(String(row.expires_at)).toISOString() },
            evaluatedAt: String(row.authorized_at) });
        } catch { gateAccepted = false; }
      }
      const allowed = gateAccepted === true;
      const core = { version: "p06-guide-budget-dispatch-authority/1.0.0", phase: input.phase,
        executionRef: input.executionRef, allowed, authorizedAt: row?.authorized_at ?? null, requestHash: row?.request_hash ?? null,
        admissionHash: row?.admission_hash ?? null, writeSpecHash: row?.write_spec_hash ?? null, dryRunHash: row?.dry_run_hash ?? null,
        actionPlanHash: row?.action_plan_hash ?? null, contextHash: row?.context_hash ?? null, policyHash: row?.policy_hash ?? null,
        grantHash: row?.grant_hash ?? null, connectionGeneration: row ? Number(row.connection_generation) : null };
      return Object.freeze({ allowed, authorityHash: p06ExecutionV2Digest(core) });
    });
  }
}
