import { createHash } from "node:crypto";
import { buildPilotReport, type PilotReport, type PilotWorkspace } from "./report";

export type FieldPilotInput = Readonly<{
  schemaVersion: 1;
  mode: "field_pilot";
  asOf: string;
  attestation: Readonly<{
    preparedBy: string;
    preparedAt: string;
    sourceDescription: string;
    confirmsRealAccounts: true;
  }>;
  workspaces: readonly PilotWorkspace[];
}>;

export type AttestedFieldPilotReport = Readonly<{
  report: PilotReport;
  provenance: FieldPilotInput["attestation"] & Readonly<{ inputSha256: string }>;
}>;

export class FieldPilotValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Field pilot verisi geçersiz: ${issues.join("; ")}`);
    this.name = "FieldPilotValidationError";
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function validateFieldPilotInput(value: unknown): FieldPilotInput {
  const issues: string[] = [];
  const input = value as Partial<FieldPilotInput>;
  if (!input || typeof input !== "object") throw new FieldPilotValidationError(["JSON nesnesi bekleniyor"]);
  if (input.schemaVersion !== 1) issues.push("schemaVersion 1 olmalı");
  if (input.mode !== "field_pilot") issues.push("mode yalnız field_pilot olabilir");
  if (!validTimestamp(input.asOf)) issues.push("asOf geçerli ISO zaman olmalı");
  if (!input.attestation || input.attestation.confirmsRealAccounts !== true) issues.push("gerçek hesap attestation'ı zorunlu");
  if (!input.attestation?.preparedBy?.trim()) issues.push("attestation.preparedBy zorunlu");
  if (!validTimestamp(input.attestation?.preparedAt)) issues.push("attestation.preparedAt geçerli olmalı");
  if (!input.attestation?.sourceDescription?.trim()) issues.push("attestation.sourceDescription zorunlu");
  if (!Array.isArray(input.workspaces)) issues.push("workspaces dizi olmalı");

  const workspaceIds = new Set<string>();
  const accountIds = new Set<string>();
  for (const [workspaceIndex, workspace] of (input.workspaces ?? []).entries()) {
    if (!workspace.id?.trim()) issues.push(`workspaces[${workspaceIndex}].id zorunlu`);
    else if (workspaceIds.has(workspace.id)) issues.push(`yinelenen workspace id: ${workspace.id}`);
    else workspaceIds.add(workspace.id);
    if (!Array.isArray(workspace.accounts)) issues.push(`${workspace.id}.accounts dizi olmalı`);
    for (const [accountIndex, account] of (workspace.accounts ?? []).entries()) {
      const prefix = `${workspace.id}.accounts[${accountIndex}]`;
      if (!account.id?.trim()) issues.push(`${prefix}.id zorunlu`);
      else if (accountIds.has(account.id)) issues.push(`yinelenen account id: ${account.id}`);
      else accountIds.add(account.id);
      for (const field of ["connectedAt", "firstDashboardAt", "lastSyncedAt"] as const) {
        if (!validTimestamp(account[field])) issues.push(`${prefix}.${field} geçersiz`);
      }
      if (validTimestamp(account.connectedAt) && validTimestamp(account.firstDashboardAt)
        && Date.parse(account.firstDashboardAt) < Date.parse(account.connectedAt)) {
        issues.push(`${prefix}.firstDashboardAt bağlantıdan önce olamaz`);
      }
      if (validTimestamp(account.lastSyncedAt) && validTimestamp(input.asOf)
        && Date.parse(account.lastSyncedAt) > Date.parse(input.asOf)) {
        issues.push(`${prefix}.lastSyncedAt asOf sonrasında olamaz`);
      }
    }
    for (const field of ["helpful", "unhelpful", "acted"] as const) {
      if (!nonNegativeInteger(workspace.feedback?.[field])) issues.push(`${workspace.id}.feedback.${field} negatif olmayan tam sayı olmalı`);
    }
    if (!nonNegativeInteger(workspace.openCriticalSecurityIncidents)) {
      issues.push(`${workspace.id}.openCriticalSecurityIncidents negatif olmayan tam sayı olmalı`);
    }
  }

  if (issues.length > 0) throw new FieldPilotValidationError(issues);
  return input as FieldPilotInput;
}

export function buildAttestedFieldPilotReport(value: unknown): AttestedFieldPilotReport {
  const input = validateFieldPilotInput(value);
  const inputSha256 = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return {
    report: buildPilotReport(input.workspaces, input.asOf, "field_pilot"),
    provenance: { ...input.attestation, inputSha256 },
  };
}
