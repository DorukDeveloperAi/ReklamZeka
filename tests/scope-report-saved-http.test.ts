import { describe, expect, it, vi } from "vitest";
import {
  createSavedScopeReportRevision,
  SavedScopeReportError,
} from "@/domain/slices/scope-report-saved";
import { createScopeReportSavedHttpHandlers } from "@/server/scope-report-saved-http";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const actorId = "22222222-2222-4222-a222-222222222222";
const query = Object.freeze({
  slice: "slice_yerli",
  start: "2026-08-01",
  end: "2026-08-18",
  granularity: "week" as const,
  level: "ad_set" as const,
  metric: null,
  action: "lead",
  sort: "entity" as const,
  direction: "desc" as const,
});
const revision = createSavedScopeReportRevision({
  workspaceId,
  reportRef: `scope_report_saved_${"a".repeat(24)}`,
  commandRef: `scope_report_save_${"b".repeat(64)}`,
  revisionNumber: 1,
  previousRevisionHash: "GENESIS",
  state: "active",
  label: "Haftalık lead",
  query,
  createdByActorId: actorId,
  createdAt: "2026-08-18T08:00:00.000Z",
});
const request = (
  method: "GET" | "POST",
  body?: unknown,
  intent = method === "GET"
    ? "scope-report-saved-list"
    : "scope-report-saved-save",
) =>
  new Request("http://localhost/api/scope-report-saved", {
    method,
    headers: {
      cookie: "local=x",
      "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": intent,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("saved scope report HTTP boundary", () => {
  it("lists and saves only through the server-bound tenant identity", async () => {
    const repository = {
      list: vi.fn(async () => [revision]),
      save: vi.fn(async () => ({ revision, replay: false })),
    };
    const identity = vi.fn(async () => ({ workspaceId, actorId }));
    const handlers = createScopeReportSavedHttpHandlers({
      repository: repository as never,
      identity,
    });
    const listed = await handlers.GET(request("GET"));
    expect(listed.status).toBe(200);
    expect((await listed.json()).items).toHaveLength(1);
    const saved = await handlers.POST(
      request("POST", {
        commandRef: revision.commandRef,
        reportRef: null,
        expectedVersion: null,
        label: revision.label,
        query,
        state: "active",
      }),
    );
    expect(saved.status).toBe(201);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, actorId }),
    );
  });

  it("rejects overrides, malformed bodies, wrong intent and conflicts", async () => {
    const repository = {
      list: vi.fn(),
      save: vi.fn(async () => {
        throw new SavedScopeReportError("conflict");
      }),
    };
    const handlers = createScopeReportSavedHttpHandlers({
      repository: repository as never,
      identity: async () => ({ workspaceId, actorId }),
    });
    expect(
      (
        await handlers.GET(
          new Request(
            "http://localhost/api/scope-report-saved?workspaceId=other",
            {
              headers: {
                cookie: "x",
                "sec-fetch-site": "same-origin",
                "x-reklamzeka-intent": "scope-report-saved-list",
              },
            },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handlers.POST(
          request("POST", { ...revision, workspaceId: "other" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handlers.POST(
          request(
            "POST",
            {
              commandRef: revision.commandRef,
              reportRef: null,
              expectedVersion: null,
              label: revision.label,
              query,
              state: "active",
            },
            "scope-report-saved-list",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handlers.POST(
          request("POST", {
            commandRef: revision.commandRef,
            reportRef: null,
            expectedVersion: null,
            label: revision.label,
            query,
            state: "active",
          }),
        )
      ).status,
    ).toBe(409);
  });
});
