import { describe, expect, it, vi } from "vitest";

import { createManualMetaReadSyncHttpHandler } from "@/server/meta-read-sync-manual-http";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const request = (headers: HeadersInit = {}) => new Request(`${origin}/api/meta/read-sync`, { method: "POST", headers: {
  host: "localhost:3000", origin, "sec-fetch-site": "same-origin", cookie: "__Host-rzka_local_session=safe",
  "x-reklamzeka-intent": "meta-read-sync-manual", "content-length": "0", ...headers,
} });
const streamedRequest = (chunks: readonly Uint8Array[]) => new Request(`${origin}/api/meta/read-sync`, {
  method: "POST", headers: { host: "localhost:3000", origin, "sec-fetch-site": "same-origin",
    cookie: "__Host-rzka_local_session=safe", "x-reklamzeka-intent": "meta-read-sync-manual" },
  body: new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }),
  duplex: "half",
} as RequestInit);
const result = Object.freeze({ version: "meta-read-sync-schedule-worker/1.0.0", now: "2026-08-08T04:00:00.000Z",
  batchSize: 1, dueCount: 1, completedCount: 1, partialCount: 0, failedCount: 0, duplicateCount: 0, items: [],
  actionAuthority: "none" as const, writeNetworkCalls: 0 as const });

describe("manual Meta read-sync HTTP boundary", () => {
  it("derives workspace server-side and returns only aggregate no-write evidence", async () => {
    const run = vi.fn(async () => result);
    const handler = createManualMetaReadSyncHttpHandler({ workspaceId: vi.fn(async () => workspaceId), run });
    const response = await handler(request());
    expect(response.status).toBe(202); expect(run).toHaveBeenCalledWith(workspaceId);
    expect(await response.json()).toMatchObject({ status: "accepted", metaWriteCalls: 0, actionAuthority: "none" });
    expect(response.headers.get("X-ReklamZeka-Meta-Write")).toBe("disabled");
  });
  it("rejects body, caller scope and cross-origin/header injection before workspace resolution", async () => {
    const workspace = vi.fn(async () => workspaceId); const handler = createManualMetaReadSyncHttpHandler({ workspaceId: workspace, run: vi.fn() });
    for (const candidate of [
      new Request(`${origin}/api/meta/read-sync?workspace=${workspaceId}`, { method: "POST" }),
      request({ "x-workspace-id": workspaceId }), request({ authorization: "Bearer private" }),
      request({ origin: "http://evil.invalid" }), request({ "content-length": "1" }),
    ]) expect((await handler(candidate)).status).toBe(400);
    expect(workspace).not.toHaveBeenCalled();
  });
  it("accepts a Next-like empty unknown-length stream but rejects any streamed byte", async () => {
    const run = vi.fn(async () => result); const handler = createManualMetaReadSyncHttpHandler({ workspaceId: async () => workspaceId, run });
    expect((await handler(streamedRequest([]))).status).toBe(202);
    expect((await handler(streamedRequest([new Uint8Array([1])]))).status).toBe(400);
    expect(run).toHaveBeenCalledOnce();
  });
});
