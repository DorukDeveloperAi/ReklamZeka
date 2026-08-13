import { inspectEffectiveCategory, type CategoryAssignment, type CategoryDefinition, type CategoryDimension, type CategoryEntityPath } from "@/domain/categories/registry";

export const CAMPAIGN_CLASSIFICATION_REVIEW_VERSION = "campaign-classification-review/1.0.0" as const;
export type ClassificationFacet = "market" | "service" | "family" | "geo" | "audience" | "platform";
export type ClassificationFacetState = "assigned" | "missing" | "conflict" | "not_configured";

export type CampaignClassificationReviewSource = Readonly<{
  campaigns: readonly Readonly<{ id: string; name: string; accountName: string; fetchedAt: string }>[],
  paths: readonly CategoryEntityPath[], dimensions: readonly CategoryDimension[], definitions: readonly CategoryDefinition[],
  assignments: readonly CategoryAssignment[],
}>;

const FACETS: Readonly<Record<ClassificationFacet, readonly string[]>> = Object.freeze({
  market: ["geo_market"], service: ["service_line"], family: ["campaign_family"],
  geo: ["geo_market"], audience: ["audience_strategy"], platform: ["platform"],
});
const AUTHORITY = Object.freeze({ canAssign: false as const, canPublish: false as const, canAuthorizeAction: false as const, canWriteMeta: false as const });

function facet(facet: ClassificationFacet, dimensions: readonly CategoryDimension[], definitions: readonly CategoryDefinition[], assignments: readonly CategoryAssignment[], paths: readonly CategoryEntityPath[]) {
  const dimensionsForFacet = dimensions.filter((dimension) => FACETS[facet].includes(dimension.key));
  if (dimensionsForFacet.length !== 1) return Object.freeze({ facet, state: "not_configured" as const, values: Object.freeze([]), evidenceCount: 0, reasonCodes: Object.freeze([dimensionsForFacet.length ? "ambiguous_dimension" : "dimension_not_configured"]) });
  const dimension = dimensionsForFacet[0]!;
  const outcomes = paths.map((path) => inspectEffectiveCategory({ dimension, definitions, assignments, path }));
  if (!outcomes.length) return Object.freeze({ facet, state: "missing" as const, values: Object.freeze([]), evidenceCount: 0, reasonCodes: Object.freeze(["campaign_path_not_observed"]) });
  const conflicts = outcomes.filter((outcome) => outcome.state === "parked_conflict");
  if (conflicts.length) return Object.freeze({ facet, state: "conflict" as const, values: Object.freeze([]), evidenceCount: 0, reasonCodes: Object.freeze([...new Set(conflicts.map((outcome) => outcome.reason))].sort()) });
  const resolved = outcomes.filter((outcome): outcome is Extract<typeof outcome, { state: "applied" | "unmatched" }> => outcome.state !== "parked_conflict");
  const values = [...new Set(resolved.flatMap((outcome) => outcome.resolution.values.map((value) => value.label)))].sort();
  const evidenceCount = resolved.reduce((count, outcome) => count + outcome.resolution.frozenContext.evaluatedAssignments.length, 0);
  if (!values.length) return Object.freeze({ facet, state: "missing" as const, values: Object.freeze([]), evidenceCount, reasonCodes: Object.freeze(["no_effective_definition"]) });
  const distinctPathValues = new Set(resolved.map((outcome) => outcome.resolution.values.map((value) => value.id).sort().join(",")));
  if (distinctPathValues.size > 1) return Object.freeze({ facet, state: "conflict" as const, values: Object.freeze(values), evidenceCount, reasonCodes: Object.freeze(["multiple_path_values"]) });
  return Object.freeze({ facet, state: "assigned" as const, values: Object.freeze(values), evidenceCount, reasonCodes: Object.freeze([]) });
}

/** Category registry evidence is inspected as-is. No name/content inference or assignment is performed here. */
export function buildCampaignClassificationReview(source: CampaignClassificationReviewSource) {
  const entries = source.campaigns.map((campaign) => {
    const paths = source.paths.filter((path) => path.nodes[0]?.level === "campaign" && path.nodes[0]?.id === campaign.id);
    const facets = (Object.keys(FACETS) as ClassificationFacet[]).map((name) => facet(name, source.dimensions, source.definitions, source.assignments, paths));
    const reasons = [...new Set(facets.flatMap((item) => item.reasonCodes))].sort();
    return Object.freeze({ campaignRef: campaign.id, name: campaign.name, accountName: campaign.accountName, fetchedAt: campaign.fetchedAt,
      facets: Object.freeze(facets), reviewRequired: facets.some((item) => item.state !== "assigned"), reasonCodes: Object.freeze(reasons) });
  }).sort((left, right) => Number(right.reviewRequired) - Number(left.reviewRequired) || left.name.localeCompare(right.name, "tr"));
  return Object.freeze({ version: CAMPAIGN_CLASSIFICATION_REVIEW_VERSION, entries: Object.freeze(entries),
    summary: Object.freeze({ campaigns: entries.length, reviewRequired: entries.filter((item) => item.reviewRequired).length }), authority: AUTHORITY });
}
