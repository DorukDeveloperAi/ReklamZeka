import type { DeliveryHealthAlertInput } from "@/domain/meta/delivery-health-alert";
import {
  openDeliveryHealthAlertLedger,
  type DeliveryHealthAlertCommand,
  type DeliveryHealthAlertLedgerRecord,
} from "@/domain/meta/delivery-health-alert-ledger";
import type { WorkspaceRole } from "@/security/authorization";

export const DELIVERY_HEALTH_ALERT_LEDGER_SERVICE_VERSION = "delivery-health-alert-ledger-service/1.0.0" as const;

export type DeliveryHealthAlertLedgerPort = Readonly<{
  materialize(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; role: Exclude<WorkspaceRole, "viewer">;
    record: DeliveryHealthAlertLedgerRecord }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; record: DeliveryHealthAlertLedgerRecord }>>;
  transition(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string;
    role: Exclude<WorkspaceRole, "viewer">; alertRef: string; expectedRecordHash: string;
    occurredAt: string; command: DeliveryHealthAlertCommand }>): Promise<DeliveryHealthAlertLedgerRecord>;
  listCurrent(input: Readonly<{ workspaceId: string; actorId: string; limit?: number }>): Promise<readonly DeliveryHealthAlertLedgerRecord[]>;
}>;

const CLOSED_AUTHORITY = Object.freeze({ canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canEnableAutomation: false as const });

export function projectDeliveryHealthAlert(record: DeliveryHealthAlertLedgerRecord) {
  return Object.freeze({ schemaVersion: "public-delivery-health-alert/1.0.0" as const,
    alertRef: record.alert.alertRef, accountRef: record.alert.accountRef,
    evidence: Object.freeze({ level: record.alert.evidence.level,
      officialState: record.alert.evidence.level === "confirmed" ? record.alert.evidence.officialState : null }),
    evidenceHash: record.alert.evidenceHash, alertHash: record.alert.alertHash, sequence: record.sequence,
    recordHash: record.recordHash, status: record.current.status,
    recommendationDisposition: record.current.recommendationDisposition,
    assignedActorRef: record.current.assignedActorRef, checklist: record.current.checklist,
    detectedAt: record.alert.detectedAt, updatedAt: record.event.occurredAt, authority: CLOSED_AUTHORITY });
}

export class DeliveryHealthAlertLedgerService {
  constructor(private readonly port: DeliveryHealthAlertLedgerPort, private readonly now = () => new Date().toISOString()) {}

  /** Deliberately server-private: there is no HTTP route that accepts evidence or opens an alert. */
  async materialize(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: Exclude<WorkspaceRole, "viewer">; alert: DeliveryHealthAlertInput }>) {
    const record = openDeliveryHealthAlertLedger({ alert: input.alert, actorRef: input.actorRef });
    return this.port.materialize({ workspaceId: input.workspaceId, workspaceRef: input.workspaceRef,
      actorId: input.actorId, role: input.role, record });
  }

  transition(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string;
    role: Exclude<WorkspaceRole, "viewer">; alertRef: string; expectedRecordHash: string;
    command: DeliveryHealthAlertCommand }>) {
    return this.port.transition({ ...input, occurredAt: this.now() });
  }

  async listCurrent(input: Readonly<{ workspaceId: string; actorId: string; limit?: number }>) {
    return Object.freeze((await this.port.listCurrent(input)).map(projectDeliveryHealthAlert));
  }
}
