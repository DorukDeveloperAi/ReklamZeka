import { describe, expect, it } from "vitest";
import planFixture from "./fixtures/meta-sync/read-sync-plan.json";
import { ConnectorError } from "@/connectors/contract";
import { planMetaReadSync } from "@/connectors/meta/sync/planner";
import { classifyMetaSyncError, InMemoryMetaSyncStore, MetaPartialReadSyncRuntime } from "@/connectors/meta/sync/runtime";
import type { MetaReadRequest, MetaReadTransport } from "@/connectors/meta/sync/types";

const plan = () => planMetaReadSync({ ...planFixture, accountIds: planFixture.accounts });
const fixedNow = () => new Date("2026-08-07T10:00:00.000Z");

class FixtureTransport implements MetaReadTransport {
  readonly requests: MetaReadRequest[] = [];
  constructor(private readonly behavior: (request: MetaReadRequest) => Promise<Awaited<ReturnType<MetaReadTransport["get"]>>>) {}
  get(request: MetaReadRequest) { this.requests.push(request); return this.behavior(request); }
}

describe("Meta S1.3 partial read-sync", () => {
  it("plans independent inventory, creative/post and entity/date insight slices deterministically", () => {
    const first = plan();
    expect(first).toEqual(plan());
    expect(first.filter((slice) => slice.stream === "inventory")).toHaveLength(8);
    expect(first.filter((slice) => slice.stream === "creative_post")).toHaveLength(2);
    expect(first.filter((slice) => slice.stream === "insights")).toHaveLength(16);
    expect(first.find((slice) => slice.stream === "insights" && slice.entityLevel === "campaign")).toMatchObject({ dateStart: "2026-08-01", dateStop: "2026-08-02" });
  });

  it("does not duplicate an already processed snapshot and never makes a write request", async () => {
    const transport = new FixtureTransport(async (request) => ({ records: [{ id: `${request.stream}-${request.entityLevel}-${request.dateStart ?? "all"}`, state: "fixture" }], nextCursor: null, usageHeadroom: 0.8 }));
    const runtime = new MetaPartialReadSyncRuntime({ transport, now: fixedNow, random: () => 0.5 });
    const first = await runtime.run({ parentRunId: "run-1", workspaceId: "ws", connectionId: "conn", plan: plan() });
    const replay = await new MetaPartialReadSyncRuntime({ transport, store: runtime.store, now: fixedNow, random: () => 0.5 }).run({ parentRunId: "run-2", workspaceId: "ws", connectionId: "conn", plan: plan() });
    expect(first.parentRun.status).toBe("completed");
    expect(replay.inserted).toBe(0);
    expect(replay.unchanged).toBeGreaterThan(0);
    expect(runtime.store.values()).toHaveLength(first.inserted);
    expect(transport.requests.every((request) => request.method === "GET")).toBe(true);
    expect(first.writeNetworkCalls).toBe(0);
    expect(transport.requests[0]?.correlation).toMatchObject({ parentRunId: "run-1", accountId: "act_a" });
  });

  it("preserves completed slices and resumes only from the failed cursor", async () => {
    let failOnce = true;
    const transport = new FixtureTransport(async (request) => {
      if (request.stream === "inventory" && request.accountId === "act_a" && request.entityLevel === "campaign" && failOnce) { failOnce = false; throw new ConnectorError("transient", "fixture disconnect", false); }
      return { records: [{ id: `${request.accountId}-${request.stream}-${request.entityLevel}-${request.cursor ?? "start"}` }], nextCursor: request.stream === "inventory" && request.entityLevel === "account" && request.cursor === null ? "cursor-2" : null, usageHeadroom: 0.6 };
    });
    const runtime = new MetaPartialReadSyncRuntime({ transport, now: fixedNow });
    const partial = await runtime.run({ parentRunId: "resume-run", workspaceId: "ws", connectionId: "conn", plan: plan() });
    const inventory = partial.streamRuns.find((run) => run.stream === "inventory" && run.accountId === "act_a")!;
    expect(partial.parentRun.status).toBe("partial");
    expect(inventory.completedSliceIds).toContain("inventory:act_a:account:all:all");
    const callsBeforeResume = transport.requests.length;
    const resumed = await runtime.run({ parentRunId: "resume-run", workspaceId: "ws", connectionId: "conn", plan: plan() });
    expect(resumed.parentRun.status).toBe("completed");
    expect(transport.requests.slice(callsBeforeResume).some((request) => request.stream === "inventory" && request.entityLevel === "account")).toBe(false);
  });

  it("keeps another account's completed stream when one account is rate limited and adaptively reduces load", async () => {
    const limits: number[] = [];
    const transport = new FixtureTransport(async (request) => {
      limits.push(request.limit);
      if (request.accountId === "act_b" && request.stream === "creative_post") throw new ConnectorError("rate_limited", "rate limit", false);
      return { records: [{ id: `${request.accountId}-${request.stream}-${request.entityLevel}` }], nextCursor: request.stream === "inventory" && request.entityLevel === "account" && request.cursor === null ? "next" : null, usageHeadroom: request.stream === "inventory" ? 0.1 : 0.8 };
    });
    const result = await new MetaPartialReadSyncRuntime({ transport, now: fixedNow }).run({ parentRunId: "isolated", workspaceId: "ws", connectionId: "conn", plan: plan() });
    expect(result.streamRuns.find((run) => run.stream === "creative_post" && run.accountId === "act_a")?.status).toBe("completed");
    expect(result.streamRuns.find((run) => run.stream === "creative_post" && run.accountId === "act_b")?.status).toBe("partial");
    expect(limits).toContain(50);
  });

  it("bounds deterministic exponential retry and classifies the required failure reasons", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const transport = new FixtureTransport(async () => { attempts += 1; throw new ConnectorError("transient", "network disconnected", true); });
    const runtime = new MetaPartialReadSyncRuntime({ transport, now: fixedNow, maxAttempts: 3, random: () => 0.5, sleep: async (delay) => { delays.push(delay); } });
    await runtime.run({ parentRunId: "retry", workspaceId: "ws", connectionId: "conn", plan: plan().slice(0, 1) });
    expect(attempts).toBe(3); expect(delays).toEqual([100, 200]);
    expect(classifyMetaSyncError(new Error("HTTP 500"))).toMatchObject({ reason: "http_500", retryable: true });
    expect(classifyMetaSyncError(new Error("reduce-data payload"))).toMatchObject({ reason: "reduce_data", retryable: true });
    expect(classifyMetaSyncError(new Error("malformed response"))).toMatchObject({ reason: "malformed_response", retryable: false });
    expect(classifyMetaSyncError(Object.assign(new Error("timeout"), { name: "AbortError" }))).toMatchObject({ reason: "timeout", retryable: true });
  });

  it("returns a durable partial result at a server-owned page boundary", async () => {
    const snapshots: unknown[] = [];
    const persistence = {
      restore: async () => null,
      persist: async (_key: unknown, snapshot: unknown) => { snapshots.push(snapshot); },
    };
    const transport = new FixtureTransport(async () => ({ records: [{ id: "must-not-fetch" }], nextCursor: null, usageHeadroom: 0.5 }));
    const result = await new MetaPartialReadSyncRuntime({
      transport,
      persistence,
      now: fixedNow,
      deadlineAtEpochMs: fixedNow().valueOf(),
    }).run({ parentRunId: "bounded", workspaceId: "ws", connectionId: "conn", plan: plan().slice(0, 2) });

    expect(transport.requests).toEqual([]);
    expect(result.parentRun.status).toBe("partial");
    expect(result.streamRuns.every((stream) => stream.status === "partial")).toBe(true);
    expect(result.streamRuns.every((stream) => stream.error?.reason === "timeout")).toBe(true);
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("does not start a retry after the server-owned deadline has elapsed", async () => {
    let now = fixedNow().valueOf() - 1;
    const transport = new FixtureTransport(async () => {
      now = fixedNow().valueOf();
      throw Object.assign(new Error("temporary"), { name: "AbortError" });
    });
    const result = await new MetaPartialReadSyncRuntime({
      transport,
      now: () => new Date(now),
      deadlineAtEpochMs: fixedNow().valueOf(),
      maxAttempts: 3,
    }).run({ parentRunId: "deadline-retry", workspaceId: "ws", connectionId: "conn", plan: plan().slice(0, 1) });

    expect(transport.requests).toHaveLength(1);
    expect(result.streamRuns[0]?.status).toBe("partial");
    expect(result.streamRuns[0]?.error?.reason).toBe("timeout");
  });

  it("makes revision updates idempotently by source identity", async () => {
    const store = new InMemoryMetaSyncStore();
    let revision = 1;
    const transport = new FixtureTransport(async () => ({ records: [{ id: "same-source", revision }], nextCursor: null, usageHeadroom: 0.8 }));
    await new MetaPartialReadSyncRuntime({ transport, store, now: fixedNow }).run({ parentRunId: "v1", workspaceId: "ws", connectionId: "conn", plan: plan().slice(0, 1) });
    revision = 2;
    const revised = await new MetaPartialReadSyncRuntime({ transport, store, now: fixedNow }).run({ parentRunId: "v2", workspaceId: "ws", connectionId: "conn", plan: plan().slice(0, 1) });
    expect(revised.updated).toBe(1); expect(store.values()).toHaveLength(1);
  });
});
