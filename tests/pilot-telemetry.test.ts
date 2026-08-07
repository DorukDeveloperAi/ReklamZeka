import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAttestedFieldPilotReport, validateFieldPilotTelemetryInput } from "@/pilot/field-input";
import type { PilotWorkspace } from "@/pilot/report";
import {
  buildPilotWorkspacesFromTelemetry,
  PilotTelemetryValidationError,
  validatePilotTelemetryEvents,
  type PilotTelemetryEvent,
} from "@/pilot/telemetry";

const asOf = "2026-08-06T12:00:00Z";
const pilotFixture = JSON.parse(readFileSync(new URL("./fixtures/pilot.json", import.meta.url), "utf8")) as PilotWorkspace[];
const events: readonly PilotTelemetryEvent[] = [
  { eventId: "evt-01", type: "account_connected", workspaceId: "workspace-01", accountId: "account-01", occurredAt: "2026-08-06T11:30:00Z" },
  { eventId: "evt-02", type: "dashboard_verified", workspaceId: "workspace-01", accountId: "account-01", occurredAt: "2026-08-06T11:40:00Z" },
  { eventId: "evt-03", type: "sync_completed", workspaceId: "workspace-01", accountId: "account-01", occurredAt: "2026-08-06T11:55:00Z" },
  { eventId: "evt-04", type: "account_connected", workspaceId: "workspace-01", accountId: "account-02", occurredAt: "2026-08-06T11:20:00Z" },
  { eventId: "evt-05", type: "dashboard_verified", workspaceId: "workspace-01", accountId: "account-02", occurredAt: "2026-08-06T11:32:00Z" },
  { eventId: "evt-06", type: "sync_completed", workspaceId: "workspace-01", accountId: "account-02", occurredAt: "2026-08-06T11:50:00Z" },
  { eventId: "evt-07", type: "insight_feedback", workspaceId: "workspace-01", value: "helpful", occurredAt: "2026-08-06T11:45:00Z" },
  { eventId: "evt-08", type: "security_incident_opened", workspaceId: "workspace-01", incidentId: "incident-01", severity: "critical", occurredAt: "2026-08-06T11:10:00Z" },
  { eventId: "evt-09", type: "security_incident_resolved", workspaceId: "workspace-01", incidentId: "incident-01", occurredAt: "2026-08-06T11:15:00Z" },
] as const;

function telemetryInput(inputEvents: readonly PilotTelemetryEvent[] = events) {
  return {
    schemaVersion: 1 as const,
    mode: "field_pilot" as const,
    asOf,
    attestation: {
      preparedBy: "pilot-operations",
      preparedAt: "2026-08-06T12:05:00Z",
      sourceDescription: "Anonymized production telemetry export",
      confirmsRealAccounts: true as const,
    },
    events: inputEvents,
  };
}

function eventsFromAggregate(workspaces: readonly PilotWorkspace[]): readonly PilotTelemetryEvent[] {
  const result: PilotTelemetryEvent[] = [];
  let sequence = 0;
  const eventId = () => `generated-${String(++sequence).padStart(3, "0")}`;
  for (const workspace of workspaces) {
    for (const account of workspace.accounts) {
      result.push(
        { eventId: eventId(), type: "account_connected", workspaceId: workspace.id, accountId: account.id, occurredAt: account.connectedAt },
        { eventId: eventId(), type: "dashboard_verified", workspaceId: workspace.id, accountId: account.id, occurredAt: account.firstDashboardAt },
        { eventId: eventId(), type: "sync_completed", workspaceId: workspace.id, accountId: account.id, occurredAt: account.lastSyncedAt },
      );
    }
    for (const value of ["helpful", "unhelpful", "acted"] as const) {
      for (let count = 0; count < workspace.feedback[value]; count += 1) {
        result.push({ eventId: eventId(), type: "insight_feedback", workspaceId: workspace.id, value, occurredAt: "2026-08-06T11:58:00Z" });
      }
    }
    for (let count = 0; count < workspace.openCriticalSecurityIncidents; count += 1) {
      result.push({ eventId: eventId(), type: "security_incident_opened", workspaceId: workspace.id, incidentId: `critical-${workspace.id}-${count}`, severity: "critical", occurredAt: "2026-08-06T11:59:00Z" });
    }
  }
  return result;
}

describe("field pilot telemetry", () => {
  it("builds deterministic aggregate measurements from unordered idempotent events", () => {
    const ordered = buildPilotWorkspacesFromTelemetry(events, asOf);
    const shuffledWithDuplicate = buildPilotWorkspacesFromTelemetry([...events].reverse().concat(events[0]!), asOf);
    expect(shuffledWithDuplicate).toEqual(ordered);
    expect(ordered).toEqual([{
      id: "workspace-01",
      accounts: [
        { id: "account-01", connectedAt: "2026-08-06T11:30:00Z", firstDashboardAt: "2026-08-06T11:40:00Z", lastSyncedAt: "2026-08-06T11:55:00Z" },
        { id: "account-02", connectedAt: "2026-08-06T11:20:00Z", firstDashboardAt: "2026-08-06T11:32:00Z", lastSyncedAt: "2026-08-06T11:50:00Z" },
      ],
      feedback: { helpful: 1, unhelpful: 0, acted: 0 },
      openCriticalSecurityIncidents: 0,
    }]);
  });

  it("feeds the attested field report without exposing raw events", () => {
    const result = buildAttestedFieldPilotReport(telemetryInput());
    expect(result.report).toMatchObject({
      mode: "field_pilot",
      workspaceCount: 1,
      accountCount: 2,
      medianActivationMinutes: 11,
      freshWithin60MinutesRate: 1,
      openCriticalSecurityIncidents: 0,
      verdict: "fail",
    });
    expect(result.provenance.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty("events");
  });

  it("preserves the declared 3-workspace/10-account readiness verdict through telemetry", () => {
    const result = buildAttestedFieldPilotReport(telemetryInput(eventsFromAggregate(pilotFixture)));
    expect(result.report).toMatchObject({
      mode: "field_pilot",
      workspaceCount: 3,
      accountCount: 10,
      freshWithin60MinutesRate: 1,
      medianActivationMinutes: 10.5,
      usefulOrActedRate: 0.75,
      openCriticalSecurityIncidents: 0,
      verdict: "pass",
    });
  });

  it("rejects PII-shaped identifiers, extra fields and incomplete account sequences", () => {
    expect(() => validatePilotTelemetryEvents([{
      eventId: "evt-10",
      type: "account_connected",
      workspaceId: "client@example.com",
      accountId: "account-01",
      occurredAt: "2026-08-06T11:00:00Z",
      email: "client@example.com",
    }], asOf)).toThrow(PilotTelemetryValidationError);

    expect(() => buildPilotWorkspacesFromTelemetry(events.filter((event) => event.eventId !== "evt-03"), asOf))
      .toThrow(/sync_completed eksik/);
  });

  it("rejects ambiguous aggregate plus event input and conflicting event IDs", () => {
    expect(() => validateFieldPilotTelemetryInput({ ...telemetryInput(), workspaces: [] })).toThrow(/birlikte kullanılamaz/);
    expect(() => buildPilotWorkspacesFromTelemetry([
      events[0]!,
      { ...events[1]!, eventId: events[0]!.eventId },
    ], asOf)).toThrow(/eventId çakışması/);
  });
});
