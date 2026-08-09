import type { CampaignObjective } from "@/analyses/schema";

export const META_OBJECTIVE_MAPPING_VERSION = "meta-objective-mapping/1.0.0" as const;

export const META_OBJECTIVE_MAPPING_REVIEW = Object.freeze({
  version: META_OBJECTIVE_MAPPING_VERSION,
  source: "meta_campaign_objective",
  reviewedAt: "2026-08-09T00:00:00.000Z",
  evidenceRef: "meta-objective-current-legacy-review/2026-08-09",
} as const);

export type CanonicalMetaObjective = CampaignObjective;
export type MetaObjectiveSourceKind = "current" | "legacy" | null;

export type MetaObjectiveMappingResult = Readonly<{
  version: typeof META_OBJECTIVE_MAPPING_VERSION;
  status: "mapped" | "uncertain";
  sourceObjective: string | null;
  sourceKind: MetaObjectiveSourceKind;
  canonicalObjective: CanonicalMetaObjective | null;
  reason: "reviewed_current" | "reviewed_legacy" | "source_missing" | "source_unknown" | "source_invalid";
}>;

const CURRENT_OBJECTIVES = Object.freeze({
  OUTCOME_AWARENESS: "awareness",
  OUTCOME_TRAFFIC: "traffic",
  OUTCOME_ENGAGEMENT: "engagement",
  OUTCOME_LEADS: "lead_generation",
  OUTCOME_APP_PROMOTION: "app_growth",
  OUTCOME_SALES: "sales",
} as const satisfies Readonly<Record<string, CanonicalMetaObjective>>);

const LEGACY_OBJECTIVES = Object.freeze({
  BRAND_AWARENESS: "awareness",
  REACH: "awareness",
  LOCAL_AWARENESS: "awareness",
  LINK_CLICKS: "traffic",
  POST_ENGAGEMENT: "engagement",
  PAGE_LIKES: "engagement",
  EVENT_RESPONSES: "engagement",
  VIDEO_VIEWS: "engagement",
  MESSAGES: "engagement",
  OFFER_CLAIMS: "engagement",
  LEAD_GENERATION: "lead_generation",
  APP_INSTALLS: "app_growth",
  CONVERSIONS: "sales",
  PRODUCT_CATALOG_SALES: "sales",
  STORE_VISITS: "sales",
} as const satisfies Readonly<Record<string, CanonicalMetaObjective>>);

export const META_OBJECTIVE_MAPPING_CATALOG = Object.freeze({
  version: META_OBJECTIVE_MAPPING_VERSION,
  current: CURRENT_OBJECTIVES,
  legacy: LEGACY_OBJECTIVES,
});

function uncertain(
  sourceObjective: string | null,
  reason: "source_missing" | "source_unknown" | "source_invalid",
): MetaObjectiveMappingResult {
  return Object.freeze({
    version: META_OBJECTIVE_MAPPING_VERSION,
    status: "uncertain",
    sourceObjective,
    sourceKind: null,
    canonicalObjective: null,
    reason,
  });
}

/** Reviewed, deterministic mapping only. It never guesses an unlisted Meta objective. */
export function normalizeMetaCampaignObjective(sourceObjective: string | null): MetaObjectiveMappingResult {
  if (sourceObjective === null) return uncertain(null, "source_missing");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(sourceObjective)) return uncertain(null, "source_invalid");

  if (Object.hasOwn(CURRENT_OBJECTIVES, sourceObjective)) {
    return Object.freeze({
      version: META_OBJECTIVE_MAPPING_VERSION,
      status: "mapped",
      sourceObjective,
      sourceKind: "current",
      canonicalObjective: CURRENT_OBJECTIVES[sourceObjective as keyof typeof CURRENT_OBJECTIVES],
      reason: "reviewed_current",
    });
  }
  if (Object.hasOwn(LEGACY_OBJECTIVES, sourceObjective)) {
    return Object.freeze({
      version: META_OBJECTIVE_MAPPING_VERSION,
      status: "mapped",
      sourceObjective,
      sourceKind: "legacy",
      canonicalObjective: LEGACY_OBJECTIVES[sourceObjective as keyof typeof LEGACY_OBJECTIVES],
      reason: "reviewed_legacy",
    });
  }
  return uncertain(sourceObjective, "source_unknown");
}
