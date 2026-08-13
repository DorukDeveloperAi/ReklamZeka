import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DeliveryHealthAlertSurface,
  parseDeliveryHealthAlertList,
  transitionDeliveryHealthAlert,
  type DeliveryHealthAlertList,
  type PublicDeliveryHealthAlert,
} from "@/app/dashboard/delivery-health-alert-panel";

const authority = { canApprove: false as const, canExecute: false as const, canWriteMeta: false as const,
  canEnableAutomation: false as const };
const item = { schemaVersion: "public-delivery-health-alert/1.0.0", alertRef: "delivery_alert_001",
  accountRef: "account_meta_001", evidence: { level: "confirmed" as const, officialState: "payment_required" as const },
  evidenceHash: "a".repeat(64), alertHash: "b".repeat(64), sequence: 2, recordHash: "c".repeat(64),
  status: "investigating" as const, recommendationDisposition: "hold_recommendations" as const,
  assignedActorRef: "actor_owner_001", checklist: { verify_evidence: true, inspect_account_and_delivery: false,
    confirm_recovery_or_false_positive: false, notify_responsible: false }, detectedAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z", authority } satisfies PublicDeliveryHealthAlert;
const list = { contractVersion: "delivery-health-alert-http/1.0.0", items: [item], authority: { canRead: true as const,
  canManageWorkflow: true, ...authority } } satisfies DeliveryHealthAlertList;
const callbacks = { onRetry: vi.fn(), onTransition: vi.fn() };

describe("Delivery/Payment alarm dashboard", () => {
  it("shows confirmed evidence, hold, checklist, assignee and closed action authority", () => {
    const html = renderToStaticMarkup(createElement(DeliveryHealthAlertSurface, { ...callbacks,
      state: { status: "ready", result: list, busyAlertRef: null, error: null, notice: null } }));
    expect(html).toContain("Doğrulanmış Meta sinyali");
    expect(html).toContain("Ödeme gerekli");
    expect(html).toContain("Öneriler beklemede");
    expect(html).toContain("İnsan kontrol listesi");
    expect(html).toContain("actor_owner_001");
    expect(html).toContain("Onay, execute, otomasyon ve Meta write yetkisi");
    expect(html).not.toContain(">Onayla<");
    expect(html).not.toContain(">Kampanyayı durdur<");
  });

  it("keeps suspected evidence separate and never invents an official state", () => {
    const suspected = { ...item, alertRef: "delivery_alert_002", evidence: { level: "suspected" as const,
      officialState: null }, recommendationDisposition: "needs_human_review" as const };
    const html = renderToStaticMarkup(createElement(DeliveryHealthAlertSurface, { ...callbacks,
      state: { status: "ready", result: { ...list, items: [suspected] }, busyAlertRef: null, error: null, notice: null } }));
    expect(html).toContain("Şüpheli teslimat kesintisi");
    expect(html).toContain("Resmî Meta hata durumu iddia edilmiyor");
    expect(html).toContain("İnsan incelemesi gerekli");
    expect(html).not.toContain("Ödeme gerekli");
  });

  it("rejects open-authority, malformed and evidence-disposition drift responses", () => {
    expect(parseDeliveryHealthAlertList(list)).not.toBeNull();
    expect(parseDeliveryHealthAlertList({ ...list, authority: { ...list.authority, canWriteMeta: true } })).toBeNull();
    expect(parseDeliveryHealthAlertList({ ...list, items: [{ ...item, recordHash: "bad" }] })).toBeNull();
    expect(parseDeliveryHealthAlertList({ ...list, items: [{ ...item,
      recommendationDisposition: "needs_human_review" }] })).toBeNull();
  });

  it("posts only a ledger workflow command and verifies the closed transition response", async () => {
    const next = { ...item, sequence: 3, recordHash: "d".repeat(64), checklist: { ...item.checklist,
      inspect_account_and_delivery: true } };
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestInit = init;
      return new Response(JSON.stringify({
        contractVersion: "delivery-health-alert-transition/1.0.0", item: next, authority,
      }), { status: 200 });
    });
    await expect(transitionDeliveryHealthAlert(fetcher as typeof fetch, { alert: item,
      command: { kind: "set_checklist_item", item: "inspect_account_and_delivery", completed: true } }))
      .resolves.toEqual(next);
    expect(fetcher).toHaveBeenCalledWith("/api/delivery-health-alerts", expect.objectContaining({ method: "POST",
      credentials: "same-origin", headers: expect.objectContaining({
        "X-ReklamZeka-Intent": "delivery-health-alert-transition" }) }));
    expect(JSON.parse(requestInit!.body as string)).toEqual({ alertRef: item.alertRef,
      expectedRecordHash: item.recordHash,
      command: { kind: "set_checklist_item", item: "inspect_account_and_delivery", completed: true } });
  });

  it("distinguishes unavailable and true empty without fixture fallback", () => {
    const unavailable = renderToStaticMarkup(createElement(DeliveryHealthAlertSurface, { ...callbacks,
      state: { status: "unavailable", message: "Yerel oturum gerekli." } }));
    const empty = renderToStaticMarkup(createElement(DeliveryHealthAlertSurface, { ...callbacks,
      state: { status: "ready", result: { ...list, items: [] }, busyAlertRef: null, error: null, notice: null } }));
    expect(unavailable).toContain("Fixture alarm canlı olay gibi gösterilmez");
    expect(empty).toContain("Kaynak bağlı · açık veya geçmiş alarm yok");
    expect(empty).toContain("demo fallback değildir");
  });
});
