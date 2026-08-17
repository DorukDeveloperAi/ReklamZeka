import { afterEach, describe, expect, it, vi } from "vitest";

import type { MetaReadSyncScheduleCandidate } from "@/application/meta-read-sync-schedule-worker";
import { DrizzleMetaReadSyncLease, DrizzleMetaReadSyncScheduleRegistry } from
  "@/server/meta-read-sync-schedule-drizzle-adapters";
import { ServerDerivedMetaReadSyncServiceFactory } from "@/server/meta-read-sync-schedule-production";
import { DrizzleMetaReadSyncScheduleTickError, runDrizzleMetaReadSyncScheduleTick } from
  "@/server/meta-read-sync-schedule-tick";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-08T04:00:00.000Z";
const due: MetaReadSyncScheduleCandidate = Object.freeze({ workspaceId, connectionId, scopeRevision: 3,
  triggerKind: "interval_6h", scheduledFor: "2026-08-08T03:00:00.000Z",
  dateStart: "2026-08-07", dateStop: "2026-08-07" });
const database = Object.freeze({ execute: vi.fn(), transaction: vi.fn() });

afterEach(() => vi.restoreAllMocks());

describe("private production scheduled Meta read-sync tick", () => {
  it("constructs exact Drizzle ports and performs no service or network work when no schedule is due", async () => {
    const listDue = vi.spyOn(DrizzleMetaReadSyncScheduleRegistry.prototype, "listDue").mockResolvedValue([]);
    const claim = vi.spyOn(DrizzleMetaReadSyncLease.prototype, "claim");
    const create = vi.spyOn(ServerDerivedMetaReadSyncServiceFactory.prototype, "create");
    const fetchImpl = vi.fn();
    const result = await runDrizzleMetaReadSyncScheduleTick({ now, batchSize: 4, concurrency: 2,
      maxAttempts: 3, leaseMs: 60_000 }, { database: database as never,
      environment: { META_ACCESS_TOKEN: "PRIVATE_TOKEN" }, fetchImpl });
    expect(listDue).toHaveBeenCalledWith(now, 4); expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dueCount: 0, actionAuthority: "none", writeNetworkCalls: 0 });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN");
  });

  it("delegates duplicate leases without constructing a scoped service", async () => {
    vi.spyOn(DrizzleMetaReadSyncScheduleRegistry.prototype, "listDue").mockResolvedValue([due]);
    vi.spyOn(DrizzleMetaReadSyncLease.prototype, "claim").mockResolvedValue({ status: "duplicate_completed", attempt: 2 });
    const revalidate = vi.spyOn(DrizzleMetaReadSyncScheduleRegistry.prototype, "revalidate");
    const create = vi.spyOn(ServerDerivedMetaReadSyncServiceFactory.prototype, "create");
    const result = await runDrizzleMetaReadSyncScheduleTick({ now }, { database: database as never });
    expect(result.items[0]).toMatchObject({ outcome: "duplicate_completed", attempts: 2 });
    expect(revalidate).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(workspaceId); expect(JSON.stringify(result)).not.toContain(connectionId);
  });

  it("delegates partial service results to the exact lease failure adapter", async () => {
    vi.spyOn(DrizzleMetaReadSyncScheduleRegistry.prototype, "listDue").mockResolvedValue([due]);
    vi.spyOn(DrizzleMetaReadSyncLease.prototype, "claim").mockResolvedValue({ status: "claimed",
      leaseToken: `lease_${"a".repeat(32)}`, attempt: 1 });
    vi.spyOn(DrizzleMetaReadSyncScheduleRegistry.prototype, "revalidate").mockResolvedValue(due);
    const fail = vi.spyOn(DrizzleMetaReadSyncLease.prototype, "fail").mockResolvedValue(true);
    const complete = vi.spyOn(DrizzleMetaReadSyncLease.prototype, "complete");
    const serviceRun = vi.fn(async () => ({ status: "partial" as const,
      streamCounts: { completed: 1, partial: 1, failed: 0 }, inserted: 2, updated: 1, unchanged: 3,
      writeNetworkCalls: 0 as const }));
    vi.spyOn(ServerDerivedMetaReadSyncServiceFactory.prototype, "create").mockReturnValue({ run: serviceRun });
    const result = await runDrizzleMetaReadSyncScheduleTick({ now, maxAttempts: 2 }, { database: database as never });
    expect(result.items[0]).toMatchObject({ outcome: "partial", reason: "partial_result", retryable: true,
      counts: { streams: 2, inserted: 2, updated: 1, unchanged: 3 } });
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ reason: "partial_result", retryable: true }));
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects tick scope/token/port injection before any DB or service delegation", async () => {
    const listDue = vi.spyOn(DrizzleMetaReadSyncScheduleRegistry.prototype, "listDue");
    for (const injected of [
      { now, workspaceId }, { now, connectionId }, { now, accountIds: ["act_private"] },
      { now, accessToken: "PRIVATE_TOKEN" }, { now, registry: {} },
    ]) {
      await expect(runDrizzleMetaReadSyncScheduleTick(injected as never, { database: database as never }))
        .rejects.toMatchObject({ code: "lease_unavailable" });
    }
    expect(listDue).not.toHaveBeenCalled();
  });

  it("rejects dependency-side port or scope injection as invalid construction", async () => {
    for (const injected of [
      { database, registry: {} }, { database, leases: {} }, { database, services: {} },
      { database, workspaceId }, { database, connectionId }, { database, accessToken: "PRIVATE_TOKEN" },
    ]) {
      await expect(runDrizzleMetaReadSyncScheduleTick({ now }, injected as never))
        .rejects.toEqual(new DrizzleMetaReadSyncScheduleTickError("invalid_construction"));
    }
  });
});
