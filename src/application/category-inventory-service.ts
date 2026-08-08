import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const CATEGORY_INVENTORY_VERSION = "category-inventory/1.0.0" as const;
export type CategoryCoverageLevel = "campaign" | "ad_set" | "ad" | "creative";

export type CategoryInventoryDefinition = Readonly<{
  ref: string;
  key: string;
  label: string;
  description: string | null;
  version: number;
  assignments: Readonly<{ total: number; manualLocked: number; manual: number; agent: number;
    deterministic: number; add: number; override: number; deny: number }>;
}>;
export type CategoryInventoryDimension = Readonly<{
  ref: string;
  key: string;
  name: string;
  description: string | null;
  cardinality: "single" | "multi";
  allowedEntityLevels: readonly CategoryCoverageLevel[];
  version: number;
  definitions: readonly CategoryInventoryDefinition[];
  coverage: readonly Readonly<{ level: CategoryCoverageLevel; totalEntities: number;
    directlyAssignedEntities: number; unmatchedEntities: number; coverageBasisPoints: number | null;
    deniedAssignments: number }> [];
}>;

export type CategoryInventoryHealth = Readonly<{
  dimensionsWithoutDefinitions: number;
  definitionsWithoutDirectAssignments: number;
  staleTargetAssignments: number;
  assignmentsUnderArchivedRegistry: number;
}>;

export type CategoryInventorySnapshot = Readonly<{
  dimensions: readonly CategoryInventoryDimension[];
  health: CategoryInventoryHealth;
}>;

export type CategoryInventoryRepository = Readonly<{
  list(workspaceId: string): Promise<CategoryInventorySnapshot>;
}>;

const AUTHORITY = Object.freeze({ canDraft: false as const, canPublish: false as const,
  canArchive: false as const, canAssign: false as const, canWriteMeta: false as const,
  canAuthorizeAction: false as const, canEnforcePolicy: false as const });

export class CategoryInventoryService {
  constructor(private readonly repository: CategoryInventoryRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async list(principal: TrustedDecisionRoomPrincipal) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    const snapshot = await this.repository.list(principal.workspaceId);
    const dimensions = snapshot.dimensions;
    return Object.freeze({ contractVersion: CATEGORY_INVENTORY_VERSION,
      summary: Object.freeze({ dimensions: dimensions.length,
        definitions: dimensions.reduce((total, item) => total + item.definitions.length, 0),
        directlyAssignedEntities: dimensions.reduce((total, item) => total
          + item.coverage.reduce((sum, coverage) => sum + coverage.directlyAssignedEntities, 0), 0),
        manualLocks: dimensions.reduce((total, item) => total + item.definitions.reduce((sum, definition) =>
          sum + definition.assignments.manualLocked, 0), 0) }),
      health: snapshot.health, dimensions: Object.freeze([...dimensions]), authority: AUTHORITY });
  }
}
