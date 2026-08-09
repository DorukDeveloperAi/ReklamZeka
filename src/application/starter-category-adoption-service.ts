import { createHash } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { CategoryAuthoringRepository, CategoryAuthoringState } from "@/application/category-authoring-service";
import {
  STARTER_CATEGORY_PLAYBOOK_CATALOG,
  resolveStarterCategoryProfile,
} from "@/domain/categories/starter-playbook-catalog";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const STARTER_CATEGORY_ADOPTION_VERSION = "starter-category-adoption/1.0.0" as const;
const HASH = /^[a-f0-9]{64}$/;
const CONFIRMATION = "adopt_starter_category_playbook" as const;
const AUTHORITY = Object.freeze({ canPersist: false as const, canConfirm: false,
  canAuthorizeAction: false as const, canWriteMeta: false as const, canPublishPolicy: false as const });

type CreateDimension = Readonly<{ operation: "create_dimension"; key: string; name: string;
  description: string; cardinality: "single" | "multi"; allowedEntityLevels: readonly string[] }>;
type CreateDefinition = Readonly<{ operation: "create_definition"; dimensionRef: string; key: string;
  label: string; description: string }>;

export type StarterCategoryAdoptionPlan = Readonly<{
  contractVersion: typeof STARTER_CATEGORY_ADOPTION_VERSION;
  catalogVersion: typeof STARTER_CATEGORY_PLAYBOOK_CATALOG.schemaVersion;
  catalogHash: string;
  registryHash: string;
  planHash: string;
  status: "preview_only";
  summary: Readonly<{ canonicalDimensions: 14; dimensionsToCreate: number; definitionsToCreate: number;
    profileProposals: number; satisfied: number; conflicts: number; ownerConfigurationRequired: number }>;
  dimensionCoverage: readonly Readonly<{ dimensionKey: string; disposition: "create" | "satisfied" | "conflict";
    reasonCode: "missing" | "already_present" | "incompatible_existing_definition" }> [];
  categoryCommands: readonly (CreateDimension | CreateDefinition)[];
  profileProposals: readonly Readonly<{ objective: string; categoryTemplateRef: string; proposalHash: string }> [];
  blockers: readonly Readonly<{ code: "atomic_multi_command_category_adoption_unavailable"
    | "category_profile_registry_unavailable" | "owner_configuration_required"
    | "incompatible_existing_dimension"; refs: readonly string[] }> [];
  ownerConfirmationRequired: true;
  confirmationLiteral: typeof CONFIRMATION;
  authority: typeof AUTHORITY;
}>;

export class StarterCategoryAdoptionError extends Error {
  constructor(readonly code: "invalid_input" | "conflict") {
    super(`Starter category adoption rejected: ${code}`); this.name = "StarterCategoryAdoptionError";
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function sameStrings(left: readonly string[], right: readonly string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function buildStarterCategoryAdoptionPlan(workspaceRef: string,
  state: CategoryAuthoringState): StarterCategoryAdoptionPlan {
  if (!workspaceRef.trim() || !HASH.test(state.registryHash)) throw new StarterCategoryAdoptionError("invalid_input");
  const dimensions = new Map(state.dimensions.map((dimension) => [dimension.key, dimension] as const));
  const categoryCommands: (CreateDimension | CreateDefinition)[] = [];
  const coverage: StarterCategoryAdoptionPlan["dimensionCoverage"][number][] = [];
  const conflictKeys = new Set<string>();
  const conflictRefs: string[] = [];
  for (const template of STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions) {
    const current = dimensions.get(template.dimensionKey);
    if (!current) {
      coverage.push({ dimensionKey: template.dimensionKey, disposition: "create", reasonCode: "missing" });
      categoryCommands.push({ operation: "create_dimension", key: template.dimensionKey, name: template.label,
        description: `ReklamZeka starter dimension · ${template.dimensionKey}`,
        cardinality: template.suggestedCardinality, allowedEntityLevels: template.suggestedEntityLevels });
    } else if (current.cardinality !== template.suggestedCardinality
      || !sameStrings(current.allowedEntityLevels, template.suggestedEntityLevels)) {
      coverage.push({ dimensionKey: template.dimensionKey, disposition: "conflict",
        reasonCode: "incompatible_existing_definition" });
      conflictKeys.add(template.dimensionKey);
      conflictRefs.push(template.dimensionRef);
    } else coverage.push({ dimensionKey: template.dimensionKey, disposition: "satisfied", reasonCode: "already_present" });
  }
  const ownerConfigurationRefs: string[] = [];
  for (const template of STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates) {
    if (template.kind === "owner_defined_value" || template.categoryKey === null
      || template.ownerConfigurationFields.length > 0) {
      ownerConfigurationRefs.push(template.templateRef); continue;
    }
    const dimension = dimensions.get(template.dimensionKey);
    if (dimension?.definitions.some((definition) => definition.key === template.categoryKey)) continue;
    if (conflictKeys.has(template.dimensionKey)) continue;
    categoryCommands.push({ operation: "create_definition", dimensionRef: STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions
      .find((item) => item.dimensionKey === template.dimensionKey)!.dimensionRef,
    key: template.categoryKey, label: template.label, description: template.description });
  }
  const profileProposals = STARTER_CATEGORY_PLAYBOOK_CATALOG.objectivePlaybooks.flatMap((objective) =>
    STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates.flatMap((template) => {
      if (conflictKeys.has(template.dimensionKey)) return [];
      const resolved = resolveStarterCategoryProfile({ objective: objective.objective,
        categoryTemplateRef: template.templateRef });
      return resolved.status === "review_required" ? [{ objective: objective.objective,
        categoryTemplateRef: template.templateRef, proposalHash: resolved.proposalHash }] : [];
    }));
  const blockers: StarterCategoryAdoptionPlan["blockers"][number][] = [];
  if (categoryCommands.length > 0 || profileProposals.length > 0) blockers.push({
    code: "atomic_multi_command_category_adoption_unavailable",
    refs: ["category_authoring_atomic_batch/1.0.0", "category_profile_atomic_batch/1.0.0"],
  });
  blockers.push({ code: "category_profile_registry_unavailable",
    refs: ["category_profile_authoritative_inventory/1.0.0"] });
  if (ownerConfigurationRefs.length > 0) blockers.push({ code: "owner_configuration_required",
    refs: ownerConfigurationRefs.sort() });
  if (conflictRefs.length > 0) blockers.push({ code: "incompatible_existing_dimension", refs: conflictRefs.sort() });
  const core = { contractVersion: STARTER_CATEGORY_ADOPTION_VERSION,
    catalogVersion: STARTER_CATEGORY_PLAYBOOK_CATALOG.schemaVersion,
    catalogHash: STARTER_CATEGORY_PLAYBOOK_CATALOG.catalogHash, registryHash: state.registryHash,
    status: "preview_only" as const,
    summary: { canonicalDimensions: 14 as const,
      dimensionsToCreate: categoryCommands.filter((command) => command.operation === "create_dimension").length,
      definitionsToCreate: categoryCommands.filter((command) => command.operation === "create_definition").length,
      profileProposals: profileProposals.length, satisfied: coverage.filter((item) => item.disposition === "satisfied").length,
      conflicts: conflictRefs.length, ownerConfigurationRequired: ownerConfigurationRefs.length },
    dimensionCoverage: coverage, categoryCommands, profileProposals, blockers,
    ownerConfirmationRequired: true as const, confirmationLiteral: CONFIRMATION, authority: AUTHORITY };
  return Object.freeze({ ...core, planHash: digest({ workspaceRef, ...core }) });
}

export class StarterCategoryAdoptionService {
  constructor(private readonly repository: Pick<CategoryAuthoringRepository, "inspect">,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async preview(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    const plan = buildStarterCategoryAdoptionPlan(principal.workspaceRef,
      await this.repository.inspect(principal.workspaceId));
    return Object.freeze({ ...plan, authority: Object.freeze({ ...AUTHORITY,
      canConfirm: membership.role === "owner" || membership.role === "admin" }) });
  }

  async confirm(principal: TrustedDecisionRoomPrincipal, input: Readonly<{
    planHash: string; expectedRegistryHash: string; confirmation: typeof CONFIRMATION;
  }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:publish", this.memberships);
    if (membership.role !== "owner" && membership.role !== "admin" || !HASH.test(input.planHash)
      || !HASH.test(input.expectedRegistryHash) || input.confirmation !== CONFIRMATION) {
      throw new StarterCategoryAdoptionError("invalid_input");
    }
    const plan = buildStarterCategoryAdoptionPlan(principal.workspaceRef,
      await this.repository.inspect(principal.workspaceId));
    if (plan.planHash !== input.planHash || plan.registryHash !== input.expectedRegistryHash) {
      throw new StarterCategoryAdoptionError("conflict");
    }
    const blocker = plan.blockers.find((entry) => entry.code === "incompatible_existing_dimension")?.code
      ?? plan.blockers.find((entry) => entry.code === "atomic_multi_command_category_adoption_unavailable")?.code
      ?? plan.blockers.find((entry) => entry.code === "category_profile_registry_unavailable")?.code
      ?? "owner_configuration_required";
    const requiredCapability = blocker === "atomic_multi_command_category_adoption_unavailable"
      ? "category_authoring_atomic_batch/1.0.0 + category_profile_atomic_batch/1.0.0"
      : blocker === "category_profile_registry_unavailable"
        ? "category_profile_authoritative_inventory/1.0.0"
        : blocker === "incompatible_existing_dimension"
          ? "owner_category_dimension_conflict_resolution/1.0.0"
          : "owner_starter_category_configuration/1.0.0";
    return Object.freeze({ ...plan, status: "blocked" as const,
      persistenceAttempted: false as const, blocker,
      continuation: Object.freeze({
        requiredCapability,
        replay: Object.freeze({ planHash: plan.planHash, expectedRegistryHash: plan.registryHash,
          confirmation: CONFIRMATION }),
      }), authority: Object.freeze({ ...AUTHORITY, canConfirm: true }) });
  }
}
