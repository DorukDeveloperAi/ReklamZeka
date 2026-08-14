import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  assertValidCategoryProfile,
  type CategoryProfileRevision,
  type CategoryProfileStatus,
} from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type ProfileDatabase = Pick<Database, "execute" | "transaction">;

export class CategoryProfileRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "inactive_workspace" |
    "category_scope_mismatch" | "revision_conflict" | "transition_conflict" | "corrupt_store") {
    super(`Kategori profili kalıcı depoda reddedildi: ${code}`);
    this.name = "CategoryProfileRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_REF = /^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const PROFILE_REF = /^category_profile_[a-z0-9][a-z0-9_.:-]{0,126}$/;
type StoredRow = Readonly<{
  category_definition_id: string;
  workspace_ref: string;
  profile_ref: string;
  category_ref: string;
  version: number;
  previous_profile_hash: string | null;
  status: CategoryProfileStatus;
  profile_hash: string;
  profile_payload: unknown;
}>;
type CategoryRow = Readonly<{ id: string; dimension_id: string; dimension_key: string; definition_key: string }>;

function fail(code: CategoryProfileRepositoryError["code"]): never { throw new CategoryProfileRepositoryError(code); }
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function iso(value: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  return new Date(value).toISOString();
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function restore(row: StoredRow): CategoryProfileRevision {
  let profile: CategoryProfileRevision;
  try { profile = assertValidCategoryProfile(row.profile_payload); }
  catch { return fail("corrupt_store"); }
  if (profile.workspaceRef !== row.workspace_ref || profile.profileRef !== row.profile_ref
    || profile.categoryRef !== row.category_ref || profile.version !== row.version
    || profile.previousProfileHash !== row.previous_profile_hash || profile.status !== row.status
    || profile.profileHash !== row.profile_hash) fail("corrupt_store");
  return profile;
}
function transitionAllowed(previous: CategoryProfileStatus, next: CategoryProfileStatus): boolean {
  if (previous === "draft") return ["draft", "active", "archived"].includes(next);
  if (previous === "active") return ["active", "paused", "archived"].includes(next);
  if (previous === "paused") return ["paused", "active", "archived"].includes(next);
  return false;
}

/** Private append-only CategoryProfile store. It has no category mutation, action, approval, schedule, or Meta method. */
export class DrizzleCategoryProfileRepository {
  private readonly workspaceId: string;
  private readonly workspaceRef: string;

  constructor(private readonly database: ProfileDatabase, workspaceId: string, workspaceRef: string) {
    if (!UUID.test(workspaceId) || !WORKSPACE_REF.test(workspaceRef)) fail("invalid_input");
    this.workspaceId = workspaceId.toLowerCase();
    this.workspaceRef = workspaceRef;
  }

  async append(unsafeProfile: unknown, binding: Readonly<{
    categoryDefinitionId: string;
    parentCategoryDefinitionId: string | null;
    observedAt: string;
  }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    profileHash: string;
    invalidationsAppended: number;
  }>> {
    let profile: CategoryProfileRevision;
    try { profile = assertValidCategoryProfile(unsafeProfile); }
    catch { return fail("invalid_input"); }
    if (profile.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch");
    if (!binding || !UUID.test(binding.categoryDefinitionId)
      || binding.parentCategoryDefinitionId !== null && !UUID.test(binding.parentCategoryDefinitionId)) fail("invalid_input");
    const observedAt = iso(binding.observedAt);
    return this.database.transaction(async (transaction) => {
      const workspace = rows<{ id: string; lifecycle_state: string }>(await transaction.execute(sql`
        select id, lifecycle_state from workspaces where id = ${this.workspaceId}::uuid limit 1 for update
      `));
      if (workspace.length !== 1) fail("workspace_scope_mismatch");
      if (workspace[0]!.lifecycle_state !== "active") fail("inactive_workspace");

      const definitions = rows<CategoryRow>(await transaction.execute(sql`
        select definition.id::text, definition.dimension_id::text, dimension.key as dimension_key,
          definition.key as definition_key
        from category_definitions definition
        join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
          and dimension.id = definition.dimension_id and dimension.archived_at is null
        where definition.workspace_id = ${this.workspaceId}::uuid
          and definition.id = ${binding.categoryDefinitionId}::uuid and definition.archived_at is null
        limit 2
      `));
      if (definitions.length !== 1) fail("category_scope_mismatch");
      const definition = definitions[0]!;
      if (profile.categoryRef !== categoryDefinitionPublicRef(definition.dimension_key, definition.definition_key)) {
        fail("category_scope_mismatch");
      }
      if ((profile.parentCategoryRef === null) !== (binding.parentCategoryDefinitionId === null)) {
        fail("category_scope_mismatch");
      }
      if (binding.parentCategoryDefinitionId !== null) {
        const parents = rows<CategoryRow>(await transaction.execute(sql`
          select definition.id::text, definition.dimension_id::text, dimension.key as dimension_key,
            definition.key as definition_key
          from category_definitions definition
          join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
            and dimension.id = definition.dimension_id and dimension.archived_at is null
          where definition.workspace_id = ${this.workspaceId}::uuid
            and definition.id = ${binding.parentCategoryDefinitionId}::uuid and definition.archived_at is null
          limit 2
        `));
        if (parents.length !== 1 || parents[0]!.dimension_id !== definition.dimension_id
          || profile.parentCategoryRef !== categoryDefinitionPublicRef(parents[0]!.dimension_key, parents[0]!.definition_key)
          || parents[0]!.id === definition.id) fail("category_scope_mismatch");
        const cycle = rows<{ id: string }>(await transaction.execute(sql`
          with recursive latest_profile as (
            select distinct on (category_definition_id)
              category_definition_id, parent_category_definition_id
            from category_profile_revisions
            where workspace_id = ${this.workspaceId}::uuid
            order by category_definition_id, version desc
          ), ancestor(id) as (
            values (${binding.parentCategoryDefinitionId}::uuid)
            union
            select profile.parent_category_definition_id
            from latest_profile profile join ancestor on profile.category_definition_id = ancestor.id
            where profile.parent_category_definition_id is not null
          )
          select id::text from ancestor where id = ${binding.categoryDefinitionId}::uuid limit 1
        `));
        if (cycle.length > 0) fail("category_scope_mismatch");
      }

      const exact = rows<StoredRow>(await transaction.execute(sql`
        select category_definition_id::text, workspace_ref, profile_ref, category_ref, version, previous_profile_hash, status,
          profile_hash, profile_payload
        from category_profile_revisions
        where workspace_id = ${this.workspaceId}::uuid and profile_ref = ${profile.profileRef}
          and version = ${profile.version}
        limit 2
      `));
      if (exact[0]) {
        const stored = restore(exact[0]);
        if (stored.profileHash !== profile.profileHash) fail("revision_conflict");
        return Object.freeze({ outcome: "unchanged" as const, profileHash: stored.profileHash,
          invalidationsAppended: 0 });
      }
      const latest = rows<StoredRow>(await transaction.execute(sql`
        select category_definition_id::text, workspace_ref, profile_ref, category_ref, version, previous_profile_hash, status,
          profile_hash, profile_payload
        from category_profile_revisions
        where workspace_id = ${this.workspaceId}::uuid
          and (profile_ref = ${profile.profileRef} or category_definition_id = ${binding.categoryDefinitionId}::uuid)
        order by version desc limit 1
      `));
      const previous = latest[0] ? restore(latest[0]) : null;
      if (latest[0] && latest[0].profile_ref !== profile.profileRef) fail("revision_conflict");
      if (!previous && (profile.version !== 1 || profile.previousProfileHash !== null)
        || previous && (profile.version !== previous.version + 1
          || profile.previousProfileHash !== previous.profileHash
          || profile.categoryRef !== previous.categoryRef)) fail("revision_conflict");
      if (previous && !transitionAllowed(previous.status, profile.status)) fail("transition_conflict");

      const inserted = rows<{ profile_hash: string }>(await transaction.execute(sql`
        insert into category_profile_revisions (
          workspace_id, category_definition_id, parent_category_definition_id, workspace_ref,
          profile_ref, category_ref, parent_category_ref, schema_version, version, previous_profile_hash,
          label, description, color, owner_ref, status, profile_hash, profile_payload
        ) values (
          ${this.workspaceId}::uuid, ${binding.categoryDefinitionId}::uuid,
          ${binding.parentCategoryDefinitionId}::uuid, ${profile.workspaceRef}, ${profile.profileRef},
          ${profile.categoryRef}, ${profile.parentCategoryRef}, ${profile.schemaVersion}, ${profile.version},
          ${profile.previousProfileHash}, ${profile.label}, ${profile.description}, ${profile.color},
          ${profile.ownerRef}, ${profile.status}, ${profile.profileHash}, ${JSON.stringify(profile)}::jsonb
        ) returning profile_hash
      `));
      if (inserted.length !== 1 || inserted[0]!.profile_hash !== profile.profileHash) fail("corrupt_store");

      let invalidationsAppended = 0;
      if (previous) {
        const event = Object.freeze({ workspaceId: this.workspaceId, componentType: "category_profile",
          componentRef: previous.profileRef, componentVersion: previous.profileHash,
          scopeKind: "workspace_component", reasonCode: "source_changed", observedAt });
        const invalidation = rows<{ id: string }>(await transaction.execute(sql`
          insert into effective_campaign_context_invalidations (
            workspace_id, event_hash, component_type, component_ref, component_version,
            scope_kind, entity_type, entity_ref, reason_code, observed_at
          ) values (${this.workspaceId}::uuid, ${digest(event)}, 'category_profile', ${previous.profileRef},
            ${previous.profileHash}, 'workspace_component', null, null, 'source_changed', ${observedAt}::timestamptz)
          on conflict (workspace_id, event_hash) do nothing returning id::text
        `));
        invalidationsAppended = invalidation.length;
      }
      return Object.freeze({ outcome: "inserted" as const, profileHash: profile.profileHash,
        invalidationsAppended });
    });
  }

  async latestArtifact(profileRef: string): Promise<CategoryProfileRevision | null> {
    if (!PROFILE_REF.test(profileRef)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const workspace = rows<{ id: string; lifecycle_state: string }>(await transaction.execute(sql`
        select id, lifecycle_state from workspaces where id = ${this.workspaceId}::uuid limit 1 for share
      `));
      if (workspace.length !== 1) fail("workspace_scope_mismatch");
      if (workspace[0]!.lifecycle_state !== "active") fail("inactive_workspace");
      const found = rows<StoredRow>(await transaction.execute(sql`
        select category_definition_id::text, workspace_ref, profile_ref, category_ref, version, previous_profile_hash, status,
          profile_hash, profile_payload
        from category_profile_revisions
        where workspace_id = ${this.workspaceId}::uuid and profile_ref = ${profileRef}
        order by version desc limit 1
      `));
      if (!found[0]) return null;
      const profile = restore(found[0]);
      if (profile.workspaceRef !== this.workspaceRef || profile.profileRef !== profileRef) fail("corrupt_store");
      return profile;
    });
  }

  /**
   * Returns the one current revision for each requested category definition.
   * A latest paused, draft, or archived revision is deliberately not silently
   * substituted with an older active profile.
   */
  async currentActiveArtifacts(categoryDefinitionIds: readonly string[]): Promise<readonly Readonly<{
    categoryDefinitionId: string;
    profile: CategoryProfileRevision;
  }>[]> {
    if (categoryDefinitionIds.length === 0 || categoryDefinitionIds.length > 1_000
      || new Set(categoryDefinitionIds).size !== categoryDefinitionIds.length
      || categoryDefinitionIds.some((id) => !UUID.test(id))) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      return this.currentActiveArtifactsInTransaction(transaction as Database, categoryDefinitionIds);
    });
  }

  /**
   * Snapshot-owned current profile read. It does not begin a transaction;
   * callers that compose several sources must supply their existing RR/RO
   * transaction to avoid a drifting nested snapshot.
   */
  async currentActiveArtifactsInTransaction(transaction: Pick<Database, "execute">,
    categoryDefinitionIds: readonly string[]): Promise<readonly Readonly<{
      categoryDefinitionId: string;
      profile: CategoryProfileRevision;
    }>[]> {
    if (categoryDefinitionIds.length === 0 || categoryDefinitionIds.length > 1_000
      || new Set(categoryDefinitionIds).size !== categoryDefinitionIds.length
      || categoryDefinitionIds.some((id) => !UUID.test(id))) fail("invalid_input");
    const workspace = rows<{ id: string; lifecycle_state: string }>(await transaction.execute(sql`
      select id, lifecycle_state from workspaces where id = ${this.workspaceId}::uuid limit 1
    `));
    if (workspace.length !== 1) fail("workspace_scope_mismatch");
    if (workspace[0]!.lifecycle_state !== "active") fail("inactive_workspace");
    const found = rows<StoredRow>(await transaction.execute(sql`
      select distinct on (category_definition_id)
        category_definition_id::text, workspace_ref, profile_ref, category_ref, version,
        previous_profile_hash, status, profile_hash, profile_payload
      from category_profile_revisions
      where workspace_id = ${this.workspaceId}::uuid
        and category_definition_id = any(array[${sql.join(categoryDefinitionIds.map((id) => sql`${id}::uuid`), sql`, `)}])
      order by category_definition_id, version desc
    `));
    if (found.length !== categoryDefinitionIds.length
      || new Set(found.map((row) => row.category_definition_id)).size !== found.length
      || found.some((row) => !categoryDefinitionIds.includes(row.category_definition_id)
        || row.status !== "active" || row.workspace_ref !== this.workspaceRef)) fail("revision_conflict");
    return Object.freeze(found.map((row) => Object.freeze({
      categoryDefinitionId: row.category_definition_id, profile: restore(row),
    })).sort((left, right) => left.categoryDefinitionId.localeCompare(right.categoryDefinitionId)));
  }
}
