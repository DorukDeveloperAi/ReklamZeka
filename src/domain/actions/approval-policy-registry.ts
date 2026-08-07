import { createHash } from "node:crypto";

import {
  ACTION_APPROVAL_POLICY_VERSION,
  type ActionActorRole,
  type ActionApprovalRole,
  type ActionRisk,
  type ApprovalPolicy,
  type ResolvedApprovalPolicy,
} from "@/domain/actions/approval-lifecycle";

export const APPROVAL_POLICY_DEFINITION_VERSION = "approval-policy-definition/1.0.0" as const;
export type ApprovalPolicyDefinitionState = "draft" | "published" | "disabled";
export type ApprovalPolicyAuthorRole = "owner" | "admin" | "analyst";
export type ApprovalPolicyPublisherRole = "owner" | "admin";

export type ApprovalPolicyDefinitionRevision = Readonly<{
  version: typeof APPROVAL_POLICY_DEFINITION_VERSION;
  workspaceRef: string;
  policyRef: string;
  revision: number;
  previousHash: string | null;
  applicability: Readonly<{ actionType: "existing_post_promotion"; risk: "K4" }>;
  policy: ApprovalPolicy;
  policyHash: string;
  state: ApprovalPolicyDefinitionState;
  effectiveFrom: string;
  expiresAt: string | null;
  provenance: Readonly<{
    normalizedByActorRef: string;
    normalizedByRole: ApprovalPolicyAuthorRole;
    publishedByActorRef: string | null;
    publishedByRole: ApprovalPolicyPublisherRole | null;
    publicationDecisionRef: string | null;
    publicationReasonRef: string | null;
    publishedAt: string | null;
    disabledByActorRef: string | null;
    disabledByRole: ApprovalPolicyPublisherRole | null;
    disableDecisionRef: string | null;
    disableReasonRef: string | null;
    disabledAt: string | null;
  }>;
  authority: Readonly<{
    canApprove: false;
    canGrant: false;
    canExecute: false;
    canWriteMeta: false;
    canPromoteGuidance: false;
  }>;
  canonicalHash: string;
}>;

export type ResolvedApprovalPolicyDefinition = Readonly<{
  policy: ApprovalPolicy;
  policyHash: string;
  source: Readonly<{
    workspaceRef: string;
    policyRef: string;
    revision: number;
    canonicalHash: string;
    applicability: Readonly<{ actionType: "existing_post_promotion"; risk: "K4" }>;
  }>;
}>;

export class ApprovalPolicyRegistryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "invalid_transition"
    | "publish_forbidden"
    | "workspace_scope_mismatch"
    | "not_found"
    | "ambiguous"
    | "corrupt_registry") {
    super("Onay politikası kaydı güvenli biçimde işlenemedi");
    this.name = "ApprovalPolicyRegistryError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const RISKS: readonly ActionRisk[] = ["K0", "K1", "K2", "K3", "K4"];
const ROLES: readonly ActionActorRole[] = ["owner", "admin", "operator", "analyst"];
const APPROVER_ROLES: readonly ActionApprovalRole[] = ["owner", "admin", "operator"];
const AUTHORITY = Object.freeze({
  canApprove: false as const,
  canGrant: false as const,
  canExecute: false as const,
  canWriteMeta: false as const,
  canPromoteGuidance: false as const,
});

function fail(code: ApprovalPolicyRegistryError["code"]): never { throw new ApprovalPolicyRegistryError(code); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || value.includes("*")
    || /(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text)/i.test(value)) fail("invalid_input");
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  const normalized = new Date(value).toISOString();
  if (normalized !== value) fail("invalid_input");
  return normalized;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
function roles<T extends ActionActorRole>(value: unknown, allowed: readonly ActionActorRole[]): readonly T[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length
    || value.some((role) => typeof role !== "string" || !allowed.includes(role as ActionActorRole))) fail("invalid_input");
  return Object.freeze([...(value as T[])].sort());
}

function normalizePolicy(value: unknown, policyRef: string, revision: number): ResolvedApprovalPolicy {
  const hasAutonomyMode = Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "autonomyMode"));
  exact(value, ["version", "policyRef", "revision", ...(hasAutonomyMode ? ["autonomyMode"] : []),
    "requesterRoles", "approverRoles", "grantConsumerRoles", "separationOfDutiesRisks", "maximumGrantLifetimeSeconds"]);
  if (value.version !== ACTION_APPROVAL_POLICY_VERSION || (value.autonomyMode ?? "approval_only") !== "approval_only"
    || value.policyRef !== policyRef || value.revision !== revision
    || !Number.isSafeInteger(value.maximumGrantLifetimeSeconds)
    || (value.maximumGrantLifetimeSeconds as number) < 1 || (value.maximumGrantLifetimeSeconds as number) > 86_400
    || !Array.isArray(value.approverRoles) || !Array.isArray(value.separationOfDutiesRisks)
    || new Set(value.separationOfDutiesRisks).size !== value.separationOfDutiesRisks.length
    || value.separationOfDutiesRisks.some((risk) => typeof risk !== "string" || !RISKS.includes(risk as ActionRisk))) fail("invalid_input");
  const seen = new Set<ActionRisk>();
  const approverRoles = value.approverRoles.map((raw) => {
    exact(raw, ["risk", "roles"]);
    const risk = raw.risk as ActionRisk;
    if (!RISKS.includes(risk) || seen.has(risk)) fail("invalid_input");
    seen.add(risk);
    return Object.freeze({ risk, roles: roles<ActionApprovalRole>(raw.roles, APPROVER_ROLES) });
  }).sort((left, right) => left.risk < right.risk ? -1 : left.risk > right.risk ? 1 : 0);
  const core = {
    version: ACTION_APPROVAL_POLICY_VERSION,
    policyRef: ref(policyRef),
    revision,
    autonomyMode: "approval_only" as const,
    requesterRoles: roles<ActionActorRole>(value.requesterRoles, ROLES),
    approverRoles: Object.freeze(approverRoles),
    grantConsumerRoles: roles<ActionApprovalRole>(value.grantConsumerRoles, APPROVER_ROLES),
    separationOfDutiesRisks: Object.freeze([...(value.separationOfDutiesRisks as ActionRisk[])].sort()),
    maximumGrantLifetimeSeconds: value.maximumGrantLifetimeSeconds as number,
  };
  return deepFreeze({ ...core, policyHash: digest(core) });
}

function artifact(core: Omit<ApprovalPolicyDefinitionRevision, "canonicalHash">): ApprovalPolicyDefinitionRevision {
  const frozen = deepFreeze({ ...core, authority: AUTHORITY });
  return deepFreeze({ ...frozen, canonicalHash: digest(frozen) });
}

function emptyLifecycleProvenance(input: Readonly<{
  actorRef: string;
  role: ApprovalPolicyAuthorRole;
}>): ApprovalPolicyDefinitionRevision["provenance"] {
  return Object.freeze({
    normalizedByActorRef: ref(input.actorRef), normalizedByRole: input.role,
    publishedByActorRef: null, publishedByRole: null, publicationDecisionRef: null,
    publicationReasonRef: null, publishedAt: null,
    disabledByActorRef: null, disabledByRole: null, disableDecisionRef: null,
    disableReasonRef: null, disabledAt: null,
  });
}

export function createApprovalPolicyDraft(input: Readonly<{
  workspaceRef: string;
  policy: ApprovalPolicy;
  effectiveFrom: string;
  expiresAt: string | null;
  normalizedBy: Readonly<{ actorRef: string; role: ApprovalPolicyAuthorRole }>;
}>): ApprovalPolicyDefinitionRevision {
  exact(input, ["workspaceRef", "policy", "effectiveFrom", "expiresAt", "normalizedBy"]);
  exact(input.normalizedBy, ["actorRef", "role"]);
  if (!(["owner", "admin", "analyst"] as const).includes(input.normalizedBy.role)) fail("invalid_input");
  const workspaceRef = ref(input.workspaceRef);
  if (!input.policy || input.policy.revision !== 1) fail("invalid_input");
  const policyRef = ref(input.policy.policyRef);
  const normalized = normalizePolicy(input.policy, policyRef, input.policy.revision);
  const effectiveFrom = instant(input.effectiveFrom);
  const expiresAt = input.expiresAt === null ? null : instant(input.expiresAt);
  if (expiresAt !== null && expiresAt <= effectiveFrom) fail("invalid_input");
  const { policyHash, ...policy } = normalized;
  return artifact({
    version: APPROVAL_POLICY_DEFINITION_VERSION, workspaceRef, policyRef, revision: policy.revision, previousHash: null,
    applicability: Object.freeze({ actionType: "existing_post_promotion", risk: "K4" }),
    policy: deepFreeze(policy), policyHash, state: "draft", effectiveFrom, expiresAt,
    provenance: emptyLifecycleProvenance(input.normalizedBy),
    authority: AUTHORITY,
  });
}

/** Starts an editable append-only revision without mutating or hiding the current evidence. */
export function reviseApprovalPolicyDraft(input: Readonly<{
  current: ApprovalPolicyDefinitionRevision;
  policy: ApprovalPolicy;
  effectiveFrom: string;
  expiresAt: string | null;
  normalizedBy: Readonly<{ actorRef: string; role: ApprovalPolicyAuthorRole }>;
}>): ApprovalPolicyDefinitionRevision {
  exact(input, ["current", "policy", "effectiveFrom", "expiresAt", "normalizedBy"]);
  exact(input.normalizedBy, ["actorRef", "role"]);
  if (!( ["owner", "admin", "analyst"] as const).includes(input.normalizedBy.role)) fail("invalid_input");
  const current = assertValidApprovalPolicyDefinition(input.current);
  if (current.state !== "published" && current.state !== "disabled") fail("invalid_transition");
  if (input.policy.policyRef !== current.policyRef || input.policy.revision !== current.revision + 1) fail("invalid_input");
  const normalized = normalizePolicy(input.policy, current.policyRef, current.revision + 1);
  const effectiveFrom = instant(input.effectiveFrom);
  const expiresAt = input.expiresAt === null ? null : instant(input.expiresAt);
  if (expiresAt !== null && expiresAt <= effectiveFrom) fail("invalid_input");
  const { policyHash, ...policy } = normalized;
  return artifact({
    version: APPROVAL_POLICY_DEFINITION_VERSION, workspaceRef: current.workspaceRef,
    policyRef: current.policyRef, revision: current.revision + 1, previousHash: current.canonicalHash,
    applicability: Object.freeze({ actionType: "existing_post_promotion", risk: "K4" }),
    policy: deepFreeze(policy), policyHash, state: "draft", effectiveFrom, expiresAt,
    provenance: emptyLifecycleProvenance(input.normalizedBy), authority: AUTHORITY,
  });
}

export function publishApprovalPolicy(input: Readonly<{
  draft: ApprovalPolicyDefinitionRevision;
  actor: Readonly<{ actorRef: string; role: ApprovalPolicyPublisherRole }>;
  decisionRef: string;
  reasonRef: string;
  publishedAt: string;
}>): ApprovalPolicyDefinitionRevision {
  exact(input, ["draft", "actor", "decisionRef", "reasonRef", "publishedAt"]);
  exact(input.actor, ["actorRef", "role"]);
  const draft = assertValidApprovalPolicyDefinition(input.draft);
  if (draft.state !== "draft") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("publish_forbidden");
  const nextRevision = draft.revision + 1;
  const normalized = normalizePolicy({ ...draft.policy, revision: nextRevision }, draft.policyRef, nextRevision);
  const { policyHash, ...policy } = normalized;
  const { canonicalHash: _hash, ...core } = draft;
  return artifact({
    ...core, revision: nextRevision, previousHash: draft.canonicalHash,
    policy: deepFreeze(policy), policyHash, state: "published",
    provenance: Object.freeze({
      ...draft.provenance, publishedByActorRef: ref(input.actor.actorRef), publishedByRole: input.actor.role,
      publicationDecisionRef: ref(input.decisionRef), publicationReasonRef: ref(input.reasonRef),
      publishedAt: instant(input.publishedAt),
    }), authority: AUTHORITY,
  });
}

export function disableApprovalPolicy(input: Readonly<{
  current: ApprovalPolicyDefinitionRevision;
  actor: Readonly<{ actorRef: string; role: ApprovalPolicyPublisherRole }>;
  decisionRef: string;
  reasonRef: string;
  disabledAt: string;
}>): ApprovalPolicyDefinitionRevision {
  exact(input, ["current", "actor", "decisionRef", "reasonRef", "disabledAt"]);
  exact(input.actor, ["actorRef", "role"]);
  const current = assertValidApprovalPolicyDefinition(input.current);
  if (current.state !== "published") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("publish_forbidden");
  const disabledAt = instant(input.disabledAt);
  if (current.provenance.publishedAt === null || disabledAt < current.provenance.publishedAt) fail("invalid_input");
  const nextRevision = current.revision + 1;
  const normalized = normalizePolicy({ ...current.policy, revision: nextRevision }, current.policyRef, nextRevision);
  const { policyHash, ...policy } = normalized;
  const { canonicalHash: _hash, ...core } = current;
  return artifact({
    ...core, revision: nextRevision, previousHash: current.canonicalHash,
    policy: deepFreeze(policy), policyHash, state: "disabled",
    provenance: Object.freeze({
      ...current.provenance, disabledByActorRef: ref(input.actor.actorRef), disabledByRole: input.actor.role,
      disableDecisionRef: ref(input.decisionRef), disableReasonRef: ref(input.reasonRef),
      disabledAt,
    }), authority: AUTHORITY,
  });
}

export function assertValidApprovalPolicyDefinition(value: unknown): ApprovalPolicyDefinitionRevision {
  exact(value, ["version", "workspaceRef", "policyRef", "revision", "previousHash", "applicability", "policy", "policyHash", "state",
    "effectiveFrom", "expiresAt", "provenance", "authority", "canonicalHash"]);
  const candidate = value as unknown as ApprovalPolicyDefinitionRevision;
  exact(candidate.applicability, ["actionType", "risk"]);
  exact(candidate.provenance, ["normalizedByActorRef", "normalizedByRole", "publishedByActorRef", "publishedByRole",
    "publicationDecisionRef", "publicationReasonRef", "publishedAt", "disabledByActorRef", "disabledByRole",
    "disableDecisionRef", "disableReasonRef", "disabledAt"]);
  exact(candidate.authority, ["canApprove", "canGrant", "canExecute", "canWriteMeta", "canPromoteGuidance"]);
  if (candidate.version !== APPROVAL_POLICY_DEFINITION_VERSION
    || candidate.applicability.actionType !== "existing_post_promotion" || candidate.applicability.risk !== "K4"
    || !["draft", "published", "disabled"].includes(candidate.state)
    || candidate.authority.canApprove !== false || candidate.authority.canGrant !== false
    || candidate.authority.canExecute !== false || candidate.authority.canWriteMeta !== false
    || candidate.authority.canPromoteGuidance !== false || !HASH.test(candidate.policyHash)
    || !HASH.test(candidate.canonicalHash) || !Number.isSafeInteger(candidate.revision) || candidate.revision < 1) fail("invalid_input");
  if (candidate.revision === 1 ? candidate.previousHash !== null
    : typeof candidate.previousHash !== "string" || !HASH.test(candidate.previousHash)) fail("invalid_input");
  const workspaceRef = ref(candidate.workspaceRef);
  const policyRef = ref(candidate.policyRef);
  const normalized = normalizePolicy(candidate.policy, policyRef, candidate.revision);
  if (normalized.policyHash !== candidate.policyHash) fail("corrupt_registry");
  const effectiveFrom = instant(candidate.effectiveFrom);
  const expiresAt = candidate.expiresAt === null ? null : instant(candidate.expiresAt);
  if (expiresAt !== null && expiresAt <= effectiveFrom) fail("invalid_input");
  if (!(["owner", "admin", "analyst"] as const).includes(candidate.provenance.normalizedByRole)) fail("invalid_input");
  ref(candidate.provenance.normalizedByActorRef);
  const publication = [candidate.provenance.publishedByActorRef, candidate.provenance.publishedByRole,
    candidate.provenance.publicationDecisionRef, candidate.provenance.publicationReasonRef, candidate.provenance.publishedAt];
  const disabling = [candidate.provenance.disabledByActorRef, candidate.provenance.disabledByRole,
    candidate.provenance.disableDecisionRef, candidate.provenance.disableReasonRef, candidate.provenance.disabledAt];
  if (candidate.state === "draft") {
    if (publication.some((item) => item !== null) || disabling.some((item) => item !== null)) fail("invalid_input");
  } else {
    if (candidate.provenance.publishedByActorRef === null || candidate.provenance.publishedByRole === null
      || candidate.provenance.publicationDecisionRef === null || candidate.provenance.publicationReasonRef === null
      || candidate.provenance.publishedAt === null
      || !(["owner", "admin"] as const).includes(candidate.provenance.publishedByRole)) fail("invalid_input");
    ref(candidate.provenance.publishedByActorRef); ref(candidate.provenance.publicationDecisionRef);
    ref(candidate.provenance.publicationReasonRef); instant(candidate.provenance.publishedAt);
    if (candidate.state === "published" && disabling.some((item) => item !== null)) fail("invalid_input");
    if (candidate.state === "disabled") {
      if (candidate.provenance.disabledByActorRef === null || candidate.provenance.disabledByRole === null
        || candidate.provenance.disableDecisionRef === null || candidate.provenance.disableReasonRef === null
        || candidate.provenance.disabledAt === null
        || !( ["owner", "admin"] as const).includes(candidate.provenance.disabledByRole)) fail("invalid_input");
      ref(candidate.provenance.disabledByActorRef); ref(candidate.provenance.disableDecisionRef);
      ref(candidate.provenance.disableReasonRef);
      if (instant(candidate.provenance.disabledAt) < instant(candidate.provenance.publishedAt)) fail("invalid_input");
    }
  }
  const { canonicalHash, ...core } = candidate;
  if (digest(core) !== canonicalHash) fail("corrupt_registry");
  const { policyHash, ...policy } = normalized;
  return artifact({ ...core, workspaceRef, policyRef, policy: deepFreeze(policy),
    policyHash, effectiveFrom, expiresAt, authority: AUTHORITY });
}

/** Exact-one, latest-lifecycle, published-and-active resolver for the only supported applicability. */
export function resolvePublishedExistingPostPolicy(input: Readonly<{
  workspaceRef: string;
  evaluatedAt: string;
  definitions: readonly ApprovalPolicyDefinitionRevision[];
}>): ResolvedApprovalPolicyDefinition {
  exact(input, ["workspaceRef", "evaluatedAt", "definitions"]);
  const workspaceRef = ref(input.workspaceRef);
  const evaluatedAt = instant(input.evaluatedAt);
  if (!Array.isArray(input.definitions) || input.definitions.length > 1_000) fail("invalid_input");
  const latest = new Map<string, ApprovalPolicyDefinitionRevision>();
  const chains = new Map<string, ApprovalPolicyDefinitionRevision[]>();
  const revisions = new Set<string>();
  for (const raw of input.definitions) {
    const definition = assertValidApprovalPolicyDefinition(raw);
    if (definition.workspaceRef !== workspaceRef) fail("workspace_scope_mismatch");
    const key = `${definition.policyRef}:${definition.revision}`;
    if (revisions.has(key)) fail("corrupt_registry");
    revisions.add(key);
    const chain = chains.get(definition.policyRef) ?? [];
    chain.push(definition);
    chains.set(definition.policyRef, chain);
    if (definition.state === "draft") continue;
    const previous = latest.get(definition.policyRef);
    if (!previous || definition.revision > previous.revision) latest.set(definition.policyRef, definition);
  }
  for (const chain of chains.values()) {
    chain.sort((left, right) => left.revision - right.revision);
    for (let index = 0; index < chain.length; index += 1) {
      const definition = chain[index]!;
      const previous = chain[index - 1] ?? null;
      if (definition.revision !== index + 1
        || definition.previousHash !== (previous?.canonicalHash ?? null)) fail("corrupt_registry");
      if (previous === null ? definition.state !== "draft"
        : previous.state === "draft" ? definition.state !== "published"
        : previous.state === "published" ? definition.state !== "draft" && definition.state !== "disabled"
        : definition.state !== "draft") fail("corrupt_registry");
    }
  }
  const applicable = [...latest.values()].filter((definition) => definition.state === "published"
    && definition.effectiveFrom <= evaluatedAt && (definition.expiresAt === null || definition.expiresAt > evaluatedAt));
  if (applicable.length === 0) fail("not_found");
  if (applicable.length !== 1) fail("ambiguous");
  const selected = applicable[0]!;
  const normalized = normalizePolicy(selected.policy, selected.policyRef, selected.revision);
  const { policyHash, ...policy } = normalized;
  return deepFreeze({
    policy,
    policyHash,
    source: {
      workspaceRef: selected.workspaceRef,
      policyRef: selected.policyRef,
      revision: selected.revision,
      canonicalHash: selected.canonicalHash,
      applicability: selected.applicability,
    },
  });
}
