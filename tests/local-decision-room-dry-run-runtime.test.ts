import { describe, expect, it } from "vitest";
import { localDecisionRoomDryRunConfig } from "@/server/local-decision-room-dry-run-runtime";

const environment = {
  DATABASE_URL: "postgresql://server-only.invalid/database", REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000", REKLAMZEKA_LOCAL_WORKSPACE_ID: "11111111-1111-4111-8111-111111111111",
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local", REKLAMZEKA_LOCAL_USER_ID: "22222222-2222-4222-8222-222222222222",
  REKLAMZEKA_LOCAL_READER_REF: "reader_local", REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: Buffer.alloc(32, 9).toString("base64"),
};

describe("local Decision Room dry-run config", () => {
  it("requires an explicit operator settlement policy and canonical cutoff date", () => {
    expect(localDecisionRoomDryRunConfig(environment)).toBeNull();
    expect(localDecisionRoomDryRunConfig({ ...environment, REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF: "settlement_safe",
      REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE: "2026-08-09" })).toMatchObject({ settlementPolicyRef: "settlement_safe", settledThroughDate: "2026-08-09" });
    expect(localDecisionRoomDryRunConfig({ ...environment, REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF: "raw_policy",
      REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE: "2026-99-99" })).toBeNull();
  });
});
