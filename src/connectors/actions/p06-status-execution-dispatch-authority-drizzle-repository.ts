import "server-only";

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { P06StatusExecutionDispatchAuthority } from "@/application/p06-status-execution-worker";
import type { DrizzleGuideRunCandidateStagingContextRepository } from "@/connectors/guides/guide-run-candidate-staging-context-drizzle-repository";
import * as schema from "@/db/schema";
import { p06ExecutionV2Digest } from "@/domain/actions/p06-execution-v2";

type Database = NodePgDatabase<typeof schema>;
const EXECUTION = /^p06_execution_[a-f0-9]{24}$/;

/**
 * Current dispatch authority is deliberately separate from immutable approval
 * evidence. Every check uses PostgreSQL's transaction timestamp, and failure
 * is a normal closed hold rather than permission to reuse stale evidence.
 */
export class DrizzleP06StatusExecutionDispatchAuthorityRepository
  implements P06StatusExecutionDispatchAuthority
{
  constructor(
    private readonly database: Pick<Database, "transaction">,
    private readonly contexts: Pick<
      DrizzleGuideRunCandidateStagingContextRepository,
      "loadInTransaction"
    >,
  ) {}

  async revalidate(
    input: Parameters<P06StatusExecutionDispatchAuthority["revalidate"]>[0],
  ) {
    const supportedAction = input.request.action === "status_pause" || input.request.action === "status_activate"
      || input.request.action === "budget_decrease" || input.request.action === "budget_increase"
      || input.request.action === "campaign_rename" || input.request.action === "adset_rename" || input.request.action === "ad_rename";
    if (
      !EXECUTION.test(input.executionRef) ||
      (input.phase !== "post_claim" && input.phase !== "pre_dispatch") || !supportedAction
    ) {
      return Object.freeze({
        allowed: false,
        authorityHash: p06ExecutionV2Digest({
          version: "p06-dispatch-authority/1.0.0",
          phase: input.phase,
          executionRef: input.executionRef,
          allowed: false,
          reason: "invalid_identity",
        }),
      });
    }
    return this.database.transaction(async (tx) => {
      const routeResult = await tx.execute(sql`select route from p06_execution_runs where execution_ref=${input.executionRef} limit 2`);
      const route = routeResult.rows.length === 1 ? (routeResult.rows[0] as Record<string, unknown>).route : null;
      if (route === "human_rename_approved") {
        const result = await tx.execute(sql`
          select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') authorized_at,
            r.request_hash,r.context_hash,r.policy_hash,r.admission_hash,r.write_spec_hash,r.action_plan_hash,
            u.unit_hash,g.grant_hash,connection.lifecycle_generation,
            case when u.campaign_id is not null then campaign.configured_status
              when u.ad_set_id is not null then ad_set.configured_status else ad.configured_status end current_status,
            case when u.campaign_id is not null then campaign.name
              when u.ad_set_id is not null then ad_set.name else ad.name end current_name
          from p06_execution_runs r
          join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
          join action_execution_attempts attempt on attempt.workspace_id=r.workspace_id and attempt.id=r.action_execution_attempt_id
            and attempt.admission_hash=r.admission_hash and attempt.write_spec_hash=r.write_spec_hash
          join action_proposal_units u on u.workspace_id=r.workspace_id and u.id=r.action_unit_id
            and u.id=attempt.unit_id and u.bundle_id=attempt.bundle_id and u.unit_hash=r.action_unit_hash
            and u.context_hash=r.context_hash and u.action_plan_hash=r.action_plan_hash and u.expires_at>statement_timestamp()
          join action_proposal_bundles bundle on bundle.workspace_id=r.workspace_id and bundle.id=r.proposal_bundle_id
            and bundle.id=attempt.bundle_id and bundle.plan_hash=r.proposal_hash
          join action_approval_decision_events decision on decision.workspace_id=r.workspace_id and decision.id=r.decision_event_id
            and decision.id=attempt.decision_event_id and decision.bundle_id=bundle.id and decision.unit_id=u.id
            and decision.command_kind='approve' and decision.unit_hash=u.unit_hash
          join action_approval_evidence_grants g on g.workspace_id=r.workspace_id and g.id=r.approval_grant_id
            and g.id=attempt.approval_grant_id and g.decision_event_id=decision.id and g.bundle_id=bundle.id and g.unit_id=u.id
            and g.unit_hash=u.unit_hash and g.approved_at<=statement_timestamp() and g.expires_at>statement_timestamp()
            and g.capability='approval_evidence_only' and g.can_execute=false
          join action_approval_policy_snapshots policy on policy.workspace_id=r.workspace_id and policy.id=bundle.policy_snapshot_id and policy.policy_hash=r.policy_hash
          join approval_policy_definition_revisions policy_source on policy_source.workspace_id=policy.workspace_id
            and policy_source.id=policy.source_definition_id and policy_source.canonical_hash=policy.source_definition_canonical_hash
            and policy_source.policy_hash=policy.policy_hash and policy_source.state='published'
            and policy_source.action_type=u.action_type and policy_source.risk='K3'
            and policy_source.effective_from<=statement_timestamp() and (policy_source.expires_at is null or policy_source.expires_at>statement_timestamp())
          join effective_campaign_contexts context on context.workspace_id=r.workspace_id and context.context_hash=r.context_hash
            and context.account_ref=r.request_payload->>'accountRef' and context.entity_ref=r.request_payload->>'entityRef'
            and context.captured_at<=statement_timestamp()
          join ad_accounts account on account.workspace_id=context.workspace_id and account.id=context.ad_account_id
            and account.disappeared_at is null and account.external_account_id=r.request_payload->>'accountRef'
          join data_sources source on source.workspace_id=account.workspace_id and source.id=account.data_source_id and source.platform='meta_ads'
          join meta_connections connection on connection.workspace_id=source.workspace_id and connection.id=source.meta_connection_id
            and connection.status='active' and connection.disconnected_at is null and connection.revoked_at is null
            and connection.secret_disabled_at is null and connection.secret_destroyed_at is null
            and (connection.token_expires_at is null or connection.token_expires_at>statement_timestamp())
            and (connection.data_access_expires_at is null or connection.data_access_expires_at>statement_timestamp())
          left join ad_campaigns campaign on campaign.workspace_id=u.workspace_id and campaign.id=u.campaign_id and campaign.disappeared_at is null
          left join meta_ad_sets ad_set on ad_set.workspace_id=u.workspace_id and ad_set.id=u.ad_set_id and ad_set.disappeared_at is null
          left join meta_ads ad on ad.workspace_id=u.workspace_id and ad.id=u.ad_id and ad.disappeared_at is null
          where r.execution_ref=${input.executionRef}
            and r.request_payload->>'workspaceRef'=${input.request.workspaceRef}
            and r.request_payload->>'accountRef'=${input.request.accountRef}
            and r.request_payload->>'entityRef'=${input.request.entityRef}
            and r.request_payload->>'action'=${input.request.action}
            and u.action_type in ('campaign_rename','adset_rename','ad_rename') and u.action_plan_payload#>>'{action,kind}'='rename'
            and u.action_plan_payload#>>'{action,entity,ref}'=u.entity_ref
            and u.action_plan_payload#>>'{action,beforeName}'=r.request_payload#>>'{expectedBefore,name}'
            and u.action_plan_payload#>>'{action,afterName}'=r.request_payload#>>'{desired,name}'
            and r.request_payload#>>'{expectedBefore,status}'=r.request_payload#>>'{desired,status}'
            and r.request_payload#>'{expectedBefore,budgetMinor}'='null'::jsonb and r.request_payload#>'{desired,budgetMinor}'='null'::jsonb
            and ((u.action_type='campaign_rename' and u.campaign_id is not null and u.ad_set_id is null and u.ad_id is null)
              or (u.action_type='adset_rename' and u.campaign_id is null and u.ad_set_id is not null and u.ad_id is null)
              or (u.action_type='ad_rename' and u.campaign_id is null and u.ad_set_id is null and u.ad_id is not null))
            and not exists (select 1 from approval_policy_definition_revisions newer
              where newer.workspace_id=policy_source.workspace_id and newer.policy_ref=policy_source.policy_ref
                and newer.revision>policy_source.revision and newer.state in ('published','disabled') and newer.effective_from<=statement_timestamp())
            and not exists (select 1 from effective_campaign_context_components component
              join effective_campaign_context_invalidations invalidation on invalidation.workspace_id=component.workspace_id
                and invalidation.component_type=component.component_type and invalidation.component_ref=component.component_ref
                and invalidation.component_version=component.component_version
              where component.workspace_id=context.workspace_id and component.context_id=context.id
                and (invalidation.entity_type is null or (invalidation.entity_type=context.entity_type and invalidation.entity_ref=context.entity_ref)))
          limit 2
        `);
        const row = result.rows.length === 1 ? result.rows[0] as Record<string, unknown> : null;
        const allowed = Boolean(row && (row.current_status === "ACTIVE" || row.current_status === "PAUSED")
          && row.current_status === input.request.expectedBefore.status && row.current_name === input.request.expectedBefore.name
          && input.request.desired.name !== input.request.expectedBefore.name);
        return Object.freeze({ allowed, authorityHash: p06ExecutionV2Digest({
          version: "p06-dispatch-authority/1.0.0", phase: input.phase, executionRef: input.executionRef, allowed,
          authorizedAt: allowed ? row!.authorized_at : null, requestHash: allowed ? row!.request_hash : null,
          contextHash: allowed ? row!.context_hash : null, policyHash: allowed ? row!.policy_hash : null,
          admissionHash: allowed ? row!.admission_hash : null, writeSpecHash: allowed ? row!.write_spec_hash : null,
          actionPlanHash: allowed ? row!.action_plan_hash : null, unitHash: allowed ? row!.unit_hash : null,
          grantHash: allowed ? row!.grant_hash : null, currentStatus: allowed ? row!.current_status : null,
          currentName: allowed ? row!.current_name : null, connectionGeneration: allowed ? Number(row!.lifecycle_generation) : null,
        }) });
      }
      if (route === "limited_autonomy_status") {
        const limitedResult = await tx.execute(sql`
          select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') authorized_at,
            r.request_hash,r.workspace_id::text workspace_id,r.context_hash,r.effective_guide_set_hash,
            r.resolution_hash,r.policy_hash,r.autonomy_evidence_hash,r.data_health_report_hash,r.protection_hash,
            admission.guide_revision_id::text guide_revision_id,revision.slice_ref,revision.market_key,
            admission.admission_hash,admission.action_plan_hash,
            admission.admission_payload#>'{actionPlan,action}' action_intent,
            context.context_hash current_context_hash,connection.lifecycle_generation connection_generation
          from p06_execution_runs r
          join p06_limited_autonomy_admissions admission on admission.workspace_id=r.workspace_id
            and admission.id=r.limited_autonomy_admission_id and admission.expires_at>statement_timestamp()
            and admission.action_type='status_pause' and admission.expected_status='ACTIVE' and admission.desired_status='PAUSED'
          join guide_runs guide_run on guide_run.workspace_id=admission.workspace_id and guide_run.id=admission.run_id
            and guide_run.guide_revision_id=admission.guide_revision_id
          join guides guide on guide.workspace_id=guide_run.workspace_id and guide.id=guide_run.guide_id and guide.tombstoned_at is null
          join guide_heads guide_head on guide_head.workspace_id=guide.workspace_id and guide_head.guide_id=guide.id
            and guide_head.current_active_revision_id=admission.guide_revision_id
          join guide_revisions revision on revision.workspace_id=guide_run.workspace_id
            and revision.id=admission.guide_revision_id and revision.mode='limited_autonomy'
          join workspaces workspace on workspace.id=r.workspace_id and workspace.lifecycle_state='active' and workspace.tombstoned_at is null
          join effective_campaign_contexts context on context.workspace_id=r.workspace_id and context.context_hash=r.context_hash
            and context.account_ref=admission.account_ref and context.entity_ref=admission.entity_ref
            and context.captured_at<=statement_timestamp()
          join ad_accounts account on account.workspace_id=context.workspace_id and account.id=context.ad_account_id
            and account.disappeared_at is null and account.external_account_id=admission.account_ref
          join data_sources source on source.workspace_id=account.workspace_id and source.id=account.data_source_id and source.platform='meta_ads'
          join meta_connections connection on connection.workspace_id=source.workspace_id and connection.id=source.meta_connection_id
            and connection.status='active' and connection.disconnected_at is null and connection.revoked_at is null
            and connection.secret_disabled_at is null and connection.secret_destroyed_at is null
            and (connection.token_expires_at is null or connection.token_expires_at>statement_timestamp())
            and (connection.data_access_expires_at is null or connection.data_access_expires_at>statement_timestamp())
          where r.execution_ref=${input.executionRef}
            and r.request_payload->>'workspaceRef'=${input.request.workspaceRef}
            and r.request_payload->>'accountRef'=${input.request.accountRef}
            and r.request_payload->>'entityRef'=${input.request.entityRef}
            and r.request_payload->>'action'=${input.request.action}
            and not exists(select 1 from effective_campaign_context_components component
              join effective_campaign_context_invalidations invalidation on invalidation.workspace_id=component.workspace_id
                and invalidation.component_type=component.component_type and invalidation.component_ref=component.component_ref
                and invalidation.component_version=component.component_version
              where component.workspace_id=context.workspace_id and component.context_id=context.id
                and (invalidation.entity_type is null or (invalidation.entity_type=context.entity_type and invalidation.entity_ref=context.entity_ref)))
          for share of r,admission,guide_run,guide,guide_head,revision,workspace,context,account,source,connection
          limit 2
        `);
        const row = limitedResult.rows.length === 1 ? limitedResult.rows[0] as Record<string, unknown> : null;
        let current: Awaited<ReturnType<DrizzleGuideRunCandidateStagingContextRepository["loadInTransaction"]>> | null = null;
        if (row && row.action_intent && typeof row.action_intent === "object") {
          try {
            current = await this.contexts.loadInTransaction(tx, {
              workspaceId: String(row.workspace_id),
              guideRevisionId: String(row.guide_revision_id),
              entityRef: input.request.entityRef,
              actionHash: p06ExecutionV2Digest(row.action_intent),
              sliceRef: String(row.slice_ref),
              market: row.market_key as "yerli" | "yabanci",
              action: "status_pause",
              at: String(row.authorized_at),
              authority: "limited_autonomy",
            });
          } catch {
            current = null;
          }
        }
        const ruleResult = row ? await tx.execute(sql`with latest as (
          select distinct on(rule_ref) rule_ref,state,mode,scope_level,scope_ref,action_type,kill_switch,
            effective_from,expires_at,canonical_hash
          from autonomy_rule_revisions where workspace_id=${String(row.workspace_id)}::uuid and state in ('published','disabled')
          order by rule_ref,revision desc)
          select canonical_hash from latest where state='published' and mode='policy_limited' and not kill_switch
            and effective_from<=${String(row.authorized_at)}::timestamptz
            and (expires_at is null or expires_at>${String(row.authorized_at)}::timestamptz)
            and ((scope_level='workspace' and scope_ref=${input.request.workspaceRef} and action_type is null)
              or (scope_level='action_type' and scope_ref is null and action_type='status_pause'))
          order by canonical_hash`) : null;
        const ruleHashes = ruleResult?.rows.map((item) => (item as Record<string, unknown>).canonical_hash);
        const currentAutonomyHash = ruleHashes?.length === 2 && ruleHashes.every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
          ? p06ExecutionV2Digest({ ruleHashes })
          : null;
        const allowed = Boolean(row && current
          && current.workspaceRef === input.request.workspaceRef
          && current.accountRef === input.request.accountRef
          && current.entityRef === input.request.entityRef
          && current.currentStatus === input.request.expectedBefore.status
          && current.contextHash === row.context_hash
          && current.approvalPolicyHash === row.policy_hash
          && current.effectiveGuideSetHash === row.effective_guide_set_hash
          && current.resolutionHash === row.resolution_hash
          && currentAutonomyHash === row.autonomy_evidence_hash);
        const core = {
          version: "p06-dispatch-authority/1.0.0",
          route: "limited_autonomy_status",
          phase: input.phase,
          executionRef: input.executionRef,
          allowed,
          authorizedAt: allowed ? row!.authorized_at : null,
          requestHash: allowed ? row!.request_hash : null,
          contextHash: allowed ? current!.contextHash : null,
          effectiveGuideSetHash: allowed ? current!.effectiveGuideSetHash : null,
          resolutionHash: allowed ? current!.resolutionHash : null,
          policyHash: allowed ? current!.approvalPolicyHash : null,
          admissionHash: allowed ? row!.admission_hash : null,
          actionPlanHash: allowed ? row!.action_plan_hash : null,
          autonomyEvidenceHash: allowed ? currentAutonomyHash : null,
          dataHealthReportHash: allowed ? current!.dataHealthReportHash : null,
          protectionHash: allowed ? p06ExecutionV2Digest(current!.protection) : null,
          connectionGeneration: allowed ? Number(row!.connection_generation) : null,
        };
        return Object.freeze({ allowed, authorityHash: p06ExecutionV2Digest(core) });
      }
      const result = await tx.execute(sql`
        select
          to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') authorized_at,
          r.request_hash,
          r.workspace_id::text workspace_id,
          r.context_hash,
          r.effective_guide_set_hash,
          r.resolution_hash,
          r.policy_hash,
          b.guide_revision_id::text guide_revision_id,
          b.slice_ref,
          b.market_key,
          u.unit_hash,
          u.action_hash,
          g.grant_hash,
          c.context_hash current_context_hash,
          connection.lifecycle_generation connection_generation
        from p06_execution_runs r
        join workspaces w on w.id=r.workspace_id
          and w.lifecycle_state='active' and w.tombstoned_at is null
        join guide_run_action_bindings b on b.workspace_id=r.workspace_id
          and b.id=r.guide_run_action_binding_id
        join guide_runs guide_run on guide_run.workspace_id=b.workspace_id
          and guide_run.id=b.run_id and guide_run.guide_revision_id=b.guide_revision_id
        join guides guide on guide.workspace_id=guide_run.workspace_id
          and guide.id=guide_run.guide_id and guide.tombstoned_at is null
        join guide_heads guide_head on guide_head.workspace_id=guide.workspace_id
          and guide_head.guide_id=guide.id
          and guide_head.current_active_revision_id=b.guide_revision_id
        join action_proposal_units u on u.workspace_id=r.workspace_id
          and u.id=r.action_unit_id and u.id=b.action_unit_id
          and u.unit_hash=r.action_unit_hash and u.expires_at>statement_timestamp()
          and u.account_ref=r.request_payload->>'accountRef'
          and u.entity_ref=r.request_payload->>'entityRef'
          and u.action_type=r.request_payload->>'action'
        join action_proposal_bundles bundle on bundle.workspace_id=r.workspace_id
          and bundle.id=r.proposal_bundle_id and bundle.id=b.proposal_bundle_id
          and bundle.bundle_hash=r.proposal_hash
        join action_approval_decision_events decision on decision.workspace_id=r.workspace_id
          and decision.id=r.decision_event_id and decision.bundle_id=bundle.id
          and decision.unit_id=u.id and decision.command_kind='approve'
          and decision.unit_hash=u.unit_hash
        join action_approval_evidence_grants g on g.workspace_id=r.workspace_id
          and g.id=r.approval_grant_id and g.decision_event_id=decision.id
          and g.bundle_id=bundle.id and g.unit_id=u.id
          and g.unit_hash=u.unit_hash and g.approved_at<=statement_timestamp()
          and g.expires_at>statement_timestamp()
          and g.capability='approval_evidence_only' and g.can_execute=false
        join action_approval_policy_snapshots policy on policy.workspace_id=r.workspace_id
          and policy.id=bundle.policy_snapshot_id and policy.policy_hash=r.policy_hash
        join approval_policy_definition_revisions policy_source
          on policy_source.workspace_id=policy.workspace_id
          and policy_source.id=policy.source_definition_id
          and policy_source.canonical_hash=policy.source_definition_canonical_hash
          and policy_source.policy_hash=policy.policy_hash
          and policy_source.state='published'
          and policy_source.effective_from<=statement_timestamp()
          and (policy_source.expires_at is null or policy_source.expires_at>statement_timestamp())
        join effective_campaign_contexts c on c.workspace_id=r.workspace_id
          and c.context_hash=r.context_hash
          and c.account_ref=r.request_payload->>'accountRef'
          and c.entity_ref=r.request_payload->>'entityRef'
          and c.captured_at<=statement_timestamp()
        join ad_accounts account on account.workspace_id=r.workspace_id
          and account.id=c.ad_account_id and account.disappeared_at is null
          and account.external_account_id=r.request_payload->>'accountRef'
        join data_sources source on source.workspace_id=account.workspace_id
          and source.id=account.data_source_id and source.platform='meta_ads'
        join meta_connections connection on connection.workspace_id=source.workspace_id
          and connection.id=source.meta_connection_id and connection.status='active'
          and connection.disconnected_at is null and connection.revoked_at is null
          and connection.secret_disabled_at is null and connection.secret_destroyed_at is null
          and (connection.token_expires_at is null or connection.token_expires_at>statement_timestamp())
          and (connection.data_access_expires_at is null or connection.data_access_expires_at>statement_timestamp())
        where r.execution_ref=${input.executionRef}
          and r.request_payload->>'workspaceRef'=${input.request.workspaceRef}
          and r.request_payload->>'accountRef'=${input.request.accountRef}
          and r.request_payload->>'entityRef'=${input.request.entityRef}
          and r.request_payload->>'action'=${input.request.action}
          and not exists (
            select 1 from effective_campaign_context_components component
            join effective_campaign_context_invalidations invalidation
              on invalidation.workspace_id=component.workspace_id
             and invalidation.component_type=component.component_type
             and invalidation.component_ref=component.component_ref
             and invalidation.component_version=component.component_version
            where component.workspace_id=c.workspace_id and component.context_id=c.id
              and (invalidation.entity_type is null
                or (invalidation.entity_type=c.entity_type and invalidation.entity_ref=c.entity_ref))
          )
          and not exists (
            select 1 from approval_policy_definition_revisions newer
            where newer.workspace_id=policy_source.workspace_id
              and newer.policy_ref=policy_source.policy_ref
              and newer.revision>policy_source.revision
              and newer.state in ('published','disabled')
              and newer.effective_from<=statement_timestamp()
          )
        for share of r,b,guide_run,guide,guide_head,u,bundle,decision,g,policy,policy_source,c,account,source,connection
        limit 2
      `);
      const row = result.rows.length === 1
        ? (result.rows[0] as Record<string, unknown>)
        : null;
      let current: Awaited<ReturnType<DrizzleGuideRunCandidateStagingContextRepository["loadInTransaction"]>> | null = null;
      if (row) {
        try {
          current = await this.contexts.loadInTransaction(tx, {
            workspaceId: String(row.workspace_id),
            guideRevisionId: String(row.guide_revision_id),
            entityRef: input.request.entityRef,
            actionHash: String(row.action_hash),
            sliceRef: String(row.slice_ref),
            market: row.market_key as "yerli" | "yabanci",
            action: input.request.action as "status_pause" | "status_activate" | "budget_decrease" | "budget_increase",
            at: String(row.authorized_at),
          });
        } catch {
          current = null;
        }
      }
      const allowed = Boolean(
        row &&
          current &&
          current.workspaceRef === input.request.workspaceRef &&
          current.accountRef === input.request.accountRef &&
          current.entityRef === input.request.entityRef &&
          current.currentStatus === input.request.expectedBefore.status &&
          current.contextHash === row.context_hash &&
          current.approvalPolicyHash === row.policy_hash &&
          current.effectiveGuideSetHash === row.effective_guide_set_hash &&
          current.resolutionHash === row.resolution_hash,
      );
      const acceptedRow = allowed ? row! : null;
      const core = {
        version: "p06-dispatch-authority/1.0.0",
        phase: input.phase,
        executionRef: input.executionRef,
        allowed,
        authorizedAt: acceptedRow?.authorized_at ?? null,
        requestHash: acceptedRow?.request_hash ?? null,
        contextHash: acceptedRow?.current_context_hash ?? null,
        effectiveGuideSetHash: acceptedRow?.effective_guide_set_hash ?? null,
        resolutionHash: acceptedRow?.resolution_hash ?? null,
        policyHash: acceptedRow?.policy_hash ?? null,
        guideRevisionId: acceptedRow?.guide_revision_id ?? null,
        unitHash: acceptedRow?.unit_hash ?? null,
        grantHash: acceptedRow?.grant_hash ?? null,
        connectionGeneration: acceptedRow ? Number(acceptedRow.connection_generation) : null,
        dataHealthReportHash: allowed ? current!.dataHealthReportHash : null,
      };
      return Object.freeze({
        allowed,
        authorityHash: p06ExecutionV2Digest(core),
      });
    });
  }
}
