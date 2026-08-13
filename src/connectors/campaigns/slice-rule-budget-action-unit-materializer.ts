import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ActionProposalStagingService } from "@/application/action-proposal-staging-service";
import { DrizzleActionProposalQueueRepository } from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import { buildActionPlan, type ActionValveContext } from "@/domain/actions/autonomy-valve";
import type { ApprovalPolicy } from "@/domain/actions/approval-lifecycle";
import {
  resolvePublishedApprovalPolicy,
  type ApprovalPolicyDefinitionRevision,
} from "@/domain/actions/approval-policy-registry";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type WriterDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;

export class SliceRuleBudgetActionUnitMaterializerError extends Error {
  constructor(readonly code: "invalid_input" | "membership_required" | "role_denied" | "source_missing" | "source_ambiguous" | "stale_source" | "delivery_hold" | "ad_set_owner_unsupported" | "budget_mismatch" | "policy_unavailable" | "queue_rejected" | "corrupt_store") {
    super("Bütçe ActionUnit taslağı güvenli biçimde oluşturulamadı");
  }
}

/** No amount, target entity, policy, approval, or Meta control may cross this boundary. */
export type SliceRuleBudgetActionUnitMaterializeCommand = Readonly<{
  workspaceId: string; selectionId: string; actorId: string; idempotencyKey: string; proposedAt: string; expiresAt: string;
}>;
type ApprovalPolicyRow = Readonly<{ workspaceRef: string; artifactPayload: unknown }>;
type BudgetApprovalApplicability = Readonly<
  | { actionType: "budget_decrease"; risk: "K2" }
  | { actionType: "budget_increase"; risk: "K3" }
>;

/**
 * Resolves the persisted policy's authoritative workspace reference. A database UUID
 * is deliberately never converted into a public workspace ref at this boundary.
 */
export function resolveSliceRuleBudgetActionApprovalPolicy(input: Readonly<{
  evaluatedAt: string;
  applicability: BudgetApprovalApplicability;
  rows: readonly ApprovalPolicyRow[];
}>): Readonly<{ policy: ApprovalPolicy; workspaceRef: string }> | null {
  if (input.rows.length === 0 || input.rows.length > 1_000) return null;
  const workspaceRefs = [...new Set(input.rows.map((row) => row.workspaceRef))];
  if (workspaceRefs.length !== 1) return null;
  try {
    const resolved = resolvePublishedApprovalPolicy({
      workspaceRef: workspaceRefs[0]!, evaluatedAt: input.evaluatedAt,
      applicability: input.applicability,
      definitions: input.rows.map((row) => row.artifactPayload as ApprovalPolicyDefinitionRevision),
    });
    return Object.freeze({ policy: resolved.policy, workspaceRef: resolved.source.workspaceRef });
  } catch {
    return null;
  }
}
function stable(v: unknown): unknown { if (Array.isArray(v)) return v.map(stable); if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])); return v; }
function digest(v: unknown) { return createHash("sha256").update(JSON.stringify(stable(v))).digest("hex"); }
function decimal(minor: number): string { if (!Number.isSafeInteger(minor) || minor < 0) throw new SliceRuleBudgetActionUnitMaterializerError("corrupt_store"); return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`; }
function valid(input: SliceRuleBudgetActionUnitMaterializeCommand) { return !!input && Object.keys(input).sort().join("|") === ["actorId", "expiresAt", "idempotencyKey", "proposedAt", "selectionId", "workspaceId"].join("|") && UUID.test(input.workspaceId) && UUID.test(input.selectionId) && UUID.test(input.actorId) && REF.test(input.idempotencyKey) && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.proposedAt) && new Date(input.proposedAt).toISOString() === input.proposedAt && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.expiresAt) && new Date(input.expiresAt).toISOString() === input.expiresAt && input.expiresAt > input.proposedAt; }

/** Server-private owner-only materializer. Its only durable ActionUnit writer is the queue repository. */
export class DrizzleSliceRuleBudgetActionUnitMaterializer {
  constructor(private readonly database: WriterDatabase) {}
  async materialize(input: SliceRuleBudgetActionUnitMaterializeCommand) {
    if (!valid(input)) throw new SliceRuleBudgetActionUnitMaterializerError("invalid_input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`slice-rule-budget-unit:${input.workspaceId}:${input.selectionId}`}, 0))`);
      const member = (await tx.execute(sql`select role from memberships where workspace_id=${input.workspaceId}::uuid and user_id=${input.actorId}::uuid limit 1 for update`)).rows as Array<{ role: string }>;
      if (!member[0]) throw new SliceRuleBudgetActionUnitMaterializerError("membership_required");
      if (member[0].role !== "owner") throw new SliceRuleBudgetActionUnitMaterializerError("role_denied");
      const existing = await tx.select().from(schema.sliceRuleBudgetActionUnitBindings).where(and(eq(schema.sliceRuleBudgetActionUnitBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleBudgetActionUnitBindings.selectionId, input.selectionId))).limit(2);
      if (existing.length > 1) throw new SliceRuleBudgetActionUnitMaterializerError("source_ambiguous");
      if (existing[0]) return Object.freeze({ outcome: "unchanged" as const, actionUnitId: existing[0].actionProposalUnitId });
      const selection = await tx.select().from(schema.sliceRuleScenarioAllocationSelections).where(and(eq(schema.sliceRuleScenarioAllocationSelections.workspaceId, input.workspaceId), eq(schema.sliceRuleScenarioAllocationSelections.id, input.selectionId))).limit(2);
      if (selection.length !== 1) throw new SliceRuleBudgetActionUnitMaterializerError(selection.length ? "source_ambiguous" : "source_missing");
      const s = selection[0]!;
      const [bindings, proposals, entityBindings] = await Promise.all([
        tx.select().from(schema.sliceRuleBudgetProposalBindings).where(and(eq(schema.sliceRuleBudgetProposalBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleBudgetProposalBindings.draftHash, s.draftHash), eq(schema.sliceRuleBudgetProposalBindings.proposalHash, s.proposalHash))).limit(2),
        tx.select().from(schema.budgetProposalVersions).where(and(eq(schema.budgetProposalVersions.workspaceId, input.workspaceId), eq(schema.budgetProposalVersions.proposalHash, s.proposalHash))).limit(2),
        tx.select().from(schema.sliceRuleAllocationEntityBindings).where(and(eq(schema.sliceRuleAllocationEntityBindings.workspaceId, input.workspaceId), eq(schema.sliceRuleAllocationEntityBindings.draftHash, s.draftHash), eq(schema.sliceRuleAllocationEntityBindings.allocationRef, s.allocationRef))).limit(2),
      ]);
      if (bindings.length !== 1 || proposals.length !== 1 || entityBindings.length !== 1) throw new SliceRuleBudgetActionUnitMaterializerError([bindings, proposals, entityBindings].some((x) => x.length > 1) ? "source_ambiguous" : "source_missing");
      const target = entityBindings[0]!;
      if (target.budgetOwnerLevel !== "campaign") throw new SliceRuleBudgetActionUnitMaterializerError("ad_set_owner_unsupported");
      if (target.budgetKind !== "daily" || target.currentAmountMinor !== s.beforeAmountMinor || target.currency.length !== 3) throw new SliceRuleBudgetActionUnitMaterializerError("budget_mismatch");
      const campaign = await tx.select().from(schema.adCampaigns).where(and(eq(schema.adCampaigns.workspaceId, input.workspaceId), eq(schema.adCampaigns.id, target.campaignId), eq(schema.adCampaigns.adAccountId, target.adAccountId))).limit(2);
      const account = await tx.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.workspaceId, input.workspaceId), eq(schema.adAccounts.id, target.adAccountId))).limit(2);
      const contexts = await tx.select().from(schema.effectiveCampaignContexts).where(and(eq(schema.effectiveCampaignContexts.workspaceId, input.workspaceId), eq(schema.effectiveCampaignContexts.contextHash, proposals[0]!.contextHash), eq(schema.effectiveCampaignContexts.entityType, "campaign"), eq(schema.effectiveCampaignContexts.entityRef, campaign[0]?.externalCampaignId ?? ""))).limit(2);
      if (campaign.length !== 1 || account.length !== 1 || contexts.length !== 1 || campaign[0]!.dailyBudgetMinor !== s.beforeAmountMinor || account[0]!.currency !== target.currency) throw new SliceRuleBudgetActionUnitMaterializerError("stale_source");
      const alertHeads = await tx.execute(sql`select 1 from delivery_health_alert_ledger_records h where h.workspace_id=${input.workspaceId}::uuid and h.account_ref=${contexts[0]!.accountRef} and h.status <> 'resolved' and not exists (select 1 from delivery_health_alert_ledger_records n where n.workspace_id=h.workspace_id and n.alert_ref=h.alert_ref and n.sequence>h.sequence) limit 1`);
      if ((alertHeads.rows as unknown[]).length) throw new SliceRuleBudgetActionUnitMaterializerError("delivery_hold");
      const applicability = s.afterAmountMinor > s.beforeAmountMinor
        ? Object.freeze({ actionType: "budget_increase" as const, risk: "K3" as const })
        : Object.freeze({ actionType: "budget_decrease" as const, risk: "K2" as const });
      const policyRows = await tx.select({
        workspaceRef: schema.approvalPolicyDefinitionRevisions.workspaceRef,
        artifactPayload: schema.approvalPolicyDefinitionRevisions.artifactPayload,
      }).from(schema.approvalPolicyDefinitionRevisions).where(and(
        eq(schema.approvalPolicyDefinitionRevisions.workspaceId, input.workspaceId),
        eq(schema.approvalPolicyDefinitionRevisions.actionType, applicability.actionType),
        eq(schema.approvalPolicyDefinitionRevisions.risk, applicability.risk),
      )).limit(1_001);
      const resolvedPolicy = resolveSliceRuleBudgetActionApprovalPolicy({
        evaluatedAt: input.proposedAt, applicability, rows: policyRows,
      });
      if (!resolvedPolicy) throw new SliceRuleBudgetActionUnitMaterializerError("policy_unavailable");
      const { policy, workspaceRef } = resolvedPolicy;
      const intent = { kind: "budget_change" as const, entity: { level: "campaign" as const, ref: campaign[0]!.externalCampaignId }, budgetKind: "daily" as const, currency: target.currency, beforeDecimal: decimal(s.beforeAmountMinor), afterDecimal: decimal(s.afterAmountMinor), budgetOwnerRef: campaign[0]!.externalCampaignId };
      const valve: ActionValveContext = { workspaceRef, accountGroupRef: null, accountRef: contexts[0]!.accountRef, internalCategoryRefs: [], campaignRef: contexts[0]!.campaignRef, entity: intent.entity, evaluatedAt: input.proposedAt, rules: [], budgetLimits: null, protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] } };
      const actionPlan = buildActionPlan(intent, valve);
      if (actionPlan.disposition !== "approval_required") throw new SliceRuleBudgetActionUnitMaterializerError("queue_rejected");
      const staged = new ActionProposalStagingService(policy).stage({ plan: { planRef: `slice_rule_${s.draftHash.slice(0, 20)}`, revision: 1, planHash: digest({ draftHash: s.draftHash, proposalHash: s.proposalHash, selectionId: s.id }) }, workspaceRef, accountRef: contexts[0]!.accountRef, requester: { actorRef: `actor_${input.actorId.replaceAll("-", "")}`, role: "owner" }, proposedAt: input.proposedAt, expiresAt: input.expiresAt, units: [{ unitKey: `budget_${s.id.replaceAll("-", "")}`, plan: { planRef: `slice_rule_${s.draftHash.slice(0, 20)}`, revision: 1, planHash: digest({ draftHash: s.draftHash, proposalHash: s.proposalHash, selectionId: s.id }) }, actionPlan, workspaceRef, accountRef: contexts[0]!.accountRef, entityRef: campaign[0]!.externalCampaignId, actionType: actionPlan.actionType, risk: actionPlan.risk, actionHash: digest(actionPlan.action), dependencies: [], summary: { safety: "public_safe", before: { label: "Günlük bütçe", value: decimal(s.beforeAmountMinor) }, after: { label: "Günlük bütçe", value: decimal(s.afterAmountMinor) }, evidence: [{ evidenceRef: `selection_${s.id.replaceAll("-", "")}`, label: "Onaylı senaryo seçimi" }] } }] });
      try { await new DrizzleActionProposalQueueRepository(tx as Database, input.workspaceId).appendInitial(staged); } catch { throw new SliceRuleBudgetActionUnitMaterializerError("queue_rejected"); }
      const unit = await tx.select().from(schema.actionProposalUnits).where(and(eq(schema.actionProposalUnits.workspaceId, input.workspaceId), eq(schema.actionProposalUnits.unitRef, staged.summaries[0]!.unitRef))).limit(2);
      if (unit.length !== 1) throw new SliceRuleBudgetActionUnitMaterializerError("corrupt_store");
      const core = { schemaVersion: "slice-rule-budget-action-unit-binding/1.0.0", selectionId: s.id, actionProposalUnitId: unit[0]!.id, selectionEvidenceHash: s.selectionEvidenceHash, actionPlanHash: staged.summaries[0]!.actionPlanHash, boundAt: input.proposedAt, authority: { canApprove: false, canExecute: false, canWriteMeta: false } };
      const bindingHash = digest(core); await tx.insert(schema.sliceRuleBudgetActionUnitBindings).values({ workspaceId: input.workspaceId, selectionId: s.id, actionProposalUnitId: unit[0]!.id, bindingHash, bindingPayload: { ...core, bindingHash }, boundByActorId: input.actorId, boundAt: new Date(input.proposedAt) });
      return Object.freeze({ outcome: "inserted" as const, actionUnitId: unit[0]!.id });
    });
  }
}
