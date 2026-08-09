import { createHash } from "node:crypto";

export const CATEGORY_CONTEXT_SCHEMA_VERSION = 1 as const;
export const CATEGORY_ENTITY_LEVELS = ["campaign", "ad_set", "ad", "creative"] as const;
const CATEGORY_CARDINALITIES = ["single", "multi"] as const;
const CATEGORY_ASSIGNMENT_OPERATIONS = ["add", "override", "deny"] as const;
const CATEGORY_ASSIGNMENT_SOURCES = ["manual", "agent", "deterministic"] as const;

export type CategoryEntityLevel = typeof CATEGORY_ENTITY_LEVELS[number];
export type CategoryCardinality = "single" | "multi";
export type CategoryAssignmentOperation = "add" | "override" | "deny";
export type CategoryAssignmentSource = "manual" | "agent" | "deterministic";

export type CategoryDimension = Readonly<{
  id: string;
  workspaceId: string;
  key: string;
  version: number;
  cardinality: CategoryCardinality;
  allowedEntityLevels: readonly CategoryEntityLevel[];
  archivedAt: string | null;
}>;

export type CategoryDefinition = Readonly<{
  id: string;
  workspaceId: string;
  dimensionId: string;
  key: string;
  label: string;
  version: number;
  archivedAt: string | null;
}>;

export type CategoryAssignmentEvidence = Readonly<{
  kind: string;
  ref: string;
  observedAt?: string;
}>;

export type CategoryAssignment = Readonly<{
  id: string;
  workspaceId: string;
  dimensionId: string;
  definitionId: string;
  entity: Readonly<{ level: CategoryEntityLevel; id: string }>;
  operation: CategoryAssignmentOperation;
  source: CategoryAssignmentSource;
  manualLock: boolean;
  evidence: readonly CategoryAssignmentEvidence[];
  confidence: number;
  version: number;
  archivedAt: string | null;
}>;

export type CategoryEntityPath = Readonly<{
  workspaceId: string;
  nodes: readonly Readonly<{ level: CategoryEntityLevel; id: string }>[];
}>;

export type FrozenCategoryContext = Readonly<{
  schemaVersion: typeof CATEGORY_CONTEXT_SCHEMA_VERSION;
  workspaceId: string;
  path: readonly Readonly<{ level: CategoryEntityLevel; id: string }>[];
  dimension: Readonly<{ id: string; key: string; version: number; cardinality: CategoryCardinality }>;
  definitionVersions: readonly Readonly<{ id: string; key: string; version: number }>[];
  effectiveDefinitions: readonly Readonly<{ id: string; key: string; version: number }>[];
  evaluatedAssignments: readonly Readonly<{
    id: string;
    version: number;
    operation: CategoryAssignmentOperation;
    entityLevel: CategoryEntityLevel;
    manualLock: boolean;
  }>[];
  /** Optional additive evidence; absent on historical snapshots created before CategoryProfile. */
  profileBindings?: readonly Readonly<{
    categoryRef: string;
    profileRef: string;
    profileVersion: number;
    profileHash: string;
  }>[];
  resolutionHash: string;
}>;

export type EffectiveCategoryResolution = Readonly<{
  values: readonly CategoryDefinition[];
  frozenContext: FrozenCategoryContext;
}>;

export const CATEGORY_INSPECTION_REASONS = Object.freeze([
  "effective_definition",
  "no_effective_definition",
  "duplicate_node_definition",
  "manual_lock_automatic_override",
  "manual_lock_automatic_add",
  "manual_lock_automatic_deny",
  "single_multiple_override",
  "single_child_add_requires_override",
  "single_multiple_effective",
] as const);
export type CategoryInspectionReason = typeof CATEGORY_INSPECTION_REASONS[number];
export type EffectiveCategoryInspection =
  | Readonly<{ state: "applied"; reason: "effective_definition"; resolution: EffectiveCategoryResolution }>
  | Readonly<{ state: "unmatched"; reason: "no_effective_definition"; resolution: EffectiveCategoryResolution }>
  | Readonly<{ state: "parked_conflict"; reason: Exclude<CategoryInspectionReason,
    "effective_definition" | "no_effective_definition">; resolution: null }>;

export type EffectiveCategoryResolutionInput = Readonly<{
  dimension: CategoryDimension;
  definitions: readonly CategoryDefinition[];
  assignments: readonly CategoryAssignment[];
  path: CategoryEntityPath;
  mode?: "current" | "frozen_replay";
}>;

export class CategoryResolutionError extends Error {
  constructor(
    readonly code:
      | "invalid_registry"
      | "invalid_path"
      | "scope_mismatch"
      | "unsupported_level"
      | "conflicting_assignment"
      | "parked_conflict",
    message: string,
  ) {
    super(message);
    this.name = "CategoryResolutionError";
  }
}

type CategoryConflictReason = Exclude<CategoryInspectionReason,
  "effective_definition" | "no_effective_definition">;

const CONFLICT_MESSAGES: Readonly<Record<CategoryConflictReason, string>> = Object.freeze({
  duplicate_node_definition: "Aynı düğüm ve definition için birden çok aktif işlem bulunamaz",
  manual_lock_automatic_override: "Automatic override manuel kilitli kategori kararını değiştiremez",
  manual_lock_automatic_add: "Automatic add manuel kilitli deny kararını değiştiremez",
  manual_lock_automatic_deny: "Automatic deny manuel kilitli kategori kararını değiştiremez",
  single_multiple_override: "Single dimension birden çok override alamaz",
  single_child_add_requires_override: "Single dimension değerini değiştirmek için child override kullanılmalıdır",
  single_multiple_effective: "Single dimension en fazla bir effective değer üretebilir",
});

class CategoryInspectionConflict extends Error {
  constructor(readonly reason: CategoryConflictReason) {
    super(CONFLICT_MESSAGES[reason]);
    this.name = "CategoryInspectionConflict";
  }
}

function park(reason: CategoryConflictReason): never {
  throw new CategoryInspectionConflict(reason);
}

function assertText(value: string, label: string): void {
  if (!value.trim()) throw new CategoryResolutionError("invalid_registry", `${label} zorunludur`);
}

function assertVersion(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CategoryResolutionError("invalid_registry", `${label} pozitif tam sayı olmalıdır`);
  }
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodepoints(left, right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function entityKey(level: CategoryEntityLevel, id: string): string {
  return `${level}:${id}`;
}

function validatePath(path: CategoryEntityPath): void {
  assertText(path.workspaceId, "Workspace");
  if (path.nodes.length === 0) {
    throw new CategoryResolutionError("invalid_path", "Kategori çözümü en az bir entity düğümü gerektirir");
  }
  let previousIndex = -1;
  const identities = new Set<string>();
  for (const node of path.nodes) {
    assertText(node.id, "Entity ID");
    const levelIndex = CATEGORY_ENTITY_LEVELS.indexOf(node.level);
    if (levelIndex !== previousIndex + 1) {
      throw new CategoryResolutionError(
        "invalid_path",
        "Entity yolu campaign ile başlamalı ve target seviyesine kadar kesintisiz ilerlemelidir",
      );
    }
    const identity = entityKey(node.level, node.id);
    if (identities.has(identity)) {
      throw new CategoryResolutionError("invalid_path", "Entity yolu aynı düğümü tekrarlayamaz");
    }
    identities.add(identity);
    previousIndex = levelIndex;
  }
}

function assignmentOrder(left: CategoryAssignment, right: CategoryAssignment): number {
  const level = CATEGORY_ENTITY_LEVELS.indexOf(left.entity.level)
    - CATEGORY_ENTITY_LEVELS.indexOf(right.entity.level);
  if (level !== 0) return level;
  const entity = compareCodepoints(left.entity.id, right.entity.id);
  if (entity !== 0) return entity;
  const operation = compareCodepoints(left.operation, right.operation);
  if (operation !== 0) return operation;
  const definition = compareCodepoints(left.definitionId, right.definitionId);
  if (definition !== 0) return definition;
  return compareCodepoints(left.id, right.id);
}

/**
 * Resolves one category dimension over an explicit Meta hierarchy path.
 *
 * `current` ignores archived assignment revisions and requires active registry
 * versions. `frozen_replay` evaluates exactly the supplied historical revisions,
 * allowing a previously frozen context to be reconstructed after archival.
 */
function resolveEffectiveCategoryCore(input: EffectiveCategoryResolutionInput): EffectiveCategoryResolution {
  const mode = input.mode ?? "current";
  const { dimension, path } = input;
  validatePath(path);
  assertText(dimension.id, "Dimension ID");
  assertText(dimension.key, "Dimension key");
  assertVersion(dimension.version, "Dimension version");
  if (!(CATEGORY_CARDINALITIES as readonly string[]).includes(dimension.cardinality)) {
    throw new CategoryResolutionError("invalid_registry", "Dimension cardinality desteklenmiyor");
  }
  if (dimension.workspaceId !== path.workspaceId) {
    throw new CategoryResolutionError("scope_mismatch", "Dimension ve entity yolu farklı workspace kapsamındadır");
  }
  if (mode === "current" && dimension.archivedAt !== null) {
    throw new CategoryResolutionError("invalid_registry", "Arşivlenmiş dimension current çözümde kullanılamaz");
  }
  const allowedLevels = new Set(dimension.allowedEntityLevels);
  if (
    allowedLevels.size === 0
    || allowedLevels.size !== dimension.allowedEntityLevels.length
    || dimension.allowedEntityLevels.some((level) => !(CATEGORY_ENTITY_LEVELS as readonly string[]).includes(level))
  ) {
    throw new CategoryResolutionError("invalid_registry", "Allowed entity levels boş veya tekrarlı olamaz");
  }

  const definitions = new Map<string, CategoryDefinition>();
  const definitionKeys = new Set<string>();
  for (const definition of input.definitions) {
    assertText(definition.id, "Definition ID");
    assertText(definition.key, "Definition key");
    assertVersion(definition.version, "Definition version");
    if (definition.workspaceId !== dimension.workspaceId || definition.dimensionId !== dimension.id) {
      throw new CategoryResolutionError("scope_mismatch", "Definition dimension/workspace kapsamıyla uyuşmuyor");
    }
    if (mode === "current" && definition.archivedAt !== null) continue;
    if (definitions.has(definition.id)) {
      throw new CategoryResolutionError("invalid_registry", "Definition kimliği tekrarlanamaz");
    }
    if (definitionKeys.has(definition.key)) {
      throw new CategoryResolutionError("invalid_registry", "Aktif definition key dimension içinde tekrarlanamaz");
    }
    definitions.set(definition.id, definition);
    definitionKeys.add(definition.key);
  }

  const pathKeys = new Set(path.nodes.map((node) => entityKey(node.level, node.id)));
  const assignments = input.assignments
    .filter((assignment) => mode === "frozen_replay" || assignment.archivedAt === null)
    .filter((assignment) => pathKeys.has(entityKey(assignment.entity.level, assignment.entity.id)))
    .sort(assignmentOrder);
  const assignmentIds = new Set<string>();
  const seenAtNode = new Set<string>();
  for (const assignment of assignments) {
    assertText(assignment.id, "Assignment ID");
    assertVersion(assignment.version, "Assignment version");
    if (assignmentIds.has(assignment.id)) {
      throw new CategoryResolutionError("invalid_registry", "Assignment kimliği tekrarlanamaz");
    }
    assignmentIds.add(assignment.id);
    if (assignment.workspaceId !== dimension.workspaceId || assignment.dimensionId !== dimension.id) {
      throw new CategoryResolutionError("scope_mismatch", "Assignment dimension/workspace kapsamıyla uyuşmuyor");
    }
    if (!allowedLevels.has(assignment.entity.level)) {
      throw new CategoryResolutionError(
        "unsupported_level",
        `${assignment.entity.level} seviyesi bu dimension için izinli değildir`,
      );
    }
    if (!(CATEGORY_ASSIGNMENT_OPERATIONS as readonly string[]).includes(assignment.operation)) {
      throw new CategoryResolutionError("invalid_registry", "Assignment operation desteklenmiyor");
    }
    if (!(CATEGORY_ASSIGNMENT_SOURCES as readonly string[]).includes(assignment.source)) {
      throw new CategoryResolutionError("invalid_registry", "Assignment source desteklenmiyor");
    }
    if (!definitions.has(assignment.definitionId)) {
      throw new CategoryResolutionError("invalid_registry", "Assignment aktif bir definition'a bağlanmalıdır");
    }
    if (!Number.isFinite(assignment.confidence) || assignment.confidence < 0 || assignment.confidence > 1) {
      throw new CategoryResolutionError("invalid_registry", "Assignment confidence 0 ile 1 arasında olmalıdır");
    }
    if (assignment.manualLock && assignment.source !== "manual") {
      throw new CategoryResolutionError("invalid_registry", "Manual lock yalnız manual assignment üzerinde olabilir");
    }
    if (assignment.evidence.length === 0 || assignment.evidence.some((evidence) => !evidence.kind.trim() || !evidence.ref.trim())) {
      throw new CategoryResolutionError("invalid_registry", "Assignment en az bir geçerli evidence kaydı taşımalıdır");
    }
    const nodeDefinition = `${entityKey(assignment.entity.level, assignment.entity.id)}:${assignment.definitionId}`;
    if (seenAtNode.has(nodeDefinition)) {
      park("duplicate_node_definition");
    }
    seenAtNode.add(nodeDefinition);
  }

  const effective = new Set<string>();
  const positiveLocks = new Set<string>();
  const denyLocks = new Set<string>();
  for (const node of path.nodes) {
    const local = assignments.filter((assignment) => (
      assignment.entity.level === node.level && assignment.entity.id === node.id
    ));
    const overrides = local.filter((assignment) => assignment.operation === "override");
    const additions = local.filter((assignment) => assignment.operation === "add");
    const denials = local.filter((assignment) => assignment.operation === "deny");
    const automaticOverrides = overrides.filter((assignment) => assignment.source !== "manual");
    const automaticAdditions = additions.filter((assignment) => assignment.source !== "manual");
    const automaticDenials = denials.filter((assignment) => assignment.source !== "manual");

    if (automaticOverrides.length > 0) {
      const replacement = new Set(overrides.map((assignment) => assignment.definitionId));
      if (
        [...positiveLocks].some((definitionId) => !replacement.has(definitionId))
        || [...denyLocks].some((definitionId) => replacement.has(definitionId))
      ) {
        park("manual_lock_automatic_override");
      }
    }
    if (automaticAdditions.some((assignment) => denyLocks.has(assignment.definitionId))) {
      park("manual_lock_automatic_add");
    }
    if (automaticDenials.some((assignment) => positiveLocks.has(assignment.definitionId))) {
      park("manual_lock_automatic_deny");
    }

    if (overrides.length > 0) {
      if (dimension.cardinality === "single" && overrides.length > 1) {
        park("single_multiple_override");
      }
      effective.clear();
      for (const assignment of overrides) effective.add(assignment.definitionId);
    }
    for (const assignment of additions) {
      if (
        dimension.cardinality === "single"
        && effective.size > 0
        && !effective.has(assignment.definitionId)
      ) {
        park("single_child_add_requires_override");
      }
      effective.add(assignment.definitionId);
    }
    for (const assignment of denials) effective.delete(assignment.definitionId);

    const manualOverrides = overrides.filter((assignment) => assignment.source === "manual");
    if (manualOverrides.length > 0) {
      positiveLocks.clear();
      denyLocks.clear();
    }
    for (const assignment of [...manualOverrides, ...additions.filter((entry) => entry.source === "manual")]) {
      denyLocks.delete(assignment.definitionId);
      if (assignment.manualLock) positiveLocks.add(assignment.definitionId);
    }
    for (const assignment of denials.filter((entry) => entry.source === "manual")) {
      positiveLocks.delete(assignment.definitionId);
      if (assignment.manualLock) denyLocks.add(assignment.definitionId);
    }
  }

  if (dimension.cardinality === "single" && effective.size > 1) {
    park("single_multiple_effective");
  }
  const values = [...effective]
    .map((id) => definitions.get(id)!)
    .sort((left, right) => compareCodepoints(left.key, right.key) || compareCodepoints(left.id, right.id));
  const contextWithoutHash = {
    schemaVersion: CATEGORY_CONTEXT_SCHEMA_VERSION,
    workspaceId: path.workspaceId,
    path: path.nodes.map((node) => ({ level: node.level, id: node.id })),
    dimension: {
      id: dimension.id,
      key: dimension.key,
      version: dimension.version,
      cardinality: dimension.cardinality,
    },
    definitionVersions: [...new Set(assignments.map((assignment) => assignment.definitionId))]
      .map((id) => definitions.get(id)!)
      .sort((left, right) => compareCodepoints(left.key, right.key) || compareCodepoints(left.id, right.id))
      .map((definition) => ({ id: definition.id, key: definition.key, version: definition.version })),
    effectiveDefinitions: values.map((definition) => ({
      id: definition.id,
      key: definition.key,
      version: definition.version,
    })),
    evaluatedAssignments: assignments.map((assignment) => ({
      id: assignment.id,
      version: assignment.version,
      operation: assignment.operation,
      entityLevel: assignment.entity.level,
      manualLock: assignment.manualLock,
    })),
  } as const;

  return {
    values,
    frozenContext: {
      ...contextWithoutHash,
      resolutionHash: digest(contextWithoutHash),
    },
  };
}

/**
 * Read-only inspection over the exact resolver core. Registry/path validation
 * still fails closed, while expected operational conflicts are returned as
 * stable machine-readable reasons for inventory and impact previews.
 */
export function inspectEffectiveCategory(input: EffectiveCategoryResolutionInput): EffectiveCategoryInspection {
  try {
    const resolution = resolveEffectiveCategoryCore(input);
    return resolution.values.length === 0
      ? Object.freeze({ state: "unmatched" as const, reason: "no_effective_definition" as const, resolution })
      : Object.freeze({ state: "applied" as const, reason: "effective_definition" as const, resolution });
  } catch (error) {
    if (error instanceof CategoryInspectionConflict) {
      return Object.freeze({ state: "parked_conflict" as const, reason: error.reason, resolution: null });
    }
    throw error;
  }
}

/** Backward-compatible throwing resolver built on the structured inspection core. */
export function resolveEffectiveCategory(input: EffectiveCategoryResolutionInput): EffectiveCategoryResolution {
  const inspection = inspectEffectiveCategory(input);
  if (inspection.state === "parked_conflict") {
    throw new CategoryResolutionError("parked_conflict", CONFLICT_MESSAGES[inspection.reason]);
  }
  return inspection.resolution;
}
