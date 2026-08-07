import { createHash } from "node:crypto";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { ExistingPostPromotionProposalService, type ExistingPostPromotionProposalRepository,
  type ExistingPostPromotionProposalResult } from "@/application/existing-post-promotion-proposal-service";
import { ExistingPostPromotionPreflightService, type ExistingPostPromotionPreflightInput,
  type VerifiedExistingPostBinding } from "@/application/existing-post-promotion-preflight";
import type { ExistingPostPromotionPreflightRequest } from "@/application/existing-post-promotion-preflight-service";
import type { ActionActor, ApprovalPolicy } from "@/domain/actions/approval-lifecycle";
import type { ActionValveContext, AutonomyRule, ProtectionContext } from "@/domain/actions/autonomy-valve";
import { META_COMPATIBILITY_DIMENSIONS, type MetaCompatibilityResolution } from "@/domain/meta/promotion/compatibility-artifact";
import type { AudiencePresetRevision, PromotionTemplateBinding, PromotionTemplateRevision } from "@/domain/meta/promotion/promotion-template";
import type { ExistingPostPromotionEligibilityInput } from "@/domain/meta/promotion/existing-post-eligibility";

export type ExistingPostPromotionCanonicalMaterial = Readonly<{
  template: PromotionTemplateRevision; preset: AudiencePresetRevision; binding: PromotionTemplateBinding;
  eligibility: ExistingPostPromotionEligibilityInput; postBinding: VerifiedExistingPostBinding;
  adSetRef: string; destinationRef: string; budgetPlanVersionRef: string; internalCategoryRefs: readonly string[];
  accountRef: string; campaignRef: string; adSetSnapshotHash: string; campaignSnapshotHash: string;
}>;
export type ExistingPostPromotionMaterialResolver = Readonly<{ resolve(input: Readonly<{
  principal: TrustedDecisionRoomPrincipal; selection: ExistingPostPromotionPreflightRequest; selectionHash: string; evaluatedAt: string;
}>): Promise<ExistingPostPromotionCanonicalMaterial | null> }>;
export type ExistingPostPromotionCompatibilityPort = Readonly<{ resolve(selectionHash: string, evaluatedAt: string): Promise<MetaCompatibilityResolution> }>;
export type ExistingPostPromotionPolicyResolution = Readonly<{
  /** All fields must come from published server-side registries; the submitter supplies no defaults. */
  approvalPolicy: ApprovalPolicy; rules: readonly AutonomyRule[]; protection: ProtectionContext; requester: ActionActor;
  proposalExpiresAt: string;
}>;
export type ExistingPostPromotionPolicyPort = Readonly<{ resolve(input: Readonly<{
  principal: TrustedDecisionRoomPrincipal; material: ExistingPostPromotionCanonicalMaterial; evaluatedAt: string;
}>): Promise<ExistingPostPromotionPolicyResolution | null> }>;

export class ExistingPostPromotionCanonicalSubmitError extends Error {
  constructor(readonly code: "invalid_input" | "material_unavailable" | "compatibility_unconfirmed" | "policy_unavailable" | "proposal_rejected") {
    super("Mevcut gönderi öneri materyali güvenli biçimde kurulamadı"); this.name = "ExistingPostPromotionCanonicalSubmitError";
  }
}
const HASH = /^[a-f0-9]{64}$/; const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const SELECTION_KEYS = ["accountRef", "adSetRef", "actorRef", "postRef", "promotionTemplateRef", "audiencePresetRef",
  "budgetPlanRef", "timeframeRef", "objectiveRef", "internalCategoryRef"] as const;
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])); return value; }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
export function existingPostPromotionSelectionHash(selection: ExistingPostPromotionPreflightRequest): string {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)
    || Object.keys(selection).length !== SELECTION_KEYS.length || Object.keys(selection).some((key) => !SELECTION_KEYS.includes(key as never))
    || SELECTION_KEYS.some((key) => !REF.test(selection[key]))) throw new ExistingPostPromotionCanonicalSubmitError("invalid_input");
  return digest(Object.fromEntries(SELECTION_KEYS.map((key) => [key, selection[key]])));
}
/** Shared evidence key for both producer and consumer; changing any immutable material invalidates prior evidence. */
export function existingPostPromotionEvidenceSelectionHash(requestSelectionHash: string,
  material: ExistingPostPromotionCanonicalMaterial): string {
  const source = material.postBinding.sourceBinding;
  const sourceHashes = source.kind === "existing_ad_binding" ? [source.bindingHash]
    : [source.sourceHash, source.postIdentityHash, source.objectStorySpecHash];
  const materialHashes = [material.template.templateHash, material.preset.presetHash, material.binding.bindingHash,
    material.eligibility.post.contentHash, material.adSetSnapshotHash, material.campaignSnapshotHash, ...sourceHashes];
  if (!HASH.test(requestSelectionHash)
    || materialHashes.some((value) => typeof value !== "string" || !HASH.test(value))) {
    throw new ExistingPostPromotionCanonicalSubmitError("material_unavailable");
  }
  return digest({ requestSelectionHash, templateHash: material.template.templateHash, presetHash: material.preset.presetHash,
    bindingHash: material.binding.bindingHash, postContentHash: material.eligibility.post.contentHash,
    sourceBinding: source, adSetSnapshotHash: material.adSetSnapshotHash, campaignSnapshotHash: material.campaignSnapshotHash });
}

/** Resolves immutable server material, then writes at most one K4 proposal draft. */
export class ExistingPostPromotionCanonicalSubmitter {
  constructor(private readonly material: ExistingPostPromotionMaterialResolver,
    private readonly compatibility: ExistingPostPromotionCompatibilityPort, private readonly policy: ExistingPostPromotionPolicyPort,
    private readonly queue: ExistingPostPromotionProposalRepository, private readonly clock: () => Date = () => new Date()) {}
  async submitResolved(input: Readonly<{ principal: TrustedDecisionRoomPrincipal; selection: ExistingPostPromotionPreflightRequest }>): Promise<ExistingPostPromotionProposalResult> {
    const selectionHash = existingPostPromotionSelectionHash(input.selection); const now = this.clock();
    if (!Number.isFinite(now.valueOf())) throw new ExistingPostPromotionCanonicalSubmitError("invalid_input");
    const evaluatedAt = now.toISOString();
    let material: ExistingPostPromotionCanonicalMaterial | null;
    try { material = await this.material.resolve({ principal: input.principal, selection: input.selection, selectionHash, evaluatedAt }); }
    catch { throw new ExistingPostPromotionCanonicalSubmitError("material_unavailable"); }
    if (!material || material.template.templateRef !== input.selection.promotionTemplateRef
      || material.preset.presetRef !== input.selection.audiencePresetRef || material.adSetRef !== input.selection.adSetRef
      || material.accountRef !== input.selection.accountRef || material.postBinding.postRef !== input.selection.postRef
      || material.postBinding.actorRef !== input.selection.actorRef || material.destinationRef !== material.template.destinationRef
      || material.budgetPlanVersionRef !== input.selection.budgetPlanRef || material.template.timeframe.timeframeRef !== input.selection.timeframeRef
      || material.template.objectiveRef !== input.selection.objectiveRef || !material.internalCategoryRefs.includes(input.selection.internalCategoryRef)) {
      throw new ExistingPostPromotionCanonicalSubmitError("material_unavailable");
    }
    const evidenceSelectionHash = existingPostPromotionEvidenceSelectionHash(selectionHash, material);
    let compatibility: MetaCompatibilityResolution;
    try { compatibility = await this.compatibility.resolve(evidenceSelectionHash, evaluatedAt); }
    catch { throw new ExistingPostPromotionCanonicalSubmitError("compatibility_unconfirmed"); }
    if (compatibility.selectionHash !== evidenceSelectionHash || compatibility.overallStatus !== "confirmed"
      || compatibility.dimensions.length !== 5 || new Set(compatibility.dimensions.map((item) => item.dimension)).size !== 5
      || META_COMPATIBILITY_DIMENSIONS.some((dimension) => !compatibility.dimensions.some((item) => item.dimension === dimension))
      || compatibility.dimensions.some((item) => item.status !== "confirmed" || item.evidenceHash === null || !HASH.test(item.evidenceHash))) {
      throw new ExistingPostPromotionCanonicalSubmitError("compatibility_unconfirmed");
    }
    let policy: ExistingPostPromotionPolicyResolution | null;
    try { policy = await this.policy.resolve({ principal: input.principal, material, evaluatedAt }); }
    catch { throw new ExistingPostPromotionCanonicalSubmitError("policy_unavailable"); }
    const hasActiveWorkspaceRule = policy?.rules.some((rule) => rule.state === "published" && rule.scope.level === "workspace"
      && rule.scope.ref === input.principal.workspaceRef && rule.mode === "approval_only" && !rule.killSwitch
      && rule.effectiveFrom <= evaluatedAt && (rule.expiresAt === null || rule.expiresAt > evaluatedAt));
    const proposalExpiry = policy ? Date.parse(policy.proposalExpiresAt) : Number.NaN;
    if (!policy || !hasActiveWorkspaceRule || policy.rules.some((rule) => rule.state !== "published")
      || policy.approvalPolicy.autonomyMode !== "approval_only" || policy.protection.changeDisposition !== "allowed"
      || policy.protection.policyRefs.length === 0 || !Number.isFinite(proposalExpiry)
      || new Date(policy.proposalExpiresAt).toISOString() !== policy.proposalExpiresAt
      || proposalExpiry <= now.valueOf() || proposalExpiry > now.valueOf() + 7 * 86_400_000) {
      throw new ExistingPostPromotionCanonicalSubmitError("policy_unavailable");
    }
    const planHash = digest({ selectionHash, evidenceSelectionHash, templateHash: material.template.templateHash, presetHash: material.preset.presetHash,
      bindingHash: material.binding.bindingHash, sourceBinding: material.postBinding.sourceBinding,
      compatibility: compatibility.dimensions, approvalPolicy: policy.approvalPolicy, rules: policy.rules, protection: policy.protection });
    const plan = Object.freeze({ planRef: `promotion_plan_${planHash.slice(0, 24)}`, revision: 1, planHash });
    const actionContext: ActionValveContext = Object.freeze({ workspaceRef: input.principal.workspaceRef, accountGroupRef: null,
      accountRef: material.accountRef, internalCategoryRefs: Object.freeze([...material.internalCategoryRefs]), campaignRef: material.campaignRef,
      entity: Object.freeze({ level: "adset" as const, ref: material.adSetRef }), evaluatedAt,
      rules: Object.freeze([...policy.rules]), budgetLimits: null, protection: policy.protection });
    const preflight: ExistingPostPromotionPreflightInput = Object.freeze({ template: material.template, preset: material.preset,
      binding: material.binding, eligibility: material.eligibility, postBinding: material.postBinding, adSetRef: material.adSetRef,
      destinationRef: material.destinationRef, budgetPlanVersionRef: material.budgetPlanVersionRef,
      internalCategoryRefs: material.internalCategoryRefs, plan, requester: policy.requester, proposedAt: evaluatedAt, expiresAt: policy.proposalExpiresAt,
      actionContext, summary: Object.freeze({ safety: "public_safe" as const,
        before: Object.freeze({ label: "Önce", value: "Mevcut gönderi" }),
        after: Object.freeze({ label: "Sonra", value: "K4 reklam önerisi · onay gerekli" }),
        evidence: Object.freeze(compatibility.dimensions.map((item) => Object.freeze({
          evidenceRef: `compatibility_evidence_${item.evidenceHash!.slice(0, 24)}`, label: `${item.dimension} uyumluluğu doğrulandı`,
        }))) }) });
    try { return await new ExistingPostPromotionProposalService(new ExistingPostPromotionPreflightService(policy.approvalPolicy), this.queue).submit(preflight); }
    catch { throw new ExistingPostPromotionCanonicalSubmitError("proposal_rejected"); }
  }
}
