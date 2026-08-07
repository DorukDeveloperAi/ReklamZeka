import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createApprovalPolicyDraftBody, createGuardrailPolicyDraftBody,
  PolicyBundleStudioSurface } from "@/app/dashboard/policy-bundle-studio-panel";
import type { PolicyBundleStudioResult } from "@/application/policy-bundle-studio-service";

const result: PolicyBundleStudioResult = {
  contractVersion: "policy-bundle-studio/1.0.0", approvalPolicies: [], guardrails: [],
  scopeCatalog: { accounts: [{ ref: "account_doruk", label: "Doruk Hospital" }],
    adSets: [{ ref: "adset_doruk", label: "TR Leads", accountRef: "account_doruk", campaignRef: "campaign_doruk" }],
    internalCategories: [{ ref: "category_hair", label: "Saç ekimi" }] },
  readiness: { approvalPolicy: "missing", guardrail: "missing", workspaceAutonomy: "missing",
    authenticEvidence: "evaluated_per_proposal", proposalReady: false },
  authority: { canDraft: true, canPublish: false, canDisable: false, canApproveAction: false,
    canGrant: false, canExecute: false, canWriteMeta: false },
};

describe("K4 Policy Bundle dashboard", () => {
  it("renders source-backed empty readiness without fake business defaults or action controls", () => {
    const html = renderToStaticMarkup(createElement(PolicyBundleStudioSurface, { result, onReload: vi.fn() }));
    expect(html).toContain("Öneri üretim zinciri hazır değil"); expect(html).toContain("NOT READY");
    expect(html).toContain("Doruk Hospital"); expect(html).toContain("Saç ekimi");
    expect(html).toContain("Kampanya ref"); expect(html).toContain("readOnly");
    expect(html).toContain("Henüz K4 politika taslağı yok");
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
});
