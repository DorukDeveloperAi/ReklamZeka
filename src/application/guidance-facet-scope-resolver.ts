import type { GuidanceEntityType } from "@/domain/guidance/registry";

export const GUIDANCE_FACET_SCOPE_CATALOG_VERSION = "guidance-facet-scope-catalog/1.0.0" as const;

export type GuidanceFacetName =
  | "global"
  | "account_group"
  | "account"
  | "objective"
  | "funnel"
  | "optimization"
  | "internal_category"
  | "lifecycle"
  | "entity"
  | "promotion_template"
  | "topic";

export type GuidanceFacetCatalogOption = Readonly<{
  ref: string;
  label: string;
  accountRefs: readonly string[];
  entityType: GuidanceEntityType | null;
}>;

export type GuidanceFacetCatalogEntry = Readonly<{
  facet: GuidanceFacetName;
  status: "available" | "partial" | "unavailable";
  reasonCode: "authoritative_catalog" | "account_group_catalog_unavailable";
  options: readonly GuidanceFacetCatalogOption[];
}>;

export type GuidanceFacetCatalog = Readonly<{
  version: typeof GUIDANCE_FACET_SCOPE_CATALOG_VERSION;
  capturedAt: string;
  catalogHash: string;
  evidence: Readonly<{ objectiveMappingVersion: "meta-objective-mapping/1.0.0" }>;
  facets: readonly GuidanceFacetCatalogEntry[];
}>;

export type GuidanceFacetScopeSelection = Readonly<{
  expectedCatalogHash: string;
  accountRef: string;
  accountGroupRefs: readonly string[];
  objective: string | null;
  funnel: string | null;
  optimization: string | null;
  internalCategoryRefs: readonly string[];
  lifecycle: string | null;
  entity: Readonly<{ type: GuidanceEntityType; ref: string }> | null;
  promotionTemplateRefs: readonly string[];
  topics: readonly string[];
  requiredTopics: readonly string[];
}>;

export type ResolvedGuidanceFacetScope = Readonly<{
  accountRef: string;
  accountGroupRefs: readonly string[];
  objective: string | null;
  funnel: string | null;
  optimization: string | null;
  internalCategoryRefs: readonly string[];
  lifecycle: string | null;
  entity: Readonly<{ type: GuidanceEntityType; ref: string }> | null;
  promotionTemplateRefs: readonly string[];
  topics: readonly string[];
  requiredTopics: readonly string[];
  capture: Readonly<{
    version: typeof GUIDANCE_FACET_SCOPE_CATALOG_VERSION;
    capturedAt: string;
    catalogHash: string;
  }>;
}>;

export type GuidanceFacetScopeResolver = Readonly<{
  listCatalog(workspaceId: string): Promise<GuidanceFacetCatalog>;
  resolve(workspaceId: string, selection: GuidanceFacetScopeSelection): Promise<ResolvedGuidanceFacetScope>;
}>;

export class GuidanceFacetScopeError extends Error {
  constructor(readonly code: "invalid_input" | "unknown_scope_ref" | "ambiguous_scope_ref"
    | "catalog_unavailable" | "catalog_overflow" | "stale_catalog" | "unsafe_source") {
    super(`Guidance facet scope rejected: ${code}`);
    this.name = "GuidanceFacetScopeError";
  }
}
