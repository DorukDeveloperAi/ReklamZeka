import { createHash } from "node:crypto";

import {
  ActionProposalStagingService,
  type StagedActionProposal,
} from "@/application/action-proposal-staging-service";
import {
  GuideBudgetDryRunService,
  type GuideBudgetEvidenceReadPort,
} from "@/application/guide-budget-dry-run-service";
import type { ApprovalPolicy, ActionActor } from "@/domain/actions/approval-lifecycle";
import type { FrozenPlanIdentity } from "@/domain/actions/approval-lifecycle";
import {
  buildActionPlan,
  type ActionValveContext,
  type TypedActionIntent,
} from "@/domain/actions/autonomy-valve";
import type { GuideBudgetDryRun } from "@/domain/guides/guide-budget-dry-run";

/**
 * P04's only bridge from a Guide budget evaluation to the canonical ActionUnit
 * pipeline.  It deliberately has no repository, Meta transport, approval, or
 * execution port.  A server-owned caller may persist the returned staged
 * proposal through the existing ActionProposalQueueRepository.
 */
export const GUIDE_BUDGET_ACTION_PREPARATION_VERSION = "guide-budget-action-preparation/1.0.0" as const;

export type GuideBudgetActionRuntimeContext = Readonly<{
  workspaceRef: string;
  accountGroupRef: string | null;
  accountRef: string;
  /** Tenant-safe alias used solely to bind the Guide dry-run owner evidence. */
  ownerPublicRef: string;
  /** Canonical Meta-writable entity ref. Never a browser/public alias. */
  ownerEntityExternalRef: string;
  /** Canonical Meta-writable account ref. */
  accountExternalRef: string;
  internalCategoryRefs: readonly string[];
  campaignRef: string;
  rules: ActionValveContext["rules"];
  protection: ActionValveContext["protection"];
  frozenContextHash: string;
  /** Derived by the canonical data-health reader; caller input must not infer it. */
  dataHealthReady: boolean;
  /** Immutable canonical report identity; readiness alone is not an authority binding. */
  dataHealthReportHash: string;
}>;

/** Server-only resolver; HTTP/browser commands never carry this context. */
export interface GuideBudgetActionTrustedContextReadPort {
  load(input: Readonly<{ workspaceId: string; guideRevisionId: string; dryRun: GuideBudgetDryRun; evaluatedAt: string }>): Promise<Readonly<{
    runtime: GuideBudgetActionRuntimeContext;
    approvalPolicy: ApprovalPolicy;
  }>>;
}

export type GuideBudgetActionPrepareInput = Readonly<{
  workspaceId: string;
  guideRevisionId: string;
  requester: ActionActor;
  proposedAt: string;
  expiresAt: string;
}>;

export type GuideBudgetActionPreparation =
  | Readonly<{
    version: typeof GUIDE_BUDGET_ACTION_PREPARATION_VERSION;
    disposition: "held";
    holdReasons: readonly string[];
    dryRun: GuideBudgetDryRun;
    authority: Readonly<{ canPersist: false; canApprove: false; canExecute: false; canWriteMeta: false }>;
  }>
  | Readonly<{
    version: typeof GUIDE_BUDGET_ACTION_PREPARATION_VERSION;
    disposition: "staged";
    dryRun: GuideBudgetDryRun;
    intent: Extract<TypedActionIntent, { kind: "budget_change" }>;
    staged: StagedActionProposal;
    authority: Readonly<{ canPersist: true; canApprove: false; canExecute: false; canWriteMeta: false }>;
  }>;

export type GuideBudgetActionAdmission = Readonly<{
  version: typeof GUIDE_BUDGET_ACTION_PREPARATION_VERSION;
  disposition: "admission_ready" | "held";
  holdReasons: readonly string[];
  preparation: GuideBudgetActionPreparation;
  /** This is a gate only; ActionExecutionAdmissionService remains the consumer. */
  authority: Readonly<{ canAdmitExecution: false; canApprove: false; canExecute: false; canWriteMeta: false }>;
}>;

/**
 * Values copied from the immutable ActionUnit/bundle rows by the admission
 * source.  None is a caller assertion: each is independently protected by
 * the existing ActionUnit, bundle and payload hashes.
 */
export type GuideBudgetPersistedBinding = Readonly<{
  unitRef: string;
  plan: FrozenPlanIdentity;
  sourceHash: string;
  contextHash: string;
  actionPlanHash: string;
  actionHash: string;
  action: Extract<TypedActionIntent, { kind: "budget_change" }>;
  expiresAt: string;
}>;

export class GuideBudgetActionPreparationError extends Error {
  constructor(readonly code: "invalid_input" | "evidence_unavailable" | "staging_rejected") {
    super(code);
    this.name = "GuideBudgetActionPreparationError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const heldAuthority = Object.freeze({ canPersist: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
const stagedAuthority = Object.freeze({ canPersist: true as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
const admissionAuthority = Object.freeze({ canAdmitExecution: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });

function uniqueReasons(reasons: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(reasons)].sort());
}
function validRuntime(value: GuideBudgetActionRuntimeContext): boolean {
  return !!value && REF.test(value.workspaceRef) && (value.accountGroupRef === null || REF.test(value.accountGroupRef))
    && REF.test(value.accountRef) && REF.test(value.ownerPublicRef) && REF.test(value.ownerEntityExternalRef)
    && REF.test(value.accountExternalRef) && value.accountRef === value.accountExternalRef && REF.test(value.campaignRef) && Array.isArray(value.internalCategoryRefs)
    && value.internalCategoryRefs.every((ref) => REF.test(ref)) && Array.isArray(value.rules)
    && !!value.protection && HASH.test(value.frozenContextHash) && HASH.test(value.dataHealthReportHash) && typeof value.dataHealthReady === "boolean";
}
function validInput(value: GuideBudgetActionPrepareInput): boolean {
  return !!value && UUID.test(value.workspaceId) && UUID.test(value.guideRevisionId) && !!value.requester
    && REF.test(value.requester.actorRef) && ["owner", "admin", "operator", "analyst"].includes(value.requester.role)
    && iso(value.proposedAt) && iso(value.expiresAt) && value.expiresAt > value.proposedAt;
}
function hold(dryRun: GuideBudgetDryRun, reasons: readonly string[]): GuideBudgetActionPreparation {
  return Object.freeze({ version: GUIDE_BUDGET_ACTION_PREPARATION_VERSION, disposition: "held" as const,
    holdReasons: uniqueReasons(reasons), dryRun, authority: heldAuthority });
}

/**
 * A server composition invokes this at both ActionUnit materialization and
 * execution admission.  Rebuilding the dry-run prevents an old staged unit
 * from surviving an inactive Guide, stale receipt, changed owner, or health
 * regression.
 */
export class GuideBudgetActionPreparationService {
  private readonly dryRun: GuideBudgetDryRunService;

  constructor(evidence: GuideBudgetEvidenceReadPort, private readonly contexts: GuideBudgetActionTrustedContextReadPort) {
    this.dryRun = new GuideBudgetDryRunService(evidence);
  }

  async prepare(input: GuideBudgetActionPrepareInput): Promise<GuideBudgetActionPreparation> {
    if (!validInput(input)) throw new GuideBudgetActionPreparationError("invalid_input");
    let dryRun: GuideBudgetDryRun;
    try { dryRun = await this.dryRun.execute({ workspaceId: input.workspaceId, guideRevisionId: input.guideRevisionId, at: input.proposedAt }); }
    catch { throw new GuideBudgetActionPreparationError("evidence_unavailable"); }
    if (dryRun.status !== "ready") return hold(dryRun, dryRun.holdReasons);
    let trusted: Awaited<ReturnType<GuideBudgetActionTrustedContextReadPort["load"]>>;
    try { trusted = await this.contexts.load({ workspaceId: input.workspaceId, guideRevisionId: input.guideRevisionId, dryRun, evaluatedAt: input.proposedAt }); }
    catch (reason) {
      if (reason && typeof reason === "object" && "code" in reason && typeof reason.code === "string") {
        const heldContextReasons = new Set(["parent_ceiling_unavailable", "data_health_hold", "context_unavailable", "policy_unavailable", "autonomy_unavailable", "protection_unavailable", "owner_missing", "owner_ambiguous"]);
        if (heldContextReasons.has(reason.code)) return hold(dryRun, [reason.code]);
      }
      throw new GuideBudgetActionPreparationError("evidence_unavailable");
    }
    const runtime = trusted.runtime;
    if (!validRuntime(runtime)) throw new GuideBudgetActionPreparationError("evidence_unavailable");
    if (!runtime.dataHealthReady) return hold(dryRun, ["data_health_hold"]);
    if (!dryRun.effectiveRequiresHumanApproval || dryRun.effectiveGuideMode !== "prepare_human_approval" || dryRun.effectiveActionDisposition !== "human_approval") return hold(dryRun, ["guide_mode_not_stageable"]);
    // The evidence adapter currently has no durable parent/pool ceiling field.
    // Treat its absence as an explicit hold; it can never mean an unlimited pool.
    if (dryRun.effectiveParentCeilingDecimal === null) return hold(dryRun, ["parent_ceiling_unavailable"]);
    if (!dryRun.effectiveBudgetOwner || dryRun.effectiveBudgetKind === null || dryRun.currentBudgetDecimal === null || dryRun.evaluatedBudgetDecimal === null
      || dryRun.requestedDeltaDecimal === null || dryRun.requestedDeltaDecimal === "0") {
      return hold(dryRun, ["budget_owner_or_delta_unresolved"]);
    }
    const owner = dryRun.effectiveBudgetOwner;
    // CBO is emitted against its campaign owner; ABO is emitted against its
    // exact ad set owner. A target slice is never substituted for the owner.
    if (runtime.ownerPublicRef !== owner.budgetOwnerRef) {
      return hold(dryRun, ["budget_owner_public_alias_mismatch"]);
    }
    if (owner.budgetOwnerKind === "campaign" && runtime.campaignRef !== runtime.ownerEntityExternalRef) {
      return hold(dryRun, ["cbo_campaign_owner_mismatch"]);
    }
    const entity = Object.freeze({ level: owner.budgetOwnerKind === "campaign" ? "campaign" as const : "adset" as const, ref: runtime.ownerEntityExternalRef });
    const intent: Extract<TypedActionIntent, { kind: "budget_change" }> = Object.freeze({ kind: "budget_change", entity,
      budgetKind: dryRun.effectiveBudgetKind!, currency: dryRun.currency, beforeDecimal: dryRun.currentBudgetDecimal,
      afterDecimal: dryRun.evaluatedBudgetDecimal, budgetOwnerRef: runtime.ownerEntityExternalRef });
    const actionPlan = buildActionPlan(intent, {
      workspaceRef: runtime.workspaceRef, accountGroupRef: runtime.accountGroupRef,
      accountRef: runtime.accountRef, internalCategoryRefs: runtime.internalCategoryRefs,
      campaignRef: runtime.campaignRef, entity, evaluatedAt: input.proposedAt, rules: runtime.rules,
      budgetLimits: {
        currency: dryRun.currency, maximumAbsoluteDeltaDecimal: dryRun.effectiveMaximumAbsoluteDeltaDecimal,
        maximumRelativeDeltaBasisPoints: dryRun.effectiveMaximumRelativeDeltaBasisPoints,
        limitRefs: ["guide_budget_dry_run"],
      }, protection: runtime.protection,
      frozenContextHash: digest({ effectiveContextHash: runtime.frozenContextHash, dataHealthReportHash: runtime.dataHealthReportHash }),
    });
    // A Guide never converts a limited-autonomy candidate into a queue item.
    // Every staged P04 budget action retains the existing single-human path.
    if (actionPlan.disposition !== "approval_required" || actionPlan.effectiveAutonomy !== "approval_only") {
      return hold(dryRun, ["mode_or_autonomy_hold", ...actionPlan.reasonCodes]);
    }
    const actionHash = digest(actionPlan.action);
    // The full dry-run digest is recoverable from this *identity*, not merely
    // a short discriminator. planHash additionally binds every immutable fact
    // that admission must reproduce: Guide interpretation, constraint result,
    // valve policy/protection outcome and frozen context.
    const plan = Object.freeze({ planRef: `guide_budget_${input.guideRevisionId.replaceAll("-", "")}_${dryRun.dryRunHash}`, revision: 1,
      planHash: digest({ version: GUIDE_BUDGET_ACTION_PREPARATION_VERSION, guideRevisionId: input.guideRevisionId,
        dryRunHash: dryRun.dryRunHash, actionPlanHash: actionPlan.planHash, actionHash,
        contextHash: actionPlan.contextHash, approvalPolicyHash: digest(trusted.approvalPolicy) }) });
    try {
      const staged = new ActionProposalStagingService(trusted.approvalPolicy).stage({ plan, workspaceRef: runtime.workspaceRef,
        accountRef: runtime.accountRef, requester: input.requester, proposedAt: input.proposedAt, expiresAt: input.expiresAt,
        units: [{ unitKey: `guide_budget_${dryRun.dryRunHash.slice(0, 20)}`, plan, actionPlan,
          workspaceRef: runtime.workspaceRef, accountRef: runtime.accountRef, entityRef: entity.ref,
          actionType: actionPlan.actionType, risk: actionPlan.risk, actionHash, dependencies: [],
          summary: { safety: "public_safe", before: { label: dryRun.effectiveBudgetKind === "lifetime" ? "Toplam bütçe" : "Günlük bütçe", value: dryRun.currentBudgetDecimal },
            after: { label: dryRun.effectiveBudgetKind === "lifetime" ? "Toplam bütçe" : "Günlük bütçe", value: dryRun.evaluatedBudgetDecimal }, evidence: [
              { evidenceRef: "guide_budget_dry_run", label: "Aktif Kılavuz bütçe kanıtı yeniden doğrulandı" },
              { evidenceRef: "guide_budget_owner", label: owner.budgetOwnerKind === "campaign" ? "CBO kampanya bütçe sahibi doğrulandı" : "ABO reklam seti bütçe sahibi doğrulandı" },
              { evidenceRef: "guide_budget_limits", label: "Kılavuz limitleri ve üst tavan doğrulandı" },
              { evidenceRef: "data_health", label: "Veri sağlığı uygulama öncesi hazır" },
            ] } }], });
      return Object.freeze({ version: GUIDE_BUDGET_ACTION_PREPARATION_VERSION, disposition: "staged" as const,
        dryRun, intent, staged, authority: stagedAuthority });
    } catch {
      throw new GuideBudgetActionPreparationError("staging_rejected");
    }
  }

  async revalidateForAdmission(input: GuideBudgetActionPrepareInput & Readonly<{ expectedDryRunHash: string; expectedActionUnitRef: string; evaluatedAt: string }>): Promise<GuideBudgetActionAdmission> {
    if (!HASH.test(input.expectedDryRunHash) || !/^action_unit_[a-f0-9]{20}$/.test(input.expectedActionUnitRef) || !iso(input.evaluatedAt)) throw new GuideBudgetActionPreparationError("invalid_input");
    const preparation = await this.prepare(input);
    // The ActionUnit ref remains the immutable binding supplied to the existing
    // admission service.  This independent fresh read proves that the active
    // Guide/receipt/overlap interpretation still has that exact meaning now.
    let current: GuideBudgetDryRun;
    try { current = await this.dryRun.execute({ workspaceId: input.workspaceId, guideRevisionId: input.guideRevisionId, at: input.evaluatedAt }); }
    catch { throw new GuideBudgetActionPreparationError("evidence_unavailable"); }
    let admissionContext: Awaited<ReturnType<GuideBudgetActionTrustedContextReadPort["load"]>>;
    try { admissionContext = await this.contexts.load({ workspaceId: input.workspaceId, guideRevisionId: input.guideRevisionId, dryRun: current, evaluatedAt: input.evaluatedAt }); }
    catch { throw new GuideBudgetActionPreparationError("evidence_unavailable"); }
    const matches = preparation.disposition === "staged" && preparation.staged.summaries.length === 1
      && preparation.staged.summaries[0]!.unitRef === input.expectedActionUnitRef
      && Date.parse(input.expiresAt) > Date.parse(input.evaluatedAt)
      && validRuntime(admissionContext.runtime) && admissionContext.runtime.dataHealthReady
      && current.status === "ready" && current.dryRunHash === input.expectedDryRunHash;
    return Object.freeze({ version: GUIDE_BUDGET_ACTION_PREPARATION_VERSION, disposition: matches ? "admission_ready" as const : "held" as const,
      holdReasons: matches ? Object.freeze([]) : uniqueReasons(current.status === "held" ? current.holdReasons
        : preparation.disposition === "held" ? preparation.holdReasons : ["admission_revalidation_changed"]),
      preparation, authority: admissionAuthority });
  }

  /** Adapter-facing gate for an already persisted immutable ActionUnit. */
  async revalidatePersisted(input: Readonly<{ workspaceId: string; guideRevisionId: string; binding: GuideBudgetPersistedBinding; evaluatedAt: string }>): Promise<boolean> {
    const binding = input.binding;
    if (!UUID.test(input.workspaceId) || !UUID.test(input.guideRevisionId) || !binding || !/^action_unit_[a-f0-9]{20}$/.test(binding.unitRef)
      || !HASH.test(binding.plan.planHash) || !HASH.test(binding.sourceHash) || !HASH.test(binding.contextHash)
      || !HASH.test(binding.actionPlanHash) || !HASH.test(binding.actionHash) || !iso(binding.expiresAt)
      || !iso(input.evaluatedAt) || Date.parse(binding.expiresAt) <= Date.parse(input.evaluatedAt)) return false;
    // A full digest is deliberately embedded for recovery, but never accepted
    // by itself: the newly reconstructed plan below must exact-match it.
    const identity = new RegExp(`^guide_budget_${input.guideRevisionId.replaceAll("-", "")}_([a-f0-9]{64})$`).exec(binding.plan.planRef);
    if (!identity) return false;
    const probeExpiresAt = new Date(Date.parse(input.evaluatedAt) + 60_000).toISOString();
    let rebuilt: GuideBudgetActionPreparation;
    try {
      rebuilt = await this.prepare({ workspaceId: input.workspaceId, guideRevisionId: input.guideRevisionId,
        requester: { actorRef: "actor_admission", role: "owner" }, proposedAt: input.evaluatedAt, expiresAt: probeExpiresAt });
    } catch { return false; }
    if (rebuilt.disposition !== "staged" || rebuilt.staged.summaries.length !== 1) return false;
    const summary = rebuilt.staged.summaries[0]!;
    const rebuiltUnit = rebuilt.staged.lifecycle.bundle.units[0]!;
    return rebuilt.dryRun.dryRunHash === identity[1]
      && rebuilt.staged.lifecycle.bundle.plan.planHash === binding.plan.planHash
      && summary.actionPlanHash === binding.actionPlanHash
      && rebuiltUnit.sourceHash === binding.sourceHash
      && summary.actionPlan.contextHash === binding.contextHash
      && digest(summary.actionPlan.action) === binding.actionHash
      && digest(binding.action) === binding.actionHash
      && JSON.stringify(stable(summary.actionPlan.action)) === JSON.stringify(stable(binding.action));
  }
}
