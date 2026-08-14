import { describe, expect, it, vi } from "vitest";
import { createSliceRuleScenarioSelectionHttpHandlers } from "@/server/slice-rule-scenario-selection-http";
import { SliceRuleScenarioAllocationSelectionRepositoryError } from "@/connectors/campaigns/slice-rule-scenario-allocation-selection-drizzle-repository";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" }, workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
const candidateRef = `selection_candidate_${"a".repeat(64)}`;
function request(method: "GET" | "POST", body?: unknown, intent = method === "GET" ? "slice-rule-scenario-selection-read" : "slice-rule-scenario-select") {
  return new Request("https://local.test/api/slice-rule-scenario-selections", { method, headers: { cookie: "rz=local", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent, ...(method === "POST" ? { origin: "https://local.test", "content-type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function handlers(overrides: Record<string, unknown> = {}) {
  const repository = { listCandidates: vi.fn().mockResolvedValue([{ candidateRef, scenarioLabel: "scenario.keep", beforeAmountMinor: 100, afterAmountMinor: 120, currency: "TRY", status: "selectable", blockReason: null }]),
    resolveCandidate: vi.fn().mockResolvedValue({ candidate: {}, draftHash: "b".repeat(64), proposalHash: "c".repeat(64), scenarioRef: "scenario.keep", allocationRef: "allocation.primary" }),
    append: vi.fn().mockResolvedValue({ outcome: "inserted", selectionEvidenceHash: "d".repeat(64) }), ...overrides };
  return { repository, handler: createSliceRuleScenarioSelectionHttpHandlers({ repository: repository as never, resolvePrincipal: async () => principal, now: () => "2026-08-14T12:00:00.000Z" }) };
}

describe("slice rule scenario selection HTTP boundary", () => {
  it("accepts only a cookie-bound opaque candidate decision and derives every private field server-side", async () => {
    const { repository, handler } = handlers();
    const response = await handler.POST(request("POST", { command: { candidateRef, idempotencyKey: "selection.user.click" } }));
    expect(response.status).toBe(201); await expect(response.json()).resolves.toMatchObject({ selectionRef: `selection_${"d".repeat(64)}`, authority: { canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(repository.append).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, draftHash: "b".repeat(64), proposalHash: "c".repeat(64), scenarioRef: "scenario.keep", allocationRef: "allocation.primary" }));
  });
  it("rejects client-supplied amount, entity, scope, approval and tenant fields before source resolution", async () => {
    const { repository, handler } = handlers();
    const response = await handler.POST(request("POST", { command: { candidateRef, idempotencyKey: "selection.user.click", afterAmountMinor: 1 } }));
    expect(response.status).toBe(400); expect(repository.resolveCandidate).not.toHaveBeenCalled(); expect(repository.append).not.toHaveBeenCalled();
  });
  it("fails closed for a delivery hold and keeps the selection write path authority-closed", async () => {
    const blocked = new SliceRuleScenarioAllocationSelectionRepositoryError("delivery_hold");
    const { repository, handler } = handlers({ resolveCandidate: vi.fn().mockRejectedValue(blocked) });
    const response = await handler.POST(request("POST", { command: { candidateRef, idempotencyKey: "selection.user.click" } }));
    expect(response.status).toBe(409); expect(repository.append).not.toHaveBeenCalled();
  });
  it("projects a delivery hold as blocked on GET and rejects a stale replay on POST", async () => {
    const { repository, handler } = handlers({ listCandidates: vi.fn().mockResolvedValue([{ candidateRef, scenarioLabel: "scenario.keep", beforeAmountMinor: 100, afterAmountMinor: 120, currency: "TRY", status: "blocked", blockReason: "delivery_hold" }]),
      resolveCandidate: vi.fn().mockRejectedValue(new SliceRuleScenarioAllocationSelectionRepositoryError("stale_source")) });
    const list = await (await handler.GET(request("GET"))).json(); expect(list.candidates[0]).toMatchObject({ status: "blocked", blockReason: "delivery_hold" });
    expect((await handler.POST(request("POST", { command: { candidateRef, idempotencyKey: "selection.replay" } }))).status).toBe(409);
    expect(repository.append).not.toHaveBeenCalled();
  });
  it("lists safe selectable or blocked candidates only through the cookie-bound tenant", async () => {
    const { repository, handler } = handlers();
    expect((await handler.GET(request("GET"))).status).toBe(200); expect(repository.listCandidates).toHaveBeenCalledWith(principal.workspaceId);
    expect((await handler.GET(request("GET", undefined, "wrong"))).status).toBe(400);
  });
  it("derives the tenant solely from the trusted principal, never from the candidate request", async () => {
    const foreign = { ...principal, workspaceId: "33333333-3333-4333-8333-333333333333" } as const;
    const repository = handlers().repository;
    const handler = createSliceRuleScenarioSelectionHttpHandlers({ repository: repository as never, resolvePrincipal: async () => foreign, now: () => "2026-08-14T12:00:00.000Z" });
    expect((await handler.GET(request("GET"))).status).toBe(200); expect(repository.listCandidates).toHaveBeenCalledWith(foreign.workspaceId);
  });
});
