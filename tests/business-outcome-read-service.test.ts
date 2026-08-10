import { describe, expect, it, vi } from "vitest";
import { BusinessOutcomeReadService } from "@/application/business-outcome-read-service";

const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222", workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
const row = { batchId: "outcome_batch_primary", signalRef: "signal_revenue", entityRef: "campaign_primary", occurredAt: "2026-08-10T10:00:00.000Z", outcome: "revenue", quantity: 1, valueMinor: 12500, currency: "TRY", metaEntityRef: "meta_campaign_primary", mappingStatus: "verified", source: { kind: "csv", sourceRef: "source_crm_export", observedAt: "2026-08-10T11:00:00.000Z" } } as const;
describe("BusinessOutcomeReadService", () => {
  it("returns only normalized evidence with a stable bounded cursor and no action authority", async () => {
    const listPublic = vi.fn(async () => [row]);
    const service = new BusinessOutcomeReadService({ listPublic }, [{ userId: principal.actor.userId, workspaceId: principal.workspaceId, role: "viewer" }]);
    const result = await service.list(principal, { entityRef: "campaign_primary", limit: 25 });
    expect(listPublic).toHaveBeenCalledWith({ workspaceId: principal.workspaceId, entityRef: "campaign_primary", before: null, limit: 25 });
    expect(result).toMatchObject({ contractVersion: "business-outcome-read-model/1.0.0", items: [row], nextCursor: expect.stringMatching(/^outcome_cursor_/), capabilities: { containsRawSource: false, containsActorOrAuditData: false, canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false } });
    expect(JSON.stringify(result.items)).not.toMatch(/contentHash|actorId|audit/i);
    expect(Buffer.from(result.nextCursor!.slice("outcome_cursor_".length), "base64url").toString("utf8")).toBe(JSON.stringify({ v: 1, occurredAt: row.occurredAt, signalRef: row.signalRef }));
  });
  it("rejects cursor tampering and role-less reads before querying", async () => {
    const listPublic = vi.fn(async () => []);
    const service = new BusinessOutcomeReadService({ listPublic }, []);
    await expect(service.list(principal, { cursor: "outcome_cursor_not-valid" })).rejects.toMatchObject({ status: 403 });
    expect(listPublic).not.toHaveBeenCalled();
  });
  it("rejects malformed cursor after authorization", async () => {
    const listPublic = vi.fn(async () => []);
    const service = new BusinessOutcomeReadService({ listPublic }, [{ userId: principal.actor.userId, workspaceId: principal.workspaceId, role: "analyst" }]);
    await expect(service.list(principal, { cursor: "outcome_cursor_bad!" })).rejects.toMatchObject({ code: "invalid_input" });
    expect(listPublic).not.toHaveBeenCalled();
  });
});
