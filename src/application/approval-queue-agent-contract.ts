import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { ApprovalQueueReadError, type ApprovalQueueReadService } from "@/application/approval-queue-read-service";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const APPROVAL_QUEUE_AGENT_CONTRACT_VERSION = "approval-queue-agent-tools/1.0.0" as const;
export type ApprovalQueueAgentCall =
  | Readonly<{ name: "approval_queue_list"; arguments: Readonly<{ limit?: number; cursor?: string | null }> }>
  | Readonly<{ name: "approval_queue_get"; arguments: Readonly<{ unitRef: string }> }>;

const AUTHORITY = Object.freeze({ readOnly: true as const, canApprove: false as const, canReject: false as const,
  canRequestChanges: false as const, canGrant: false as const, canExecute: false as const, canWriteMeta: false as const });

function exact(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new ApprovalQueueReadError("invalid_input");
}

export class ApprovalQueueAgentContract {
  constructor(private readonly service: ApprovalQueueReadService, private readonly memberships: readonly WorkspaceMembership[]) {}
  async execute(principal: TrustedDecisionRoomPrincipal, call: ApprovalQueueAgentCall) {
    exact(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]); exact(principal.actor, ["userId"]);
    authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    exact(call, ["name", "arguments"]);
    if (call.name !== "approval_queue_list" && call.name !== "approval_queue_get") throw new ApprovalQueueReadError("invalid_input");
    exact(call.arguments, call.name === "approval_queue_list" ? ["limit", "cursor"] : ["unitRef"]);
    const result = call.name === "approval_queue_list"
      ? await this.service.list({ workspaceId: principal.workspaceId, ...call.arguments })
      : await this.service.get({ workspaceId: principal.workspaceId, ...call.arguments });
    return Object.freeze({ contractVersion: APPROVAL_QUEUE_AGENT_CONTRACT_VERSION, result, authority: AUTHORITY });
  }
}

export const APPROVAL_QUEUE_AGENT_TOOLS = Object.freeze([
  Object.freeze({ name: "approval_queue_list", description: "List public-safe approval queue units for the server-bound workspace; no decision or execution authority.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze({ limit: Object.freeze({ type: "integer", minimum: 1, maximum: 100 }), cursor: Object.freeze({ type: ["string", "null"] }) }) }) }),
  Object.freeze({ name: "approval_queue_get", description: "Read one public-safe action unit detail; cannot approve, reject, grant, execute, or write Meta.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false, required: ["unitRef"], properties: Object.freeze({ unitRef: Object.freeze({ type: "string", pattern: "^action_unit_[a-f0-9]{20}$" }) }) }) }),
]);
