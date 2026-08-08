import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS,
  EffectiveCategoryHealthScanError } from "@/application/category-effective-health-scanner";
import type { CategoryEffectiveHealthRepository } from "@/application/category-effective-health-service";
import type { CategoryAssignment, CategoryDefinition, CategoryDimension,
  CategoryEntityLevel, CategoryEntityPath } from "@/domain/categories/registry";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type EffectiveHealthDatabase = Pick<Database, "execute">;
const LEVELS = new Set<CategoryEntityLevel>(["campaign", "ad_set", "ad", "creative"]);
const OPERATIONS = new Set<CategoryAssignment["operation"]>(["add", "override", "deny"]);
const SOURCES = new Set<CategoryAssignment["source"]>(["manual", "agent", "deterministic"]);

export class CategoryEffectiveHealthRepositoryError extends Error {
  constructor(readonly code: "workspace_scope_mismatch" | "corrupt_store") {
    super(`Category effective health rejected: ${code}`); this.name = "CategoryEffectiveHealthRepositoryError";
  }
}
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
  }
  return result.rows as readonly T[];
}
function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 6_000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
  }
  return value;
}
function version(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
  return parsed;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
}
function evidence(value: unknown): CategoryAssignment["evidence"] {
  if (!Array.isArray(value)) throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
    const record = item as Record<string, unknown>;
    const observedAt = record.observedAt === undefined ? undefined : requiredText(record.observedAt);
    return Object.freeze({ kind: requiredText(record.kind), ref: requiredText(record.ref), ...(observedAt ? { observedAt } : {}) });
  });
}

type DimensionRow = Readonly<{ id: unknown; key: unknown; version: unknown; cardinality: unknown;
  allowed_entity_levels: unknown; archived_at: unknown }>;
type DefinitionRow = Readonly<{ id: unknown; dimension_id: unknown; key: unknown; label: unknown;
  version: unknown; archived_at: unknown }>;
type AssignmentRow = Readonly<{ id: unknown; dimension_id: unknown; definition_id: unknown; entity_level: unknown;
  entity_id: unknown; operation: unknown; source: unknown; manual_lock: unknown; evidence: unknown;
  confidence: unknown; version: unknown; archived_at: unknown }>;
type PathRow = Readonly<{ campaign_id: unknown; ad_set_id: unknown; ad_id: unknown; creative_id: unknown }>;

/** Loads private canonical material for an in-process scan; callers receive only scanner aggregates. */
export class DrizzleCategoryEffectiveHealthRepository implements CategoryEffectiveHealthRepository {
  constructor(private readonly database: EffectiveHealthDatabase) {}

  async load(workspaceId: string) {
    const active = rows(await this.database.execute(sql`
      select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 2
    `));
    if (active.length !== 1) throw new CategoryEffectiveHealthRepositoryError("workspace_scope_mismatch");
    const dimensions = rows<DimensionRow>(await this.database.execute(sql`
      select id::text, key, version, cardinality, allowed_entity_levels::text[] as allowed_entity_levels, archived_at
      from category_dimensions where workspace_id = ${workspaceId}::uuid and archived_at is null
      order by key limit ${EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS.maxDimensions + 1}
    `));
    if (dimensions.length > EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS.maxDimensions) {
      throw new EffectiveCategoryHealthScanError("capacity_exceeded", "dimensions");
    }
    const definitions = rows<DefinitionRow>(await this.database.execute(sql`
      select definition.id::text, definition.dimension_id::text, definition.key, definition.label,
        definition.version, definition.archived_at
      from category_definitions definition
      join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
        and dimension.id = definition.dimension_id and dimension.archived_at is null
      where definition.workspace_id = ${workspaceId}::uuid and definition.archived_at is null
      order by definition.dimension_id, definition.key
    `));
    const assignments = rows<AssignmentRow>(await this.database.execute(sql`
      select assignment.id::text, assignment.dimension_id::text, assignment.definition_id::text,
        assignment.entity_level::text,
        case assignment.entity_level when 'campaign' then assignment.campaign_id::text
          when 'ad_set' then assignment.ad_set_id::text when 'ad' then assignment.ad_id::text
          when 'creative' then assignment.creative_id::text end as entity_id,
        assignment.operation::text, assignment.source::text, assignment.manual_lock, assignment.evidence,
        assignment.confidence, assignment.version, assignment.archived_at
      from category_assignments assignment
      join category_dimensions dimension on dimension.workspace_id = assignment.workspace_id
        and dimension.id = assignment.dimension_id and dimension.archived_at is null
      join category_definitions definition on definition.workspace_id = assignment.workspace_id
        and definition.id = assignment.definition_id and definition.dimension_id = assignment.dimension_id
        and definition.archived_at is null
      where assignment.workspace_id = ${workspaceId}::uuid and assignment.archived_at is null
      order by assignment.dimension_id, assignment.entity_level, entity_id, assignment.id
    `));
    const paths = rows<PathRow>(await this.database.execute(sql`
      with live_paths as (
        select campaign.id::text as campaign_id, ad_set.id::text as ad_set_id,
          ad.id::text as ad_id, creative.id::text as creative_id
        from ad_campaigns campaign
        left join meta_ad_sets ad_set on ad_set.workspace_id = campaign.workspace_id
          and ad_set.campaign_id = campaign.id and ad_set.disappeared_at is null
        left join meta_ads ad on ad.workspace_id = campaign.workspace_id
          and ad.campaign_id = campaign.id and ad.ad_set_id = ad_set.id and ad.disappeared_at is null
        left join meta_creatives creative on creative.workspace_id = campaign.workspace_id
          and creative.id = ad.creative_id and creative.disappeared_at is null
        where campaign.workspace_id = ${workspaceId}::uuid and campaign.disappeared_at is null
          and (ad.id is not null or ad_set.id is null or not exists (
            select 1 from meta_ads child where child.workspace_id = ad_set.workspace_id
              and child.ad_set_id = ad_set.id and child.disappeared_at is null))
      ) select campaign_id, ad_set_id, ad_id, creative_id from live_paths
        order by campaign_id, ad_set_id nulls first, ad_id nulls first, creative_id nulls first
        limit ${EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS.maxHierarchyPaths + 1}
    `));
    if (paths.length > EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS.maxHierarchyPaths) {
      throw new EffectiveCategoryHealthScanError("capacity_exceeded", "hierarchy_paths");
    }

    const projectedDimensions: CategoryDimension[] = dimensions.map((row) => {
      const levels = row.allowed_entity_levels;
      if (!Array.isArray(levels) || levels.length < 1 || levels.some((level) => typeof level !== "string" || !LEVELS.has(level as CategoryEntityLevel))) {
        throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
      }
      const cardinality = requiredText(row.cardinality);
      if (cardinality !== "single" && cardinality !== "multi") throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
      return Object.freeze({ id: requiredText(row.id), workspaceId, key: requiredText(row.key), version: version(row.version),
        cardinality, allowedEntityLevels: Object.freeze(levels as CategoryEntityLevel[]), archivedAt: date(row.archived_at) });
    });
    const projectedDefinitions: CategoryDefinition[] = definitions.map((row) => Object.freeze({ id: requiredText(row.id),
      workspaceId, dimensionId: requiredText(row.dimension_id), key: requiredText(row.key), label: requiredText(row.label),
      version: version(row.version), archivedAt: date(row.archived_at) }));
    const projectedAssignments: CategoryAssignment[] = assignments.map((row) => {
      const level = requiredText(row.entity_level); const operation = requiredText(row.operation); const source = requiredText(row.source);
      const confidence = Number(row.confidence);
      if (!LEVELS.has(level as CategoryEntityLevel) || !OPERATIONS.has(operation as CategoryAssignment["operation"])
        || !SOURCES.has(source as CategoryAssignment["source"]) || typeof row.manual_lock !== "boolean"
        || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new CategoryEffectiveHealthRepositoryError("corrupt_store");
      return Object.freeze({ id: requiredText(row.id), workspaceId, dimensionId: requiredText(row.dimension_id),
        definitionId: requiredText(row.definition_id), entity: Object.freeze({ level: level as CategoryEntityLevel,
          id: requiredText(row.entity_id) }), operation: operation as CategoryAssignment["operation"],
        source: source as CategoryAssignment["source"], manualLock: row.manual_lock, evidence: Object.freeze(evidence(row.evidence)),
        confidence, version: version(row.version), archivedAt: date(row.archived_at) });
    });
    const hierarchyPaths: CategoryEntityPath[] = paths.map((row) => {
      const nodes: Array<{ level: CategoryEntityLevel; id: string }> = [{ level: "campaign", id: requiredText(row.campaign_id) }];
      if (row.ad_set_id !== null) nodes.push({ level: "ad_set", id: requiredText(row.ad_set_id) });
      if (row.ad_id !== null) nodes.push({ level: "ad", id: requiredText(row.ad_id) });
      if (row.creative_id !== null) nodes.push({ level: "creative", id: requiredText(row.creative_id) });
      return Object.freeze({ workspaceId, nodes: Object.freeze(nodes.map((node) => Object.freeze(node))) });
    });
    return Object.freeze({ dimensions: Object.freeze(projectedDimensions), definitions: Object.freeze(projectedDefinitions),
      assignments: Object.freeze(projectedAssignments), hierarchyPaths: Object.freeze(hierarchyPaths) });
  }
}
