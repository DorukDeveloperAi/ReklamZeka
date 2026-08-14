import { describe, expect, it, vi } from "vitest";

import { createBudgetPoolHierarchyRevision } from "@/application/budget-pool-hierarchy-service";
import { BudgetPoolHierarchyRepositoryError } from "@/connectors/budget/budget-pool-hierarchy-drizzle-repository";
import { createBudgetPoolHierarchyHttpHandlers } from "@/server/budget-pool-hierarchy-http";

const principal = Object.freeze({ actor: { userId: "22222222-2222-4222-8222-222222222222" }, workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_primary", readerRef: "reader_primary" });
const input = Object.freeze({ workspaceId: principal.workspaceId, revision: 1, previousHierarchyHash: "GENESIS" as const, idempotencyKey: "pools.r1", nodes: [
  { poolRef: "budget_pool_domestic", parentPoolRef: null, layer: "market" as const, market: "domestic" as const, currency: "TRY", hardCapDecimal: "10", effectiveFrom: "2026-08-13T00:00:00.000Z", effectiveTo: "2026-09-13T00:00:00.000Z" },
  { poolRef: "budget_pool_international", parentPoolRef: null, layer: "market" as const, market: "international" as const, currency: "TRY", hardCapDecimal: "10", effectiveFrom: "2026-08-13T00:00:00.000Z", effectiveTo: "2026-09-13T00:00:00.000Z" },
] });
const revision = createBudgetPoolHierarchyRevision(input);
function request(method: "GET" | "POST", body?: unknown) { return new Request("https://local.test/api/budget-pool-hierarchy", { method, headers: { cookie: "rz=local", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "GET" ? "budget-pool-hierarchy-read" : "budget-pool-hierarchy-save", ...(method === "POST" ? { origin: "https://local.test", "content-type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
describe("budget pool hierarchy HTTP", () => {
  it("keeps read and save recommendation-only, and never exposes workspace identity", async () => {
    const save = vi.fn(async () => ({ contractVersion: "budget-pool-hierarchy-result/1.0.0" as const, revision, persistence: "inserted" as const, auditAppended: true, authority: revision.hierarchy.authority }));
    const handlers = createBudgetPoolHierarchyHttpHandlers({ repository: { loadCurrent: vi.fn(async () => revision) }, service: { save }, resolveActor: async () => ({ principal, role: "owner" }) });
    const read = await handlers.GET(request("GET")); expect(read.status).toBe(200);
    const readBody = await read.json(); expect(readBody.item).not.toHaveProperty("workspaceId"); expect(readBody.authority).toMatchObject({ canSaveDraft: true, canExecute: false, canWriteMeta: false });
    const saved = await handlers.POST(request("POST", { command: { revision: 1, previousHierarchyHash: "GENESIS", idempotencyKey: "pools.r1", nodes: input.nodes } }));
    expect(saved.status).toBe(201); expect(save).toHaveBeenCalledWith(principal.actor.userId, expect.objectContaining({ workspaceId: principal.workspaceId }));
    expect((await saved.json()).authority).toMatchObject({ canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });
  });
  it("rejects a viewer before persistence", async () => {
    const save = vi.fn(); const handlers = createBudgetPoolHierarchyHttpHandlers({ repository: { loadCurrent: vi.fn(async () => null) }, service: { save } as never, resolveActor: async () => ({ principal, role: "viewer" }) });
    const response = await handlers.POST(request("POST", { command: { revision: 1, previousHierarchyHash: "GENESIS", idempotencyKey: "pools.r1", nodes: input.nodes } }));
    expect(response.status).toBe(403); expect(save).not.toHaveBeenCalled();
  });
  it("fails closed when a stale immutable revision reaches persistence", async () => {
    const save = vi.fn(async () => { throw new BudgetPoolHierarchyRepositoryError("revision_conflict"); });
    const handlers = createBudgetPoolHierarchyHttpHandlers({ repository: { loadCurrent: vi.fn(async () => revision) }, service: { save } as never, resolveActor: async () => ({ principal, role: "owner" }) });
    const response = await handlers.POST(request("POST", { command: { revision: 1, previousHierarchyHash: "GENESIS", idempotencyKey: "pools.r1", nodes: input.nodes } }));
    expect(response.status).toBe(409);
    expect((await response.json()).authority).toMatchObject({ canExecute: false, canWriteMeta: false });
  });
});
