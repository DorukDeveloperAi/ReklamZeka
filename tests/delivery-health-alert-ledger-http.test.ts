import { describe, expect, it, vi } from "vitest";

import { openDeliveryHealthAlertLedger } from "@/domain/meta/delivery-health-alert-ledger";
import { createDeliveryHealthAlertLedgerHttpHandlers } from "@/server/delivery-health-alert-ledger-http";

const record = openDeliveryHealthAlertLedger({ actorRef: "actor_detector", alert: {
  workspaceRef: "workspace_primary", alertRef: "delivery_alert_001", accountRef: "account_primary",
  assignedActorRef: "actor_owner", detectedAt: "2026-08-13T09:00:00.000Z", policy: null,
  frozenContextHash: null, evidence: { level: "confirmed", officialState: "payment_required",
    sourceRef: "meta_account_state_001" },
} });
const principal = { workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_primary",
  readerRef: "actor_owner", actor: { userId: "22222222-2222-4222-8222-222222222222" } } as const;

function request(method: "GET" | "POST", body?: unknown, intent = method === "GET"
  ? "delivery-health-alert-read" : "delivery-health-alert-transition") {
  return new Request("http://localhost:3000/api/delivery-health-alerts", { method,
    headers: { cookie: "session=x", origin: "http://localhost:3000", "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": intent, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("delivery health alert ledger HTTP", () => {
  it("returns only a public-safe current projection to any member", async () => {
    const listCurrent = vi.fn(async () => [{ schemaVersion: "public-delivery-health-alert/1.0.0",
      alertRef: record.alert.alertRef, accountRef: record.alert.accountRef,
      evidence: { level: "confirmed", officialState: "payment_required" }, evidenceHash: record.alert.evidenceHash,
      alertHash: record.alert.alertHash, sequence: 1, recordHash: record.recordHash, status: "open",
      recommendationDisposition: "hold_recommendations", assignedActorRef: "actor_owner",
      checklist: record.current.checklist, detectedAt: record.alert.detectedAt, updatedAt: record.event.occurredAt,
      authority: record.authority }] as const);
    const handlers = createDeliveryHealthAlertLedgerHttpHandlers({ service: { listCurrent, transition: vi.fn() } as never,
      resolveActor: async () => ({ principal, role: "viewer" }) });
    const response = await handlers.GET(request("GET"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({ evidence: { level: "confirmed", officialState: "payment_required" },
      recommendationDisposition: "hold_recommendations", authority: { canExecute: false, canWriteMeta: false } });
    expect(JSON.stringify(body)).not.toContain("sourceRef");
    expect(body.authority.canManageWorkflow).toBe(false);
  });

  it("accepts a strict human workflow command without exposing materialization", async () => {
    const transition = vi.fn(async () => record);
    const handlers = createDeliveryHealthAlertLedgerHttpHandlers({ service: { listCurrent: vi.fn(), transition } as never,
      resolveActor: async () => ({ principal, role: "analyst" }) });
    const response = await handlers.POST(request("POST", { alertRef: record.alert.alertRef,
      expectedRecordHash: record.recordHash, command: { kind: "start_investigation" } }));
    expect(response.status).toBe(200);
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ alertRef: record.alert.alertRef,
      expectedRecordHash: record.recordHash, command: { kind: "start_investigation" } }));
    const body = await response.json();
    expect(body.authority).toMatchObject({ canApprove: false, canExecute: false, canWriteMeta: false });
  });

  it("rejects viewer mutation, caller workspace headers and unknown command fields", async () => {
    const handlers = createDeliveryHealthAlertLedgerHttpHandlers({ service: { listCurrent: vi.fn(),
      transition: vi.fn(async () => record) } as never, resolveActor: async () => ({ principal, role: "viewer" }) });
    const viewer = await handlers.POST(request("POST", { alertRef: record.alert.alertRef,
      expectedRecordHash: record.recordHash, command: { kind: "reopen" } }));
    expect(viewer.status).toBe(403);
    const unknown = await handlers.POST(request("POST", { alertRef: record.alert.alertRef,
      expectedRecordHash: record.recordHash, command: { kind: "reopen", execute: true } }));
    expect(unknown.status).toBe(400);
    const missingCommand = await handlers.POST(request("POST", { alertRef: record.alert.alertRef,
      expectedRecordHash: record.recordHash, command: null }));
    expect(missingCommand.status).toBe(400);
    const forged = request("GET");
    const headers = new Headers(forged.headers); headers.set("x-workspace-id", principal.workspaceId);
    expect((await handlers.GET(new Request(forged.url, { headers }))).status).toBe(400);
  });
});
