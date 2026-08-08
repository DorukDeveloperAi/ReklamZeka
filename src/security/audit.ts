import { createHash, randomUUID } from "node:crypto";

export type AuditAction =
  | "connection.created"
  | "connection.rotated"
  | "connection.doctor_checked"
  | "connection.disconnected"
  | "connection.revoked"
  | "connection.inventory_refreshed"
  | "sync.started"
  | "sync.completed"
  | "report.shared"
  | "report.revoked"
  | "insight.feedback"
  | "budget.draft_saved"
  | "guidance.draft_created"
  | "guidance.draft_revised"
  | "guidance.published"
  | "guidance.archived";

export type AuditEventInput = Readonly<{
  workspaceId: string;
  actorId: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  occurredAt: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type AuditEvent = Readonly<AuditEventInput & {
  id: string;
  previousHash: string;
  eventHash: string;
}>;

function hashEvent(event: Omit<AuditEvent, "eventHash">): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

export class AppendOnlyAuditLog {
  private readonly events: AuditEvent[] = [];

  append(input: AuditEventInput): AuditEvent {
    if (!input.workspaceId || !input.actorId || !input.resourceId || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new Error("Audit aktör, çalışma alanı, kaynak ve geçerli zaman gerektirir");
    }
    const withoutHash = {
      ...input,
      metadata: input.metadata ? { ...input.metadata } : undefined,
      id: randomUUID(),
      previousHash: this.events.at(-1)?.eventHash ?? "GENESIS",
    };
    const event: AuditEvent = Object.freeze({ ...withoutHash, eventHash: hashEvent(withoutHash) });
    this.events.push(event);
    return { ...event, metadata: event.metadata ? { ...event.metadata } : undefined };
  }

  list(workspaceId: string): readonly AuditEvent[] {
    return this.events
      .filter((event) => event.workspaceId === workspaceId)
      .map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined }));
  }

  verifyIntegrity(): boolean {
    return this.events.every((event, index) => {
      const previousHash = index === 0 ? "GENESIS" : this.events[index - 1]!.eventHash;
      const { eventHash, ...withoutHash } = event;
      return event.previousHash === previousHash && eventHash === hashEvent(withoutHash);
    });
  }
}
