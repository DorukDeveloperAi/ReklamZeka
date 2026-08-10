import type { OptimizationEvent } from "@/analyses/schema";

export const META_OPTIMIZATION_MAPPING_VERSION = "meta-ad-set-optimization-mapping/1.0.0" as const;

export const META_OPTIMIZATION_MAPPING_REVIEW = Object.freeze({
  version: META_OPTIMIZATION_MAPPING_VERSION,
  source: "meta_ad_set_optimization_goal",
  reviewedAt: "2026-08-10T00:00:00.000Z",
  evidenceRef: "meta-ad-set-optimization-goal-review/2026-08-10",
} as const);

const REVIEWED_OPTIMIZATION_GOALS = Object.freeze({
  IMPRESSIONS: "impressions",
  REACH: "reach",
  LINK_CLICKS: "link_click",
  LANDING_PAGE_VIEWS: "landing_page_view",
  POST_ENGAGEMENT: "engagement",
  LEAD_GENERATION: "lead",
  QUALITY_LEAD: "qualified_lead",
  APP_INSTALLS: "app_install",
  VALUE: "conversion_value",
} as const satisfies Readonly<Record<string, OptimizationEvent>>);

export const META_OPTIMIZATION_MAPPING_CATALOG = Object.freeze({
  version: META_OPTIMIZATION_MAPPING_VERSION,
  reviewed: REVIEWED_OPTIMIZATION_GOALS,
});

export type MetaOptimizationMappingResult = Readonly<{
  version: typeof META_OPTIMIZATION_MAPPING_VERSION;
  status: "mapped" | "uncertain";
  sourceOptimizationGoal: string | null;
  canonicalOptimizationEvent: OptimizationEvent | null;
  reason: "reviewed" | "source_missing" | "source_unknown" | "source_invalid";
}>;

function uncertain(
  sourceOptimizationGoal: string | null,
  reason: "source_missing" | "source_unknown" | "source_invalid",
): MetaOptimizationMappingResult {
  return Object.freeze({
    version: META_OPTIMIZATION_MAPPING_VERSION,
    status: "uncertain",
    sourceOptimizationGoal,
    canonicalOptimizationEvent: null,
    reason,
  });
}

/** Reviewed, deterministic mapping only. Unlisted Meta goals never become a guessed analysis event. */
export function normalizeMetaAdSetOptimizationGoal(sourceOptimizationGoal: string | null): MetaOptimizationMappingResult {
  if (sourceOptimizationGoal === null) return uncertain(null, "source_missing");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(sourceOptimizationGoal)) return uncertain(null, "source_invalid");
  if (!Object.hasOwn(REVIEWED_OPTIMIZATION_GOALS, sourceOptimizationGoal)) {
    return uncertain(sourceOptimizationGoal, "source_unknown");
  }
  return Object.freeze({
    version: META_OPTIMIZATION_MAPPING_VERSION,
    status: "mapped",
    sourceOptimizationGoal,
    canonicalOptimizationEvent: REVIEWED_OPTIMIZATION_GOALS[sourceOptimizationGoal as keyof typeof REVIEWED_OPTIMIZATION_GOALS],
    reason: "reviewed",
  });
}
