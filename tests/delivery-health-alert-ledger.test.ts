import { describe, expect, it } from "vitest";

import {
  DELIVERY_HEALTH_CHECKLIST_ITEMS,
  DeliveryHealthAlertLedgerError,
  openDeliveryHealthAlertLedger,
  transitionDeliveryHealthAlertLedger,
  verifyDeliveryHealthAlertLedger,
} from "@/domain/meta/delivery-health-alert-ledger";

const alert = { workspaceRef: "workspace_primary", alertRef: "delivery_alert_001", accountRef: "account_primary",
  assignedActorRef: "actor_owner", detectedAt: "2026-08-13T09:00:00.000Z", policy: null,
  frozenContextHash: null, evidence: { level: "confirmed" as const, officialState: "payment_required" as const,
    sourceRef: "meta_account_state_001" } };

describe("delivery health alert ledger", () => {
  it("opens confirmed evidence as an advisory recommendation hold with closed authority", () => {
    const opened = openDeliveryHealthAlertLedger({ alert, actorRef: "actor_detector" });
    expect(opened.current).toMatchObject({ status: "open", assignedActorRef: "actor_owner",
      recommendationDisposition: "hold_recommendations" });
    expect(opened.authority).toEqual({ canApprove: false, canExecute: false, canWriteMeta: false,
      canEnableAutomation: false });
    expect(verifyDeliveryHealthAlertLedger([opened])).toBe(true);
  });

  it("keeps suspected evidence in human review without claiming an official payment failure", () => {
    const opened = openDeliveryHealthAlertLedger({ alert: { ...alert, alertRef: "delivery_alert_002",
      evidence: { level: "suspected", baselineSpendDecimal: "1200", currentSpendDecimal: "0",
        observationWindowHours: 24, sourceRef: "window_delivery_001" } }, actorRef: "actor_detector" });
    expect(opened.current.recommendationDisposition).toBe("needs_human_review");
    expect(opened.alert.evidence.level).toBe("suspected");
  });

  it("requires the checklist before resolution and releases only the recommendation hold", () => {
    let head = openDeliveryHealthAlertLedger({ alert, actorRef: "actor_detector" });
    expect(() => transitionDeliveryHealthAlertLedger({ head, expectedRecordHash: head.recordHash,
      actorRef: "actor_owner", occurredAt: "2026-08-13T10:00:00.000Z", command: { kind: "resolve" } }))
      .toThrow(DeliveryHealthAlertLedgerError);
    const records = [head];
    for (const [index, item] of DELIVERY_HEALTH_CHECKLIST_ITEMS.entries()) {
      head = transitionDeliveryHealthAlertLedger({ head, expectedRecordHash: head.recordHash,
        actorRef: "actor_owner", occurredAt: `2026-08-13T1${index}:00:00.000Z`,
        command: { kind: "set_checklist_item", item, completed: true } });
      records.push(head);
    }
    head = transitionDeliveryHealthAlertLedger({ head, expectedRecordHash: head.recordHash,
      actorRef: "actor_owner", occurredAt: "2026-08-13T15:00:00.000Z", command: { kind: "resolve" } });
    records.push(head);
    expect(head.current).toMatchObject({ status: "resolved", recommendationDisposition: "released" });
    expect(head.authority.canExecute).toBe(false);
    expect(verifyDeliveryHealthAlertLedger(records)).toBe(true);
  });

  it("rejects stale transitions and corrupted chains", () => {
    const opened = openDeliveryHealthAlertLedger({ alert, actorRef: "actor_detector" });
    expect(() => transitionDeliveryHealthAlertLedger({ head: opened, expectedRecordHash: "a".repeat(64),
      actorRef: "actor_owner", occurredAt: "2026-08-13T10:00:00.000Z",
      command: { kind: "start_investigation" } })).toThrowError(expect.objectContaining({ code: "stale_head" }));
    expect(verifyDeliveryHealthAlertLedger([{ ...opened, sequence: 2 }])).toBe(false);
  });
});
