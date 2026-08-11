import { describe, expect, it } from "vitest";

import { a10CohortSyncFixtureRecords } from "../scripts/support/a10-cohort-sync-fixture";
import { metaChangeSnapshotInputFromStoredAccount } from "@/connectors/meta/sync/change-snapshot-drizzle-adapter";
import { normalizeMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";

const root = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222",
  adAccountId: "33333333-3333-4333-8333-333333333333",
  externalAccountId: "act_a10_fixture",
} as const;

describe("A10 cohort normal-sync fixture definition", () => {
  it("defines five campaign/ad-set/L1 members with one explicit incompatible comparator", () => {
    const records = a10CohortSyncFixtureRecords({ root, parentRunId: "a10_cohort_sync_test" });

    expect(records.campaigns).toHaveLength(5);
    expect(records.adSets).toHaveLength(5);
    expect(records.insights).toHaveLength(5);
    expect(new Set(records.campaigns.map((record) => record.id)).size).toBe(5);
    expect(records.adSets.map((record) => record.campaign_id)).toEqual(records.campaigns.map((record) => record.id));
    expect(records.insights.map((record) => record.campaign_id)).toEqual(records.campaigns.map((record) => record.id));
    expect(records.campaigns.slice(0, 4).every((record) => record.objective === "OUTCOME_LEADS")).toBe(true);
    expect(records.campaigns[4]?.objective).toBe("OUTCOME_AWARENESS");
  });

  it("forms a canonical five-campaign snapshot input without raw source payloads", () => {
    const records = a10CohortSyncFixtureRecords({ root, parentRunId: "a10_cohort_sync_snapshot" });
    const snapshotInput = metaChangeSnapshotInputFromStoredAccount({
      workspaceId: root.workspaceId,
      connectionId: root.connectionId,
      externalAccountId: root.externalAccountId,
      capturedAt: "2026-08-10T12:00:00.000Z",
    }, [{
      workspaceId: root.workspaceId,
      connectionId: root.connectionId,
      internalAccountId: root.adAccountId,
      externalAccountId: root.externalAccountId,
      campaigns: records.campaigns.map((record, index) => ({
        workspaceId: root.workspaceId,
        internalAdAccountId: root.adAccountId,
        internalCampaignId: `campaign-${index + 1}`,
        externalCampaignId: record.id,
        configuredStatus: record.status,
        effectiveStatus: record.effective_status,
        campaignBudgetOptimization: true,
        dailyBudgetMinor: Number(record.daily_budget),
        lifetimeBudgetMinor: null,
        unsupportedFields: [],
        provenance: { knownNullFields: ["lifetime_budget_minor"] },
      })),
      adSets: records.adSets.map((record, index) => ({
        workspaceId: root.workspaceId,
        internalAdAccountId: root.adAccountId,
        internalAdSetId: `adset-${index + 1}`,
        internalCampaignId: `campaign-${index + 1}`,
        externalAdSetId: record.id,
        configuredStatus: record.status,
        effectiveStatus: record.effective_status,
        dailyBudgetMinor: Number(record.daily_budget),
        lifetimeBudgetMinor: null,
        targetingSignature: null,
        unsupportedFields: [],
        provenance: { knownNullFields: ["lifetime_budget_minor", "targeting_signature"] },
      })),
      ads: [], creatives: [], bindings: [],
    }]);
    expect(snapshotInput.campaigns).toHaveLength(5);
    expect(snapshotInput.adSets).toHaveLength(5);
    expect(normalizeMetaChangeSnapshot(snapshotInput).snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
