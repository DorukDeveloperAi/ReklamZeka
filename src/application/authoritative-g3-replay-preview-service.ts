import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { InstructionPolicyImpact, InstructionPolicyImpactRepository } from "@/application/instruction-policy-impact-service";
import type { InstructionPolicyLifecycleState } from "@/application/instruction-policy-lifecycle-service";
import type { ProgressiveFormalizationState } from "@/application/progressive-formalization-service";
import type { EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import type { LoadedTrustedPolicyAuthority } from "@/connectors/policies/trusted-policy-authority-drizzle-repository";
import { buildAuthoritativeG3ReplayPreview, type AuthoritativeG3ReplayPreview } from
  "@/domain/guidance/authoritative-g3-replay-preview";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const FORMALIZATION_REF = /^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export type AuthoritativeG3ReplayPreviewRepository = Readonly<{
  loadAuthority(input: Readonly<{ workspaceId: string; accountRef: string; evaluatedAt: string }>): Promise<LoadedTrustedPolicyAuthority>;
  loadHistoricalContext(workspaceId: string, contextHash: string): Promise<StoredEffectiveCampaignContext>;
  inspectLifecycle(workspaceId: string): Promise<InstructionPolicyLifecycleState>;
  inspectFormalizations(workspaceId: string): Promise<ProgressiveFormalizationState>;
  previewImpact(workspaceId: string, policyRef: string, operation: "publish"): Promise<InstructionPolicyImpact | null>;
}>;

export class AuthoritativeG3ReplayPreviewServiceError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "invalid_transition" | "conflict") {
    super(`Authoritative G3 replay preview rejected: ${code}`);
    this.name = "AuthoritativeG3ReplayPreviewServiceError";
  }
}
function baseContext(context: StoredEffectiveCampaignContext["context"]): EffectiveCampaignContextInput {
  const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...input } = context;
  return input;
}
function valid(value: string, expression: RegExp): string {
  if (!expression.test(value)) throw new AuthoritativeG3ReplayPreviewServiceError("invalid_input");
  return value;
}
function bindsCandidateToG2(flow: ProgressiveFormalizationState["flows"][number], policy: InstructionPolicyLifecycleState["current"][number]): boolean {
  const g0 = flow.revisions[0]?.payload as unknown;
  const g1 = flow.revisions[1]?.payload as unknown;
  const g2 = flow.revisions[2]?.payload as unknown;
  if (!g0 || typeof g0 !== "object" || Array.isArray(g0) || !g1 || typeof g1 !== "object" || Array.isArray(g1)
    || !g2 || typeof g2 !== "object" || Array.isArray(g2)) return false;
  const captured = g0 as Record<string, unknown>; const scoped = g1 as Record<string, unknown>; const reviewed = g2 as Record<string, unknown>;
  if (captured.rawProvenanceRef !== policy.policy.source.rawProvenanceRef
    || captured.rawTextHash !== policy.policy.source.rawTextHash
    || typeof reviewed.guidanceSetRef !== "string" || typeof reviewed.reviewedGuidanceHash !== "string"
    || !HASH.test(reviewed.reviewedGuidanceHash) || !Array.isArray(scoped.guidanceCardRefs)) return false;
  const scopedRefs = [...scoped.guidanceCardRefs];
  const promoted = [...policy.policy.source.promotedFromGuidanceRefs].sort();
  return scopedRefs.length === promoted.length && scopedRefs.every((value, index) => value === promoted[index]
    && typeof value === "string" && REF.test(value));
}

/** No HTTP/MCP adapter intentionally wraps this service. It is an internal review-only seam. */
export class AuthoritativeG3ReplayPreviewService {
  constructor(private readonly repository: AuthoritativeG3ReplayPreviewRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async preview(principal: TrustedDecisionRoomPrincipal, request: Readonly<{
    formalizationRef: string;
    policyRef: string;
    contextHash: string;
  }>): Promise<AuthoritativeG3ReplayPreview> {
    authorizeWorkspace(principal.actor, principal.workspaceId, "instruction_policy:read", this.memberships);
    const formalizationRef = valid(request.formalizationRef, FORMALIZATION_REF);
    const policyRef = valid(request.policyRef, REF); const contextHash = valid(request.contextHash, HASH);
    const frozen = await this.repository.loadHistoricalContext(principal.workspaceId, contextHash);
    if (frozen.context.workspaceId !== principal.workspaceId || frozen.context.contextHash !== contextHash) {
      throw new AuthoritativeG3ReplayPreviewServiceError("conflict");
    }
    const [formalizations, lifecycle] = await Promise.all([
      this.repository.inspectFormalizations(principal.workspaceId), this.repository.inspectLifecycle(principal.workspaceId),
    ]);
    const flow = formalizations.flows.find((candidate) => candidate.formalizationRef === formalizationRef);
    if (!flow) throw new AuthoritativeG3ReplayPreviewServiceError("not_found");
    if (flow.level !== "G2" || flow.revisions.length !== 3) throw new AuthoritativeG3ReplayPreviewServiceError("invalid_transition");
    const candidate = lifecycle.current.find((entry) => entry.policy.policyRef === policyRef);
    if (!candidate || candidate.policy.status !== "draft" || candidate.policy.workspaceRef !== principal.workspaceRef) {
      throw new AuthoritativeG3ReplayPreviewServiceError("invalid_transition");
    }
    if (!bindsCandidateToG2(flow, candidate)) throw new AuthoritativeG3ReplayPreviewServiceError("invalid_transition");
    const authority = await this.repository.loadAuthority({ workspaceId: principal.workspaceId,
      accountRef: frozen.context.identity.accountRef, evaluatedAt: frozen.context.capturedAt });
    const composition = authority.compose(baseContext(frozen.context), lifecycle);
    if (composition.validationBoundary.productionAuthoritySourceBound !== true
      || composition.context.identity.accountRef !== frozen.context.identity.accountRef) {
      throw new AuthoritativeG3ReplayPreviewServiceError("conflict");
    }
    const impact = await this.repository.previewImpact(principal.workspaceId, policyRef, "publish");
    if (!impact) throw new AuthoritativeG3ReplayPreviewServiceError("not_found");
    const candidateAuthorityBound = authority.catalog.bindings.some((binding) => binding.policyRef === policyRef
      && binding.policyVersion === candidate.policy.policyVersion && binding.policyHash === candidate.policy.canonicalHash);
    return buildAuthoritativeG3ReplayPreview({ formalizationRef, policyRef, contextHash,
      historicalContextInvalidated: frozen.invalidated, authoritySnapshot: authority.authoritySnapshot,
      sourceBound: composition.validationBoundary.productionAuthoritySourceBound,
      composedContextHash: composition.context.contextHash, resolution: composition.resolution,
      candidateAuthorityBound, impact });
  }
}

/** Adapter helper keeps concrete Drizzle repositories behind the server-private port. */
export function createAuthoritativeG3ReplayPreviewRepository(input: Readonly<{
  authority: Pick<AuthoritativeG3ReplayPreviewRepository, "loadAuthority">;
  contexts: Pick<AuthoritativeG3ReplayPreviewRepository, "loadHistoricalContext">;
  lifecycle: Pick<AuthoritativeG3ReplayPreviewRepository, "inspectLifecycle">;
  formalizations: Pick<AuthoritativeG3ReplayPreviewRepository, "inspectFormalizations">;
  impacts: InstructionPolicyImpactRepository;
}>): AuthoritativeG3ReplayPreviewRepository {
  return Object.freeze({ ...input.authority, ...input.contexts, ...input.lifecycle, ...input.formalizations,
    previewImpact: (workspaceId, policyRef, operation) => input.impacts.preview(workspaceId, policyRef, operation) });
}
