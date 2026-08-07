import type { ExistingPostPromotionPreflightInput } from "@/application/existing-post-promotion-preflight";
import type { StagedActionProposal } from "@/application/action-proposal-staging-service";

export const EXISTING_POST_PROMOTION_PROPOSAL_VERSION = "existing-post-promotion-proposal/2.0.0" as const;

type PreflightPort = Readonly<{
  preflight(input: ExistingPostPromotionPreflightInput): Readonly<{
    preflightHash: string;
    proposal: StagedActionProposal;
    creativeGeneration: "disabled";
    capabilities: Readonly<{
      canExecute: false;
      canWriteMeta: false;
      canGenerateCreative: false;
      canChangeTargeting: false;
      canGrantApproval: false;
    }>;
  }>;
}>;

export type ExistingPostPromotionProposalRepository = Readonly<{
  appendInitial(candidate: StagedActionProposal): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    lifecycleHash: string;
  }>>;
}>;

export type ExistingPostPromotionProposalResult = Readonly<{
  contractVersion: typeof EXISTING_POST_PROMOTION_PROPOSAL_VERSION;
  outcome: "inserted" | "unchanged";
  proposalRef: string;
  actionUnitRefs: readonly string[];
  preflightRef: string;
  disposition: "approval_required";
  risk: "K4";
  authority: Readonly<{
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canGenerateCreative: false;
    canChangeTargeting: false;
  }>;
}>;

export class ExistingPostPromotionProposalError extends Error {
  constructor(readonly code: "preflight_rejected" | "unsafe_result" | "persistence_failed") {
    super("Mevcut gönderi öne çıkarma önerisi güvenli biçimde kaydedilemedi");
    this.name = "ExistingPostPromotionProposalError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const AUTHORITY = Object.freeze({
  canApprove: false as const,
  canExecute: false as const,
  canWriteMeta: false as const,
  canGenerateCreative: false as const,
  canChangeTargeting: false as const,
});

/**
 * Persists an approval-required proposal only. Approval, grant consumption,
 * execution and Meta transport are deliberately absent from this boundary.
 */
export class ExistingPostPromotionProposalService {
  constructor(
    private readonly preflight: PreflightPort,
    private readonly repository: ExistingPostPromotionProposalRepository,
  ) {}

  async submit(input: ExistingPostPromotionPreflightInput): Promise<ExistingPostPromotionProposalResult> {
    let evaluated: ReturnType<PreflightPort["preflight"]>;
    try { evaluated = this.preflight.preflight(input); }
    catch { throw new ExistingPostPromotionProposalError("preflight_rejected"); }
    const units = evaluated.proposal.lifecycle.bundle.units;
    const summaries = evaluated.proposal.summaries;
    if (!HASH.test(evaluated.preflightHash) || evaluated.creativeGeneration !== "disabled"
      || evaluated.capabilities.canExecute || evaluated.capabilities.canWriteMeta
      || evaluated.capabilities.canGenerateCreative || evaluated.capabilities.canChangeTargeting
      || evaluated.capabilities.canGrantApproval || units.length !== 1 || summaries.length !== 1
      || units[0]!.risk !== "K4" || summaries[0]!.actionPlan.disposition !== "approval_required"
      || summaries[0]!.actionPlan.actionType !== "existing_post_promotion"
      || !REF.test(evaluated.proposal.lifecycle.bundle.bundleRef) || !REF.test(units[0]!.unitRef)) {
      throw new ExistingPostPromotionProposalError("unsafe_result");
    }
    let persisted: Awaited<ReturnType<ExistingPostPromotionProposalRepository["appendInitial"]>>;
    try { persisted = await this.repository.appendInitial(evaluated.proposal); }
    catch { throw new ExistingPostPromotionProposalError("persistence_failed"); }
    if (persisted.outcome !== "inserted" && persisted.outcome !== "unchanged" || !HASH.test(persisted.lifecycleHash)) {
      throw new ExistingPostPromotionProposalError("unsafe_result");
    }
    return Object.freeze({
      contractVersion: EXISTING_POST_PROMOTION_PROPOSAL_VERSION,
      outcome: persisted.outcome,
      proposalRef: evaluated.proposal.lifecycle.bundle.bundleRef,
      actionUnitRefs: Object.freeze(units.map((unit) => unit.unitRef)),
      preflightRef: `promotion_preflight_${evaluated.preflightHash.slice(0, 24)}`,
      disposition: "approval_required" as const,
      risk: "K4" as const,
      authority: AUTHORITY,
    });
  }
}
