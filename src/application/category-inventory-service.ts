import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const CATEGORY_INVENTORY_VERSION = "category-inventory/1.1.0" as const;
export const CATEGORY_CLASSIFICATION_POLICY = Object.freeze({ version: "category-classification-review/1.0.0" as const,
  minimumTrustedConfidenceBasisPoints: 7_000 as const, purpose: "review_signal_only" as const });
export type CategoryCoverageLevel = "campaign" | "ad_set" | "ad" | "creative";

export type CategoryInventoryDefinition = Readonly<{
  ref: string;
  key: string;
  label: string;
  description: string | null;
  version: number;
  assignments: Readonly<{ total: number; manualLocked: number; manual: number; agent: number;
    deterministic: number; add: number; override: number; deny: number }>;
  confidence: Readonly<{ minimumBasisPoints: number | null; averageBasisPoints: number | null;
    belowReviewThreshold: number }>;
  evidenceHealth: Readonly<{ evidenceRecords: number; assignmentsWithObservedAt: number;
    invalidEvidenceAssignments: number; kinds: readonly Readonly<{ kind: string; count: number }>[] }>;
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
          sum + definition.assignments.manualLocked, 0), 0),
        lowConfidenceAssignments: dimensions.reduce((total, item) => total + item.definitions.reduce((sum, definition) =>
          sum + definition.confidence.belowReviewThreshold, 0), 0),
        invalidEvidenceAssignments: dimensions.reduce((total, item) => total + item.definitions.reduce((sum, definition) =>
          sum + definition.evidenceHealth.invalidEvidenceAssignments, 0), 0) }),
      classificationPolicy: CATEGORY_CLASSIFICATION_POLICY, health: snapshot.health,
      dimensions: Object.freeze([...dimensions]), authority: AUTHORITY });
  }
}
