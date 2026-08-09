import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  AdvisedPracticeRepositoryError,
  type AdvisedPracticeLifecycleMutationInput,
  type AdvisedPracticeLifecycleMutationResult,
} from "@/connectors/guidance/advised-practice-drizzle-repository";
import { replayAdvisedPractice } from "@/domain/guidance/advised-practice";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const ADVISED_PRACTICE_LIFECYCLE_VERSION = "advised-practice-lifecycle/1.0.0" as const;

export type AdvisedPracticeLifecycleCommand =
  | Readonly<{ operation: "propose_standardization"; practiceRef: string; expectedDefinitionVersion: number;
      expectedRevisionRef: string; candidateNote: string }>
  | Readonly<{ operation: "standardize"; practiceRef: string; expectedDefinitionVersion: number;
      expectedRevisionRef: string; decisionRef: string; confirmationNote: string; humanConfirmation: "explicit" }>;

export type AdvisedPracticeLifecycleRepository = Readonly<{
  mutateLifecycle(input: AdvisedPracticeLifecycleMutationInput): Promise<AdvisedPracticeLifecycleMutationResult>;
}>;

export class AdvisedPracticeLifecycleError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict" | "invalid_transition") {
    super(`Advised practice lifecycle işlemi reddedildi: ${code}`);
    this.name = "AdvisedPracticeLifecycleError";
  }
}

const PRACTICE_REF = /^practice_[a-z0-9][a-z0-9_-]{0,86}$/;
const REVISION_REF = /^practice_revision_[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) throw new AdvisedPracticeLifecycleError("invalid_input");
}

function boundedText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000 || value.includes("\u0000")) {
    throw new AdvisedPracticeLifecycleError("invalid_input");
  }
  return value.trim();
}

function normalize(command: AdvisedPracticeLifecycleCommand): AdvisedPracticeLifecycleCommand {
  if (!command || typeof command !== "object" || Array.isArray(command)
    || command.operation !== "propose_standardization" && command.operation !== "standardize") {
    throw new AdvisedPracticeLifecycleError("invalid_input");
  }
  const common = ["operation", "practiceRef", "expectedDefinitionVersion", "expectedRevisionRef"];
  exact(command, command.operation === "propose_standardization" ? [...common, "candidateNote"]
    : [...common, "decisionRef", "confirmationNote", "humanConfirmation"]);
  if (!PRACTICE_REF.test(command.practiceRef) || !Number.isSafeInteger(command.expectedDefinitionVersion)
    || command.expectedDefinitionVersion < 1 || !REVISION_REF.test(command.expectedRevisionRef)) {
    throw new AdvisedPracticeLifecycleError("invalid_input");
  }
  if (command.operation === "propose_standardization") return Object.freeze({ ...command,
    candidateNote: boundedText(command.candidateNote) });
  if (command.humanConfirmation !== "explicit" || !REF.test(command.decisionRef)) {
    throw new AdvisedPracticeLifecycleError("invalid_input");
  }
  return Object.freeze({ ...command, confirmationNote: boundedText(command.confirmationNote) });
}

function authority(role: WorkspaceMembership["role"]) {
  return Object.freeze({ canProposeStandardization: role !== "viewer",
    canStandardize: role === "owner" || role === "admin", humanConfirmationRequired: true as const,
    canPromotePolicy: false as const, canEnableAutomation: false as const, canAuthorizeAction: false as const,
    canWriteMeta: false as const, canExecute: false as const });
}

export class AdvisedPracticeLifecycleService {
  constructor(private readonly repository: AdvisedPracticeLifecycleRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async mutate(principal: TrustedDecisionRoomPrincipal, untrusted: AdvisedPracticeLifecycleCommand) {
    const command = normalize(untrusted);
    const action = command.operation === "propose_standardization" ? "practice_lab:draft" : "practice_lab:standardize";
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, action, this.memberships);
    if (membership.role === "viewer") throw new AdvisedPracticeLifecycleError("invalid_input");
    const role = membership.role as "owner" | "admin" | "analyst";
    let result: AdvisedPracticeLifecycleMutationResult;
    try {
      result = await this.repository.mutateLifecycle({ workspaceId: principal.workspaceId,
        actorId: principal.actor.userId, actorRef: principal.readerRef, role, practiceRef: command.practiceRef,
        expectedDefinitionVersion: command.expectedDefinitionVersion, expectedRevisionRef: command.expectedRevisionRef,
        occurredAt: new Date().toISOString(), command: command.operation === "propose_standardization"
          ? { operation: command.operation, candidateNote: command.candidateNote }
          : { operation: command.operation, decisionRef: command.decisionRef, confirmationNote: command.confirmationNote } });
    } catch (reason) {
      if (reason instanceof AdvisedPracticeRepositoryError) {
        if (reason.code === "definition_missing") throw new AdvisedPracticeLifecycleError("not_found");
        if (reason.code === "record_conflict" || reason.code === "chain_conflict") {
          throw new AdvisedPracticeLifecycleError("conflict");
        }
        if (reason.code === "forbidden") throw new AdvisedPracticeLifecycleError("invalid_input");
        if (reason.code === "invalid_revision") throw new AdvisedPracticeLifecycleError("invalid_input");
        if (reason.code === "invalid_transition") throw new AdvisedPracticeLifecycleError("invalid_transition");
        throw new AdvisedPracticeLifecycleError("invalid_transition");
      }
      throw reason;
    }
    const replay = replayAdvisedPractice(result.record.definition, result.record.history);
    return Object.freeze({ contractVersion: ADVISED_PRACTICE_LIFECYCLE_VERSION,
      practiceRef: result.record.definition.practiceRef, definitionVersion: result.record.definition.version,
      revisionRef: result.revisionRef, state: replay.state, outcomeStatus: replay.outcomeStatus,
      standardizationReviewStatus: replay.standardizationReviewStatus,
      standardizationStatus: replay.standardizationStatus, auditAppended: result.auditAppended,
      authority: authority(role) });
  }
}
