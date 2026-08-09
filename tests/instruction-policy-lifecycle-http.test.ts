import { describe, expect, it, vi } from "vitest";
import { InstructionPolicyLifecycleError } from "@/application/instruction-policy-lifecycle-service";
import { createInstructionPolicyLifecycleHttpHandlers } from "@/server/instruction-policy-lifecycle-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "actor_owner" } as const;
function request(method: "GET" | "POST", body?: unknown, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/instruction-policies", { method,
    body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: "__Host-rzka_local_session=opaque",
      "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "GET"
        ? "instruction-policy-read" : "instruction-policy-mutate", ...(method === "POST" ? {
        origin: "http://localhost:3000", "content-type": "application/json" } : {}), ...extra } });
}
function setup(mutate = vi.fn(async () => ({ state: { registryHash: "b".repeat(64), current: [], history: [], diffs: [] },
  auditAppended: true, contextInvalidationAppended: true }))) {
  const service = { inspect: vi.fn(async () => ({ contractVersion: "instruction-policy-lifecycle/1.0.0",
    registryHash: "a".repeat(64), current: [], history: [], diffs: [] })), mutate };
  return { service, http: createInstructionPolicyLifecycleHttpHandlers({ service: service as never,
    resolvePrincipal: vi.fn(async () => principal) }) };
}

describe("instruction policy lifecycle HTTP", () => {
  it("serves public-safe history over cookie-only same-origin GET", async () => {
    const response = await setup().http.GET(request("GET"));
    expect(response.status).toBe(200); expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(await response.json()).toMatchObject({ history: [] });
  });

  it("returns same-workspace raw provenance without accepting caller workspace or actor fields", async () => {
    const inspect = vi.fn(async () => ({ registryHash: "a".repeat(64), current: [], diffs: [], history: [{
      policy: { policyRef: "policy_health", authority: { canExecute: false, canWriteMeta: false } },
      rawProvenance: { provenanceRef: "provenance_health", rawText: "Kullanıcı talimatı",
        rawTextHash: "b".repeat(64), capturedByActorRef: "actor_owner", capturedAt: "2026-08-09T00:00:00.000Z" },
      recordedAt: "2026-08-09T00:00:00.000Z" }] }));
    const http = createInstructionPolicyLifecycleHttpHandlers({ service: { inspect, mutate: vi.fn() } as never,
      resolvePrincipal: vi.fn(async () => principal) });
    const response = await http.GET(request("GET"));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ history: [{ rawProvenance: {
      rawText: "Kullanıcı talimatı", provenanceRef: "provenance_health" } }] });
    expect((await http.GET(request("GET", undefined, { authorization: "Bearer forged" }))).status).toBe(400);
    const command = { operation: "archive", expectedRegistryHash: "a".repeat(64), policyRef: "policy_health",
      expectedVersion: 1, expectedPolicyHash: "b".repeat(64), expectedImpactHash: "c".repeat(64), reasonCode: "owner_archive",
      workspaceId: principal.workspaceId, actorId: principal.actor.userId };
    expect((await http.POST(request("POST", { command }))).status).toBe(400);
  });

  it("accepts only the exact lifecycle OCC envelope", async () => {
    const command = { operation: "publish", expectedRegistryHash: "a".repeat(64), policyRef: "policy_health",
      expectedVersion: 1, expectedPolicyHash: "b".repeat(64), expectedImpactHash: "c".repeat(64), reasonCode: "owner_publish" };
    const { service, http } = setup(); expect((await http.POST(request("POST", { command }))).status).toBe(200);
    expect(service.mutate).toHaveBeenCalledWith(principal, command);
    expect((await http.POST(request("POST", { command: { ...command, canExecute: true } }))).status).toBe(400);
    expect((await http.POST(request("POST", { command }, { authorization: "Bearer forged" }))).status).toBe(400);
    expect((await http.POST(request("POST", { command }, { origin: "https://forged.invalid" }))).status).toBe(400);
  });

  it("maps conflict and transition failures without leaking internals", async () => {
    const command = { operation: "archive", expectedRegistryHash: "a".repeat(64), policyRef: "policy_health",
      expectedVersion: 1, expectedPolicyHash: "b".repeat(64), expectedImpactHash: "c".repeat(64), reasonCode: "owner_archive" };
    for (const code of ["conflict", "invalid_transition", "dependency_blocked"] as const) {
      const response = await setup(vi.fn(async () => { throw new InstructionPolicyLifecycleError(code); })).http
        .POST(request("POST", { command }));
      expect(response.status).toBe(409); const payload = await response.json();
      expect(JSON.stringify(payload)).not.toContain(principal.workspaceId);
      expect(payload.authority).toEqual({ canApprove: false, canExecute: false, canWriteMeta: false,
        canSchedule: false, canCallTool: false });
    }
  });

  it("maps a revoked same-transaction membership to forbidden", async () => {
    const command = { operation: "publish", expectedRegistryHash: "a".repeat(64), policyRef: "policy_health",
      expectedVersion: 1, expectedPolicyHash: "b".repeat(64), expectedImpactHash: "c".repeat(64), reasonCode: "owner_publish" };
    const response = await setup(vi.fn(async () => { throw new InstructionPolicyLifecycleError("forbidden"); })).http
      .POST(request("POST", { command }));
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
