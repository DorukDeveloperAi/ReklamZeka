import { describe, expect, it } from "vitest";
import {
  CanonicalBudgetHistoryMaterializationError,
  canonicalBudgetHistoryTransition,
  completedNormalInventoryEvidence,
} from "@/connectors/meta/sync/canonical-budget-history-materializer";
import { normalizeMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";
import { sliceId, type MetaSyncSlice } from "@/connectors/meta/sync/types";
import type { MetaSyncResult } from "@/connectors/meta/sync/runtime";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const connectionId = "22222222-2222-4222-a222-222222222222";
const accountId = "act_123456";

const inventory = (["account", "campaign", "ad_set", "ad"] as const).map((entityLevel): MetaSyncSlice => ({
  id: sliceId("inventory", accountId, entityLevel, null, null), stream: "inventory", accountId, entityLevel,
  dateStart: null, dateStop: null, pageSize: 100,
}));

function result(updatedAt = "2026-08-17T10:00:00.000Z"): MetaSyncResult {
  return {
    parentRun: { id: "normal", workspaceId, connectionId, status: "completed", streamRunIds: ["inventory"] },
    streamRuns: [{ id: "inventory", parentRunId: "normal", stream: "inventory", accountId, status: "completed",
      completedSliceIds: inventory.map((slice) => slice.id),
      cursorBySlice: Object.fromEntries(inventory.map((slice) => [slice.id, { cursor: null, cursorId: `cursor-${slice.entityLevel}`, updatedAt }])), error: null }],
    inserted: 0, updated: 0, unchanged: 0, writeNetworkCalls: 0,
  };
}

describe("completed normal inventory evidence", () => {
  it("uses the terminal durable cursor only", () => {
    expect(completedNormalInventoryEvidence({ result: result(), plan: inventory, mode: "normal", recovery: false }))
      .toEqual({ workspaceId, connectionId, parentRunRef: "normal", accounts: [{ externalAccountId: accountId, capturedAt: "2026-08-17T10:00:00.000Z" }] });
  });

  it("rejects missing level/cursor, recovery and insight bootstrap rather than fabricating a delta", () => {
    const incomplete = result();
    (incomplete.streamRuns[0]!.completedSliceIds as string[]).pop();
    expect(completedNormalInventoryEvidence({ result: incomplete, plan: inventory, mode: "normal", recovery: false })).toBeNull();
    expect(completedNormalInventoryEvidence({ result: result(), plan: inventory, mode: "insight_bootstrap", recovery: false })).toBeNull();
    expect(completedNormalInventoryEvidence({ result: result(), plan: inventory, mode: "normal", recovery: true })).toBeNull();
  });

  it("rejects duplicate streams and non-exact completed cursor sets", () => {
    const duplicate = result();
    (duplicate.streamRuns as unknown as Array<unknown>).push(structuredClone(duplicate.streamRuns[0]!));
    expect(completedNormalInventoryEvidence({ result: duplicate, plan: inventory, mode: "normal", recovery: false })).toBeNull();
    const extraCursor = result();
    (extraCursor.streamRuns[0]!.cursorBySlice as Record<string, unknown>).unexpected = {
      cursor: null, cursorId: "unexpected", updatedAt: "2026-08-17T10:00:00.000Z",
    };
    expect(completedNormalInventoryEvidence({ result: extraCursor, plan: inventory, mode: "normal", recovery: false })).toBeNull();
  });

  it("makes same-time conflicting snapshots fail closed and older snapshots explicit no-write stale skips", () => {
    const base = {
      schemaVersion: 1 as const, workspaceId, externalAccountId: accountId, capturedAt: "2026-08-17T10:00:00.000Z",
      campaigns: [{ externalCampaignId: "campaign_1", configuredStatus: { state: "known" as const, value: "ACTIVE" }, effectiveStatus: { state: "known" as const, value: "ACTIVE" }, campaignBudgetOptimization: { state: "known" as const, value: true }, dailyBudgetMinor: { state: "known" as const, value: 10_000 }, lifetimeBudgetMinor: { state: "known" as const, value: null } }],
      adSets: [], ads: [],
    };
    const previous = normalizeMetaChangeSnapshot(base);
    const conflicting = normalizeMetaChangeSnapshot({ ...base, campaigns: [{ ...base.campaigns[0]!, configuredStatus: { state: "known" as const, value: "PAUSED" } }] });
    expect(() => canonicalBudgetHistoryTransition(previous, conflicting))
      .toThrowError(expect.objectContaining<Partial<CanonicalBudgetHistoryMaterializationError>>({ code: "replay_conflict" }));
    const older = normalizeMetaChangeSnapshot({ ...base, capturedAt: "2026-08-17T09:00:00.000Z" });
    expect(canonicalBudgetHistoryTransition(previous, older)).toBe("stale_skip");
  });
});
