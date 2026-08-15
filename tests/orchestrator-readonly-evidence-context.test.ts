import { describe, expect, it } from "vitest";
import { createOrchestratorReadOnlyEvidenceContext, orchestratorReadOnlyEvidenceContextHash,
  ReadOnlyEvidenceContextService, unavailableOrchestratorReadOnlyEvidenceContext } from "@/application/orchestrator-readonly-evidence-context";
import { buildCanonicalPerformanceReadModel } from "@/domain/meta/performance-read-model";

const workspaceId = "11111111-1111-4111-a111-111111111111";

describe("Orchestrator readonly evidence context", () => {
  it("freezes only bounded aggregate performance and timeline state", () => {
    const snapshot = createOrchestratorReadOnlyEvidenceContext({ performance: buildCanonicalPerformanceReadModel([]), timeline: [{
      kind: "delivery_alert", occurredAt: "2026-08-14T10:00:00.000Z", title: "Do not expose", detail: "Do not expose",
    }] });
    expect(snapshot).toMatchObject({ version: "orchestrator-readonly-evidence-context/1.0.0",
      performance: { state: "unavailable", accountCount: 0, campaignCount: 0 },
      timeline: { state: "ready", eventCount: 1, kinds: [{ kind: "delivery_alert", count: 1 }] } });
    expect(JSON.stringify(snapshot)).not.toContain("Do not expose");
    expect(orchestratorReadOnlyEvidenceContextHash(snapshot)).toMatch(/^[a-f0-9]{64}$/);
    expect(orchestratorReadOnlyEvidenceContextHash(unavailableOrchestratorReadOnlyEvidenceContext())).toBe("UNAVAILABLE_NOT_BOUND");
  });

  it("loads both existing read models without introducing write authority", async () => {
    const service = new ReadOnlyEvidenceContextService({ load: async (received) => {
      expect(received).toBe(workspaceId); return [];
    } }, { list: async (input) => {
      expect(input).toEqual({ workspaceId, limit: 12 }); return [];
    } });
    await expect(service.load({ workspaceId })).resolves.toMatchObject({ performance: { state: "unavailable" }, timeline: { eventCount: 0 } });
  });

  it("rejects a claimed ready cohort unless market equivalence, delivery, and freshness are all proven", () => {
    const input = { performance: buildCanonicalPerformanceReadModel([]), timeline: [] };
    expect(() => createOrchestratorReadOnlyEvidenceContext({ ...input,
      temporalCohort: { state: "ready", equivalence: "mixed_market", delivery: "clear", freshness: "fresh" } })).toThrow();
    expect(createOrchestratorReadOnlyEvidenceContext({ ...input,
      temporalCohort: { state: "insufficient", equivalence: "equivalent", delivery: "open_alert", freshness: "fresh" } }).temporalCohort)
      .toEqual({ state: "insufficient", equivalence: "equivalent", delivery: "open_alert", freshness: "fresh" });
  });
});
