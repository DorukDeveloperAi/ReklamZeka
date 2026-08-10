import { describe, expect, it } from "vitest";
import { MetaInsightMaterializationError, parseMetaInsightPage } from "@/connectors/meta/sync/insights-materialization";

function input() {
  return {
    workspaceId: "workspace-a", connectionId: "connection-a", adAccountId: "account-a", externalAccountId: "act_123",
    entityLevel: "campaign" as const, parentRunId: "run-a", sliceId: "slice-a", cursorId: "cursor-a",
    observedAt: "2026-08-10T12:00:00.000Z", currency: "TRY", timezone: "Europe/Istanbul", minorUnitScale: 2,
    records: [{ account_id: "act_123", campaign_id: "campaign-a", date_start: "2026-08-09", date_stop: "2026-08-09",
      spend: "12.50", impressions: "100", reach: "90", clicks: "4",
      actions: [{ action_type: "lead", value: "2" }], action_values: [{ action_type: "purchase", value: "25.00" }] }],
  };
}

describe("canonical Meta insight page", () => {
  it("derives stable hash-only canonical metrics without retaining the raw page", () => {
    const first = parseMetaInsightPage(input());
    const replay = parseMetaInsightPage(input());
    expect(replay).toEqual(first);
    expect(first.records[0]).toMatchObject({ externalEntityId: "campaign-a", dateStart: "2026-08-09", currency: "TRY" });
    expect(first.records[0]?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricKey: "spend", valueMinor: 1250 }),
      expect.objectContaining({ metricKey: "actions", actionType: "lead", valueDecimal: "2" }),
      expect.objectContaining({ metricKey: "action_values", actionType: "purchase", valueMinor: 2500 }),
    ]));
    expect(JSON.stringify(first)).not.toContain('"rawPayload"');
  });

  it("rejects foreign account, malformed page, and duplicate canonical identities", () => {
    expect(() => parseMetaInsightPage({ ...input(), records: [{ ...input().records[0], account_id: "act_other" }] })).toThrowError(MetaInsightMaterializationError);
    expect(() => parseMetaInsightPage({ ...input(), records: [{ ...input().records[0], spend: "not-a-number" }, input().records[0] as never] })).toThrowError(MetaInsightMaterializationError);
  });
});
