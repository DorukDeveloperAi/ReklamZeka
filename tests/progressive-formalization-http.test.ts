import { describe, expect, it, vi } from "vitest";

import { ProgressiveFormalizationStudioError } from "@/application/progressive-formalization-service";
import { createProgressiveFormalizationHttpHandlers } from "@/server/progressive-formalization-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "actor_owner" } as const;
function req(method: "GET" | "POST", url = "http://localhost:3000/api/progressive-formalization", body?: unknown,
  extra: Record<string, string> = {}) {
  const preview = url.includes("?");
  return new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: {
    cookie: "__Host-rzka_local_session=opaque", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "POST"
      ? "progressive-formalization-mutate" : preview ? "progressive-formalization-preview" : "progressive-formalization-read",
    ...(method === "POST" ? { origin: "http://localhost:3000", "content-type": "application/json" } : {}), ...extra } });
}
function setup() { const service = { inspect: vi.fn(async () => ({ contractVersion: "progressive-formalization-studio/1.0.0",
  registryHash: "a".repeat(64), flows: [] })), preview: vi.fn(async () => ({ ok: true })),
  mutate: vi.fn(async () => ({ state: { registryHash: "b".repeat(64), flows: [] }, auditAppended: true })) };
  return { service, http: createProgressiveFormalizationHttpHandlers({ service: service as never,
    resolvePrincipal: vi.fn(async () => principal) }) }; }

describe("progressive formalization HTTP", () => {
  it("serves exact cookie-only registry and bounded preview query", async () => {
    const { service, http } = setup(); expect((await http.GET(req("GET"))).status).toBe(200);
    const url = "http://localhost:3000/api/progressive-formalization?formalizationRef=formalization_test&target=G3&policyRef=policy_test";
    expect((await http.GET(req("GET", url))).status).toBe(200);
    expect(service.preview).toHaveBeenCalledWith(principal, { formalizationRef: "formalization_test", target: "G3",
      policyRef: "policy_test" });
    expect((await http.GET(req("GET", `${url}&extra=true`))).status).toBe(400);
  });

  it("posts only exact OCC and owner-confirmation command shapes", async () => {
    const command = { operation: "promote_g3", expectedRegistryHash: "a".repeat(64),
      formalizationRef: "formalization_test", expectedHeadHash: "b".repeat(64), policyRef: "policy_test",
      expectedPreviewHash: "c".repeat(64), ownerConfirmation: { confirmed: true,
        confirmationRef: "confirmation_owner_g3" } } as const;
    const { service, http } = setup(); expect((await http.POST(req("POST", undefined, { command }))).status).toBe(200);
    expect(service.mutate).toHaveBeenCalledWith(principal, command);
    expect((await http.POST(req("POST", undefined, { command: { ...command, canExecute: true } }))).status).toBe(400);
    expect((await http.POST(req("POST", undefined, { command }, { authorization: "Bearer forged" }))).status).toBe(400);
    expect((await http.POST(req("POST", undefined, { command }, { origin: "https://forged.invalid" }))).status).toBe(400);
  });

  it("maps preview blocker without leaking internal data or authority", async () => {
    const command = { operation: "qualify_g4", expectedRegistryHash: "a".repeat(64),
      formalizationRef: "formalization_test", expectedHeadHash: "b".repeat(64), expectedPreviewHash: "c".repeat(64),
      ownerConfirmation: { confirmed: true, confirmationRef: "confirmation_owner_g4" } } as const;
    const service = { inspect: vi.fn(), preview: vi.fn(), mutate: vi.fn(async () => {
      throw new ProgressiveFormalizationStudioError("preview_blocked"); }) };
    const http = createProgressiveFormalizationHttpHandlers({ service: service as never,
      resolvePrincipal: vi.fn(async () => principal) });
    const response = await http.POST(req("POST", undefined, { command })); expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "preview_blocked",
      message: "Authoritative preview tamamlanmadan maturity yükseltilemez." }, authority: {
      canApprove: false, canExecute: false, canWriteMeta: false, canSchedule: false, canCallTool: false } });
  });
});
