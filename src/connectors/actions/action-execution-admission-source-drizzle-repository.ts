import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { ActionExecutionAdmissionSource } from "@/application/action-execution-admission-service";
import { DrizzleActionApprovalDecisionRepository } from "@/connectors/actions/action-approval-decision-drizzle-repository";
import type { ActionPlan } from "@/domain/actions/autonomy-valve";
import type { GuideBudgetPersistedBinding } from "@/application/guide-budget-action-preparation-service";
import { createMetaWriteSpec } from "@/domain/actions/meta-write-spec";
import type { MetaWriteEligibilitySnapshot } from "@/domain/actions/meta-write-eligibility";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type SourceDatabase = Pick<Database, "execute" | "transaction">;
type Row = Readonly<Record<string, unknown>>;
export type GuideBudgetActionAdmissionGate = Readonly<{
  revalidatePersisted(input: Readonly<{ workspaceId: string; guideRevisionId: string; binding: GuideBudgetPersistedBinding; evaluatedAt: string }>): Promise<boolean>;
}>;

export class ActionExecutionAdmissionSourceRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "source_missing" | "source_corrupt") {
    super(`Execution admission source reddedildi: ${code}`);
    this.name = "ActionExecutionAdmissionSourceRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
type Status = "ACTIVE" | "PAUSED" | "UNKNOWN";

function rows(value: unknown): readonly Row[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
  }
  return value.rows as readonly Row[];
}
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
  }
  return value;
}
function status(value: unknown): Status { return value === "ACTIVE" || value === "PAUSED" ? value : "UNKNOWN"; }
function text(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
  return value;
}
function name(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > 255
    || /[\u0000-\u001f\u007f]/.test(value)) throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
  return value;
}

/**
 * Read-only bridge from immutable proposal/approval rows to the current Meta
 * mirror. The sink repeats the mirror check under its short write transaction;
 * this reader never locks, writes, dispatches, or contacts Meta.
 */
export class DrizzleActionExecutionAdmissionSourceRepository implements ActionExecutionAdmissionSource {
  private readonly approval: Pick<DrizzleActionApprovalDecisionRepository, "loadForDecision">;

  constructor(private readonly database: SourceDatabase, private readonly workspaceId: string,
    approval?: Pick<DrizzleActionApprovalDecisionRepository, "loadForDecision">,
    private readonly guideBudgetGate?: GuideBudgetActionAdmissionGate) {
    if (!UUID.test(workspaceId)) throw new ActionExecutionAdmissionSourceRepositoryError("invalid_input");
    this.approval = approval ?? new DrizzleActionApprovalDecisionRepository(database, workspaceId);
  }

  async loadForAdmission(input: Readonly<{ workspaceId: string; unitRef: string }>) {
    if (!input || typeof input !== "object" || input.workspaceId !== this.workspaceId || !REF.test(input.unitRef)) {
      throw new ActionExecutionAdmissionSourceRepositoryError("workspace_scope_mismatch");
    }
    let approval;
    try { approval = await this.approval.loadForDecision(input); }
    catch { throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt"); }
    if (!approval) return null;
    const unit = approval.lifecycle.bundle.units.find((candidate) => candidate.unitRef === input.unitRef);
    if (!unit) throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
    const result = rows(await this.database.execute(sql`
      select u.action_plan_payload, u.action_plan_hash, u.action_hash, u.account_ref, u.entity_ref, u.action_type,
        campaign.external_campaign_id as campaign_ref, campaign.name as campaign_name, campaign.configured_status as campaign_configured_status,
        campaign.effective_status as campaign_effective_status, campaign.campaign_budget_optimization,
        ad_set.external_ad_set_id as ad_set_ref, ad_set.name as ad_set_name, ad_set.configured_status as ad_set_configured_status,
        ad_set.effective_status as ad_set_effective_status, ad.external_ad_id as ad_ref, ad.name as ad_name,
        ad.configured_status as ad_configured_status, ad.effective_status as ad_effective_status,
        snapshot.snapshot_hash as source_snapshot_hash,
        to_char(snapshot.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_snapshot_captured_at,
        to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as database_now
      from action_proposal_units u
      join workspaces w on w.id = u.workspace_id and w.lifecycle_state = 'active'
      join ad_accounts account on account.workspace_id = u.workspace_id and account.id = u.ad_account_id
        and account.external_account_id = u.account_ref and account.disappeared_at is null
      join data_sources data_source on data_source.workspace_id = account.workspace_id and data_source.id = account.data_source_id
      join meta_connections connection on connection.workspace_id = data_source.workspace_id and connection.id = data_source.meta_connection_id
        and connection.status = 'active' and connection.disconnected_at is null and connection.revoked_at is null
      left join ad_campaigns campaign on campaign.workspace_id = u.workspace_id and campaign.id = u.campaign_id
        and campaign.ad_account_id = account.id and campaign.disappeared_at is null
      left join meta_ad_sets ad_set on ad_set.workspace_id = u.workspace_id and ad_set.id = u.ad_set_id
        and ad_set.ad_account_id = account.id and ad_set.campaign_id = campaign.id and ad_set.disappeared_at is null
      left join meta_ads ad on ad.workspace_id = u.workspace_id and ad.id = u.ad_id and ad.ad_account_id = account.id
        and ad.campaign_id = campaign.id and ad.ad_set_id = ad_set.id and ad.disappeared_at is null
      join lateral (
        select candidate.* from meta_change_snapshots candidate
        where candidate.workspace_id = u.workspace_id and candidate.meta_connection_id = connection.id
          and candidate.ad_account_id = account.id and candidate.captured_at <= transaction_timestamp()
        order by candidate.captured_at desc, candidate.persisted_at desc, candidate.id desc limit 1
      ) snapshot on true
      where u.workspace_id = ${this.workspaceId}::uuid and u.unit_ref = ${input.unitRef}
      limit 2
    `));
    if (result.length === 0) throw new ActionExecutionAdmissionSourceRepositoryError("source_missing");
    if (result.length !== 1) throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
    const row = result[0]!;
    const actionPlan = row.action_plan_payload as ActionPlan;
    let writeSpec;
    try { writeSpec = createMetaWriteSpec({ unitRef: unit.unitRef, unitHash: unit.unitHash, actionPlan }); }
    catch { throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt"); }
    if (actionPlan.planHash !== unit.sourceHash || actionPlan.contextHash !== unit.contextHash
      || actionPlan.actionType !== unit.scope.actionType || actionPlan.action.entity.ref !== unit.scope.entityRef
      || row.account_ref !== unit.scope.accountRef || row.entity_ref !== unit.scope.entityRef || row.action_type !== unit.scope.actionType) {
      throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
    }
    const guidePlan = /^guide_budget_([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})_([a-f0-9]{64})$/.exec(unit.plan.planRef);
    if (unit.plan.planRef.startsWith("guide_budget_") && !guidePlan) {
      // A legacy short discriminator cannot recover or bind the complete
      // Guide evaluation. It must never silently take the generic path.
      throw new ActionExecutionAdmissionSourceRepositoryError("source_missing");
    }
    if (guidePlan) {
      if (actionPlan.action.kind !== "budget_change" || !this.guideBudgetGate) throw new ActionExecutionAdmissionSourceRepositoryError("source_missing");
      const guideRevisionId = `${guidePlan[1]}-${guidePlan[2]}-${guidePlan[3]}-${guidePlan[4]}-${guidePlan[5]}`;
      if (row.action_plan_hash !== actionPlan.planHash || row.action_plan_hash !== unit.sourceHash
        || typeof row.action_hash !== "string" || !HASH.test(row.action_hash)) {
        throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
      }
      const admitted = await this.guideBudgetGate.revalidatePersisted({ workspaceId: this.workspaceId, guideRevisionId,
        binding: Object.freeze({ unitRef: unit.unitRef, plan: unit.plan, sourceHash: unit.sourceHash,
          contextHash: unit.contextHash, actionPlanHash: actionPlan.planHash,
          actionHash: row.action_hash as string, action: actionPlan.action, expiresAt: unit.expiresAt }),
        evaluatedAt: iso(row.database_now) });
      if (admitted !== true) throw new ActionExecutionAdmissionSourceRepositoryError("source_missing");
    }
    const sourceSnapshotHash = typeof row.source_snapshot_hash === "string" && HASH.test(row.source_snapshot_hash)
      ? row.source_snapshot_hash : (() => { throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt"); })();
    if (Date.parse(iso(row.source_snapshot_captured_at)) > Date.parse(iso(row.database_now))) {
      throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
    }
    const campaignRef = text(row.campaign_ref);
    const target = writeSpec.target.entityLevel === "campaign"
      ? { ref: campaignRef, configured: row.campaign_configured_status, effective: row.campaign_effective_status, name: row.campaign_name }
      : writeSpec.target.entityLevel === "adset"
        ? { ref: text(row.ad_set_ref), configured: row.ad_set_configured_status, effective: row.ad_set_effective_status, name: row.ad_set_name }
        : { ref: text(row.ad_ref), configured: row.ad_configured_status, effective: row.ad_effective_status, name: row.ad_name };
    if (target.ref !== unit.scope.entityRef) throw new ActionExecutionAdmissionSourceRepositoryError("source_corrupt");
    const ancestors = writeSpec.target.entityLevel === "campaign" ? []
      : writeSpec.target.entityLevel === "adset" ? [Object.freeze({ entityLevel: "campaign" as const, entityRef: campaignRef,
        configuredStatus: status(row.campaign_configured_status), effectiveStatus: status(row.campaign_effective_status) })]
        : [Object.freeze({ entityLevel: "campaign" as const, entityRef: campaignRef,
          configuredStatus: status(row.campaign_configured_status), effectiveStatus: status(row.campaign_effective_status) }),
        Object.freeze({ entityLevel: "adset" as const, entityRef: text(row.ad_set_ref),
          configuredStatus: status(row.ad_set_configured_status), effectiveStatus: status(row.ad_set_effective_status) })];
    const eligibilitySnapshot: MetaWriteEligibilitySnapshot = Object.freeze({ workspaceRef: unit.scope.workspaceRef,
      accountRef: unit.scope.accountRef, capturedAt: iso(row.database_now), sourceSnapshotHash,
      target: Object.freeze({ entityLevel: writeSpec.target.entityLevel, entityRef: target.ref,
        configuredStatus: status(target.configured), effectiveStatus: status(target.effective),
        currentName: name(target.name),
        budgetOwnerRef: writeSpec.target.entityLevel === "campaign"
          ? row.campaign_budget_optimization === true ? campaignRef : null
          : writeSpec.target.entityLevel === "adset"
            ? row.campaign_budget_optimization === false ? target.ref : null
            : null }), ancestors: Object.freeze(ancestors) });
    return Object.freeze({ lifecycle: approval.lifecycle, freshness: approval.freshness, actionPlan, eligibilitySnapshot });
  }
}
