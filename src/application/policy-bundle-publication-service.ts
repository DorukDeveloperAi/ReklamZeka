import { createHash } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { publishActionGuardrailPolicy, type ActionGuardrailPolicyRevision } from
  "@/domain/actions/action-guardrail-policy";
import { publishApprovalPolicy, type ApprovalPolicyDefinitionRevision } from
  "@/domain/actions/approval-policy-registry";
import type { HumanPresenceAction } from "@/security/human-presence-challenge";
import type { HumanPresenceEvidence } from "@/application/approval-decision-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const POLICY_BUNDLE_PUBLICATION_VERSION = "policy-bundle-publication/1.0.0" as const;
export type PolicyPublicationKind = "approval_policy" | "guardrail_policy";
export type PolicyPublicationRequest = Readonly<{
  kind: PolicyPublicationKind;
  policyRef: string;
  revision: number;
  reasonRef: string;
  humanPresenceProof: string;
}>;
export type PolicyPublicationPreparation = Readonly<{
  kind: PolicyPublicationKind;
  policyRef: string;
  revision: number;
  unitRef: string;
  action: Extract<HumanPresenceAction, "publish_approval_policy" | "publish_guardrail_policy">;
}>;

type AppendResult = Readonly<{ outcome: "inserted" | "unchanged"; canonicalHash: string }>;
type PolicyHumanPresencePort = Readonly<{ consume(input: Readonly<{ proof: string; workspaceId: string;
  actorRef: string; unitRef: string; action: HumanPresenceAction; now: string }>): Promise<HumanPresenceEvidence> }>;
type Registry<T> = Readonly<{
  latestArtifact(policyRef: string): Promise<T | null>;
  append(artifact: T): Promise<AppendResult>;
}>;

export class PolicyBundlePublicationError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "forbidden"
    | "not_found"
    | "stale"
    | "human_presence_rejected"
    | "store_rejected") {
    super("K4 policy yayını güvenli biçimde işlenemedi");
    this.name = "PolicyBundlePublicationError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const PROOF = /^presence_[A-Za-z0-9_-]{32,160}$/;
const HASH = /^[a-f0-9]{64}$/;
const AUTHORITY = Object.freeze({ canPublish: false as const, canDisable: false as const,
  canApproveAction: false as const, canGrant: false as const, canExecute: false as const,
  canWriteMeta: false as const });

function fail(code: PolicyBundlePublicationError["code"]): never { throw new PolicyBundlePublicationError(code); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || value.includes("*")
    || /(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text)/i.test(value)) fail("invalid_input");
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) fail("invalid_input");
  return value as number;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("store_rejected");
  return value;
}
function evidenceInstant(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString() === value ? value : null;
}
function unitRef(input: Readonly<{ workspaceId: string; kind: PolicyPublicationKind; policyRef: string;
  revision: number; canonicalHash: string }>): string {
  return `policy_unit_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 20)}`;
}
function action(kind: PolicyPublicationKind): PolicyPublicationPreparation["action"] {
  return kind === "approval_policy" ? "publish_approval_policy" : "publish_guardrail_policy";
}

export class PolicyBundlePublicationService {
  constructor(private readonly approvals: Registry<ApprovalPolicyDefinitionRevision>,
    private readonly guardrails: Registry<ActionGuardrailPolicyRevision>,
    private readonly humanPresence: PolicyHumanPresencePort,
    private readonly memberships: readonly WorkspaceMembership[],
    private readonly clock: () => string = () => new Date().toISOString()) {}

  private membership(principal: TrustedDecisionRoomPrincipal): WorkspaceMembership {
    let membership: WorkspaceMembership;
    try { membership = authorizeWorkspace(principal.actor, principal.workspaceId, "policy_bundle:publish", this.memberships); }
    catch { return fail("forbidden"); }
    if (membership.workspaceId !== principal.workspaceId || membership.userId !== principal.actor.userId
      || !["owner", "admin"].includes(membership.role)) fail("forbidden");
    return membership;
  }

  private async draft(principal: TrustedDecisionRoomPrincipal, kind: PolicyPublicationKind,
    policyRef: string, expectedRevision: number) {
    const found = kind === "approval_policy"
      ? await this.approvals.latestArtifact(policyRef)
      : await this.guardrails.latestArtifact(policyRef);
    if (!found) fail("not_found");
    if (found.workspaceRef !== principal.workspaceRef || found.policyRef !== policyRef) fail("store_rejected");
    if (found.state !== "draft" || found.revision !== expectedRevision) fail("stale");
    const now = instant(this.clock());
    if (found.expiresAt !== null && found.expiresAt <= now) fail("stale");
    return Object.freeze({ found, now, unitRef: unitRef({ workspaceId: principal.workspaceId, kind,
      policyRef, revision: expectedRevision, canonicalHash: found.canonicalHash }) });
  }

  async prepare(principal: TrustedDecisionRoomPrincipal, unsafe: unknown): Promise<PolicyPublicationPreparation> {
    this.membership(principal);
    exact(unsafe, ["kind", "policyRef", "revision"]);
    if (unsafe.kind !== "approval_policy" && unsafe.kind !== "guardrail_policy") fail("invalid_input");
    const kind = unsafe.kind; const policyRef = ref(unsafe.policyRef); const expectedRevision = revision(unsafe.revision);
    const prepared = await this.draft(principal, kind, policyRef, expectedRevision);
    return Object.freeze({ kind, policyRef, revision: expectedRevision, unitRef: prepared.unitRef, action: action(kind) });
  }

  async publish(principal: TrustedDecisionRoomPrincipal, unsafe: unknown) {
    const membership = this.membership(principal);
    exact(unsafe, ["kind", "policyRef", "revision", "reasonRef", "humanPresenceProof"]);
    if (unsafe.kind !== "approval_policy" && unsafe.kind !== "guardrail_policy") fail("invalid_input");
    const kind = unsafe.kind; const policyRef = ref(unsafe.policyRef); const expectedRevision = revision(unsafe.revision);
    const reasonRef = ref(unsafe.reasonRef);
    if (typeof unsafe.humanPresenceProof !== "string" || !PROOF.test(unsafe.humanPresenceProof)) fail("invalid_input");
    const prepared = await this.draft(principal, kind, policyRef, expectedRevision);
    let evidence: HumanPresenceEvidence;
    try {
      evidence = await this.humanPresence.consume({ proof: unsafe.humanPresenceProof,
        workspaceId: principal.workspaceId, actorRef: principal.readerRef, unitRef: prepared.unitRef,
        action: action(kind), now: prepared.now });
      exact(evidence, ["authorizationRef", "issuedAt", "expiresAt", "humanPresence", "canExecute"]);
      const issuedAt = evidenceInstant(evidence.issuedAt); const expiresAt = evidenceInstant(evidence.expiresAt);
      if (!REF.test(evidence.authorizationRef) || evidence.humanPresence !== true || evidence.canExecute !== false
        || issuedAt === null || expiresAt === null || issuedAt > prepared.now || expiresAt <= prepared.now) {
        throw new Error("rejected evidence");
      }
    } catch { return fail("human_presence_rejected"); }
    const actor = { actorRef: principal.readerRef, role: membership.role as "owner" | "admin" } as const;
    if (kind === "approval_policy") {
      const published = publishApprovalPolicy({ draft: prepared.found as ApprovalPolicyDefinitionRevision,
        actor, decisionRef: evidence.authorizationRef, reasonRef, publishedAt: prepared.now });
      const appended = await this.approvals.append(published);
      if (appended.outcome !== "inserted" || !HASH.test(appended.canonicalHash)
        || appended.canonicalHash !== published.canonicalHash) fail("store_rejected");
      return Object.freeze({ contractVersion: POLICY_BUNDLE_PUBLICATION_VERSION, item: Object.freeze({ kind,
        policyRef, draftRevision: expectedRevision, publishedRevision: published.revision,
        state: "published" as const, publishedAt: prepared.now }), authority: AUTHORITY });
    }
    const published = publishActionGuardrailPolicy({ draft: prepared.found as ActionGuardrailPolicyRevision,
      actor, decisionRef: evidence.authorizationRef, reasonRef, publishedAt: prepared.now });
    const appended = await this.guardrails.append(published);
    if (appended.outcome !== "inserted" || !HASH.test(appended.canonicalHash)
      || appended.canonicalHash !== published.canonicalHash) fail("store_rejected");
    return Object.freeze({ contractVersion: POLICY_BUNDLE_PUBLICATION_VERSION, item: Object.freeze({ kind,
      policyRef, draftRevision: expectedRevision, publishedRevision: published.revision,
      state: "published" as const, publishedAt: prepared.now }), authority: AUTHORITY });
  }
}
