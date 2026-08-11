import { describe, expect, it } from "vitest";

import { createNormalizationWorkbenchHttpHandlers } from "@/server/normalization-workbench-http";

const principal = { actor: { userId: "00000000-0000-4000-8000-000000000001" }, workspaceId: "00000000-0000-4000-8000-000000000002",
  workspaceRef: "workspace_alpha", readerRef: "reader_alpha" };
const assessment = { contractVersion: "instruction-policy-normalization/1.0.0", status: "needs_input", answers: {}, questions: [
  { questionRef: "question_intent", prompt: "Bu talimat hangi bağlayıcı niyeti ifade ediyor?", field: "intent" },
], clauses: [], authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false,
  canSchedule: false, canCallTool: false, canAccessNetwork: false }, normalizationHash: "a".repeat(64) };

describe("normalization workbench HTTP", () => {
  it("accepts a same-origin read-only structured assessment and never calls draft creation", async () => {
    const calls: string[] = [];
    const handlers = createNormalizationWorkbenchHttpHandlers({ service: {
      inspect: async () => null, preview: async () => null,
      assess: async (_principal: unknown, answers: unknown) => { calls.push(JSON.stringify(answers)); return assessment; },
      create: async () => { throw new Error("must not create"); },
    } as never, resolvePrincipal: async (_request, operation) => { calls.push(operation); return principal as never; } });
    const response = await handlers.POST(new Request("https://local.test/api/normalization-workbench", { method: "POST", headers: {
      origin: "https://local.test", cookie: "rz=local", "content-type": "application/json", "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": "normalization-workbench-read",
    }, body: JSON.stringify({ command: { operation: "assess", answers: { intent: null, scope: null, scopeRef: null,
      operation: null, budgetPoolRef: null, preferenceSubjectRef: null, preferredRefs: [] } } }) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(assessment);
    expect(calls).toEqual(["read", JSON.stringify({ intent: null, scope: null, scopeRef: null, operation: null,
      budgetPoolRef: null, preferenceSubjectRef: null, preferredRefs: [] })]);
    expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
  });

  it("rejects a draft-intent header for a read-only assessment", async () => {
    const handlers = createNormalizationWorkbenchHttpHandlers({ service: {} as never, resolvePrincipal: async () => principal as never });
    const response = await handlers.POST(new Request("https://local.test/api/normalization-workbench", { method: "POST", headers: {
      origin: "https://local.test", cookie: "rz=local", "content-type": "application/json", "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": "normalization-workbench-draft",
    }, body: JSON.stringify({ command: { operation: "assess", answers: {} } }) }));
    expect(response.status).toBe(400); expect((await response.json()).error.code).toBe("invalid_input");
  });
});
