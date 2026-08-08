import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CategoryCoverageLevel, CategoryInventoryDefinition, CategoryInventoryDimension,
  CategoryInventoryRepository, CategoryInventorySnapshot } from "@/application/category-inventory-service";
import * as schema from "@/db/schema";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";

type Database = NodePgDatabase<typeof schema>;
type CategoryInventoryDatabase = Pick<Database, "execute">;
const LEVELS = new Set<CategoryCoverageLevel>(["campaign", "ad_set", "ad", "creative"]);

export class CategoryInventoryRepositoryError extends Error {
  constructor(readonly code: "workspace_scope_mismatch" | "corrupt_store") {
    super(`Category inventory rejected: ${code}`); this.name = "CategoryInventoryRepositoryError";
  }
}
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new CategoryInventoryRepositoryError("corrupt_store");
  }
  return result.rows as readonly T[];
}
function count(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new CategoryInventoryRepositoryError("corrupt_store");
  return parsed;
}
function text(value: unknown, maxLength = 6_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new CategoryInventoryRepositoryError("corrupt_store");
  }
  return value;
}

type DimensionRow = Readonly<{ id: string; key: string; name: string; description: string | null;
  cardinality: "single" | "multi"; allowed_entity_levels: unknown; version: number }>;
type DefinitionRow = Readonly<{ dimension_id: string; key: string; label: string; description: string | null; version: number }>;
type DefinitionStatsRow = Readonly<{ dimension_id: string; definition_id: string; total: unknown; manual_locked: unknown;
  manual: unknown; agent: unknown; deterministic: unknown; add_count: unknown; override_count: unknown; deny_count: unknown }>;
type CoverageRow = Readonly<{ dimension_id: string; entity_level: string; assigned: unknown; denied: unknown }>;
type HealthRow = Readonly<{ dimensions_without_definitions: unknown; definitions_without_assignments: unknown;
  stale_target_assignments: unknown; assignments_under_archived_registry: unknown }>;

/** Public-safe, read-only category catalog and direct-assignment coverage projection. */
export class DrizzleCategoryInventoryRepository implements CategoryInventoryRepository {
  constructor(private readonly database: CategoryInventoryDatabase) {}

  async list(workspaceId: string): Promise<CategoryInventorySnapshot> {
    const active = rows(await this.database.execute(sql`
      select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 2
    `));
    if (active.length !== 1) throw new CategoryInventoryRepositoryError("workspace_scope_mismatch");
    const dimensions = rows<DimensionRow>(await this.database.execute(sql`
      select id::text, key, name, description, cardinality,
        allowed_entity_levels::text[] as allowed_entity_levels, version
      from category_dimensions where workspace_id = ${workspaceId}::uuid and archived_at is null
      order by name, key
    `));
    const definitions = rows<DefinitionRow>(await this.database.execute(sql`
      select definition.dimension_id::text, definition.id::text as definition_id,
        definition.key, definition.label, definition.description, definition.version
      from category_definitions definition
      join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
        and dimension.id = definition.dimension_id and dimension.archived_at is null
      where definition.workspace_id = ${workspaceId}::uuid and definition.archived_at is null
      order by definition.label, definition.key
    `)) as readonly (DefinitionRow & Readonly<{ definition_id: string }>)[];
    const definitionStats = rows<DefinitionStatsRow>(await this.database.execute(sql`
      select assignment.dimension_id::text, assignment.definition_id::text,
        count(*)::int as total, count(*) filter (where assignment.manual_lock)::int as manual_locked,
        count(*) filter (where assignment.source = 'manual')::int as manual,
        count(*) filter (where assignment.source = 'agent')::int as agent,
        count(*) filter (where assignment.source = 'deterministic')::int as deterministic,
        count(*) filter (where assignment.operation = 'add')::int as add_count,
        count(*) filter (where assignment.operation = 'override')::int as override_count,
        count(*) filter (where assignment.operation = 'deny')::int as deny_count
      from category_assignments assignment
      join category_dimensions dimension on dimension.workspace_id = assignment.workspace_id
        and dimension.id = assignment.dimension_id and dimension.archived_at is null
      join category_definitions definition on definition.workspace_id = assignment.workspace_id
        and definition.id = assignment.definition_id and definition.dimension_id = assignment.dimension_id
        and definition.archived_at is null
      where assignment.workspace_id = ${workspaceId}::uuid and assignment.archived_at is null
      group by assignment.dimension_id, assignment.definition_id
    `));
    const coverage = rows<CoverageRow>(await this.database.execute(sql`
      select assignment.dimension_id::text, assignment.entity_level::text,
        count(distinct case
          when assignment.entity_level = 'campaign' and campaign.id is not null and campaign.disappeared_at is null then assignment.campaign_id
          when assignment.entity_level = 'ad_set' and ad_set.id is not null and ad_set.disappeared_at is null then assignment.ad_set_id
          when assignment.entity_level = 'ad' and ad.id is not null and ad.disappeared_at is null then assignment.ad_id
          when assignment.entity_level = 'creative' and creative.id is not null and creative.disappeared_at is null then assignment.creative_id end)::int as assigned,
        count(*) filter (where assignment.operation = 'deny' and case assignment.entity_level
          when 'campaign' then campaign.id is not null and campaign.disappeared_at is null
          when 'ad_set' then ad_set.id is not null and ad_set.disappeared_at is null
          when 'ad' then ad.id is not null and ad.disappeared_at is null
          when 'creative' then creative.id is not null and creative.disappeared_at is null else false end)::int as denied
      from category_assignments assignment
      join category_dimensions dimension on dimension.workspace_id = assignment.workspace_id
        and dimension.id = assignment.dimension_id and dimension.archived_at is null
      join category_definitions definition on definition.workspace_id = assignment.workspace_id
        and definition.id = assignment.definition_id and definition.dimension_id = assignment.dimension_id
        and definition.archived_at is null
      left join ad_campaigns campaign on assignment.entity_level = 'campaign'
        and campaign.workspace_id = assignment.workspace_id and campaign.id = assignment.campaign_id
      left join meta_ad_sets ad_set on assignment.entity_level = 'ad_set'
        and ad_set.workspace_id = assignment.workspace_id and ad_set.id = assignment.ad_set_id
      left join meta_ads ad on assignment.entity_level = 'ad'
        and ad.workspace_id = assignment.workspace_id and ad.id = assignment.ad_id
      left join meta_creatives creative on assignment.entity_level = 'creative'
        and creative.workspace_id = assignment.workspace_id and creative.id = assignment.creative_id
      where assignment.workspace_id = ${workspaceId}::uuid and assignment.archived_at is null
      group by assignment.dimension_id, assignment.entity_level
    `));
    const totals = new Map(rows<{ entity_level: string; total: unknown }>(await this.database.execute(sql`
      select 'campaign'::text as entity_level, count(*)::int as total from ad_campaigns
        where workspace_id = ${workspaceId}::uuid and disappeared_at is null
      union all select 'ad_set', count(*)::int from meta_ad_sets
        where workspace_id = ${workspaceId}::uuid and disappeared_at is null
      union all select 'ad', count(*)::int from meta_ads
        where workspace_id = ${workspaceId}::uuid and disappeared_at is null
      union all select 'creative', count(*)::int from meta_creatives
        where workspace_id = ${workspaceId}::uuid and disappeared_at is null
    `)).map((row) => [row.entity_level, count(row.total)] as const));
    const healthRows = rows<HealthRow>(await this.database.execute(sql`
      select
        (select count(*)::int from category_dimensions dimension
          where dimension.workspace_id = ${workspaceId}::uuid and dimension.archived_at is null
          and not exists (select 1 from category_definitions definition
            where definition.workspace_id = dimension.workspace_id and definition.dimension_id = dimension.id
              and definition.archived_at is null)) as dimensions_without_definitions,
        (select count(*)::int from category_definitions definition
          join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
            and dimension.id = definition.dimension_id and dimension.archived_at is null
          where definition.workspace_id = ${workspaceId}::uuid and definition.archived_at is null
          and not exists (select 1 from category_assignments assignment
            left join ad_campaigns campaign on assignment.entity_level = 'campaign'
              and campaign.workspace_id = assignment.workspace_id and campaign.id = assignment.campaign_id
            left join meta_ad_sets ad_set on assignment.entity_level = 'ad_set'
              and ad_set.workspace_id = assignment.workspace_id and ad_set.id = assignment.ad_set_id
            left join meta_ads ad on assignment.entity_level = 'ad'
              and ad.workspace_id = assignment.workspace_id and ad.id = assignment.ad_id
            left join meta_creatives creative on assignment.entity_level = 'creative'
              and creative.workspace_id = assignment.workspace_id and creative.id = assignment.creative_id
            where assignment.workspace_id = definition.workspace_id and assignment.definition_id = definition.id
              and assignment.archived_at is null and case assignment.entity_level
                when 'campaign' then campaign.id is not null and campaign.disappeared_at is null
                when 'ad_set' then ad_set.id is not null and ad_set.disappeared_at is null
                when 'ad' then ad.id is not null and ad.disappeared_at is null
                when 'creative' then creative.id is not null and creative.disappeared_at is null else false end
          )) as definitions_without_assignments,
        (select count(*)::int from category_assignments assignment
          left join ad_campaigns campaign on assignment.entity_level = 'campaign'
            and campaign.workspace_id = assignment.workspace_id and campaign.id = assignment.campaign_id
          left join meta_ad_sets ad_set on assignment.entity_level = 'ad_set'
            and ad_set.workspace_id = assignment.workspace_id and ad_set.id = assignment.ad_set_id
          left join meta_ads ad on assignment.entity_level = 'ad'
            and ad.workspace_id = assignment.workspace_id and ad.id = assignment.ad_id
          left join meta_creatives creative on assignment.entity_level = 'creative'
            and creative.workspace_id = assignment.workspace_id and creative.id = assignment.creative_id
          where assignment.workspace_id = ${workspaceId}::uuid and assignment.archived_at is null and case assignment.entity_level
            when 'campaign' then campaign.id is null or campaign.disappeared_at is not null
            when 'ad_set' then ad_set.id is null or ad_set.disappeared_at is not null
            when 'ad' then ad.id is null or ad.disappeared_at is not null
            when 'creative' then creative.id is null or creative.disappeared_at is not null else true end
        ) as stale_target_assignments,
        (select count(*)::int from category_assignments assignment
          join category_dimensions dimension on dimension.workspace_id = assignment.workspace_id
            and dimension.id = assignment.dimension_id
          join category_definitions definition on definition.workspace_id = assignment.workspace_id
            and definition.id = assignment.definition_id
          where assignment.workspace_id = ${workspaceId}::uuid and assignment.archived_at is null
            and (dimension.archived_at is not null or definition.archived_at is not null)
        ) as assignments_under_archived_registry
    `));
    if (healthRows.length !== 1) throw new CategoryInventoryRepositoryError("corrupt_store");
    const statsByDefinition = new Map(definitionStats.map((row) => [row.definition_id, row] as const));
    const coverageByDimension = new Map<string, Map<string, CoverageRow>>();
    for (const row of coverage) coverageByDimension.set(row.dimension_id,
      new Map([...(coverageByDimension.get(row.dimension_id) ?? new Map()).entries(), [row.entity_level, row]]));

    const projectedDimensions = Object.freeze(dimensions.map((dimension) => {
      const key = text(dimension.key, 128); const levels = dimension.allowed_entity_levels;
      if (!Array.isArray(levels) || levels.length < 1 || new Set(levels).size !== levels.length
        || levels.some((level) => typeof level !== "string" || !LEVELS.has(level as CategoryCoverageLevel))
        || !Number.isSafeInteger(dimension.version) || dimension.version < 1
        || !["single", "multi"].includes(dimension.cardinality)) throw new CategoryInventoryRepositoryError("corrupt_store");
      const projectedDefinitions: CategoryInventoryDefinition[] = definitions
        .filter((definition) => definition.dimension_id === dimension.id).map((definition) => {
          const stats = statsByDefinition.get(definition.definition_id);
          if (!Number.isSafeInteger(definition.version) || definition.version < 1) throw new CategoryInventoryRepositoryError("corrupt_store");
          return Object.freeze({ ref: categoryDefinitionPublicRef(key, text(definition.key, 128)), key: text(definition.key, 128),
            label: text(definition.label), description: definition.description === null ? null : text(definition.description),
            version: definition.version, assignments: Object.freeze({ total: count(stats?.total ?? 0),
              manualLocked: count(stats?.manual_locked ?? 0), manual: count(stats?.manual ?? 0),
              agent: count(stats?.agent ?? 0), deterministic: count(stats?.deterministic ?? 0),
              add: count(stats?.add_count ?? 0), override: count(stats?.override_count ?? 0),
              deny: count(stats?.deny_count ?? 0) }) });
        });
      return Object.freeze({ ref: categoryDimensionPublicRef(key), key, name: text(dimension.name),
        description: dimension.description === null ? null : text(dimension.description),
        cardinality: dimension.cardinality, allowedEntityLevels: Object.freeze(levels as CategoryCoverageLevel[]),
        version: dimension.version, definitions: Object.freeze(projectedDefinitions),
        coverage: Object.freeze((levels as CategoryCoverageLevel[]).map((level) => {
          const total = totals.get(level) ?? 0; const row = coverageByDimension.get(dimension.id)?.get(level);
          const assigned = count(row?.assigned ?? 0); if (assigned > total) throw new CategoryInventoryRepositoryError("corrupt_store");
          return Object.freeze({ level, totalEntities: total, directlyAssignedEntities: assigned,
            unmatchedEntities: total - assigned, coverageBasisPoints: total === 0 ? null : Math.round(assigned * 10_000 / total),
            deniedAssignments: count(row?.denied ?? 0) });
        })) });
    }));
    const health = healthRows[0]!;
    return Object.freeze({ dimensions: projectedDimensions, health: Object.freeze({
      dimensionsWithoutDefinitions: count(health.dimensions_without_definitions),
      definitionsWithoutDirectAssignments: count(health.definitions_without_assignments),
      staleTargetAssignments: count(health.stale_target_assignments),
      assignmentsUnderArchivedRegistry: count(health.assignments_under_archived_registry),
    }) });
  }
}
