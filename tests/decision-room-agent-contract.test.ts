import { describe, expect, it, vi } from "vitest";
import {
  DECISION_ROOM_AGENT_TOOLS,
  DecisionRoomAgentContract,
} from "@/application/decision-room-agent-contract";
import {
  DecisionRoomReadService,
  type DecisionRoomReadRepository,
} from "@/application/decision-room-read-service";
import { AuthorizationError } from "@/security/authorization";

const repository: DecisionRoomReadRepository = {
  listSchedules: vi.fn(async () => []),
  listRuns: vi.fn(async () => []),
  listInbox: vi.fn(async () => []),
  markInboxRead: vi.fn(async (input) => ({ ...input, changed: true })),
};

const principal = {
  actor: { userId: "user_owner" }, workspaceId: "database-workspace-id",
  workspaceRef: "workspace_safe", readerRef: "reader_owner",
} as const;

function contract() {
  return new DecisionRoomAgentContract(new DecisionRoomReadService(
    repository,
    () => new Date("2026-08-07T13:00:00.000Z"),
  ), [{ userId: "user_owner", workspaceId: "database-workspace-id", role: "owner" }]);
}

describe("Decision Room model-agnostic agent contract", () => {
  it("binds workspace and reader identity outside tool arguments", async () => {
    const result = await contract().execute(principal, {
      name: "decision_room_list", arguments: { view: "inbox", limit: 10 },
    });
    expect(repository.listInbox).toHaveBeenCalledWith({
      workspaceRef: "workspace_safe", readerRef: "reader_owner", after: null, limit: 11,
    });
    expect(result.authority).toEqual({
      source: "server_bound_workspace", metaWrite: false, budgetWrite: false, actionExecution: false,
    });
    expect(JSON.stringify(result)).not.toContain("database-workspace-id");
    const schemas = DECISION_ROOM_AGENT_TOOLS.map((tool) => tool.inputSchema);
    expect(JSON.stringify(schemas)).not.toMatch(/workspaceRef|readerRef|authority|execute/i);
  });

  it("uses the service server clock for read state and exposes no action authority", async () => {
    const result = await contract().execute(principal, {
      name: "decision_room_mark_inbox_read",
      arguments: { notificationRef: "inbox_aaaaaaaaaaaaaaaaaaaa" },
    });
    expect(repository.markInboxRead).toHaveBeenCalledWith(expect.objectContaining({
      readAt: "2026-08-07T13:00:00.000Z",
    }));
    expect(result.result).toMatchObject({
      readState: { status: "read", readAt: "2026-08-07T13:00:00.000Z" },
      capabilities: { canAuthorizeAction: false, canExecuteWrite: false },
    });
  });

  it("rejects an unbound principal and extra identity or authority arguments", async () => {
    await expect(contract().execute({ ...principal, actor: { userId: "user_other" } }, {
      name: "decision_room_list", arguments: { view: "runs" },
    })).rejects.toBeInstanceOf(AuthorizationError);

    await expect(contract().execute(principal, {
      name: "decision_room_list",
      arguments: { view: "runs", workspaceRef: "workspace_foreign" },
    } as never)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(contract().execute(principal, {
      name: "decision_room_mark_inbox_read",
      arguments: { notificationRef: "inbox_aaaaaaaaaaaaaaaaaaaa", actionAuthority: "execute" },
    } as never)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(contract().execute(principal, {
      name: "decision_room_execute", arguments: { notificationRef: "inbox_aaaaaaaaaaaaaaaaaaaa" },
    } as never)).rejects.toMatchObject({ code: "invalid_input" });
  });
});
