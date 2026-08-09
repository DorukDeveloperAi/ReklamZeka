import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  CategoryAuthoringAssignment,
  CategoryAuthoringCommand,
  CategoryAuthoringDimension,
  CategoryAuthoringRepository,
  CategoryAuthoringState,
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
} from "@/domain/categories/service";

type Database = NodePgDatabase<typeof schema>;
type DimensionRow = Readonly<{ id: string; key: string; name: string; description: string | null;
  cardinality: "single" | "multi"; allowed_entity_levels: unknown; version: unknown }>;
type DefinitionRow = Readonly<{ id: string; dimension_id: string; dimension_key: string; key: string;
  label: string; description: string | null; version: unknown }>;
type AssignmentRow = Readonly<{ id: string; dimension_id: string; definition_id: string; entity_level: string;
  entity_id: string; operation: string; manual_lock: unknown; confidence: unknown; version: unknown }>;
type InternalState = Readonly<{ state: CategoryAuthoringState; dimensions: readonly DimensionRow[];
  definitions: readonly DefinitionRow[]; assignments: readonly AssignmentRow[] }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
      assignment.operation::text, assignment.manual_lock, assignment.confidence, assignment.version
    from category_assignments assignment
    join category_dimensions dimension on dimension.workspace_id = assignment.workspace_id
      and dimension.id = assignment.dimension_id and dimension.archived_at is null
    join category_definitions definition on definition.workspace_id = assignment.workspace_id
      and definition.id = assignment.definition_id and definition.dimension_id = assignment.dimension_id
      and definition.archived_at is null
    where assignment.workspace_id = ${workspaceId}::uuid and assignment.archived_at is null
    order by assignment.dimension_id, assignment.definition_id, assignment.entity_level, entity_id, assignment.id
  `));
  if (dimensions.length > 100 || definitions.length > 10_000 || assignments.length > 20_000) {
    throw new CategoryAuthoringError("dependency_blocked");
  }
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
      || !["add", "override", "deny"].includes(assignment.operation) || typeof assignment.manual_lock !== "boolean") {
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
  return Object.freeze({ state: Object.freeze({ registryHash: digest(registryCore), ...registryCore }),
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
        } else {
          const current = findDefinition(before, command.definitionRef);
          await requireImpact(command.definitionRef, command.expectedImpactHash); dimensionId = uuid(current.dimension_id); resourceId = command.definitionRef;
          invalidationReason = "source_removed";
          await registry.archiveDefinition(input.workspaceId, uuid(current.id), command.expectedVersion);
        }

        let invalidationsAppended = 0;
        if (dimensionId && command.operation !== "create_dimension") {
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
            ? "category_dimension" : "category_definition",
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
