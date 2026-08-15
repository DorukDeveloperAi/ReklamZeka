import { describe, expect, it } from "vitest";
import { buildCampaignClassificationReview } from "@/domain/campaigns/campaign-classification-review";
import { requiresInitialCategoryCatalog } from "@/app/dashboard/campaign-classification-review-panel";
const workspaceId = "workspace";
const dimension = { id: "dimension", workspaceId, key: "service_line", version: 1, cardinality: "single" as const, allowedEntityLevels: ["campaign"] as const, archivedAt: null };
const definition = { id: "definition", workspaceId, dimensionId: "dimension", key: "ftr", label: "Fizik tedavi", version: 1, archivedAt: null };
const path = { workspaceId, nodes: [{ level: "campaign" as const, id: "campaign" }] };
describe("campaign classification review", () => {
  it("uses only existing category evidence and exposes only an opaque campaign target for review", () => {
    const result = buildCampaignClassificationReview({ campaigns: [{ id: "campaign", ref: `category_entity_${"a".repeat(24)}`, name: "Canlı kampanya", accountName: "Hesap", fetchedAt: "2026-08-13T00:00:00.000Z" }], paths: [path], dimensions: [dimension], definitions: [definition], assignments: [{ id: "assignment", workspaceId, dimensionId: "dimension", definitionId: "definition", entity: { level: "campaign", id: "campaign" }, operation: "add", source: "manual", manualLock: true, evidence: [{ kind: "mirror", ref: "mirror_campaign" }], confidence: 1, version: 1, archivedAt: null }] });
    expect(result.authority).toEqual({ canAssign: false, canPublish: false, canAuthorizeAction: false, canWriteMeta: false });
    const service = result.entries[0]!.facets.find((facet) => facet.facet === "service")!;
    expect(service).toMatchObject({ state: "assigned", values: ["Fizik tedavi"], evidenceCount: 1 });
    expect(result.entries[0]!.facets.find((facet) => facet.facet === "platform")!).toMatchObject({ state: "not_configured", reasonCodes: ["dimension_not_configured"] });
    expect(result.entries[0]!.reviewRequired).toBe(true);
    expect(result.entries[0]!.campaignRef).toBe(`category_entity_${"a".repeat(24)}`);
    expect(JSON.stringify(result)).not.toContain('"campaign"');
  });
  it("shows category setup only when every mandatory slice facet is unconfigured", () => {
    const unconfigured = ["market", "service", "family"].map((facet) => ({ facet, state: "not_configured" as const }));
    expect(requiresInitialCategoryCatalog([{ facets: unconfigured } as never])).toBe(true);
    expect(requiresInitialCategoryCatalog([{ facets: [{ facet: "market", state: "assigned" }] } as never])).toBe(false);
  });
});
