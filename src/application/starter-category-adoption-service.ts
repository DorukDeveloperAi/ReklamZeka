import { createHash } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { CategoryAuthoringState } from "@/application/category-authoring-service";
import type { CategoryProfileLifecycleState } from "@/application/category-profile-lifecycle-service";
import { createCategoryProfile, type CategoryProfileBindings, type CategoryProfileRevision } from
  "@/domain/categories/category-profile";
import {
  STARTER_CATEGORY_PLAYBOOK_CATALOG,
  resolveStarterCategoryProfile,
} from "@/domain/categories/starter-playbook-catalog";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const STARTER_CATEGORY_ADOPTION_VERSION = "starter-category-adoption/1.1.0" as const;
const HASH = /^[a-f0-9]{64}$/;
const CONFIRMATION = "adopt_starter_category_playbook" as const;
const AUTHORITY = Object.freeze({ canPersist: false, canConfirm: false,
  canAuthorizeAction: false as const, canWriteMeta: false as const, canPublishPolicy: false as const });

type CreateDimension = Readonly<{ operation: "create_dimension"; key: string; name: string;
  description: string; cardinality: "single" | "multi"; allowedEntityLevels: readonly string[] }>;
type CreateDefinition = Readonly<{ operation: "create_definition"; dimensionRef: string; key: string;
  label: string; description: string }>;
export type StarterCategoryProfileDraftPlan = Readonly<{
  categoryTemplateRef: string;
  categoryRef: string;
  profileRef: string;
  proposalHashes: readonly string[];
  profileDraftHash: string;
  expectedProfileHash: string;
  disposition: "create" | "satisfied" | "conflict";
  material: Readonly<{ label: string; description: string; color: string; bindings: CategoryProfileBindings }>;
}>;

export type StarterCategoryAdoptionInventory = Readonly<{
  categories: CategoryAuthoringState;
  profiles: CategoryProfileLifecycleState;
}>;

export type StarterCategoryAdoptionPlan = Readonly<{
  contractVersion: typeof STARTER_CATEGORY_ADOPTION_VERSION;
  catalogVersion: typeof STARTER_CATEGORY_PLAYBOOK_CATALOG.schemaVersion;
  catalogHash: string;
  registryHash: string;
  profileRegistryHash: string;
  planHash: string;
  status: "preview_only";
  summary: Readonly<{ canonicalDimensions: 15; dimensionsToCreate: number; definitionsToCreate: number;
    profileProposals: number; profileDraftsToCreate: number; profileDraftsSatisfied: number;
    satisfied: number; conflicts: number; ownerConfigurationRequired: number }>;
  dimensionCoverage: readonly Readonly<{ dimensionKey: string; disposition: "create" | "satisfied" | "conflict";
    reasonCode: "missing" | "already_present" | "incompatible_existing_definition" }> [];
  categoryCommands: readonly (CreateDimension | CreateDefinition)[];
  profileProposals: readonly Readonly<{ objective: string; categoryTemplateRef: string; proposalHash: string }> [];
  profileDrafts: readonly StarterCategoryProfileDraftPlan[];
  targetRefs: readonly string[];
  blockers: readonly Readonly<{ code: "pending_owner_configuration" | "incompatible_existing_dimension"
    | "existing_category_profile_conflict"; blocking: boolean; refs: readonly string[] }> [];
  ownerConfirmationRequired: true;
  pendingOwnerConfigurationAcknowledgementRequired: true;
  confirmationLiteral: typeof CONFIRMATION;
  authority: typeof AUTHORITY;
}>;

export type StarterCategoryAdoptionCommand = Readonly<{
  planHash: string;
  expectedRegistryHash: string;
  expectedProfileRegistryHash: string;
  targetRefs: readonly string[];
  confirmation: typeof CONFIRMATION;
  acknowledgedPendingOwnerConfiguration: true;
}>;

export type StarterCategoryAdoptionResult = Readonly<{
  outcome: "inserted" | "unchanged";
  registryHash: string;
  profileRegistryHash: string;
  dimensionsCreated: number;
  definitionsCreated: number;
  profileDraftsCreated: number;
  auditAppended: boolean;
  categoryInvalidationsAppended: number;
  profileInvalidationsAppended: number;
}>;

export type StarterCategoryAdoptionRepository = Readonly<{
  inspect(workspaceId: string, workspaceRef: string): Promise<StarterCategoryAdoptionInventory>;
  adopt(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: "owner" | "admin"; occurredAt: string; command: StarterCategoryAdoptionCommand }> ):
    Promise<StarterCategoryAdoptionResult>;
}>;

export class StarterCategoryAdoptionError extends Error {
  constructor(readonly code: "invalid_input" | "conflict" | "forbidden" | "not_found") {
    super(`Starter category adoption rejected: ${code}`); this.name = "StarterCategoryAdoptionError";
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
export function starterCategoryAdoptionDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export function starterCategoryProfileDraftManifestDigest(
  drafts: readonly StarterCategoryProfileDraftPlan[],
): string {
  return starterCategoryAdoptionDigest(drafts.map(({ disposition: _disposition, ...draft }) => draft));
}
function sameStrings(left: readonly string[], right: readonly string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
export function starterCategoryProfileRef(workspaceRef: string, categoryRef: string): string {
  if (!/^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(workspaceRef)
    || !/^category_[a-f0-9]{24}$/.test(categoryRef)) throw new StarterCategoryAdoptionError("invalid_input");
  return `category_profile_starter_${starterCategoryAdoptionDigest({ categoryRef, workspaceRef }).slice(0, 24)}`;
}
export function starterCategoryProfileOwnerRef(actorId: string, actorRef: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)) {
    throw new StarterCategoryAdoptionError("invalid_input");
  }
  return /^actor_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(actorRef) ? actorRef
    : `actor_starter_${starterCategoryAdoptionDigest({ actorId: actorId.toLowerCase() }).slice(0, 24)}`;
}
function emptyProfileInventory(): CategoryProfileLifecycleState {
  return Object.freeze({ registryHash: starterCategoryAdoptionDigest([]), definitions: Object.freeze([]) });
}
function mergedDraft(workspaceRef: string, templateRef: string,
  ownerRef: string): Omit<StarterCategoryProfileDraftPlan, "disposition"> {
  const resolutions = STARTER_CATEGORY_PLAYBOOK_CATALOG.objectivePlaybooks.map((objective) =>
    resolveStarterCategoryProfile({ objective: objective.objective, categoryTemplateRef: templateRef }));
  if (resolutions.some((resolution) => resolution.status !== "review_required")) {
    throw new StarterCategoryAdoptionError("conflict");
  }
  const proposals = resolutions.filter((resolution) => resolution.status === "review_required");
  const first = proposals[0]!;
  const bindings = Object.freeze({
    analysisPlaybookRefs: Object.freeze([...new Set(proposals.flatMap((proposal) =>
      proposal.profileTemplate.bindings.analysisPlaybookRefs))].sort()),
    ruleInstructionBundleRefs: Object.freeze([]), budgetPolicyRefs: Object.freeze([]),
    transferPolicyRefs: Object.freeze([]), schedulePolicyRefs: Object.freeze([]),
    actionPolicyRefs: Object.freeze([]), creativePolicyRefs: Object.freeze([]),
  });
  const material = Object.freeze({ label: first.profileTemplate.label, description: first.profileTemplate.description,
    color: first.profileTemplate.color, bindings });
  const categoryRef = first.profileTemplate.categoryRef;
  const profileRef = starterCategoryProfileRef(workspaceRef, categoryRef);
  const expected = createCategoryProfile({ workspaceRef, profileRef, categoryRef, parentCategoryRef: null,
    label: material.label, description: material.description, color: material.color, ownerRef,
    status: "draft", bindings: material.bindings });
  return Object.freeze({ categoryTemplateRef: templateRef, categoryRef, profileRef,
    proposalHashes: Object.freeze(proposals.map((proposal) => proposal.proposalHash).sort()),
    profileDraftHash: starterCategoryAdoptionDigest({ categoryRef, material,
      proposalHashes: proposals.map((proposal) => proposal.proposalHash).sort() }),
    expectedProfileHash: expected.profileHash, material });
}
function profileMatches(current: CategoryProfileRevision, draft: Omit<StarterCategoryProfileDraftPlan, "disposition">) {
  return current.profileRef === draft.profileRef && current.categoryRef === draft.categoryRef
    && current.profileHash === draft.expectedProfileHash
    && current.version === 1 && current.previousProfileHash === null && current.status === "draft"
    && current.parentCategoryRef === null && current.label === draft.material.label
    && current.description === draft.material.description && current.color === draft.material.color
    && JSON.stringify(current.bindings) === JSON.stringify(draft.material.bindings);
}

/** Deterministic, authority-free plan; persistence remains in the transaction adapter. */
export function buildStarterCategoryAdoptionPlan(workspaceRef: string, state: CategoryAuthoringState,
  profileState: CategoryProfileLifecycleState = emptyProfileInventory(),
  ownerRef = "actor_starter_catalog"): StarterCategoryAdoptionPlan {
  if (!workspaceRef.trim() || !HASH.test(state.registryHash) || !HASH.test(profileState.registryHash)) {
    throw new StarterCategoryAdoptionError("invalid_input");
  }
  if (!/^actor_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(ownerRef)) throw new StarterCategoryAdoptionError("invalid_input");
  const dimensions = new Map(state.dimensions.map((dimension) => [dimension.key, dimension] as const));
  const categoryCommands: (CreateDimension | CreateDefinition)[] = [];
  const coverage: StarterCategoryAdoptionPlan["dimensionCoverage"][number][] = [];
  const conflictKeys = new Set<string>(); const conflictRefs: string[] = [];
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
      conflictKeys.add(template.dimensionKey); conflictRefs.push(template.dimensionRef);
    } else coverage.push({ dimensionKey: template.dimensionKey, disposition: "satisfied", reasonCode: "already_present" });
  }
  const ownerConfigurationRefs: string[] = [];
  const concreteTemplates = STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates.filter((template) => {
    if (template.kind === "owner_defined_value" || template.categoryKey === null
      || template.ownerConfigurationFields.length > 0) {
      ownerConfigurationRefs.push(template.templateRef); return false;
    }
    return !conflictKeys.has(template.dimensionKey);
  });
  for (const template of concreteTemplates) {
    const dimension = dimensions.get(template.dimensionKey);
    if (dimension?.definitions.some((definition) => definition.key === template.categoryKey)) continue;
    categoryCommands.push({ operation: "create_definition",
      dimensionRef: STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions
        .find((item) => item.dimensionKey === template.dimensionKey)!.dimensionRef,
      key: template.categoryKey!, label: template.label, description: template.description });
  }
  const profileProposals = concreteTemplates.flatMap((template) =>
    STARTER_CATEGORY_PLAYBOOK_CATALOG.objectivePlaybooks.map((objective) => {
      const resolved = resolveStarterCategoryProfile({ objective: objective.objective,
        categoryTemplateRef: template.templateRef });
      if (resolved.status !== "review_required") throw new StarterCategoryAdoptionError("conflict");
      return Object.freeze({ objective: objective.objective, categoryTemplateRef: template.templateRef,
        proposalHash: resolved.proposalHash });
    }));
  const profileConflicts: string[] = [];
  const profileDrafts = concreteTemplates.map((template) => {
    const draft = mergedDraft(workspaceRef, template.templateRef, ownerRef);
    const definitions = profileState.definitions.filter((definition) => definition.definitionRef === draft.categoryRef);
    if (definitions.length > 1) throw new StarterCategoryAdoptionError("conflict");
    const current = definitions[0]?.currentProfile ?? null;
    const disposition = current === null ? "create" : profileMatches(current, draft) ? "satisfied" : "conflict";
    if (disposition === "conflict") profileConflicts.push(draft.profileRef);
    return Object.freeze({ ...draft, disposition });
  });
  const blockers: StarterCategoryAdoptionPlan["blockers"][number][] = [];
  if (ownerConfigurationRefs.length > 0) blockers.push({ code: "pending_owner_configuration", blocking: false,
    refs: ownerConfigurationRefs.sort() });
  if (conflictRefs.length > 0) blockers.push({ code: "incompatible_existing_dimension", blocking: true,
    refs: conflictRefs.sort() });
  if (profileConflicts.length > 0) blockers.push({ code: "existing_category_profile_conflict", blocking: true,
    refs: profileConflicts.sort() });
  const targetRefs = Object.freeze([...new Set([
    ...STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions.map((dimension) => dimension.dimensionRef),
    ...concreteTemplates.map((template) => categoryDefinitionPublicRef(template.dimensionKey, template.categoryKey!)),
    ...profileDrafts.map((draft) => draft.profileRef),
  ])].sort());
  if (targetRefs.length > 48) throw new StarterCategoryAdoptionError("conflict");
  const core = { contractVersion: STARTER_CATEGORY_ADOPTION_VERSION,
    catalogVersion: STARTER_CATEGORY_PLAYBOOK_CATALOG.schemaVersion,
    catalogHash: STARTER_CATEGORY_PLAYBOOK_CATALOG.catalogHash, registryHash: state.registryHash,
    profileRegistryHash: profileState.registryHash, status: "preview_only" as const,
    summary: { canonicalDimensions: 15 as const,
      dimensionsToCreate: categoryCommands.filter((command) => command.operation === "create_dimension").length,
      definitionsToCreate: categoryCommands.filter((command) => command.operation === "create_definition").length,
      profileProposals: profileProposals.length,
      profileDraftsToCreate: profileDrafts.filter((draft) => draft.disposition === "create").length,
      profileDraftsSatisfied: profileDrafts.filter((draft) => draft.disposition === "satisfied").length,
      satisfied: coverage.filter((item) => item.disposition === "satisfied").length,
      conflicts: conflictRefs.length + profileConflicts.length,
      ownerConfigurationRequired: ownerConfigurationRefs.length },
    dimensionCoverage: Object.freeze(coverage), categoryCommands: Object.freeze(categoryCommands),
    profileProposals: Object.freeze(profileProposals), profileDrafts: Object.freeze(profileDrafts), targetRefs,
    blockers: Object.freeze(blockers), ownerConfirmationRequired: true as const,
    pendingOwnerConfigurationAcknowledgementRequired: true as const,
    confirmationLiteral: CONFIRMATION, authority: AUTHORITY };
  return Object.freeze({ ...core, planHash: starterCategoryAdoptionDigest({ workspaceRef, ...core }) });
}

function exactTargets(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class StarterCategoryAdoptionService {
  constructor(private readonly repository: StarterCategoryAdoptionRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async preview(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:read", this.memberships);
    const inventory = await this.repository.inspect(principal.workspaceId, principal.workspaceRef);
    const plan = buildStarterCategoryAdoptionPlan(principal.workspaceRef, inventory.categories, inventory.profiles,
      starterCategoryProfileOwnerRef(principal.actor.userId, principal.readerRef));
    const canConfirm = membership.role === "owner" || membership.role === "admin";
    return Object.freeze({ ...plan, authority: Object.freeze({ ...AUTHORITY,
      canPersist: canConfirm && !plan.blockers.some((blocker) => blocker.blocking),
      canConfirm }) });
  }

  async confirm(principal: TrustedDecisionRoomPrincipal, input: StarterCategoryAdoptionCommand) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "category_registry:publish", this.memberships);
    if (membership.role !== "owner" && membership.role !== "admin" || !HASH.test(input.planHash)
      || !HASH.test(input.expectedRegistryHash) || !HASH.test(input.expectedProfileRegistryHash)
      || input.confirmation !== CONFIRMATION || input.acknowledgedPendingOwnerConfiguration !== true
      || !Array.isArray(input.targetRefs) || input.targetRefs.length > 48
      || input.targetRefs.some((ref) => typeof ref !== "string" || !/^[a-z][a-z0-9_.:-]{1,158}$/.test(ref))
      || new Set(input.targetRefs).size !== input.targetRefs.length
      || !exactTargets(input.targetRefs, [...input.targetRefs].sort())) {
      throw new StarterCategoryAdoptionError("invalid_input");
    }
    const result = await this.repository.adopt({ workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef,
      actorId: principal.actor.userId, actorRef: principal.readerRef, role: membership.role,
      occurredAt: new Date().toISOString(), command: input });
    const pendingOwnerConfiguration = STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates
      .filter((template) => template.kind === "owner_defined_value" || template.categoryKey === null
        || template.ownerConfigurationFields.length > 0)
      .map((template) => template.templateRef).sort();
    return Object.freeze({ contractVersion: STARTER_CATEGORY_ADOPTION_VERSION,
      catalogVersion: STARTER_CATEGORY_PLAYBOOK_CATALOG.schemaVersion,
      catalogHash: STARTER_CATEGORY_PLAYBOOK_CATALOG.catalogHash, planHash: input.planHash,
      status: "core_adopted_with_owner_configuration_pending" as const,
      pendingOwnerConfiguration: Object.freeze(pendingOwnerConfiguration),
      result, authority: Object.freeze({ ...AUTHORITY, canPersist: true, canConfirm: true }) });
  }
}
