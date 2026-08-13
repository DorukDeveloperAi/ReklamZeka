import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createApprovalPolicyDraftBody, createGuardrailPolicyDraftBody,
  PolicyBundleStudioSurface, runPolicyPublicationCeremony } from "@/app/dashboard/policy-bundle-studio-panel";
import type { PolicyBundleStudioResult } from "@/application/policy-bundle-studio-service";

const result: PolicyBundleStudioResult = {
  contractVersion: "policy-bundle-studio/1.1.0", approvalPolicies: [], guardrails: [],
  scopeCatalog: { accounts: [{ ref: "account_doruk", label: "Doruk Hospital" }],
    adSets: [{ ref: "adset_doruk", label: "TR Leads", accountRef: "account_doruk", campaignRef: "campaign_doruk" }],
    internalCategories: [{ ref: "category_hair", label: "Saç ekimi" }] },
  readiness: { approvalPolicy: "missing", guardrail: "missing", workspaceAutonomy: "missing",
    authenticEvidence: "evaluated_per_proposal", compatibility: "evaluated_per_selection",
    policyBundleReady: false, proposalReady: false },
  authority: { canDraft: true, canStartPublicationCeremony: true, canPublish: false, canDisable: false, canApproveAction: false,
    canGrant: false, canExecute: false, canWriteMeta: false },
};

describe("K4 Policy Bundle dashboard", () => {
  it("renders source-backed empty readiness without fake business defaults or action controls", () => {
    const html = renderToStaticMarkup(createElement(PolicyBundleStudioSurface, { result, onReload: vi.fn() }));
    expect(html).toContain("Politika kapısı hazır değil"); expect(html).toContain("NOT READY");
    expect(html).toContain("Compatibility"); expect(html).toContain("Seçim anında");
    expect(html).toContain("Doruk Hospital"); expect(html).toContain("Saç ekimi");
    expect(html).toContain("Kampanya ref"); expect(html).toContain("readOnly");
    expect(html).toContain("Henüz K2/K3/K4 politika taslağı yok");
    expect(html).not.toMatch(/<button[^>]*>\s*(Yayınla|Onayla|Execute|Meta)/i);
    expect(html).not.toMatch(/value="(24|1|900|86400)"/);
  });

  it("converts explicitly entered durations and derives campaign scope from the server catalog", () => {
    expect(createApprovalPolicyDraftBody({ policyRef: "approval_policy_k4", requesterRoles: ["owner"],
      approverRoles: ["admin"], grantConsumerRoles: ["owner"], separationOfDuties: true,
      evidenceHours: "24", proposalHours: "12", grantMinutes: "15", effectiveFrom: "2026-08-08T12:00",
      expiresAt: "" })).toMatchObject({ maximumProtectionEvidenceAgeSeconds: 86_400,
      maximumProposalLifetimeSeconds: 43_200, maximumGrantLifetimeSeconds: 900,
      effectiveFrom: "2026-08-08T09:00:00.000Z" });
    expect(createGuardrailPolicyDraftBody({ policyRef: "guardrail_k4", accountRef: "account_doruk",
      adSetRef: "adset_doruk", internalCategoryRefs: ["category_hair"], denyAction: false, denyClauseRef: "",
      effectiveFrom: "2026-08-08T12:00", expiresAt: "", sourceGuidanceRefs: "guidance_one" }, result))
      .toMatchObject({ campaignRef: "campaign_doruk", adSetRef: "adset_doruk", denyClauseRef: null });
    expect(() => createGuardrailPolicyDraftBody({ policyRef: "guardrail_k4", accountRef: "account_foreign",
      adSetRef: "adset_doruk", internalCategoryRefs: [], denyAction: false, denyClauseRef: "",
      effectiveFrom: "2026-08-08T12:00", expiresAt: "", sourceGuidanceRefs: "" }, result)).toThrow();
  });

  it("serializes the selected budget applicability explicitly and renders it in the public-safe feed", () => {
    expect(createApprovalPolicyDraftBody({ policyRef: "approval_policy_k3", requesterRoles: ["owner"],
      approverRoles: ["admin"], grantConsumerRoles: ["owner"], separationOfDuties: true,
      applicability: { actionType: "budget_increase", risk: "K3" }, evidenceHours: "24", proposalHours: "12",
      grantMinutes: "15", effectiveFrom: "2026-08-08T12:00", expiresAt: "" }))
      .toMatchObject({ applicability: { actionType: "budget_increase", risk: "K3" } });
    const html = renderToStaticMarkup(createElement(PolicyBundleStudioSurface, { result: { ...result,
      approvalPolicies: [{ kind: "approval_policy", policyRef: "approval_policy_k2", revision: 1,
        applicability: { actionType: "budget_decrease", risk: "K2" }, state: "draft", effectiveFrom: "2026-08-08T12:00:00.000Z",
        expiresAt: null, requesterRoles: ["owner"], approverRoles: ["admin"], grantConsumerRoles: ["owner"],
        separationOfDuties: true, maximumProtectionEvidenceAgeSeconds: 3600, maximumProposalLifetimeSeconds: 3600,
        maximumGrantLifetimeSeconds: 600, normalizedByRole: "owner", publishedByRole: null }] }, onReload: vi.fn() }));
    expect(html).toContain("K2 · bütçe azaltma");
    expect(html).toContain("Onay kapsamı");
  });

  it("runs the human-presence challenge before publication and preserves closed action authority", async () => {
    const proof = `presence_${"A".repeat(32)}`;
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ challenge: { kind: "approval_policy",
        policyRef: "approval_policy_k4", revision: 1, unitRef: `policy_unit_${"a".repeat(20)}`,
        proof, expiresAt: "2026-08-08T12:01:00.000Z" }, authority: { canPublish: false,
        canDisable: false, canApproveAction: false, canGrant: false, canExecute: false, canWriteMeta: false } }),
      { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ contractVersion: "policy-bundle-publication/1.0.0",
        item: { kind: "approval_policy", policyRef: "approval_policy_k4", draftRevision: 1, state: "published" },
        authority: { canPublish: false, canDisable: false, canApproveAction: false, canGrant: false,
          canExecute: false, canWriteMeta: false } }), { status: 200 }));

    await runPolicyPublicationCeremony({ kind: "approval_policy", policyRef: "approval_policy_k4", revision: 1 },
      "reason_owner_reviewed_k4", request as unknown as typeof fetch);

    expect(request).toHaveBeenNthCalledWith(1, "/api/policy-bundles", expect.objectContaining({
      method: "POST", credentials: "same-origin", headers: expect.objectContaining({
        "X-ReklamZeka-Intent": "policy-bundle-confirm-human-presence" }) }));
    expect(request).toHaveBeenNthCalledWith(2, "/api/policy-bundles", expect.objectContaining({
      body: JSON.stringify({ policyRef: "approval_policy_k4", revision: 1,
        reasonRef: "reason_owner_reviewed_k4", humanPresenceProof: proof }),
      headers: expect.objectContaining({ "X-ReklamZeka-Intent": "policy-bundle-publish-approval-policy" }) }));
  });

  it("fails closed when the ceremony response opens authority or does not match the selected draft", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ challenge: { kind: "guardrail_policy",
      policyRef: "guardrail_foreign", revision: 1, unitRef: `policy_unit_${"a".repeat(20)}`,
      proof: `presence_${"A".repeat(32)}`, expiresAt: "2026-08-08T12:01:00.000Z" },
    authority: { canPublish: true } }), { status: 200 }));
    await expect(runPolicyPublicationCeremony({ kind: "approval_policy", policyRef: "approval_policy_k4", revision: 1 },
      "reason_owner_reviewed_k4", request as unknown as typeof fetch)).rejects.toThrow("doğrulanamadı");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("shows the ceremony control only for an authorized human and a real draft", () => {
    const approvalDraft = { kind: "approval_policy" as const, policyRef: "approval_policy_k4", revision: 1,
      applicability: { actionType: "existing_post_promotion" as const, risk: "K4" as const }, state: "draft" as const, effectiveFrom: "2026-08-08T12:00:00.000Z", expiresAt: null,
      requesterRoles: ["owner" as const], approverRoles: ["owner" as const], grantConsumerRoles: ["owner" as const],
      separationOfDuties: false, maximumProtectionEvidenceAgeSeconds: 3600,
      maximumProposalLifetimeSeconds: 3600, maximumGrantLifetimeSeconds: 600,
      normalizedByRole: "owner", publishedByRole: null };
    const ownerHtml = renderToStaticMarkup(createElement(PolicyBundleStudioSurface,
      { result: { ...result, approvalPolicies: [approvalDraft] }, onReload: vi.fn() }));
    expect(ownerHtml).toContain("İnsan onayıyla yayınla");
    expect(ownerHtml).toContain("Yayın reason ref");
    const viewerHtml = renderToStaticMarkup(createElement(PolicyBundleStudioSurface,
      { result: { ...result, approvalPolicies: [approvalDraft], authority: {
        ...result.authority, canDraft: false, canStartPublicationCeremony: false } }, onReload: vi.fn() }));
    expect(viewerHtml).not.toContain("İnsan onayıyla yayınla");
  });
});
