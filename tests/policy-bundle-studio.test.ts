import { describe, expect, it, vi } from "vitest";

import { PolicyBundleStudioService, type ApprovalPolicyDraftRequest,
  type GuardrailPolicyDraftRequest } from "@/application/policy-bundle-studio-service";
import { publishApprovalPolicy, type ApprovalPolicyDefinitionRevision } from "@/domain/actions/approval-policy-registry";
import { createPolicyBundleStudioHttpHandlers } from "@/server/policy-bundle-studio-http";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = Object.freeze({ actor: Object.freeze({ userId: "22222222-2222-4222-a222-222222222222" }),
  workspaceId, workspaceRef: "workspace_alpha", readerRef: "actor_local_owner" });
const catalog = Object.freeze({ accounts: [{ ref: "account_doruk", label: "Doruk Hospital" }], actors: [], posts: [],
  adSets: [{ ref: "adset_doruk_leads", label: "TR · Leads", accountRef: "account_doruk", campaignRef: "campaign_doruk" }],
  templates: [], audiencePresets: [], internalCategories: [{ ref: "category_hair", label: "Saç ekimi" }],
  objectives: [], budgetPlans: [], timeframes: [] });
const approvalRequest = { kind: "approval_policy",
  policyRef: "approval_policy_existing_post", requesterRoles: ["owner", "admin", "analyst"],
  approverRoles: ["owner", "admin"], grantConsumerRoles: ["owner"], separationOfDuties: true,
  maximumProtectionEvidenceAgeSeconds: 86_400, maximumProposalLifetimeSeconds: 86_400,
  maximumGrantLifetimeSeconds: 900, effectiveFrom: "2026-08-08T12:00:00.000Z", expiresAt: null } satisfies ApprovalPolicyDraftRequest;
const guardrailRequest = { kind: "guardrail_policy",
  policyRef: "guardrail_existing_post_doruk", accountRef: "account_doruk", campaignRef: "campaign_doruk",
  adSetRef: "adset_doruk_leads", internalCategoryRefs: ["category_hair"], denyAction: false,
  denyClauseRef: null, effectiveFrom: "2026-08-08T12:00:00.000Z", expiresAt: null,
  sourceGuidanceRefs: [] } satisfies GuardrailPolicyDraftRequest;

function harness(role: "owner" | "admin" | "analyst" | "viewer" = "owner") {
  const approvals: unknown[] = []; const guardrails: unknown[] = [];
  const approvalRepo = { listArtifacts: vi.fn(async () => approvals), latestArtifact: vi.fn(async (ref: string) =>
    [...approvals].reverse().find((item) => (item as { policyRef: string }).policyRef === ref) ?? null),
  append: vi.fn(async (item: unknown) => { approvals.push(item); }) };
  const guardrailRepo = { listArtifacts: vi.fn(async () => guardrails), latestArtifact: vi.fn(async (ref: string) =>
    [...guardrails].reverse().find((item) => (item as { policyRef: string }).policyRef === ref) ?? null),
  append: vi.fn(async (item: unknown) => { guardrails.push(item); }) };
  const autonomy = { resolve: vi.fn(async () => [{ ruleRef: "autonomy_workspace", workspaceRef: principal.workspaceRef,
    scope: { level: "workspace" as const, ref: principal.workspaceRef }, mode: "approval_only" as const,
    state: "published" as const, effectiveFrom: "2026-08-08T00:00:00.000Z", expiresAt: null,
    killSwitch: false, maximumActionsPerRun: 1 }]) };
  const source = { list: vi.fn(async () => catalog) };
  const service = new PolicyBundleStudioService(approvalRepo as never, guardrailRepo as never, autonomy, source,
    [{ userId: principal.actor.userId, workspaceId, role }], () => "2026-08-08T12:30:00.000Z");
  return { service, approvals, guardrails, approvalRepo, guardrailRepo, source };
}

describe("K4 Policy Bundle Studio read + draft", () => {
  it("shows an empty source-backed bundle without demo policies or false readiness", async () => {
    const result = await harness().service.list(principal);
    expect(result).toMatchObject({ approvalPolicies: [], guardrails: [], readiness: {
      approvalPolicy: "missing", guardrail: "missing", workspaceAutonomy: "published_approval_only",
      authenticEvidence: "evaluated_per_proposal", compatibility: "evaluated_per_selection",
      policyBundleReady: false, proposalReady: false },
    authority: { canDraft: true, canPublish: false, canApproveAction: false, canExecute: false, canWriteMeta: false } });
    expect(result.scopeCatalog).toEqual({ accounts: catalog.accounts, adSets: catalog.adSets,
      internalCategories: catalog.internalCategories });
  });

  it("creates a normalized approval-only K4 draft while keeping publication and action authority closed", async () => {
    const api = harness("analyst");
    const result = await api.service.createDraft(principal, approvalRequest);
    expect(result.item).toMatchObject({ kind: "approval_policy", revision: 1, state: "draft",
      requesterRoles: ["admin", "analyst", "owner"], approverRoles: ["admin", "owner"],
      maximumProtectionEvidenceAgeSeconds: 86_400, maximumProposalLifetimeSeconds: 86_400 });
    expect(api.approvalRepo.append).toHaveBeenCalledTimes(1);
    expect(api.approvals[0]).toMatchObject({ workspaceRef: principal.workspaceRef,
      applicability: { actionType: "existing_post_promotion", risk: "K4" }, policy: { autonomyMode: "approval_only" },
      state: "draft", authority: { canApprove: false, canGrant: false, canExecute: false, canWriteMeta: false } });
    expect(JSON.stringify(result)).not.toMatch(/canonicalHash|policyHash|actor_local_owner/i);
  });

  it("binds a guardrail to one server-catalog account/campaign/adset chain and rejects foreign refs", async () => {
    const api = harness();
    await expect(api.service.createDraft(principal, guardrailRequest)).resolves.toMatchObject({ item: {
      kind: "guardrail_policy", state: "draft", accountRefs: ["account_doruk"], campaignRefs: ["campaign_doruk"],
      entities: [{ level: "adset", ref: "adset_doruk_leads" }], internalCategoryRefs: ["category_hair"], geoRefs: [] } });
    await expect(harness().service.createDraft(principal, { ...guardrailRequest, adSetRef: "adset_foreign" }))
      .rejects.toMatchObject({ code: "scope_unavailable" });
  });

  it("allows viewer reads and denies both draft kinds", async () => {
    const service = harness("viewer").service;
    await expect(service.list(principal)).resolves.toMatchObject({ approvalPolicies: [], authority: { canDraft: false } });
    await expect(service.createDraft(principal, approvalRequest)).rejects.toMatchObject({ status: 403 });
    await expect(service.createDraft(principal, guardrailRequest)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a second immutable draft instead of overwriting it", async () => {
    const api = harness(); await api.service.createDraft(principal, approvalRequest);
    await expect(api.service.createDraft(principal, approvalRequest)).rejects.toMatchObject({ code: "draft_exists" });
    expect(api.approvalRepo.append).toHaveBeenCalledTimes(1);
  });

  it("marks multiple active published ApprovalPolicies ambiguous instead of proposal-ready", async () => {
    const api = harness();
    await api.service.createDraft(principal, approvalRequest);
    const firstDraft = api.approvals[0] as ApprovalPolicyDefinitionRevision;
    api.approvals.push(publishApprovalPolicy({ draft: firstDraft, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_policy_one", reasonRef: "reason_reviewed_one", publishedAt: "2026-08-08T12:01:00.000Z" }));
    await api.service.createDraft(principal, { ...approvalRequest, policyRef: "approval_policy_other" });
    const secondDraft = api.approvals[2] as ApprovalPolicyDefinitionRevision;
    api.approvals.push(publishApprovalPolicy({ draft: secondDraft, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_policy_two", reasonRef: "reason_reviewed_two", publishedAt: "2026-08-08T12:02:00.000Z" }));
    await expect(api.service.list(principal)).resolves.toMatchObject({ readiness: {
      approvalPolicy: "ambiguous", proposalReady: false } });
  });

  it("uses exact cookie-only intents and rejects caller workspace/revision/authority injection", async () => {
    const service = harness().service;
    const handlers = createPolicyBundleStudioHttpHandlers({ service, resolvePrincipal: async () => principal });
    const headers = { Host: "localhost:3000", Cookie: "__Host-rzka_local_session=opaque", Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
      "X-ReklamZeka-Intent": "policy-bundle-create-draft" };
    expect((await handlers.POST(new Request("http://localhost:3000/api/policy-bundles", { method: "POST", headers,
      body: JSON.stringify(approvalRequest) }))).status).toBe(201);
    for (const unsafe of [{ ...guardrailRequest, workspaceId }, { ...guardrailRequest, revision: 9 },
      { ...guardrailRequest, canPublish: true }, { ...guardrailRequest, rawTargeting: {} }]) {
      expect((await handlers.POST(new Request("http://localhost:3000/api/policy-bundles", { method: "POST", headers,
        body: JSON.stringify(unsafe) }))).status).toBe(400);
    }
    const get = await handlers.GET(new Request("http://localhost:3000/api/policy-bundles", { headers: {
      Host: "localhost:3000", Cookie: "__Host-rzka_local_session=opaque", "Sec-Fetch-Site": "same-origin",
      "X-ReklamZeka-Intent": "policy-bundle-read" } }));
    expect(get.status).toBe(200); expect(get.headers.get("x-reklamzeka-action-authority")).toBe("none");
  });
});
