import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  admitActionExecution,
  type ActionExecutionAdmission,
  type ExecutionHumanPresenceEvidence,
} from "@/domain/actions/action-execution-admission";
import { assertValidApprovalLifecycle, type ActionActor, type ApprovalLifecycle, type UnitFreshness } from "@/domain/actions/approval-lifecycle";
import type { ActionPlan } from "@/domain/actions/autonomy-valve";
import type { MetaWriteEligibilitySnapshot } from "@/domain/actions/meta-write-eligibility";
import type { WorkspaceMembership } from "@/security/authorization";

export const ACTION_EXECUTION_ADMISSION_SERVICE_VERSION = "action-execution-admission-service/1.0.0" as const;

type ExecutionPresencePort = Readonly<{
  consume(input: Readonly<{
    proof: string;
    workspaceId: string;
    actorRef: string;
    unitRef: string;
    action: "admit_execution";
    now: string;
  }>): Promise<Readonly<{
    authorizationRef: string;
    issuedAt: string;
    expiresAt: string;
    humanPresence: true;
    canExecute: false;
  }>>;
}>;

/** A server-owned loader: the browser never supplies a plan, freshness, or eligibility snapshot. */
export type ActionExecutionAdmissionSource = Readonly<{
  loadForAdmission(input: Readonly<{ workspaceId: string; unitRef: string }>): Promise<Readonly<{
    lifecycle: ApprovalLifecycle;
    freshness: readonly UnitFreshness[];
    actionPlan: ActionPlan;
    eligibilitySnapshot: MetaWriteEligibilitySnapshot;
  }> | null>;
}>;

export type ActionExecutionAdmissionSink = Readonly<{
  admit(input: Readonly<{ workspaceId: string; admission: ActionExecutionAdmission }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged" | "blocked";
    executionRef: string;
    admissionHash: string;
    capabilities: Readonly<{ canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
  }>>;
}>;

export class ActionExecutionAdmissionServiceError extends Error {
  constructor(readonly code: "invalid_input" | "forbidden" | "not_found" | "human_presence_rejected" | "source_unavailable" | "stale" | "conflict") {
    super(`Execution admission reddedildi: ${code}`);
    this.name = "ActionExecutionAdmissionServiceError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIT_REF = /^action_unit_[a-f0-9]{20}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const PROOF = /^presence_[A-Za-z0-9_-]{32,160}$/;

function fail(code: ActionExecutionAdmissionServiceError["code"]): never { throw new ActionExecutionAdmissionServiceError(code); }
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function actor(role: WorkspaceMembership["role"], actorRef: string): ActionActor {
  if (!REF.test(actorRef) || (role !== "owner" && role !== "admin")) fail("forbidden");
  return Object.freeze({ actorRef, role });
}

/**
 * The distinct execution ceremony creates only a disabled admission. It is
 * intentionally a server-private composition: no caller-supplied plan,
 * eligibility, or presence evidence can reach the persistence boundary.
 */
export class ActionExecutionAdmissionService {
  constructor(
    private readonly source: ActionExecutionAdmissionSource,
    private readonly presence: ExecutionPresencePort,
    private readonly sink: ActionExecutionAdmissionSink,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async admit(input: Readonly<{
    principal: TrustedDecisionRoomPrincipal;
    membership: WorkspaceMembership;
    unitRef: string;
    humanPresenceProof: string;
  }>): Promise<Readonly<{
    version: typeof ACTION_EXECUTION_ADMISSION_SERVICE_VERSION;
    executionRef: string;
    admissionHash: string;
    outcome: "inserted" | "unchanged";
    authority: Readonly<{ admissionRecorded: true; canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
  }>> {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 4
      || !input.principal || typeof input.principal !== "object" || !input.membership || typeof input.membership !== "object"
      || !UNIT_REF.test(input.unitRef) || !PROOF.test(input.humanPresenceProof)) fail("invalid_input");
    const principal = input.principal;
    const membership = input.membership;
    if (!UUID.test(principal.workspaceId) || !UUID.test(principal.actor.userId)
      || membership.workspaceId !== principal.workspaceId || membership.userId !== principal.actor.userId
      || !REF.test(principal.workspaceRef) || !REF.test(principal.readerRef)) fail("forbidden");
    const executionActor = actor(membership.role, principal.readerRef);
    let loaded: Awaited<ReturnType<ActionExecutionAdmissionSource["loadForAdmission"]>>;
    try { loaded = await this.source.loadForAdmission({ workspaceId: principal.workspaceId, unitRef: input.unitRef }); }
    catch { fail("source_unavailable"); }
    if (!loaded) fail("not_found");
    try { assertValidApprovalLifecycle(loaded.lifecycle); } catch { fail("source_unavailable"); }
    const unit = loaded.lifecycle.bundle.units.find((candidate) => candidate.unitRef === input.unitRef);
    const state = loaded.lifecycle.units.find((candidate) => candidate.unitRef === input.unitRef);
    if (!unit || !state || unit.scope.workspaceRef !== principal.workspaceRef || state.state !== "approved") fail("stale");
    const evaluatedAt = instant(this.clock());
    let proof;
    try {
      proof = await this.presence.consume({ proof: input.humanPresenceProof, workspaceId: principal.workspaceId,
        actorRef: executionActor.actorRef, unitRef: input.unitRef, action: "admit_execution", now: evaluatedAt });
    } catch { fail("human_presence_rejected"); }
    if (!proof || !REF.test(proof.authorizationRef) || proof.humanPresence !== true || proof.canExecute !== false
      || Date.parse(instant(proof.issuedAt)) > Date.parse(evaluatedAt) || Date.parse(instant(proof.expiresAt)) <= Date.parse(evaluatedAt)) {
      fail("human_presence_rejected");
    }
    const executionPresence: ExecutionHumanPresenceEvidence = Object.freeze({ authorizationRef: proof.authorizationRef,
      issuedAt: proof.issuedAt, expiresAt: proof.expiresAt, humanPresence: true as const, unitRef: unit.unitRef,
      unitHash: unit.unitHash, scopeHash: unit.scopeHash, actor: executionActor });
    let admission: ActionExecutionAdmission;
    try {
      admission = admitActionExecution({ lifecycle: loaded.lifecycle, unitRef: input.unitRef, actionPlan: loaded.actionPlan,
        eligibilitySnapshot: loaded.eligibilitySnapshot, currentFreshness: loaded.freshness, executionPresence, evaluatedAt });
    } catch { fail("stale"); }
    let persisted: Awaited<ReturnType<ActionExecutionAdmissionSink["admit"]>>;
    try { persisted = await this.sink.admit({ workspaceId: principal.workspaceId, admission }); }
    catch { fail("conflict"); }
    if (persisted?.outcome === "blocked") fail("stale");
    if (!persisted || !["inserted", "unchanged"].includes(persisted.outcome) || persisted.admissionHash !== admission.admissionHash
      || persisted.capabilities.canExecute !== false || persisted.capabilities.canWriteMeta !== false || persisted.capabilities.canDispatchNetwork !== false) fail("conflict");
    return Object.freeze({ version: ACTION_EXECUTION_ADMISSION_SERVICE_VERSION, executionRef: persisted.executionRef,
      admissionHash: persisted.admissionHash, outcome: persisted.outcome,
      authority: Object.freeze({ admissionRecorded: true as const, canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) });
  }
}
