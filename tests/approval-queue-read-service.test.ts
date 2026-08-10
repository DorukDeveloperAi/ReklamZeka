import { describe, expect, it, vi } from "vitest";
import { ApprovalQueueReadError, ApprovalQueueReadService, type ApprovalQueueRecord, type ApprovalQueueRepository } from "@/application/approval-queue-read-service";

const workspaceId = "11111111-1111-4111-a111-111111111111";

function record(patch: Partial<ApprovalQueueRecord> = {}): ApprovalQueueRecord {
  return {
    unitRef: "action_unit_aaaaaaaaaaaaaaaaaaaa", bundleRef: "action_bundle_bbbbbbbbbbbbbbbbbbbb",
    status: "awaiting_approval", risk: "K2", actionType: "budget_decrease",
    accountRef: "account_0123456789abcdef", campaignRef: "entity_fedcba9876543210", entity: { type: "campaign", ref: "entity_fedcba9876543210", label: "Korunan bölge kampanyası" },
    beforeAfter: { field: "daily_budget_minor", beforeMinor: 100_000, afterMinor: 95_000, currency: "TRY" },
    autonomy: { profileRef: "autonomy_0123456789abcdef", decision: "approval_required", trace: [
      { scope: "workspace", decision: "approval_required", reasonCode: "workspace.approval_only" },
      { scope: "risk", decision: "approval_required", reasonCode: "risk.k2" },
    ] },
    expiresAt: "2026-08-07T14:00:00.000Z", createdAt: "2026-08-07T13:00:00.000Z",
    dependencies: [{ unitRef: "action_unit_cccccccccccccccccccc", status: "approved" }], summaryCode: "budget.protected_decrease",
    ...patch,
  };
}

function repository(records: readonly ApprovalQueueRecord[]): ApprovalQueueRepository {
  return { list: vi.fn(async () => records), get: vi.fn(async ({ unitRef }) => records.find((item) => item.unitRef === unitRef) ?? null) };
}

describe("Approval Queue public read service", () => {
  it("returns bounded list/detail with unit-level public evidence and no mutation authority", async () => {
    const repo = repository([record()]);
    const service = new ApprovalQueueReadService(repo);
    const list = await service.list({ workspaceId });
    const detail = await service.get({ workspaceId, unitRef: record().unitRef });
    expect(list).toMatchObject({ view: "list", items: [{ status: "awaiting_approval", risk: "K2", actionType: "budget_decrease",
      beforeAfter: { beforeMinor: 100_000, afterMinor: 95_000 }, autonomy: { decision: "approval_required" },
      dependencies: [{ status: "approved" }] }], authority: { readOnly: true, canApprove: false, canReject: false, canRequestChanges: false, canGrant: false, canExecute: false, canWriteMeta: false } });
    expect(detail.item.unitRef).toBe(record().unitRef);
    expect(repo.list).toHaveBeenCalledWith({ workspaceId, entityRef: null, campaignRef: null, before: null, limit: 26 });
    expect(JSON.stringify({ list, detail })).not.toContain(workspaceId);
  });

  it("uses descending keyset pagination and rejects malformed source ordering", async () => {
    const newer = record({ unitRef: "action_unit_dddddddddddddddddddd", createdAt: "2026-08-07T13:30:00.000Z" });
    const older = record();
    const page = await new ApprovalQueueReadService(repository([newer, older])).list({ workspaceId, limit: 1 });
    expect(page.nextCursor).not.toBeNull();
    const nextRepo = repository([]);
    await new ApprovalQueueReadService(nextRepo).list({ workspaceId, cursor: page.nextCursor });
    expect(nextRepo.list).toHaveBeenCalledWith({ workspaceId, entityRef: null, campaignRef: null, before: { createdAt: newer.createdAt, unitRef: newer.unitRef }, limit: 26 });
    await expect(new ApprovalQueueReadService(repository([older, newer])).list({ workspaceId }))
      .rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
  });

  it.each([
    ["uuid", () => record({ entity: { ...record().entity, label: workspaceId } })],
    ["full hash", () => record({ summaryCode: `unsafe.${"a".repeat(64)}` })],
    ["Meta id", () => record({ entity: { ...record().entity, label: "act_123456789012" } })],
    ["token", () => record({ entity: { ...record().entity, label: `Bearer ${"x".repeat(40)}` } })],
    ["nested authority", () => ({ ...record(), autonomy: { ...record().autonomy, trace: [{ ...record().autonomy.trace[0], authority: "approve" }] } })],
    ["raw payload", () => ({ ...record(), entity: { ...record().entity, rawPayload: {} } })],
  ])("rejects %s material fail-closed", async (_label, make) => {
    await expect(new ApprovalQueueReadService(repository([make() as ApprovalQueueRecord])).list({ workspaceId }))
      .rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
  });

  it("distinguishes unavailable and not found", async () => {
    await expect(new ApprovalQueueReadService({ list: async () => { throw new Error(); }, get: async () => null }).list({ workspaceId }))
      .rejects.toEqual(expect.objectContaining({ code: "source_unavailable" }));
    await expect(new ApprovalQueueReadService(repository([])).get({ workspaceId, unitRef: record().unitRef }))
      .rejects.toEqual(expect.objectContaining({ code: "not_found" }));
    await expect(new ApprovalQueueReadService(repository([])).list({ workspaceId, limit: 101 })).rejects.toBeInstanceOf(ApprovalQueueReadError);
  });

  it("returns only the exact opaque entity scope and rejects a mismatched source row", async () => {
    const exactEntityRef = record().entity.ref;
    const foreign = record({ unitRef: "action_unit_dddddddddddddddddddd", entity: { ...record().entity, ref: "entity_0123456789abcdef" } });
    const source = repository([record()]);
    const result = await new ApprovalQueueReadService(source).list({ workspaceId, entityRef: exactEntityRef });
    expect(result).toMatchObject({ entityRef: exactEntityRef, items: [{ entity: { ref: exactEntityRef } }] });
    expect(source.list).toHaveBeenCalledWith({ workspaceId, entityRef: exactEntityRef, campaignRef: null, before: null, limit: 26 });
    await expect(new ApprovalQueueReadService(repository([foreign])).list({ workspaceId, entityRef: exactEntityRef }))
      .rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
  });

  it("returns the resolved campaign scope for child units and rejects mixed or mismatched scope", async () => {
    const campaignRef = record().campaignRef;
    const child = record({ entity: { ...record().entity, type: "ad_set", ref: "entity_0123456789abcdef" } });
    const source = repository([child]);
    await expect(new ApprovalQueueReadService(source).list({ workspaceId, campaignRef })).resolves.toMatchObject({
      campaignRef, items: [{ campaignRef, entity: { type: "ad_set" } }],
    });
    expect(source.list).toHaveBeenCalledWith({ workspaceId, entityRef: null, campaignRef, before: null, limit: 26 });
    await expect(new ApprovalQueueReadService(repository([record({ campaignRef: "entity_0123456789abcdef" })])).list({ workspaceId, campaignRef }))
      .rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
    await expect(new ApprovalQueueReadService(repository([])).list({ workspaceId, entityRef: record().entity.ref, campaignRef }))
      .rejects.toEqual(expect.objectContaining({ code: "invalid_input" }));
  });

  it("aligns canonical status action types and returns a deeply immutable projection", async () => {
    const source = record({ actionType: "status_pause", status: "dependency_failed",
      beforeAfter: { field: "configured_status", before: "ACTIVE", after: "PAUSED" } });
    const result = await new ApprovalQueueReadService(repository([source])).list({ workspaceId });
    expect(result.items[0]).toMatchObject({ actionType: "status_pause", status: "dependency_failed" });
    expect(Object.isFrozen(result.items[0])).toBe(true);
    expect(Object.isFrozen(result.items[0]!.entity)).toBe(true);
    expect(Object.isFrozen(result.items[0]!.beforeAfter)).toBe(true);
    expect(Object.isFrozen(result.items[0]!.autonomy)).toBe(true);
    expect(Object.isFrozen(result.items[0]!.autonomy.trace)).toBe(true);
    expect(Object.isFrozen(result.items[0]!.autonomy.trace[0])).toBe(true);
    expect(Object.isFrozen(result.items[0]!.dependencies)).toBe(true);
    expect(Object.isFrozen(result.items[0]!.dependencies[0])).toBe(true);
  });
});
