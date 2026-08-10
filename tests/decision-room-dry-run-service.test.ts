import { describe, expect, it, vi } from "vitest";
import { DecisionRoomDryRunError, DecisionRoomDryRunService } from "@/application/decision-room-dry-run-service";

const principal = {
  actor: { userId: "11111111-1111-4111-8111-111111111111" },
  workspaceId: "22222222-2222-4222-8222-222222222222",
  workspaceRef: "workspace_safe", readerRef: "reader_safe",
};
const input = { requestRef: "request_safe", accountRef: "account_safe", campaignRef: "campaign_safe",
  timeframeRef: "timeframe_safe", templateRef: "template_safe" };

function service(role: "owner" | "admin" | "analyst" | "viewer" = "analyst") {
  const execute = vi.fn(async () => ({ version: "decision-room-executor/1.0.0" as const, status: "completed" as const,
    runRef: "run_safe", idempotencyKey: `idempotency_${"a".repeat(32)}`, attempt: 1, retryable: false,
    actionAuthority: "none" as const, notificationChannel: "in_app_inbox" as const }));
  return { execute, service: new DecisionRoomDryRunService({ execute } as never, [{
    workspaceId: principal.workspaceId, userId: principal.actor.userId, role,
  }], () => new Date("2026-08-10T12:00:00.000Z")) };
}

describe("DecisionRoomDryRunService", () => {
  it("derives workspace, actor and clock from the trusted principal and keeps every authority closed", async () => {
    const harness = service();
    await expect(harness.service.execute(principal, input)).resolves.toMatchObject({
      contractVersion: "decision-room-dry-run/1.0.0", execution: { status: "completed", actionAuthority: "none" },
      authority: { metaWrite: false, actionExecution: false, approval: false },
    });
    expect(harness.execute).toHaveBeenCalledWith(expect.objectContaining({
      requestedAt: "2026-08-10T12:00:00.000Z", workspaceRef: "workspace_safe",
      trigger: { kind: "manual", requestRef: "request_safe", requestedByRef: "reader_safe" },
    }));
  });

  it("rejects viewer, forged authority material and executor failures", async () => {
    await expect(service("viewer").service.execute(principal, input)).resolves.toBeDefined();
    const forbidden = new DecisionRoomDryRunService({ execute: async () => { throw new Error("db"); } } as never, [], () => new Date());
    await expect(forbidden.execute(principal, input)).rejects.toEqual(expect.objectContaining<Partial<DecisionRoomDryRunError>>({ code: "forbidden" }));
    await expect(service().service.execute(principal, { ...input, authority: "forged" } as never))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomDryRunError>>({ code: "invalid_input" }));
  });
});
