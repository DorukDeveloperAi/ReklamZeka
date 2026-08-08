import { describe, expect, it, vi } from "vitest";
import { BudgetLabReadError, BudgetLabReadService, type BudgetLabRepository } from "@/application/budget-lab-read-service";
import type { PublicBudgetProposal } from "@/connectors/budget/budget-proposal-drizzle-repository";

const workspaceId = "11111111-1111-4111-a111-111111111111";

function proposal(input: Partial<{ proposalRef: string; seriesRef: string; revision: number; createdAt: string }> = {}): PublicBudgetProposal {
  return {
    schemaVersion: "public-budget-proposal/1.0.0",
    proposalRef: input.proposalRef ?? "budget_proposal_aaaaaaaaaaaaaaaaaaaa",
    seriesRef: input.seriesRef ?? "budget.series.august",
    revision: input.revision ?? 1,
    createdAt: input.createdAt ?? "2026-08-07T12:00:00.000Z",
    scope: { workspaceRef: "workspace_0123456789abcdef", accountRef: "account_0123456789abcdef", campaignRef: "campaign_0123456789abcdef", contextRef: "context_0123456789abcdef" },
    mapping: null,
    alternatives: [{
      scenarioRef: "scenario.keep", kind: "keep", status: "composed",
      result: {
        status: "no_change", reason: "already_at_target", currency: "TRY",
        before: { commitmentDecimal: "100.00", totalAllocationMinor: 10_000, allocations: [{ ref: "allocation_0123456789abcdef", amountMinor: 10_000 }] },
        after: { requestedCommitmentDecimal: "100.00", guardedCommitmentDecimal: "100.00", guardedBudgetMinor: 10_000, totalAllocationMinor: 10_000, allocations: [{ ref: "allocation_0123456789abcdef", amountMinor: 10_000, deltaMinor: 0 }] },
        traceSummary: { constraintStatus: "no_change", constraintReason: "already_at_target", pacingStatus: "no_change", pacingSuppressionReasons: [], stepCount: 3, stages: ["result"] },
        actionAuthority: "none",
      }, mappingSuppressionReasons: [], actionAuthority: "none",
    }],
    actionAuthority: "none", capabilities: { canApprove: false, canExecute: false, canWriteMeta: false }, writeOperations: 0,
  } as PublicBudgetProposal;
}

function repository(items: readonly PublicBudgetProposal[]): BudgetLabRepository {
  return {
    listPublic: vi.fn(async () => items),
    loadPublic: vi.fn(async ({ seriesRef, revision }) => {
      const item = items.find((candidate) => candidate.seriesRef === seriesRef && (revision === undefined || candidate.revision === revision));
      if (!item) throw Object.assign(new Error("missing"), { code: "not_found" });
      return item;
    }),
  };
}

describe("Budget Lab public read service", () => {
  it("projects bounded tenant list and detail without full ids, hashes, Meta refs, or write authority", async () => {
    const repo = repository([proposal()]);
    const service = new BudgetLabReadService(repo);
    const list = await service.list({ workspaceId });
    const detail = await service.get({ workspaceId, seriesRef: "budget.series.august", revision: 1 });
    expect(list).toMatchObject({ view: "list", items: [{ alternativeCount: 1, composedCount: 1, suppressedCount: 0 }], authority: { canDraft: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(detail.item.alternatives[0]).toMatchObject({ result: { before: { totalAllocationMinor: 10_000 }, after: { totalAllocationMinor: 10_000 }, traceSummary: { stepCount: 3 } } });
    expect(repo.listPublic).toHaveBeenCalledWith({ workspaceId, before: null, limit: 26 });
    const serialized = JSON.stringify({ list, detail });
    expect(serialized).not.toMatch(/[a-f0-9]{64}/);
    expect(serialized).not.toContain("act_123456789");
    expect(serialized).not.toContain("workspaceId");
    expect(serialized).not.toContain("proposalHash");
  });

  it("uses opaque keyset cursors and validates descending source order", async () => {
    const newer = proposal({ proposalRef: "budget_proposal_bbbbbbbbbbbbbbbbbbbb", createdAt: "2026-08-07T13:00:00.000Z" });
    const older = proposal({ proposalRef: "budget_proposal_aaaaaaaaaaaaaaaaaaaa", seriesRef: "budget.series.july", createdAt: "2026-08-07T12:00:00.000Z" });
    const firstRepo = repository([newer, older]);
    const page = await new BudgetLabReadService(firstRepo).list({ workspaceId, limit: 1 });
    expect(page.nextCursor).not.toBeNull();
    await new BudgetLabReadService(repository([])).list({ workspaceId, cursor: page.nextCursor });
    await expect(new BudgetLabReadService(repository([older, newer])).list({ workspaceId }))
      .rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
  });

  it("fails closed for invalid input, missing detail, and unsafe material", async () => {
    const service = new BudgetLabReadService(repository([]));
    await expect(service.list({ workspaceId: "foreign" })).rejects.toBeInstanceOf(BudgetLabReadError);
    await expect(service.get({ workspaceId, seriesRef: "budget.missing" })).rejects.toEqual(expect.objectContaining({ code: "not_found" }));
    const unsafe = proposal() as unknown as Record<string, unknown>;
    unsafe.proposalHash = "a".repeat(64);
    await expect(new BudgetLabReadService(repository([unsafe as unknown as PublicBudgetProposal])).list({ workspaceId }))
      .rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
  });
});
