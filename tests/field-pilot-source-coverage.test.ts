import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateFieldPilotSourceCoverage } from "@/pilot/field-pilot-source-coverage";

describe("field-pilot source coverage census", () => {
  it("never treats missing telemetry or attestation as a field-pilot pass", () => {
    const census = evaluateFieldPilotSourceCoverage({
      accountInventory: { workspaceCount: 3, accountCount: 10 },
      freshSync: { workspaceCount: 3, accountCount: 10 },
      feedback: { workspaceCount: 3 },
    });
    expect(census.sourceBackedCriteriaComplete).toBe(true);
    expect(census.eligibleForFieldPilotAttestation).toBe(true);
    expect(census.families).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: "activation", available: false, missingReason: "dashboard_verified_telemetry_not_persisted_in_postgres" }),
      expect.objectContaining({ family: "security_incidents", available: false }),
      expect.objectContaining({ family: "attestation", available: false }),
    ]));
  });

  it("requires complete real inventory, fresh sync and feedback coverage", () => {
    const census = evaluateFieldPilotSourceCoverage({
      accountInventory: { workspaceCount: 3, accountCount: 10 },
      freshSync: { workspaceCount: 2, accountCount: 9 },
      feedback: { workspaceCount: 2 },
    });
    expect(census.sourceBackedCriteriaComplete).toBe(false);
    expect(census.families.find((family) => family.family === "freshness")).toMatchObject({ available: false });
    expect(census.families.find((family) => family.family === "feedback")).toMatchObject({ available: false });
  });

  it("uses one aggregate-only repeatable-read read-only query", () => {
    const script = readFileSync("scripts/census-field-pilot-source-coverage-postgres.ts", "utf8");
    expect(script).toContain("begin transaction isolation level repeatable read read only");
    expect(script).toContain("statement_timestamp() - interval '60 minutes'");
    expect(script).not.toMatch(/\b(?:insert|update|delete|truncate|alter|create|drop)\b/i);
    expect(script).not.toMatch(/external_account_id|display_name|secret|token|workspace_id.*console|account_id.*console/i);
  });
});
