import { createHash } from "node:crypto";

import type { FrozenCategoryContext } from "@/domain/categories/registry";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";

export const CATEGORY_PROFILE_VERSION = "category-profile/1.0.0" as const;
export const CATEGORY_PROFILE_STATUSES = Object.freeze(["draft", "active", "paused", "archived"] as const);
export type CategoryProfileStatus = typeof CATEGORY_PROFILE_STATUSES[number];

export type CategoryProfileBindings = Readonly<{
  analysisPlaybookRefs: readonly string[];
  ruleInstructionBundleRefs: readonly string[];
  budgetPolicyRefs: readonly string[];
  transferPolicyRefs: readonly string[];
  schedulePolicyRefs: readonly string[];
  actionPolicyRefs: readonly string[];
  creativePolicyRefs: readonly string[];
}>;

export type CategoryProfileRevision = Readonly<{
  schemaVersion: typeof CATEGORY_PROFILE_VERSION;
  workspaceRef: string;
  profileRef: string;
  categoryRef: string;
  parentCategoryRef: string | null;
  version: number;
  previousProfileHash: string | null;
  label: string;
  description: string;
  color: string;
  ownerRef: string;
  status: CategoryProfileStatus;
  bindings: CategoryProfileBindings;
  authority: Readonly<{
    canAuthorizeAction: false;
    canExecuteWrite: false;
    canWriteMeta: false;
    canGrantApproval: false;
  }>;
  profileHash: string;
}>;

export type CategoryProfileDraft = Readonly<Omit<CategoryProfileRevision,
  "schemaVersion" | "authority" | "profileHash">>;

export type FrozenCategoryProfileBinding = Readonly<{
  categoryRef: string;
  profileRef: string;
  profileVersion: number;
  profileHash: string;
}>;

export class CategoryProfileError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_transition" | "inauthentic_profile" | "scope_mismatch") {
    super(`Kategori profili reddedildi: ${code}`);
    this.name = "CategoryProfileError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const COLOR = /^#[0-9A-F]{6}$/;
const BINDING_PREFIXES = Object.freeze({
  analysisPlaybookRefs: ["analysis_playbook_"],
  ruleInstructionBundleRefs: ["instruction_bundle_", "rule_bundle_"],
  budgetPolicyRefs: ["budget_policy_", "budget_envelope_"],
  transferPolicyRefs: ["transfer_policy_"],
  schedulePolicyRefs: ["schedule_policy_", "cadence_profile_"],
  actionPolicyRefs: ["action_policy_", "approval_policy_", "guardrail_", "autonomy_rule_"],
  creativePolicyRefs: ["creative_policy_"],
} satisfies Readonly<Record<keyof CategoryProfileBindings, readonly string[]>>);

function fail(code: CategoryProfileError["code"]): never { throw new CategoryProfileError(code); }
function exact(value: object, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    fail("invalid_input");
  }
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string") fail("invalid_input");
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    fail("invalid_input");
  }
  return normalized;
}
function ref(value: unknown, prefixes: readonly string[]): string {
  const normalized = text(value, 159);
  if (!REF.test(normalized) || !prefixes.some((prefix) => normalized.startsWith(prefix))
    || /(?:token|secret|authorization|raw[_-]?(?:payload|request|response|json))/i.test(normalized)) fail("invalid_input");
  return normalized;
}
function refs(value: unknown, prefixes: readonly string[], required: boolean): readonly string[] {
  if (!Array.isArray(value) || value.length > 64 || required && value.length === 0) fail("invalid_input");
  const normalized = value.map((entry) => ref(entry, prefixes)).sort();
  if (new Set(normalized).size !== normalized.length) fail("invalid_input");
  return Object.freeze(normalized);
}
function normalizeBindings(value: unknown): CategoryProfileBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_input");
  exact(value, Object.keys(BINDING_PREFIXES));
  const candidate = value as Record<keyof CategoryProfileBindings, unknown>;
  return Object.freeze({
    analysisPlaybookRefs: refs(candidate.analysisPlaybookRefs, BINDING_PREFIXES.analysisPlaybookRefs, true),
    ruleInstructionBundleRefs: refs(candidate.ruleInstructionBundleRefs, BINDING_PREFIXES.ruleInstructionBundleRefs, false),
    budgetPolicyRefs: refs(candidate.budgetPolicyRefs, BINDING_PREFIXES.budgetPolicyRefs, false),
    transferPolicyRefs: refs(candidate.transferPolicyRefs, BINDING_PREFIXES.transferPolicyRefs, false),
    schedulePolicyRefs: refs(candidate.schedulePolicyRefs, BINDING_PREFIXES.schedulePolicyRefs, false),
    actionPolicyRefs: refs(candidate.actionPolicyRefs, BINDING_PREFIXES.actionPolicyRefs, false),
    creativePolicyRefs: refs(candidate.creativePolicyRefs, BINDING_PREFIXES.creativePolicyRefs, false),
  });
}

function build(input: CategoryProfileDraft): CategoryProfileRevision {
  exact(input, ["workspaceRef", "profileRef", "categoryRef", "parentCategoryRef", "version", "previousProfileHash",
    "label", "description", "color", "ownerRef", "status", "bindings"]);
  if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > 1_000_000
    || input.version === 1 && input.previousProfileHash !== null
    || input.version > 1 && (typeof input.previousProfileHash !== "string" || !HASH.test(input.previousProfileHash))
    || !CATEGORY_PROFILE_STATUSES.includes(input.status)) fail("invalid_input");
  const core = Object.freeze({
    schemaVersion: CATEGORY_PROFILE_VERSION,
    workspaceRef: ref(input.workspaceRef, ["workspace_"]),
    profileRef: ref(input.profileRef, ["category_profile_"]),
    categoryRef: ref(input.categoryRef, ["category_"]),
    parentCategoryRef: input.parentCategoryRef === null ? null : ref(input.parentCategoryRef, ["category_"]),
    version: input.version,
    previousProfileHash: input.previousProfileHash,
    label: text(input.label, 200),
    description: text(input.description, 2_000),
    color: typeof input.color === "string" && COLOR.test(input.color) ? input.color : fail("invalid_input"),
    ownerRef: ref(input.ownerRef, ["actor_"]),
    status: input.status,
    bindings: normalizeBindings(input.bindings),
    authority: Object.freeze({ canAuthorizeAction: false as const, canExecuteWrite: false as const,
      canWriteMeta: false as const, canGrantApproval: false as const }),
  });
  if (core.parentCategoryRef === core.categoryRef) fail("invalid_input");
  return Object.freeze({ ...core, profileHash: digest(core) });
}

export function createCategoryProfile(input: Omit<CategoryProfileDraft, "version" | "previousProfileHash">): CategoryProfileRevision {
  return build({ ...input, version: 1, previousProfileHash: null });
}

export function reviseCategoryProfile(input: Readonly<{
  current: CategoryProfileRevision;
  changes: Partial<Pick<CategoryProfileDraft, "parentCategoryRef" | "label" | "description" | "color" | "ownerRef" | "status" | "bindings">>;
}>): CategoryProfileRevision {
  const current = assertValidCategoryProfile(input.current);
  if (current.status === "archived") fail("invalid_transition");
  const nextStatus = input.changes.status ?? current.status;
  const allowed = current.status === "draft" ? ["draft", "active", "archived"]
    : current.status === "active" ? ["active", "paused", "archived"] : ["paused", "active", "archived"];
  if (!allowed.includes(nextStatus)) fail("invalid_transition");
  return build({ workspaceRef: current.workspaceRef, profileRef: current.profileRef,
    categoryRef: current.categoryRef, parentCategoryRef: input.changes.parentCategoryRef ?? current.parentCategoryRef,
    version: current.version + 1, previousProfileHash: current.profileHash,
    label: input.changes.label ?? current.label, description: input.changes.description ?? current.description,
    color: input.changes.color ?? current.color, ownerRef: input.changes.ownerRef ?? current.ownerRef,
    status: nextStatus, bindings: input.changes.bindings ?? current.bindings });
}

export function assertValidCategoryProfile(value: unknown): CategoryProfileRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("inauthentic_profile");
  const candidate = value as CategoryProfileRevision;
  try {
    exact(candidate, ["schemaVersion", "workspaceRef", "profileRef", "categoryRef", "parentCategoryRef", "version",
      "previousProfileHash", "label", "description", "color", "ownerRef", "status", "bindings", "authority", "profileHash"]);
    exact(candidate.authority, ["canAuthorizeAction", "canExecuteWrite", "canWriteMeta", "canGrantApproval"]);
    if (candidate.schemaVersion !== CATEGORY_PROFILE_VERSION || candidate.authority.canAuthorizeAction !== false
      || candidate.authority.canExecuteWrite !== false || candidate.authority.canWriteMeta !== false
      || candidate.authority.canGrantApproval !== false || !HASH.test(candidate.profileHash)) fail("inauthentic_profile");
    const rebuilt = build({ workspaceRef: candidate.workspaceRef, profileRef: candidate.profileRef,
      categoryRef: candidate.categoryRef, parentCategoryRef: candidate.parentCategoryRef, version: candidate.version,
      previousProfileHash: candidate.previousProfileHash, label: candidate.label, description: candidate.description,
      color: candidate.color, ownerRef: candidate.ownerRef, status: candidate.status, bindings: candidate.bindings });
    if (rebuilt.profileHash !== candidate.profileHash) fail("inauthentic_profile");
    return rebuilt;
  } catch (error) {
    if (error instanceof CategoryProfileError && error.code === "inauthentic_profile") throw error;
    return fail("inauthentic_profile");
  }
}

/** Adds only opaque profile identity/version evidence to a frozen category snapshot. */
export function bindCategoryProfiles(
  context: FrozenCategoryContext,
  profiles: readonly CategoryProfileRevision[],
): FrozenCategoryContext {
  const effectiveByRef = new Set(context.effectiveDefinitions.map((definition) =>
    categoryDefinitionPublicRef(context.dimension.key, definition.key)));
  const bindings = profiles.map(assertValidCategoryProfile).map((profile) => {
    if (!effectiveByRef.has(profile.categoryRef) || profile.status !== "active") fail("scope_mismatch");
    return Object.freeze({ categoryRef: profile.categoryRef, profileRef: profile.profileRef,
      profileVersion: profile.version, profileHash: profile.profileHash });
  }).sort((left, right) => left.categoryRef.localeCompare(right.categoryRef));
  if (new Set(bindings.map((binding) => binding.categoryRef)).size !== bindings.length) fail("invalid_input");
  const { resolutionHash: _resolutionHash, ...current } = context;
  const core = Object.freeze({ ...current, profileBindings: Object.freeze(bindings) });
  return Object.freeze({ ...core, resolutionHash: digest(core) });
}
