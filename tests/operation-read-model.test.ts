import { describe, expect, it } from "vitest";
import { buildOperationReadModel, operationPeriod } from "@/domain/operations/operation-read-model";
const ws = "11111111-1111-4111-8111-111111111111";
const fact = (overrides = {}) => ({ workspaceId: ws, market: "yerli" as const, accountId: "22222222-2222-4222-8222-222222222222", accountName: "A", campaignId: "33333333-3333-4333-8333-333333333333", campaignName: "C", organizationCampaignId: null, organizationCampaignName: null, adSetId: "44444444-4444-4444-8444-444444444444", adSetName: "S", cbo: true, campaignBudgetMinor: 1000, adSetBudgetMinor: 500, spendMinor: 200, observedDays: ["2026-08-17"], missingDays: [], reasonCodes: [], primaryResult: null, primaryResultCostMinor: 99, ...overrides });
describe("operation read model", () => {
  it("uses CBO campaign budget once and leaves an unbound result null", () => { const row = buildOperationReadModel({ workspaceId: ws, period: operationPeriod({ kind: "7d", now: new Date("2026-08-17T12:00:00Z") }), facts: [fact()] }).rows[0]!; expect(row).toMatchObject({ budgetOwner: "campaign", currentBudgetMinor: 1000, primaryResultState: "unbound", primaryResult: null, primaryResultCostMinor: null, organizationCampaignName: "Kurum Kampanyası atanmadı" }); });
  it("keeps incomplete day coverage partial, never zero", () => { const row = buildOperationReadModel({ workspaceId: ws, period: operationPeriod({ kind: "today", now: new Date("2026-08-17T12:00:00Z") }), facts: [fact({ missingDays: ["2026-08-17"], spendMinor: null })] }).rows[0]!; expect(row).toMatchObject({ sourceState: "partial", spendMinor: null }); });
  it("allows only valid explicit custom ranges", () => { expect(() => operationPeriod({ kind: "custom", startDate: "2026-08-18", endDate: "2026-08-17" })).toThrow(); });
});
