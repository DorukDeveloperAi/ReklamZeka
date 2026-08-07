import { describe, expect, it } from "vitest";
import {
  persistedMetaSyncStream,
  TransactionBackedMetaSyncPersistenceAdapter,
  type MetaSyncDurableKey,
  type MetaSyncPersistenceTransaction,
  type MetaSyncTransactionManager,
} from "@/connectors/meta/sync/persistence-adapter";
import { MetaPartialReadSyncRuntime, type MetaSyncStoreSnapshot } from "@/connectors/meta/sync/runtime";
import type { MetaReadRequest, MetaReadTransport, MetaSyncSlice } from "@/connectors/meta/sync/types";
import { MetaGraphClient } from "@/connectors/meta/graph-client";
import { MetaGraphSyncTransport } from "@/connectors/meta/sync/graph-transport";

class TransactionFixture implements MetaSyncTransactionManager {
  private snapshots = new Map<string, MetaSyncStoreSnapshot>();
  commits = 0;
  failNextSave = false;

  async transaction<T>(work: (transaction: MetaSyncPersistenceTransaction) => Promise<T>): Promise<T> {
    const staged = new Map([...this.snapshots].map(([key, value]) => [key, structuredClone(value)]));
    const transaction: MetaSyncPersistenceTransaction = {
      load: async (key) => staged.get(this.key(key)) ?? null,
      save: async (key, snapshot) => {
        if (this.failNextSave) { this.failNextSave = false; throw new Error("fixture transaction rollback"); }
        staged.set(this.key(key), structuredClone(snapshot));
      },
    };
    const result = await work(transaction);
    this.snapshots = staged;
    this.commits += 1;
    return result;
  }

  snapshot(key: MetaSyncDurableKey): MetaSyncStoreSnapshot | undefined { return this.snapshots.get(this.key(key)); }
  private key(key: MetaSyncDurableKey): string { return `${key.workspaceId}:${key.connectionId}:${key.parentRunId}`; }
}

const slice: MetaSyncSlice = {
  id: "insights:account-a:campaign:2026-08-01:2026-08-01",
  stream: "insights",
  accountId: "account-a",
  entityLevel: "campaign",
  dateStart: "2026-08-01",
  dateStop: "2026-08-01",
  pageSize: 50,
};
const key = { parentRunId: "run-a", workspaceId: "workspace-a", connectionId: "connection-a" } as const;

class Transport implements MetaReadTransport {
  readonly requests: MetaReadRequest[] = [];
  constructor(private readonly respond: (request: MetaReadRequest) => ReturnType<MetaReadTransport["get"]>) {}
  get(request: MetaReadRequest) { this.requests.push(request); return this.respond(request); }
}

describe("Meta S1.3 runtime persistence integration", () => {
  it("maps the content stream to the persisted DB enum without losing its runtime meaning", () => {
    expect(persistedMetaSyncStream("creative_post")).toBe("creative");
    expect(persistedMetaSyncStream("inventory")).toBe("inventory");
  });

  it("binds planner requests to GET-only Graph edges and propagates usage headroom", async () => {
    const calls: Array<{ url: URL; method: string | undefined }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, method: init?.method });
      return new Response(JSON.stringify({ data: [{ campaign_id: "campaign-1", spend: "10.00" }], paging: { cursors: { after: "next-page" } } }), {
        status: 200,
        headers: { "content-type": "application/json", "x-app-usage": JSON.stringify({ call_count: 25 }) },
      });
    };
    const transport = new MetaGraphSyncTransport(new MetaGraphClient("fixture-token", fetchImpl));
    const page = await transport.get({
      method: "GET", stream: "insights", accountId: "act_fixture", entityLevel: "campaign",
      dateStart: "2026-08-01", dateStop: "2026-08-01", cursor: null, limit: 50,
      correlation: { parentRunId: "run", streamRunId: "stream", accountId: "act_fixture", sliceId: "slice", cursorId: "cursor" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url.pathname).toBe("/v23.0/act_fixture/insights");
    expect(calls[0]?.url.searchParams.get("level")).toBe("campaign");
    expect(page).toMatchObject({ nextCursor: "next-page", usageHeadroom: 0.75 });
  });

  it("restores a durable cursor in a fresh runtime and resumes without replaying page one", async () => {
    const transactions = new TransactionFixture();
    const persistence = new TransactionBackedMetaSyncPersistenceAdapter(transactions);
    let failSecondPage = true;
    const firstTransport = new Transport(async (request) => {
      if (request.cursor === "page-2" && failSecondPage) { failSecondPage = false; throw new Error("network disconnected"); }
      return { records: [{ id: request.cursor ?? "page-1" }], nextCursor: request.cursor ? null : "page-2", usageHeadroom: 0.5 };
    });
    const first = await new MetaPartialReadSyncRuntime({ transport: firstTransport, persistence, maxAttempts: 1 }).run({ ...key, plan: [slice] });
    expect(first.parentRun.status).toBe("partial");
    expect(transactions.snapshot(key)?.records).toHaveLength(1);

    const resumedTransport = new Transport(async (request) => ({ records: [{ id: request.cursor ?? "unexpected-page-1" }], nextCursor: null, usageHeadroom: 0.5 }));
    const resumed = await new MetaPartialReadSyncRuntime({ transport: resumedTransport, persistence }).run({ ...key, plan: [slice] });
    expect(resumed.parentRun.status).toBe("completed");
    expect(resumedTransport.requests.map((request) => request.cursor)).toEqual(["page-2"]);
    expect(transactions.snapshot(key)?.records).toHaveLength(2);
  });

  it("does not expose a partially saved snapshot when a transaction rolls back", async () => {
    const transactions = new TransactionFixture();
    const persistence = new TransactionBackedMetaSyncPersistenceAdapter(transactions);
    transactions.failNextSave = true;
    const transport = new Transport(async () => ({ records: [], nextCursor: null, usageHeadroom: 1 }));
    await expect(new MetaPartialReadSyncRuntime({ transport, persistence }).run({ ...key, plan: [slice] })).rejects.toThrow("transaction rollback");
    expect(transactions.snapshot(key)).toBeUndefined();
  });
});
