import { describe, expect, it } from "vitest";
import { buildSliceScopeCandidates } from "@/domain/campaigns/slice-scope-candidates";

const workspaceId = "workspace";
const campaignPath = { workspaceId, nodes: [{ level: "campaign" as const, id: "campaign-1" }] };
function dimension(key: string) { return { id: `d-${key}`, workspaceId, key, version: 1, cardinality: "single" as const, allowedEntityLevels: ["campaign"] as const, archivedAt: null }; }
function definition(dimensionId: string, key: string) { return { id: `def-${dimensionId}`, workspaceId, dimensionId, key, label: `label ${key}`, version: 1, archivedAt: null }; }
function assignment(dimensionId: string, definitionId: string) { return { id: `a-${dimensionId}`, workspaceId, dimensionId, definitionId, entity: { level: "campaign" as const, id: "campaign-1" }, operation: "add" as const, source: "manual" as const, manualLock: true, evidence: [{ kind: "mirror", ref: "campaign-1" }], confidence: 1, version: 1, archivedAt: null }; }
function source(overrides: Record<string, unknown> = {}) {
  const dims = [dimension("market"), dimension("service_line"), dimension("campaign_family"), dimension("geo_market"), dimension("publisher_platform")];
  const defs = [definition("d-market", "yabanci"), definition("d-service_line", "service_physical_therapy"), definition("d-campaign_family", "campaign_family_intensive_ftr"), definition("d-geo_market", "gcc"), definition("d-publisher_platform", "instagram")];
  return { campaigns: [{ id: "campaign-1", ref: `category_entity_${"a".repeat(24)}`, name: "Name is ignored", accountName: "Account", fetchedAt: "2026-08-14T00:00:00.000Z" }], paths: [campaignPath], dimensions: dims, definitions: defs, assignments: defs.map((item) => assignment(item.dimensionId, item.id)), ...overrides } as any;
}
describe("slice scope candidates", () => {
  it("projects only exact coherent machine-key scope and keeps budget evidence closed", () => {
    const result = buildSliceScopeCandidates(source());
    expect(result).toMatchObject({ version: "slice-scope-candidates/1.0.0", authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(result.candidates).toEqual([{ campaignRef: `category_entity_${"a".repeat(24)}`, scope: { market: "international", serviceRef: "service_physical_therapy", campaignFamilyRef: "campaign_family_intensive_ftr", countryOrRegion: "gcc", platform: "instagram" }, requiresFrozenContext: true, budgetImpactReady: false }]);
    expect(JSON.stringify(result)).not.toContain("Name is ignored");
    expect(JSON.stringify(result)).not.toContain("label ");
  });
  it("omits campaigns with noncanonical mandatory market and never synthesizes absent optional facets", () => {
    expect(buildSliceScopeCandidates(source({ definitions: source().definitions.map((item: any) => item.dimensionId === "d-market" ? { ...item, key: "turkiye" } : item) })).candidates).toEqual([]);
    expect(buildSliceScopeCandidates(source()).candidates[0]!.scope).not.toHaveProperty("audienceStrategy");
    expect(buildSliceScopeCandidates(source()).candidates[0]!.scope).not.toHaveProperty("conversionRoute");
  });
});
