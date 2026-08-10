import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { DecisionCadenceProfile } from "@/domain/decisions/cadence";
import { AuthorizationError, authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const DECISION_CADENCE_PROFILE_SERVICE_VERSION = "decision-cadence-profile-service/1.0.0" as const;

export type DecisionCadenceProfileCommand = Readonly<{
  accountRef: string;
  campaignRef: string;
  profileRef: string;
  revision: number;
  expectedCurrentHash: "GENESIS" | string;
  profile: DecisionCadenceProfile;
}>;

export type DecisionCadenceProfilePublisher = Readonly<{
  publish(input: Readonly<{
    workspaceId: string; workspaceRef: string; actorId: string; actorRef: string; role: "owner" | "admin";
    accountRef: string; campaignRef: string; profileRef: string; revision: number;
    expectedCurrentHash: "GENESIS" | string; profile: DecisionCadenceProfile; occurredAt: string;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; profileHash: string; capabilities: Readonly<{
    canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false;
  }> }>>;
}>;

export function decisionCadenceProfileAuthority(role: WorkspaceMembership["role"]) {
  return Object.freeze({ canRead: true as const, canPublishProfile: (role === "owner" || role === "admin") as boolean,
    canApprove: false as const, canExecute: false as const, canWriteMeta: false as const, canGrantApproval: false as const });
}

/** Binds user-facing profile fields to server-derived actor, tenant and clock facts. */
export class DecisionCadenceProfileService {
  constructor(private readonly publisher: DecisionCadenceProfilePublisher,
    private readonly memberships: readonly WorkspaceMembership[], private readonly now = () => new Date()) {}

  async publish(principal: TrustedDecisionRoomPrincipal, command: DecisionCadenceProfileCommand) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "decision_cadence:publish", this.memberships);
    if (membership.role !== "owner" && membership.role !== "admin") throw new AuthorizationError();
    const result = await this.publisher.publish({ workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef,
      actorId: principal.actor.userId, actorRef: principal.readerRef, role: membership.role,
      ...command, occurredAt: this.now().toISOString() });
    return Object.freeze({ contractVersion: DECISION_CADENCE_PROFILE_SERVICE_VERSION, ...result,
      authority: decisionCadenceProfileAuthority(membership.role) });
  }
}
