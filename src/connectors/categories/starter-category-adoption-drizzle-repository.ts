import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  buildStarterCategoryAdoptionPlan,
  starterCategoryProfileDraftManifestDigest,
  starterCategoryProfileOwnerRef,
  StarterCategoryAdoptionError,
  type StarterCategoryAdoptionCommand,
  type StarterCategoryAdoptionInventory,
  type StarterCategoryAdoptionRepository,
} from "@/application/starter-category-adoption-service";
import {
  appendCategoryResolutionWorkspaceInvalidations,
  DrizzleCategoryAuthoringRepository,
} from "@/connectors/categories/category-authoring-drizzle-repository";
import { DrizzleCategoryProfileLifecycleRepository } from
  "@/connectors/categories/category-profile-lifecycle-drizzle-repository";
import { DrizzleCategoryProfileRepository } from "@/connectors/categories/category-profile-drizzle-repository";
import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";
import * as schema from "@/db/schema";
import { createCategoryProfile } from "@/domain/categories/category-profile";
import { STARTER_CATEGORY_PLAYBOOK_CATALOG } from "@/domain/categories/starter-playbook-catalog";
import { CategoryRegistryPersistenceError, CategoryRegistryService } from "@/domain/categories/service";

type Database = NodePgDatabase<typeof schema>;
type AdoptionDatabase = Pick<Database, "execute" | "select" | "insert" | "update" | "transaction">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new StarterCategoryAdoptionError("conflict");
  }
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function exactTargets(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function validateCommand(command: StarterCategoryAdoptionCommand) {
  if (!HASH.test(command.planHash) || !HASH.test(command.expectedRegistryHash)
    || !HASH.test(command.expectedProfileRegistryHash) || command.confirmation !== "adopt_starter_category_playbook"
    || command.acknowledgedPendingOwnerConfiguration !== true || !Array.isArray(command.targetRefs)
    || command.targetRefs.length < 1 || command.targetRefs.length > 48
    || command.targetRefs.some((ref) => typeof ref !== "string" || !/^[a-z][a-z0-9_.:-]{1,158}$/.test(ref))
    || new Set(command.targetRefs).size !== command.targetRefs.length
    || !exactTargets(command.targetRefs, [...command.targetRefs].sort())) {
    throw new StarterCategoryAdoptionError("invalid_input");
  }
}
function translate(reason: unknown): never {
  if (reason instanceof StarterCategoryAdoptionError) throw reason;
  if (reason instanceof CategoryRegistryPersistenceError) {
    throw new StarterCategoryAdoptionError(reason.code === "not_found" ? "not_found" : "conflict");
  }
  throw reason;
}

/**
 * One outer transaction owns workspace locking, membership recheck, category creation,
 * immutable profile drafts, invalidation accounting and the append-only audit event.
 */
export class DrizzleStarterCategoryAdoptionRepository implements StarterCategoryAdoptionRepository {
  constructor(private readonly database: AdoptionDatabase) {}

  async inspect(workspaceId: string, workspaceRef: string): Promise<StarterCategoryAdoptionInventory> {
    if (!UUID.test(workspaceId) || !/^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(workspaceRef)) {
      throw new StarterCategoryAdoptionError("invalid_input");
    }
    const database = this.database as Database;
    return Object.freeze({
      categories: await new DrizzleCategoryAuthoringRepository(database).inspect(workspaceId),
      profiles: await new DrizzleCategoryProfileLifecycleRepository(database).inspect(workspaceId, workspaceRef),
    });
  }

  async adopt(input: Parameters<StarterCategoryAdoptionRepository["adopt"]>[0]) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role)
      || !/^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(input.workspaceRef)
      || !Number.isFinite(Date.parse(input.occurredAt))) throw new StarterCategoryAdoptionError("invalid_input");
    validateCommand(input.command);
    try {
      return await this.database.transaction(async (transaction) => {
        const tx = transaction as unknown as Database;
        const workspace = rows<{ id: string }>(await tx.execute(sql`
          select id::text from workspaces where id = ${input.workspaceId}::uuid
            and lifecycle_state = 'active' for update
        `));
        if (workspace.length !== 1) throw new StarterCategoryAdoptionError("not_found");
        const membership = rows<{ role: string }>(await tx.execute(sql`
          select role::text from memberships where workspace_id = ${input.workspaceId}::uuid
            and user_id = ${input.actorId}::uuid limit 2
        `));
        if (membership.length !== 1 || membership[0]!.role !== input.role
          || !["owner", "admin"].includes(membership[0]!.role)) {
          throw new StarterCategoryAdoptionError("forbidden");
        }

        const before = await new DrizzleStarterCategoryAdoptionRepository(tx).inspect(
          input.workspaceId, input.workspaceRef);
        const profileOwnerRef = starterCategoryProfileOwnerRef(input.actorId, input.actorRef);
        const plan = buildStarterCategoryAdoptionPlan(input.workspaceRef, before.categories, before.profiles,
          profileOwnerRef);
        const exactPlan = plan.planHash === input.command.planHash
          && plan.registryHash === input.command.expectedRegistryHash
          && plan.profileRegistryHash === input.command.expectedProfileRegistryHash
          && exactTargets(plan.targetRefs, input.command.targetRefs);
        if (!exactPlan) {
          const proposalManifestHash = digest(plan.profileProposals);
          const profileDraftManifestHash = starterCategoryProfileDraftManifestDigest(plan.profileDrafts);
          const replay = rows<{ event_hash: string }>(await tx.execute(sql`
            select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid
              and action = 'starter_category.core_adopted'
              and metadata #>> '{planHash}' = ${input.command.planHash}
              and metadata #>> '{targetRefsHash}' = ${digest(input.command.targetRefs)}
              and metadata #>> '{catalogVersion}' = ${STARTER_CATEGORY_PLAYBOOK_CATALOG.schemaVersion}
              and metadata #>> '{catalogHash}' = ${STARTER_CATEGORY_PLAYBOOK_CATALOG.catalogHash}
              and metadata #>> '{proposalManifestHash}' = ${proposalManifestHash}
              and metadata #>> '{profileDraftManifestHash}' = ${profileDraftManifestHash}
            order by occurred_at desc, created_at desc, id desc limit 2
          `));
          const currentSafe = replay.length === 1 && plan.categoryCommands.length === 0
            && plan.profileDrafts.every((draft) => draft.disposition === "satisfied")
            && !plan.blockers.some((blocker) => blocker.blocking)
            && exactTargets(plan.targetRefs, input.command.targetRefs);
          if (!currentSafe) throw new StarterCategoryAdoptionError("conflict");
          return Object.freeze({ outcome: "unchanged" as const, registryHash: plan.registryHash,
            profileRegistryHash: plan.profileRegistryHash, dimensionsCreated: 0, definitionsCreated: 0,
            profileDraftsCreated: 0, auditAppended: false, categoryInvalidationsAppended: 0,
            profileInvalidationsAppended: 0 });
        }
        if (plan.blockers.some((blocker) => blocker.blocking)) {
          throw new StarterCategoryAdoptionError("conflict");
        }

        const registry = new CategoryRegistryService(new DrizzleCategoryRegistryRepository(tx));
        let dimensionsCreated = 0; let definitionsCreated = 0; let profileDraftsCreated = 0;
        let categoryInvalidationsAppended = 0; let profileInvalidationsAppended = 0;
        for (const command of plan.categoryCommands.filter((entry) => entry.operation === "create_dimension")) {
          await registry.createDimension({ id: randomUUID(), workspaceId: input.workspaceId, key: command.key,
            name: command.name, description: command.description, cardinality: command.cardinality,
            allowedEntityLevels: command.allowedEntityLevels as readonly ("campaign" | "ad_set" | "ad" | "creative")[] });
          dimensionsCreated += 1;
        }
        const afterDimensions = await new DrizzleCategoryAuthoringRepository(tx).inspect(input.workspaceId);
        const definitionDimensionIds = new Set<string>();
        for (const command of plan.categoryCommands.filter((entry) => entry.operation === "create_definition")) {
          const dimension = afterDimensions.dimensions.find((entry) => entry.ref === command.dimensionRef);
          if (!dimension) throw new StarterCategoryAdoptionError("conflict");
          const dimensionRow = rows<{ id: string }>(await tx.execute(sql`
            select id::text from category_dimensions where workspace_id = ${input.workspaceId}::uuid
              and key = ${dimension.key} and archived_at is null limit 2
          `));
          if (dimensionRow.length !== 1) throw new StarterCategoryAdoptionError("conflict");
          await registry.createDefinition({ id: randomUUID(), workspaceId: input.workspaceId,
            dimensionId: dimensionRow[0]!.id, key: command.key, label: command.label,
            description: command.description });
          definitionDimensionIds.add(dimensionRow[0]!.id);
          definitionsCreated += 1;
        }
        for (const dimensionId of [...definitionDimensionIds].sort()) {
          categoryInvalidationsAppended += await appendCategoryResolutionWorkspaceInvalidations({ database: tx,
            workspaceId: input.workspaceId, dimensionId, reasonCode: "source_changed",
            occurredAt: input.occurredAt });
        }

        const afterCategories = await new DrizzleCategoryAuthoringRepository(tx).inspect(input.workspaceId);
        for (const draft of plan.profileDrafts.filter((entry) => entry.disposition === "create")) {
          const definition = afterCategories.dimensions.flatMap((dimension) => dimension.definitions.map((entry) => ({
            dimension, definition: entry,
          }))).filter((entry) => entry.definition.ref === draft.categoryRef);
          if (definition.length !== 1) throw new StarterCategoryAdoptionError("conflict");
          const definitionRow = rows<{ id: string }>(await tx.execute(sql`
            select definition.id::text from category_definitions definition
            join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
              and dimension.id = definition.dimension_id and dimension.archived_at is null
            where definition.workspace_id = ${input.workspaceId}::uuid
              and definition.archived_at is null and dimension.key = ${definition[0]!.dimension.key}
              and definition.key = ${definition[0]!.definition.key} limit 2
          `));
          if (definitionRow.length !== 1) throw new StarterCategoryAdoptionError("conflict");
          const profile = createCategoryProfile({ workspaceRef: input.workspaceRef, profileRef: draft.profileRef,
            categoryRef: draft.categoryRef, parentCategoryRef: null, label: draft.material.label,
            description: draft.material.description, color: draft.material.color, ownerRef: profileOwnerRef,
            status: "draft", bindings: draft.material.bindings });
          const appended = await new DrizzleCategoryProfileRepository(tx, input.workspaceId, input.workspaceRef)
            .append(profile, { categoryDefinitionId: definitionRow[0]!.id,
              parentCategoryDefinitionId: null, observedAt: input.occurredAt });
          if (appended.outcome !== "inserted") throw new StarterCategoryAdoptionError("conflict");
          profileDraftsCreated += 1; profileInvalidationsAppended += appended.invalidationsAppended;
        }

        const after = await new DrizzleStarterCategoryAdoptionRepository(tx).inspect(input.workspaceId, input.workspaceRef);
        const afterPlan = buildStarterCategoryAdoptionPlan(input.workspaceRef, after.categories, after.profiles,
          profileOwnerRef);
        if (afterPlan.categoryCommands.length !== 0
          || afterPlan.profileDrafts.some((draft) => draft.disposition !== "satisfied")
          || afterPlan.blockers.some((blocker) => blocker.blocking)
          || !exactTargets(afterPlan.targetRefs, input.command.targetRefs)) {
          throw new StarterCategoryAdoptionError("conflict");
        }

        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
        const previousHash = String(rows<{ event_hash: string }>(await tx.execute(sql`
          select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid
          order by occurred_at desc, created_at desc, id desc limit 1
        `))[0]?.event_hash ?? "GENESIS");
        const proposalManifestHash = digest(plan.profileProposals);
        const profileDraftManifestHash = starterCategoryProfileDraftManifestDigest(plan.profileDrafts);
        if (plan.profileProposals.length !== 54 || plan.profileDrafts.length !== 9) {
          throw new StarterCategoryAdoptionError("conflict");
        }
        const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
          action: "starter_category.core_adopted", resourceType: "starter_category_playbook",
          resourceId: STARTER_CATEGORY_PLAYBOOK_CATALOG.catalogHash, occurredAt: new Date(input.occurredAt).toISOString(),
          previousHash, metadata: Object.freeze({ role: input.role, planHash: input.command.planHash,
            catalogVersion: STARTER_CATEGORY_PLAYBOOK_CATALOG.schemaVersion,
            catalogHash: STARTER_CATEGORY_PLAYBOOK_CATALOG.catalogHash,
            proposalManifestHash, proposalCount: plan.profileProposals.length,
            profileDraftManifestHash, profileDraftCount: plan.profileDrafts.length,
            expectedRegistryHash: input.command.expectedRegistryHash,
            expectedProfileRegistryHash: input.command.expectedProfileRegistryHash,
            actualRegistryHash: afterPlan.registryHash, actualProfileRegistryHash: afterPlan.profileRegistryHash,
            targetRefsHash: digest(input.command.targetRefs), targetRefCount: input.command.targetRefs.length,
            pendingOwnerConfigurationAcknowledged: true, pendingOwnerConfigurationCount:
              plan.blockers.find((blocker) => blocker.code === "pending_owner_configuration")?.refs.length ?? 0,
            dimensionsCreated, definitionsCreated, profileDraftsCreated,
            categoryInvalidationsAppended, profileInvalidationsAppended }) });
        await tx.execute(sql`
          insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
            metadata, previous_hash, event_hash, occurred_at)
          values (${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action},
            ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
            ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)
        `);
        return Object.freeze({ outcome: "inserted" as const, registryHash: afterPlan.registryHash,
          profileRegistryHash: afterPlan.profileRegistryHash, dimensionsCreated, definitionsCreated,
          profileDraftsCreated, auditAppended: true, categoryInvalidationsAppended,
          profileInvalidationsAppended });
      });
    } catch (reason) { return translate(reason); }
  }
}
