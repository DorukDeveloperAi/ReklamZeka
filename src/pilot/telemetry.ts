import type { PilotWorkspace } from "./report";

type PilotTelemetryBase = Readonly<{
  eventId: string;
  workspaceId: string;
  occurredAt: string;
}>;

export type PilotTelemetryEvent =
  | (PilotTelemetryBase & Readonly<{ type: "account_connected"; accountId: string }>)
  | (PilotTelemetryBase & Readonly<{ type: "dashboard_verified"; accountId: string }>)
  | (PilotTelemetryBase & Readonly<{ type: "sync_completed"; accountId: string }>)
  | (PilotTelemetryBase & Readonly<{ type: "insight_feedback"; value: "helpful" | "unhelpful" | "acted" }>)
  | (PilotTelemetryBase & Readonly<{
    type: "security_incident_opened";
    incidentId: string;
    severity: "info" | "warning" | "critical";
  }>)
  | (PilotTelemetryBase & Readonly<{ type: "security_incident_resolved"; incidentId: string }>);

const EVENT_TYPES = new Set<PilotTelemetryEvent["type"]>([
  "account_connected",
  "dashboard_verified",
  "sync_completed",
  "insight_feedback",
  "security_incident_opened",
  "security_incident_resolved",
]);
const FEEDBACK_VALUES = new Set(["helpful", "unhelpful", "acted"]);
const SEVERITIES = new Set(["info", "warning", "critical"]);
const ANONYMOUS_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/i;

export class PilotTelemetryValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Pilot telemetrisi geçersiz: ${issues.join("; ")}`);
    this.name = "PilotTelemetryValidationError";
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function anonymousId(value: unknown): value is string {
  return typeof value === "string" && ANONYMOUS_ID.test(value);
}

function allowedKeys(type: PilotTelemetryEvent["type"]): ReadonlySet<string> {
  const common = ["eventId", "workspaceId", "occurredAt", "type"];
  if (type === "account_connected" || type === "dashboard_verified" || type === "sync_completed") {
    return new Set([...common, "accountId"]);
  }
  if (type === "insight_feedback") return new Set([...common, "value"]);
  if (type === "security_incident_opened") return new Set([...common, "incidentId", "severity"]);
  return new Set([...common, "incidentId"]);
}

export function validatePilotTelemetryEvents(value: unknown, asOf: string): readonly PilotTelemetryEvent[] {
  if (!Array.isArray(value)) throw new PilotTelemetryValidationError(["events dizi olmalı"]);
  if (!validTimestamp(asOf)) throw new PilotTelemetryValidationError(["asOf geçerli ISO zaman olmalı"]);

  const issues: string[] = [];
  const events: PilotTelemetryEvent[] = [];
  for (const [index, raw] of value.entries()) {
    const prefix = `events[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(`${prefix} nesne olmalı`);
      continue;
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.type !== "string" || !EVENT_TYPES.has(item.type as PilotTelemetryEvent["type"])) {
      issues.push(`${prefix}.type desteklenmiyor`);
      continue;
    }
    const type = item.type as PilotTelemetryEvent["type"];
    const extras = Object.keys(item).filter((key) => !allowedKeys(type).has(key));
    if (extras.length > 0) issues.push(`${prefix} beklenmeyen alan taşıyor: ${extras.join(", ")}`);
    if (!anonymousId(item.eventId)) issues.push(`${prefix}.eventId anonim kimlik formatında olmalı`);
    if (!anonymousId(item.workspaceId)) issues.push(`${prefix}.workspaceId anonim kimlik formatında olmalı`);
    if (!validTimestamp(item.occurredAt)) issues.push(`${prefix}.occurredAt geçerli ISO zaman olmalı`);
    else if (Date.parse(item.occurredAt) > Date.parse(asOf)) issues.push(`${prefix}.occurredAt asOf sonrasında olamaz`);

    if (type === "account_connected" || type === "dashboard_verified" || type === "sync_completed") {
      if (!anonymousId(item.accountId)) issues.push(`${prefix}.accountId anonim kimlik formatında olmalı`);
      else if (anonymousId(item.eventId) && anonymousId(item.workspaceId) && validTimestamp(item.occurredAt)) {
        events.push({ type, eventId: item.eventId, workspaceId: item.workspaceId, occurredAt: item.occurredAt, accountId: item.accountId });
      }
    } else if (type === "insight_feedback") {
      if (typeof item.value !== "string" || !FEEDBACK_VALUES.has(item.value)) issues.push(`${prefix}.value geçersiz`);
      else if (anonymousId(item.eventId) && anonymousId(item.workspaceId) && validTimestamp(item.occurredAt)) {
        events.push({ type, eventId: item.eventId, workspaceId: item.workspaceId, occurredAt: item.occurredAt, value: item.value as "helpful" | "unhelpful" | "acted" });
      }
    } else if (type === "security_incident_opened") {
      if (!anonymousId(item.incidentId)) issues.push(`${prefix}.incidentId anonim kimlik formatında olmalı`);
      if (typeof item.severity !== "string" || !SEVERITIES.has(item.severity)) issues.push(`${prefix}.severity geçersiz`);
      if (anonymousId(item.eventId) && anonymousId(item.workspaceId) && validTimestamp(item.occurredAt)
        && anonymousId(item.incidentId) && typeof item.severity === "string" && SEVERITIES.has(item.severity)) {
        events.push({ type, eventId: item.eventId, workspaceId: item.workspaceId, occurredAt: item.occurredAt, incidentId: item.incidentId, severity: item.severity as "info" | "warning" | "critical" });
      }
    } else {
      if (!anonymousId(item.incidentId)) issues.push(`${prefix}.incidentId anonim kimlik formatında olmalı`);
      else if (anonymousId(item.eventId) && anonymousId(item.workspaceId) && validTimestamp(item.occurredAt)) {
        events.push({ type, eventId: item.eventId, workspaceId: item.workspaceId, occurredAt: item.occurredAt, incidentId: item.incidentId });
      }
    }
  }
  if (issues.length > 0) throw new PilotTelemetryValidationError(issues);
  return events;
}

type AccountState = {
  connectedAt?: string;
  firstDashboardAt?: string;
  lastSyncedAt?: string;
};

type WorkspaceState = {
  accounts: Map<string, AccountState>;
  feedback: { helpful: number; unhelpful: number; acted: number };
  openIncidents: Map<string, "info" | "warning" | "critical">;
};

function workspaceState(states: Map<string, WorkspaceState>, workspaceId: string): WorkspaceState {
  let state = states.get(workspaceId);
  if (!state) {
    state = { accounts: new Map(), feedback: { helpful: 0, unhelpful: 0, acted: 0 }, openIncidents: new Map() };
    states.set(workspaceId, state);
  }
  return state;
}

export function buildPilotWorkspacesFromTelemetry(
  events: readonly PilotTelemetryEvent[],
  asOf: string,
): readonly PilotWorkspace[] {
  const issues: string[] = [];
  const deduplicated = new Map<string, PilotTelemetryEvent>();
  for (const event of events) {
    const existing = deduplicated.get(event.eventId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
      issues.push(`eventId çakışması: ${event.eventId}`);
    } else if (!existing) deduplicated.set(event.eventId, event);
  }
  if (issues.length > 0) throw new PilotTelemetryValidationError(issues);

  const states = new Map<string, WorkspaceState>();
  const ordered = [...deduplicated.values()].sort((left, right) =>
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  for (const event of ordered) {
    const workspace = workspaceState(states, event.workspaceId);
    if (event.type === "insight_feedback") {
      workspace.feedback[event.value] += 1;
      continue;
    }
    if (event.type === "security_incident_opened") {
      const current = workspace.openIncidents.get(event.incidentId);
      if (current && current !== event.severity) issues.push(`incident severity çakışması: ${event.incidentId}`);
      else workspace.openIncidents.set(event.incidentId, event.severity);
      continue;
    }
    if (event.type === "security_incident_resolved") {
      if (!workspace.openIncidents.delete(event.incidentId)) issues.push(`açılışı olmayan incident çözümü: ${event.incidentId}`);
      continue;
    }
    let account = workspace.accounts.get(event.accountId);
    if (!account) {
      account = {};
      workspace.accounts.set(event.accountId, account);
    }
    if (event.type === "account_connected") {
      if (!account.connectedAt || Date.parse(event.occurredAt) < Date.parse(account.connectedAt)) account.connectedAt = event.occurredAt;
    } else if (event.type === "dashboard_verified") {
      if (!account.firstDashboardAt || Date.parse(event.occurredAt) < Date.parse(account.firstDashboardAt)) account.firstDashboardAt = event.occurredAt;
    } else if (!account.lastSyncedAt || Date.parse(event.occurredAt) > Date.parse(account.lastSyncedAt)) {
      account.lastSyncedAt = event.occurredAt;
    }
  }

  const workspaces: PilotWorkspace[] = [];
  for (const [workspaceId, state] of [...states.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const accounts = [...state.accounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([accountId, account]) => {
      if (!account.connectedAt) issues.push(`${workspaceId}/${accountId}: account_connected eksik`);
      if (!account.firstDashboardAt) issues.push(`${workspaceId}/${accountId}: dashboard_verified eksik`);
      if (!account.lastSyncedAt) issues.push(`${workspaceId}/${accountId}: sync_completed eksik`);
      if (account.connectedAt && account.firstDashboardAt && Date.parse(account.firstDashboardAt) < Date.parse(account.connectedAt)) {
        issues.push(`${workspaceId}/${accountId}: dashboard bağlantıdan önce olamaz`);
      }
      if (account.connectedAt && account.lastSyncedAt && Date.parse(account.lastSyncedAt) < Date.parse(account.connectedAt)) {
        issues.push(`${workspaceId}/${accountId}: sync bağlantıdan önce olamaz`);
      }
      return {
        id: accountId,
        connectedAt: account.connectedAt ?? asOf,
        firstDashboardAt: account.firstDashboardAt ?? asOf,
        lastSyncedAt: account.lastSyncedAt ?? asOf,
      };
    });
    workspaces.push({
      id: workspaceId,
      accounts,
      feedback: { ...state.feedback },
      openCriticalSecurityIncidents: [...state.openIncidents.values()].filter((severity) => severity === "critical").length,
    });
  }
  if (issues.length > 0) throw new PilotTelemetryValidationError(issues);
  return workspaces;
}
