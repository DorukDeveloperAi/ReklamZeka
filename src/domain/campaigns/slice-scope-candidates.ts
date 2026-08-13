import { inspectEffectiveCategory, type CategoryAssignment, type CategoryDefinition, type CategoryDimension, type CategoryEntityPath } from "@/domain/categories/registry";
import type { CampaignClassificationReviewSource } from "./campaign-classification-review";

export const SLICE_SCOPE_CANDIDATES_VERSION = "slice-scope-candidates/1.0.0" as const;
type Market = "domestic" | "international";
type RequiredFacet = "market" | "serviceRef" | "campaignFamilyRef";
type OptionalFacet = "countryOrRegion" | "audienceStrategy" | "platform" | "conversionRoute";
const REQUIRED: Readonly<Record<RequiredFacet, string>> = Object.freeze({ market: "market", serviceRef: "service_line", campaignFamilyRef: "campaign_family" });
const OPTIONAL: Readonly<Record<OptionalFacet, string>> = Object.freeze({ countryOrRegion: "geo_market", audienceStrategy: "audience_strategy", platform: "publisher_platform", conversionRoute: "conversion_route" });
const SERVICE = /^service_[a-z0-9][a-z0-9_.:-]{0,119}$/;
const FAMILY = /^campaign_family_[a-z0-9][a-z0-9_.:-]{0,111}$/;
const SAFE_OPTIONAL = /^[a-z][a-z0-9_.:-]{0,127}$/;
const CLOSED = Object.freeze({ canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });

type Scope = Readonly<{ market: Market; serviceRef: string; campaignFamilyRef: string; countryOrRegion?: string; audienceStrategy?: string; platform?: string; conversionRoute?: string }>;
function oneDimension(key: string, dimensions: readonly CategoryDimension[]): CategoryDimension | null {
  const found = dimensions.filter((dimension) => dimension.key === key);
  return found.length === 1 ? found[0]! : null;
}
/** A value is usable only when every observed hierarchy path resolves to the same single machine key. */
function coherentKey(input: Readonly<{ dimensionKey: string; paths: readonly CategoryEntityPath[]; dimensions: readonly CategoryDimension[]; definitions: readonly CategoryDefinition[]; assignments: readonly CategoryAssignment[] }>): string | null {
  const dimension = oneDimension(input.dimensionKey, input.dimensions);
  if (!dimension || input.paths.length === 0) return null;
  let selected: string | null = null;
  for (const path of input.paths) {
    const inspected = inspectEffectiveCategory({ dimension,
      definitions: input.definitions.filter((definition) => definition.dimensionId === dimension.id),
      assignments: input.assignments.filter((assignment) => assignment.dimensionId === dimension.id), path });
    if (inspected.state !== "applied" || inspected.resolution.values.length !== 1) return null;
    const key = inspected.resolution.values[0]!.key;
    if (!SAFE_OPTIONAL.test(key) || selected !== null && selected !== key) return null;
    selected = key;
  }
  return selected;
}
function canonicalMarket(key: string | null): Market | null { return key === "yerli" ? "domestic" : key === "yabanci" ? "international" : null; }

/**
 * Read-only projection for pre-filling a new Rule form. It intentionally does
 * not infer from names/content and does not turn a live category into frozen
 * budget evidence. Optional facets are omitted unless exact and coherent.
 */
export function buildSliceScopeCandidates(source: CampaignClassificationReviewSource) {
  const candidates = source.campaigns.flatMap((campaign) => {
    const paths = source.paths.filter((path) => path.nodes[0]?.level === "campaign" && path.nodes[0]?.id === campaign.id);
    const market = canonicalMarket(coherentKey({ dimensionKey: REQUIRED.market, paths, dimensions: source.dimensions, definitions: source.definitions, assignments: source.assignments }));
    const serviceRef = coherentKey({ dimensionKey: REQUIRED.serviceRef, paths, dimensions: source.dimensions, definitions: source.definitions, assignments: source.assignments });
    const campaignFamilyRef = coherentKey({ dimensionKey: REQUIRED.campaignFamilyRef, paths, dimensions: source.dimensions, definitions: source.definitions, assignments: source.assignments });
    if (!market || !serviceRef || !campaignFamilyRef || !SERVICE.test(serviceRef) || !FAMILY.test(campaignFamilyRef)) return [];
    const optional = Object.fromEntries(Object.entries(OPTIONAL).flatMap(([facet, dimensionKey]) => {
      const value = coherentKey({ dimensionKey, paths, dimensions: source.dimensions, definitions: source.definitions, assignments: source.assignments });
      if (facet === "platform" && value && !["facebook", "instagram", "mixed"].includes(value)) return [];
      if (facet === "conversionRoute" && value && !["lead_form", "whatsapp", "landing_page"].includes(value)) return [];
      return value ? [[facet, value]] : [];
    })) as Partial<Record<OptionalFacet, string>>;
    const scope = Object.freeze({ market, serviceRef, campaignFamilyRef, ...optional }) as Scope;
    return [Object.freeze({ campaignRef: campaign.id, scope, requiresFrozenContext: true as const, budgetImpactReady: false as const })];
  }).sort((left, right) => left.campaignRef.localeCompare(right.campaignRef));
  return Object.freeze({ version: SLICE_SCOPE_CANDIDATES_VERSION, candidates: Object.freeze(candidates), authority: CLOSED });
}
