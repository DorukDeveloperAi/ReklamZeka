import { describe, expect, it, vi } from "vitest";

import type { MetaReadSyncServiceResult } from "@/application/meta-read-sync-schedule-worker";
import { ConnectorError } from "@/connectors/contract";
import {
  ProductionMetaReadSyncRetryClassifier,
  ServerDerivedMetaReadSyncServiceFactory,
} from "@/server/meta-read-sync-schedule-production";
import { ProductionMetaReadSyncError } from "@/server/meta-read-sync-runtime";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const foreignWorkspaceId = "33333333-3333-4333-8333-333333333333";
const token = "private-meta-token";

const request = Object.freeze({
  parentRunId: "sync_daily_safe",
  dateStart: "2026-08-07",
  dateStop: "2026-08-07",
});

function completed(writeNetworkCalls: 0 = 0): MetaReadSyncServiceResult {
  return Object.freeze({
    status: "completed", streamCounts: Object.freeze({ completed: 1, partial: 0, failed: 0 }),
    inserted: 1, updated: 0, unchanged: 2, writeNetworkCalls,
  });
}

function harness(result: MetaReadSyncServiceResult = completed()) {
  const resolver = { resolve: vi.fn(async () => ({ workspaceId, connectionId })) };
  const run = vi.fn(async (_input: typeof request) => result);
  const build = vi.fn((fixedResolver) => ({
    run: async (input: typeof request) => {
      const scope = await fixedResolver.resolve();
      if (scope.workspaceId !== workspaceId || scope.connectionId !== connectionId) {
        throw new Error(`${token}:${scope.workspaceId}`);
      }
      return run(input);
    },
  }));
  const factory = new ServerDerivedMetaReadSyncServiceFactory(build);
  return { resolver, run, build, factory };
}

describe("scheduled production Meta read-sync composition", () => {
  it("captures one server-derived fixed scope across retries and exposes no private IDs", async () => {
    const setup = harness();
    const service = setup.factory.create({ scopeResolver: setup.resolver });

    const first = await service.run(request);
    const retry = await service.run(request);

    expect(first).toEqual(completed());
    expect(retry.writeNetworkCalls).toBe(0);
    expect(setup.resolver.resolve).toHaveBeenCalledTimes(1);
    expect(setup.build).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify([first, retry]);
    expect(serialized).not.toContain(workspaceId);
    expect(serialized).not.toContain(connectionId);
    expect(serialized).not.toContain(token);
  });

  it("rejects caller scope, account and token injection before service construction", async () => {
    const setup = harness();
    expect(() => setup.factory.create({
      scopeResolver: setup.resolver, workspaceId: foreignWorkspaceId,
    } as never)).toThrow(new ProductionMetaReadSyncError("scope_unavailable"));

    const service = setup.factory.create({ scopeResolver: setup.resolver });
    for (const injected of [
      { ...request, workspaceId: foreignWorkspaceId },
      { ...request, accountIds: ["act_999"] },
      { ...request, accessToken: token },
    ]) {
      await expect(service.run(injected as never)).rejects.toEqual(new ProductionMetaReadSyncError("sync_failed"));
    }
    expect(setup.build).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it("fails closed on cross-scope or secret-bearing resolver payloads without leaking values", async () => {
    const setup = harness();
    const service = setup.factory.create({ scopeResolver: {
      resolve: async () => ({ workspaceId: foreignWorkspaceId, connectionId, accessToken: token }),
    } as never });
    const error = await service.run(request).catch((caught) => caught);
    expect(error).toEqual(new ProductionMetaReadSyncError("scope_unavailable"));
    expect(String(error)).not.toContain(foreignWorkspaceId);
    expect(String(error)).not.toContain(connectionId);
    expect(String(error)).not.toContain(token);
    expect(setup.build).not.toHaveBeenCalled();
  });

  it("rejects any service result that claims a Meta write network call", async () => {
    const setup = harness({ ...completed(), writeNetworkCalls: 1 } as never);
    const service = setup.factory.create({ scopeResolver: setup.resolver });
    await expect(service.run(request)).rejects.toEqual(new ProductionMetaReadSyncError("sync_failed"));
  });
});

describe("ProductionMetaReadSyncRetryClassifier", () => {
  const classifier = new ProductionMetaReadSyncRetryClassifier();

  it.each([
    [new ProductionMetaReadSyncError("scope_unavailable"), { reason: "scope_unavailable", retryable: false }],
    [new ProductionMetaReadSyncError("connection_unavailable"), { reason: "connection_unavailable", retryable: false }],
    [new ProductionMetaReadSyncError("account_scope_unavailable"), { reason: "account_scope_unavailable", retryable: false }],
    [new ProductionMetaReadSyncError("sync_failed"), { reason: "sync_failed", retryable: false }],
    [new ConnectorError("rate_limited", `${token}:429`, true), { reason: "rate_limited", retryable: true }],
    [new ConnectorError("transient", `${token}:network`, true), { reason: "transient", retryable: true }],
    [new ConnectorError("authentication", token, false), { reason: "connection_unavailable", retryable: false }],
    [new ConnectorError("invalid_data", token, false), { reason: "sync_failed", retryable: false }],
    [new Error(`${token}:${workspaceId}:${connectionId}`), { reason: "sync_failed", retryable: false }],
  ])("classifies typed errors without returning provider detail", (error, expected) => {
    const classified = classifier.classify(error);
    expect(classified).toEqual(expected);
    const serialized = JSON.stringify(classified);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(workspaceId);
    expect(serialized).not.toContain(connectionId);
  });
});
