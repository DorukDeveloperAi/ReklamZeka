import { createHash } from "node:crypto";

/**
 * A non-actionable interruption signal.  It purposefully distinguishes a
 * platform-confirmed account/delivery issue from a performance observation
 * that merely looks like one.  Neither form can grant Meta write authority.
 */
export const DELIVERY_HEALTH_ALERT_VERSION = "delivery-health-alert/1.0.0" as const;

export type DeliveryHealthEvidence =
  | Readonly<{ level: "confirmed"; officialState: "payment_required" | "account_disabled" | "delivery_rejected" | "delivery_limited"; sourceRef: string }>
  | Readonly<{ level: "suspected"; baselineSpendDecimal: string; currentSpendDecimal: string; observationWindowHours: number; sourceRef: string }>;

export type DeliveryHealthAlertInput = Readonly<{
  workspaceRef: string;
  alertRef: string;
  accountRef: string;
  assignedActorRef: string;
  detectedAt: string;
  evidence: DeliveryHealthEvidence;
  policy: Readonly<{ policyRef: string; policyHash: string }> | null;
  frozenContextHash: string | null;
}>;

export type DeliveryHealthAlert = Readonly<DeliveryHealthAlertInput & {
  version: typeof DELIVERY_HEALTH_ALERT_VERSION;
  severity: "critical";
  status: "open";
  recommendation: "needs_human_review" | "hold_recommendations";
  evidenceHash: string;
  alertHash: string;
  authority: Readonly<{ canApprove: false; canExecute: false; canWriteMeta: false; canEnableAutomation: false }>;
}>;

export class DeliveryHealthAlertError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_evidence") {
    super(`Delivery health alert rejected: ${code}`);
    this.name = "DeliveryHealthAlertError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^(0|[1-9]\d{0,17})(?:\.\d{1,8})?$/;
const AUTHORITY = Object.freeze({ canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canEnableAutomation: false as const });

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) throw new DeliveryHealthAlertError("invalid_input"); return value; }
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) throw new DeliveryHealthAlertError("invalid_input"); return value; }
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new DeliveryHealthAlertError("invalid_input");
  }
  return value;
}

function evidence(value: DeliveryHealthEvidence): DeliveryHealthEvidence {
  if (!value || typeof value !== "object" || typeof value.sourceRef !== "string") throw new DeliveryHealthAlertError("invalid_evidence");
  const sourceRef = ref(value.sourceRef);
  if (value.level === "confirmed") {
    if (!["payment_required", "account_disabled", "delivery_rejected", "delivery_limited"].includes(value.officialState)) {
      throw new DeliveryHealthAlertError("invalid_evidence");
    }
    return Object.freeze({ level: "confirmed", officialState: value.officialState, sourceRef });
  }
  if (value.level === "suspected") {
    if (!DECIMAL.test(value.baselineSpendDecimal) || !DECIMAL.test(value.currentSpendDecimal)
      || Number(value.currentSpendDecimal) >= Number(value.baselineSpendDecimal)
      || !Number.isSafeInteger(value.observationWindowHours) || value.observationWindowHours < 1 || value.observationWindowHours > 168) {
      throw new DeliveryHealthAlertError("invalid_evidence");
    }
    return Object.freeze({ level: "suspected", baselineSpendDecimal: value.baselineSpendDecimal,
      currentSpendDecimal: value.currentSpendDecimal, observationWindowHours: value.observationWindowHours, sourceRef });
  }
  throw new DeliveryHealthAlertError("invalid_evidence");
}

/** Builds an immutable, human-review-only interruption alert. */
export function createDeliveryHealthAlert(input: DeliveryHealthAlertInput): DeliveryHealthAlert {
  const normalizedEvidence = evidence(input.evidence);
  const policy = input.policy === null ? null : Object.freeze({ policyRef: ref(input.policy.policyRef), policyHash: hash(input.policy.policyHash) });
  const frozenContextHash = input.frozenContextHash === null ? null : hash(input.frozenContextHash);
  const core = Object.freeze({ version: DELIVERY_HEALTH_ALERT_VERSION, workspaceRef: ref(input.workspaceRef),
    alertRef: ref(input.alertRef), accountRef: ref(input.accountRef), assignedActorRef: ref(input.assignedActorRef),
    detectedAt: instant(input.detectedAt), evidence: normalizedEvidence, policy, frozenContextHash,
    severity: "critical" as const, status: "open" as const,
    recommendation: normalizedEvidence.level === "confirmed" ? "hold_recommendations" as const : "needs_human_review" as const,
    authority: AUTHORITY });
  const evidenceHash = digest(normalizedEvidence);
  return Object.freeze({ ...core, evidenceHash, alertHash: digest({ ...core, evidenceHash }) });
}
