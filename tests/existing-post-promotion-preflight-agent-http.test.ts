import { describe, expect, it, vi } from "vitest";

import {
  EXISTING_POST_PROMOTION_AGENT_TOOLS,
  ExistingPostPromotionPreflightAgentContract,
} from "@/application/existing-post-promotion-preflight-agent-contract";
import type { ExistingPostPromotionPreflightRequest, ExistingPostPromotionPreflightResult } from "@/application/existing-post-promotion-preflight-service";
import { createExistingPostPromotionPreflightHttpHandler } from "@/server/existing-post-promotion-preflight-http";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = Object.freeze({ actor: Object.freeze({ userId: "user_owner" }), workspaceId, workspaceRef: "workspace_local", readerRef: "reader_owner" });
const selection: ExistingPostPromotionPreflightRequest = {
  accountRef: "account_primary", actorRef: "actor_instagram", postRef: "post_existing",
  promotionTemplateRef: "template_messages", audiencePresetRef: "audience_doruk", budgetPlanRef: "budget_safe",
  timeframeRef: "timeframe_week", objectiveRef: "objective_messages", internalCategoryRef: "category_healthcare",
};
const result = {
  contractVersion: "existing-post-promotion-public-preflight/1.0.0", status: "blocked", selection, reasons: [], proposalPreview: null,
  authority: { ephemeral: true, canPersistProposal: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false },
} satisfies ExistingPostPromotionPreflightResult;

function request(body: unknown, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/meta/promotion-preflight`, { method: "POST", headers: {
    Host: "localhost:3000", Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
    "X-ReklamZeka-Intent": "existing-post-promotion-preflight", ...extra,
  }, body: JSON.stringify(body) });
}

function harness(role: "owner" | "viewer" = "viewer") {
  const evaluate = vi.fn(async () => result);
  const contract = new ExistingPostPromotionPreflightAgentContract({ evaluate }, [{ userId: principal.actor.userId, workspaceId, role }]);
  const resolvePrincipal = vi.fn(async () => principal);
  return { evaluate, resolvePrincipal, contract, POST: createExistingPostPromotionPreflightHttpHandler({ contract, origin, resolvePrincipal }) };
}

describe("existing-post promotion preflight agent and HTTP boundary", () => {
  it("exposes one read-only preflight tool with no raw targeting or creative inputs", () => {
    expect(EXISTING_POST_PROMOTION_AGENT_TOOLS).toHaveLength(1);
    const serialized = JSON.stringify(EXISTING_POST_PROMOTION_AGENT_TOOLS[0]!.inputSchema.properties);
    expect(EXISTING_POST_PROMOTION_AGENT_TOOLS[0]!.name).toBe("existing_post_promotion_preflight");
    expect(serialized).not.toMatch(/targeting|creativeBody|headline|image|video|execute|write_meta/i);
    expect(EXISTING_POST_PROMOTION_AGENT_TOOLS[0]!.inputSchema.additionalProperties).toBe(false);
  });

  it("allows a viewer to request the ephemeral preflight and keeps all authority false", async () => {
    const api = harness("viewer");
    const response = await api.POST(request({ selection }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only-preflight");
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(api.evaluate).toHaveBeenCalledWith(principal, selection);
    expect(await response.json()).toMatchObject({ authority: {
      readOnlyPreflight: true, canPersist: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false,
    } });
  });

  it("rejects unknown fields, raw payloads, wildcard/bulk refs and workspace/account identity overrides before service", async () => {
    const api = harness();
    for (const body of [
      { selection: { ...selection, targeting: {} } },
      { selection: { ...selection, creative: { body: "new" } } },
      { selection: { ...selection, workspaceId } },
      { selection: [{ ...selection }] },
      { selection: { ...selection, postRef: "*" } },
      { selection, approve: true },
    ]) expect((await api.POST(request(body))).status).toBe(400);
    expect(api.evaluate).not.toHaveBeenCalled();
  });

  it("rejects CSRF, proxy, wrong intent, malformed content length and chunked bodies", async () => {
    const api = harness();
    const candidates = [
      request({ selection }, { Origin: "http://evil.invalid" }),
      request({ selection }, { "X-Forwarded-For": "127.0.0.1" }),
      request({ selection }, { "X-ReklamZeka-Intent": "promote-now" }),
      request({ selection }, { "Content-Length": "4e3" }),
      request({ selection }, { "Transfer-Encoding": "chunked" }),
    ];
    for (const candidate of candidates) expect((await api.POST(candidate)).status).toBe(400);
    expect(api.resolvePrincipal).not.toHaveBeenCalled();
  });

  it("redacts source failures and explicitly disables persistence, execution and Meta write", async () => {
    const api = harness();
    api.evaluate.mockRejectedValueOnce(new Error("Graph token secret internal payload"));
    const response = await api.POST(request({ selection }));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.authority).toEqual({ canPersist: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false });
    expect(JSON.stringify(payload)).not.toMatch(/Graph token|secret|internal payload/);
  });
});
