import { describe, expect, it, vi } from "vitest";

import { createSliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import { projectSliceRuleWorkspaceDraft } from "@/connectors/campaigns/slice-rule-workspace-drizzle-repository";
import { assertTrustedLocalDecisionRoomRequest } from "@/server/local-decision-room-runtime";
import { createSliceRuleWorkspaceHttpHandlers } from "@/server/slice-rule-workspace-http";

const principal = Object.freeze({ actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_primary", readerRef: "reader_primary" });
const scope = Object.freeze({ market: "international" as const, serviceRef: "service_physical_therapy",
  campaignFamilyRef: "campaign_family_intensive_ftr", countryOrRegion: "Arap Bölgesi",
  audienceStrategy: "Özel hedefleme", platform: "instagram" as const });
const rule = Object.freeze({ kind: "period_budget_cap" as const, period: "monthly" as const,
  currency: "TRY", maximumDecimal: "250000" });
const verification = Object.freeze({ metric: "cost_per_qualified_lead" as const, reviewCadence: "weekly" as const,
  rollbackWhen: "Yeni sonuç kanıtı veya kapsam değişimi insan incelemesini gerektirirse." });
const draft = createSliceRuleWorkspaceDraft({ workspaceId: principal.workspaceId, seriesRef: "slice_rule.ftr.ar",
  revision: 1, previousDraftHash: "GENESIS", idempotencyKey: "slice_rule.ftr.ar.r1",
  createdAt: "2026-08-13T10:00:00.000Z", scope, rule, priority: 80, verification });

function request(method: "GET" | "POST", body?: unknown) {
  return new Request("https://local.test/api/slice-rule-workspace", { method, headers: {
    cookie: "rz=local", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "GET"
      ? "slice-rule-workspace-read" : "slice-rule-workspace-save",
    ...(method === "POST" ? { origin: "https://local.test", "content-type": "application/json" } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("Slice Rule Workspace HTTP", () => {
  it("admits only the dedicated same-origin draft intent at the local boundary", () => {
    const config = { origin: "http://localhost:3000", workspaceId: principal.workspaceId,
      workspaceRef: principal.workspaceRef, userId: principal.actor.userId, readerRef: principal.readerRef,
      signingKey: Buffer.alloc(32) };
    const safe = new Request("http://localhost:3000/api/slice-rule-workspace", { method: "POST", headers: {
      host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": "slice-rule-workspace-save",
    } });
    expect(() => assertTrustedLocalDecisionRoomRequest(safe, config, "draft", "cookie")).not.toThrow();
    const unsafe = new Request(safe, { headers: { ...Object.fromEntries(safe.headers),
      "x-reklamzeka-intent": "slice-rule-workspace-publish" } });
    expect(() => assertTrustedLocalDecisionRoomRequest(unsafe, config, "draft", "cookie")).toThrow();
  });

  it.each(["owner", "admin", "analyst"] as const)("allows %s to save a recommendation-only draft", async (role) => {
    const saveDraft = vi.fn(async () => ({ contractVersion: "slice-rule-workspace-result/1.0.0" as const,
      draft, persistence: "inserted" as const, auditAppended: true, authority: draft.authority }));
    const handlers = createSliceRuleWorkspaceHttpHandlers({ repository: { listCurrent: vi.fn() }, service: { saveDraft },
      resolveActor: async () => ({ principal, role }), now: () => "2026-08-13T10:00:00.000Z" });
    const response = await handlers.POST(request("POST", { command: { operation: "save_draft",
      seriesRef: draft.seriesRef, revision: 1, previousDraftHash: "GENESIS", idempotencyKey: draft.idempotencyKey,
      scope, rule, priority: 80, verification } }));
    expect(response.status).toBe(201);
    expect(saveDraft).toHaveBeenCalledWith(principal.actor.userId, expect.objectContaining({
      workspaceId: principal.workspaceId, createdAt: "2026-08-13T10:00:00.000Z", scope }));
    const payload = await response.json();
    expect(payload.item).not.toHaveProperty("workspaceId");
    expect(payload.authority).toEqual({ canRead: true, canSaveDraft: true, canPublish: false, canApprove: false,
      canExecute: false, canWriteMeta: false, canEnableAutomation: false });
    expect(response.headers.get("X-ReklamZeka-Meta-Write")).toBe("disabled");
  });

  it("lets a viewer read but rejects saving before persistence", async () => {
    const listCurrent = vi.fn(async () => [projectSliceRuleWorkspaceDraft(draft)]);
    const saveDraft = vi.fn();
    const handlers = createSliceRuleWorkspaceHttpHandlers({ repository: { listCurrent }, service: { saveDraft } as never,
      resolveActor: async () => ({ principal, role: "viewer" }), now: () => "2026-08-13T10:00:00.000Z" });
    const read = await handlers.GET(request("GET"));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ items: [{ seriesRef: draft.seriesRef }], authority: { canRead: true,
      canSaveDraft: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const write = await handlers.POST(request("POST", { command: { operation: "save_draft", seriesRef: draft.seriesRef,
      revision: 1, previousDraftHash: "GENESIS", idempotencyKey: draft.idempotencyKey,
      scope, rule, priority: 80, verification } }));
    expect(write.status).toBe(403);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("rejects missing mandatory dimensions, injected authority and caller identity", async () => {
    const handlers = createSliceRuleWorkspaceHttpHandlers({ repository: { listCurrent: vi.fn() }, service: { saveDraft: vi.fn() },
      resolveActor: async () => ({ principal, role: "owner" }), now: () => "2026-08-13T10:00:00.000Z" });
    const missing = { ...scope } as Record<string, unknown>; delete missing.market;
    for (const command of [
      { operation: "save_draft", seriesRef: draft.seriesRef, revision: 1, previousDraftHash: "GENESIS",
        idempotencyKey: draft.idempotencyKey, scope: missing, rule, priority: 80, verification },
      { operation: "save_draft", seriesRef: draft.seriesRef, revision: 1, previousDraftHash: "GENESIS",
        idempotencyKey: draft.idempotencyKey, scope: { ...scope, authority: { canWriteMeta: true } }, rule, priority: 80, verification },
      { operation: "save_draft", seriesRef: draft.seriesRef, revision: 1, previousDraftHash: "GENESIS",
        idempotencyKey: draft.idempotencyKey, scope, rule, priority: 80, verification, workspaceId: principal.workspaceId },
    ]) {
      const response = await handlers.POST(request("POST", { command }));
      expect(response.status).toBe(400);
      expect((await response.json()).authority.canWriteMeta).toBe(false);
    }
  });
});
