import { describe, expect, it, vi } from "vitest";
import { createPracticeLabHttpHandlers } from "@/server/practice-lab-http";

const principal = { actor: { userId: "22222222-2222-4222-a222-222222222222" },
  workspaceId: "11111111-1111-4111-a111-111111111111", workspaceRef: "workspace_alpha", readerRef: "operator_owner" } as const;

function request(command: Record<string, unknown>, intent = "practice-lab-propose-standardization") {
  return new Request("http://localhost:3000/api/practice-lab", { method: "POST", headers: {
    Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin",
    Cookie: "__Host-rzka_local_session=opaque", "Content-Type": "application/json", "X-ReklamZeka-Intent": intent,
  }, body: JSON.stringify({ command }) });
}

function handlers() {
  const mutate = vi.fn(async () => ({ contractVersion: "advised-practice-lifecycle/1.0.0",
    practiceRef: "practice_safe", state: "standardization_candidate", authority: { canWriteMeta: false } }));
  return { mutate, handler: createPracticeLabHttpHandlers({ contract: {} as never, lifecycle: { mutate } as never,
    resolvePrincipal: async () => principal }) };
}

describe("Practice Lab lifecycle HTTP boundary", () => {
  it("accepts exact same-origin cookie proposal without actor/workspace fields", async () => {
    const { mutate, handler } = handlers();
    const response = await handler.POST(request({ operation: "propose_standardization", practiceRef: "practice_safe",
      expectedDefinitionVersion: 1, expectedRevisionRef: `practice_revision_${"a".repeat(64)}`,
      candidateNote: "İnsan teyidine hazır" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(mutate).toHaveBeenCalledWith(principal, expect.objectContaining({ operation: "propose_standardization" }));
  });

  it("unknown operation'ı standardize scope'una yönlendirmeden 400 reddeder", async () => {
    const { mutate, handler } = handlers();
    const response = await handler.POST(request({ operation: "auto_standardize", practiceRef: "practice_safe" },
      "practice-lab-standardize"));
    expect(response.status).toBe(400);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("body actor/workspace injection ve bearer credential'i fail-closed reddeder", async () => {
    const { mutate, handler } = handlers();
    const injected = await handler.POST(request({ operation: "propose_standardization", practiceRef: "practice_safe",
      expectedDefinitionVersion: 1, expectedRevisionRef: `practice_revision_${"a".repeat(64)}`,
      candidateNote: "x", actorRef: "operator_forged", workspaceRef: "workspace_foreign" }));
    expect(injected.status).toBe(400);
    const bearer = request({ operation: "propose_standardization", practiceRef: "practice_safe",
      expectedDefinitionVersion: 1, expectedRevisionRef: `practice_revision_${"a".repeat(64)}`, candidateNote: "x" });
    bearer.headers.set("authorization", "Bearer attacker");
    expect((await handler.POST(bearer)).status).toBe(400);
    expect(mutate).not.toHaveBeenCalled();
  });
});
