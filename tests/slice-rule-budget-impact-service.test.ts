import { describe, expect, it, vi } from "vitest";

import {
  type BudgetImpactScopeEvidencePort,
  SliceRuleBudgetImpactService,
} from "@/application/slice-rule-budget-impact-service";
import { createSliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";
import type { BudgetLabDraftCommand, BudgetLabDraftResult } from "@/application/budget-lab-draft-service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const scope = { market: "international" as const, serviceRef: "service_ftr",
  campaignFamilyRef: "campaign_family_intensive_ftr", countryOrRegion: "AR",
  audienceStrategy: "custom", platform: "instagram" as const };
const draft = createSliceRuleWorkspaceDraft({ workspaceId, seriesRef: "slice_rule.ftr.ar", revision: 1,
  previousDraftHash: "GENESIS", idempotencyKey: "slice_rule.ftr.ar.r1", createdAt: "2026-08-13T10:00:00.000Z",
  scope, rule: { kind: "period_budget_cap", period: "monthly", currency: "TRY", maximumDecimal: "250000" },
  priority: 100, verification: { metric: "cost_per_qualified_lead", reviewCadence: "weekly",
    rollbackWhen: "Yeni kanıt insan incelemesi gerektirirse." } });
const budgetCommand = { scope: { adAccountId: "33333333-3333-4333-8333-333333333333",
  campaignId: "44444444-4444-4444-8444-444444444444", contextHash: "a".repeat(64) },
  seriesRef: "budget.preview", revision: 1, previousProposalHash: "GENESIS",
  idempotencyKey: "budget.preview.r1", createdAt: "2026-08-13T10:01:00.000Z", scenarios: [],
  outcomeProxy: null } as unknown as BudgetLabDraftCommand;
const budgetPreview = { contractVersion: "budget-lab-draft/1.0.0", mode: "dry_run", persistence: "none",
  auditAppended: false, proposal: { actionAuthority: "none", writeOperations: 0 },
  authority: { draftOnly: true, canApprove: false, canExecute: false, canWriteMeta: false } } as BudgetLabDraftResult;

function harness(evidenceScope: import("@/application/slice-rule-workspace-service").ExactSliceRuleScope = scope) {
  const drafts = { loadCurrentExact: vi.fn(async () => draft) };
  const loadExact: BudgetImpactScopeEvidencePort["loadExact"] = vi.fn(async () => ({ state: "ready" as const,
    scope: evidenceScope, evidenceRefs: ["category_resolution_market_ftr_ar"] }));
  const scopeEvidence = { loadExact };
  const budgetLab = { dryRun: vi.fn(async () => budgetPreview), saveRuleLinkedDraft: vi.fn(async () => ({
    result: { ...budgetPreview, mode: "saved_draft" as const, persistence: "inserted" as const, auditAppended: true },
    bindingOutcome: "inserted" as const,
  })) };
  return { drafts, scopeEvidence, budgetLab,
    service: new SliceRuleBudgetImpactService(drafts, scopeEvidence, budgetLab) };
}

const request = () => ({ workspaceId, actorId, seriesRef: draft.seriesRef, expectedDraftRef: draft.draftRef,
  expectedDraftHash: draft.draftHash, expectedScope: scope, budgetCommand });

describe("Slice Rule to Budget Lab impact bridge", () => {
  it("binds the exact current draft and server-derived scope to a non-persistent Budget Lab dry-run", async () => {
    const h = harness();
    const result = await h.service.preview(request());
    expect(result).toMatchObject({ mode: "read_only_impact_preview", persistence: "none", writeOperations: 0,
      binding: { draftRef: draft.draftRef, draftHash: draft.draftHash, scope, ruleKind: "period_budget_cap" },
      budgetPreview: { mode: "dry_run", persistence: "none", auditAppended: false },
      authority: { recommendationOnly: true, canPublish: false, canApprove: false,
        canCreateProposal: false, canExecute: false, canWriteMeta: false } });
    expect(h.budgetLab.dryRun).toHaveBeenCalledOnce();
    expect(h.scopeEvidence.loadExact).toHaveBeenCalledWith({ ...budgetCommand.scope, workspaceId, expectedScope: scope });
  });

  it("fails closed on a stale hash or exact scope and never invokes Budget Lab", async () => {
    for (const changed of [{ ...request(), expectedDraftHash: "b".repeat(64) },
      { ...request(), expectedScope: { ...scope, platform: "facebook" as const } }]) {
      const h = harness();
      await expect(h.service.preview(changed)).rejects.toMatchObject({ code: "stale_draft" });
      expect(h.scopeEvidence.loadExact).not.toHaveBeenCalled();
      expect(h.budgetLab.dryRun).not.toHaveBeenCalled();
    }
  });

  it("enforces the domestic/international boundary before composing any budget preview", async () => {
    const h = harness({ ...scope, market: "domestic" });
    await expect(h.service.preview(request())).rejects.toMatchObject({ code: "market_boundary" });
    expect(h.budgetLab.dryRun).not.toHaveBeenCalled();
  });

  it("rejects missing, ambiguous or stale evidence without falling back to caller scope", async () => {
    for (const state of ["missing", "ambiguous", "stale"] as const) {
      const h = harness();
      vi.mocked(h.scopeEvidence.loadExact).mockResolvedValueOnce({ state, scope: null, evidenceRefs: [] });
      await expect(h.service.preview(request())).rejects.toMatchObject({ code: "scope_evidence_not_ready" });
      expect(h.budgetLab.dryRun).not.toHaveBeenCalled();
    }
  });

  it("rejects a Budget Lab result that exposes any persistence or authority", async () => {
    const h = harness();
    h.budgetLab.dryRun.mockResolvedValueOnce({ ...budgetPreview, persistence: "inserted" } as never);
    await expect(h.service.preview(request())).rejects.toMatchObject({ code: "unsafe_budget_preview" });
  });

  it("persists only an explicitly requested exact preview with its immutable rule provenance", async () => {
    const h = harness();
    const result = await h.service.save(request(), "2026-08-13T10:02:00.000Z");
    expect(result).toMatchObject({ mode: "saved_advisory_draft", persistence: "inserted", provenance: "inserted",
      authority: { canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(h.budgetLab.saveRuleLinkedDraft).toHaveBeenCalledWith(workspaceId, actorId, "2026-08-13T10:02:00.000Z",
      budgetCommand, draft, expect.stringMatching(/^rule_budget_[a-f0-9]{32}$/));
  });
});
