import { describe, expect, it } from "vitest";
import { buildBusinessOutcomeEvidence, BusinessOutcomeEvidenceError } from "@/analyses/business-outcome-evidence";

const input = { entityRef: "campaign_primary", sourceHeadHash: "a".repeat(64), windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-08T00:00:00.000Z", materializedAt: "2026-08-10T12:00:00.000Z", signals: [
  { batchId: "outcome_batch_primary", signalRef: "signal_revenue", entityRef: "campaign_primary", occurredAt: "2026-08-03T10:00:00.000Z", outcome: "revenue" as const, quantity: 1, valueMinor: 12500, currency: "TRY", mappingStatus: "verified" as const },
  { batchId: "outcome_batch_primary", signalRef: "signal_lead", entityRef: "campaign_primary", occurredAt: "2026-08-02T10:00:00.000Z", outcome: "qualified_lead" as const, quantity: 2, valueMinor: null, currency: null, mappingStatus: "unmapped" as const },
] };
describe("business outcome evidence", () => {
  it("creates a deterministic compact L4 envelope without raw source or action authority", () => {
    const first = buildBusinessOutcomeEvidence(input); const second = buildBusinessOutcomeEvidence({ ...input, signals: [...input.signals].reverse() });
    expect(second).toEqual(first); expect(first).toMatchObject({ evidenceRef: expect.stringMatching(/^outcome_evidence_[a-f0-9]{24}$/), evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/), summary: { signalCount: 2, batchCount: 1, totals: { qualified_lead: 2, revenue: 1 }, revenueMinorByCurrency: { TRY: 12500 }, verifiedSignalCount: 1, unmappedSignalCount: 1, metaProxyEligible: false } });
    expect(JSON.stringify(first)).not.toMatch(/raw|contentHash|actor|token|canExecute|canWriteMeta/i);
  });
  it("fails closed on outside-window, duplicate and invalid revenue evidence", () => {
    expect(() => buildBusinessOutcomeEvidence({ ...input, signals: [{ ...input.signals[0]!, occurredAt: "2026-08-08T00:00:00.000Z" }] })).toThrow(BusinessOutcomeEvidenceError);
    expect(() => buildBusinessOutcomeEvidence({ ...input, signals: [input.signals[0]!, input.signals[0]!] })).toThrow(BusinessOutcomeEvidenceError);
    expect(() => buildBusinessOutcomeEvidence({ ...input, signals: [{ ...input.signals[0]!, valueMinor: null }] })).toThrow(BusinessOutcomeEvidenceError);
  });
});
