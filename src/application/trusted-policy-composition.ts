import { createHash } from "node:crypto";

import {
  buildEffectiveCampaignContext,
  type EffectiveCampaignContext,
  type EffectiveCampaignContextInput,
} from "@/analyses/effective-campaign-context";
import type { InstructionPolicyLifecycleState, InstructionPolicyPublicRevision } from "@/application/instruction-policy-lifecycle-service";
import type { FrozenCategoryProfileBinding } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import type { FrozenCategoryContext } from "@/domain/categories/registry";
import {
  META_OBJECTIVE_MAPPING_CATALOG,
  META_OBJECTIVE_MAPPING_REVIEW,
  META_OBJECTIVE_MAPPING_VERSION,
  type CanonicalMetaObjective,
} from "@/domain/meta/objective-mapping";
import { assertStrictInstructionPolicyArtifact } from "@/domain/policies/instruction-policy-dsl";
import {
  POLICY_AUTHORITY_ORDER,
  resolvePolicyPrecedence,
  type PolicyAuthorityTier,
  type PolicyEntityLevel,
  type PolicyPrecedenceResolution,
} from "@/domain/policies/policy-precedence-resolver";

export const TRUSTED_POLICY_CATALOG_VERSION = "trusted-policy-catalog/1.0.0" as const;
export const POLICY_SCOPE_SNAPSHOT_VERSION = "policy-scope-snapshot/1.0.0" as const;
export const POLICY_MANUAL_LOCK_VERSION = "policy-manual-lock/1.0.0" as const;
export const TRUSTED_POLICY_COMPOSITION_VERSION = "trusted-policy-composition/1.0.0" as const;

export type TrustedPolicyBinding = Readonly<{
  policyRef: string;
  policyVersion: number;
  policyHash: string;
  authorityTier: PolicyAuthorityTier;
  decision: Readonly<{ decisionKey: string; positionKey: string }> | null;
  /** Required only for an internal-category playbook; the exact frozen profile revision is verified. */
  categoryProfileRef: string | null;
  categoryProfileVersion: number | null;
  categoryProfileHash: string | null;
  /** Required only for a user-locked instruction; identity is verified against a frozen manual-lock proof. */
  manualLockRef: string | null;
}>;

export type TrustedPolicyCatalog = Readonly<{
  schemaVersion: typeof TRUSTED_POLICY_CATALOG_VERSION;
  workspaceRef: string;
  catalogRef: string;
  catalogVersion: number;
  instructionPolicyRegistryHash: string;
  bindings: readonly TrustedPolicyBinding[];
  authority: Readonly<{
    canExecute: false;
    canWriteMeta: false;
    canApprove: false;
    canSchedule: false;
    canCallTool: false;
    canAccessNetwork: false;
    canQuerySql: false;
  }>;
  catalogHash: string;
}>;

export type PolicyObjectiveEvidence = Readonly<{
  canonicalObjective: CanonicalMetaObjective | null;
  mappingVersion: typeof META_OBJECTIVE_MAPPING_VERSION;
  mappingHash: string;
}>;

export type PolicyScopeSnapshot = Readonly<{
  schemaVersion: typeof POLICY_SCOPE_SNAPSHOT_VERSION;
  workspaceRef: string;
  evaluatedAt: string;
  accountGroupRefs: readonly string[];
  objectiveRefs: readonly string[];
  topicRefs: readonly string[];
  objectiveEvidence: PolicyObjectiveEvidence;
  scopeHash: string;
}>;

export type FrozenPolicyManualLock = Readonly<{
  schemaVersion: typeof POLICY_MANUAL_LOCK_VERSION;
  workspaceRef: string;
  lockRef: string;
  policyRef: string;
  policyVersion: number;
  policyHash: string;
  state: "locked";
  evaluatedAt: string;
  lockHash: string;
}>;

export type TrustedPolicyComposition = Readonly<{
  schemaVersion: typeof TRUSTED_POLICY_COMPOSITION_VERSION;
  context: EffectiveCampaignContext;
  resolution: PolicyPrecedenceResolution;
  evidence: Readonly<{
    instructionPolicyRegistryHash: string;
    /** Self-hash validated composition input; not proof of a production authority source. */
    validatedCatalogHash: string;
    scopeHash: string;
    objectiveMappingVersion: typeof META_OBJECTIVE_MAPPING_VERSION;
    objectiveMappingHash: string;
    canonicalObjective: CanonicalMetaObjective | null;
    manualLockHashes: readonly string[];
    categoryResolutionHashes: readonly string[];
  }>;
  validationBoundary: Readonly<{
    contractIntegrity: "self_hash_validated";
    productionAuthoritySourceBound: false;
  }>;
  authority: Readonly<{
    canExecute: false;
    canWriteMeta: false;
    canApprove: false;
    canSchedule: false;
    canCallTool: false;
    canAccessNetwork: false;
    canQuerySql: false;
  }>;
}>;

export class TrustedPolicyCompositionError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "inauthentic_lifecycle"
    | "inauthentic_catalog"
    | "inauthentic_scope"
    | "inauthentic_manual_lock"
    | "scope_mismatch"
    | "stale_binding"
    | "ambiguous_binding"
    | "missing_manual_lock") {
    super(`Trusted policy composition rejected: ${code}`);
    this.name = "TrustedPolicyCompositionError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const SEMANTIC_KEY = /^[a-z][a-z0-9_.:-]{1,127}$/;
const AUTHORITY = Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canApprove: false as const,
  canSchedule: false as const, canCallTool: false as const, canAccessNetwork: false as const, canQuerySql: false as const });

function fail(code: TrustedPolicyCompositionError["code"]): never { throw new TrustedPolicyCompositionError(code); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareText(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
export const VALIDATED_META_OBJECTIVE_MAPPING_HASH = digest({
  version: META_OBJECTIVE_MAPPING_VERSION,
  review: META_OBJECTIVE_MAPPING_REVIEW,
  catalog: META_OBJECTIVE_MAPPING_CATALOG,
});
const CANONICAL_OBJECTIVES = new Set<CanonicalMetaObjective>([
  ...Object.values(META_OBJECTIVE_MAPPING_CATALOG.current),
  ...Object.values(META_OBJECTIVE_MAPPING_CATALOG.legacy),
]);
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}
function exact(value: unknown, keys: readonly string[], code: TrustedPolicyCompositionError["code"]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
}
function reference(value: unknown, code: TrustedPolicyCompositionError["code"]): string {
  if (typeof value !== "string" || !REF.test(value)) fail(code);
  return value;
}
function hash(value: unknown, code: TrustedPolicyCompositionError["code"]): string {
  if (typeof value !== "string" || !HASH.test(value)) fail(code);
  return value;
}
function version(value: unknown, code: TrustedPolicyCompositionError["code"]): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) fail(code);
  return value as number;
}
function instant(value: unknown, code: TrustedPolicyCompositionError["code"]): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code);
  return value;
}
function refs(value: unknown, code: TrustedPolicyCompositionError["code"]): readonly string[] {
  if (!Array.isArray(value) || value.length > 100) fail(code);
  const normalized = value.map((entry) => reference(entry, code)).sort(compareText);
  if (new Set(normalized).size !== normalized.length) fail(code);
  return Object.freeze(normalized);
}

function registryHash(current: readonly InstructionPolicyPublicRevision[]): string {
  return digest(current.map((entry) => ({ policyRef: entry.policy.policyRef,
    policyVersion: entry.policy.policyVersion, canonicalHash: entry.policy.canonicalHash, status: entry.policy.status })));
}

function revisionIdentity(revision: InstructionPolicyPublicRevision): string {
  return digest(revision);
}

function assertLifecycle(state: InstructionPolicyLifecycleState, workspaceRef: string): readonly InstructionPolicyPublicRevision[] {
  const code = "inauthentic_lifecycle" as const;
  exact(state, ["registryHash", "current", "history", "diffs"], code);
  hash(state.registryHash, code);
  if (!Array.isArray(state.current) || !Array.isArray(state.history) || !Array.isArray(state.diffs)
    || state.current.length > 20_000 || state.history.length > 20_000) fail(code);
  const history = state.history.map((revision) => {
    exact(revision, ["policy", "rawProvenance", "recordedAt"], code);
    const policy = (() => { try { return assertStrictInstructionPolicyArtifact(revision.policy); } catch { return fail(code); } })();
    exact(revision.rawProvenance, ["provenanceRef", "rawText", "rawTextHash", "capturedByActorRef", "capturedAt"], code);
    const rawText = revision.rawProvenance.rawText;
    if (policy.workspaceRef !== workspaceRef || typeof rawText !== "string" || rawText.length < 1 || rawText.length > 16_000
      || !rawText.trim() || rawText.includes("\u0000") || reference(revision.rawProvenance.provenanceRef, code) !== policy.source.rawProvenanceRef
      || hash(revision.rawProvenance.rawTextHash, code) !== policy.source.rawTextHash
      || digestRawText(rawText) !== policy.source.rawTextHash) fail(code);
    const rawProvenance = freeze({ provenanceRef: policy.source.rawProvenanceRef, rawText,
      rawTextHash: policy.source.rawTextHash,
      capturedByActorRef: reference(revision.rawProvenance.capturedByActorRef, code),
      capturedAt: instant(revision.rawProvenance.capturedAt, code) });
    return freeze({ policy, rawProvenance, recordedAt: instant(revision.recordedAt, code) });
  });
  const ordered = [...history].sort((left, right) => compareText(left.policy.policyRef, right.policy.policyRef)
    || left.policy.policyVersion - right.policy.policyVersion);
  if (ordered.some((entry, index) => revisionIdentity(entry) !== revisionIdentity(history[index]!))) fail(code);
  const latest = new Map<string, InstructionPolicyPublicRevision>();
  for (const revision of history) {
    const previous = latest.get(revision.policy.policyRef);
    if (previous === undefined ? revision.policy.policyVersion !== 1 || revision.policy.previousVersionHash !== null
      : revision.policy.policyVersion !== previous.policy.policyVersion + 1
        || revision.policy.previousVersionHash !== previous.policy.canonicalHash
        || Date.parse(revision.recordedAt) < Date.parse(previous.recordedAt)) fail(code);
    latest.set(revision.policy.policyRef, revision);
  }
  if (state.current.length !== latest.size) fail(code);
  const current = state.current.map((revision) => {
    const expected = latest.get(revision.policy.policyRef);
    if (!expected || revisionIdentity(revision) !== revisionIdentity(expected)) fail(code);
    return expected;
  }).sort((left, right) => compareText(left.policy.policyRef, right.policy.policyRef));
  if (registryHash(current) !== state.registryHash) fail(code);
  const diffPairs = new Set<string>();
  for (const diff of state.diffs) {
    exact(diff, ["policyRef", "fromVersion", "toVersion", "changedPaths"], code);
    const policyRef = reference(diff.policyRef, code); const from = version(diff.fromVersion, code); const to = version(diff.toVersion, code);
    if (to !== from + 1 || !Array.isArray(diff.changedPaths) || diff.changedPaths.length > 256
      || diff.changedPaths.some((path) => typeof path !== "string" || !path || path.length > 256)
      || !history.some((entry) => entry.policy.policyRef === policyRef && entry.policy.policyVersion === from)
      || !history.some((entry) => entry.policy.policyRef === policyRef && entry.policy.policyVersion === to)
      || diffPairs.has(`${policyRef}:${from}:${to}`)) fail(code);
    diffPairs.add(`${policyRef}:${from}:${to}`);
  }
  for (let index = 1; index < history.length; index += 1) {
    const before = history[index - 1]!; const after = history[index]!;
    if (before.policy.policyRef === after.policy.policyRef
      && !diffPairs.has(`${after.policy.policyRef}:${before.policy.policyVersion}:${after.policy.policyVersion}`)) fail(code);
  }
  return freeze(current);
}

function digestRawText(value: string): string { return createHash("sha256").update(value).digest("hex"); }

/**
 * Builds a self-hash validated composition contract. The historical `Trusted` name
 * identifies the expected caller boundary; this factory does not establish production
 * provenance for authority tiers or decisions. A tenant-bound loader remains required.
 */
export function createTrustedPolicyCatalog(input: Readonly<Omit<TrustedPolicyCatalog,
  "schemaVersion" | "authority" | "catalogHash">>): TrustedPolicyCatalog {
  exact(input, ["workspaceRef", "catalogRef", "catalogVersion", "instructionPolicyRegistryHash", "bindings"], "invalid_input");
  const core = normalizeCatalogCore(input, "invalid_input");
  return freeze({ ...core, catalogHash: digest(core) });
}

function normalizeCatalogCore(input: Readonly<Omit<TrustedPolicyCatalog, "catalogHash">> | Readonly<Omit<TrustedPolicyCatalog,
  "schemaVersion" | "authority" | "catalogHash">>, code: TrustedPolicyCompositionError["code"]): Omit<TrustedPolicyCatalog, "catalogHash"> {
  const workspaceRef = reference(input.workspaceRef, code); const catalogRef = reference(input.catalogRef, code);
  const catalogVersion = version(input.catalogVersion, code); const instructionPolicyRegistryHash = hash(input.instructionPolicyRegistryHash, code);
  if (!Array.isArray(input.bindings) || input.bindings.length > 1_000) fail(code);
  const bindings = input.bindings.map((binding) => {
    exact(binding, ["policyRef", "policyVersion", "policyHash", "authorityTier", "decision", "categoryProfileRef",
      "categoryProfileVersion", "categoryProfileHash", "manualLockRef"], code);
    const authorityTier = binding.authorityTier as PolicyAuthorityTier;
    if (!(POLICY_AUTHORITY_ORDER as readonly unknown[]).includes(authorityTier)) fail(code);
    let decision: TrustedPolicyBinding["decision"] = null;
    if (binding.decision !== null) {
      exact(binding.decision, ["decisionKey", "positionKey"], code);
      if (typeof binding.decision.decisionKey !== "string" || !SEMANTIC_KEY.test(binding.decision.decisionKey)
        || typeof binding.decision.positionKey !== "string" || !SEMANTIC_KEY.test(binding.decision.positionKey)) fail(code);
      decision = freeze({ decisionKey: binding.decision.decisionKey, positionKey: binding.decision.positionKey });
    }
    const categoryProfileRef = binding.categoryProfileRef === null ? null : reference(binding.categoryProfileRef, code);
    const categoryProfileVersion = binding.categoryProfileVersion === null ? null : version(binding.categoryProfileVersion, code);
    const categoryProfileHash = binding.categoryProfileHash === null ? null : hash(binding.categoryProfileHash, code);
    const manualLockRef = binding.manualLockRef === null ? null : reference(binding.manualLockRef, code);
    const hasCompleteCategoryProfile = categoryProfileRef !== null && categoryProfileVersion !== null && categoryProfileHash !== null;
    const hasAnyCategoryProfile = categoryProfileRef !== null || categoryProfileVersion !== null || categoryProfileHash !== null;
    if (authorityTier === "internal_category_playbook" ? !hasCompleteCategoryProfile : hasAnyCategoryProfile) fail(code);
    if (authorityTier === "user_locked_instruction" ? manualLockRef === null : manualLockRef !== null) fail(code);
    return freeze({ policyRef: reference(binding.policyRef, code), policyVersion: version(binding.policyVersion, code),
      policyHash: hash(binding.policyHash, code), authorityTier, decision, categoryProfileRef,
      categoryProfileVersion, categoryProfileHash, manualLockRef });
  }).sort((left, right) => compareText(left.policyRef, right.policyRef));
  if (new Set(bindings.map((binding) => binding.policyRef)).size !== bindings.length) fail("ambiguous_binding");
  return freeze({ schemaVersion: TRUSTED_POLICY_CATALOG_VERSION, workspaceRef, catalogRef, catalogVersion,
    instructionPolicyRegistryHash, bindings: freeze(bindings), authority: AUTHORITY });
}

function assertCatalog(catalog: TrustedPolicyCatalog): TrustedPolicyCatalog {
  const code = "inauthentic_catalog" as const;
  exact(catalog, ["schemaVersion", "workspaceRef", "catalogRef", "catalogVersion", "instructionPolicyRegistryHash",
    "bindings", "authority", "catalogHash"], code);
  if (catalog.schemaVersion !== TRUSTED_POLICY_CATALOG_VERSION) fail(code);
  exact(catalog.authority, Object.keys(AUTHORITY), code);
  if (Object.entries(AUTHORITY).some(([key, value]) => catalog.authority[key as keyof typeof AUTHORITY] !== value)) fail(code);
  const core = normalizeCatalogCore(catalog, code);
  if (hash(catalog.catalogHash, code) !== digest(core)) fail(code);
  return freeze({ ...core, catalogHash: catalog.catalogHash });
}

export function createPolicyScopeSnapshot(input: Readonly<Omit<PolicyScopeSnapshot,
  "schemaVersion" | "scopeHash" | "objectiveEvidence"> & { canonicalObjective: CanonicalMetaObjective | null }>): PolicyScopeSnapshot {
  exact(input, ["workspaceRef", "evaluatedAt", "accountGroupRefs", "objectiveRefs", "topicRefs", "canonicalObjective"], "invalid_input");
  const canonicalObjective = input.canonicalObjective;
  if (canonicalObjective !== null && !CANONICAL_OBJECTIVES.has(canonicalObjective)) fail("invalid_input");
  const core = scopeCore({ ...input, objectiveEvidence: { canonicalObjective,
    mappingVersion: META_OBJECTIVE_MAPPING_VERSION, mappingHash: VALIDATED_META_OBJECTIVE_MAPPING_HASH } }, "invalid_input");
  return freeze({ ...core, scopeHash: digest(core) });
}

function scopeCore(input: Omit<PolicyScopeSnapshot, "scopeHash"> | Omit<PolicyScopeSnapshot, "schemaVersion" | "scopeHash">,
  code: TrustedPolicyCompositionError["code"]): Omit<PolicyScopeSnapshot, "scopeHash"> {
  exact(input.objectiveEvidence, ["canonicalObjective", "mappingVersion", "mappingHash"], code);
  const canonicalObjective = input.objectiveEvidence.canonicalObjective;
  if (canonicalObjective !== null && !CANONICAL_OBJECTIVES.has(canonicalObjective)
    || input.objectiveEvidence.mappingVersion !== META_OBJECTIVE_MAPPING_VERSION
    || hash(input.objectiveEvidence.mappingHash, code) !== VALIDATED_META_OBJECTIVE_MAPPING_HASH) fail(code);
  return freeze({ schemaVersion: POLICY_SCOPE_SNAPSHOT_VERSION, workspaceRef: reference(input.workspaceRef, code),
    evaluatedAt: instant(input.evaluatedAt, code), accountGroupRefs: refs(input.accountGroupRefs, code),
    objectiveRefs: refs(input.objectiveRefs, code), topicRefs: refs(input.topicRefs, code),
    objectiveEvidence: freeze({ canonicalObjective, mappingVersion: META_OBJECTIVE_MAPPING_VERSION,
      mappingHash: VALIDATED_META_OBJECTIVE_MAPPING_HASH }) });
}

function assertScope(scope: PolicyScopeSnapshot): PolicyScopeSnapshot {
  const code = "inauthentic_scope" as const;
  exact(scope, ["schemaVersion", "workspaceRef", "evaluatedAt", "accountGroupRefs", "objectiveRefs", "topicRefs",
    "objectiveEvidence", "scopeHash"], code);
  if (scope.schemaVersion !== POLICY_SCOPE_SNAPSHOT_VERSION) fail(code);
  const core = scopeCore(scope, code);
  if (hash(scope.scopeHash, code) !== digest(core)) fail(code);
  return freeze({ ...core, scopeHash: scope.scopeHash });
}

export function createFrozenPolicyManualLock(input: Readonly<Omit<FrozenPolicyManualLock,
  "schemaVersion" | "state" | "lockHash">>): FrozenPolicyManualLock {
  exact(input, ["workspaceRef", "lockRef", "policyRef", "policyVersion", "policyHash", "evaluatedAt"], "invalid_input");
  const core = manualLockCore(input, "invalid_input");
  return freeze({ ...core, lockHash: digest(core) });
}

function manualLockCore(input: Omit<FrozenPolicyManualLock, "lockHash"> | Omit<FrozenPolicyManualLock,
  "schemaVersion" | "state" | "lockHash">, code: TrustedPolicyCompositionError["code"]): Omit<FrozenPolicyManualLock, "lockHash"> {
  return freeze({ schemaVersion: POLICY_MANUAL_LOCK_VERSION, workspaceRef: reference(input.workspaceRef, code),
    lockRef: reference(input.lockRef, code), policyRef: reference(input.policyRef, code),
    policyVersion: version(input.policyVersion, code), policyHash: hash(input.policyHash, code), state: "locked" as const,
    evaluatedAt: instant(input.evaluatedAt, code) });
}

function assertManualLock(lock: FrozenPolicyManualLock): FrozenPolicyManualLock {
  const code = "inauthentic_manual_lock" as const;
  exact(lock, ["schemaVersion", "workspaceRef", "lockRef", "policyRef", "policyVersion", "policyHash", "state", "evaluatedAt", "lockHash"], code);
  if (lock.schemaVersion !== POLICY_MANUAL_LOCK_VERSION || lock.state !== "locked") fail(code);
  const core = manualLockCore(lock, code);
  if (hash(lock.lockHash, code) !== digest(core)) fail(code);
  return freeze({ ...core, lockHash: lock.lockHash });
}

function categoryEvidence(categories: readonly FrozenCategoryContext[], context: EffectiveCampaignContextInput): Readonly<{
  refs: readonly string[]; profiles: ReadonlyMap<string, FrozenCategoryProfileBinding>; resolutionHashes: readonly string[] } > {
  const expectedPath = context.identity.hierarchyRefs.map((id, index) => ({
    level: (["campaign", "ad_set", "ad", "creative"] as const)[index]!, id,
  }));
  const categoryRefs: string[] = []; const profiles = new Map<string, FrozenCategoryProfileBinding>(); const resolutionHashes: string[] = [];
  for (const category of categories) {
    const { resolutionHash, ...categoryCore } = category;
    if (category.workspaceId !== context.workspaceId || digest(category.path) !== digest(expectedPath)) fail("scope_mismatch");
    if (hash(resolutionHash, "scope_mismatch") !== digest(categoryCore)) fail("scope_mismatch");
    resolutionHashes.push(resolutionHash);
    for (const definition of category.effectiveDefinitions) {
      categoryRefs.push(categoryDefinitionPublicRef(category.dimension.key, definition.key));
    }
    for (const binding of category.profileBindings ?? []) {
      if (profiles.has(binding.profileRef)) fail("ambiguous_binding");
      profiles.set(binding.profileRef, binding);
    }
  }
  const refsSorted = [...categoryRefs].sort(compareText); const hashesSorted = [...resolutionHashes].sort(compareText);
  if (new Set(refsSorted).size !== refsSorted.length || new Set(hashesSorted).size !== hashesSorted.length) fail("ambiguous_binding");
  return freeze({ refs: freeze(refsSorted), profiles, resolutionHashes: freeze(hashesSorted) });
}

function entityPath(context: EffectiveCampaignContextInput): readonly Readonly<{ level: PolicyEntityLevel; ref: string }>[] {
  return freeze(context.identity.hierarchyRefs.map((ref, index) => ({
    level: (["campaign", "adset", "ad", "creative"] as const)[index]!, ref,
  })));
}

/**
 * Validates and composes exact current-published lifecycle revisions. The catalog is
 * self-hash checked, but this pure contract does not prove that authority tiers or
 * decisions came from a tenant-bound production loader. Raw provenance is integrity-
 * checked but never inspected for meaning or copied to the frozen context.
 */
export function composeTrustedPolicyContext(input: Readonly<{
  baseContext: EffectiveCampaignContextInput;
  workspaceRef: string;
  lifecycle: InstructionPolicyLifecycleState;
  catalog: TrustedPolicyCatalog;
  scope: PolicyScopeSnapshot;
  manualLocks: readonly FrozenPolicyManualLock[];
}>): TrustedPolicyComposition {
  exact(input, ["baseContext", "workspaceRef", "lifecycle", "catalog", "scope", "manualLocks"], "invalid_input");
  const workspaceRef = reference(input.workspaceRef, "invalid_input");
  if (input.baseContext.policies.length !== 0 || input.baseContext.versions.instructionPolicyRegistry !== undefined
    || !Array.isArray(input.manualLocks) || input.manualLocks.length > 1_000) fail("invalid_input");
  const current = assertLifecycle(input.lifecycle, workspaceRef);
  const catalog = assertCatalog(input.catalog); const scope = assertScope(input.scope);
  if (catalog.workspaceRef !== workspaceRef || scope.workspaceRef !== workspaceRef
    || scope.evaluatedAt !== new Date(input.baseContext.capturedAt).toISOString()) fail("scope_mismatch");
  const baseObjective = input.baseContext.meta.objective;
  if (baseObjective.state === "known") {
    if (scope.objectiveEvidence.canonicalObjective !== baseObjective.value) fail("scope_mismatch");
  } else if (scope.objectiveEvidence.canonicalObjective !== null || scope.objectiveRefs.length > 0) {
    fail("scope_mismatch");
  }
  if (catalog.instructionPolicyRegistryHash !== input.lifecycle.registryHash) fail("stale_binding");
  const published = current.filter((revision) => revision.policy.status === "published");
  if (catalog.bindings.length !== published.length) fail("stale_binding");
  const bindingByPolicy = new Map(catalog.bindings.map((binding) => [binding.policyRef, binding] as const));
  const locks = input.manualLocks.map(assertManualLock);
  const lockByRef = new Map<string, FrozenPolicyManualLock>();
  for (const lock of locks) {
    if (lockByRef.has(lock.lockRef)) fail("ambiguous_binding");
    lockByRef.set(lock.lockRef, lock);
  }
  const categories = categoryEvidence(input.baseContext.categories, input.baseContext);
  const manualLockedPolicyRefs: string[] = [];
  const candidates = published.map((revision) => {
    const policy = revision.policy; const binding = bindingByPolicy.get(policy.policyRef);
    if (!binding || binding.policyVersion !== policy.policyVersion || binding.policyHash !== policy.canonicalHash) fail("stale_binding");
    if (binding.categoryProfileRef !== null) {
      const profile = categories.profiles.get(binding.categoryProfileRef);
      if (!profile || profile.profileVersion !== binding.categoryProfileVersion
        || profile.profileHash !== binding.categoryProfileHash) fail("stale_binding");
    }
    if (binding.manualLockRef !== null) {
      const lock = lockByRef.get(binding.manualLockRef);
      if (!lock || lock.workspaceRef !== workspaceRef || lock.evaluatedAt !== scope.evaluatedAt
        || lock.policyRef !== policy.policyRef || lock.policyVersion !== policy.policyVersion
        || lock.policyHash !== policy.canonicalHash) fail("missing_manual_lock");
      manualLockedPolicyRefs.push(policy.policyRef);
    }
    return freeze({ policy, authorityTier: binding.authorityTier, publishedAt: revision.recordedAt, decision: binding.decision });
  });
  if (locks.some((lock) => lock.workspaceRef !== workspaceRef || lock.evaluatedAt !== scope.evaluatedAt
    || !catalog.bindings.some((binding) => binding.manualLockRef === lock.lockRef))) fail("inauthentic_manual_lock");
  const resolution = resolvePolicyPrecedence({ context: { workspaceRef, evaluatedAt: scope.evaluatedAt,
    accountGroupRefs: scope.accountGroupRefs, accountRefs: [input.baseContext.identity.accountRef],
    objectiveRefs: scope.objectiveRefs, effectiveInternalCategoryRefs: categories.refs,
    entityPath: entityPath(input.baseContext), topicRefs: scope.topicRefs,
    manualLockedPolicyRefs: Object.freeze(manualLockedPolicyRefs.sort(compareText)) }, candidates });
  const trace = [...resolution.applied, ...resolution.suppressed, ...resolution.parked];
  const policies = trace.map((entry) => freeze({ policyRef: entry.policyRef,
    state: entry.outcome === "parked" ? "parked_conflict" as const : entry.outcome,
    reason: entry.reason }));
  const context = buildEffectiveCampaignContext({ ...input.baseContext, policies,
    versions: { ...input.baseContext.versions, instructionPolicyRegistry: input.lifecycle.registryHash } });
  return freeze({ schemaVersion: TRUSTED_POLICY_COMPOSITION_VERSION, context, resolution,
    evidence: freeze({ instructionPolicyRegistryHash: input.lifecycle.registryHash, validatedCatalogHash: catalog.catalogHash,
      scopeHash: scope.scopeHash, objectiveMappingVersion: scope.objectiveEvidence.mappingVersion,
      objectiveMappingHash: scope.objectiveEvidence.mappingHash,
      canonicalObjective: scope.objectiveEvidence.canonicalObjective,
      manualLockHashes: freeze(locks.map((lock) => lock.lockHash).sort(compareText)),
      categoryResolutionHashes: categories.resolutionHashes }),
    validationBoundary: freeze({ contractIntegrity: "self_hash_validated" as const,
      productionAuthoritySourceBound: false as const }), authority: AUTHORITY });
}
