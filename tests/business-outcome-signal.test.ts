import { describe, expect, it } from "vitest";
import { createBusinessOutcomeSignalBatch, summarizeBusinessOutcomeSignals, BusinessOutcomeSignalError } from "@/analyses/business-outcome-signal";

const source = { kind: "csv" as const, sourceRef: "source_outcomes", contentHash: "a".repeat(64), observedAt: "2026-08-10T09:00:00.000Z" };
const lead = { signalRef: "signal_lead", entityRef: "campaign_primary", occurredAt: "2026-08-09T09:00:00.000Z", outcome: "qualified_lead" as const, quantity: 2, valueMinor: null, currency: null, metaEntityRef: null, mappingStatus: "unmapped" as const };
const revenue = { signalRef: "signal_revenue", entityRef: "campaign_primary", occurredAt: "2026-08-09T10:00:00.000Z", outcome: "revenue" as const, quantity: 1, valueMinor: 12_500, currency: "TRY", metaEntityRef: "meta_campaign_primary", mappingStatus: "verified" as const };
describe("business outcome signals", () => {
  it("creates stable manual/CSV provenance and never turns outcomes into a Meta proxy", () => {
    const first = createBusinessOutcomeSignalBatch({ source, signals: [revenue, lead] });
    const replay = createBusinessOutcomeSignalBatch({ source, signals: [lead, revenue] });
    expect(replay).toEqual(first);
    expect(summarizeBusinessOutcomeSignals(first)).toEqual(expect.objectContaining({ totals: { qualified_lead: 2, appointment: 0, sale: 0, revenue: 1, invalid_lead: 0 }, revenueMinor: 12_500, mappedSignalCount: 1, unmappedSignalCount: 1, metaProxyEligible: false }));
  });
  it("rejects revenue without money, non-revenue money, and forged batches", () => {
    expect(() => createBusinessOutcomeSignalBatch({ source, signals: [{ ...revenue, valueMinor: null }] })).toThrow("revenue");
    expect(() => createBusinessOutcomeSignalBatch({ source, signals: [{ ...lead, valueMinor: 1, currency: "TRY" }] })).toThrow("yalnız revenue");
    const batch = createBusinessOutcomeSignalBatch({ source, signals: [lead] });
    expect(() => summarizeBusinessOutcomeSignals({ ...batch, batchId: "outcome_batch_" + "0".repeat(24) })).toThrow(BusinessOutcomeSignalError);
  });
  it("requires explicit verified mapping and rejects duplicate source identities", () => {
    expect(() => createBusinessOutcomeSignalBatch({ source, signals: [{ ...lead, mappingStatus: "verified" }] })).toThrow("metaEntityRef");
    expect(() => createBusinessOutcomeSignalBatch({ source, signals: [lead, lead] })).toThrow("benzersiz");
  });
});
