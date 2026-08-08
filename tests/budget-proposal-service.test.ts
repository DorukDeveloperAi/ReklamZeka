import { describe, expect, it } from "vitest";

import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import {
  BudgetProposalService,
  BudgetProposalServiceError,
  verifyBudgetProposal,
  type BudgetFrozenContextPort,
  type BudgetProposal,
  type BudgetProposalInput,
  type BudgetProposalPort,
} from "@/application/budget-proposal-service";
import { projectBudgetProposal } from "@/connectors/budget/budget-proposal-drizzle-repository";
import type { OutcomeProxyMappingInput } from "@/domain/budget/outcome-proxy-mapping";
import type { BudgetScenarioDefinition } from "@/domain/budget/scenario-composer";

const scope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  adAccountId: "22222222-2222-4222-8222-222222222222",
  campaignId: "33333333-3333-4333-8333-333333333333",
  contextHash: "a".repeat(64),
} as const;

const context = {
  workspaceId: scope.workspaceId,
  contextHash: scope.contextHash,
  capturedAt: "2026-08-07T12:00:00.000Z",
  identity: {
    accountRef: "act_123456789", campaignRef: "campaign_987654321",
    entityRef: "campaign_987654321", entityType: "campaign",
  },
  data: { trustStatus: "ready" },
} as unknown as EffectiveCampaignContext;

const allocations = [
  { ref: "ankara", currentAmountMinor: 6_000, categoryRef: "local", geoRef: "ankara", groupRefs: ["tr"] },
  { ref: "dubai", currentAmountMinor: 4_000, categoryRef: "intl", geoRef: "dubai", groupRefs: ["intl"] },
] as const;

function scenario(kind: BudgetScenarioDefinition["kind"], requestedBudgetMinor = 11_000): BudgetScenarioDefinition {
  const decimal = (requestedBudgetMinor / 100).toFixed(2);
  return {
    scenarioRef: `scenario.${kind}`,
    kind,
    minorUnitScale: 2,
    requestedBudgetMinor,
    allocations,
    constraints: [],
    strategy: { mode: "proportional", weights: [{ ref: "ankara", weight: 3 }, { ref: "dubai", weight: 2 }] },
    pacing: {
      period: { startDate: "2026-08-01", endDate: "2026-08-10", timezone: "Europe/Istanbul" },
      asOfAt: "2026-08-06T00:00:00.000Z",
      amounts: {
        currency: "TRY", plannedDecimal: "100.00", committedDecimal: "100.00",
        actualDecimal: "55.00", requestedCommitmentDecimal: decimal,
      },
      signal: {
        kind: kind === "target_seeking" ? "proxy" : "business_outcome",
        metricRef: kind === "target_seeking" ? "meta.lead" : "spend_pace",
        sampleSize: 120, coverageBps: 9500,
        observedThroughAt: "2026-08-04T00:00:00.000Z", retrievedAt: "2026-08-05T23:45:00.000Z",
        learningPhase: false, lastMaterialChangeAt: "2026-08-03T00:00:00.000Z",
      },
      policy: {
        moneyScale: 2, moneyRounding: "half_even", minimumElapsedBps: 1000,
        conservativeRemainingRateBps: 8000, forecastMinimumDecimal: "0", forecastMaximumDecimal: "140",
        maximumFreshnessMinutes: 60, minimumCoverageBps: 9000, minimumSampleSize: 100,
        attributionLagMinutes: 1440, suppressDuringLearning: true, cooldownMinutes: 1440,
        allowProxyAction: true, maximumChangeBps: 1000, maximumChangeAbsoluteDecimal: "15",
      },
    },
  };
}

function mapping(mappings: OutcomeProxyMappingInput["mappings"] = []): OutcomeProxyMappingInput {
  return {
    target: {
      targetRef: "target.qualified_patient", outcomeRef: "qualified_patient", direction: "maximize",
      targetValueDecimal: "120", unitRef: "patient", timeframeRef: "monthly_2026_08",
    },
    context: { categoryRef: "category.health_tourism", objectiveRef: "objective.leads" },
    asOfAt: "2026-08-06T12:00:00.000Z",
    mappings,
    policy: {
      minimumSampleSize: 100, minimumCoverageBps: 9000, maximumLagMinutes: 2880,
      minimumConfidenceBps: 7500, maximumEvidenceFreshnessMinutes: 180,
    },
  };
}

const approvedMapping: OutcomeProxyMappingInput["mappings"][number] = {
  mappingRef: "mapping.qualified_patient.lead", outcomeRef: "qualified_patient", timeframeRef: "monthly_2026_08",
  proxy: { metricRef: "meta.lead", entityLevel: "campaign", aggregation: "sum", attributionWindowRef: "meta.7d_click_1d_view" },
  scope: { categoryRefs: ["category.health_tourism"], objectiveRefs: ["objective.leads"] },
  evidence: {
    sampleSize: 240, coverageBps: 9600, observedFromAt: "2026-07-01T00:00:00.000Z",
    observedThroughAt: "2026-08-06T11:00:00.000Z", retrievedAt: "2026-08-06T11:00:00.000Z",
    proxyToOutcomeLagMinutes: 1440, confidenceBps: 8300,
  },
  review: { status: "approved", reviewerRef: "user.owner", reviewedAt: "2026-08-01T09:00:00.000Z", reviewDueAt: "2026-09-01T00:00:00.000Z" },
  provenance: { sourceKind: "owner_instruction", sourceRef: "instruction.patient.v2", configuredByRef: "user.owner", configuredAt: "2026-07-31T09:00:00.000Z" },
};

function input(patch: Partial<BudgetProposalInput> = {}): BudgetProposalInput {
  return {
    scope, seriesRef: "budget.series.august", revision: 1, previousProposalHash: "GENESIS",
    idempotencyKey: "budget.august.r1", createdAt: "2026-08-07T12:30:00.000Z",
    scenarios: [scenario("keep", 10_000), scenario("conservative"), scenario("target_seeking", 12_000)],
    outcomeProxy: mapping([]), ...patch,
  };
}

function harness(options: { invalidated?: boolean; trustStatus?: "ready" | "degraded" } = {}) {
  const writes: BudgetProposal[] = [];
  const contexts: BudgetFrozenContextPort = {
    loadExact: async () => ({
      scope,
      context: { ...context, data: { trustStatus: options.trustStatus ?? "ready" } } as EffectiveCampaignContext,
      invalidated: options.invalidated ?? false,
    }),
  };
  const proposals: BudgetProposalPort = {
    append: async (proposal) => { writes.push(proposal); return { outcome: "inserted" }; },
  };
  return { service: new BudgetProposalService(contexts, proposals), writes };
}

describe("budget proposal service", () => {
  it("composes keep and conservative but suppresses target seeking when mapping is not ready", async () => {
    const { service, writes } = harness();
    const result = await service.create(input());

    expect(result.proposal.alternatives.map((item) => [item.kind, item.status])).toEqual([
      ["keep", "composed"], ["conservative", "composed"], ["target_seeking", "suppressed"],
    ]);
    expect(result.proposal.alternatives[2]).toMatchObject({
      reason: "outcome_proxy_mapping_not_ready", mappingSuppressionReasons: ["missing_mapping"],
    });
    expect(verifyBudgetProposal(result.proposal)).toBe(true);
    expect(writes).toEqual([result.proposal]);
  });

  it("allows target seeking only with one eligible reviewed mapping", async () => {
    const { service } = harness();
    const result = await service.create(input({ outcomeProxy: mapping([approvedMapping]) }));
    expect(result.proposal.mappingPlan).toMatchObject({ status: "ready", actionAuthority: "none" });
    expect(result.proposal.alternatives[2]).toMatchObject({ kind: "target_seeking", status: "composed" });
  });

  it("suppresses target seeking when its signal is not the selected mapping proxy", async () => {
    const { service } = harness();
    const targetSeeking = scenario("target_seeking", 12_000);
    const result = await service.create(input({
      scenarios: [{
        ...targetSeeking,
        pacing: { ...targetSeeking.pacing, signal: { ...targetSeeking.pacing.signal, metricRef: "meta.purchase" } },
      }],
      outcomeProxy: mapping([approvedMapping]),
    }));
    expect(result.proposal.mappingPlan?.status).toBe("ready");
    expect(result.proposal.alternatives[0]).toMatchObject({
      status: "suppressed", mappingSuppressionReasons: ["proxy_signal_mismatch"],
    });
  });

  it("does not require any outcome mapping for keep or conservative", async () => {
    const { service } = harness();
    const result = await service.create(input({
      scenarios: [scenario("keep", 10_000), scenario("conservative")], outcomeProxy: null,
    }));
    expect(result.proposal.mappingPlan).toBeNull();
    expect(result.proposal.alternatives.every((item) => item.status === "composed")).toBe(true);
  });

  it("fails closed for invalidated, degraded or mismatched frozen contexts before persistence", async () => {
    await expect(harness({ invalidated: true }).service.create(input()))
      .rejects.toEqual(expect.objectContaining({ code: "context_invalidated" }));
    await expect(harness({ trustStatus: "degraded" }).service.create(input()))
      .rejects.toEqual(expect.objectContaining({ code: "context_not_ready" }));
    const mismatch: BudgetFrozenContextPort = { loadExact: async () => ({ scope, context: { ...context, workspaceId: scope.adAccountId } as EffectiveCampaignContext, invalidated: false }) };
    await expect(new BudgetProposalService(mismatch, { append: async () => ({ outcome: "inserted" }) }).create(input()))
      .rejects.toBeInstanceOf(BudgetProposalServiceError);
  });

  it("projects public financial evidence without workspace, account, campaign or allocation refs", async () => {
    const proposal = (await harness().service.create(input())).proposal;
    const projected = projectBudgetProposal(proposal);
    const serialized = JSON.stringify(projected);
    for (const secret of [scope.workspaceId, scope.adAccountId, scope.campaignId, scope.contextHash,
      "act_123456789", "campaign_987654321", "ankara", "dubai"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(projected.scope.contextRef).toMatch(/^context_[a-f0-9]{16}$/);
    expect(projected.actionAuthority).toBe("none");
    expect(projected.capabilities).toEqual({ canApprove: false, canExecute: false, canWriteMeta: false });
    expect(projected.writeOperations).toBe(0);
  });
});
