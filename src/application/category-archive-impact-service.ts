import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const CATEGORY_ARCHIVE_IMPACT_VERSION = "category-archive-impact/2.0.0" as const;
export type CategoryArchiveTargetKind = "dimension" | "definition";
export type CategoryArchiveImpact = Readonly<{
  impactHash: string;
  target: Readonly<{ kind: CategoryArchiveTargetKind; ref: string; label: string; version: number }>;
  exactBlockers: Readonly<{ activeDefinitions: number; activeAssignments: number; manualLocks: number;
    guidanceDrafts: number; guidancePublished: number; activePromotionBindings: number;
    activePromotionTemplateScopes: number; activeAdvisedPractices: number;
    autonomyDrafts: number; autonomyPublished: number; guardrailDrafts: number; guardrailPublished: number }>;
  conservativeBlockers: Readonly<{ nonTerminalActionProposalUnits: number }>;
  historicalImpact: Readonly<{ archivedGuidance: number; expiredPromotionBindings: number;
    supersededPromotionTemplateScopes: number; retiredAdvisedPractices: number;
    supersededAdvisedPractices: number; effectiveContexts: number; alreadyInvalidatedContexts: number;
    budgetProposals: number; terminalActionProposalUnits: number }>;
  invalidationPlan: Readonly<{ categoryResolutionComponents: number; contextsNeedingInvalidation: number }>;
  coverage: Readonly<{ complete: boolean; precision: "exact_with_conservative_action_queue";
    manifestVersion: string; exactRelational: readonly string[]; exactContractRef: readonly string[];
    conservative: readonly string[]; partialOrUnknown: readonly string[];
    integrity: Readonly<{ unclassifiedJsonbColumns: number; missingManifestJsonbColumns: number;
      unresolvedCategoryRefs: number; inconsistentPromotionEdges: number;
      malformedCategoryContracts: number; corruptLifecycleRows: number; ambiguousLineage: number }> }>;
  disposition: "blocked" | "review_required";
  archiveAllowed: false;
  authority: Readonly<{ canArchive: false; canAssign: false; canAuthorizeAction: false; canWriteMeta: false }>;
}>;

export interface CategoryArchiveImpactRepository {
  preview(workspaceId: string, targetRef: string): Promise<CategoryArchiveImpact | null>;
}

export class CategoryArchiveImpactService {
  constructor(private readonly repository: CategoryArchiveImpactRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}
  async preview(principal: TrustedDecisionRoomPrincipal, targetRef: string) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    const impact = await this.repository.preview(principal.workspaceId, targetRef);
    return impact === null ? null : Object.freeze({ contractVersion: CATEGORY_ARCHIVE_IMPACT_VERSION, ...impact });
  }
}
