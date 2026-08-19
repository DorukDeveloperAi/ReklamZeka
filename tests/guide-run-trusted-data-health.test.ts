import { describe, expect, it, vi } from "vitest";
import { DrizzleGuideRunTrustedDataHealthRepository } from "@/connectors/guides/guide-run-trusted-data-health-drizzle-repository";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";
import { metaPublicReference } from "@/domain/meta/public-reference";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const accountId = "22222222-2222-4222-a222-222222222222";
const campaignId = "33333333-3333-4333-a333-333333333333";
const adSetId = "44444444-4444-4444-a444-444444444444";
const memberRef = metaPublicReference("ad_set", workspaceId, adSetId);
const at = "2026-08-18T06:00:00.000Z";
const input = {
  runRef: "guide_run_health",
  workspaceRef: canonicalGuideWorkspaceRef(workspaceId),
  guideRevisionHash: "a".repeat(64),
  sliceRef: "slice_health",
  sliceSnapshotHash: "b".repeat(64),
} as const;
const target = (members: unknown[]) => ({
  rows: [
    {
      workspace_id: workspaceId,
      evaluated_at: at,
      payload: {
        runRef: input.runRef,
        guideRevisionHash: input.guideRevisionHash,
        sliceRef: input.sliceRef,
        sliceDefinitionHash: "c".repeat(64),
        sliceSnapshotHash: input.sliceSnapshotHash,
        members,
      },
    },
  ],
});
const entity = {
  rows: [
    {
      campaign_id: campaignId,
      account_id: accountId,
      ad_set_id: adSetId,
      organization_campaign_id: null,
    },
  ],
};
function database(results: unknown[]) {
  let call = 0;
  const execute = vi.fn(async () => {
    call += 1;
    return call <= 2 ? { rows: [] } : results[call - 3];
  });
  return {
    execute,
    transaction: async (
      work: (tx: { execute: typeof execute }) => Promise<unknown>,
    ) => work({ execute }),
  };
}

describe("Guide Run trusted data health", () => {
  it("derives tenant/account only from the persisted run scope and returns bound ready evidence", async () => {
    const db = database([
      target([{ memberRef, membershipHash: "d".repeat(64) }]),
      entity,
    ]);
    const evaluate = vi.fn(async () => ({
      report: {
        workspaceCurrency: "TRY",
        reportHash: "e".repeat(64),
        accounts: [
          {
            accountRef: metaPublicReference("account", workspaceId, accountId),
            state: "ready",
            monetaryAggregationIncluded: true,
            reasonCodes: [],
          },
        ],
      },
    }));
    const result = await new DrizzleGuideRunTrustedDataHealthRepository(
      db as never,
      () => ({ evaluate }) as never,
    ).resolve(input);
    expect(result.dataQuality).toBe("ready");
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evaluate).toHaveBeenCalledWith({
      workspaceId,
      targetAdAccountId: accountId,
      evaluatedAt: at,
    });
    expect(db.execute).toHaveBeenCalledTimes(4);
  });

  it("fails closed without a mapped Meta member and never calls the health adapter", async () => {
    const db = database([
      target([
        { memberRef: "ad_set_unmapped", membershipHash: "d".repeat(64) },
      ]),
      entity,
    ]);
    const evaluate = vi.fn();
    await expect(
      new DrizzleGuideRunTrustedDataHealthRepository(
        db as never,
        () => ({ evaluate }) as never,
      ).resolve(input),
    ).resolves.toMatchObject({ dataQuality: "missing" });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("preserves a selected account stale state instead of treating it as ready", async () => {
    const db = database([
      target([{ memberRef, membershipHash: "d".repeat(64) }]),
      entity,
    ]);
    const evaluate = vi.fn(async () => ({
      report: {
        workspaceCurrency: "TRY",
        reportHash: "e".repeat(64),
        accounts: [
          {
            accountRef: metaPublicReference("account", workspaceId, accountId),
            state: "partial",
            monetaryAggregationIncluded: false,
            reasonCodes: ["source_stale"],
          },
        ],
      },
    }));
    await expect(
      new DrizzleGuideRunTrustedDataHealthRepository(
        db as never,
        () => ({ evaluate }) as never,
      ).resolve(input),
    ).resolves.toMatchObject({ dataQuality: "stale" });
  });
});
