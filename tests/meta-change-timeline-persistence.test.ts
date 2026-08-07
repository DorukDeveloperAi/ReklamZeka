import { describe, expect, it } from "vitest";
import {
  MetaChangeTimelinePersistenceError,
  MetaChangeTimelinePersistenceService,
  type MetaChangeEventPersistenceRow,
  type MetaChangePersistenceScope,
  type MetaChangeSnapshotPersistenceRow,
  type MetaChangeTimelinePersistenceStore,
  type MetaChangeTimelinePersistenceTransaction,
} from "@/connectors/meta/sync/change-timeline-persistence";
import {
  diffMetaChangeSnapshots,
  normalizeMetaChangeSnapshot,
  type MetaChangeSnapshotInput,
} from "@/domain/meta/snapshot-diff";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const connectionId = "22222222-2222-4222-a222-222222222222";
const accountAId = "33333333-3333-4333-a333-333333333333";
const accountBId = "44444444-4444-4444-a444-444444444444";
const externalAccountA = "act_private_account_a";
const externalAccountB = "act_private_account_b";

function input(accountId: string, capturedAt: string, status: "ACTIVE" | "PAUSED" | "unknown"): MetaChangeSnapshotInput {
  return {
    schemaVersion: 1,
    workspaceId,
    externalAccountId: accountId,
    capturedAt,
    campaigns: [{
      externalCampaignId: `campaign_${accountId}`,
      configuredStatus: status === "unknown" ? { state: "unknown", reason: "field_not_observed" } : { state: "known", value: status },
      effectiveStatus: { state: "known", value: "ACTIVE" },
      campaignBudgetOptimization: { state: "known", value: true },
      dailyBudgetMinor: { state: "known", value: 10_000 },
      lifetimeBudgetMinor: { state: "known", value: null },
    }],
    adSets: [],
    ads: [],
  };
}

class MemoryStore implements MetaChangeTimelinePersistenceStore {
  readonly accounts = new Map<string, string>([[accountAId, externalAccountA], [accountBId, externalAccountB]]);
  readonly snapshots = new Map<string, MetaChangeSnapshotPersistenceRow & { id: string }>();
  readonly events = new Map<string, MetaChangeEventPersistenceRow>();

  transaction<T>(work: (transaction: MetaChangeTimelinePersistenceTransaction) => Promise<T>): Promise<T> {
    const snapshotsBefore = new Map(this.snapshots);
    const eventsBefore = new Map(this.events);
    const tx: MetaChangeTimelinePersistenceTransaction = {
      resolveExternalAccountId: async (scope) => this.accounts.get(scope.adAccountId) ?? null,
      upsertSnapshot: async (row) => {
        const key = `${row.workspaceId}:${row.connectionId}:${row.adAccountId}:${row.snapshotHash}`;
        const current = this.snapshots.get(key);
        if (current) return { id: current.id, publicRef: current.publicRef, inserted: false };
        const stored = { ...row, id: `snapshot-internal-${this.snapshots.size + 1}` };
        this.snapshots.set(key, stored);
        return { id: stored.id, publicRef: stored.publicRef, inserted: true };
      },
      appendEvents: async (rows) => {
        let inserted = 0;
        for (const row of rows) {
          const key = `${row.workspaceId}:${row.connectionId}:${row.adAccountId}:${row.changeRef}`;
          if (!this.events.has(key)) {
            this.events.set(key, row);
            inserted += 1;
          }
        }
        return inserted;
      },
    };
    return work(tx).catch((error) => {
      this.snapshots.clear();
      this.events.clear();
      for (const [key, value] of snapshotsBefore) this.snapshots.set(key, value);
      for (const [key, value] of eventsBefore) this.events.set(key, value);
      throw error;
    });
  }
}

function scope(adAccountId = accountAId): MetaChangePersistenceScope {
  return { workspaceId, connectionId, adAccountId };
}

describe("Meta change timeline persistence", () => {
  it("atomically persists safe canonical evidence, classifies external change and replays idempotently", async () => {
    const store = new MemoryStore();
    const service = new MetaChangeTimelinePersistenceService(store);
    const previous = normalizeMetaChangeSnapshot(input(externalAccountA, "2026-08-07T10:00:00.000Z", "ACTIVE"));
    const current = normalizeMetaChangeSnapshot(input(externalAccountA, "2026-08-07T11:00:00.000Z", "PAUSED"));
    const timeline = diffMetaChangeSnapshots({ previous, current });

    const first = await service.persist({ scope: scope(), previous, current, timeline, detectedAt: "2026-08-07T11:01:00.000Z" });
    expect(first).toMatchObject({ insertedSnapshots: 2, insertedEvents: 1, externalChangeCount: 1, replay: false });
    expect(first.previousSnapshotRef).toMatch(/^snapshot_[a-f0-9]{20}$/);
    expect(first.timelineRef).toMatch(/^timeline_[a-f0-9]{20}$/);

    const replay = await service.persist({ scope: scope(), previous, current, timeline, detectedAt: "2026-08-07T11:01:00.000Z" });
    expect(replay).toMatchObject({ insertedSnapshots: 0, insertedEvents: 0, eventCount: 1, replay: true });
    expect(store.snapshots.size).toBe(2);
    expect(store.events.size).toBe(1);

    const publicJson = JSON.stringify(first);
    const eventJson = JSON.stringify([...store.events.values()]);
    for (const forbidden of [workspaceId, connectionId, externalAccountA, `campaign_${externalAccountA}`, "secret ad copy"] ) {
      expect(publicJson).not.toContain(forbidden);
    }
    for (const forbidden of [externalAccountA, `campaign_${externalAccountA}`, "secret ad copy", "access_token", "rawPayload"] ) {
      expect(eventJson).not.toContain(forbidden);
    }
    expect(JSON.stringify([...store.snapshots.values()])).toContain(externalAccountA);
    expect([...store.snapshots.values()][0]).toHaveProperty("canonicalPayload");
  });

  it("rejects a second account/scope mismatch before writing anything", async () => {
    const store = new MemoryStore();
    const service = new MetaChangeTimelinePersistenceService(store);
    const previous = normalizeMetaChangeSnapshot(input(externalAccountA, "2026-08-07T10:00:00.000Z", "ACTIVE"));
    const current = normalizeMetaChangeSnapshot(input(externalAccountA, "2026-08-07T11:00:00.000Z", "PAUSED"));
    await expect(service.persist({
      scope: scope(accountBId),
      previous,
      current,
      timeline: diffMetaChangeSnapshots({ previous, current }),
      detectedAt: "2026-08-07T11:01:00.000Z",
    })).rejects.toMatchObject({ code: "scope_mismatch" } satisfies Partial<MetaChangeTimelinePersistenceError>);
    expect(store.snapshots.size).toBe(0);
    expect(store.events.size).toBe(0);

    const previousB = normalizeMetaChangeSnapshot(input(externalAccountB, "2026-08-07T10:00:00.000Z", "ACTIVE"));
    const currentB = normalizeMetaChangeSnapshot(input(externalAccountB, "2026-08-07T11:00:00.000Z", "PAUSED"));
    const resultB = await service.persist({
      scope: scope(accountBId), previous: previousB, current: currentB,
      timeline: diffMetaChangeSnapshots({ previous: previousB, current: currentB }),
      detectedAt: "2026-08-07T11:01:00.000Z",
    });
    expect(resultB.externalChangeCount).toBe(1);
    expect(store.events.size).toBe(1);
  });

  it("persists unknown observations without inventing a change event", async () => {
    const store = new MemoryStore();
    const service = new MetaChangeTimelinePersistenceService(store);
    const previous = normalizeMetaChangeSnapshot(input(externalAccountA, "2026-08-07T10:00:00.000Z", "ACTIVE"));
    const current = normalizeMetaChangeSnapshot(input(externalAccountA, "2026-08-07T11:00:00.000Z", "unknown"));
    const timeline = diffMetaChangeSnapshots({ previous, current });
    expect(timeline.diagnostics.unknownComparisons).toBeGreaterThan(0);

    const result = await service.persist({ scope: scope(), previous, current, timeline, detectedAt: "2026-08-07T11:01:00.000Z" });
    expect(result).toMatchObject({ insertedSnapshots: 2, insertedEvents: 0, eventCount: 0, externalChangeCount: 0 });
    expect(store.events.size).toBe(0);
    expect([...store.snapshots.values()][1]?.safeAggregate.unknownFieldCount).toBeGreaterThan(0);
  });

  it("accepts only a genuine internal action correlation", async () => {
    const store = new MemoryStore();
    const service = new MetaChangeTimelinePersistenceService(store);
    const previous = normalizeMetaChangeSnapshot(input(externalAccountA, "2026-08-07T10:00:00.000Z", "ACTIVE"));
    const current = normalizeMetaChangeSnapshot(input(externalAccountA, "2026-08-07T11:00:00.000Z", "PAUSED"));
    const actionLedger = [{
      actionId: "private-action-id",
      entityType: "campaign" as const,
      externalEntityId: `campaign_${externalAccountA}`,
      field: "configured_status" as const,
      expectedFrom: "ACTIVE",
      expectedTo: "PAUSED",
      appliedAt: "2026-08-07T10:30:00.000Z",
      verificationStatus: "verified" as const,
    }];
    const timeline = diffMetaChangeSnapshots({
      previous,
      current,
      actionLedger,
    });
    const result = await service.persist({
      scope: scope(), previous, current, timeline, actionLedger, detectedAt: "2026-08-07T11:01:00.000Z",
    });
    expect(result).toMatchObject({ internalExpectedCount: 1, externalChangeCount: 0 });
    expect(JSON.stringify([...store.events.values()])).not.toContain("private-action-id");

    const forgedStore = new MemoryStore();
    await expect(new MetaChangeTimelinePersistenceService(forgedStore).persist({
      scope: scope(), previous, current, timeline, detectedAt: "2026-08-07T11:01:00.000Z",
    })).rejects.toMatchObject({ code: "invalid_input" } satisfies Partial<MetaChangeTimelinePersistenceError>);
    expect(forgedStore.events.size).toBe(0);
  });
});
