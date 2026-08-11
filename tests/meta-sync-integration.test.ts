import { describe, expect, it, vi } from "vitest";
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
import type { MetaInsightSourcePagePersistencePort } from "@/connectors/meta/sync/insights-materialization";

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
    expect(calls[0]?.url.searchParams.get("time_increment")).toBe("1");
    expect(calls[0]?.url.searchParams.get("fields")?.split(",")).toContain("frequency");
    expect(calls[0]?.url.searchParams.get("action_breakdowns")).toBe("action_type");
    expect(calls[0]?.url.searchParams.get("use_account_attribution_setting")).toBe("true");
    expect(page).toMatchObject({
      nextCursor: "next-page",
      usageHeadroom: 0.75,
      fieldCatalogVersion: "meta-graph-v23-insight-capabilities/1.0.0",
    });
  });

  it("maps the canonical ad_set level to the Graph adset spelling through the capability plan", async () => {
    let graphLevel = "";
    const fetchImpl = async (input: string | URL) => {
      graphLevel = new URL(input).searchParams.get("level") ?? "";
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const transport = new MetaGraphSyncTransport(new MetaGraphClient("fixture-token", fetchImpl));
    await transport.get({
      method: "GET", stream: "insights", accountId: "act_fixture", entityLevel: "ad_set",
      dateStart: "2026-08-01", dateStop: "2026-08-01", cursor: null, limit: 5,
      correlation: { parentRunId: "run", streamRunId: "stream", accountId: "act_fixture", sliceId: "slice", cursorId: "cursor" },
    });
    expect(graphLevel).toBe("adset");
  });

  it("requests the live-verified v23 creative/post field catalog without rejected fields", async () => {
    let requestedFields = "";
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      requestedFields = url.searchParams.get("fields") ?? "";
      expect(init?.method).toBe("GET");
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const transport = new MetaGraphSyncTransport(new MetaGraphClient("fixture-token", fetchImpl));

    await transport.get({
      method: "GET", stream: "creative_post", accountId: "act_fixture", entityLevel: "ad",
      dateStart: null, dateStop: null, cursor: null, limit: 25,
      correlation: { parentRunId: "run", streamRunId: "stream", accountId: "act_fixture", sliceId: "slice", cursorId: "cursor" },
    });

    expect(requestedFields).toContain("effective_instagram_story_id");
    expect(requestedFields).toContain("effective_instagram_media_id");
    expect(requestedFields).toContain("call_to_action_type");
    expect(requestedFields).toContain("link_url");
    expect(requestedFields).not.toContain("link_description");
    expect(requestedFields).not.toContain("caption");
  });

  it("adds targeting only to the GET-only AdSet inventory catalog", async () => {
    const calls: Array<{ method: string | undefined; path: string; fields: string }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input); calls.push({ method: init?.method, path: url.pathname,
        fields: url.searchParams.get("fields") ?? "" });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const transport = new MetaGraphSyncTransport(new MetaGraphClient("fixture-token", fetchImpl));
    const request = (entityLevel: "campaign" | "ad_set") => transport.get({ method: "GET", stream: "inventory",
      accountId: "act_fixture", entityLevel, dateStart: null, dateStop: null, cursor: null, limit: 3,
      correlation: { parentRunId: "run", streamRunId: "stream", accountId: "act_fixture",
        sliceId: "slice", cursorId: "cursor" } });
    await request("campaign"); await request("ad_set");
    expect(calls).toHaveLength(2); expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls[0]).toMatchObject({ path: "/v23.0/act_fixture/campaigns" });
    expect(calls[0]?.fields.split(",")).not.toContain("targeting");
    expect(calls[1]).toMatchObject({ path: "/v23.0/act_fixture/adsets" });
    expect(calls[1]?.fields.split(",").filter((field) => field === "targeting")).toEqual(["targeting"]);
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

  it("writes an insight page before advancing its durable cursor and never retains its raw payload", async () => {
    const transactions = new TransactionFixture();
    const persistence = new TransactionBackedMetaSyncPersistenceAdapter(transactions);
    const writer: MetaInsightSourcePagePersistencePort = { writeSourcePage: vi.fn(async () => ({ inserted: 1, updated: 0, unchanged: 0, stale: 0, pageHash: "a".repeat(64) })) };
    const transport = new Transport(async () => ({ records: [{ account_id: "account-a", campaign_id: "campaign-a" }], nextCursor: null, usageHeadroom: 1 }));
    const result = await new MetaPartialReadSyncRuntime({ transport, persistence, insightPagePersistence: writer }).run({ ...key, plan: [slice] });
    expect(result.parentRun.status).toBe("completed");
    expect(writer.writeSourcePage).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-a", externalAccountId: "account-a", entityLevel: "campaign" }));
    expect(transactions.snapshot(key)?.records[0]?.payload).toEqual({});
  });
});
