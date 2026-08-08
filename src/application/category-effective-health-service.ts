import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  EffectiveCategoryHealthScanError,
  scanPortfolioEffectiveCategoryHealth,
  type EffectiveCategoryHealthScanInput,
} from "@/application/category-effective-health-scanner";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const CATEGORY_EFFECTIVE_HEALTH_VERSION = "category-effective-health/1.0.0" as const;

export type CategoryEffectiveHealthRepository = Readonly<{
  load(workspaceId: string): Promise<EffectiveCategoryHealthScanInput>;
}>;

const AUTHORITY = Object.freeze({ canDraft: false as const, canPublish: false as const,
  canArchive: false as const, canAssign: false as const, canWriteMeta: false as const,
  canAuthorizeAction: false as const, canEnforcePolicy: false as const });

export class CategoryEffectiveHealthService {
  constructor(private readonly repository: CategoryEffectiveHealthRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async inspect(principal: TrustedDecisionRoomPrincipal) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    const input = await this.repository.load(principal.workspaceId);
    try {
      return Object.freeze({ contractVersion: CATEGORY_EFFECTIVE_HEALTH_VERSION,
        ...scanPortfolioEffectiveCategoryHealth(input), authority: AUTHORITY });
    } catch (reason) {
      if (reason instanceof EffectiveCategoryHealthScanError) throw reason;
      throw reason;
    }
  }
}
