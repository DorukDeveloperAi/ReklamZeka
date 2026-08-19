import { describe, expect, it } from "vitest";

import { DrizzleMetaDataHealthAdapter, MetaDataHealthAdapterError } from "@/connectors/meta/data-health-drizzle-adapter";
import { metaPublicReference } from "@/domain/meta/public-reference";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const otherAccountId = "33333333-3333-4333-8333-333333333333";
const evaluatedAt = "2026-08-17T12:00:00.000Z";
const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];
function row(overrides: Record<string, unknown> = {}) { return { account_id: accountId, currency: "TRY",
  mirror_at: evaluatedAt, campaign_count: "1", ad_set_count: "1", targeting_count: "1", creative_content_count: "1",
  creative_count: "1",
  observed_dates: dates, performance_at: evaluatedAt, completed_streams: ["creative", "insights", "inventory"],
  stream_count: "3", trust_at: evaluatedAt, ...overrides }; }
function adapter(source: readonly Record<string, unknown>[]) {
  return new DrizzleMetaDataHealthAdapter({ execute: async () => ({ rows: source }) });
}

describe("production Meta data health adapter", () => {
  it("builds ready canonical health with server-derived target scope", async () => {
    const result = await adapter([row()]).evaluate({ workspaceId, targetAdAccountId: accountId, evaluatedAt });
    expect(result.report).toMatchObject({ state: "ready", observations: [], gate: { analysisMayRecord: true,
      actionStagingAllowed: true, actionDispatchDataHealthReady: true } });
    expect(result.targetAccountRef).toBe(metaPublicReference("account", workspaceId, accountId));
  });

  it("uses evaluatedAt max-age and preserves exact missing dates and fields", async () => {
    const result = await adapter([row({ mirror_at: "2026-08-15T00:00:00.000Z", targeting_count: "0",
      observed_dates: dates.slice(0, 2) })]).evaluate({ workspaceId, targetAdAccountId: accountId, evaluatedAt });
    expect(result.report.state).toBe("partial");
    expect(result.report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "source_stale", sourceKind: "canonical_meta_mirror" }),
      expect.objectContaining({ code: "required_dates_missing", missingDates: dates.slice(2) }),
      expect.objectContaining({ code: "required_fields_missing", missingFields: ["targeting"] }),
    ]));
    expect(JSON.stringify(result)).not.toMatch(/raw_payload|access_token|graph\.facebook/i);
  });

  it("requires full targeting/creative coverage and treats a campaign-less account as empty", async () => {
    const partial = await adapter([row({ ad_set_count: "2", targeting_count: "1", creative_count: "2",
      creative_content_count: "1" })]).evaluate({ workspaceId, targetAdAccountId: accountId, evaluatedAt });
    expect(partial.report.accounts[0]).toMatchObject({ state: "partial", missingFields: ["creative_content", "targeting"] });
    const empty = await adapter([row({ campaign_count: "0", ad_set_count: "0", targeting_count: "0",
      creative_count: "0", creative_content_count: "0" })]).evaluate({ workspaceId, targetAdAccountId: accountId, evaluatedAt });
    expect(empty.report.accounts[0]?.state).toBe("empty");
    expect(empty.report.gate.analysisMayRecord).toBe(true);
  });

  it("excludes currency mismatch and rejects foreign target accounts", async () => {
    const result = await adapter([row(), row({ account_id: otherAccountId, currency: "USD" })])
      .evaluate({ workspaceId, targetAdAccountId: otherAccountId, evaluatedAt });
    expect(result.report.gate.actionStagingAllowed).toBe(false);
    expect(result.report.excludedMonetaryAccountRefs).toContain(metaPublicReference("account", workspaceId, otherAccountId));
    await expect(adapter([row()]).evaluate({ workspaceId, targetAdAccountId: otherAccountId, evaluatedAt }))
      .rejects.toMatchObject({ code: "workspace_scope_mismatch" } satisfies Partial<MetaDataHealthAdapterError>);
  });

  it("fails closed with the typed store error for an invalid persisted timestamp", async () => {
    await expect(adapter([row({ mirror_at: "not-an-instant" })])
      .evaluate({ workspaceId, targetAdAccountId: accountId, evaluatedAt }))
      .rejects.toMatchObject({ code: "corrupt_store" } satisfies Partial<MetaDataHealthAdapterError>);
  });
});
