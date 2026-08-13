import { describe, expect, it, vi } from "vitest";
import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { BudgetLabDraftService, type BudgetDraftPersistencePort, type BudgetLabDraftCommand } from "@/application/budget-lab-draft-service";
import type { BudgetFrozenContextPort } from "@/application/budget-proposal-service";
import type { BudgetScenarioDefinition } from "@/domain/budget/scenario-composer";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const adAccountId = "22222222-2222-4222-a222-222222222222";
const campaignId = "33333333-3333-4333-a333-333333333333";
const contextHash = "a".repeat(64);

const scenario: BudgetScenarioDefinition = {
  scenarioRef: "scenario.keep", kind: "keep", minorUnitScale: 2, requestedBudgetMinor: 10_000,
  allocations: [{ ref: "istanbul", currentAmountMinor: 10_000, categoryRef: "protected", geoRef: "istanbul", groupRefs: ["tr"] }],
  constraints: [{ kind: "protected", dimension: "geo", refs: ["istanbul"], behavior: "no_outflow" }],
  strategy: { mode: "fixed", targets: [{ ref: "istanbul", amountMinor: 10_000 }] },
  pacing: {
    period: { startDate: "2026-08-01", endDate: "2026-08-31", timezone: "Europe/Istanbul" }, asOfAt: "2026-08-07T12:00:00.000Z",
    amounts: { currency: "TRY", plannedDecimal: "100.00", committedDecimal: "100.00", actualDecimal: "20.00", requestedCommitmentDecimal: "100.00" },
    signal: { kind: "business_outcome", metricRef: "qualified_lead", sampleSize: 200, coverageBps: 9800,
      observedThroughAt: "2026-08-06T10:00:00.000Z", retrievedAt: "2026-08-06T10:10:00.000Z", learningPhase: false, lastMaterialChangeAt: null },
    policy: { moneyScale: 2, moneyRounding: "half_even", minimumElapsedBps: 0, conservativeRemainingRateBps: 8000,
      forecastMinimumDecimal: "0", forecastMaximumDecimal: "200", maximumFreshnessMinutes: 10000, minimumCoverageBps: 9000,
      minimumSampleSize: 100, attributionLagMinutes: 0, suppressDuringLearning: true, cooldownMinutes: 0,
      allowProxyAction: false, maximumChangeBps: 1000, maximumChangeAbsoluteDecimal: "20" },
  },
};

const command: BudgetLabDraftCommand = {
  scope: { adAccountId, campaignId, contextHash }, seriesRef: "budget.series.august", revision: 1,
  previousProposalHash: "GENESIS", idempotencyKey: "budget.august.r1", createdAt: "2026-08-07T12:30:00.000Z",
  scenarios: [scenario], outcomeProxy: null,
};

function harness() {
  const context = { workspaceId, contextHash, capturedAt: "2026-08-07T12:00:00.000Z",
    identity: { accountRef: "private_account", campaignRef: "private_campaign", entityRef: "private_campaign", entityType: "campaign" },
    data: { trustStatus: "ready" } } as unknown as EffectiveCampaignContext;
  const contexts: BudgetFrozenContextPort = { loadExact: vi.fn(async (scope) => ({ scope, context, invalidated: false })) };
  const persistence: BudgetDraftPersistencePort = { appendDraft: vi.fn(async () => ({ outcome: "inserted" as const, auditAppended: true })) };
  return { contexts, persistence, service: new BudgetLabDraftService(contexts, persistence) };
}

describe("Budget Lab explicit draft service", () => {
  it("dry-runs through the deterministic proposal engine without persistence", async () => {
    const h = harness();
    const result = await h.service.dryRun(workspaceId, command);
    expect(result).toMatchObject({ mode: "dry_run", persistence: "none", auditAppended: false,
      authority: { draftOnly: true, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(h.persistence.appendDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(workspaceId);
    expect(JSON.stringify(result)).not.toMatch(/[a-f0-9]{64}/);
  });

  it("saves only via the atomic draft port and preserves idempotent unchanged outcome", async () => {
    const h = harness();
    const inserted = await h.service.saveDraft(workspaceId, "44444444-4444-4444-a444-444444444444", "2026-08-07T13:00:00.000Z", command);
    expect(inserted).toMatchObject({ mode: "saved_draft", persistence: "inserted", auditAppended: true });
    expect(h.persistence.appendDraft).toHaveBeenCalledTimes(1);
    (h.persistence.appendDraft as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ outcome: "unchanged", auditAppended: false });
    const replay = await h.service.saveDraft(workspaceId, "44444444-4444-4444-a444-444444444444", "2026-08-07T13:01:00.000Z", command);
    expect(replay).toMatchObject({ persistence: "unchanged", auditAppended: false });
  });

  it("keeps the exact private proposal available only to a server-side provenance binder", async () => {
    const h = harness();
    const saved = await h.service.saveDraftWithPrivateProposal(workspaceId,
      "44444444-4444-4444-a444-444444444444", "2026-08-07T13:00:00.000Z", command);
    expect(saved.result).toMatchObject({ mode: "saved_draft", persistence: "inserted" });
    expect(saved.proposal.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(saved.result)).not.toContain(saved.proposal.proposalHash);
  });
});
