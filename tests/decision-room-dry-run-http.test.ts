import { describe, expect, it, vi } from "vitest";
import { createDecisionRoomDryRunHttpHandler, decisionRoomDryRunNotConfiguredResponse } from "@/server/decision-room-dry-run-http";

const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222",
  workspaceRef: "workspace_safe", readerRef: "reader_safe" };
const request = { requestRef: "request_safe", accountRef: "account_safe", campaignRef: "campaign_safe", timeframeRef: "timeframe_safe", templateRef: "template_safe" };

describe("Decision Room dry-run HTTP", () => {
  it("accepts only a bounded JSON command after trusted principal resolution", async () => {
    const execute = vi.fn(async () => ({ contractVersion: "decision-room-dry-run/1.0.0", execution: { actionAuthority: "none" },
      authority: { metaWrite: false, actionExecution: false, approval: false } }));
    const POST = createDecisionRoomDryRunHttpHandler({ service: { execute } as never, resolvePrincipal: async () => principal });
    const response = await POST(new Request("http://localhost/api/decision-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(execute).toHaveBeenCalledWith(principal, request);
  });

  it("rejects malformed payloads before principal resolution and remains fail-closed unconfigured", async () => {
    const resolve = vi.fn(async () => principal);
    const POST = createDecisionRoomDryRunHttpHandler({ service: { execute: vi.fn() } as never, resolvePrincipal: resolve });
    expect((await POST(new Request("http://localhost/api/decision-room", { method: "POST", body: "{}" }))).status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
    expect(decisionRoomDryRunNotConfiguredResponse().status).toBe(503);
  });
});
