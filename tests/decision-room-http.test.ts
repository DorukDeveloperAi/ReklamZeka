import { describe, expect, it, vi } from "vitest";
import { DecisionRoomAgentContract } from "@/application/decision-room-agent-contract";
import { DecisionRoomReadService, type DecisionRoomReadRepository } from "@/application/decision-room-read-service";
import { GET as disabledGet, PATCH as disabledPatch } from "@/app/api/decision-room/route";
import { createDecisionRoomHttpHandlers, type DecisionRoomPrincipalResolver } from "@/server/decision-room-http";

function handlers(resolver?: DecisionRoomPrincipalResolver) {
  const resolve: DecisionRoomPrincipalResolver = resolver ?? vi.fn(async () => ({
    actor: { userId: "user_owner" }, workspaceId: "database-workspace-id",
    workspaceRef: "workspace_safe", readerRef: "reader_owner",
  }));
  const repository: DecisionRoomReadRepository = {
    listSchedules: vi.fn(async () => []), listRuns: vi.fn(async () => []), listInbox: vi.fn(async () => []),
    markInboxRead: vi.fn(async (input) => ({ ...input, changed: true })),
  };
  const contract = new DecisionRoomAgentContract(
    new DecisionRoomReadService(repository, () => new Date("2026-08-07T13:00:00.000Z")),
    [{ userId: "user_owner", workspaceId: "database-workspace-id", role: "viewer" }],
  );
  return { repository, resolve, ...createDecisionRoomHttpHandlers({ contract, resolvePrincipal: resolve }) };
}

describe("Decision Room HTTP boundary", () => {
  it("lists a bounded view with private read-only headers", async () => {
    const api = handlers();
    const response = await api.GET(new Request("http://localhost/api/decision-room?view=runs&limit=25"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only");
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(await response.json()).toMatchObject({
      authority: { metaWrite: false, budgetWrite: false, actionExecution: false },
      result: { view: "runs", capabilities: { canAuthorizeAction: false, canExecuteWrite: false } },
    });
  });

  it("never accepts workspace or reader identity from query/body", async () => {
    const api = handlers();
    const queryResponse = await api.GET(new Request(
      "http://localhost/api/decision-room?view=inbox&workspaceRef=workspace_foreign",
    ));
    expect(queryResponse.status).toBe(400);
    expect(api.resolve).not.toHaveBeenCalled();

    const patchResponse = await api.PATCH(new Request("http://localhost/api/decision-room", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationRef: "inbox_aaaaaaaaaaaaaaaaaaaa", readerRef: "reader_other" }),
    }));
    expect(patchResponse.status).toBe(400);
  });

  it("rejects oversized or malformed PATCH bodies before principal resolution", async () => {
    const api = handlers();
    const oversized = await api.PATCH(new Request("http://localhost/api/decision-room", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: "x".repeat(1025),
    }));
    expect(oversized.status).toBe(400);
    expect(api.resolve).not.toHaveBeenCalled();

    const malformed = await api.PATCH(new Request("http://localhost/api/decision-room", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{",
    }));
    expect(malformed.status).toBe(400);
    expect(api.resolve).not.toHaveBeenCalled();
  });

  it("marks read with host identity and host time, not request time", async () => {
    const api = handlers();
    const response = await api.PATCH(new Request("http://localhost/api/decision-room", {
      method: "PATCH", headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ notificationRef: "inbox_aaaaaaaaaaaaaaaaaaaa" }),
    }));
    expect(response.status).toBe(200);
    expect(api.repository.markInboxRead).toHaveBeenCalledWith({
      workspaceRef: "workspace_safe", readerRef: "reader_owner",
      notificationRef: "inbox_aaaaaaaaaaaaaaaaaaaa", readAt: "2026-08-07T13:00:00.000Z",
    });
  });

  it("fails closed when authentication or runtime assembly is absent", async () => {
    const api = handlers(vi.fn(async () => null));
    expect((await api.GET(new Request("http://localhost/api/decision-room?view=runs"))).status).toBe(403);

    for (const response of [disabledGet(), disabledPatch()]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
      expect(await response.json()).toEqual({
        error: {
          code: "source_not_configured",
          message: "Decision Room çalışma alanı ve kimlik bağlama katmanı henüz etkin değil.",
        },
      });
    }
  });
});
