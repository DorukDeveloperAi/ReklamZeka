import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ActionProposalStagingService } from "@/application/action-proposal-staging-service";
import { DrizzleActionProposalQueueRepository } from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import type { GuideRunCandidateActionStagingPort, GuideRunCandidateActionStagingTransaction } from "@/connectors/guides/guide-run-action-binding-drizzle-repository";
import type { DrizzleGuideRunCandidateStagingContextRepository } from "@/connectors/guides/guide-run-candidate-staging-context-drizzle-repository";
import type { CurrentSliceEvidence, OperationReadTransaction } from "@/connectors/operations/operation-read-drizzle-repository";
import { buildActionPlan, type TypedActionIntent } from "@/domain/actions/autonomy-valve";
import * as schema from "@/db/schema";
import { metaPublicReference } from "@/domain/meta/public-reference";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";

type Database = NodePgDatabase<typeof schema>;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class GuideRunStatusActionStagerError extends Error {
  constructor(readonly code: "invalid_input" | "unsupported_action" | "context_rejected" | "plan_rejected" | "queue_rejected" | "corrupt_store") {
    super(`Guide status candidate could not be staged: ${code}`);
  }
}

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fail = (code: GuideRunStatusActionStagerError["code"]): never => { throw new GuideRunStatusActionStagerError(code); };

/**
 * Exact, closed parser for the only P06 actions that can currently stage.
 * Budget candidates intentionally never reach this adapter: their parent ceiling
 * evidence is not yet canonical.
 */
export function parseGuideRunStatusCandidate(input: Readonly<{ action: string; typedAction: Record<string, unknown>; memberRef: string }>): Extract<TypedActionIntent, { kind: "status_change" }> {
  if (!input || !["status_pause", "status_activate"].includes(input.action) || !REF.test(input.memberRef)
    || !input.typedAction || typeof input.typedAction !== "object" || Array.isArray(input.typedAction)) fail("unsupported_action");
  const raw = input.typedAction as Record<string, unknown>;
  if (Object.keys(raw).length !== 4 || Object.keys(raw).some((key) => !["kind", "entity", "fromStatus", "toStatus"].includes(key))
    || raw.kind !== "status_change" || !raw.entity || typeof raw.entity !== "object" || Array.isArray(raw.entity)) fail("unsupported_action");
  const entity = raw.entity as Record<string, unknown>;
  if (Object.keys(entity).length !== 2 || entity.ref !== input.memberRef || !["campaign", "adset"].includes(entity.level as string)
    || !["ACTIVE", "PAUSED"].includes(raw.fromStatus as string) || !["ACTIVE", "PAUSED"].includes(raw.toStatus as string)) fail("unsupported_action");
  const pause = raw.fromStatus === "ACTIVE" && raw.toStatus === "PAUSED";
  const activate = raw.fromStatus === "PAUSED" && raw.toStatus === "ACTIVE";
  if ((!pause && !activate) || (pause ? "status_pause" : "status_activate") !== input.action) fail("unsupported_action");
  return Object.freeze({ kind: "status_change" as const, entity: Object.freeze({ level: entity.level as "campaign" | "adset", ref: input.memberRef }),
    fromStatus: raw.fromStatus as "ACTIVE" | "PAUSED", toStatus: raw.toStatus as "ACTIVE" | "PAUSED" });
}

type Context = Awaited<ReturnType<DrizzleGuideRunCandidateStagingContextRepository["load"]>>;
type CurrentSlicePort = Readonly<{ currentSliceEvidenceInTransaction(transaction: OperationReadTransaction, workspaceId: string, sliceRef: string | null): Promise<CurrentSliceEvidence> }>;

/** Server-private adapter: it only appends approval-required status units. */
export class DrizzleGuideRunStatusActionStager implements GuideRunCandidateActionStagingPort {
  constructor(private readonly contexts: Pick<DrizzleGuideRunCandidateStagingContextRepository, "loadInTransaction">, private readonly scopes: CurrentSlicePort) {}

  async stage(input: Parameters<GuideRunCandidateActionStagingPort["stage"]>[0], transaction: GuideRunCandidateActionStagingTransaction) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.guideRevisionId) || !REF.test(input.runRef)
      || !REF.test(input.dispositionArtifactRef) || !REF.test(input.candidateRef) || !HASH.test(input.candidateHash)
      || !REF.test(input.memberRef) || !HASH.test(input.membershipHash) || !REF.test(input.sliceRef) || !iso(input.dispositionOccurredAt)) fail("invalid_input");
    const intent = parseGuideRunStatusCandidate(input);
    const clock = await transaction.execute(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`);
    const authorizationAt = (clock.rows as Array<{ now?: unknown }>)[0]?.now;
    if (!iso(authorizationAt)) fail("context_rejected");
    const authorizedAt = authorizationAt as string;
    const action = intent.toStatus === "PAUSED" ? "status_pause" as const : "status_activate" as const;
    let loadedScope: CurrentSliceEvidence | null = null;
    try { loadedScope = await this.scopes.currentSliceEvidenceInTransaction(transaction as OperationReadTransaction, input.workspaceId, input.sliceRef); }
    catch { fail("context_rejected"); }
    if (!loadedScope) fail("context_rejected");
    const scope = loadedScope as CurrentSliceEvidence;
    if (!scope || scope.sliceRef !== input.sliceRef || scope.market?.key !== input.market || scope.definitionHash === null) fail("context_rejected");
    const database = transaction as Database;
    if (intent.entity.level !== input.entityLevel || intent.entity.ref !== input.memberRef) fail("context_rejected");
    const ids = intent.entity.level === "campaign" ? scope.campaignIds : scope.adSetIds;
    if (ids.length === 0) fail("context_rejected");
    const memberId = ids.find((id) => metaPublicReference(intent.entity.level === "campaign" ? "campaign" : "ad_set", input.workspaceId, id) === input.memberRef);
    if (!memberId) fail("context_rejected");
    const resolvedMemberId = memberId as string;
    const membership = intent.entity.level === "campaign"
      ? await database.select({ id: schema.adCampaigns.id, entityRef: schema.adCampaigns.externalCampaignId }).from(schema.adCampaigns).where(and(eq(schema.adCampaigns.workspaceId, input.workspaceId), eq(schema.adCampaigns.id, resolvedMemberId))).limit(2)
      : await database.select({ id: schema.metaAdSets.id, entityRef: schema.metaAdSets.externalAdSetId }).from(schema.metaAdSets).where(and(eq(schema.metaAdSets.workspaceId, input.workspaceId), eq(schema.metaAdSets.id, resolvedMemberId))).limit(2);
    if (membership.length !== 1 || membership[0]!.id !== memberId || !REF.test(membership[0]!.entityRef)) fail("context_rejected");
    const entityRef = membership[0]!.entityRef;
    const externalIntent = Object.freeze({ ...intent, entity: Object.freeze({ level: intent.entity.level, ref: entityRef }) });
    const externalActionHash = digest(externalIntent);
    const evaluation=scope.resolution?.included.find(item=>item.entityRef===input.memberRef && item.entityLevel===(intent.entity.level==="adset"?"ad_set":intent.entity.level));
    if(!evaluation || scope.revisionRef===null || scope.definitionHash===null) fail("context_rejected");
    const membershipEvidenceHash = guideRunMembershipEvidenceHash({sliceRef:input.sliceRef,revisionRef:scope.revisionRef as string,definitionHash:scope.definitionHash as string,membership:evaluation as NonNullable<typeof evaluation>});
    if(membershipEvidenceHash!==input.membershipHash) fail("context_rejected");
    let loaded: Context | null = null;
    try {
      loaded = await this.contexts.loadInTransaction(transaction as Database, { workspaceId: input.workspaceId, guideRevisionId: input.guideRevisionId, entityRef, actionHash: externalActionHash,
        sliceRef: input.sliceRef, market: input.market, action, at: authorizedAt });
    } catch { fail("context_rejected"); }
    if (!loaded) fail("context_rejected");
    const context = loaded as Context;
    if (context.entityRef !== entityRef || context.currentStatus !== intent.fromStatus || context.authority.canApprove || context.authority.canExecute || context.authority.canWriteMeta) fail("context_rejected");
    const maximumLifetime = context.approvalPolicy.maximumProposalLifetimeSeconds;
    if (!Number.isSafeInteger(maximumLifetime) || maximumLifetime < 1 || maximumLifetime > 604_800) fail("context_rejected");
    const expiresAt = new Date(Date.parse(input.dispositionOccurredAt) + maximumLifetime * 1_000).toISOString();
    if (expiresAt <= authorizedAt) fail("context_rejected");
    const actionPlan = buildActionPlan(externalIntent, {
      workspaceRef: context.workspaceRef, accountGroupRef: null, accountRef: context.accountRef,
      internalCategoryRefs: context.protection.protectedInternalCategoryRefs, campaignRef: context.campaignRef, entity: externalIntent.entity, evaluatedAt: authorizedAt, rules: context.rules, budgetLimits: null,
      protection: context.protection,
      frozenContextHash: context.contextHash,
    });
    if (actionPlan.actionType !== action || actionPlan.disposition !== "approval_required" || actionPlan.effectiveAutonomy !== "approval_only"
      || actionPlan.capabilities.canExecute || actionPlan.capabilities.canWriteMeta || actionPlan.capabilities.canGrantApproval) fail("plan_rejected");
    const actionHash = digest(actionPlan.action);
    // The full candidate hash is recoverable from the persisted plan ref.  Do
    // not use sourceHash here: that belongs to the independently rebuilt plan.
    const plan = Object.freeze({ planRef: `guide_candidate_${input.candidateHash}`, revision: 1,
      planHash: digest({ version: "guide-run-status-action-stager/1.0.0", runRef: input.runRef,
        dispositionArtifactRef: input.dispositionArtifactRef, candidateRef: input.candidateRef, candidateHash: input.candidateHash,
        actionPlanHash: actionPlan.planHash, contextHash: context.contextHash, effectiveGuideSetHash: context.effectiveGuideSetHash,
        resolutionHash: context.resolutionHash, currentSliceMembershipHash: membershipEvidenceHash, dataHealthReportHash: context.dataHealthReportHash, authorizationAt: authorizedAt, dispositionOccurredAt: input.dispositionOccurredAt,
        policyRef: context.approvalPolicy.policyRef, policyRevision: context.approvalPolicy.revision, policyHash: context.approvalPolicyHash }) });
    const before = intent.fromStatus === "ACTIVE" ? "Aktif" : "Duraklatılmış";
    const after = intent.toStatus === "ACTIVE" ? "Aktif" : "Duraklatılmış";
    let staged: ReturnType<ActionProposalStagingService["stage"]> | null = null;
    try {
      staged = new ActionProposalStagingService(context.approvalPolicy).stage({ plan, workspaceRef: context.workspaceRef, accountRef: context.accountRef,
        requester: { actorRef: `agent_${digest({ runRef: input.runRef, dispositionArtifactRef: input.dispositionArtifactRef }).slice(0, 24)}`, role: "agent" },
        proposedAt: input.dispositionOccurredAt, expiresAt, units: [{ unitKey: `guide_status_${input.candidateHash.slice(0, 20)}`, plan, actionPlan,
          workspaceRef: context.workspaceRef, accountRef: context.accountRef, entityRef, actionType: actionPlan.actionType,
          risk: actionPlan.risk, actionHash, dependencies: [], summary: { safety: "public_safe", before: { label: "Durum", value: before }, after: { label: "Durum", value: after }, evidence: [
            { evidenceRef: "guide_candidate", label: "Aktif Kılavuz adayı doğrulandı" },
            { evidenceRef: "guide_overlap", label: "Kılavuz çakışma ve insan onayı kuralı doğrulandı" },
            { evidenceRef: "effective_context", label: "Geçerli kampanya bağlamı doğrulandı" },
            { evidenceRef: "current_slice", label: "Güncel dilim üyeliği ve pazar sınırı doğrulandı" },
          ] } }] });
    } catch { fail("plan_rejected"); }
    if (!staged) fail("plan_rejected");
    const proposal = staged as ReturnType<ActionProposalStagingService["stage"]>;
    try { await new DrizzleActionProposalQueueRepository(transaction as Database, input.workspaceId).appendInitial(proposal); }
    catch { fail("queue_rejected"); }
    if (proposal.summaries.length !== 1) fail("corrupt_store");
    const unitRef = proposal.summaries[0]!.unitRef;
    const units = await database.select({ id: schema.actionProposalUnits.id, unitHash: schema.actionProposalUnits.unitHash })
      .from(schema.actionProposalUnits).where(and(eq(schema.actionProposalUnits.workspaceId, input.workspaceId), eq(schema.actionProposalUnits.unitRef, unitRef))).limit(2);
    const bundles = await database.select({ id: schema.actionProposalBundles.id, bundleHash: schema.actionProposalBundles.bundleHash })
      .from(schema.actionProposalBundles).where(and(eq(schema.actionProposalBundles.workspaceId, input.workspaceId), eq(schema.actionProposalBundles.bundleRef, proposal.lifecycle.bundle.bundleRef))).limit(2);
    if (units.length !== 1 || bundles.length !== 1 || !UUID.test(units[0]!.id) || !UUID.test(bundles[0]!.id) || !HASH.test(units[0]!.unitHash) || !HASH.test(bundles[0]!.bundleHash)) fail("corrupt_store");
    return Object.freeze({ actionUnitId: units[0]!.id, proposalBundleId: bundles[0]!.id, actionUnitRef: unitRef,
      actionUnitHash: units[0]!.unitHash, proposalRef: proposal.lifecycle.bundle.bundleRef, proposalHash: bundles[0]!.bundleHash, entityRef,
      effectiveGuideSetHash: context.effectiveGuideSetHash, resolutionHash: context.resolutionHash });
  }
}
