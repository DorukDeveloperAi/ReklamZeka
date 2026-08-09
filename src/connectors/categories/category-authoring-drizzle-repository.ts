import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  CategoryAuthoringAssignment,
  CategoryAuthoringCommand,
  CategoryAuthoringDimension,
  CategoryAuthoringRepository,
  CategoryAuthoringState,
  CategoryAuthoringTarget,
} from "@/application/category-authoring-service";
import { CategoryAuthoringError } from "@/application/category-authoring-service";
import { DrizzleCategoryArchiveImpactRepository } from "@/connectors/categories/category-archive-impact-drizzle-repository";
import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";
import * as schema from "@/db/schema";
import {
  categoryAssignmentPublicRef,
  categoryDefinitionPublicRef,
  categoryDimensionPublicRef,
  categoryEntityPublicRef,
} from "@/domain/categories/public-reference";
import {
  CategoryRegistryPersistenceError,
  CategoryRegistryService,
  type CategoryHierarchyTarget,
} from "@/domain/categories/service";

type Database = NodePgDatabase<typeof schema>;
type DimensionRow = Readonly<{ id: string; key: string; name: string; description: string | null;
  cardinality: "single" | "multi"; allowed_entity_levels: unknown; version: unknown }>;
type DefinitionRow = Readonly<{ id: string; dimension_id: string; dimension_key: string; key: string;
  label: string; description: string | null; version: unknown }>;
type AssignmentRow = Readonly<{ id: string; dimension_id: string; definition_id: string; entity_level: string;
  entity_id: string; operation: string; source: string; manual_lock: unknown; confidence: unknown; version: unknown }>;
type TargetRow = Readonly<{ entity_level: string; id: string; label: string; via_ad_id: string | null }>;
type InternalState = Readonly<{ state: CategoryAuthoringState; dimensions: readonly DimensionRow[];
  definitions: readonly DefinitionRow[]; assignments: readonly AssignmentRow[] }>;
type ResolvedTarget = Readonly<{ target: CategoryHierarchyTarget; externalRef: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMBEDDED_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMBEDDED_META_ID = /\b\d{8,}\b/g;
const HASH = /^[a-f0-9]{64}$/;
const LEVELS = new Set(["campaign", "ad_set", "ad", "creative"]);

function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new CategoryAuthoringError("conflict");
  }
  return value.rows as readonly T[];
}

function text(value: unknown, maximum = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new CategoryAuthoringError("conflict");
  return value;
}

function publicLabel(value: unknown, fallback: string): string {
  const clean = text(value, 320).replace(EMBEDDED_UUID, "kimlik gizlendi")
    .replace(EMBEDDED_META_ID, "kimlik gizlendi").replace(/\s+/g, " ").trim();
  return clean || fallback;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new CategoryAuthoringError("conflict");
  return value.toLowerCase();
}

function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new CategoryAuthoringError("conflict");
  return parsed;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, "en")).map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function levels(value: unknown): readonly ("campaign" | "ad_set" | "ad" | "creative")[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4
    || value.some((item) => typeof item !== "string" || !LEVELS.has(item)) || new Set(value).size !== value.length) {
    throw new CategoryAuthoringError("conflict");
  }
  return Object.freeze([...(value as ("campaign" | "ad_set" | "ad" | "creative")[])].sort());
}

function confidenceBasisPoints(value: unknown): number {
  const parsed = Number(value);
  const basisPoints = Math.round(parsed * 10_000);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1 || basisPoints < 0 || basisPoints > 10_000) {
    throw new CategoryAuthoringError("conflict");
  }
  return basisPoints;
}

async function loadState(database: Pick<Database, "execute">, workspaceId: string): Promise<InternalState> {
  const active = rows(await database.execute(sql`
    select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 2
  `));
  if (active.length !== 1) throw new CategoryAuthoringError("not_found");
  const dimensions = rows<DimensionRow>(await database.execute(sql`
    select id::text, key, name, description, cardinality, allowed_entity_levels::text[] as allowed_entity_levels, version
    from category_dimensions where workspace_id = ${workspaceId}::uuid and archived_at is null order by key, version
  `));
  const definitions = rows<DefinitionRow>(await database.execute(sql`
    select definition.id::text, definition.dimension_id::text, dimension.key as dimension_key,
      definition.key, definition.label, definition.description, definition.version
    from category_definitions definition
    join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
      and dimension.id = definition.dimension_id and dimension.archived_at is null
    where definition.workspace_id = ${workspaceId}::uuid and definition.archived_at is null
    order by dimension.key, definition.key, definition.version
  `));
  const assignments = rows<AssignmentRow>(await database.execute(sql`
    select assignment.id::text, assignment.dimension_id::text, assignment.definition_id::text,
      assignment.entity_level::text,
      case assignment.entity_level when 'campaign' then assignment.campaign_id::text
        when 'ad_set' then assignment.ad_set_id::text when 'ad' then assignment.ad_id::text
        when 'creative' then assignment.creative_id::text end as entity_id,
      assignment.operation::text, assignment.source::text, assignment.manual_lock, assignment.confidence, assignment.version
    from category_assignments assignment
    join category_dimensions dimension on dimension.workspace_id = assignment.workspace_id
      and dimension.id = assignment.dimension_id and dimension.archived_at is null
    join category_definitions definition on definition.workspace_id = assignment.workspace_id
      and definition.id = assignment.definition_id and definition.dimension_id = assignment.dimension_id
      and definition.archived_at is null
    where assignment.workspace_id = ${workspaceId}::uuid and assignment.archived_at is null
    order by assignment.dimension_id, assignment.definition_id, assignment.entity_level, entity_id, assignment.id
  `));
  const targetRows = rows<TargetRow>(await database.execute(sql`
    with campaign_targets as (
      select 'campaign'::text as entity_level, campaign.id::text, campaign.name as label, null::text as via_ad_id
      from ad_campaigns campaign
      where campaign.workspace_id = ${workspaceId}::uuid and campaign.disappeared_at is null
        and lower(coalesce(campaign.effective_status, campaign.configured_status, '')) = 'active'
      order by campaign.name, campaign.id limit 20001
    ), ad_set_targets as (
      select 'ad_set'::text as entity_level, ad_set.id::text, ad_set.name as label, null::text as via_ad_id
      from meta_ad_sets ad_set
      where ad_set.workspace_id = ${workspaceId}::uuid and ad_set.disappeared_at is null
        and lower(coalesce(ad_set.effective_status, ad_set.configured_status, '')) = 'active'
      order by ad_set.name, ad_set.id limit 20001
    ), ad_targets as (
      select 'ad'::text as entity_level, ad.id::text, ad.name as label, null::text as via_ad_id
      from meta_ads ad
      where ad.workspace_id = ${workspaceId}::uuid and ad.disappeared_at is null
        and lower(coalesce(ad.effective_status, ad.configured_status, '')) = 'active'
      order by ad.name, ad.id limit 20001
    ), creative_targets as (
      select 'creative'::text as entity_level, creative.id::text,
        coalesce(nullif(btrim(creative.name), ''), nullif(btrim(creative.headline), ''), 'Adsız kreatif')
          || ' · ' || ad.name || ' üzerinden' as label,
        ad.id::text as via_ad_id
      from meta_creatives creative
      join meta_ads ad on ad.workspace_id = creative.workspace_id and ad.creative_id = creative.id
        and ad.disappeared_at is null
        and lower(coalesce(ad.effective_status, ad.configured_status, '')) = 'active'
      where creative.workspace_id = ${workspaceId}::uuid and creative.disappeared_at is null
        and lower(coalesce(creative.effective_status, creative.configured_status, '')) = 'active'
      order by label, creative.id, ad.id limit 20001
    )
    select entity_level, id, label, via_ad_id from campaign_targets
    union all select entity_level, id, label, via_ad_id from ad_set_targets
    union all select entity_level, id, label, via_ad_id from ad_targets
    union all select entity_level, id, label, via_ad_id from creative_targets
    order by entity_level, label, id, via_ad_id
  `));
  if (dimensions.length > 100 || definitions.length > 10_000 || assignments.length > 20_000) {
    throw new CategoryAuthoringError("dependency_blocked");
  }
  const targetCounts = new Map<string, number>();
  for (const target of targetRows) targetCounts.set(target.entity_level, (targetCounts.get(target.entity_level) ?? 0) + 1);
  if ([...targetCounts.values()].some((count) => count > 20_000)) throw new CategoryAuthoringError("dependency_blocked");
  const definitionMap = new Map(definitions.map((definition) => [uuid(definition.id), definition] as const));
  const publicDimensions: CategoryAuthoringDimension[] = dimensions.map((dimension) => {
    const dimensionId = uuid(dimension.id); const dimensionKey = text(dimension.key, 128);
    return Object.freeze({ ref: categoryDimensionPublicRef(dimensionKey), key: dimensionKey,
      name: text(dimension.name, 160), description: dimension.description === null ? null : text(dimension.description),
      cardinality: dimension.cardinality, allowedEntityLevels: levels(dimension.allowed_entity_levels),
      version: integer(dimension.version), definitions: Object.freeze(definitions.filter((item) => uuid(item.dimension_id) === dimensionId)
        .map((definition) => Object.freeze({ ref: categoryDefinitionPublicRef(dimensionKey, text(definition.key, 128)),
          key: text(definition.key, 128), label: text(definition.label, 160),
          description: definition.description === null ? null : text(definition.description), version: integer(definition.version) }))) });
  });
  const publicAssignments: CategoryAuthoringAssignment[] = assignments.map((assignment) => {
    const definition = definitionMap.get(uuid(assignment.definition_id));
    if (!definition || uuid(definition.dimension_id) !== uuid(assignment.dimension_id) || !LEVELS.has(assignment.entity_level)
      || !["add", "override", "deny"].includes(assignment.operation)
      || !["manual", "agent", "deterministic"].includes(assignment.source)
      || typeof assignment.manual_lock !== "boolean") {
      throw new CategoryAuthoringError("conflict");
    }
    const dimension = dimensions.find((item) => uuid(item.id) === uuid(assignment.dimension_id));
    if (!dimension) throw new CategoryAuthoringError("conflict");
    const level = assignment.entity_level as "campaign" | "ad_set" | "ad" | "creative";
    return Object.freeze({ ref: categoryAssignmentPublicRef(workspaceId, uuid(assignment.id)),
      dimensionRef: categoryDimensionPublicRef(text(dimension.key, 128)),
      definitionRef: categoryDefinitionPublicRef(text(definition.dimension_key, 128), text(definition.key, 128)),
      entity: Object.freeze({ level, ref: categoryEntityPublicRef(workspaceId, level, uuid(assignment.entity_id)) }),
      operation: assignment.operation as "add" | "override" | "deny", manualLock: assignment.manual_lock,
      confidenceBasisPoints: confidenceBasisPoints(assignment.confidence), version: integer(assignment.version) });
  });
  const registryCore = Object.freeze({ dimensions: publicDimensions, assignments: publicAssignments });
  const registryHash = digest({ dimensions: publicDimensions, assignments: publicAssignments.map((assignment, index) =>
    Object.freeze({ ...assignment, source: assignments[index]!.source })) });
  const targets: CategoryAuthoringTarget[] = targetRows.map((target) => {
    if (!LEVELS.has(target.entity_level)) throw new CategoryAuthoringError("conflict");
    const level = target.entity_level as "campaign" | "ad_set" | "ad" | "creative";
    const id = uuid(target.id);
    const viaAdRef = target.via_ad_id === null ? null : categoryEntityPublicRef(workspaceId, "ad", uuid(target.via_ad_id));
    if (level === "creative" ? viaAdRef === null : viaAdRef !== null) throw new CategoryAuthoringError("conflict");
    return Object.freeze({ ref: categoryEntityPublicRef(workspaceId, level, id), level,
      label: publicLabel(target.label, level === "campaign" ? "Adsız kampanya" : level === "ad_set"
        ? "Adsız reklam seti" : level === "ad" ? "Adsız reklam" : "Adsız kreatif"), viaAdRef });
  });
  return Object.freeze({ state: Object.freeze({ registryHash, ...registryCore, targets: Object.freeze(targets) }),
    dimensions, definitions, assignments });
}

function findDimension(state: InternalState, workspaceId: string, targetRef: string): DimensionRow {
  const result = state.dimensions.filter((item) => categoryDimensionPublicRef(text(item.key, 128)) === targetRef);
  if (result.length !== 1) throw new CategoryAuthoringError("not_found");
  uuid(workspaceId); return result[0]!;
}

function findDefinition(state: InternalState, targetRef: string): DefinitionRow {
  const result = state.definitions.filter((item) => categoryDefinitionPublicRef(
    text(item.dimension_key, 128), text(item.key, 128)) === targetRef);
  if (result.length !== 1) throw new CategoryAuthoringError("not_found");
  return result[0]!;
}

function findAssignment(state: InternalState, workspaceId: string, targetRef: string): AssignmentRow {
  const result = state.assignments.filter((item) => categoryAssignmentPublicRef(workspaceId, uuid(item.id)) === targetRef);
  if (result.length !== 1) throw new CategoryAuthoringError("not_found");
  return result[0]!;
}

function assignmentTarget(assignment: AssignmentRow, viaAdId?: string): CategoryHierarchyTarget {
  const id = uuid(assignment.entity_id);
  if (assignment.entity_level === "campaign" || assignment.entity_level === "ad_set" || assignment.entity_level === "ad") {
    return Object.freeze({ level: assignment.entity_level, id });
  }
  if (assignment.entity_level === "creative" && viaAdId) {
    return Object.freeze({ level: "creative", id, viaAdId: uuid(viaAdId) });
  }
  throw new CategoryAuthoringError("conflict");
}

async function entityCandidates(database: Pick<Database, "execute">, workspaceId: string,
  level: "campaign" | "ad_set" | "ad" | "creative") {
  const result = level === "campaign" ? await database.execute(sql`
      select id::text, external_campaign_id as external_ref from ad_campaigns
      where workspace_id = ${workspaceId}::uuid and disappeared_at is null
        and lower(coalesce(effective_status, configured_status, '')) = 'active' order by id limit 20001
    `) : level === "ad_set" ? await database.execute(sql`
      select id::text, external_ad_set_id as external_ref from meta_ad_sets
      where workspace_id = ${workspaceId}::uuid and disappeared_at is null
        and lower(coalesce(effective_status, configured_status, '')) = 'active' order by id limit 20001
    `) : level === "ad" ? await database.execute(sql`
      select id::text, external_ad_id as external_ref from meta_ads
      where workspace_id = ${workspaceId}::uuid and disappeared_at is null
        and lower(coalesce(effective_status, configured_status, '')) = 'active' order by id limit 20001
    `) : await database.execute(sql`
      select id::text, external_creative_id as external_ref from meta_creatives
      where workspace_id = ${workspaceId}::uuid and disappeared_at is null
        and lower(coalesce(effective_status, configured_status, '')) = 'active' order by id limit 20001
    `);
  const candidates = rows<{ id: string; external_ref: string }>(result);
  if (candidates.length > 20_000) throw new CategoryAuthoringError("dependency_blocked");
  return candidates.map((candidate) => Object.freeze({ id: uuid(candidate.id), externalRef: text(candidate.external_ref, 512) }));
}

async function resolvePublicEntity(database: Pick<Database, "execute">, workspaceId: string,
  level: "campaign" | "ad_set" | "ad" | "creative", targetRef: string) {
  const matches = (await entityCandidates(database, workspaceId, level))
    .filter((candidate) => categoryEntityPublicRef(workspaceId, level, candidate.id) === targetRef);
  if (matches.length !== 1) throw new CategoryAuthoringError("not_found");
  return matches[0]!;
}

async function resolveCreateTarget(database: Pick<Database, "execute">, workspaceId: string,
  command: Extract<CategoryAuthoringCommand, { operation: "create_assignment" }>): Promise<ResolvedTarget> {
  const entity = await resolvePublicEntity(database, workspaceId, command.entityLevel, command.entityRef);
  if (command.entityLevel !== "creative") {
    return Object.freeze({ target: Object.freeze({ level: command.entityLevel, id: entity.id }) as CategoryHierarchyTarget,
      externalRef: entity.externalRef });
  }
  if (!command.viaAdRef) throw new CategoryAuthoringError("invalid_input");
  const ad = await resolvePublicEntity(database, workspaceId, "ad", command.viaAdRef);
  const links = rows(await database.execute(sql`
    select id from meta_ads where workspace_id = ${workspaceId}::uuid and id = ${ad.id}::uuid
      and creative_id = ${entity.id}::uuid and disappeared_at is null
      and lower(coalesce(effective_status, configured_status, '')) = 'active' limit 2
  `));
  if (links.length !== 1) throw new CategoryAuthoringError("not_found");
  return Object.freeze({ target: Object.freeze({ level: "creative", id: entity.id, viaAdId: ad.id }),
    externalRef: entity.externalRef });
}

async function resolveStoredTarget(database: Pick<Database, "execute">, workspaceId: string,
  assignment: AssignmentRow): Promise<ResolvedTarget> {
  const level = assignment.entity_level;
  if (!LEVELS.has(level)) throw new CategoryAuthoringError("conflict");
  const entityLevel = level as "campaign" | "ad_set" | "ad" | "creative";
  const entity = (await entityCandidates(database, workspaceId, entityLevel))
    .filter((candidate) => candidate.id === uuid(assignment.entity_id));
  if (entity.length !== 1) throw new CategoryAuthoringError("not_found");
  if (entityLevel !== "creative") return Object.freeze({ target: assignmentTarget(assignment),
    externalRef: entity[0]!.externalRef });
  const viaAds = rows<{ id: string }>(await database.execute(sql`
    select id::text from meta_ads where workspace_id = ${workspaceId}::uuid
      and creative_id = ${entity[0]!.id}::uuid and disappeared_at is null order by id limit 2
  `));
  if (viaAds.length !== 1) throw new CategoryAuthoringError("dependency_blocked");
  return Object.freeze({ target: assignmentTarget(assignment, viaAds[0]!.id), externalRef: entity[0]!.externalRef });
}

function translate(error: unknown): never {
  if (error instanceof CategoryAuthoringError) throw error;
  if (error instanceof CategoryRegistryPersistenceError) {
    if (error.code === "not_found" || error.code === "scope_violation" || error.code === "invalid_hierarchy") {
      throw new CategoryAuthoringError("not_found");
    }
    if (error.code === "manual_lock") throw new CategoryAuthoringError("manual_lock");
    if (error.code === "conflict") throw new CategoryAuthoringError("conflict");
    throw new CategoryAuthoringError("invalid_input");
  }
  throw error;
}

function auditAction(operation: CategoryAuthoringCommand["operation"]): string {
  return `category.${operation}`;
}

export async function appendAssignmentInvalidations(input: Readonly<{
  database: Pick<Database, "execute">;
  workspaceId: string;
  dimensionId: string;
  target: ResolvedTarget;
  reasonCode: "source_changed" | "source_removed";
  occurredAt: string;
}>): Promise<number> {
  const level = input.target.target.level;
  const affected = rows<{ component_ref: string; component_version: string; entity_type: string; entity_ref: string }>(
    await input.database.execute(sql`
      select distinct component.component_ref, component.component_version, context.entity_type, context.entity_ref
      from effective_campaign_context_components component
      join effective_campaign_contexts context on context.workspace_id = component.workspace_id
        and context.id = component.context_id
      where component.workspace_id = ${input.workspaceId}::uuid
        and component.component_type = 'category_resolution'
        and component.component_ref = ${input.dimensionId}
        and (
          (context.entity_type = ${level} and context.entity_ref = ${input.target.externalRef})
          or (${level} = 'campaign' and context.campaign_ref = ${input.target.externalRef})
          or coalesce(context.context_payload #> '{identity,hierarchyRefs}', '[]'::jsonb)
            @> ${JSON.stringify([input.target.externalRef])}::jsonb
        )
      order by component.component_ref, component.component_version, context.entity_type, context.entity_ref
    `),
  );
  let appended = 0;
  for (const component of affected) {
    if (!LEVELS.has(component.entity_type)) throw new CategoryAuthoringError("conflict");
    const invalidation = Object.freeze({ workspaceId: input.workspaceId, componentType: "category_resolution",
      componentRef: text(component.component_ref), componentVersion: text(component.component_version),
      scopeKind: "exact_entity_component", entityType: component.entity_type, entityRef: text(component.entity_ref, 512),
      reasonCode: input.reasonCode, observedAt: new Date(input.occurredAt).toISOString() });
    const inserted = rows(await input.database.execute(sql`
      insert into effective_campaign_context_invalidations (
        workspace_id, event_hash, component_type, component_ref, component_version,
        scope_kind, entity_type, entity_ref, reason_code, observed_at
      ) values (${input.workspaceId}::uuid, ${digest(invalidation)}, 'category_resolution',
        ${invalidation.componentRef}, ${invalidation.componentVersion}, 'exact_entity_component',
        ${invalidation.entityType}, ${invalidation.entityRef}, ${invalidation.reasonCode},
        ${invalidation.observedAt}::timestamptz)
      on conflict (workspace_id, event_hash) do nothing returning id
    `));
    appended += inserted.length;
  }
  return appended;
}

export class DrizzleCategoryAuthoringRepository implements CategoryAuthoringRepository {
  constructor(private readonly database: Database) {}

  async inspect(workspaceId: string): Promise<CategoryAuthoringState> {
    if (!UUID.test(workspaceId)) throw new CategoryAuthoringError("invalid_input");
    return (await loadState(this.database, workspaceId)).state;
  }

  async mutate(input: Parameters<CategoryAuthoringRepository["mutate"]>[0]) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role)
      || !Number.isFinite(Date.parse(input.occurredAt))) throw new CategoryAuthoringError("invalid_input");
    try {
      return await this.database.transaction(async (transaction) => {
        const tx = transaction as unknown as Database;
        const locked = rows(await tx.execute(sql`
          select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update
        `));
        if (locked.length !== 1) throw new CategoryAuthoringError("not_found");
        const before = await loadState(tx, input.workspaceId);
        if (before.state.registryHash !== input.command.expectedRegistryHash) throw new CategoryAuthoringError("conflict");
        const registry = new CategoryRegistryService(new DrizzleCategoryRegistryRepository(tx));
        const command = input.command;
        let dimensionId: string | null = null;
        let resourceId = "";
        let invalidationReason: "source_changed" | "source_removed" = "source_changed";
        let assignmentInvalidationTarget: ResolvedTarget | null = null;

        const requireImpact = async (targetRef: string, expectedImpactHash: string) => {
          const impact = await new DrizzleCategoryArchiveImpactRepository(tx).preview(input.workspaceId, targetRef);
          if (!impact) throw new CategoryAuthoringError("not_found");
          if (!("impactHash" in impact) || typeof impact.impactHash !== "string" || !HASH.test(impact.impactHash)
            || impact.impactHash !== expectedImpactHash) throw new CategoryAuthoringError("conflict");
          if (!impact.coverage.complete || impact.disposition !== "review_required") {
            throw new CategoryAuthoringError("dependency_blocked");
          }
        };

        if (command.operation === "create_dimension") {
          const id = randomUUID();
          const created = await registry.createDimension({ id, workspaceId: input.workspaceId, key: command.key,
            name: command.name, description: command.description ?? undefined, cardinality: command.cardinality,
            allowedEntityLevels: command.allowedEntityLevels });
          dimensionId = created.id; resourceId = categoryDimensionPublicRef(command.key);
        } else if (command.operation === "revise_dimension") {
          const current = findDimension(before, input.workspaceId, command.dimensionRef);
          await requireImpact(command.dimensionRef, command.expectedImpactHash); dimensionId = uuid(current.id); resourceId = command.dimensionRef;
          await registry.reviseDimension({ workspaceId: input.workspaceId, dimensionId, expectedVersion: command.expectedVersion,
            nextId: randomUUID(), name: command.name, description: command.description ?? undefined,
            cardinality: command.cardinality, allowedEntityLevels: command.allowedEntityLevels });
        } else if (command.operation === "archive_dimension") {
          const current = findDimension(before, input.workspaceId, command.dimensionRef);
          await requireImpact(command.dimensionRef, command.expectedImpactHash); dimensionId = uuid(current.id); resourceId = command.dimensionRef;
          invalidationReason = "source_removed";
          await registry.archiveDimension(input.workspaceId, dimensionId, command.expectedVersion);
        } else if (command.operation === "create_definition") {
          const dimension = findDimension(before, input.workspaceId, command.dimensionRef); dimensionId = uuid(dimension.id);
          const created = await registry.createDefinition({ id: randomUUID(), workspaceId: input.workspaceId,
            dimensionId, key: command.key, label: command.label, description: command.description ?? undefined });
          resourceId = categoryDefinitionPublicRef(text(dimension.key, 128), created.key);
        } else if (command.operation === "revise_definition") {
          const current = findDefinition(before, command.definitionRef);
          await requireImpact(command.definitionRef, command.expectedImpactHash); dimensionId = uuid(current.dimension_id); resourceId = command.definitionRef;
          await registry.reviseDefinition({ workspaceId: input.workspaceId, definitionId: uuid(current.id),
            expectedVersion: command.expectedVersion, nextId: randomUUID(), label: command.label,
            description: command.description ?? undefined });
        } else if (command.operation === "archive_definition") {
          const current = findDefinition(before, command.definitionRef);
          await requireImpact(command.definitionRef, command.expectedImpactHash); dimensionId = uuid(current.dimension_id); resourceId = command.definitionRef;
          invalidationReason = "source_removed";
          await registry.archiveDefinition(input.workspaceId, uuid(current.id), command.expectedVersion);
        } else if (command.operation === "create_assignment") {
          const dimension = findDimension(before, input.workspaceId, command.dimensionRef);
          const definition = findDefinition(before, command.definitionRef);
          dimensionId = uuid(dimension.id);
          if (uuid(definition.dimension_id) !== dimensionId) throw new CategoryAuthoringError("not_found");
          assignmentInvalidationTarget = await resolveCreateTarget(tx, input.workspaceId, command);
          const created = await registry.createAssignment({ id: randomUUID(), workspaceId: input.workspaceId,
            dimensionId, definitionId: uuid(definition.id), target: assignmentInvalidationTarget.target,
            operation: command.assignmentOperation, source: "manual", manualLock: command.manualLock,
            evidence: Object.freeze([{ kind: "manual_authoring", ref: text(input.actorRef, 128),
              observedAt: new Date(input.occurredAt).toISOString() }]), confidence: command.confidenceBasisPoints / 10_000 });
          resourceId = categoryAssignmentPublicRef(input.workspaceId, created.id);
        } else if (command.operation === "revise_assignment") {
          const current = findAssignment(before, input.workspaceId, command.assignmentRef);
          if (current.source !== "manual" || current.manual_lock !== false) throw new CategoryAuthoringError("manual_lock");
          dimensionId = uuid(current.dimension_id); resourceId = command.assignmentRef;
          assignmentInvalidationTarget = await resolveStoredTarget(tx, input.workspaceId, current);
          await registry.reviseAssignment({ workspaceId: input.workspaceId, assignmentId: uuid(current.id),
            expectedVersion: command.expectedVersion, nextId: randomUUID(), target: assignmentInvalidationTarget.target,
            operation: command.assignmentOperation, source: "manual", manualLock: command.manualLock,
            evidence: Object.freeze([{ kind: "manual_authoring", ref: text(input.actorRef, 128),
              observedAt: new Date(input.occurredAt).toISOString() }]), confidence: command.confidenceBasisPoints / 10_000 });
        } else if (command.operation === "unlock_assignment") {
          const current = findAssignment(before, input.workspaceId, command.assignmentRef);
          if (current.source !== "manual" || current.manual_lock !== true) throw new CategoryAuthoringError("manual_lock");
          dimensionId = uuid(current.dimension_id); resourceId = command.assignmentRef;
          assignmentInvalidationTarget = await resolveStoredTarget(tx, input.workspaceId, current);
          await registry.unlockAssignment({ workspaceId: input.workspaceId, assignmentId: uuid(current.id),
            expectedVersion: command.expectedVersion, nextId: randomUUID(),
            evidence: Object.freeze([{ kind: "manual_unlock", ref: text(input.actorRef, 128),
              observedAt: new Date(input.occurredAt).toISOString() }]) });
        } else {
          const current = findAssignment(before, input.workspaceId, command.assignmentRef);
          if (current.source !== "manual" || current.manual_lock !== false) throw new CategoryAuthoringError("manual_lock");
          dimensionId = uuid(current.dimension_id); resourceId = command.assignmentRef;
          invalidationReason = "source_removed";
          assignmentInvalidationTarget = await resolveStoredTarget(tx, input.workspaceId, current);
          await registry.archiveAssignment({ workspaceId: input.workspaceId, assignmentId: uuid(current.id),
            expectedVersion: command.expectedVersion });
        }

        let invalidationsAppended = 0;
        if (dimensionId && assignmentInvalidationTarget) {
          invalidationsAppended = await appendAssignmentInvalidations({ database: tx, workspaceId: input.workspaceId,
            dimensionId, target: assignmentInvalidationTarget, reasonCode: invalidationReason,
            occurredAt: input.occurredAt });
        } else if (dimensionId && command.operation !== "create_dimension") {
          const components = rows<{ component_ref: string; component_version: string }>(await tx.execute(sql`
            select distinct component_ref, component_version from effective_campaign_context_components
            where workspace_id = ${input.workspaceId}::uuid and component_type = 'category_resolution'
              and component_ref = ${dimensionId}
            order by component_ref, component_version
          `));
          for (const component of components) {
            const invalidation = Object.freeze({ workspaceId: input.workspaceId, componentType: "category_resolution",
              componentRef: text(component.component_ref), componentVersion: text(component.component_version),
              scopeKind: "workspace_component", entityType: null, entityRef: null,
              reasonCode: invalidationReason, observedAt: new Date(input.occurredAt).toISOString() });
            const inserted = rows(await tx.execute(sql`
              insert into effective_campaign_context_invalidations (
                workspace_id, event_hash, component_type, component_ref, component_version,
                scope_kind, entity_type, entity_ref, reason_code, observed_at
              ) values (${input.workspaceId}::uuid, ${digest(invalidation)}, 'category_resolution',
                ${invalidation.componentRef}, ${invalidation.componentVersion}, 'workspace_component', null, null,
                ${invalidation.reasonCode}, ${invalidation.observedAt}::timestamptz)
              on conflict (workspace_id, event_hash) do nothing returning id
            `));
            invalidationsAppended += inserted.length;
          }
        }

        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
        const previousHash = String(rows<{ event_hash: string }>(await tx.execute(sql`
          select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid
          order by occurred_at desc, created_at desc, id desc limit 1
        `))[0]?.event_hash ?? "GENESIS");
        const event = Object.freeze({ workspaceId: input.workspaceId, actorId: input.actorId,
          action: auditAction(command.operation), resourceType: command.operation.includes("dimension")
            ? "category_dimension" : command.operation.includes("assignment") ? "category_assignment" : "category_definition",
          resourceId, occurredAt: new Date(input.occurredAt).toISOString(), metadata: Object.freeze({
            role: input.role, expectedRegistryHash: command.expectedRegistryHash, invalidationsAppended,
            guardedImpact: "expectedImpactHash" in command,
          }), id: randomUUID(), previousHash });
        await tx.execute(sql`
          insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
            metadata, previous_hash, event_hash, occurred_at)
          values (${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action},
            ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
            ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)
        `);
        const after = await loadState(tx, input.workspaceId);
        return Object.freeze({ state: after.state, auditAppended: true as const, invalidationsAppended });
      });
    } catch (error) { translate(error); }
  }
}
