import { describe, expect, it } from "vitest";
import { buildOperationReadModel, operationPeriod } from "@/domain/operations/operation-read-model";
const ws = "11111111-1111-4111-8111-111111111111";
const fact = (overrides = {}) => ({ workspaceId: ws, market: "yerli" as const, accountId: "22222222-2222-4222-8222-222222222222", accountName: "A", campaignId: "33333333-3333-4333-8333-333333333333", campaignName: "C", organizationCampaignId: null, organizationCampaignName: null, adSetId: "44444444-4444-4444-8444-444444444444", adSetName: "S", cbo: true, campaignBudgetMinor: 1000, adSetBudgetMinor: 500, spendMinor: 200, observedDays: ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17"], missingDays: [], reasonCodes: [], primaryResultBinding: { state: "unbound" as const }, primaryResult: null, primaryResultCostMinor: 99, ...overrides });
describe("operation read model", () => {
  it("uses CBO campaign budget once and leaves an unbound result null", () => { const row = buildOperationReadModel({ workspaceId: ws, period: operationPeriod({ kind: "7d", now: new Date("2026-08-17T12:00:00Z") }), facts: [fact()] }).rows[0]!; expect(row).toMatchObject({ budgetOwner: "campaign", currentBudgetMinor: 1000, primaryResultState: "unbound", primaryResult: null, primaryResultCostMinor: null, organizationCampaignName: "Kurum Kampanyası atanmadı" }); });
  it("keeps incomplete day coverage partial, never zero", () => { const row = buildOperationReadModel({ workspaceId: ws, period: operationPeriod({ kind: "today", now: new Date("2026-08-17T12:00:00Z") }), facts: [fact({ observedDays: [], missingDays: ["2026-08-17"], spendMinor: null })] }).rows[0]!; expect(row).toMatchObject({ sourceState: "partial", spendMinor: null }); });
  it("allows only valid explicit custom ranges", () => { expect(() => operationPeriod({ kind: "custom", startDate: "2026-08-18", endDate: "2026-08-17" })).toThrow(); });
  it("rejects non-calendar dates and deduplicates a CBO owner across ad sets", () => {
    expect(() => operationPeriod({ kind: "custom", startDate: "2026-02-31", endDate: "2026-03-01" })).toThrow();
    const model = buildOperationReadModel({ workspaceId: ws, period: operationPeriod({ kind: "today", now: new Date("2026-08-17T12:00:00Z") }), facts: [fact({ observedDays: ["2026-08-17"], missingDays: [] }), fact({ adSetId: "55555555-5555-4555-8555-555555555555", adSetName: "S2", observedDays: ["2026-08-17"], missingDays: [] })] });
    expect(model.budgetOwners).toHaveLength(1);
    expect(model.budgetOwners[0]!.currentBudgetMinor).toBe(1000);
  });
  it("keeps a bound zero result and rejects untrusted fact fields", () => {
    const model = buildOperationReadModel({ workspaceId: ws, period: operationPeriod({ kind: "today", now: new Date("2026-08-17T12:00:00Z") }), facts: [fact({ observedDays: ["2026-08-17"], missingDays: [], primaryResultBinding: { state: "bound", actionType: "lead", bindingRef: "metric_lead" }, primaryResult: 0, primaryResultCostMinor: 0 })] });
    expect(model.rows[0]).toMatchObject({ primaryResultState: "bound", primaryResult: 0, primaryResultCostMinor: 0 });
    expect(() => buildOperationReadModel({ workspaceId: ws, period: model.period, facts: [fact({ campaignName: "bad\nname" })] })).toThrow();
  });
});
