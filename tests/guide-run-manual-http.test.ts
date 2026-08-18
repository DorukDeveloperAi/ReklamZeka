import { describe, expect, it, vi } from "vitest";

import { createGuideRunManualHttpHandler } from "@/server/guide-run-manual-http";

const workspaceId = "22222222-2222-4222-a222-222222222222";
const guideId = "33333333-3333-4333-a333-333333333333";
const revisionId = "44444444-4444-4444-a444-444444444444";
const principal = {
  actor: { userId: "11111111-1111-4111-a111-111111111111" },
  workspaceId,
  workspaceRef: "workspace_1234567890abcdef",
  readerRef: "reader_local",
} as const;
const request = (body: unknown, extra: HeadersInit = {}) =>
  new Request("http://localhost:3000/api/guide-runs/manual", {
    method: "POST",
    headers: {
      cookie: "session=x",
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-reklamzeka-intent": "guide-run-manual",
      ...extra,
    },
    body: JSON.stringify(body),
  });

describe("manual Guide run HTTP", () => {
  it("derives request, clock and lease server-side and returns closed authority", async () => {
    const run = vi.fn(async () => ({
      runRef: `guide_run_${"a".repeat(64)}`,
      state: "completed",
      replay: false,
    }));
    const handler = createGuideRunManualHttpHandler({
      worker: { run },
      resolvePrincipal: async () => ({
        principal,
        membership: {
          userId: principal.actor.userId,
          workspaceId,
          role: "owner",
        },
      }),
      clock: () => new Date("2026-08-18T12:00:00.000Z"),
      leaseToken: () => "55555555-5555-4555-a555-555555555555",
    });
    const response = await handler(
      request({ guideId, revisionId, commandRef: "manual_click_one" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      contractVersion: "guide-run-manual-result/1.0.0",
      runRef: `guide_run_${"a".repeat(64)}`,
      state: "completed",
      replay: false,
      authority: { canApprove: false, canExecute: false, canWriteMeta: false },
    });
    expect(run).toHaveBeenCalledWith({
      workspaceId,
      guideId,
      revisionId,
      requestRef: expect.stringMatching(/^request_[a-f0-9]{64}$/),
      now: "2026-08-18T12:00:00.000Z",
      leaseToken: "55555555-5555-4555-a555-555555555555",
      leaseUntil: "2026-08-18T12:05:00.000Z",
    });
  });

  it("rejects analyst, bearer/workspace overrides, cross-origin and extra fields before worker access", async () => {
    const run = vi.fn();
    const analyst = createGuideRunManualHttpHandler({
      worker: { run },
      resolvePrincipal: async () => ({
        principal,
        membership: {
          userId: principal.actor.userId,
          workspaceId,
          role: "analyst",
        },
      }),
    });
    expect(
      (
        await analyst(
          request({ guideId, revisionId, commandRef: "manual_click_one" }),
        )
      ).status,
    ).toBe(403);
    const owner = createGuideRunManualHttpHandler({
      worker: { run },
      resolvePrincipal: async () => ({
        principal,
        membership: {
          userId: principal.actor.userId,
          workspaceId,
          role: "owner",
        },
      }),
    });
    expect(
      (
        await owner(
          request(
            { guideId, revisionId, commandRef: "manual_click_one" },
            { authorization: "Bearer x" },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await owner(
          request(
            { guideId, revisionId, commandRef: "manual_click_one" },
            { "x-workspace-id": workspaceId },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await owner(
          request(
            { guideId, revisionId, commandRef: "manual_click_one" },
            { origin: "https://evil.test" },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await owner(
          request({
            guideId,
            revisionId,
            commandRef: "manual_click_one",
            workspaceId,
          }),
        )
      ).status,
    ).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
