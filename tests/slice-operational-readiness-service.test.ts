import { describe, expect, it, vi } from "vitest";
import { SliceOperationalReadinessService } from "@/application/slice-operational-readiness-service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const campaignId = "33333333-3333-4333-8333-333333333333";
const candidateRef = `category_entity_${"a".repeat(24)}`;
const scope = { market: "international" as const, serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr" };
const source = {
  campaigns: [{ id: campaignId, ref: candidateRef, name: "Private name", accountName: "Private account", fetchedAt: "2026-08-14T00:00:00.000Z" }],
  paths: [{ workspaceId, nodes: [{ level: "campaign" as const, id: campaignId }] }],
  dimensions: ["market", "service_line", "campaign_family"].map((key) => ({ id: `d-${key}`, workspaceId, key, version: 1, cardinality: "single" as const, allowedEntityLevels: ["campaign"] as const, archivedAt: null })),
  definitions: [{ dimensionId: "d-market", key: "yabanci" }, { dimensionId: "d-service_line", key: scope.serviceRef }, { dimensionId: "d-campaign_family", key: scope.campaignFamilyRef }].map((item) => ({ id: `def-${item.dimensionId}`, workspaceId, dimensionId: item.dimensionId, key: item.key, label: item.key, version: 1, archivedAt: null })),
  assignments: ["d-market", "d-service_line", "d-campaign_family"].map((dimensionId) => ({ id: `assignment-${dimensionId}`, workspaceId, dimensionId, definitionId: `def-${dimensionId}`, entity: { level: "campaign" as const, id: campaignId }, operation: "add" as const, source: "manual" as const, manualLock: true, evidence: [{ kind: "mirror", ref: "mirror" }], confidence: 1, version: 1, archivedAt: null })),
};
const principal = { workspaceId, actor: { userId } } as any;
const record = { invalidated: false, analysisDataScope: { adAccountId: "44444444-4444-4444-8444-444444444444", campaignId, metaConnectionId: "55555555-5555-4555-8555-555555555555" }, context: { contextHash: "b".repeat(64) } } as any;

describe("Slice operational readiness", () => {
  it("matches only a server-derived candidate to an already-valid frozen context and exact scope evidence", async () => {
    const load = vi.fn().mockResolvedValue(source);
    const listLatestValidCampaignPublic = vi.fn().mockResolvedValue([record]);
    const loadExact = vi.fn().mockResolvedValue({ state: "ready", scope, evidenceRefs: ["context_proven"] });
    const service = new SliceOperationalReadinessService({ load }, { listLatestValidCampaignPublic }, { loadExact }, [{ workspaceId, userId, role: "owner" }]);
    await expect(service.list(principal)).resolves.toEqual({ version: "slice-operational-readiness/1.0.0", items: [{ candidateRef, scope, frozenContext: "ready", budgetImpact: "eligible" }], authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(loadExact).toHaveBeenCalledWith({ workspaceId, adAccountId: record.analysisDataScope.adAccountId, campaignId, contextHash: record.context.contextHash, expectedScope: scope });
  });

  it("does not compose or fabricate a context when none is already current", async () => {
    const loadExact = vi.fn();
    const service = new SliceOperationalReadinessService({ load: vi.fn().mockResolvedValue(source) }, { listLatestValidCampaignPublic: vi.fn().mockResolvedValue([]) }, { loadExact }, [{ workspaceId, userId, role: "owner" }]);
    await expect(service.list(principal)).resolves.toMatchObject({ items: [{ candidateRef, frozenContext: "missing", budgetImpact: "blocked" }] });
    expect(loadExact).not.toHaveBeenCalled();
  });
});
