import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  buildTypedBudgetImpactCommand,
  buildSliceRuleDraftCommand,
  classifySliceRuleBudgetImpactFailure,
  EMPTY_SLICE_RULE_FORM,
  parseSliceRuleBudgetImpactResult,
  parseSliceRuleWorkspaceSnapshot,
  parseSliceRuleBudgetPoolBindingSnapshot,
  parseSliceScopeCandidates,
  parseSliceOperationalReadiness,
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
  it("accepts frozen same-market pool evidence but rejects opened authority", () => {
    const value = parseSliceRuleBudgetPoolBindingSnapshot({ contractVersion: "slice-rule-budget-pool-binding-http/1.0.0", bindings: [{ draftHash: item.draftHash, hierarchyHash: "c".repeat(64), poolRef: "budget_pool_international", market: "international", boundAt: "2026-08-14T10:00:00.000Z", authority: closed }], hierarchy: { hierarchyHash: "c".repeat(64), nodes: [{ poolRef: "budget_pool_international", parentPoolRef: null, layer: "market", market: "international", currency: "TRY", hardCapDecimal: "100", effectiveFrom: "2026-08-01T00:00:00.000Z", effectiveTo: "2026-09-01T00:00:00.000Z" }], authority: closed }, authority: { canRead: true, canBind: true, ...closed } });
    expect(value.bindings[0]).toMatchObject({ poolRef: "budget_pool_international", market: "international" });
    expect(() => parseSliceRuleBudgetPoolBindingSnapshot({ ...value, authority: { ...value.authority, canExecute: true } })).toThrow("güvenli değil");
  });
  it("renders mandatory/optional scope and makes the closed authority explicit", () => {
    const html = renderToStaticMarkup(createElement(SliceRuleWorkspaceSurface, { state: { status: "ready",
      snapshot: parseSliceRuleWorkspaceSnapshot(snapshot) }, onRetry: vi.fn(), onSaved: vi.fn(async () => undefined) }));
    for (const label of ["Pazar", "Hizmet referansı", "Kampanya ailesi referansı", "Ülke / bölge (opsiyonel)",
      "Hedefleme stratejisi (opsiyonel)", "Platform (opsiyonel)", "Sonuç rotası (opsiyonel)"]) expect(html).toContain(label);
    expect(html).toContain("SADECE ÖNERİ · UYGULAMA YETKİSİ YOK");
    expect(html).toContain("Policy yayınlama: kapalı");
    expect(html).toContain("Action/Meta write: kapalı");
    expect(html).toContain("Kayıtlı taslağın bütçe etkisi");
    expect(html).toContain("Kaydedilmemiş form kapsamı kullanılmaz");
    expect(html).toContain("Kanıtlı kapsam adayları");
    expect(html).toContain("Frozen context, bütçe etkisi, policy ve action yetkisi üretmez");
    expect(html).toContain("Senaryoyu yalnız salt-okur inceleyin.");
    expect(html).toContain("KURAL KÜTÜPHANESİ");
    expect(html).toContain("Kullanıcı kuralı");
    expect(html).toContain("Takip yaklaşımı");
    expect(html).toContain("Kuralı aç");
    expect(html).toContain("Kuralsız kanıtlı slice adayları");
    expect(html).toContain("Kural otomatik oluşturulmaz.");
    expect(html).toContain("tek kanonik kuralı");
    expect(html).toContain("Kuralı aç");
  });

  it("keeps private pool, frozen-context and decision identifiers out of the operator surface", () => {
    const source = readFileSync("src/app/dashboard/slice-rule-workspace-panel.tsx", "utf8");
    expect(source).not.toContain("frozenPoolBinding.draftHash.slice");
    expect(source).not.toContain("frozenPoolBinding.hierarchyHash.slice");
    expect(source).not.toContain("candidate.campaignRef} · {candidate.currentBudgetDecimal");
    expect(source).not.toContain("slice-rule-scenario-select");
    expect(source).not.toContain("slice-rule-budget-action-unit-materialize");
    expect(source).toContain("kaydedilemez, seçilemez, onaya veya action kuyruğuna gönderilemez");
    expect(source).not.toContain("node.poolRef} · {node.layer}");
    expect(source).toContain("Doğrulanmış bağlam {index + 1}");
    expect(source).toContain("Kalıcı kayıt: yok");
  });

  it("opens an editable Agent rule-session draft without creating or revising the rule", () => {
    const html = renderToStaticMarkup(createElement(SliceRuleWorkspaceSurface, { state: { status: "ready",
      snapshot: parseSliceRuleWorkspaceSnapshot(snapshot) }, onRetry: vi.fn(), onSaved: vi.fn(async () => undefined),
      onOpenRuleSession: vi.fn() }));
    const source = readFileSync("src/app/dashboard/slice-rule-workspace-panel.tsx", "utf8");
    expect(source).toContain("Agent ile kuralı gözden geçir");
    expect(source).toContain("Bu kuralı benim yerime yazmayın veya değiştirmeyin");
    expect(source).toContain("onOpenRuleSession?(seed: SliceRuleSessionSeed)");
  });

  it("accepts candidates only as form-prefill data with frozen budget evidence still required", () => {
    const candidates = parseSliceScopeCandidates({ version: "slice-scope-candidates/1.0.0", candidates: [{ campaignRef: "campaign-1", scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr", platform: "instagram" }, requiresFrozenContext: true, budgetImpactReady: false }], authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(candidates[0]).toMatchObject({ requiresFrozenContext: true, budgetImpactReady: false });
    expect(() => parseSliceScopeCandidates({ version: "slice-scope-candidates/1.0.0", candidates: [{ campaignRef: "campaign-1", scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr" }, requiresFrozenContext: false, budgetImpactReady: true }], authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } })).toThrow("güvenli değil");
  });

  it("guides an empty canonical scope list to category review without inventing a slice", () => {
    const source = readFileSync("src/app/dashboard/slice-rule-workspace-panel.tsx", "utf8");
    expect(source).toContain("Henüz tekil ve tutarlı slice kapsamı yok");
    expect(source).toContain("Kategori inceleme ve başlangıç planını aç");
    expect(source).toContain("onOpenCategorySetup?(): void");
    expect(source).toContain("Kategori kayıtları eksikse sistem kapsam veya kural tahmin etmez.");
  });

  it("keeps a session-required library empty and explains the safe recovery in place", () => {
    const html = renderToStaticMarkup(createElement(SliceRuleWorkspaceSurface, {
      state: { status: "session_required", message: "Yerel oturum gerekli." }, onRetry: vi.fn(),
      onSaved: vi.fn(async () => undefined), onConnect: vi.fn(async () => true),
    }));
    expect(html).toContain("Yerel oturum gerekli");
    expect(html).toContain("kural, slice veya karar kaydı gösterilmez");
    expect(html).toContain("Kural Kütüphanesini bağlayın");
    expect(html).not.toContain("slice_rule.ftr.ar");
  });

  it("renders only explanatory frozen-context readiness with no opened authority", () => {
    const items = parseSliceOperationalReadiness({ version: "slice-operational-readiness/1.0.0", items: [{ candidateRef: "category_entity_ready", scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr" }, frozenContext: "ready", budgetImpact: "eligible" }], authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(items[0]).toMatchObject({ frozenContext: "ready", budgetImpact: "eligible" });
    expect(() => parseSliceOperationalReadiness({ version: "slice-operational-readiness/1.0.0", items, authority: { canSave: false, canPublish: false, canApprove: false, canExecute: true, canWriteMeta: false } })).toThrow("güvenli değil");
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

  it("builds a typed impact command without browser-visible frozen identifiers", () => {
    const form = { label: "keep", mode: "keep" as const, requestedBudgetDecimal: "120.00", startDate: "2026-08-01", endDate: "2026-08-31" };
    const command = buildTypedBudgetImpactCommand(item, form);
    expect(command).toMatchObject({ label: "keep", requestedBudgetDecimal: "120.00" });
    expect(JSON.stringify(command)).not.toMatch(/adAccountId|campaignId|contextHash/);
    expect(buildTypedBudgetImpactCommand(undefined, form)).toBeNull();
    expect(buildTypedBudgetImpactCommand({ ...item, operatingRule: { ...item.operatingRule,
      rule: { kind: "delivery_guardrail", condition: "delivery_interrupted", response: "needs_human_review" } } }, form)).toBeNull();
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
