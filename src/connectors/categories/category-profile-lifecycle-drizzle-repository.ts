import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CategoryProfileLifecycleError, type CategoryProfileLifecycleCommand,
  type CategoryProfileLifecycleRepository, type CategoryProfileLifecycleState } from
  "@/application/category-profile-lifecycle-service";
import { DrizzleCategoryProfileRepository, CategoryProfileRepositoryError } from
  "@/connectors/categories/category-profile-drizzle-repository";
import { assertValidCategoryProfile, createCategoryProfile, reviseCategoryProfile,
  type CategoryProfileRevision } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type DefinitionRow = Readonly<{ definition_id: unknown; dimension_id: unknown; dimension_key: unknown;
  definition_key: unknown; label: unknown; description: unknown }>;
type ProfileRow = Readonly<{ category_definition_id: unknown; profile_ref: unknown; profile_payload: unknown }>;
type InternalDefinition = Readonly<{ definitionId: string; dimensionId: string; dimensionRef: string;
  dimensionKey: string; definitionRef: string; label: string; description: string | null;
  currentProfile: CategoryProfileRevision | null }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new CategoryProfileLifecycleError("conflict");
  }
  return value.rows as readonly T[];
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new CategoryProfileLifecycleError("conflict");
  return value.toLowerCase();
}
function text(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new CategoryProfileLifecycleError("conflict");
  }
  return value;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function generatedProfileRef(workspaceId: string, definitionId: string): string {
  return `category_profile_${digest({ definitionId, workspaceId }).slice(0, 24)}`;
}

async function load(database: Executor, workspaceId: string): Promise<Readonly<{
  state: CategoryProfileLifecycleState; definitions: readonly InternalDefinition[] }>> {
  const definitions = rows<DefinitionRow>(await database.execute(sql`
    select definition.id::text as definition_id, definition.dimension_id::text as dimension_id,
      dimension.key as dimension_key, definition.key as definition_key, definition.label, definition.description
    from category_definitions definition
    join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
      and dimension.id = definition.dimension_id
    where definition.workspace_id = ${workspaceId}::uuid
      and definition.archived_at is null and dimension.archived_at is null
    order by dimension.key, definition.key
  `));
  if (definitions.length > 20_000) throw new CategoryProfileLifecycleError("conflict");
  const latestProfiles = rows<ProfileRow>(await database.execute(sql`
    with ranked as (
      select profile.category_definition_id, profile.profile_ref, profile.profile_payload,
        row_number() over (partition by profile.profile_ref order by profile.version desc) as position
      from category_profile_revisions profile
      join category_definitions definition on definition.workspace_id = profile.workspace_id
        and definition.id = profile.category_definition_id and definition.archived_at is null
      join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
        and dimension.id = definition.dimension_id and dimension.archived_at is null
      where profile.workspace_id = ${workspaceId}::uuid
    )
    select category_definition_id::text, profile_ref, profile_payload
    from ranked where position = 1 order by profile_ref
  `));
  const byDefinition = new Map<string, CategoryProfileRevision>();
  for (const row of latestProfiles) {
    const definitionId = uuid(row.category_definition_id);
    if (byDefinition.has(definitionId)) throw new CategoryProfileLifecycleError("conflict");
    let profile: CategoryProfileRevision;
    try { profile = assertValidCategoryProfile(row.profile_payload); }
    catch { throw new CategoryProfileLifecycleError("conflict"); }
    if (profile.profileRef !== text(row.profile_ref)) throw new CategoryProfileLifecycleError("conflict");
    byDefinition.set(definitionId, profile);
  }
  const internal = definitions.map((row) => {
    const definitionId = uuid(row.definition_id); const dimensionId = uuid(row.dimension_id);
    const dimensionKey = text(row.dimension_key)!; const definitionKey = text(row.definition_key)!;
    const definitionRef = categoryDefinitionPublicRef(dimensionKey, definitionKey);
    const currentProfile = byDefinition.get(definitionId) ?? null;
    if (currentProfile && currentProfile.categoryRef !== definitionRef) throw new CategoryProfileLifecycleError("conflict");
    return Object.freeze({ definitionId, dimensionId, dimensionRef: categoryDimensionPublicRef(dimensionKey),
      dimensionKey, definitionRef, label: text(row.label)!, description: text(row.description, true), currentProfile });
  });
  if ([...byDefinition.keys()].some((definitionId) => !internal.some((item) => item.definitionId === definitionId))) {
    throw new CategoryProfileLifecycleError("conflict");
  }
  const projected = Object.freeze(internal.map(({ definitionId: _definitionId, dimensionId: _dimensionId, ...item }) => item));
  const registryHash = digest(projected.map((item) => ({ definitionRef: item.definitionRef,
    dimensionRef: item.dimensionRef, profileRef: item.currentProfile?.profileRef ?? null,
    profileVersion: item.currentProfile?.version ?? null, profileHash: item.currentProfile?.profileHash ?? null,
    profileStatus: item.currentProfile?.status ?? null })));
  return Object.freeze({ definitions: Object.freeze(internal), state: Object.freeze({ registryHash,
    definitions: projected }) });
}

function currentByProfile(definitions: readonly InternalDefinition[], profileRef: string): InternalDefinition {
  const found = definitions.filter((entry) => entry.currentProfile?.profileRef === profileRef);
  if (found.length !== 1) throw new CategoryProfileLifecycleError("not_found");
  return found[0]!;
}
function definitionByRef(definitions: readonly InternalDefinition[], definitionRef: string): InternalDefinition {
  const found = definitions.filter((entry) => entry.definitionRef === definitionRef);
  if (found.length !== 1) throw new CategoryProfileLifecycleError("not_found");
  return found[0]!;
}
function assertOcc(entry: InternalDefinition, command: Readonly<{ expectedVersion: number; expectedProfileHash: string }>) {
  if (!entry.currentProfile || entry.currentProfile.version !== command.expectedVersion
    || entry.currentProfile.profileHash !== command.expectedProfileHash) throw new CategoryProfileLifecycleError("conflict");
}
function parent(definitions: readonly InternalDefinition[], child: InternalDefinition,
  parentDefinitionRef: string | null): InternalDefinition | null {
  if (parentDefinitionRef === null) return null;
  const found = definitionByRef(definitions, parentDefinitionRef);
  if (found.dimensionId !== child.dimensionId || found.definitionId === child.definitionId) {
    throw new CategoryProfileLifecycleError("invalid_input");
  }
  return found;
}
function translate(reason: unknown): never {
  if (reason instanceof CategoryProfileLifecycleError) throw reason;
  if (reason instanceof CategoryProfileRepositoryError) {
    if (reason.code === "category_scope_mismatch" || reason.code === "workspace_scope_mismatch"
      || reason.code === "inactive_workspace") throw new CategoryProfileLifecycleError("not_found");
    if (reason.code === "revision_conflict") throw new CategoryProfileLifecycleError("conflict");
    if (reason.code === "transition_conflict") throw new CategoryProfileLifecycleError("invalid_transition");
    throw new CategoryProfileLifecycleError("invalid_input");
  }
  throw reason;
}

export class DrizzleCategoryProfileLifecycleRepository implements CategoryProfileLifecycleRepository {
  constructor(private readonly database: Database) {}

  async inspect(workspaceId: string, workspaceRef: string) {
    if (!UUID.test(workspaceId) || !/^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(workspaceRef)) {
      throw new CategoryProfileLifecycleError("invalid_input");
    }
    const result = await load(this.database, workspaceId.toLowerCase());
    if (result.state.definitions.some((definition) => definition.currentProfile
      && definition.currentProfile.workspaceRef !== workspaceRef)) {
      throw new CategoryProfileLifecycleError("conflict");
    }
    return result.state;
  }

  async mutate(input: Parameters<CategoryProfileLifecycleRepository["mutate"]>[0]) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role)
      || !Number.isFinite(Date.parse(input.occurredAt))) throw new CategoryProfileLifecycleError("invalid_input");
    try {
      return await this.database.transaction(async (transaction) => {
        const tx = transaction as unknown as Database;
        const locked = rows(await tx.execute(sql`select id from workspaces
          where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`));
        if (locked.length !== 1) throw new CategoryProfileLifecycleError("not_found");
        const memberships = rows<{ role: string }>(await tx.execute(sql`select role::text from memberships
          where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
        if (memberships.length !== 1 || memberships[0]!.role !== input.role
          || !["owner", "admin"].includes(memberships[0]!.role)) {
          throw new CategoryProfileLifecycleError("forbidden");
        }
        const before = await load(tx, input.workspaceId);
        if (before.state.registryHash !== input.command.expectedRegistryHash) {
          throw new CategoryProfileLifecycleError("conflict");
        }
        const command: CategoryProfileLifecycleCommand = input.command;
        let definition: InternalDefinition;
        let profile: CategoryProfileRevision;
        if (command.operation === "create_draft") {
          definition = definitionByRef(before.definitions, command.definitionRef);
          if (definition.currentProfile) throw new CategoryProfileLifecycleError("conflict");
          const selectedParent = parent(before.definitions, definition, command.parentDefinitionRef);
          profile = createCategoryProfile({ workspaceRef: input.workspaceRef,
            profileRef: generatedProfileRef(input.workspaceId, definition.definitionId),
            categoryRef: definition.definitionRef, parentCategoryRef: selectedParent?.definitionRef ?? null,
            label: command.label, description: command.description, color: command.color,
            ownerRef: input.actorRef, status: "draft", bindings: command.bindings });
        } else {
          definition = currentByProfile(before.definitions, command.profileRef); assertOcc(definition, command);
          const current = definition.currentProfile!;
          if (command.operation === "revise_draft") {
            if (current.status !== "draft") throw new CategoryProfileLifecycleError("invalid_transition");
            const selectedParent = parent(before.definitions, definition, command.parentDefinitionRef);
            profile = reviseCategoryProfile({ current, changes: { parentCategoryRef: selectedParent?.definitionRef ?? null,
              label: command.label, description: command.description, color: command.color,
              bindings: command.bindings } });
          } else {
            const status = command.operation === "publish" ? "active" : command.operation === "pause" ? "paused" : "archived";
            const allowed = command.operation === "publish" ? current.status === "draft" || current.status === "paused"
              : command.operation === "pause" ? current.status === "active" : current.status !== "archived";
            if (!allowed) throw new CategoryProfileLifecycleError("invalid_transition");
            profile = reviseCategoryProfile({ current, changes: { status } });
          }
        }
        const selectedParent = profile.parentCategoryRef === null ? null
          : parent(before.definitions, definition, profile.parentCategoryRef);
        const appended = await new DrizzleCategoryProfileRepository(tx, input.workspaceId, input.workspaceRef)
          .append(profile, { categoryDefinitionId: definition.definitionId,
            parentCategoryDefinitionId: selectedParent?.definitionId ?? null, observedAt: input.occurredAt });
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
        const previousHash = String(rows<{ event_hash: string }>(await tx.execute(sql`select event_hash from audit_events
          where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`
        ))[0]?.event_hash ?? "GENESIS");
        const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
          action: `category_profile.${command.operation}`, resourceType: "category_profile",
          resourceId: profile.profileRef, occurredAt: new Date(input.occurredAt).toISOString(), previousHash,
          metadata: Object.freeze({ role: input.role, expectedRegistryHash: command.expectedRegistryHash,
            expectedVersion: "expectedVersion" in command ? command.expectedVersion : null,
            expectedProfileHash: "expectedProfileHash" in command ? command.expectedProfileHash : null,
            reasonCode: "reasonCode" in command ? command.reasonCode : null,
            profileVersion: profile.version, profileHash: profile.profileHash,
            invalidationsAppended: appended.invalidationsAppended }) });
        await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type,
          resource_id, metadata, previous_hash, event_hash, occurred_at) values (
          ${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action},
          ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
          ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
        return Object.freeze({ state: (await load(tx, input.workspaceId)).state, profile,
          auditAppended: true as const, invalidationsAppended: appended.invalidationsAppended });
      });
    } catch (reason) { return translate(reason); }
  }
}
