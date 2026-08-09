import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { CategoryCoverageLevel } from "@/application/category-inventory-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const CATEGORY_AUTHORING_VERSION = "category-authoring/1.0.0" as const;

export type CategoryAuthoringDimension = Readonly<{
  ref: string;
  key: string;
  name: string;
  description: string | null;
  cardinality: "single" | "multi";
  allowedEntityLevels: readonly CategoryCoverageLevel[];
  version: number;
  definitions: readonly Readonly<{
    ref: string;
    key: string;
    label: string;
    description: string | null;
    version: number;
  }>[];
}>;

export type CategoryAuthoringAssignment = Readonly<{
  ref: string;
  dimensionRef: string;
  definitionRef: string;
  entity: Readonly<{ level: CategoryCoverageLevel; ref: string }>;
  operation: "add" | "override" | "deny";
  manualLock: boolean;
  confidenceBasisPoints: number;
  version: number;
}>;
export type CategoryAuthoringTarget = Readonly<{
  ref: string;
  level: CategoryCoverageLevel;
  label: string;
  viaAdRef: string | null;
}>;
export type CategoryAuthoringState = Readonly<{
  registryHash: string;
  dimensions: readonly CategoryAuthoringDimension[];
  assignments: readonly CategoryAuthoringAssignment[];
  targets: readonly CategoryAuthoringTarget[];
}>;

type DimensionBody = Readonly<{
  name: string;
  description: string | null;
  cardinality: "single" | "multi";
  allowedEntityLevels: readonly CategoryCoverageLevel[];
}>;
type DefinitionBody = Readonly<{ label: string; description: string | null }>;
type AssignmentBody = Readonly<{
  assignmentOperation: "add" | "override" | "deny";
  manualLock: boolean;
  confidenceBasisPoints: number;
}>;
export type CategoryAuthoringCommand =
  | (DimensionBody & Readonly<{ operation: "create_dimension"; key: string; expectedRegistryHash: string }>)
  | (DimensionBody & Readonly<{ operation: "revise_dimension"; dimensionRef: string; expectedVersion: number;
      expectedRegistryHash: string; expectedImpactHash: string }>)
  | Readonly<{ operation: "archive_dimension"; dimensionRef: string; expectedVersion: number;
      expectedRegistryHash: string; expectedImpactHash: string }>
  | (DefinitionBody & Readonly<{ operation: "create_definition"; dimensionRef: string; key: string;
      expectedRegistryHash: string }>)
  | (DefinitionBody & Readonly<{ operation: "revise_definition"; definitionRef: string; expectedVersion: number;
      expectedRegistryHash: string; expectedImpactHash: string }>)
  | Readonly<{ operation: "archive_definition"; definitionRef: string; expectedVersion: number;
      expectedRegistryHash: string; expectedImpactHash: string }>
  | (AssignmentBody & Readonly<{ operation: "create_assignment"; dimensionRef: string; definitionRef: string;
      entityLevel: CategoryCoverageLevel; entityRef: string; viaAdRef: string | null; expectedRegistryHash: string }>)
  | (AssignmentBody & Readonly<{ operation: "revise_assignment"; assignmentRef: string; expectedVersion: number;
      expectedRegistryHash: string }>)
  | Readonly<{ operation: "unlock_assignment"; assignmentRef: string; expectedVersion: number;
      expectedRegistryHash: string }>
  | Readonly<{ operation: "archive_assignment"; assignmentRef: string; expectedVersion: number;
      expectedRegistryHash: string }>;

export type CategoryAuthoringRepository = Readonly<{
  inspect(workspaceId: string): Promise<CategoryAuthoringState>;
  mutate(input: Readonly<{
    workspaceId: string;
    actorId: string;
    actorRef: string;
    role: "owner" | "admin";
    occurredAt: string;
    command: CategoryAuthoringCommand;
  }>): Promise<Readonly<{ state: CategoryAuthoringState; auditAppended: true; invalidationsAppended: number }>>;
}>;

export class CategoryAuthoringError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict" | "dependency_blocked" | "manual_lock") {
    super(`Category authoring işlemi reddedildi: ${code}`);
    this.name = "CategoryAuthoringError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const PUBLIC_REF = /^(?:dimension|category|assignment|category_entity)_[a-f0-9]{24}$/;
const LEVELS = new Set<CategoryCoverageLevel>(["campaign", "ad_set", "ad", "creative"]);

function text(value: unknown, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new CategoryAuthoringError("invalid_input");
  const clean = value.trim();
  if (!clean || clean.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) {
    throw new CategoryAuthoringError("invalid_input");
  }
  return clean;
}

function ref(value: unknown, prefix?: "dimension" | "category" | "assignment" | "category_entity"): string {
  if (typeof value !== "string" || !PUBLIC_REF.test(value) || prefix && !value.startsWith(`${prefix}_`)) {
    throw new CategoryAuthoringError("invalid_input");
  }
  return value;
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new CategoryAuthoringError("invalid_input");
  return value as number;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new CategoryAuthoringError("invalid_input");
  return value;
}

function dimensionBody(command: DimensionBody): DimensionBody {
  if (!Array.isArray(command.allowedEntityLevels) || command.allowedEntityLevels.length < 1
    || command.allowedEntityLevels.length > 4 || command.allowedEntityLevels.some((level) => !LEVELS.has(level))
    || new Set(command.allowedEntityLevels).size !== command.allowedEntityLevels.length
    || !["single", "multi"].includes(command.cardinality)) throw new CategoryAuthoringError("invalid_input");
  return Object.freeze({ name: text(command.name, 160)!, description: text(command.description, 2_000, true),
    cardinality: command.cardinality, allowedEntityLevels: Object.freeze([...command.allowedEntityLevels].sort()) });
}

function assignmentBody(command: AssignmentBody): AssignmentBody {
  if (!["add", "override", "deny"].includes(command.assignmentOperation)
    || typeof command.manualLock !== "boolean"
    || !Number.isSafeInteger(command.confidenceBasisPoints)
    || command.confidenceBasisPoints < 0 || command.confidenceBasisPoints > 10_000) {
    throw new CategoryAuthoringError("invalid_input");
  }
  return Object.freeze({ assignmentOperation: command.assignmentOperation, manualLock: command.manualLock,
    confidenceBasisPoints: command.confidenceBasisPoints });
}

function normalize(command: CategoryAuthoringCommand): CategoryAuthoringCommand {
  hash(command.expectedRegistryHash);
  if (command.operation === "create_dimension") {
    if (!KEY.test(command.key)) throw new CategoryAuthoringError("invalid_input");
    return Object.freeze({ operation: command.operation, key: command.key, expectedRegistryHash: command.expectedRegistryHash,
      ...dimensionBody(command) });
  }
  if (command.operation === "revise_dimension") return Object.freeze({ operation: command.operation,
    dimensionRef: ref(command.dimensionRef, "dimension"), expectedVersion: expectedVersion(command.expectedVersion),
    expectedRegistryHash: command.expectedRegistryHash, expectedImpactHash: hash(command.expectedImpactHash),
    ...dimensionBody(command) });
  if (command.operation === "archive_dimension") return Object.freeze({ ...command,
    dimensionRef: ref(command.dimensionRef, "dimension"), expectedVersion: expectedVersion(command.expectedVersion),
    expectedImpactHash: hash(command.expectedImpactHash) });
  if (command.operation === "create_definition") {
    if (!KEY.test(command.key)) throw new CategoryAuthoringError("invalid_input");
    return Object.freeze({ operation: command.operation, dimensionRef: ref(command.dimensionRef, "dimension"),
      key: command.key, label: text(command.label, 160)!, description: text(command.description, 2_000, true),
      expectedRegistryHash: command.expectedRegistryHash });
  }
  if (command.operation === "revise_definition") return Object.freeze({ operation: command.operation,
    definitionRef: ref(command.definitionRef, "category"), expectedVersion: expectedVersion(command.expectedVersion),
    label: text(command.label, 160)!, description: text(command.description, 2_000, true),
    expectedRegistryHash: command.expectedRegistryHash, expectedImpactHash: hash(command.expectedImpactHash) });
  if (command.operation === "archive_definition") return Object.freeze({ ...command,
    definitionRef: ref(command.definitionRef, "category"), expectedVersion: expectedVersion(command.expectedVersion),
    expectedImpactHash: hash(command.expectedImpactHash) });
  if (command.operation === "create_assignment") {
    if (!LEVELS.has(command.entityLevel)) throw new CategoryAuthoringError("invalid_input");
    const viaAdRef = command.viaAdRef === null ? null : ref(command.viaAdRef, "category_entity");
    if (command.entityLevel === "creative" ? viaAdRef === null : viaAdRef !== null) {
      throw new CategoryAuthoringError("invalid_input");
    }
    return Object.freeze({ operation: command.operation,
      dimensionRef: ref(command.dimensionRef, "dimension"), definitionRef: ref(command.definitionRef, "category"),
      entityLevel: command.entityLevel, entityRef: ref(command.entityRef, "category_entity"), viaAdRef,
      expectedRegistryHash: command.expectedRegistryHash, ...assignmentBody(command) });
  }
  if (command.operation === "revise_assignment") return Object.freeze({ operation: command.operation,
    assignmentRef: ref(command.assignmentRef, "assignment"), expectedVersion: expectedVersion(command.expectedVersion),
    expectedRegistryHash: command.expectedRegistryHash, ...assignmentBody(command) });
  if (command.operation === "unlock_assignment") return Object.freeze({ operation: command.operation,
    assignmentRef: ref(command.assignmentRef, "assignment"), expectedVersion: expectedVersion(command.expectedVersion),
    expectedRegistryHash: command.expectedRegistryHash });
  if (command.operation === "archive_assignment") return Object.freeze({ operation: command.operation,
    assignmentRef: ref(command.assignmentRef, "assignment"), expectedVersion: expectedVersion(command.expectedVersion),
    expectedRegistryHash: command.expectedRegistryHash });
  throw new CategoryAuthoringError("invalid_input");
}

function authority(role: WorkspaceMembership["role"]) {
  const canPublish = role === "owner" || role === "admin";
  return Object.freeze({ canCreate: canPublish, canRevise: canPublish, canArchive: canPublish,
    canAssign: canPublish, canAuthorizeAction: false as const, canWriteMeta: false as const });
}

export class CategoryAuthoringService {
  constructor(private readonly repository: CategoryAuthoringRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async inspect(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    const state = await this.repository.inspect(principal.workspaceId);
    return Object.freeze({ contractVersion: CATEGORY_AUTHORING_VERSION, ...state, authority: authority(membership.role) });
  }

  async mutate(principal: TrustedDecisionRoomPrincipal, command: CategoryAuthoringCommand) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:publish", this.memberships);
    if (membership.role !== "owner" && membership.role !== "admin") throw new CategoryAuthoringError("invalid_input");
    const result = await this.repository.mutate({ workspaceId: principal.workspaceId, actorId: principal.actor.userId,
      actorRef: principal.readerRef, role: membership.role, occurredAt: new Date().toISOString(), command: normalize(command) });
    return Object.freeze({ contractVersion: CATEGORY_AUTHORING_VERSION, ...result,
      authority: authority(membership.role), canAuthorizeAction: false as const, canWriteMeta: false as const });
  }
}
