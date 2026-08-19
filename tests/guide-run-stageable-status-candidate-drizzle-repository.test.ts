import { describe, expect, it, vi } from "vitest";
import { DrizzleGuideRunStageableStatusCandidateRepository } from "@/connectors/guides/guide-run-stageable-status-candidate-drizzle-repository";
import { guideRunMembershipEvidenceHash } from "@/domain/guides/guide-run-membership-evidence";
import { metaPublicReference } from "@/domain/meta/public-reference";
const workspaceId = "00000000-0000-4000-8000-000000000001",
  adSetId = "00000000-0000-4000-8000-000000000002",
  memberRef = metaPublicReference("ad_set", workspaceId, adSetId),
  evaluation = {
    entityRef: memberRef,
    entityLevel: "ad_set" as const,
    included: true,
    reason: "dynamic_filter" as const,
    marketEvidenceRefs: [],
    matchedDimensionIds: [],
    matchedDimensionEvidenceRefs: [],
  };
const membershipHash = guideRunMembershipEvidenceHash({
  sliceRef: "slice_status",
  revisionRef: "slice_revision_status",
  definitionHash: "b".repeat(64),
  membership: evaluation,
});
describe("stageable status candidate evidence", () => {
  it("binds one frozen/current adset and exact current status in the same RR/RO transaction", async () => {
    let query = 0;
    const execute = vi.fn(async () => {
      query += 1;
      if (query === 3)
        return {
          rows: [
            {
              workspace_id: workspaceId,
              slice_ref: "slice_status",
              market_key: "yerli",
              mode: "prepare_human_approval",
              scope_payload: {
                sliceSnapshotHash: "c".repeat(64),
                members: [{ memberRef, membershipHash }],
              },
              actions: ["status_pause"],
            },
          ],
        };
      if (query === 4)
        return {
          rows: [{ configured_status: "ACTIVE", effective_status: "ACTIVE" }],
        };
      return { rows: [] };
    });
    const scope = vi.fn(async () => ({
      sliceRef: "slice_status",
      market: { key: "yerli" },
      revisionRef: "slice_revision_status",
      definitionHash: "b".repeat(64),
      adSetIds: [adSetId],
      campaignIds: [],
      resolution: { included: [evaluation] },
    }));
    const repository = new DrizzleGuideRunStageableStatusCandidateRepository(
      { transaction: async (work: any) => work({ execute }) } as never,
      { currentSliceEvidenceInTransaction: scope } as never,
    );
    const result = await repository.load({
      runRef: "guide_run_status",
      guideRevisionHash: "a".repeat(64),
      sliceSnapshotHash: "c".repeat(64),
      member: { memberRef, membershipHash },
    });
    expect(result).toMatchObject({
      action: "status_pause",
      stageable: {
        entityRef: memberRef,
        typedAction: { fromStatus: "ACTIVE", toStatus: "PAUSED" },
      },
    });
    expect(scope).toHaveBeenCalledOnce();
    expect(execute.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
  it("returns null for stale or conflicting current status", async () => {
    let query = 0;
    const execute = vi.fn(async () => {
      query += 1;
      return query === 3
        ? {
            rows: [
              {
                workspace_id: workspaceId,
                slice_ref: "slice_status",
                market_key: "yerli",
                mode: "prepare_human_approval",
                scope_payload: {
                  sliceSnapshotHash: "c".repeat(64),
                  members: [{ memberRef, membershipHash }],
                },
                actions: ["status_pause"],
              },
            ],
          }
        : query === 4
          ? {
              rows: [
                { configured_status: "ACTIVE", effective_status: "PAUSED" },
              ],
            }
          : { rows: [] };
    });
    const repository = new DrizzleGuideRunStageableStatusCandidateRepository(
      { transaction: async (work: any) => work({ execute }) } as never,
      {
        currentSliceEvidenceInTransaction: async () =>
          ({
            sliceRef: "slice_status",
            market: { key: "yerli" },
            revisionRef: "slice_revision_status",
            definitionHash: "b".repeat(64),
            adSetIds: [adSetId],
            campaignIds: [],
            resolution: { included: [evaluation] },
          }) as never,
      },
    );
    expect(
      await repository.load({
        runRef: "guide_run_status",
        guideRevisionHash: "a".repeat(64),
        sliceSnapshotHash: "c".repeat(64),
        member: { memberRef, membershipHash },
      }),
    ).toBeNull();
  });
});
