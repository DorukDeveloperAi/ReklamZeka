import { describe, expect, it, vi } from "vitest";
import { createInstructionPolicyImpactHttpHandler, instructionPolicyImpactSessionRequiredResponse } from
  "@/server/instruction-policy-impact-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "actor_viewer" } as const;
function request(extra = "", headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/instruction-policy-impact?view=dependency-impact&policyRef=policy_health&operation=publish${extra}`,
    { headers: { cookie: "session=opaque", "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": "instruction-policy-impact-preview", ...headers } });
}

describe("instruction policy impact HTTP", () => {
  it("accepts only cookie same-origin exact public refs and read intent", async () => {
    const service = { preview: vi.fn(async () => ({ contractVersion: "instruction-policy-impact/1.0.0",
      mutationAllowed: false })) };
    const handler = createInstructionPolicyImpactHttpHandler({ service: service as never,
      resolvePrincipal: async () => principal });
    expect((await handler(request())).status).toBe(200);
    expect(service.preview).toHaveBeenCalledWith(principal, "policy_health", "publish");
    expect((await handler(request("&workspaceId=forged"))).status).toBe(400);
    expect((await handler(request("", { authorization: "Bearer forged" }))).status).toBe(400);
    expect((await handler(request("", { "x-workspace-id": principal.workspaceId }))).status).toBe(400);
    expect((await handler(request("", { origin: "https://forged.invalid" }))).status).toBe(400);
  });

  it("is non-enumerating and fail-closed without a local session", async () => {
    const notFound = createInstructionPolicyImpactHttpHandler({ service: { preview: vi.fn(async () => null) } as never,
      resolvePrincipal: async () => principal });
    expect((await notFound(request())).status).toBe(404);
    const response = instructionPolicyImpactSessionRequiredResponse();
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ authority: {
      canPublish: false, canArchive: false, canExecute: false, canWriteMeta: false } });
  });
});
