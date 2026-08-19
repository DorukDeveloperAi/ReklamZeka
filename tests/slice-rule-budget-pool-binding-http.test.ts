import { describe, expect, it, vi } from "vitest";
import { createSliceRuleBudgetPoolBindingHttpHandlers } from "@/server/slice-rule-budget-pool-binding-http";

const principal = Object.freeze({ workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_local", readerRef: "reader_local", actor: { userId: "22222222-2222-4222-8222-222222222222" } });
const hash = "a".repeat(64); const hierarchyHash = "b".repeat(64);
function request(method: "GET" | "POST", body?: unknown) { return new Request("http://localhost:3000/api/slice-rule-budget-pool-bindings", { method, headers: { cookie: "rz=bound", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "GET" ? "slice-rule-budget-pool-binding-read" : "slice-rule-budget-pool-binding-save", ...(method === "POST" ? { origin: "http://localhost:3000", "content-type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
const hierarchy = Object.freeze({ hierarchy: { hierarchyHash, nodes: [{ poolRef: "budget_pool_international", parentPoolRef: null, layer: "market", market: "international", currency: "TRY", hardCapDecimal: "10", effectiveFrom: "2026-08-01T00:00:00.000Z", effectiveTo: "2026-09-01T00:00:00.000Z" }], authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } } });

describe("Slice Rule budget-pool binding HTTP", () => {
  it("reads only an authority-closed hierarchy and frozen binding evidence", async () => {
    const handlers = createSliceRuleBudgetPoolBindingHttpHandlers({ repository: { list: vi.fn(async () => []) } as never, bindingService: { bind: vi.fn() }, hierarchyRepository: { loadCurrent: vi.fn(async () => hierarchy) } as never, resolveActor: async () => ({ principal, role: "analyst" }), now: () => "2026-08-14T10:00:00.000Z" });
    const response = await handlers.GET(request("GET")); const payload = await response.json();
    expect(response.status).toBe(200); expect(payload.hierarchy.nodes[0]).toMatchObject({ poolRef: "budget_pool_international", market: "international" });
    expect(payload.authority).toMatchObject({ canBind: true, canExecute: false, canWriteMeta: false });
    expect(response.headers.get("X-ReklamZeka-Meta-Write")).toBe("disabled");
  });
  it("derives tenant/actor server-side and binds only an exact immutable tuple", async () => {
    const bind = vi.fn(async () => ({ outcome: "inserted" as const }));
    const handlers = createSliceRuleBudgetPoolBindingHttpHandlers({ repository: { list: vi.fn() } as never, bindingService: { bind }, hierarchyRepository: { loadCurrent: vi.fn() } as never, resolveActor: async () => ({ principal, role: "owner" }), now: () => "2026-08-14T10:00:00.000Z" });
    const response = await handlers.POST(request("POST", { command: { draftHash: hash, hierarchyHash, poolRef: "budget_pool_international", market: "international", idempotencyKey: "pool_binding.a" } }));
    expect(response.status).toBe(201); expect(bind).toHaveBeenCalledWith(principal.actor.userId, expect.objectContaining({ workspaceId: principal.workspaceId, draftHash: hash, hierarchyHash, poolRef: "budget_pool_international", market: "international" }));
  });
  it("rejects viewer writes and caller-supplied workspace identity before binding", async () => {
    const bind = vi.fn(); const handlers = createSliceRuleBudgetPoolBindingHttpHandlers({ repository: { list: vi.fn() } as never, bindingService: { bind }, hierarchyRepository: { loadCurrent: vi.fn() } as never, resolveActor: async () => ({ principal, role: "viewer" }), now: () => "2026-08-14T10:00:00.000Z" });
    const response = await handlers.POST(request("POST", { command: { draftHash: hash, hierarchyHash, poolRef: "budget_pool_international", market: "international", idempotencyKey: "pool_binding.a", workspaceId: principal.workspaceId } }));
    expect(response.status).toBe(403); expect(bind).not.toHaveBeenCalled();
  });
});
