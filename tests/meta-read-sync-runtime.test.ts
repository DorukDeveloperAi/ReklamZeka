import { describe, expect, it, vi } from "vitest";

import type { MetaConnection } from "@/connectors/meta/connection-types";
import type { MetaInventoryPagePersistencePort } from "@/connectors/meta/sync/inventory-materialization";
import type { MetaSyncDurablePersistence } from "@/connectors/meta/sync/persistence-adapter";
import type { MetaCreativeSourcePagePersistencePort } from "@/connectors/meta/sync/creative-content-runtime-persistence";
import type { CanonicalBudgetHistoryMaterializer } from "@/connectors/meta/sync/canonical-budget-history-materializer";
import type { CanonicalDataHealthPostSyncMaterializer } from "@/connectors/meta/data-health-post-sync-materializer";
import type { MetaPartialReadSyncRuntime, MetaSyncResult, MetaSyncRuntimeOptions } from "@/connectors/meta/sync/runtime";
import {
  ProductionMetaReadSyncError,
  ProductionMetaReadSyncService,
} from "@/server/meta-read-sync-runtime";
import { DrizzleMetaSyncTransactionManager } from "@/connectors/meta/sync/persistence-adapter";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const token = "fixture-private-meta-token";

const connection: MetaConnection = Object.freeze({
  id: connectionId,
  workspaceId,
  displayName: "Meta",
  graphApiVersion: "v23.0",
  accessMode: "read_only",
  status: "active",
  lifecycleGeneration: 1,
  secretReference: Object.freeze({
    id: "secret-reference",
    provider: "environment",
    keyVersion: 1,
    bindingName: "META_ACCESS_TOKEN",
  }),
  capabilitySnapshot: null,
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  disconnectedAt: null,
  revokedAt: null,
});

function result(): MetaSyncResult {
  return {
    parentRun: { id: "run_daily", workspaceId, connectionId, status: "completed", streamRunIds: ["private-stream"] },
    streamRuns: [{ id: "private-stream", parentRunId: "run_daily", stream: "inventory", accountId: "act_123456",
      status: "completed", completedSliceIds: [], cursorBySlice: {}, error: null }],
    inserted: 2,
    updated: 1,
    unchanged: 3,
    writeNetworkCalls: 0,
  };
}

function fixture(overrides: Readonly<{
  resolveSecret?: () => Promise<string>;
  accountIds?: readonly string[];
  recoveryAccountId?: string;
  recoveryLaneId?: "inventory_ad_set_v1" | "creative_ad_v1" | "creative_ad_v2" | "insights_ad_v1";
  creativePagePersistence?: MetaCreativeSourcePagePersistencePort;
  insightBootstrapAccountSelector?: (input: Readonly<{ accountIds: readonly string[] }>) => Promise<readonly string[]>;
  budgetHistoryMaterializer?: CanonicalBudgetHistoryMaterializer;
  dataHealthMaterializer?: CanonicalDataHealthPostSyncMaterializer;
  runtimeResult?: (input: Parameters<MetaPartialReadSyncRuntime["run"]>[0]) => MetaSyncResult;
}> = {}) {
  const inventoryPagePersistence: MetaInventoryPagePersistencePort = {
    writePage: vi.fn(async (page) => ({ inserted: 0, updated: 0, unchanged: 0, stale: 0, disappeared: 0, pageHash: page.pageHash })),
  };
  const durablePersistence: MetaSyncDurablePersistence = {
    restore: vi.fn(async () => null),
    persist: vi.fn(async () => undefined),
  };
  let wiredOptions: MetaSyncRuntimeOptions | undefined;
  const runtimeRun = vi.fn(async (input: Parameters<MetaPartialReadSyncRuntime["run"]>[0]) => overrides.runtimeResult?.(input) ?? result());
  const connectionFind = vi.fn(async () => connection);
  const secretResolve = vi.fn(overrides.resolveSecret ?? (async () => token));
  const accountResolve = vi.fn(async () => overrides.accountIds ?? ["act_123456"]);
  const recoveryLaneId = overrides.recoveryLaneId ?? "inventory_ad_set_v1";
  const service = new ProductionMetaReadSyncService({
    scopeResolver: { resolve: vi.fn(async () => ({ workspaceId, connectionId })) },
    connections: { find: connectionFind, list: vi.fn(), save: vi.fn() },
    secrets: { resolve: secretResolve, assertUsable: vi.fn(), disable: vi.fn(), destroy: vi.fn() },
    accounts: { resolve: accountResolve },
    inventoryPagePersistence,
    durablePersistence,
    ...(overrides.creativePagePersistence === undefined ? {} : {
      creativePagePersistenceFactory: vi.fn(() => overrides.creativePagePersistence),
    }),
    ...(overrides.recoveryAccountId === undefined ? {} : {
      recoveryLane: {
        id: recoveryLaneId,
        accountId: overrides.recoveryAccountId,
        parentRunId: `meta.read.recovery.${recoveryLaneId.replace(/_v1$/, "").replaceAll("_", ".")}.v1`,
      },
    }),
    ...(overrides.insightBootstrapAccountSelector === undefined ? {} : {
      insightBootstrapAccountSelector: async (input) => overrides.insightBootstrapAccountSelector!({ accountIds: input.accountIds }),
    }),
    ...(overrides.budgetHistoryMaterializer === undefined ? {} : { budgetHistoryMaterializer: overrides.budgetHistoryMaterializer }),
    ...(overrides.dataHealthMaterializer === undefined ? {} : { dataHealthMaterializer: overrides.dataHealthMaterializer }),
    runtimeFactory: (options) => {
      wiredOptions = options;
      return { run: runtimeRun };
    },
  });
  return { service, inventoryPagePersistence, durablePersistence, runtimeRun, connectionFind, secretResolve, accountResolve,
    wiredOptions: () => wiredOptions };
}

describe("production Meta read sync composition", () => {
  it("keeps atomic checkpoints by default and makes pooler recovery explicitly server-selected", async () => {
    const database = { transaction: vi.fn(async (work: (transaction: unknown) => Promise<string>) => work({})) };
    const atomic = new DrizzleMetaSyncTransactionManager(database as never);
    await expect(atomic.transaction(async () => "atomic")).resolves.toBe("atomic");
    expect(database.transaction).toHaveBeenCalledTimes(1);

    const recovery = new DrizzleMetaSyncTransactionManager(database as never, { transactionMode: "idempotent_checkpoint" });
    await expect(recovery.transaction(async () => "recovery")).resolves.toBe("recovery");
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it("derives every private scope server-side and injects canonical inventory persistence", async () => {
    const setup = fixture();
    const response = await setup.service.run({
      parentRunId: "run_daily",
      dateStart: "2026-08-01",
      dateStop: "2026-08-07",
    });

    expect(setup.connectionFind).toHaveBeenCalledWith(workspaceId, connectionId);
    expect(setup.accountResolve).toHaveBeenCalledWith({ workspaceId, connectionId });
    expect(setup.secretResolve).toHaveBeenCalledWith(connection.secretReference, { workspaceId, connectionId });
    expect(setup.wiredOptions()?.inventoryPagePersistence).toBe(setup.inventoryPagePersistence);
    expect(setup.wiredOptions()?.persistence).toBe(setup.durablePersistence);
    expect(setup.runtimeRun).toHaveBeenCalledTimes(1);
    const runtimeInput = setup.runtimeRun.mock.calls[0]![0];
    expect(runtimeInput).toMatchObject({ parentRunId: "run_daily", workspaceId, connectionId });
    expect(runtimeInput.plan.some((slice) => slice.stream === "inventory" && slice.entityLevel === "campaign")).toBe(true);
    expect(runtimeInput.plan.every((slice) => slice.accountId === "act_123456")).toBe(true);
    expect(response).toEqual({
      status: "completed",
      streamCounts: { completed: 1, partial: 0, failed: 0 },
      inserted: 2,
      updated: 1,
      unchanged: 3,
      writeNetworkCalls: 0,
      affectedGeoMaterialization: "completed",
      postProcess: "not_applicable",
      postProcessRetryable: false,
    });
    expect(JSON.stringify(response)).not.toContain(token);
    expect(JSON.stringify(response)).not.toContain(workspaceId);
    expect(JSON.stringify(response)).not.toContain(connectionId);
    expect(JSON.stringify(response)).not.toContain("act_123456");
  });

  it("materializes budget/config history only after all normal inventory cursors are durably complete", async () => {
    const materialize = vi.fn(async () => ({ accountCount: 1, baselineCount: 1, replayCount: 0, externalChangeCount: 0, staleSkipCount: 0 }));
    const setup = fixture({
      budgetHistoryMaterializer: { materialize },
      runtimeResult: (runtimeInput) => {
        const inventory = runtimeInput.plan.filter((slice) => slice.stream === "inventory");
        return {
          ...result(),
          streamRuns: [{ id: "private-stream", parentRunId: "run_daily", stream: "inventory", accountId: "act_123456",
            status: "completed", completedSliceIds: inventory.map((slice) => slice.id),
            cursorBySlice: Object.fromEntries(inventory.map((slice) => [slice.id, {
              cursor: null, cursorId: `cursor-${slice.entityLevel}`, updatedAt: "2026-08-17T10:00:00.000Z",
            }])), error: null }],
        };
      },
    });
    const response = await setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07" });
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, connectionId, accounts: [{ externalAccountId: "act_123456", capturedAt: "2026-08-17T10:00:00.000Z" }],
    }));
    expect(response).toMatchObject({ status: "completed", postProcess: "completed", postProcessRetryable: false });
  });

  it("keeps a post-run history failure redacted and retryable as partial_result", async () => {
    const setup = fixture({
      budgetHistoryMaterializer: { materialize: vi.fn(async () => { throw new Error("private database detail"); }) },
      runtimeResult: (runtimeInput) => {
        const inventory = runtimeInput.plan.filter((slice) => slice.stream === "inventory");
        return { ...result(), streamRuns: [{ id: "private-stream", parentRunId: "run_daily", stream: "inventory", accountId: "act_123456",
          status: "completed", completedSliceIds: inventory.map((slice) => slice.id),
          cursorBySlice: Object.fromEntries(inventory.map((slice) => [slice.id, { cursor: null, cursorId: "cursor", updatedAt: "2026-08-17T10:00:00.000Z" }])), error: null }] };
      },
    });
    await expect(setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07" }))
      .resolves.toMatchObject({ status: "partial", postProcess: "partial_result", postProcessRetryable: true });
  });

  it("does not fabricate a wall-clock health occurrence for a partial normal run", async () => {
    const materialize = vi.fn(async () => ({ outcome: "partial_without_ledger" as const }));
    const setup = fixture({ dataHealthMaterializer: { materialize } });
    await expect(setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07" }))
      .resolves.toMatchObject({ status: "partial", postProcess: "partial_result", postProcessRetryable: true });
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, externalAccountIds: ["act_123456"], resolveAbsent: false, occurredAt: null }));
  });

  it("uses the durable partial checkpoint time on every retry", async () => {
    const materialize = vi.fn(async () => ({ outcome: "materialized" as const }));
    const durablePartial = {
      ...result(), streamRuns: [{ id: "private-stream", parentRunId: "run_daily", stream: "inventory" as const, accountId: "act_123456",
        status: "partial" as const, completedSliceIds: [], cursorBySlice: { slice: { cursor: "next", cursorId: "cursor", updatedAt: "2026-08-17T10:00:00.000Z" } }, error: null }],
    };
    const setup = fixture({ dataHealthMaterializer: { materialize }, runtimeResult: () => durablePartial });
    await setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07" });
    await setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07" });
    expect(materialize).toHaveBeenCalledTimes(2);
    const healthCalls = materialize.mock.calls as unknown as readonly [Readonly<{ occurredAt: string | null }>][];
    expect(healthCalls.map(([input]) => input.occurredAt)).toEqual(["2026-08-17T10:00:00.000Z", "2026-08-17T10:00:00.000Z"]);
  });

  it("injects the server-bound canonical creative/Page/Instagram persistence port", async () => {
    const creativePagePersistence: MetaCreativeSourcePagePersistencePort = {
      writeSourcePage: vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0, stale: 0, cursor: null, recordCount: 0 })),
    };
    const setup = fixture({ creativePagePersistence });
    await setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07" });
    expect(setup.wiredOptions()?.creativePagePersistence).toBe(creativePagePersistence);
  });

  it("passes a validated server-owned execution deadline to the runtime", async () => {
    const setup = fixture();
    await setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07", maxRunDurationMs: 5_000 });
    expect(setup.wiredOptions()?.deadlineAtEpochMs).toEqual(expect.any(Number));
    await expect(setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07", maxRunDurationMs: 4_999 }))
      .rejects.toEqual(new ProductionMetaReadSyncError("sync_failed"));
  });

  it("resumes only the configured account inventory/ad-set lane with a stable parent id", async () => {
    const setup = fixture({ accountIds: ["act_123456", "act_987654"], recoveryAccountId: "act_123456" });
    await setup.service.runRecoveryLane({
      dateStart: "2026-08-01", dateStop: "2026-08-07", initialPageSize: 100, maxRunDurationMs: 5_000,
    });
    const runtimeInput = setup.runtimeRun.mock.calls[0]![0];
    expect(runtimeInput.parentRunId).toBe("meta.read.recovery.inventory.ad.set.v1");
    expect(runtimeInput.plan).toEqual([
      expect.objectContaining({ stream: "inventory", entityLevel: "ad_set", accountId: "act_123456" }),
    ]);
    expect(runtimeInput.plan.every((slice) => slice.stream === "inventory" && slice.entityLevel === "ad_set" && slice.accountId === "act_123456")).toBe(true);
    expect(JSON.stringify(runtimeInput)).not.toContain("act_987654");
  });

  it("fails closed when the server-configured recovery account is outside the derived scope", async () => {
    const setup = fixture({ accountIds: ["act_987654"], recoveryAccountId: "act_123456" });
    await expect(setup.service.runRecoveryLane({ dateStart: "2026-08-01", dateStop: "2026-08-07" }))
      .rejects.toEqual(new ProductionMetaReadSyncError("account_scope_unavailable"));
    expect(setup.secretResolve).not.toHaveBeenCalled();
    expect(setup.runtimeRun).not.toHaveBeenCalled();
  });

  it("limits a configured creative or insight lane to its exact ad stream", async () => {
    for (const [lane, stream] of [["creative_ad_v1", "creative_post"], ["creative_ad_v2", "creative_post"]] as const) {
      const setup = fixture({ accountIds: ["act_123456"], recoveryAccountId: "act_123456", recoveryLaneId: lane });
      await setup.service.runRecoveryLane({ dateStart: "2026-08-01", dateStop: "2026-08-07" });
      const plan = setup.runtimeRun.mock.calls[0]![0].plan;
      expect(plan).toEqual([expect.objectContaining({ stream, entityLevel: "ad", accountId: "act_123456" })]);
    }
  });

  it("limits an insight recovery to one date and gives that date its own resumable parent", async () => {
    const setup = fixture({ accountIds: ["act_123456"], recoveryAccountId: "act_123456", recoveryLaneId: "insights_ad_v1" });
    await setup.service.runRecoveryLane({ dateStart: "2026-08-01", dateStop: "2026-08-01", dateSliceDays: 1 });
    const runtimeInput = setup.runtimeRun.mock.calls[0]![0];
    expect(runtimeInput.parentRunId).toBe("meta.read.recovery.insights.ad.v1.2026-08-01");
    expect(runtimeInput.plan).toEqual([expect.objectContaining({ stream: "insights", entityLevel: "ad", accountId: "act_123456", dateStart: "2026-08-01", dateStop: "2026-08-01" })]);
    await expect(setup.service.runRecoveryLane({ dateStart: "2026-08-01", dateStop: "2026-08-02", dateSliceDays: 1 }))
      .rejects.toEqual(new ProductionMetaReadSyncError("sync_failed"));
  });

  it("bootstraps only capability-selected campaign insight windows with a date-bound resumable parent", async () => {
    const selector = vi.fn(async ({ accountIds }: Readonly<{ accountIds: readonly string[] }>) => {
      expect(accountIds).toEqual(["act_123456", "act_987654"]);
      return ["act_987654"];
    });
    const setup = fixture({ accountIds: ["act_123456", "act_987654"], insightBootstrapAccountSelector: selector });
    await setup.service.runInsightBootstrap({
      dateStart: "2026-07-14", dateStop: "2026-08-12", dateSliceDays: 7, initialPageSize: 25, maxRunDurationMs: 5_000,
    });
    const runtimeInput = setup.runtimeRun.mock.calls[0]![0];
    expect(runtimeInput.parentRunId).toBe("meta.read.insight.bootstrap.v1.2026-07-14.2026-08-12");
    expect(runtimeInput.plan).toHaveLength(5);
    expect(runtimeInput.plan.every((slice) => slice.stream === "insights" && slice.entityLevel === "campaign"
      && slice.accountId === "act_987654")).toBe(true);
    expect(JSON.stringify(runtimeInput.plan)).not.toContain("act_123456");
    expect(selector).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the capability gate cannot prove an account", async () => {
    const setup = fixture({ insightBootstrapAccountSelector: async () => [] });
    await expect(setup.service.runInsightBootstrap({ dateStart: "2026-07-14", dateStop: "2026-08-12" }))
      .rejects.toEqual(new ProductionMetaReadSyncError("account_scope_unavailable"));
    expect(setup.runtimeRun).not.toHaveBeenCalled();
  });

  it("fails closed with a redacted error when the private secret cannot be resolved", async () => {
    const setup = fixture({ resolveSecret: async () => { throw new Error(`${token}: private provider path`); } });
    await expect(setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07" }))
      .rejects.toEqual(new ProductionMetaReadSyncError("connection_unavailable"));
    expect(setup.runtimeRun).not.toHaveBeenCalled();
  });

  it("rejects absent, oversized and malformed server-derived account scopes before runtime creation", async () => {
    for (const accountIds of [[], ["caller-controlled-account"], Array.from({ length: 1_001 }, (_, index) => `act_${index + 1}`)]) {
      const setup = fixture({ accountIds });
      await expect(setup.service.run({ parentRunId: "run_daily", dateStart: "2026-08-01", dateStop: "2026-08-07" }))
        .rejects.toEqual(new ProductionMetaReadSyncError("account_scope_unavailable"));
      expect(setup.secretResolve).not.toHaveBeenCalled();
      expect(setup.runtimeRun).not.toHaveBeenCalled();
    }
  });
});
