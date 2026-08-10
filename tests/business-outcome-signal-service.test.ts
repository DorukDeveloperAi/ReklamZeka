import { describe, expect, it, vi } from "vitest";
import { BusinessOutcomeSignalService } from "@/application/business-outcome-signal-service";
const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222", workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
const command = { source: { kind: "manual" as const, sourceRef: "source_outcomes", contentHash: "a".repeat(64), observedAt: "2026-08-10T09:00:00.000Z" }, signals: [{ signalRef: "signal_lead", entityRef: "campaign_primary", occurredAt: "2026-08-09T09:00:00.000Z", outcome: "qualified_lead" as const, quantity: 1, valueMinor: null, currency: null, metaEntityRef: null, mappingStatus: "unmapped" as const }] };
describe("BusinessOutcomeSignalService", () => {
  it("mints canonical batch identity and binds actor, tenant and server time", async () => {
    const record = vi.fn(async (input: { batch: { batchId: string } }) => ({ outcome: "inserted" as const, batchId: input.batch.batchId,
      summary: { batchId: input.batch.batchId, totals: { qualified_lead: 1, appointment: 0, sale: 0, revenue: 0, invalid_lead: 0 }, revenueMinor: 0, mappedSignalCount: 0, unmappedSignalCount: 1, metaProxyEligible: false as const }, capabilities: { canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const } }));
    const service = new BusinessOutcomeSignalService({ record } as never, [{ userId: principal.actor.userId, workspaceId: principal.workspaceId, role: "analyst" }], () => new Date("2026-08-10T12:00:00.000Z"));
    await expect(service.record(principal, command)).resolves.toMatchObject({ authority: { canRecordEvidence: true, canExecute: false, canWriteMeta: false, metaProxyEligible: false } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, actorRef: principal.readerRef, role: "analyst", occurredAt: "2026-08-10T12:00:00.000Z", batch: expect.objectContaining({ batchId: expect.stringMatching(/^outcome_batch_/) }) }));
  });
  it("rejects viewer evidence injection before canonicalization can write", async () => {
    const record = vi.fn(); const service = new BusinessOutcomeSignalService({ record } as never, [{ userId: principal.actor.userId, workspaceId: principal.workspaceId, role: "viewer" }]);
    await expect(service.record(principal, command)).rejects.toMatchObject({ status: 403 }); expect(record).not.toHaveBeenCalled();
  });
});
