import { describe, expect, it } from "vitest";
import { OrganizationCampaignService } from "@/application/organization-campaign-service";
import { categoryDefinitionPublicRef, categoryEntityPublicRef } from "@/domain/categories/public-reference";
import { organizationCampaignPublicRef, organizationMembershipPublicRef } from "@/domain/campaigns/organization-campaign";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const campaignId = "33333333-3333-4333-8333-333333333333";
const organizationId = "44444444-4444-4444-8444-444444444444";
const domesticDefinitionId = "55555555-5555-4555-8555-555555555555";
const internationalDefinitionId = "66666666-6666-4666-8666-666666666666";
const principal = { workspaceId, actor: { userId: actorId }, readerRef: "reader" } as any;
const membership = [{ workspaceId, userId: actorId, role: "owner" as const }];
function source() { const dims = [{ id: "d-market", workspaceId, key: "market", version: 1, cardinality: "single" as const, allowedEntityLevels: ["campaign"] as const, archivedAt: null }, { id: "d-service", workspaceId, key: "service_line", version: 1, cardinality: "single" as const, allowedEntityLevels: ["campaign"] as const, archivedAt: null }, { id: "d-family", workspaceId, key: "campaign_family", version: 1, cardinality: "single" as const, allowedEntityLevels: ["campaign"] as const, archivedAt: null }]; const defs = [{ id: domesticDefinitionId, workspaceId, dimensionId: "d-market", key: "yerli", label: "Yerli", version: 1, archivedAt: null }, { id: internationalDefinitionId, workspaceId, dimensionId: "d-market", key: "yabanci", label: "Yabancı", version: 1, archivedAt: null }, { id: "s", workspaceId, dimensionId: "d-service", key: "service_ftr", label: "FTR", version: 1, archivedAt: null }, { id: "f", workspaceId, dimensionId: "d-family", key: "campaign_family_ftr", label: "FTR", version: 1, archivedAt: null }]; const assignment = (definitionId: string, dimensionId: string) => ({ id: `a-${definitionId}`, workspaceId, dimensionId, definitionId, entity: { level: "campaign" as const, id: campaignId }, operation: "add" as const, source: "manual" as const, manualLock: true, evidence: [{ kind: "mirror", ref: "x" }], confidence: 1, version: 1, archivedAt: null }); return { campaigns: [{ id: campaignId, ref: categoryEntityPublicRef(workspaceId, "campaign", campaignId), name: "Kampanya", accountName: "Hesap", fetchedAt: "2026-08-17T00:00:00.000Z" }], paths: [{ workspaceId, nodes: [{ level: "campaign" as const, id: campaignId }] }], dimensions: dims, definitions: defs, assignments: [assignment(internationalDefinitionId, "d-market"), assignment("s", "d-service"), assignment("f", "d-family")] }; }
describe("organization campaign foundation", () => {
  it("uses the canonical market definition and never exposes tenant UUIDs", async () => {
    const writes: any[] = []; const repo: any = { load: async () => ({ organizationCampaigns: [{ id: organizationId, workspaceId, label: "Yabancı FTR", marketDefinitionId: internationalDefinitionId, tombstonedAt: null }], memberships: [], unassignedCampaigns: [{ id: campaignId, name: "Kampanya" }] }), create: async (input: any) => { writes.push(input); return { id: organizationId, workspaceId, label: input.label, marketDefinitionId: input.marketDefinitionId, tombstonedAt: null }; }, assign: async () => ({}) };
    const service = new OrganizationCampaignService(repo, { load: async () => source() } as any, membership);
    const result = await service.inspect(principal);
    expect(result.organizationCampaigns[0]).toMatchObject({ ref: organizationCampaignPublicRef(workspaceId, organizationId), market: "international" });
    expect(JSON.stringify(result)).not.toContain(organizationId);
    await service.create(principal, { label: "Yeni", marketDefinitionRef: categoryDefinitionPublicRef("market", "yerli") });
    expect(writes[0]).toMatchObject({ marketDefinitionId: domesticDefinitionId });
  });
  it("rejects cross-market membership before any repository write", async () => {
    let writes = 0; const repo: any = { load: async () => ({ organizationCampaigns: [{ id: organizationId, workspaceId, label: "Yerli", marketDefinitionId: domesticDefinitionId, tombstonedAt: null }], memberships: [], unassignedCampaigns: [] }), create: async () => ({}), assign: async () => { writes++; } };
    const service = new OrganizationCampaignService(repo, { load: async () => source() } as any, membership);
    await expect(service.assign(principal, { organizationCampaignRef: organizationCampaignPublicRef(workspaceId, organizationId), campaignRef: categoryEntityPublicRef(workspaceId, "campaign", campaignId), effectiveFrom: "2026-08-17T00:00:00.000Z" })).rejects.toMatchObject({ code: "market_mismatch" });
    expect(writes).toBe(0);
  });
  it("closes an exact open membership once through the server-owned opaque reference", async () => {
    const membershipId = "77777777-7777-4777-8777-777777777777"; let close: any = null;
    const repo: any = { load: async () => ({ organizationCampaigns: [], memberships: [{ id: membershipId, workspaceId, organizationCampaignId: organizationId, campaignId, marketDefinitionId: internationalDefinitionId, effectiveFrom: "2026-08-01T00:00:00.000Z", effectiveTo: null }], unassignedCampaigns: [] }), create: async () => ({}), assign: async () => ({}), close: async (input: any) => { close = input; } };
    const service = new OrganizationCampaignService(repo, { load: async () => source() } as any, membership);
    const membershipRef = organizationMembershipPublicRef(workspaceId, membershipId);
    await expect(service.close(principal, { membershipRef, closeAt: "2026-08-17T00:00:00.000Z" })).resolves.toMatchObject({ closed: true });
    expect(close).toMatchObject({ workspaceId, membershipId, effectiveTo: "2026-08-17T00:00:00.000Z" });
  });
});
