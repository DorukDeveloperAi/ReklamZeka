import { describe, expect, it, vi } from "vitest";

import { PolicyBundlePublicationError } from "@/application/policy-bundle-publication-service";
import { createPolicyBundlePublicationHttpHandler } from "@/server/policy-bundle-publication-http";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = Object.freeze({ actor: Object.freeze({ userId: "22222222-2222-4222-a222-222222222222" }),
  workspaceId, workspaceRef: "workspace_alpha", readerRef: "actor_owner" });
const proof = `presence_${"a".repeat(43)}`;
const unitRef = "policy_unit_aaaaaaaaaaaaaaaaaaaa";

function request(intent: string, body: unknown, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/policy-bundles`, { method: "POST", headers: {
    Host: "localhost:3000", Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
    Cookie: "__Host-rzka_local_session=opaque", "X-ReklamZeka-Intent": intent, ...extra,
  }, body: JSON.stringify(body) });
}
function harness() {
  const prepare = vi.fn(async () => ({ kind: "approval_policy" as const,
    policyRef: "approval_policy_existing_post", revision: 1, unitRef,
    action: "publish_approval_policy" as const }));
  const publish = vi.fn(async () => ({ contractVersion: "policy-bundle-publication/1.0.0",
    item: { kind: "approval_policy", policyRef: "approval_policy_existing_post", draftRevision: 1,
      publishedRevision: 2, state: "published", publishedAt: "2026-08-08T18:00:00.000Z" },
    authority: { canPublish: false, canDisable: false, canApproveAction: false,
      canGrant: false, canExecute: false, canWriteMeta: false } }));
  const issue = vi.fn(() => ({ proof, expiresAt: "2026-08-08T18:01:00.000Z" }));
  const confirmHumanPresence = vi.fn(async () => true);
  const resolvePrincipal = vi.fn(async () => principal);
  const POST = createPolicyBundlePublicationHttpHandler({ service: { prepare, publish } as never,
    store: { issue } as never, origin, resolvePrincipal, confirmHumanPresence,
    clock: () => "2026-08-08T18:00:00.000Z" });
  return { POST, prepare, publish, issue, confirmHumanPresence, resolvePrincipal };
}

describe("K4 policy publication HTTP boundary", () => {
  it("mints a short-lived proof only after the exact server-derived macOS ceremony binding", async () => {
    const api = harness();
    const response = await api.POST(request("policy-bundle-confirm-human-presence", {
      kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: 1,
    }));
    expect(response.status).toBe(200);
    expect(api.prepare).toHaveBeenCalledWith(principal, { kind: "approval_policy",
      policyRef: "approval_policy_existing_post", revision: 1 });
    expect(api.confirmHumanPresence).toHaveBeenCalledWith(expect.objectContaining({ request: expect.any(Request),
      workspaceId, actorRef: principal.readerRef, unitRef, action: "publish_approval_policy" }));
    expect(api.issue).toHaveBeenCalledWith({ workspaceId, actorRef: principal.readerRef, unitRef,
      action: "publish_approval_policy", now: "2026-08-08T18:00:00.000Z" });
    expect(await response.json()).toMatchObject({ challenge: { kind: "approval_policy", revision: 1,
      unitRef, proof }, authority: { canPublish: false, canExecute: false, canWriteMeta: false } });
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
  });

  it.each([
    ["policy-bundle-publish-approval-policy", "approval_policy"],
    ["policy-bundle-publish-guardrail-policy", "guardrail_policy"],
  ] as const)("derives %s kind from the exact intent and accepts no kind in the body", async (intent, kind) => {
    const api = harness(); const response = await api.POST(request(intent, {
      policyRef: "approval_policy_existing_post", revision: 1,
      reasonRef: "reason_human_reviewed", humanPresenceProof: proof,
    }));
    expect(response.status).toBe(200);
    expect(api.publish).toHaveBeenCalledWith(principal, { kind, policyRef: "approval_policy_existing_post",
      revision: 1, reasonRef: "reason_human_reviewed", humanPresenceProof: proof });
  });

  it("rejects proxy, bearer, cross-origin, missing-cookie, workspace and revision-header injection before ceremony", async () => {
    const api = harness(); const body = { kind: "approval_policy",
      policyRef: "approval_policy_existing_post", revision: 1 };
    const unsafe = [
      request("policy-bundle-confirm-human-presence", body, { "X-Forwarded-For": "127.0.0.1" }),
      request("policy-bundle-confirm-human-presence", body, { Authorization: "Bearer attacker" }),
      request("policy-bundle-confirm-human-presence", body, { Origin: "http://evil.invalid" }),
      request("policy-bundle-confirm-human-presence", body, { "X-Workspace-Id": workspaceId }),
      request("policy-bundle-confirm-human-presence", body, { "X-Policy-Revision": "1" }),
      request("policy-bundle-confirm-human-presence", body, { Cookie: "" }),
    ];
    for (const candidate of unsafe) expect((await api.POST(candidate)).status).toBe(400);
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.confirmHumanPresence).not.toHaveBeenCalled();
  });

  it("rejects caller workspace/hash/authority/revision shape injection and never falls through to publish", async () => {
    const api = harness();
    for (const body of [
      { kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: 1, workspaceId },
      { kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: 1, canonicalHash: "a".repeat(64) },
      { kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: 1, canPublish: true },
      { kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: "1" },
    ]) expect((await api.POST(request("policy-bundle-confirm-human-presence", body))).status).toBe(400);
    const publication = { policyRef: "approval_policy_existing_post", revision: 1,
      reasonRef: "reason_reviewed", humanPresenceProof: proof };
    expect((await api.POST(request("policy-bundle-publish-approval-policy", { ...publication,
      workspaceRef: "workspace_other" }))).status).toBe(400);
    expect((await api.POST(request("policy-bundle-publish-approval-policy", { ...publication,
      kind: "guardrail_policy" }))).status).toBe(400);
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.publish).not.toHaveBeenCalled();
  });

  it("does not mint a proof when the trusted ceremony is cancelled and redacts internal failures", async () => {
    const api = harness(); api.confirmHumanPresence.mockResolvedValueOnce(false);
    const denied = await api.POST(request("policy-bundle-confirm-human-presence", {
      kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: 1 }));
    expect(denied.status).toBe(403); expect(api.issue).not.toHaveBeenCalled();
    api.publish.mockRejectedValueOnce(new PolicyBundlePublicationError("store_rejected"));
    const failed = await api.POST(request("policy-bundle-publish-approval-policy", {
      policyRef: "approval_policy_existing_post", revision: 1,
      reasonRef: "reason_reviewed", humanPresenceProof: proof }));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toMatch(/canonical|database|token|secret/i);
  });
});
