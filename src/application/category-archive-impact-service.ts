import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const CATEGORY_ARCHIVE_IMPACT_VERSION = "category-archive-impact/1.0.0" as const;
export type CategoryArchiveTargetKind = "dimension" | "definition";
export type CategoryArchiveImpact = Readonly<{
  target: Readonly<{ kind: CategoryArchiveTargetKind; ref: string; label: string; version: number }>;
  exactBlockers: Readonly<{ activeDefinitions: number; activeAssignments: number; manualLocks: number;
    guidanceDrafts: number; guidancePublished: number; activePromotionBindings: number;
    autonomyDrafts: number; autonomyPublished: number; guardrailDrafts: number; guardrailPublished: number }>;
  historicalImpact: Readonly<{ archivedGuidance: number; expiredPromotionBindings: number;
    effectiveContexts: number; alreadyInvalidatedContexts: number; budgetProposals: number }>;
  invalidationPlan: Readonly<{ categoryResolutionComponents: number; contextsNeedingInvalidation: number }>;
  coverage: Readonly<{ complete: false; exactRelational: readonly string[]; exactContractRef: readonly string[];
    partialOrUnknown: readonly string[] }>;
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
