import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildSliceRuleBudgetImpactCommand,
  buildSliceRuleDraftCommand,
  classifySliceRuleBudgetImpactFailure,
  EMPTY_SLICE_RULE_FORM,
  parseSliceRuleBudgetImpactResult,
  parseSliceRuleBudgetImpactSavedResult,
  parseSliceRuleWorkspaceSnapshot,
  parseSliceScopeCandidates,
  SliceRuleWorkspaceSurface,
} from "@/app/dashboard/slice-rule-workspace-panel";

const closed = { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } as const;
const item = { schemaVersion: "public-slice-rule-workspace-draft/1.0.0", seriesRef: "slice_rule.ftr.ar", revision: 1,
  draftRef: `slice_rule_draft_${"a".repeat(20)}`, draftHash: "b".repeat(64), status: "draft", operatingMode: "recommendation_only",
  scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr",
    countryOrRegion: "Arap Bölgesi", audienceStrategy: "Özel hedefleme", platform: "instagram", conversionRoute: "whatsapp" },
  operatingRule: { rule: { kind: "period_budget_cap", period: "monthly", currency: "TRY", maximumDecimal: "250000" },
    priority: 80, verification: { metric: "cost_per_qualified_lead", reviewCadence: "weekly",
      rollbackWhen: "Kapsam değişirse." }, authority: closed }, createdAt: "2026-08-13T10:00:00.000Z", authority: closed } as const;
const snapshot = { contractVersion: "slice-rule-workspace-http/1.0.0", items: [item], authority: { canRead: true,
  canSaveDraft: true, ...closed } } as const;

describe("Slice Rule Workspace panel", () => {
  it("renders mandatory/optional scope and makes the closed authority explicit", () => {
    const html = renderToStaticMarkup(createElement(SliceRuleWorkspaceSurface, { state: { status: "ready",
      snapshot: parseSliceRuleWorkspaceSnapshot(snapshot) }, onRetry: vi.fn(), onSaved: vi.fn(async () => undefined) }));
    for (const label of ["Pazar", "Hizmet referansı", "Kampanya ailesi referansı", "Ülke / bölge (opsiyonel)",
      "Hedefleme stratejisi (opsiyonel)", "Platform (opsiyonel)", "Sonuç rotası (opsiyonel)"]) expect(html).toContain(label);
    expect(html).toContain("RECOMMENDATION ONLY · AUTHORITY NONE");
    expect(html).toContain("Policy yayınlama: kapalı");
    expect(html).toContain("Action/Meta write: kapalı");
    expect(html).toContain("Kayıtlı taslağın bütçe etkisi");
    expect(html).toContain("Kaydedilmemiş form kapsamı kullanılmaz");
    expect(html).toContain("Kanıtlı kapsam adayları");
    expect(html).toContain("Frozen context, bütçe etkisi, policy ve action yetkisi üretmez");
  });

  it("accepts candidates only as form-prefill data with frozen budget evidence still required", () => {
    const candidates = parseSliceScopeCandidates({ version: "slice-scope-candidates/1.0.0", candidates: [{ campaignRef: "campaign-1", scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr", platform: "instagram" }, requiresFrozenContext: true, budgetImpactReady: false }], authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(candidates[0]).toMatchObject({ requiresFrozenContext: true, budgetImpactReady: false });
    expect(() => parseSliceScopeCandidates({ version: "slice-scope-candidates/1.0.0", candidates: [{ campaignRef: "campaign-1", scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr" }, requiresFrozenContext: false, budgetImpactReady: true }], authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } })).toThrow("güvenli değil");
  });

  it("keeps a viewer read-only", () => {
    const viewer = parseSliceRuleWorkspaceSnapshot({ ...snapshot, authority: { ...snapshot.authority, canSaveDraft: false } });
    const html = renderToStaticMarkup(createElement(SliceRuleWorkspaceSurface, { state: { status: "ready", snapshot: viewer },
      onRetry: vi.fn(), onSaved: vi.fn(async () => undefined) }));
    expect(html).toContain("Viewer · salt okunur");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Taslağı kaydet<\/button>/);
  });

  it("builds only an exact, recommendation-only service command", () => {
    const form = { ...EMPTY_SLICE_RULE_FORM, seriesRef: "slice_rule.ftr.ar", serviceRef: "service_physical_therapy",
      campaignFamilyRef: "campaign_family_intensive_ftr", maximumDecimal: "250000", countryOrRegion: "Arap Bölgesi" };
    expect(buildSliceRuleDraftCommand(form)).toMatchObject({ operation: "save_draft", revision: 1,
      previousDraftHash: "GENESIS", scope: { market: "international", serviceRef: "service_physical_therapy",
        campaignFamilyRef: "campaign_family_intensive_ftr", countryOrRegion: "Arap Bölgesi" },
      rule: { kind: "period_budget_cap", maximumDecimal: "250000" } });
    expect(buildSliceRuleDraftCommand({ ...form, serviceRef: "" })).toBeNull();
  });

  it("turns only explicit, complete budget shares into a draft rule", () => {
    const command = buildSliceRuleDraftCommand({ ...EMPTY_SLICE_RULE_FORM,
      seriesRef: "slice_rule.ftr.ar.distribution", serviceRef: "service_physical_therapy",
      campaignFamilyRef: "campaign_family_intensive_ftr", ruleKind: "budget_distribution",
      distributionDimension: "countryOrRegion", distributionAllocations: "Arap Bölgesi: 60\nAvrupa: 40" });
    expect(command).toMatchObject({ rule: { kind: "budget_distribution", dimension: "countryOrRegion",
      allocations: [{ key: "Arap Bölgesi", basisPoints: 6000 }, { key: "Avrupa", basisPoints: 4000 }] } });
    expect(buildSliceRuleDraftCommand({ ...EMPTY_SLICE_RULE_FORM, seriesRef: "slice_rule.ftr.ar.distribution",
      serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr",
      ruleKind: "budget_distribution", distributionAllocations: "Arap Bölgesi: 60\nAvrupa: 30" })).toBeNull();
  });

  it("rejects opened authority anywhere in the response", () => {
    expect(() => parseSliceRuleWorkspaceSnapshot({ ...snapshot, items: [{ ...item,
      operatingRule: { ...item.operatingRule, authority: { ...closed, canExecute: true } } }] })).toThrow("güvenli sözleşmeyi");
    expect(() => parseSliceRuleWorkspaceSnapshot({ ...snapshot,
      authority: { ...snapshot.authority, canWriteMeta: true } })).toThrow("güvenli sözleşmeyi");
  });

  it("builds an impact request only from a saved exact supported draft", () => {
    const budgetCommand = { scope: { adAccountId: "33333333-3333-4333-8333-333333333333",
      campaignId: "44444444-4444-4444-8444-444444444444", contextHash: "c".repeat(64) },
      seriesRef: "budget.preview", revision: 1, previousProposalHash: "GENESIS",
      idempotencyKey: "budget.preview.r1", createdAt: "2026-08-13T10:01:00.000Z",
      scenarios: [{ scenarioRef: "scenario.keep" }], outcomeProxy: null };
    expect(buildSliceRuleBudgetImpactCommand(item, JSON.stringify(budgetCommand))).toMatchObject({
      seriesRef: item.seriesRef, expectedDraftRef: item.draftRef, expectedDraftHash: item.draftHash,
      expectedScope: item.scope, budgetCommand,
    });
    expect(buildSliceRuleBudgetImpactCommand(undefined, JSON.stringify(budgetCommand))).toBeNull();
    expect(buildSliceRuleBudgetImpactCommand({ ...item, operatingRule: { ...item.operatingRule,
      rule: { kind: "delivery_guardrail", condition: "delivery_interrupted", response: "needs_human_review" } } },
    JSON.stringify(budgetCommand))).toBeNull();
    expect(buildSliceRuleBudgetImpactCommand(item, JSON.stringify({ ...budgetCommand, canExecute: true }))).toBeNull();
  });

  it("accepts only an exact, non-persistent and authority-closed impact response", () => {
    const result = { contractVersion: "slice-rule-budget-impact/1.0.0", mode: "read_only_impact_preview",
      binding: { seriesRef: item.seriesRef, draftRef: item.draftRef, draftHash: item.draftHash,
        scope: item.scope, ruleKind: item.operatingRule.rule.kind, evidenceRefs: ["category_resolution_market_ftr_ar"] },
      budgetPreview: { contractVersion: "budget-lab-draft/1.0.0", mode: "dry_run", persistence: "none",
        auditAppended: false, proposal: { actionAuthority: "none", writeOperations: 0, alternatives: [] },
        authority: { draftOnly: true, canApprove: false, canExecute: false, canWriteMeta: false } },
      persistence: "none", writeOperations: 0, authority: { recommendationOnly: true, canPublish: false,
        canApprove: false, canCreateProposal: false, canExecute: false, canWriteMeta: false } };
    expect(parseSliceRuleBudgetImpactResult(result, item)).toMatchObject({ binding: { draftRef: item.draftRef },
      persistence: "none", writeOperations: 0 });
    expect(() => parseSliceRuleBudgetImpactResult({ ...result,
      binding: { ...result.binding, draftHash: "d".repeat(64) } }, item)).toThrow("güvenli sözleşmeyi");
    expect(() => parseSliceRuleBudgetImpactResult({ ...result,
      authority: { ...result.authority, canExecute: true } }, item)).toThrow("güvenli sözleşmeyi");
  });

  it("accepts a saved advisory draft only with the exact rule provenance and no action authority", () => {
    const result = { contractVersion: "slice-rule-budget-impact/1.0.0", mode: "saved_advisory_draft",
      binding: { seriesRef: item.seriesRef, draftRef: item.draftRef, draftHash: item.draftHash,
        scope: item.scope, ruleKind: item.operatingRule.rule.kind, evidenceRefs: ["category_resolution_market_ftr_ar"] },
      budgetProposal: { actionAuthority: "none", writeOperations: 0 }, persistence: "inserted", provenance: "inserted",
      authority: { recommendationOnly: true, canPublish: false, canApprove: false, canCreateProposal: false,
        canExecute: false, canWriteMeta: false } };
    expect(parseSliceRuleBudgetImpactSavedResult(result, item)).toMatchObject({ mode: "saved_advisory_draft",
      persistence: "inserted", provenance: "inserted" });
    expect(() => parseSliceRuleBudgetImpactSavedResult({ ...result,
      budgetProposal: { ...result.budgetProposal, actionAuthority: "approval_required" } }, item)).toThrow("güvenli sözleşmeyi");
  });

  it("keeps stale, scope and unavailable failures explicit and fail-closed", () => {
    expect(classifySliceRuleBudgetImpactFailure("stale_draft", 409).status).toBe("stale");
    expect(classifySliceRuleBudgetImpactFailure("draft_missing", 404).status).toBe("stale");
    expect(classifySliceRuleBudgetImpactFailure("scope_evidence_not_ready", 409).status).toBe("scope");
    expect(classifySliceRuleBudgetImpactFailure("market_boundary", 409)).toMatchObject({ status: "scope",
      message: expect.stringContaining("Pazar sınırı") });
    expect(classifySliceRuleBudgetImpactFailure("unavailable", 503)).toMatchObject({ status: "unavailable",
      message: expect.stringContaining("fallback") });
  });
});
