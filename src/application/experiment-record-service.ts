import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { evaluateExperiment, type ExperimentPlan } from "@/domain/decisions/cadence";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const EXPERIMENT_RECORD_SERVICE_VERSION = "experiment-record-service/1.0.0" as const;
type ExperimentObservation = Omit<Parameters<typeof evaluateExperiment>[0], "plan">;
type AdvisoryCapabilities = Readonly<{ canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false }>;

export type ExperimentRecordCommand =
  | Readonly<{ operation: "plan"; accountRef: string; campaignRef: string; cadenceProfileRevisionId: string; plan: ExperimentPlan }>
  | Readonly<{ operation: "record_outcome"; experimentRef: string; expectedRecordHash: string; observation: ExperimentObservation }>;

export type ExperimentRecordWriter = Readonly<{
  plan(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string; role: "owner" | "admin" | "analyst";
    accountRef: string; campaignRef: string; cadenceProfileRevisionId: string; plan: ExperimentPlan; occurredAt: string;
  }>): Promise<Readonly<{ experimentRef: string; recordHash: string; outcome: "inserted" | "unchanged"; capabilities: AdvisoryCapabilities }>>;
  recordOutcome(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string; role: "owner" | "admin" | "analyst";
    experimentRef: string; expectedRecordHash: string; observation: ExperimentObservation; occurredAt: string;
  }>): Promise<Readonly<{ experimentRef: string; recordHash: string; outcome: ReturnType<typeof evaluateExperiment>; capabilities: AdvisoryCapabilities }>>;
}>;

export function experimentRecordAuthority(role: WorkspaceMembership["role"]) {
  return Object.freeze({ canRecordEvidence: role !== "viewer", canPublish: false as const, canApprove: false as const,
    canExecute: false as const, canWriteMeta: false as const, canGrantApproval: false as const });
}

/** Server-derived actor and timestamp wrapper for the append-only experiment evidence ledger. */
export class ExperimentRecordService {
  constructor(private readonly writer: ExperimentRecordWriter, private readonly memberships: readonly WorkspaceMembership[],
    private readonly now = () => new Date()) {}

  async mutate(principal: TrustedDecisionRoomPrincipal, command: ExperimentRecordCommand) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "experiment_record:mutate", this.memberships);
    const role = membership.role as "owner" | "admin" | "analyst";
    const actor = { workspaceId: principal.workspaceId, actorId: principal.actor.userId, actorRef: principal.readerRef, role,
      occurredAt: this.now().toISOString() };
    const result = command.operation === "plan"
      ? await this.writer.plan({ ...actor, accountRef: command.accountRef, campaignRef: command.campaignRef,
        cadenceProfileRevisionId: command.cadenceProfileRevisionId, plan: command.plan })
      : await this.writer.recordOutcome({ ...actor, experimentRef: command.experimentRef,
        expectedRecordHash: command.expectedRecordHash, observation: command.observation });
    return Object.freeze({ contractVersion: EXPERIMENT_RECORD_SERVICE_VERSION, ...result, authority: experimentRecordAuthority(role) });
  }
}
