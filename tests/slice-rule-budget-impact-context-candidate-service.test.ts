import { describe, expect, it, vi } from "vitest";

import { BudgetImpactContextCandidateError, BudgetImpactContextCandidateService } from "@/application/slice-rule-budget-impact-context-candidate-service";
import { createSliceRuleWorkspaceDraft } from "@/application/slice-rule-workspace-service";

const principal = { workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_local", readerRef: "reader_local", actor: { userId: "22222222-2222-4222-8222-222222222222" } } as const;
const scope = { market: "international" as const, serviceRef: "service_ftr", campaignFamilyRef: "campaign_family_intensive_ftr" };
const draft = createSliceRuleWorkspaceDraft({ workspaceId: principal.workspaceId, seriesRef: "slice_rule.ftr", revision: 1, previousDraftHash: "GENESIS", idempotencyKey: "slice_rule.ftr.r1", createdAt: "2026-08-14T10:00:00.000Z", scope, rule: { kind: "period_budget_cap", period: "monthly", currency: "TRY", maximumDecimal: "100" }, priority: 1, verification: { metric: "qualified_leads", reviewCadence: "weekly", rollbackWhen: "review" } });
const record = { invalidated: false, analysisDataScope: { adAccountId: "33333333-3333-4333-8333-333333333333", campaignId: "44444444-4444-4444-8444-444444444444" }, context: { contextHash: "a".repeat(64), capturedAt: "2026-08-14T09:00:00.000Z", data: { trustStatus: "ready" }, identity: { campaignRef: "campaign-private" } } } as never;
const userCommand = { label: "keep", mode: "keep" as const, requestedBudgetDecimal: "100.00", startDate: "2026-08-01", endDate: "2026-08-31" };
function harness(options: Readonly<{ pool?: boolean; evidence?: "ready" | "missing" | "stale"; market?: "domestic" | "international"; tenant?: string }> = {}) {
  const drafts = { loadCurrentExact: vi.fn(async () => draft) };
  const contexts = { listLatestValidCampaignPublic: vi.fn(async ({ workspaceId }: { workspaceId: string }) => workspaceId === (options.tenant ?? principal.workspaceId) ? [record] : []) };
  const evidence = { loadExact: vi.fn(async () => ({ state: options.evidence ?? "ready", scope: options.market ? { ...scope, market: options.market } : scope, evidenceRefs: ["context_ready"] })) };
  const pools = { hasExact: vi.fn(async () => options.pool ?? true) };
  const templates = { loadExact: vi.fn(async () => ({ currency: "TRY", currentAmountMinor: 10_000, observedAt: "2026-08-14T09:00:00.000Z", allocationRef: "allocation_one", categoryRef: "category_ftr", geoRef: "geo_ar", groupRefs: ["market_international"] })) };
  return { drafts, contexts, evidence, pools, templates, service: new BudgetImpactContextCandidateService(drafts, contexts, evidence, pools, templates, [{ workspaceId: principal.workspaceId, userId: principal.actor.userId, role: "owner" }]) };
}

describe("Slice Rule budget impact opaque context candidates", () => {
  it("lists only a same-scope opaque candidate and never leaks UUID/hash", async () => {
    const h = harness(); const result = await h.service.list(principal, draft.seriesRef);
    expect(result.candidates).toHaveLength(1); expect(result.candidates[0]).toMatchObject({ candidateRef: expect.stringMatching(/^budget_impact_context_[a-f0-9]{24}$/), scope });
    expect(JSON.stringify(result)).not.toMatch(/33333333|44444444|a{64}|campaign-private/);
  });
  it("fails closed when pool is absent or frozen scope is stale", async () => {
    await expect(harness({ pool: false }).service.list(principal, draft.seriesRef)).rejects.toMatchObject({ code: "pool_binding_required" });
    expect((await harness({ evidence: "stale" }).service.list(principal, draft.seriesRef)).candidates).toEqual([]);
  });
  it("resolves only the listed candidate into private existing impact input", async () => {
    const h = harness(); const listed = await h.service.list(principal, draft.seriesRef); const result = await h.service.resolve(principal, { seriesRef: draft.seriesRef, candidateRef: listed.candidates[0]!.candidateRef, budgetCommand: userCommand });
    expect(result.budgetCommand.scope).toMatchObject({ adAccountId: "33333333-3333-4333-8333-333333333333", contextHash: "a".repeat(64) });
    await expect(h.service.resolve(principal, { seriesRef: draft.seriesRef, candidateRef: `budget_impact_context_${"b".repeat(24)}`, budgetCommand: userCommand })).rejects.toMatchObject({ code: "candidate_missing" });
  });
  it("rejects malformed candidate commands and market mismatch before composing a preview", async () => {
    const h = harness(); await expect(h.service.resolve(principal, { seriesRef: draft.seriesRef, candidateRef: "bad", budgetCommand: userCommand })).rejects.toBeInstanceOf(BudgetImpactContextCandidateError);
    const mismatch = harness({ market: "domestic" }); const listed = await mismatch.service.list(principal, draft.seriesRef); expect(listed.candidates).toEqual([]);
  });
});
