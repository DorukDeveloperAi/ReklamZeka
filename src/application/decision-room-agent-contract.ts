import {
  DecisionRoomReadError,
  type DecisionRoomReadResult,
  type DecisionRoomReadStateResult,
  type DecisionRoomReadService,
} from "@/application/decision-room-read-service";
import { authorizeWorkspace, type Actor, type WorkspaceMembership } from "@/security/authorization";

export const DECISION_ROOM_AGENT_CONTRACT_VERSION = "decision-room-agent-tools/1.0.0" as const;

export type TrustedDecisionRoomPrincipal = Readonly<{
  actor: Actor;
  workspaceId: string;
  workspaceRef: string;
  readerRef: string;
}>;

export type DecisionRoomAgentCall =
  | Readonly<{
    name: "decision_room_list";
    arguments: Readonly<{
      view: "schedules" | "runs" | "inbox";
      limit?: number;
      cursor?: string | null;
    }>;
  }>
  | Readonly<{
    name: "decision_room_mark_inbox_read";
    arguments: Readonly<{ notificationRef: string }>;
  }>;

export type DecisionRoomAgentResult = Readonly<{
  contractVersion: typeof DECISION_ROOM_AGENT_CONTRACT_VERSION;
  result: DecisionRoomReadResult | DecisionRoomReadStateResult;
  authority: Readonly<{
    source: "server_bound_workspace";
    metaWrite: false;
    budgetWrite: false;
    actionExecution: false;
  }>;
}>;

function exactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new DecisionRoomReadError("invalid_input");
  }
}

const AUTHORITY = Object.freeze({
  source: "server_bound_workspace" as const,
  metaWrite: false as const,
  budgetWrite: false as const,
  actionExecution: false as const,
});

/**
 * Shared local-agent/HTTP boundary. The caller may choose the model or CLI, but
 * it must obtain the principal from a trusted host session; tool arguments can
 * never select a workspace or reader identity.
 */
export class DecisionRoomAgentContract {
  constructor(
    private readonly service: DecisionRoomReadService,
    private readonly memberships: readonly WorkspaceMembership[],
  ) {}

  async execute(principal: TrustedDecisionRoomPrincipal, call: DecisionRoomAgentCall): Promise<DecisionRoomAgentResult> {
    exactKeys(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]);
    exactKeys(principal.actor, ["userId"]);
    authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    exactKeys(call, ["name", "arguments"]);
    if (call.name !== "decision_room_list" && call.name !== "decision_room_mark_inbox_read") {
      throw new DecisionRoomReadError("invalid_input");
    }
    exactKeys(call.arguments, call.name === "decision_room_list"
      ? ["view", "limit", "cursor"] : ["notificationRef"]);

    const result = call.name === "decision_room_list"
      ? await this.service.read({
        workspaceRef: principal.workspaceRef,
        readerRef: call.arguments.view === "inbox" ? principal.readerRef : undefined,
        view: call.arguments.view,
        limit: call.arguments.limit,
        cursor: call.arguments.cursor,
      })
      : await this.service.markInboxRead({
        workspaceRef: principal.workspaceRef,
        readerRef: principal.readerRef,
        notificationRef: call.arguments.notificationRef,
      });

    return Object.freeze({
      contractVersion: DECISION_ROOM_AGENT_CONTRACT_VERSION,
      result,
      authority: AUTHORITY,
    });
  }
}

export const DECISION_ROOM_AGENT_TOOLS = Object.freeze([
  Object.freeze({
    name: "decision_room_list",
    description: "List read-only Decision Room schedules, runs, or inbox items for the server-bound workspace.",
    inputSchema: Object.freeze({
      type: "object", additionalProperties: false, required: ["view"],
      properties: Object.freeze({
        view: Object.freeze({ type: "string", enum: ["schedules", "runs", "inbox"] }),
        limit: Object.freeze({ type: "integer", minimum: 1, maximum: 100 }),
        cursor: Object.freeze({ type: ["string", "null"] }),
      }),
    }),
  }),
  Object.freeze({
    name: "decision_room_mark_inbox_read",
    description: "Mark one Decision Room inbox item read using the host clock. This cannot approve or execute an action.",
    inputSchema: Object.freeze({
      type: "object", additionalProperties: false, required: ["notificationRef"],
      properties: Object.freeze({ notificationRef: Object.freeze({ type: "string" }) }),
    }),
  }),
]);
