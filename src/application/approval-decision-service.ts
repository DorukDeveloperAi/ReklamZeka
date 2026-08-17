import { randomBytes } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  ActionApprovalLifecycleError,
  assertValidApprovalLifecycle,
  type ActionActor,
  type ApprovalDecisionCommand,
  type ApprovalLifecycle,
  type HumanApprovalAuthorization,
  type UnitFreshness,
} from "@/domain/actions/approval-lifecycle";
import type { WorkspaceMembership } from "@/security/authorization";

export const APPROVAL_DECISION_SERVICE_VERSION = "approval-decision-service/1.0.0" as const;

export type ApprovalDecisionKind = "approve" | "reject" | "defer" | "request_changes";

export type ApprovalDecisionSnapshot = Readonly<{
  lifecycle: ApprovalLifecycle;
  freshness: readonly UnitFreshness[];
}>;

export type ApprovalDecisionRepository = Readonly<{
  loadForDecision(input: Readonly<{ workspaceId: string; unitRef: string }>): Promise<ApprovalDecisionSnapshot | null>;
  decideAtomically(input: Readonly<{
    workspaceId: string;
    unitRef: string;
    expectedTraceHash: string;
    buildCommand(snapshot: ApprovalDecisionSnapshot): Promise<ApprovalDecisionCommand>;
  }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    lifecycle: ApprovalLifecycle;
    executionAuthority: "none";
    executionPerformed: false;
  }>>;
}>;

export type HumanPresenceEvidence = Readonly<{
  authorizationRef: string;
  issuedAt: string;
  expiresAt: string;
  humanPresence: true;
  canExecute: false;
}>;

export type HumanPresenceAuthorizationPort = Readonly<{
  consume(input: Readonly<{
    proof: string;
    workspaceId: string;
    actorRef: string;
    unitRef: string;
    action: ApprovalDecisionKind;
    now: string;
  }>): Promise<HumanPresenceEvidence>;
}>;

export type ApprovalDecisionResult = Readonly<{
  version: typeof APPROVAL_DECISION_SERVICE_VERSION;
  decision: Readonly<{
    unitRef: string;
    state: "approved" | "rejected" | "deferred" | "changes_requested";
    reasonCode: string;
    decidedAt: string;
  }>;
  authority: Readonly<{
    approvalRecorded: true;
    canGrant: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
}>;

export class ApprovalDecisionError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "forbidden"
    | "not_found"
    | "human_presence_rejected"
    | "stale"
    | "conflict"
    | "source_unavailable") {
    super("Onay kararı güvenli biçimde işlenemedi");
    this.name = "ApprovalDecisionError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIT_REF = /^action_unit_[a-f0-9]{20}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/;
const PROOF = /^presence_[A-Za-z0-9_-]{32,160}$/;

function fail(code: ApprovalDecisionError["code"]): never {
  throw new ApprovalDecisionError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}

function actorRole(role: WorkspaceMembership["role"]): ActionActor["role"] {
  if (role === "owner" || role === "admin") return role;
  fail("forbidden");
}

function publicResult(lifecycle: ApprovalLifecycle, unitRef: string): ApprovalDecisionResult {
  const unit = lifecycle.units.find((candidate) => candidate.unitRef === unitRef);
  if (!unit || !["approved", "rejected", "deferred", "changes_requested"].includes(unit.state)
    || unit.decidedAt === null || unit.reasonCode === null) fail("source_unavailable");
  return Object.freeze({
    version: APPROVAL_DECISION_SERVICE_VERSION,
    decision: Object.freeze({
      unitRef,
      state: unit.state as "approved" | "rejected" | "deferred" | "changes_requested",
      reasonCode: unit.reasonCode,
      decidedAt: unit.decidedAt,
    }),
    authority: Object.freeze({
      approvalRecorded: true as const,
      canGrant: false as const,
      canExecute: false as const,
      canWriteMeta: false as const,
    }),
  });
}

/**
 * Makes exactly one human decision against a concurrency-bound lifecycle.
 * Approval evidence is deliberately not an execution capability and is never
 * returned by this public application boundary.
 */
export class ApprovalDecisionService {
  constructor(
    private readonly repository: ApprovalDecisionRepository,
    private readonly humanPresence: HumanPresenceAuthorizationPort,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly createRef: (prefix: "decision" | "grant") => string = (prefix) => `${prefix}_${randomBytes(16).toString("hex")}`,
  ) {}

  async decide(input: Readonly<{
    principal: TrustedDecisionRoomPrincipal;
    membership: WorkspaceMembership;
    unitRef: string;
    kind: ApprovalDecisionKind;
    reasonCode: string;
    humanPresenceProof: string;
  }>): Promise<ApprovalDecisionResult> {
    exact(input, ["principal", "membership", "unitRef", "kind", "reasonCode", "humanPresenceProof"]);
    exact(input.principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]);
    exact(input.principal.actor, ["userId"]);
    exact(input.membership, ["userId", "workspaceId", "role"]);
    if (!UUID.test(input.principal.workspaceId) || !UUID.test(input.principal.actor.userId)
      || input.membership.workspaceId !== input.principal.workspaceId
      || input.membership.userId !== input.principal.actor.userId
      || !REF.test(input.principal.workspaceRef) || !REF.test(input.principal.readerRef)
      || !UNIT_REF.test(input.unitRef) || !["approve", "reject", "defer", "request_changes"].includes(input.kind)
      || !CODE.test(input.reasonCode) || !PROOF.test(input.humanPresenceProof)) fail("invalid_input");

    const actor: ActionActor = Object.freeze({ actorRef: input.principal.readerRef, role: actorRole(input.membership.role) });
    let snapshot: ApprovalDecisionSnapshot | null;
    try {
      snapshot = await this.repository.loadForDecision({ workspaceId: input.principal.workspaceId, unitRef: input.unitRef });
    } catch {
      fail("source_unavailable");
    }
    if (!snapshot) fail("not_found");
    try {
      assertValidApprovalLifecycle(snapshot.lifecycle);
    } catch {
      fail("source_unavailable");
    }
    const initialDefinition = snapshot.lifecycle.bundle.units.find((unit) => unit.unitRef === input.unitRef);
    if (!initialDefinition || initialDefinition.scope.workspaceRef !== input.principal.workspaceRef
      || snapshot.lifecycle.bundle.units.some((unit) => unit.scope.workspaceRef !== input.principal.workspaceRef)) fail("forbidden");

    let committed: Awaited<ReturnType<ApprovalDecisionRepository["decideAtomically"]>>;
    try {
      committed = await this.repository.decideAtomically({
        workspaceId: input.principal.workspaceId,
        unitRef: input.unitRef,
        expectedTraceHash: snapshot.lifecycle.traceHash,
        buildCommand: async (locked) => {
          try { assertValidApprovalLifecycle(locked.lifecycle); } catch { fail("source_unavailable"); }
          const definition = locked.lifecycle.bundle.units.find((unit) => unit.unitRef === input.unitRef);
          if (!definition || definition.scope.workspaceRef !== input.principal.workspaceRef
            || locked.lifecycle.bundle.units.some((unit) => unit.scope.workspaceRef !== input.principal.workspaceRef)) fail("forbidden");
          const decidedAt = instant(this.clock());
          let evidence: HumanPresenceEvidence;
          try {
            evidence = await this.humanPresence.consume({
              proof: input.humanPresenceProof, workspaceId: input.principal.workspaceId,
              actorRef: actor.actorRef, unitRef: input.unitRef, action: input.kind, now: decidedAt,
            });
          } catch { fail("human_presence_rejected"); }
          exact(evidence, ["authorizationRef", "issuedAt", "expiresAt", "humanPresence", "canExecute"]);
          if (!REF.test(evidence.authorizationRef) || evidence.humanPresence !== true || evidence.canExecute !== false
            || Date.parse(instant(evidence.issuedAt)) > Date.parse(decidedAt)
            || Date.parse(instant(evidence.expiresAt)) <= Date.parse(decidedAt)) fail("human_presence_rejected");
          const common = {
            kind: input.kind, commandRef: this.createRef("decision"), unitRef: input.unitRef, actor,
            decidedAt, reasonCode: input.reasonCode, freshness: locked.freshness,
          } as const;
          if (input.kind !== "approve") return Object.freeze({ ...common, kind: input.kind });
          const authorization: HumanApprovalAuthorization = Object.freeze({
            ...evidence, unitRef: definition.unitRef, unitHash: definition.unitHash,
            scopeHash: definition.scopeHash, actor,
          });
          return Object.freeze({ ...common, kind: "approve", authorization, grantRef: this.createRef("grant") });
        },
      });
      assertValidApprovalLifecycle(committed.lifecycle);
    } catch (reason) {
      if (reason instanceof ApprovalDecisionError) throw reason;
      if (reason instanceof ActionApprovalLifecycleError) {
        if (["stale_unit", "grant_expired", "dependency_failed"].includes(reason.code)) fail("stale");
        if (["policy_denied", "separation_of_duties"].includes(reason.code)) fail("forbidden");
        if (reason.code === "invalid_transition") fail("conflict");
        if (reason.code === "authorization_mismatch") fail("human_presence_rejected");
      }
      fail("conflict");
    }
    if (!["inserted", "unchanged"].includes(committed.outcome)
      || committed.executionAuthority !== "none" || committed.executionPerformed !== false) fail("conflict");
    return publicResult(committed.lifecycle, input.unitRef);
  }
}
