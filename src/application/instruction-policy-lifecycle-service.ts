import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  assertStrictInstructionPolicyArtifact,
  parseRawInstructionProvenance,
  parseStrictInstructionPolicy,
  type StrictInstructionPolicy,
} from "@/domain/policies/instruction-policy-dsl";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const INSTRUCTION_POLICY_LIFECYCLE_VERSION = "instruction-policy-lifecycle/1.0.0" as const;

export type InstructionPolicyPublicRevision = Readonly<{
  policy: StrictInstructionPolicy;
  rawProvenance: Readonly<{
    provenanceRef: string;
    rawText: string;
    rawTextHash: string;
    capturedByActorRef: string;
    capturedAt: string;
  }>;
  recordedAt: string;
}>;

export type InstructionPolicyPublicDiff = Readonly<{
  policyRef: string;
  fromVersion: number;
  toVersion: number;
  changedPaths: readonly string[];
}>;

export type InstructionPolicyLifecycleState = Readonly<{
  registryHash: string;
  current: readonly InstructionPolicyPublicRevision[];
  history: readonly InstructionPolicyPublicRevision[];
  diffs: readonly InstructionPolicyPublicDiff[];
}>;

export type InstructionPolicyLifecycleCommand =
  | Readonly<{ operation: "create_draft"; expectedRegistryHash: string; rawText: string; policy: unknown }>
  | Readonly<{ operation: "revise_draft"; expectedRegistryHash: string; expectedVersion: number;
      expectedPolicyHash: string; rawText: string; policy: unknown }>
  | Readonly<{ operation: "publish" | "pause" | "archive"; expectedRegistryHash: string;
      policyRef: string; expectedVersion: number; expectedPolicyHash: string; expectedImpactHash: string;
      reasonCode: string }>;

export type InstructionPolicyLifecycleRepository = Readonly<{
  inspect(workspaceId: string): Promise<InstructionPolicyLifecycleState>;
  mutate(input: Readonly<{
    workspaceId: string;
    workspaceRef: string;
    actorId: string;
    actorRef: string;
    role: "owner" | "admin" | "analyst";
    occurredAt: string;
    command: InstructionPolicyLifecycleCommand;
  }>): Promise<Readonly<{ state: InstructionPolicyLifecycleState; auditAppended: true;
    contextInvalidationAppended: boolean }>>;
}>;

export class InstructionPolicyLifecycleError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict" | "invalid_transition" | "forbidden" | "approval_required"
    | "dependency_blocked") {
    super(`Talimat politikası lifecycle işlemi reddedildi: ${code}`);
    this.name = "InstructionPolicyLifecycleError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const REASON = /^[a-z][a-z0-9_]{1,63}$/;

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new InstructionPolicyLifecycleError("invalid_input");
  return value;
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) {
    throw new InstructionPolicyLifecycleError("invalid_input");
  }
  return value as number;
}

function reference(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) throw new InstructionPolicyLifecycleError("invalid_input");
  return value;
}

function rawText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_000 || !value.trim() || value.includes("\u0000")) {
    throw new InstructionPolicyLifecycleError("invalid_input");
  }
  return value;
}

function draftPolicy(input: Readonly<{ principal: TrustedDecisionRoomPrincipal; role: "owner" | "admin" | "analyst";
  rawText: string; policy: unknown; occurredAt: string }>): StrictInstructionPolicy {
  let policy: StrictInstructionPolicy;
  try {
    try { policy = assertStrictInstructionPolicyArtifact(input.policy); }
    catch { policy = parseStrictInstructionPolicy(input.policy); }
    const provenance = parseRawInstructionProvenance({ version: "raw-instruction-provenance/1.0.0",
      workspaceRef: input.principal.workspaceRef, provenanceRef: policy.source.rawProvenanceRef,
      capturedAt: input.occurredAt, capturedByRef: input.principal.readerRef, rawText: input.rawText });
    if (policy.workspaceRef !== input.principal.workspaceRef || policy.status !== "draft"
      || policy.owner.actorRef !== input.principal.readerRef || policy.owner.role !== input.role
      || policy.source.rawTextHash !== provenance.rawTextHash) throw new Error("scope");
  } catch {
    throw new InstructionPolicyLifecycleError("invalid_input");
  }
  return policy;
}

function authority(role: WorkspaceMembership["role"]) {
  return Object.freeze({ canRead: true as const, canDraft: role !== "viewer",
    canPublish: role === "owner" || role === "admin", canPause: role === "owner" || role === "admin",
    canArchive: role === "owner" || role === "admin", canApprove: false as const, canExecute: false as const,
    canWriteMeta: false as const, canSchedule: false as const, canCallTool: false as const });
}

function normalize(principal: TrustedDecisionRoomPrincipal, role: "owner" | "admin" | "analyst",
  command: InstructionPolicyLifecycleCommand, occurredAt: string): InstructionPolicyLifecycleCommand {
  hash(command.expectedRegistryHash);
  if (command.operation === "create_draft" || command.operation === "revise_draft") {
    const text = rawText(command.rawText);
    const policy = draftPolicy({ principal, role, rawText: text, policy: command.policy, occurredAt });
    if (command.operation === "create_draft") {
      if (policy.policyVersion !== 1 || policy.previousVersionHash !== null) {
        throw new InstructionPolicyLifecycleError("invalid_input");
      }
      return Object.freeze({ ...command, rawText: text, policy });
    }
    const expectedVersion = positive(command.expectedVersion); const expectedPolicyHash = hash(command.expectedPolicyHash);
    if (policy.policyVersion !== expectedVersion + 1 || policy.previousVersionHash !== expectedPolicyHash) {
      throw new InstructionPolicyLifecycleError("invalid_input");
    }
    return Object.freeze({ ...command, expectedVersion, expectedPolicyHash, rawText: text, policy });
  }
  if (!REASON.test(command.reasonCode)) throw new InstructionPolicyLifecycleError("invalid_input");
  return Object.freeze({ ...command, policyRef: reference(command.policyRef), expectedVersion: positive(command.expectedVersion),
    expectedPolicyHash: hash(command.expectedPolicyHash), expectedImpactHash: hash(command.expectedImpactHash) });
}

export class InstructionPolicyLifecycleService {
  constructor(private readonly repository: InstructionPolicyLifecycleRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async inspect(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "instruction_policy:read", this.memberships);
    return Object.freeze({ contractVersion: INSTRUCTION_POLICY_LIFECYCLE_VERSION,
      ...await this.repository.inspect(principal.workspaceId), authority: authority(membership.role) });
  }

  async mutate(principal: TrustedDecisionRoomPrincipal, command: InstructionPolicyLifecycleCommand) {
    const draft = command.operation === "create_draft" || command.operation === "revise_draft";
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId,
      draft ? "instruction_policy:draft" : "instruction_policy:publish", this.memberships);
    if (membership.role === "viewer" || !draft && membership.role === "analyst") {
      throw new InstructionPolicyLifecycleError("invalid_input");
    }
    const role = membership.role as "owner" | "admin" | "analyst";
    const occurredAt = new Date().toISOString();
    const result = await this.repository.mutate({ workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef,
      actorId: principal.actor.userId, actorRef: principal.readerRef, role, occurredAt,
      command: normalize(principal, role, command, occurredAt) });
    return Object.freeze({ contractVersion: INSTRUCTION_POLICY_LIFECYCLE_VERSION, ...result,
      authority: authority(role), canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
  }
}

export function lifecycleStatus(operation: "publish" | "pause" | "archive"): "published" | "paused" | "archived" {
  return operation === "publish" ? "published" : operation === "pause" ? "paused" : "archived";
}

export function lifecycleInvalidationReason(operation: InstructionPolicyLifecycleCommand["operation"]):
  "source_changed" | "source_removed" | null {
  if (operation === "create_draft" || operation === "revise_draft") return null;
  return operation === "archive" ? "source_removed" : "source_changed";
}
