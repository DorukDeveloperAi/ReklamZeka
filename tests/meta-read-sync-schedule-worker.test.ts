import { describe, expect, it, vi } from "vitest";

import {
  MetaReadSyncScheduleWorkerError,
  runMetaReadSyncManualWorker,
  runMetaReadSyncScheduleWorker,
  type MetaReadSyncLeasePort,
  type MetaReadSyncScheduleCandidate,
  type MetaReadSyncServiceResult,
} from "@/application/meta-read-sync-schedule-worker";

const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";
const connectionA = "33333333-3333-4333-8333-333333333333";
const connectionB = "44444444-4444-4444-8444-444444444444";
const now = "2026-08-07T09:00:00.000Z";

function due(workspaceId = workspaceA, connectionId = connectionA): MetaReadSyncScheduleCandidate {
  return {
    workspaceId,
    connectionId,
    scopeRevision: 1,
    triggerKind: "interval_6h",
    scheduledFor: "2026-08-07T06:00:00.000Z",
    dateStart: "2026-08-06",
    dateStop: "2026-08-06",
  };
}

function completed(overrides: Partial<MetaReadSyncServiceResult> = {}): MetaReadSyncServiceResult {
  return {
    status: "completed",
    streamCounts: { completed: 3, partial: 0, failed: 0 },
    inserted: 10,
    updated: 2,
    unchanged: 5,
    writeNetworkCalls: 0,
    ...overrides,
  };
}

function lease(): MetaReadSyncLeasePort & Readonly<{
  claim: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
}> {
  return {
    claim: vi.fn(async () => ({ status: "claimed" as const, leaseToken: "lease_safe", attempt: 1 })),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
}

function ports(input: Readonly<{
  candidates?: readonly MetaReadSyncScheduleCandidate[];
  run?: (scope: Readonly<{ workspaceId: string; connectionId: string }>, parentRunId: string) => Promise<MetaReadSyncServiceResult>;
  revalidate?: (candidate: MetaReadSyncScheduleCandidate) => Promise<MetaReadSyncScheduleCandidate | null>;
  leases?: MetaReadSyncLeasePort;
}> = {}) {
  const candidates = input.candidates ?? [due()];
  const leases = input.leases ?? lease();
  const scopes: Array<Readonly<{ workspaceId: string; connectionId: string }>> = [];
  const run = vi.fn(async (request: { parentRunId: string }) => {
    const scope = scopes.at(-1)!;
    return input.run?.(scope, request.parentRunId) ?? completed();
  });
  return {
    value: {
      registry: {
        listDue: vi.fn(async () => candidates),
        revalidate: vi.fn(input.revalidate ?? (async (candidate) => candidate)),
      },
      leases,
      services: {
        create: vi.fn(({ scopeResolver }) => ({
          run: async (request: Readonly<{ parentRunId: string; dateStart: string; dateStop: string }>) => {
            scopes.push(await scopeResolver.resolve());
            return run(request);
          },
        })),
      },
      retryClassifier: {
        classify: vi.fn((error: unknown) => ({
          reason: error instanceof Error && error.name === "RateLimitError" ? "rate_limited" as const
            : error instanceof Error && error.name === "ConnectionUnavailable" ? "connection_unavailable" as const
              : "sync_failed" as const,
          retryable: error instanceof Error && error.name === "RateLimitError",
        })),
      },
      sleep: vi.fn(async () => undefined),
    },
    run,
    scopes,
    leases,
  };
}

describe("bounded scheduled Meta read-sync orchestration", () => {
  it("runs a server-resolved manual fire through the same lease without accepting a connection or cursor input", async () => {
    const setup = ports();
    const manual = { ...due(), triggerKind: "manual" as const, scheduledFor: now };
    const result = await runMetaReadSyncManualWorker({ now, workspaceId: workspaceA }, {
      registry: { resolveManual: vi.fn(async () => manual), revalidate: setup.value.registry.revalidate },
      leases: setup.leases, services: setup.value.services, retryClassifier: setup.value.retryClassifier,
    });
    expect(result.items[0]).toMatchObject({ outcome: "completed", parentRunRef: expect.stringMatching(/^sync_manual_/) });
    expect(setup.leases.claim).toHaveBeenCalledWith(expect.objectContaining({ triggerKind: "manual", scheduledFor: now }));
    await expect(runMetaReadSyncManualWorker({ now, workspaceId: workspaceA, connectionId: connectionA } as never, {
      registry: { resolveManual: vi.fn(), revalidate: vi.fn() }, leases: setup.leases, services: setup.value.services,
      retryClassifier: setup.value.retryClassifier,
    })).rejects.toEqual(new MetaReadSyncScheduleWorkerError("invalid_input"));
  });

  it("serializes simultaneous automatic and manual fires for one server-owned scope to one service invocation", async () => {
    let owned = false; let calls = 0;
    const sharedLeases: MetaReadSyncLeasePort = {
      claim: vi.fn(async () => {
        if (owned) return { status: "duplicate_in_progress" as const, attempt: 1 };
        owned = true; return { status: "claimed" as const, leaseToken: "lease_shared", attempt: 1 };
      }),
      complete: vi.fn(async () => true), fail: vi.fn(async () => true),
    };
    const setup = ports({ leases: sharedLeases, run: async () => { calls += 1; return completed(); } });
    const manual = { ...due(), triggerKind: "manual" as const, scheduledFor: now };
    const [automatic, triggered] = await Promise.all([
      runMetaReadSyncScheduleWorker({ now }, setup.value),
      runMetaReadSyncManualWorker({ now, workspaceId: workspaceA }, {
        registry: { resolveManual: async () => manual, revalidate: async (item) => item }, leases: sharedLeases,
        services: setup.value.services, retryClassifier: setup.value.retryClassifier,
      }),
    ]);
    expect(calls).toBe(1);
    expect([...automatic.items, ...triggered.items].filter((item) => item.outcome === "completed")).toHaveLength(1);
    expect([...automatic.items, ...triggered.items].filter((item) => item.outcome === "duplicate_in_progress")).toHaveLength(1);
  });

  it("derives a stable logical fire and exposes only public-safe aggregate evidence", async () => {
    const setup = ports();
    const first = await runMetaReadSyncScheduleWorker({ now }, setup.value);
    const replaySetup = ports();
    const replay = await runMetaReadSyncScheduleWorker({ now }, replaySetup.value);

    expect(first).toMatchObject({ dueCount: 1, completedCount: 1, partialCount: 0, failedCount: 0,
      actionAuthority: "none", writeNetworkCalls: 0 });
    expect(first.items[0]).toMatchObject({
      outcome: "completed",
      attempts: 1,
      retryable: false,
      reason: "none",
      counts: { streams: 3, inserted: 10, updated: 2, unchanged: 5 },
    });
    expect(first.items[0]?.parentRunRef).toBe(replay.items[0]?.parentRunRef);
    expect(first.items[0]?.scopeRef).toBe(replay.items[0]?.scopeRef);
    const serialized = JSON.stringify(first);
    for (const privateValue of [workspaceA, connectionA, "act_123", "private-token"]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(setup.scopes).toEqual([{ workspaceId: workspaceA, connectionId: connectionA }]);
    expect(setup.run.mock.calls[0]?.[0].parentRunId).toMatch(/^sync_6h_[a-f0-9]{32}$/);
  });

  it("revalidates the exact DB-derived scope after claim and fails closed before service creation", async () => {
    const setup = ports({ revalidate: async () => null });
    const result = await runMetaReadSyncScheduleWorker({ now }, setup.value);
    expect(result.items[0]).toMatchObject({ outcome: "stale_scope", reason: "scope_unavailable" });
    expect(setup.value.services.create).not.toHaveBeenCalled();
    expect(setup.leases.fail).toHaveBeenCalledWith(expect.objectContaining({
      reason: "scope_unavailable",
      retryable: false,
    }));
  });

  it("isolates connections, respects bounded concurrency and preserves candidate order", async () => {
    let active = 0;
    let maximum = 0;
    const candidates = [due(workspaceA, connectionA), due(workspaceB, connectionB)];
    const setup = ports({
      candidates,
      run: async (scope) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        if (scope.connectionId === connectionB) throw Object.assign(new Error("private-token act_999"), { name: "ConnectionUnavailable" });
        return completed();
      },
    });
    const result = await runMetaReadSyncScheduleWorker({ now, concurrency: 1 }, setup.value);
    expect(maximum).toBe(1);
    expect(result.items.map((item) => item.outcome)).toEqual(["completed", "failed"]);
    expect(result).toMatchObject({ completedCount: 1, failedCount: 1 });
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(JSON.stringify(result)).not.toContain("act_999");
  });

  it("uses classified bounded retry/backoff without changing parentRun identity", async () => {
    let calls = 0;
    const parentIds: string[] = [];
    const setup = ports({ run: async (_scope, parentRunId) => {
      parentIds.push(parentRunId);
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("provider detail"), { name: "RateLimitError" });
      return completed();
    } });
    const result = await runMetaReadSyncScheduleWorker({ now, maxAttempts: 3 }, setup.value);
    expect(result.items[0]).toMatchObject({ outcome: "completed", attempts: 3 });
    expect(new Set(parentIds).size).toBe(1);
    expect(setup.value.sleep).toHaveBeenNthCalledWith(1, 100);
    expect(setup.value.sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it("keeps partial state retryable and advances neither completion nor another connection's lease", async () => {
    const leases = lease();
    const setup = ports({ leases, run: async () => completed({
      status: "partial",
      streamCounts: { completed: 1, partial: 1, failed: 0 },
    }) });
    const result = await runMetaReadSyncScheduleWorker({ now }, setup.value);
    expect(result.items[0]).toMatchObject({ outcome: "partial", retryable: true, reason: "partial_result" });
    expect(leases.complete).not.toHaveBeenCalled();
    expect(leases.fail).toHaveBeenCalledWith(expect.objectContaining({ reason: "partial_result", retryable: true }));
  });

  it("rejects missing lease authority and duplicate registry fires without running sync", async () => {
    const setup = ports();
    await expect(runMetaReadSyncScheduleWorker({ now }, { ...setup.value, leases: {} as never }))
      .rejects.toEqual(new MetaReadSyncScheduleWorkerError("lease_unavailable"));
    const duplicates = ports({ candidates: [due(), due()] });
    await expect(runMetaReadSyncScheduleWorker({ now }, duplicates.value))
      .rejects.toEqual(new MetaReadSyncScheduleWorkerError("registry_failure"));
    expect(duplicates.run).not.toHaveBeenCalled();
  });
});
