import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { ExistingPostPromotionCanonicalMaterial, ExistingPostPromotionPolicyPort,
  ExistingPostPromotionPolicyResolution } from "@/application/existing-post-promotion-canonical-submitter";
import { ExistingPostPromotionProtectionEvidenceMaterializer,
  type ExistingPostPromotionProtectionEvidenceMaterial, type ProtectionEvidenceScope } from
  "@/application/existing-post-promotion-protection-evidence-materializer";
import { buildExistingPostPromotionAction, existingPostPromotionActionHash } from
  "@/application/existing-post-promotion-preflight";
import type { PersistedApprovalPolicyResolution } from
  "@/connectors/actions/approval-policy-registry-drizzle-repository";
import type { PersistedProtectionResolutionInput } from
  "@/connectors/actions/action-guardrail-policy-drizzle-repository";
import type { ProtectionResolution } from "@/domain/actions/action-guardrail-policy";
import type { ActionActor, ActionActorRole } from "@/domain/actions/approval-lifecycle";
import type { AutonomyRule, AutonomyScope, ProtectionContext } from "@/domain/actions/autonomy-valve";
import { evaluateExistingPostPromotionEligibility } from "@/domain/meta/promotion/existing-post-eligibility";
import type { WorkspaceMembership } from "@/security/authorization";

type ApprovalPolicyPort = Readonly<{
  resolveExistingPostPolicy(evaluatedAt: string): Promise<PersistedApprovalPolicyResolution>;
}>;
type AutonomyRulesPort = Readonly<{ resolve(): Promise<readonly AutonomyRule[]> }>;
type ProtectionPort = Readonly<{ resolve(input: PersistedProtectionResolutionInput): Promise<ProtectionResolution> }>;
export type ExistingPostPromotionMembershipPort = Readonly<{
  resolve(principal: TrustedDecisionRoomPrincipal): Promise<WorkspaceMembership | null>;
}>;

export class ExistingPostPromotionPolicyAdapterError extends Error {
  constructor(readonly code: "invalid_construction") {
    super("Mevcut gönderi policy composition güvenli biçimde kurulamadı");
    this.name = "ExistingPostPromotionPolicyAdapterError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function role(value: WorkspaceMembership["role"]): ActionActorRole | null {
  return value === "owner" || value === "admin" || value === "analyst" ? value : null;
}
function scopeMatches(scope: AutonomyScope, principal: TrustedDecisionRoomPrincipal,
  material: ExistingPostPromotionCanonicalMaterial): boolean {
  if (scope.level === "workspace") return scope.ref === principal.workspaceRef;
  if (scope.level === "account") return scope.ref === material.accountRef;
  if (scope.level === "internal_category") return material.internalCategoryRefs.includes(scope.ref);
  if (scope.level === "campaign") return scope.ref === material.campaignRef;
  if (scope.level === "entity") return scope.entityLevel === "adset" && scope.ref === material.adSetRef;
  if (scope.level === "action_type") return scope.actionType === "existing_post_promotion";
  return false;
}
function proposalExpiry(evaluatedAt: string, policy: PersistedApprovalPolicyResolution,
  rules: readonly AutonomyRule[], protection: ProtectionResolution,
  material: ExistingPostPromotionCanonicalMaterial): string | null {
  const evaluated = Date.parse(evaluatedAt);
  const candidates = [evaluated + Math.min(policy.policy.maximumProposalLifetimeSeconds * 1_000, 7 * 86_400_000)];
  if (policy.source.expiresAt !== null) candidates.push(Date.parse(policy.source.expiresAt));
  if (material.binding.expiresAt !== null) candidates.push(Date.parse(material.binding.expiresAt));
  for (const rule of rules) if (rule.effectiveFrom <= evaluatedAt && rule.expiresAt !== null && rule.expiresAt > evaluatedAt) {
    candidates.push(Date.parse(rule.expiresAt));
  }
  for (const evidence of protection.policyEvidence) if (evidence.expiresAt !== null) {
    candidates.push(Date.parse(evidence.expiresAt));
  }
  if (candidates.some((candidate) => !Number.isFinite(candidate))) return null;
  const expires = Math.min(...candidates);
  return expires > evaluated ? new Date(expires).toISOString() : null;
}
function protectionContext(resolution: ProtectionResolution): ProtectionContext {
  const resolutionRef = `protection_resolution_${resolution.resolutionHash.slice(0, 24)}`;
  const policyRefs = [...new Set([resolutionRef, ...resolution.policyEvidence.map((item) => item.policyRef)])].sort();
  return Object.freeze({ protectedInternalCategoryRefs: Object.freeze([...resolution.protectedInternalCategoryRefs]),
    affectedGeoRefs: Object.freeze([...resolution.affectedGeoRefs]), protectedGeoRefs: Object.freeze([...resolution.protectedGeoRefs]),
    changeDisposition: resolution.disposition, policyRefs: Object.freeze(policyRefs) });
}

/**
 * Server-private policy composition. It reads reviewed registries and authentic evidence only;
 * any missing, stale, ambiguous or cross-tenant input returns null and cannot write a proposal.
 */
export class ExistingPostPromotionPolicyAdapter implements ExistingPostPromotionPolicyPort {
  constructor(private readonly approval: ApprovalPolicyPort, private readonly autonomy: AutonomyRulesPort,
    private readonly evidence: ExistingPostPromotionProtectionEvidenceMaterializer,
    private readonly protection: ProtectionPort, private readonly memberships: ExistingPostPromotionMembershipPort) {
    if (!approval || !autonomy || !evidence || !protection || !memberships) {
      throw new ExistingPostPromotionPolicyAdapterError("invalid_construction");
    }
  }

  async resolve(input: Readonly<{ principal: TrustedDecisionRoomPrincipal;
    material: ExistingPostPromotionCanonicalMaterial; evaluatedAt: string }>): Promise<ExistingPostPromotionPolicyResolution | null> {
    try {
      const { principal, material, evaluatedAt } = input;
      if (!UUID.test(principal.workspaceId) || !REF.test(principal.workspaceRef) || !REF.test(principal.readerRef)
        || !UUID.test(principal.actor.userId) || !instant(evaluatedAt) || material.template.workspaceRef !== principal.workspaceRef
        || material.binding.workspaceRef !== principal.workspaceRef || material.preset.workspaceRef !== principal.workspaceRef
        || material.binding.accountRef !== material.accountRef || material.binding.campaignRef !== null
          && material.binding.campaignRef !== material.campaignRef || !REF.test(material.accountRef)
        || !REF.test(material.campaignRef) || !REF.test(material.adSetRef) || !HASH.test(material.adSetSnapshotHash)
        || !HASH.test(material.campaignSnapshotHash)) return null;

      const membership = await this.memberships.resolve(principal);
      const requesterRole = membership && membership.userId === principal.actor.userId
        && membership.workspaceId === principal.workspaceId ? role(membership.role) : null;
      if (!requesterRole) return null;
      const requester: ActionActor = Object.freeze({ actorRef: principal.readerRef, role: requesterRole });

      const approval = await this.approval.resolveExistingPostPolicy(evaluatedAt);
      if (approval.source.workspaceRef !== principal.workspaceRef || approval.policy.autonomyMode !== "approval_only"
        || !approval.policy.requesterRoles.includes(requesterRole)) return null;
      const maximumEvidenceAgeSeconds = approval.policy.maximumProtectionEvidenceAgeSeconds;
      if (!Number.isSafeInteger(maximumEvidenceAgeSeconds)
        || maximumEvidenceAgeSeconds < 1 || maximumEvidenceAgeSeconds > 604_800) return null;

      const allRules = await this.autonomy.resolve();
      const rules = Object.freeze(allRules.filter((rule) => rule.workspaceRef === principal.workspaceRef
        && rule.state === "published" && scopeMatches(rule.scope, principal, material)));
      const activeRules = rules.filter((rule) => rule.effectiveFrom <= evaluatedAt
        && (rule.expiresAt === null || rule.expiresAt > evaluatedAt));
      if (!activeRules.some((rule) => rule.scope.level === "workspace" && rule.scope.ref === principal.workspaceRef
        && rule.mode === "approval_only" && !rule.killSwitch)
        || activeRules.some((rule) => rule.killSwitch)) return null;
      const notBefore = new Date(Date.parse(evaluatedAt) - maximumEvidenceAgeSeconds * 1_000).toISOString();
      const evidenceScope: ProtectionEvidenceScope = Object.freeze({ workspaceId: principal.workspaceId,
        workspaceRef: principal.workspaceRef, accountRef: material.accountRef, campaignRef: material.campaignRef,
        entity: Object.freeze({ level: "adset" as const, ref: material.adSetRef }), evaluatedAt, notBefore });
      const evidence: ExistingPostPromotionProtectionEvidenceMaterial = await this.evidence.resolve(evidenceScope);

      const eligibility = evaluateExistingPostPromotionEligibility(material.eligibility);
      if (eligibility.status !== "promotable" || !eligibility.contentFreeze) return null;
      const action = buildExistingPostPromotionAction({ template: material.template, preset: material.preset,
        postBinding: material.postBinding, postContentHash: eligibility.contentFreeze.contentHash,
        adSetRef: material.adSetRef, destinationRef: material.destinationRef,
        budgetPlanVersionRef: material.budgetPlanVersionRef });
      const protection = await this.protection.resolve({ evaluatedAt, action: Object.freeze({
        actionHash: existingPostPromotionActionHash(action), actionType: "existing_post_promotion" as const,
        accountRef: material.accountRef, campaignRef: material.campaignRef,
        entity: Object.freeze({ level: "adset" as const, ref: material.adSetRef }), budgetChange: null,
      }), categoryEvidence: evidence.categoryEvidence, affectedGeoEvidence: evidence.affectedGeoEvidence });
      if (protection.workspaceRef !== principal.workspaceRef || protection.actionHash !== existingPostPromotionActionHash(action)
        || protection.actionType !== "existing_post_promotion" || protection.capabilities.canApprove
        || protection.capabilities.canExecute || protection.capabilities.canWriteMeta
        || protection.capabilities.canGrantApproval || protection.disposition !== "allowed"
        || protection.policyEvidence.length === 0) return null;
      const expiresAt = proposalExpiry(evaluatedAt, approval, rules, protection, material);
      if (!expiresAt) return null;
      return Object.freeze({ approvalPolicy: approval.policy, rules, protection: protectionContext(protection),
        requester, proposalExpiresAt: expiresAt });
    } catch { return null; }
  }
}
