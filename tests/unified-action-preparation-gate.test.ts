import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACTION_PREPARATION_FLAG, publicActionPreparationFlag } from "@/domain/actions/action-preparation-flag";

describe("unified action preparation gate", () => {
  it("keeps the server-owned flag visible but compile/runtime disabled", () => {
    expect(ACTION_PREPARATION_FLAG).toMatchObject({ key: "action_preparation", enabled: false, source: "server_owned_static" });
    expect(publicActionPreparationFlag()).toEqual({ visible: true, enabled: false, reason: "server_disabled" });
  });

  it("rechecks one frozen domestic/international and delivery gate at every protected stage", () => {
    const gate = readFileSync("src/connectors/campaigns/unified-action-preparation-gate.ts", "utf8");
    const selection = readFileSync("src/connectors/campaigns/slice-rule-scenario-allocation-selection-drizzle-repository.ts", "utf8");
    const materializer = readFileSync("src/connectors/campaigns/slice-rule-budget-action-unit-materializer.ts", "utf8");
    const approval = readFileSync("src/connectors/actions/action-approval-decision-drizzle-repository.ts", "utf8");
    const admission = readFileSync("src/connectors/actions/action-execution-admission-drizzle-repository.ts", "utf8");
    expect(gate).toContain("FrozenContextBudgetImpactScopeResolver");
    expect(gate).toContain("delivery_health_alert_ledger_records");
    expect(gate).toContain("DrizzleMetaDataHealthAdapter");
    expect(gate).toContain("dataHealthReportHash");
    expect(gate).toContain("observations: input.result.dataHealthReport.observations");
    expect(gate).toContain("observations.length > 2_001");
    expect(selection).toContain('stage: "selection"');
    expect(materializer).toContain('stage: "materialization"');
    expect(approval).toContain('stage: "approval"');
    expect(admission).toContain('stage: "admission"');
  });

  it("does not let flag false block selection, materialization or approval, only admission", () => {
    const materializer = readFileSync("src/connectors/campaigns/slice-rule-budget-action-unit-materializer.ts", "utf8");
    const approval = readFileSync("src/connectors/actions/action-approval-decision-drizzle-repository.ts", "utf8");
    const admission = readFileSync("src/connectors/actions/action-execution-admission-drizzle-repository.ts", "utf8");
    expect(materializer).not.toContain("admissionEnabled");
    expect(approval).not.toContain("admissionEnabled");
    expect(admission).toContain("if (!gate.dataHealthReady || !gate.admissionEnabled)");
    expect(admission).toContain('outcome: "blocked" as const');
  });

  it("stores private append-only snapshots and exposes only the safe flag projection", () => {
    const migration = readFileSync("drizzle/20260814131319_tense_lucky_pierre.sql", "utf8");
    const http = readFileSync("src/server/slice-rule-budget-action-unit-http.ts", "utf8");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE \"action_preparation_gate_snapshots\"");
    expect(migration).toContain("action_preparation_gate_snapshot_append_only_guard");
    expect(http).toContain("publicActionPreparationFlag()");
    expect(http).not.toMatch(/fetch\(|graph\.facebook|meta.*dispatch/i);
  });
});
