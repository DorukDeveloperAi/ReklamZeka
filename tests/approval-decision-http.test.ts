import { describe, expect, it, vi } from "vitest";

import { ApprovalDecisionError } from "@/application/approval-decision-service";
import { LOCAL_SESSION_COOKIE } from "@/security/local-session-capability";
import { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";
import {
  createApprovalDecisionPostHandler,
  createHumanPresenceChallengePostHandler,
} from "@/server/approval-decision-http";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const unitRef = "action_unit_aaaaaaaaaaaaaaaaaaaa";
const proof = `presence_${"a".repeat(43)}`;
const context = Object.freeze({
  principal: Object.freeze({ actor: Object.freeze({ userId }), workspaceId, workspaceRef: "workspace_local", readerRef: "actor_owner" }),
  membership: Object.freeze({ userId, workspaceId, role: "owner" as const }),
});

function request(intent: string, body: unknown, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/approval-queue`, {
    method: "POST",
    headers: {
      Host: "localhost:3000",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      "X-ReklamZeka-Intent": intent,
      Cookie: `${LOCAL_SESSION_COOKIE}=opaque_cookie_only`,
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

function success() {
  return Object.freeze({
    version: "approval-decision-service/1.0.0" as const,
    decision: Object.freeze({ unitRef, state: "approved" as const, reasonCode: "reviewed", decidedAt: "2026-08-07T19:00:00.000Z" }),
    authority: Object.freeze({ approvalRecorded: true as const, canGrant: false as const, canExecute: false as const, canWriteMeta: false as const }),
  });
}

describe("Approval decision local HTTP boundary", () => {
  it("accepts one exact ActionUnit decision with a separate decide scope and no execution authority", async () => {
    const decide = vi.fn(async () => success());
    const resolveDecisionContext = vi.fn(async () => context);
    const POST = createApprovalDecisionPostHandler({ service: { decide }, origin, resolveDecisionContext });
    const response = await POST(request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(resolveDecisionContext).toHaveBeenCalledWith(expect.any(Request), "approval_queue:decide");
    expect(decide).toHaveBeenCalledWith({ ...context, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: proof });
    expect(await response.json()).toEqual(success());
  });

  it.each([
    ["approval-queue-approve", "approve"],
    ["approval-queue-reject", "reject"],
    ["approval-queue-defer", "defer"],
    ["approval-queue-request-changes", "request_changes"],
  ] as const)("binds %s to only %s", async (intent, kind) => {
    const decide = vi.fn(async () => success());
    const POST = createApprovalDecisionPostHandler({ service: { decide }, origin, resolveDecisionContext: async () => context });
    expect((await POST(request(intent, { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }))).status).toBe(200);
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ unitRef, kind }));
  });

  it("rejects CSRF, proxies, bearer credentials, missing cookies, and non-exact origins before context resolution", async () => {
    const resolveDecisionContext = vi.fn(async () => context);
    const POST = createApprovalDecisionPostHandler({ service: { decide: vi.fn() }, origin, resolveDecisionContext });
    const candidates = [
      request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }, { Origin: "http://evil.invalid" }),
      request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }, { "X-Forwarded-For": "127.0.0.1" }),
      request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }, { Authorization: "Bearer attacker" }),
      request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }, { "Sec-Fetch-Site": "cross-site" }),
    ];
    const noCookie = request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof });
    noCookie.headers.delete("cookie");
    candidates.push(noCookie);
    for (const candidate of candidates) expect((await POST(candidate)).status).toBe(400);
    expect(resolveDecisionContext).not.toHaveBeenCalled();
  });

  it("rejects wildcard/bundle/bulk decisions, extra fields, malformed length, and chunked bodies", async () => {
    const resolveDecisionContext = vi.fn(async () => context);
    const POST = createApprovalDecisionPostHandler({ service: { decide: vi.fn() }, origin, resolveDecisionContext });
    const badBodies = [
      { unitRef: "*", reasonCode: "reviewed", humanPresenceProof: proof },
      { unitRef: "action_bundle_bbbbbbbbbbbbbbbbbbbb", reasonCode: "reviewed", humanPresenceProof: proof },
      { unitRefs: [unitRef], reasonCode: "reviewed", humanPresenceProof: proof },
      { unitRef, reasonCode: "reviewed", humanPresenceProof: proof, approveAll: true },
    ];
    for (const candidate of badBodies) expect((await POST(request("approval-queue-approve", candidate))).status).toBe(400);
    expect((await POST(request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }, { "Content-Length": "2e3" }))).status).toBe(400);
    expect((await POST(request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }, { "Transfer-Encoding": "chunked" }))).status).toBe(400);
    expect(resolveDecisionContext).not.toHaveBeenCalled();
  });

  it("redacts source failures and always declares Meta write disabled", async () => {
    const POST = createApprovalDecisionPostHandler({
      service: { decide: async () => { throw new Error("postgres://secret@private/table"); } },
      origin,
      resolveDecisionContext: async () => context,
    });
    const response = await POST(request("approval-queue-approve", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.authority).toEqual({ canExecute: false, canWriteMeta: false });
    expect(JSON.stringify(payload)).not.toMatch(/postgres|secret|private/);
  });

  it("mints a short-lived proof only after an injected exact human ceremony", async () => {
    const store = new SingleUseHumanPresenceChallengeStore();
    const confirmHumanPresence = vi.fn(async () => true);
    const POST = createHumanPresenceChallengePostHandler({
      store,
      origin,
      clock: () => "2026-08-07T19:00:00.000Z",
      resolveDecisionContext: async () => context,
      confirmHumanPresence,
    });
    const response = await POST(request("approval-queue-confirm-human-presence", { unitRef, action: "reject" }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      challenge: { unitRef, action: "reject", expiresAt: "2026-08-07T19:01:00.000Z" },
      authority: { canGrant: false, canExecute: false, canWriteMeta: false },
    });
    expect(payload.challenge.proof).toMatch(/^presence_/);
    expect(confirmHumanPresence).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, actorRef: "actor_owner", unitRef, action: "reject" }));
  });

  it("does not let same-origin JavaScript mint a proof when the trusted ceremony denies it", async () => {
    const store = new SingleUseHumanPresenceChallengeStore();
    const POST = createHumanPresenceChallengePostHandler({
      store, origin, resolveDecisionContext: async () => context, confirmHumanPresence: async () => false,
    });
    const response = await POST(request("approval-queue-confirm-human-presence", { unitRef, action: "approve" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "human_presence_rejected" }, authority: { canExecute: false, canWriteMeta: false } });
  });

  it("maps stale authorization without exposing internal state", async () => {
    const POST = createApprovalDecisionPostHandler({
      service: { decide: async () => { throw new ApprovalDecisionError("human_presence_rejected"); } },
      origin, resolveDecisionContext: async () => context,
    });
    const response = await POST(request("approval-queue-reject", { unitRef, reasonCode: "reviewed", humanPresenceProof: proof }));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("authorizationRef");
  });
});
