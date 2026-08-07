import { describe, expect, it, vi } from "vitest";
import { ExistingPostPromotionProposalDraftService } from "@/application/existing-post-promotion-proposal-draft-service";
import { createExistingPostPromotionProposalDraftHttpHandler } from "@/server/existing-post-promotion-proposal-draft-http";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = { actor: { userId: "user_owner" }, workspaceId, workspaceRef: "workspace_local", readerRef: "reader_local" } as const;
const selection = { accountRef: "account_primary", adSetRef: "adset_primary", actorRef: "actor_primary", postRef: "post_primary",
  promotionTemplateRef: "template_primary", audiencePresetRef: "audience_primary", budgetPlanRef: "budget_primary",
  timeframeRef: "timeframe_primary", objectiveRef: "objective_primary", internalCategoryRef: "category_primary" } as const;
const ready = { status: "ready_for_approval_proposal", proposalPreview: { previewRef: "preview_primary" },
  authority: { canPersistProposal: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false } } as const;
const persisted = { contractVersion: "existing-post-promotion-proposal/2.0.0", outcome: "inserted", proposalRef: "bundle_primary",
  actionUnitRefs: ["unit_primary"], preflightRef: "promotion_preflight_aaaaaaaaaaaaaaaaaaaaaaaa", disposition: "approval_required", risk: "K4",
  authority: { canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false, canChangeTargeting: false } } as const;

function request(body: unknown = { selection }, extra: Record<string, string> = {}) { const text = JSON.stringify(body); return new Request(
  "http://localhost:3000/api/existing-post-promotion-preflight", { method: "POST", body: text, headers: { Host: "localhost:3000",
    Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin", Cookie: "__Host-rzka_local_session=opaque",
    "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(text)),
    "X-ReklamZeka-Intent": "existing-post-promotion-proposal-draft", ...extra } }); }

describe("existing-post proposal draft boundary", () => {
  it("re-evaluates exact refs and only then calls the server-private submitter", async () => {
    const preflight = { evaluate: vi.fn(async () => ready as never) }; const submitter = { submitResolved: vi.fn(async () => persisted) };
    const service = new ExistingPostPromotionProposalDraftService(preflight, submitter, [{ userId: "user_owner", workspaceId, role: "owner" }]);
    const response = await createExistingPostPromotionProposalDraftHttpHandler({ service, origin: "http://localhost:3000",
      resolvePrincipal: async () => principal })(request());
    expect(response.status).toBe(201); expect(preflight.evaluate).toHaveBeenCalledWith(principal, selection);
    expect(submitter.submitResolved).toHaveBeenCalledWith({ principal, selection });
    await expect(response.json()).resolves.toMatchObject({ result: { proposalRef: "bundle_primary", risk: "K4" },
      authority: { canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false } });
  });
  it("does not submit when preflight is not ready, viewer is unauthorized, or input is extended", async () => {
    const submitResolved = vi.fn(); const evaluate = vi.fn(async () => ({ ...ready, status: "unknown", proposalPreview: null }));
    const service = new ExistingPostPromotionProposalDraftService({ evaluate } as never, { submitResolved }, [{ userId: "user_owner", workspaceId, role: "owner" }]);
    expect((await createExistingPostPromotionProposalDraftHttpHandler({ service, origin: "http://localhost:3000", resolvePrincipal: async () => principal })(request())).status).toBe(409);
    expect((await createExistingPostPromotionProposalDraftHttpHandler({ service, origin: "http://localhost:3000", resolvePrincipal: async () => principal })(request({ selection: { ...selection, budgetMinor: 1 } }))).status).toBe(400);
    const viewer = new ExistingPostPromotionProposalDraftService({ evaluate: vi.fn() } as never, { submitResolved }, [{ userId: "user_owner", workspaceId, role: "viewer" }]);
    expect((await createExistingPostPromotionProposalDraftHttpHandler({ service: viewer, origin: "http://localhost:3000", resolvePrincipal: async () => principal })(request())).status).toBe(403);
    expect(submitResolved).not.toHaveBeenCalled();
  });
  it("rejects bearer/proxy/wrong intent before principal resolution", async () => {
    const resolvePrincipal = vi.fn(); const service = { draft: vi.fn() };
    for (const extra of [{ Authorization: "Bearer secret" }, { "X-Forwarded-For": "127.0.0.1" }, { "X-ReklamZeka-Intent": "approve" }] as Record<string, string>[])
      expect((await createExistingPostPromotionProposalDraftHttpHandler({ service: service as never, origin: "http://localhost:3000", resolvePrincipal })(request({ selection }, extra))).status).toBe(400);
    expect(resolvePrincipal).not.toHaveBeenCalled(); expect(service.draft).not.toHaveBeenCalled();
  });
});
