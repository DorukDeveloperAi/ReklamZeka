import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAttestedFieldPilotReport,
  FieldPilotValidationError,
  validateFieldPilotInput,
} from "@/pilot/field-input";
import type { PilotWorkspace } from "@/pilot/report";

const workspaces = JSON.parse(readFileSync(new URL("./fixtures/pilot.json", import.meta.url), "utf8")) as PilotWorkspace[];

function validInput() {
  return {
    schemaVersion: 1,
    mode: "field_pilot",
    asOf: "2026-08-06T12:00:00Z",
    attestation: {
      preparedBy: "Pilot operations",
      preparedAt: "2026-08-06T12:30:00Z",
      sourceDescription: "Anonymized production telemetry export",
      confirmsRealAccounts: true,
    },
    workspaces,
  } as const;
}

describe("field pilot input", () => {
  it("produces an attested field report with input provenance", () => {
    const artifact = buildAttestedFieldPilotReport(validInput());
    expect(artifact.report).toMatchObject({ mode: "field_pilot", workspaceCount: 3, accountCount: 10, verdict: "pass" });
    expect(artifact.provenance).toMatchObject({ preparedBy: "Pilot operations", confirmsRealAccounts: true });
    expect(artifact.provenance.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects fixture mode and missing real-account attestation", () => {
    expect(() => validateFieldPilotInput({ ...validInput(), mode: "fixture_readiness" })).toThrow(FieldPilotValidationError);
    expect(() => validateFieldPilotInput({
      ...validInput(),
      attestation: { ...validInput().attestation, confirmsRealAccounts: false },
    })).toThrow(/attestation/);
  });

  it("rejects duplicate account identities and impossible event order", () => {
    const invalidWorkspaces: PilotWorkspace[] = [
      workspaces[0]!,
      {
        ...workspaces[1]!,
        accounts: [
          { ...workspaces[1]!.accounts[0]!, id: workspaces[0]!.accounts[0]!.id, firstDashboardAt: "2026-08-06T08:00:00Z" },
          ...workspaces[1]!.accounts.slice(1),
        ],
      },
      workspaces[2]!,
    ];
    expect(() => validateFieldPilotInput({ ...validInput(), workspaces: invalidWorkspaces })).toThrow(/yinelenen account id/);
  });
});
