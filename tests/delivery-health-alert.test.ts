import { describe, expect, it } from "vitest";
import { createDeliveryHealthAlert, DeliveryHealthAlertError } from "@/domain/meta/delivery-health-alert";

const base = { workspaceRef: "workspace_primary", alertRef: "delivery_alert_001", accountRef: "account_primary",
  assignedActorRef: "actor_owner", detectedAt: "2026-08-13T09:00:00.000Z", policy: null, frozenContextHash: null } as const;

describe("createDeliveryHealthAlert", () => {
  it("keeps confirmed payment/delivery signals distinct and recommendation-only", () => {
    const alert = createDeliveryHealthAlert({ ...base, evidence: { level: "confirmed", officialState: "payment_required",
      sourceRef: "meta_account_state_001" } });
    expect(alert).toMatchObject({ severity: "critical", status: "open", recommendation: "hold_recommendations",
      evidence: { level: "confirmed", officialState: "payment_required" }, authority: { canApprove: false, canExecute: false,
        canWriteMeta: false, canEnableAutomation: false } });
  });

  it("records a spend interruption as suspected rather than inventing an official payment error", () => {
    const alert = createDeliveryHealthAlert({ ...base, evidence: { level: "suspected", baselineSpendDecimal: "1200.00",
      currentSpendDecimal: "0", observationWindowHours: 24, sourceRef: "window_delivery_001" } });
    expect(alert).toMatchObject({ recommendation: "needs_human_review", evidence: { level: "suspected" } });
  });

  it("rejects non-interrupting or malformed suspected evidence", () => {
    expect(() => createDeliveryHealthAlert({ ...base, evidence: { level: "suspected", baselineSpendDecimal: "10",
      currentSpendDecimal: "10", observationWindowHours: 24, sourceRef: "window_delivery_001" } })).toThrow(DeliveryHealthAlertError);
    expect(() => createDeliveryHealthAlert({ ...base, evidence: { level: "confirmed", officialState: "payment_required",
      sourceRef: "bad ref" } as never })).toThrow(DeliveryHealthAlertError);
  });
});
