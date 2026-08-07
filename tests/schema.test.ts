import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  adAccounts,
  adCampaigns,
  auditEvents,
  connectionSecrets,
  dailyAdMetrics,
  dataSources,
  insightFeedback,
  insights,
  memberships,
  operationalEvents,
  reportShares,
  syncRuns,
  users,
  workspaces,
} from "@/db/schema";

describe("initial database contract", () => {
  it("keeps tenant-bearing entities explicit", () => {
    expect([
      users,
      workspaces,
      memberships,
      dataSources,
      adAccounts,
      adCampaigns,
      dailyAdMetrics,
      syncRuns,
      connectionSecrets,
      auditEvents,
      insights,
      insightFeedback,
      reportShares,
      operationalEvents,
    ].map(getTableName)).toEqual([
      "users",
      "workspaces",
      "memberships",
      "data_sources",
      "ad_accounts",
      "ad_campaigns",
      "daily_ad_metrics",
      "sync_runs",
      "connection_secrets",
      "audit_events",
      "insights",
      "insight_feedback",
      "report_shares",
      "operational_events",
    ]);
  });
});
