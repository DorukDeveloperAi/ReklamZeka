import { createHash } from "node:crypto";

import type {
  ActionType,
  AutonomyMode,
  AutonomyRule,
  AutonomyScope,
} from "@/domain/actions/autonomy-valve";

export const AUTONOMY_RULE_ARTIFACT_VERSION = "autonomy-rule-artifact/1.0.0" as const;

export type AutonomyRuleState = "draft" | "published" | "disabled";
export type AutonomyRuleAuthorRole = "owner" | "admin" | "analyst";
export type AutonomyRulePublisherRole = "owner" | "admin";

export type AutonomyRuleArtifact = Readonly<{
  version: typeof AUTONOMY_RULE_ARTIFACT_VERSION;
  ruleRef: string;
  revision: number;
  workspaceRef: string;
  scope: AutonomyScope;
  mode: AutonomyMode;
  state: AutonomyRuleState;
  effectiveFrom: string;
  expiresAt: string | null;
  killSwitch: boolean;
  maximumActionsPerRun: number | null;
  provenance: Readonly<{
    normalizedByActorRef: string;
    normalizedByRole: AutonomyRuleAuthorRole;
    sourceGuidanceRefs: readonly string[];
    publishedByActorRef: string | null;
    publishedByRole: AutonomyRulePublisherRole | null;
    publicationDecisionRef: string | null;
    publicationReasonRef: string | null;
    publishedAt: string | null;
  }>;
  authority: Readonly<{
    canExecute: false;
    canWriteMeta: false;
    canGrantApproval: false;
    canPromoteGuidance: false;
  }>;
  canonicalHash: string;
}>;

export type AutonomyRuleDraftInput = Readonly<{
  ruleRef: string;
  revision: number;
  workspaceRef: string;
  scope: AutonomyScope;
  mode: AutonomyMode;
  effectiveFrom: string;
  expiresAt: string | null;
  killSwitch: boolean;
  maximumActionsPerRun: number | null;
  normalizedBy: Readonly<{ actorRef: string; role: AutonomyRuleAuthorRole }>;
  sourceGuidanceRefs: readonly string[];
}>;

export class AutonomyRuleRegistryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "invalid_transition"
    | "publish_forbidden"
    | "corrupt_registry"
    | "workspace_scope_mismatch") {
    super("Otonomi kural kaydı güvenli biçimde işlenemedi");
    this.name = "AutonomyRuleRegistryError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const ACTION_TYPES = new Set<ActionType>([
  "no_change", "internal_annotation", "status_pause", "status_activate",
  "budget_decrease", "budget_increase", "existing_post_promotion",
]);
const MODES = new Set<AutonomyMode>(["denied", "approval_only", "policy_limited"]);
const AUTHORITY = Object.freeze({
  canExecute: false as const,
  canWriteMeta: false as const,
  canGrantApproval: false as const,
  canPromoteGuidance: false as const,
});

function fail(code: AutonomyRuleRegistryError["code"]): never {
  throw new AutonomyRuleRegistryError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}

function reference(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)
    || /(token|secret|prompt|raw[_-]?(payload|request|response|json))/i.test(value)) fail("invalid_input");
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("invalid_input");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail("invalid_input");
  return value;
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

function normalizeRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 100) fail("invalid_input");
  const refs = value.map(reference);
  if (new Set(refs).size !== refs.length) fail("invalid_input");
  return Object.freeze([...refs].sort());
}

function normalizeScope(value: unknown, workspaceRef: string): AutonomyScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_input");
  const scope = value as Record<string, unknown>;
  if (["workspace", "account_group", "account", "internal_category", "campaign"].includes(scope.level as string)) {
    exact(scope, ["level", "ref"]);
    const ref = reference(scope.ref);
    if (scope.level === "workspace" && ref !== workspaceRef) fail("workspace_scope_mismatch");
    return Object.freeze({ level: scope.level as "workspace" | "account_group" | "account" | "internal_category" | "campaign", ref });
  }
  if (scope.level === "entity") {
    exact(scope, ["level", "entityLevel", "ref"]);
    if (!["campaign", "adset", "ad"].includes(scope.entityLevel as string)) fail("invalid_input");
    return Object.freeze({ level: "entity", entityLevel: scope.entityLevel as "campaign" | "adset" | "ad", ref: reference(scope.ref) });
  }
  if (scope.level === "action_type") {
    exact(scope, ["level", "actionType"]);
    if (!ACTION_TYPES.has(scope.actionType as ActionType)) fail("invalid_input");
    return Object.freeze({ level: "action_type", actionType: scope.actionType as ActionType });
  }
  fail("invalid_input");
}

function base(input: AutonomyRuleDraftInput) {
  exact(input, ["ruleRef", "revision", "workspaceRef", "scope", "mode", "effectiveFrom", "expiresAt",
    "killSwitch", "maximumActionsPerRun", "normalizedBy", "sourceGuidanceRefs"]);
  exact(input.normalizedBy, ["actorRef", "role"]);
  const workspaceRef = reference(input.workspaceRef);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > 1_000_000
    || !MODES.has(input.mode) || !["owner", "admin", "analyst"].includes(input.normalizedBy.role)
    || typeof input.killSwitch !== "boolean" || input.killSwitch && input.mode !== "denied"
    || input.maximumActionsPerRun !== null && (!Number.isSafeInteger(input.maximumActionsPerRun)
      || input.maximumActionsPerRun < 1 || input.maximumActionsPerRun > 1_000_000)) fail("invalid_input");
  const effectiveFrom = instant(input.effectiveFrom);
  const expiresAt = input.expiresAt === null ? null : instant(input.expiresAt);
  if (expiresAt !== null && expiresAt <= effectiveFrom) fail("invalid_input");
  return Object.freeze({
    ruleRef: reference(input.ruleRef), revision: input.revision, workspaceRef,
    scope: normalizeScope(input.scope, workspaceRef), mode: input.mode,
    effectiveFrom, expiresAt, killSwitch: input.killSwitch,
    maximumActionsPerRun: input.maximumActionsPerRun,
    normalizedByActorRef: reference(input.normalizedBy.actorRef), normalizedByRole: input.normalizedBy.role,
    sourceGuidanceRefs: normalizeRefs(input.sourceGuidanceRefs),
  });
}

function freezeArtifact(core: Omit<AutonomyRuleArtifact, "canonicalHash">): AutonomyRuleArtifact {
  const artifact = {
    ...core,
    scope: Object.freeze({ ...core.scope }),
    provenance: Object.freeze({ ...core.provenance, sourceGuidanceRefs: Object.freeze([...core.provenance.sourceGuidanceRefs]) }),
    authority: AUTHORITY,
  };
  return Object.freeze({ ...artifact, canonicalHash: digest(artifact) });
}

export function createAutonomyRuleDraft(input: AutonomyRuleDraftInput): AutonomyRuleArtifact {
  const normalized = base(input);
  return freezeArtifact({
    version: AUTONOMY_RULE_ARTIFACT_VERSION,
    ruleRef: normalized.ruleRef,
    revision: normalized.revision,
    workspaceRef: normalized.workspaceRef,
    scope: normalized.scope,
    mode: normalized.mode,
    state: "draft",
    effectiveFrom: normalized.effectiveFrom,
    expiresAt: normalized.expiresAt,
    killSwitch: normalized.killSwitch,
    maximumActionsPerRun: normalized.maximumActionsPerRun,
    provenance: Object.freeze({
      normalizedByActorRef: normalized.normalizedByActorRef,
      normalizedByRole: normalized.normalizedByRole,
      sourceGuidanceRefs: normalized.sourceGuidanceRefs,
      publishedByActorRef: null,
      publishedByRole: null,
      publicationDecisionRef: null,
      publicationReasonRef: null,
      publishedAt: null,
    }),
    authority: AUTHORITY,
  });
}

export function publishAutonomyRule(input: Readonly<{
  draft: AutonomyRuleArtifact;
  actor: Readonly<{ actorRef: string; role: AutonomyRulePublisherRole }>;
  decisionRef: string;
  reasonRef: string;
  publishedAt: string;
}>): AutonomyRuleArtifact {
  exact(input, ["draft", "actor", "decisionRef", "reasonRef", "publishedAt"]);
  exact(input.actor, ["actorRef", "role"]);
  const draft = assertValidAutonomyRuleArtifact(input.draft);
  if (draft.state !== "draft") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("publish_forbidden");
  const { canonicalHash: _draftHash, ...draftCore } = draft;
  return freezeArtifact({
    ...draftCore,
    revision: draft.revision + 1,
    state: "published",
    provenance: Object.freeze({
      ...draft.provenance,
      publishedByActorRef: reference(input.actor.actorRef),
      publishedByRole: input.actor.role,
      publicationDecisionRef: reference(input.decisionRef),
      publicationReasonRef: reference(input.reasonRef),
      publishedAt: instant(input.publishedAt),
    }),
    authority: AUTHORITY,
  });
}

export function disableAutonomyRule(input: Readonly<{
  current: AutonomyRuleArtifact;
  actor: Readonly<{ actorRef: string; role: AutonomyRulePublisherRole }>;
  decisionRef: string;
  reasonRef: string;
  disabledAt: string;
}>): AutonomyRuleArtifact {
  exact(input, ["current", "actor", "decisionRef", "reasonRef", "disabledAt"]);
  exact(input.actor, ["actorRef", "role"]);
  const current = assertValidAutonomyRuleArtifact(input.current);
  if (current.state !== "published" && current.state !== "disabled") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("publish_forbidden");
  const { canonicalHash: _currentHash, ...currentCore } = current;
  return freezeArtifact({
    ...currentCore,
    revision: current.revision + 1,
    state: "disabled",
    provenance: Object.freeze({
      ...current.provenance,
      publishedByActorRef: reference(input.actor.actorRef),
      publishedByRole: input.actor.role,
      publicationDecisionRef: reference(input.decisionRef),
      publicationReasonRef: reference(input.reasonRef),
      publishedAt: instant(input.disabledAt),
    }),
    authority: AUTHORITY,
  });
}

export function assertValidAutonomyRuleArtifact(value: unknown): AutonomyRuleArtifact {
  exact(value, ["version", "ruleRef", "revision", "workspaceRef", "scope", "mode", "state", "effectiveFrom",
    "expiresAt", "killSwitch", "maximumActionsPerRun", "provenance", "authority", "canonicalHash"]);
  const candidate = value as unknown as AutonomyRuleArtifact;
  exact(candidate.provenance, ["normalizedByActorRef", "normalizedByRole", "sourceGuidanceRefs", "publishedByActorRef",
    "publishedByRole", "publicationDecisionRef", "publicationReasonRef", "publishedAt"]);
  exact(candidate.authority, ["canExecute", "canWriteMeta", "canGrantApproval", "canPromoteGuidance"]);
  const normalized = base({
    ruleRef: candidate.ruleRef, revision: candidate.revision, workspaceRef: candidate.workspaceRef,
    scope: candidate.scope, mode: candidate.mode, effectiveFrom: candidate.effectiveFrom,
    expiresAt: candidate.expiresAt, killSwitch: candidate.killSwitch,
    maximumActionsPerRun: candidate.maximumActionsPerRun,
    normalizedBy: { actorRef: candidate.provenance.normalizedByActorRef, role: candidate.provenance.normalizedByRole },
    sourceGuidanceRefs: candidate.provenance.sourceGuidanceRefs,
  });
  if (candidate.version !== AUTONOMY_RULE_ARTIFACT_VERSION
    || !["draft", "published", "disabled"].includes(candidate.state)
    || candidate.authority.canExecute !== false || candidate.authority.canWriteMeta !== false
    || candidate.authority.canGrantApproval !== false || candidate.authority.canPromoteGuidance !== false
    || !HASH.test(candidate.canonicalHash)) fail("invalid_input");
  const publicationValues = [candidate.provenance.publishedByActorRef, candidate.provenance.publishedByRole,
    candidate.provenance.publicationDecisionRef, candidate.provenance.publicationReasonRef, candidate.provenance.publishedAt];
  if (candidate.state === "draft") {
    if (publicationValues.some((item) => item !== null)) fail("invalid_input");
  } else {
    if (candidate.provenance.publishedByActorRef === null || candidate.provenance.publishedByRole === null
      || candidate.provenance.publicationDecisionRef === null || candidate.provenance.publicationReasonRef === null
      || candidate.provenance.publishedAt === null
      || !["owner", "admin"].includes(candidate.provenance.publishedByRole)) fail("invalid_input");
    reference(candidate.provenance.publishedByActorRef);
    reference(candidate.provenance.publicationDecisionRef);
    reference(candidate.provenance.publicationReasonRef);
    instant(candidate.provenance.publishedAt);
  }
  const { canonicalHash, ...core } = candidate;
  if (digest(core) !== canonicalHash) fail("corrupt_registry");
  return freezeArtifact({
    ...core,
    ruleRef: normalized.ruleRef,
    workspaceRef: normalized.workspaceRef,
    scope: normalized.scope,
    provenance: Object.freeze({ ...candidate.provenance, sourceGuidanceRefs: normalized.sourceGuidanceRefs }),
    authority: AUTHORITY,
  });
}

/** Latest published/disabled revision per ruleRef, stripped to the existing action-valve contract. */
export function resolveAutonomyRules(input: Readonly<{
  workspaceRef: string;
  artifacts: readonly AutonomyRuleArtifact[];
}>): readonly AutonomyRule[] {
  exact(input, ["workspaceRef", "artifacts"]);
  const workspaceRef = reference(input.workspaceRef);
  if (!Array.isArray(input.artifacts) || input.artifacts.length > 10_000) fail("invalid_input");
  const seen = new Set<string>();
  const latest = new Map<string, AutonomyRuleArtifact>();
  for (const raw of input.artifacts) {
    const artifact = assertValidAutonomyRuleArtifact(raw);
    if (artifact.workspaceRef !== workspaceRef) fail("workspace_scope_mismatch");
    const key = `${artifact.ruleRef}:${artifact.revision}`;
    if (seen.has(key)) fail("corrupt_registry");
    seen.add(key);
    if (artifact.state === "draft") continue;
    const previous = latest.get(artifact.ruleRef);
    if (!previous || artifact.revision > previous.revision) latest.set(artifact.ruleRef, artifact);
  }
  return Object.freeze([...latest.values()].sort((left, right) => left.ruleRef < right.ruleRef ? -1 : left.ruleRef > right.ruleRef ? 1 : 0).map((artifact) => Object.freeze({
    ruleRef: artifact.ruleRef,
    workspaceRef: artifact.workspaceRef,
    scope: Object.freeze({ ...artifact.scope }),
    mode: artifact.mode,
    state: artifact.state === "disabled" ? "disabled" as const : "published" as const,
    effectiveFrom: artifact.effectiveFrom,
    expiresAt: artifact.expiresAt,
    killSwitch: artifact.killSwitch,
    maximumActionsPerRun: artifact.maximumActionsPerRun,
  })));
}
