import { createHash } from "node:crypto";

import {
  createDeliveryHealthAlert,
  type DeliveryHealthAlert,
  type DeliveryHealthAlertInput,
} from "@/domain/meta/delivery-health-alert";

export const DELIVERY_HEALTH_ALERT_LEDGER_VERSION = "delivery-health-alert-ledger/1.0.0" as const;
export const DELIVERY_HEALTH_CHECKLIST_ITEMS = Object.freeze([
  "verify_evidence",
  "inspect_account_and_delivery",
  "confirm_recovery_or_false_positive",
  "notify_responsible",
] as const);

export type DeliveryHealthChecklistItem = typeof DELIVERY_HEALTH_CHECKLIST_ITEMS[number];
export type DeliveryHealthAlertStatus = "open" | "investigating" | "resolved";
export type DeliveryHealthRecommendationDisposition = "hold_recommendations" | "needs_human_review" | "released";
export type DeliveryHealthAlertCommand =
  | Readonly<{ kind: "assign"; assignedActorRef: string }>
  | Readonly<{ kind: "start_investigation" }>
  | Readonly<{ kind: "set_checklist_item"; item: DeliveryHealthChecklistItem; completed: boolean }>
  | Readonly<{ kind: "resolve" }>
  | Readonly<{ kind: "reopen" }>;

export type DeliveryHealthAlertLedgerRecord = Readonly<{
  version: typeof DELIVERY_HEALTH_ALERT_LEDGER_VERSION;
  alert: DeliveryHealthAlert;
  sequence: number;
  previousRecordHash: "GENESIS" | string;
  recordHash: string;
  event: Readonly<{
    kind: "detected" | DeliveryHealthAlertCommand["kind"];
    actorRef: string;
    occurredAt: string;
  }>;
  current: Readonly<{
    status: DeliveryHealthAlertStatus;
    assignedActorRef: string;
    checklist: Readonly<Record<DeliveryHealthChecklistItem, boolean>>;
    recommendationDisposition: DeliveryHealthRecommendationDisposition;
  }>;
  authority: Readonly<{
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canEnableAutomation: false;
  }>;
}>;

export class DeliveryHealthAlertLedgerError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_transition" | "stale_head" | "corrupt_ledger") {
    super(`Delivery health alert ledger rejected: ${code}`);
    this.name = "DeliveryHealthAlertLedgerError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const AUTHORITY = Object.freeze({ canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canEnableAutomation: false as const });

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) throw new DeliveryHealthAlertLedgerError("invalid_input");
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new DeliveryHealthAlertLedgerError("invalid_input");
  }
  return value;
}
function checklist(value?: Readonly<Record<DeliveryHealthChecklistItem, boolean>>) {
  const result = Object.fromEntries(DELIVERY_HEALTH_CHECKLIST_ITEMS.map((item) => [item, value?.[item] ?? false]));
  return Object.freeze(result) as Readonly<Record<DeliveryHealthChecklistItem, boolean>>;
}
function disposition(alert: DeliveryHealthAlert, status: DeliveryHealthAlertStatus): DeliveryHealthRecommendationDisposition {
  if (status === "resolved") return "released";
  return alert.evidence.level === "confirmed" ? "hold_recommendations" : "needs_human_review";
}
function finish(core: Omit<DeliveryHealthAlertLedgerRecord, "recordHash">): DeliveryHealthAlertLedgerRecord {
  return Object.freeze({ ...core, recordHash: digest(core) });
}

function validRecord(record: DeliveryHealthAlertLedgerRecord): boolean {
  const core = { version: record.version, alert: record.alert, sequence: record.sequence,
    previousRecordHash: record.previousRecordHash, event: record.event, current: record.current, authority: record.authority };
  return record.version === DELIVERY_HEALTH_ALERT_LEDGER_VERSION
    && Number.isSafeInteger(record.sequence) && record.sequence >= 1
    && (record.previousRecordHash === "GENESIS" || HASH.test(record.previousRecordHash))
    && record.recordHash === digest(core)
    && Object.keys(record.current.checklist).length === DELIVERY_HEALTH_CHECKLIST_ITEMS.length
    && DELIVERY_HEALTH_CHECKLIST_ITEMS.every((item) => typeof record.current.checklist[item] === "boolean")
    && record.authority.canApprove === false && record.authority.canExecute === false
    && record.authority.canWriteMeta === false && record.authority.canEnableAutomation === false
    && record.current.recommendationDisposition === disposition(record.alert, record.current.status);
}

/** Server-private materialization of an immutable signal into an append-only operational ledger. */
export function openDeliveryHealthAlertLedger(input: Readonly<{
  alert: DeliveryHealthAlertInput;
  actorRef: string;
}>): DeliveryHealthAlertLedgerRecord {
  const alert = createDeliveryHealthAlert(input.alert);
  const event = Object.freeze({ kind: "detected" as const, actorRef: ref(input.actorRef), occurredAt: alert.detectedAt });
  const current = Object.freeze({ status: "open" as const, assignedActorRef: alert.assignedActorRef,
    checklist: checklist(), recommendationDisposition: disposition(alert, "open") });
  return finish({ version: DELIVERY_HEALTH_ALERT_LEDGER_VERSION, alert, sequence: 1,
    previousRecordHash: "GENESIS", event, current, authority: AUTHORITY });
}

/** Human workflow transition only. It never grants approval, execution or Meta-write authority. */
export function transitionDeliveryHealthAlertLedger(input: Readonly<{
  head: DeliveryHealthAlertLedgerRecord;
  expectedRecordHash: string;
  actorRef: string;
  occurredAt: string;
  command: DeliveryHealthAlertCommand;
}>): DeliveryHealthAlertLedgerRecord {
  if (!validRecord(input.head)) throw new DeliveryHealthAlertLedgerError("corrupt_ledger");
  if (!HASH.test(input.expectedRecordHash) || input.expectedRecordHash !== input.head.recordHash) {
    throw new DeliveryHealthAlertLedgerError("stale_head");
  }
  const actorRef = ref(input.actorRef);
  const occurredAt = instant(input.occurredAt);
  if (Date.parse(occurredAt) < Date.parse(input.head.event.occurredAt)) throw new DeliveryHealthAlertLedgerError("invalid_transition");
  const command = input.command;
  let status = input.head.current.status;
  let assignedActorRef = input.head.current.assignedActorRef;
  const nextChecklist = { ...input.head.current.checklist };
  if (command.kind === "assign") assignedActorRef = ref(command.assignedActorRef);
  else if (command.kind === "start_investigation") {
    if (status !== "open") throw new DeliveryHealthAlertLedgerError("invalid_transition");
    status = "investigating";
  } else if (command.kind === "set_checklist_item") {
    if (status === "resolved" || !DELIVERY_HEALTH_CHECKLIST_ITEMS.includes(command.item)) {
      throw new DeliveryHealthAlertLedgerError("invalid_transition");
    }
    nextChecklist[command.item] = command.completed;
    if (status === "open") status = "investigating";
  } else if (command.kind === "resolve") {
    if (status === "resolved" || DELIVERY_HEALTH_CHECKLIST_ITEMS.some((item) => !nextChecklist[item])) {
      throw new DeliveryHealthAlertLedgerError("invalid_transition");
    }
    status = "resolved";
  } else if (command.kind === "reopen") {
    if (status !== "resolved") throw new DeliveryHealthAlertLedgerError("invalid_transition");
    status = "investigating";
  } else throw new DeliveryHealthAlertLedgerError("invalid_input");
  const event = Object.freeze({ kind: command.kind, actorRef, occurredAt });
  const current = Object.freeze({ status, assignedActorRef, checklist: checklist(nextChecklist),
    recommendationDisposition: disposition(input.head.alert, status) });
  return finish({ version: DELIVERY_HEALTH_ALERT_LEDGER_VERSION, alert: input.head.alert,
    sequence: input.head.sequence + 1, previousRecordHash: input.head.recordHash, event, current, authority: AUTHORITY });
}

export function verifyDeliveryHealthAlertLedger(records: readonly DeliveryHealthAlertLedgerRecord[]): boolean {
  if (records.length < 1) return false;
  const first = records[0]!;
  return records.every((record, index) => {
    const previous = records[index - 1];
    return validRecord(record)
      && record.sequence === index + 1
      && record.previousRecordHash === (previous?.recordHash ?? "GENESIS")
      && record.alert.alertHash === first.alert.alertHash
      && record.alert.workspaceRef === first.alert.workspaceRef
      && record.alert.alertRef === first.alert.alertRef
      && (index === 0 || record.sequence === previous!.sequence + 1);
  });
}
