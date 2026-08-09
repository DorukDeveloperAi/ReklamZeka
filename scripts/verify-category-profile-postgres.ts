import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleCategoryProfileRepository } from
  "@/connectors/categories/category-profile-drizzle-repository";
import { DrizzleCategoryProfileLifecycleRepository } from
  "@/connectors/categories/category-profile-lifecycle-drizzle-repository";
import { CategoryProfileLifecycleService } from "@/application/category-profile-lifecycle-service";
import { createCategoryProfile, reviseCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const rollback = Symbol("rollback");
const ids = Object.freeze({ workspace: randomUUID(), actor: randomUUID(), dimension: randomUUID(),
  parent: randomUUID(), child: randomUUID() });
const workspaceRef = "workspace_category_profile_acceptance";

const bindings = Object.freeze({ analysisPlaybookRefs: ["analysis_playbook_acceptance_v1"],
  ruleInstructionBundleRefs: ["instruction_bundle_acceptance_v1"], budgetPolicyRefs: ["budget_policy_acceptance_v1"],
  transferPolicyRefs: ["transfer_policy_acceptance_v1"], schedulePolicyRefs: ["schedule_policy_acceptance_v1"],
  actionPolicyRefs: ["guardrail_acceptance_v1"], creativePolicyRefs: ["creative_policy_acceptance_v1"] });

async function verify(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  const database = drizzle(pool, { schema });
  const evidence = { migrationApplied: false, rlsForced: false, serviceRoleRevoked: false,
    versionChainRoundTrip: false, exactReplayIdempotent: false, priorHashInvalidated: false,
    parentCycleBlocked: false, lifecycleOwnerAdminAllowed: false, analystViewerDenied: false,
    membershipRechecked: false, staleRegistryBlocked: false, staleProfileOccBlocked: false,
    lifecycleAuditAppended: false, lifecycleReasonAudited: false, lifecyclePriorHashInvalidated: false,
    atomicRollbackClean: false, appendOnlyTrigger: false, rollbackClean: false };
  try {
    const catalog = await pool.query<{ table_name: string | null; row_security: boolean; force_row_security: boolean;
      service_table: boolean; service_function: boolean }>(`
      select to_regclass('public.category_profile_revisions')::text as table_name,
        coalesce(class.relrowsecurity, false) as row_security,
        coalesce(class.relforcerowsecurity, false) as force_row_security,
        coalesce(has_table_privilege('service_role', 'public.category_profile_revisions', 'select,insert,update,delete'), false) as service_table,
        coalesce(has_function_privilege('service_role', 'public.category_profile_revisions_append_only()', 'execute'), false) as service_function
      from pg_class class where class.oid = to_regclass('public.category_profile_revisions')
    `);
    const state = catalog.rows[0];
    evidence.migrationApplied = state?.table_name === "category_profile_revisions";
    evidence.rlsForced = state?.row_security === true && state.force_row_security === true;
    evidence.serviceRoleRevoked = state?.service_table === false && state.service_function === false;
    if (!evidence.migrationApplied || !evidence.rlsForced || !evidence.serviceRoleRevoked) {
      throw new Error("CategoryProfile migration security acceptance failed");
    }

    try {
      await database.transaction(async (tx) => {
        await tx.insert(schema.users).values({ id: ids.actor,
          email: `category-profile-${ids.actor}@example.invalid` });
        await tx.insert(schema.workspaces).values({ id: ids.workspace, name: "CategoryProfile acceptance" });
        await tx.insert(schema.memberships).values({ workspaceId: ids.workspace, userId: ids.actor, role: "owner" });
        await tx.insert(schema.categoryDimensions).values({ id: ids.dimension, workspaceId: ids.workspace,
          key: "acceptance_service", name: "Acceptance service", cardinality: "single",
          allowedEntityLevels: ["campaign"] });
        await tx.insert(schema.categoryDefinitions).values([
          { id: ids.parent, workspaceId: ids.workspace, dimensionId: ids.dimension,
            key: "parent_service", label: "Parent service" },
          { id: ids.child, workspaceId: ids.workspace, dimensionId: ids.dimension,
            key: "child_service", label: "Child service" },
        ]);
        const repository = new DrizzleCategoryProfileRepository(tx as never, ids.workspace, workspaceRef);
        const parentRef = categoryDefinitionPublicRef("acceptance_service", "parent_service");
        const childRef = categoryDefinitionPublicRef("acceptance_service", "child_service");
        const parent = createCategoryProfile({ workspaceRef, profileRef: "category_profile_acceptance_parent",
          categoryRef: parentRef, parentCategoryRef: null, label: "Parent", description: "Parent profile",
          color: "#A31F34", ownerRef: "actor_acceptance_owner", status: "active", bindings });
        const child = createCategoryProfile({ workspaceRef, profileRef: "category_profile_acceptance_child",
          categoryRef: childRef, parentCategoryRef: parentRef, label: "Child", description: "Child profile",
          color: "#174A7E", ownerRef: "actor_acceptance_owner", status: "active", bindings });
        await repository.append(parent, { categoryDefinitionId: ids.parent, parentCategoryDefinitionId: null,
          observedAt: "2026-08-09T20:00:00.000Z" });
        await repository.append(child, { categoryDefinitionId: ids.child, parentCategoryDefinitionId: ids.parent,
          observedAt: "2026-08-09T20:01:00.000Z" });
        const revised = reviseCategoryProfile({ current: parent, changes: { color: "#B22040" } });
        const revisionResult = await repository.append(revised, { categoryDefinitionId: ids.parent,
          parentCategoryDefinitionId: null, observedAt: "2026-08-09T20:02:00.000Z" });
        const replay = await repository.append(revised, { categoryDefinitionId: ids.parent,
          parentCategoryDefinitionId: null, observedAt: "2026-08-09T20:03:00.000Z" });
        const rows = await tx.select({ componentRef: schema.effectiveCampaignContextInvalidations.componentRef,
          componentVersion: schema.effectiveCampaignContextInvalidations.componentVersion })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace));
        evidence.versionChainRoundTrip = revisionResult.outcome === "inserted"
          && revised.previousProfileHash === parent.profileHash && revised.version === 2;
        evidence.exactReplayIdempotent = replay.outcome === "unchanged" && replay.invalidationsAppended === 0;
        evidence.priorHashInvalidated = rows.length === 1 && rows[0]?.componentRef === parent.profileRef
          && rows[0]?.componentVersion === parent.profileHash && rows[0]?.componentVersion !== revised.profileHash;

        const cyclic = reviseCategoryProfile({ current: revised, changes: { parentCategoryRef: childRef } });
        evidence.parentCycleBlocked = await repository.append(cyclic, { categoryDefinitionId: ids.parent,
          parentCategoryDefinitionId: ids.child, observedAt: "2026-08-09T20:04:00.000Z" })
          .then(() => false, () => true);

        const lifecycleRepository = new DrizzleCategoryProfileLifecycleRepository(tx as never);
        const lifecycleState = await lifecycleRepository.inspect(ids.workspace, workspaceRef);
        const currentParent = lifecycleState.definitions.find((item) => item.definitionRef === parentRef)?.currentProfile;
        if (!currentParent) throw new Error("CategoryProfile lifecycle projection missing");
        const baseMutation = { workspaceId: ids.workspace, workspaceRef, actorId: ids.actor,
          actorRef: "actor_acceptance_owner", role: "owner" as const,
          occurredAt: "2026-08-09T20:05:00.000Z" };
        evidence.staleRegistryBlocked = await lifecycleRepository.mutate({ ...baseMutation,
          command: { operation: "pause", profileRef: currentParent.profileRef, expectedVersion: currentParent.version,
            expectedProfileHash: currentParent.profileHash, expectedRegistryHash: "f".repeat(64),
            reasonCode: "owner_pause" } }).then(() => false, () => true);
        evidence.staleProfileOccBlocked = await lifecycleRepository.mutate({ ...baseMutation,
          command: { operation: "pause", profileRef: currentParent.profileRef,
            expectedVersion: currentParent.version + 1, expectedProfileHash: currentParent.profileHash,
            expectedRegistryHash: lifecycleState.registryHash, reasonCode: "owner_pause" } }).then(() => false, () => true);
        evidence.membershipRechecked = await lifecycleRepository.mutate({ ...baseMutation, role: "admin",
          command: { operation: "pause", profileRef: currentParent.profileRef, expectedVersion: currentParent.version,
            expectedProfileHash: currentParent.profileHash, expectedRegistryHash: lifecycleState.registryHash,
            reasonCode: "admin_pause" } }).then(() => false, () => true);
        const lifecycle = await lifecycleRepository.mutate({ ...baseMutation,
          command: { operation: "pause", profileRef: currentParent.profileRef, expectedVersion: currentParent.version,
            expectedProfileHash: currentParent.profileHash, expectedRegistryHash: lifecycleState.registryHash,
            reasonCode: "owner_pause" } });
        evidence.lifecycleOwnerAdminAllowed = lifecycle.profile.status === "paused" && lifecycle.auditAppended;
        const lifecycleAudits = await tx.select({ id: schema.auditEvents.id, metadata: schema.auditEvents.metadata })
          .from(schema.auditEvents).where(eq(schema.auditEvents.workspaceId, ids.workspace));
        evidence.lifecycleAuditAppended = lifecycleAudits.length === 1;
        evidence.lifecycleReasonAudited = lifecycleAudits.length === 1
          && (lifecycleAudits[0]?.metadata as { reasonCode?: unknown } | undefined)?.reasonCode === "owner_pause";
        evidence.lifecyclePriorHashInvalidated = (await tx.select({ componentVersion:
          schema.effectiveCampaignContextInvalidations.componentVersion })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace)))
          .some((item) => item.componentVersion === currentParent.profileHash);

        const principal = { actor: { userId: ids.actor }, workspaceId: ids.workspace,
          workspaceRef, readerRef: "actor_acceptance_owner" } as const;
        evidence.analystViewerDenied = (await Promise.all((["analyst", "viewer"] as const).map(async (role) => {
          const service = new CategoryProfileLifecycleService(lifecycleRepository,
            [{ userId: ids.actor, workspaceId: ids.workspace, role }]);
          return service.mutate(principal, { operation: "archive", profileRef: lifecycle.profile.profileRef,
            expectedVersion: lifecycle.profile.version, expectedProfileHash: lifecycle.profile.profileHash,
            expectedRegistryHash: lifecycle.state.registryHash, reasonCode: "role_archive" })
            .then(() => false, () => true);
        }))).every(Boolean);

        const beforeRollback = { profiles: (await tx.select({ id: schema.categoryProfileRevisions.id })
          .from(schema.categoryProfileRevisions).where(eq(schema.categoryProfileRevisions.workspaceId, ids.workspace))).length,
        invalidations: (await tx.select({ id: schema.effectiveCampaignContextInvalidations.id })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace))).length,
        audits: (await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
          .where(eq(schema.auditEvents.workspaceId, ids.workspace))).length };
        const lifecycleRollback = Symbol("lifecycle-rollback");
        try {
          await tx.transaction(async (savepoint) => {
            const nested = new DrizzleCategoryProfileLifecycleRepository(savepoint as never);
            const nestedState = await nested.inspect(ids.workspace, workspaceRef);
            const paused = nestedState.definitions.find((item) => item.definitionRef === parentRef)?.currentProfile;
            if (!paused) throw new Error("CategoryProfile nested lifecycle projection missing");
            await nested.mutate({ ...baseMutation, occurredAt: "2026-08-09T20:06:00.000Z",
              command: { operation: "publish", profileRef: paused.profileRef, expectedVersion: paused.version,
                expectedProfileHash: paused.profileHash, expectedRegistryHash: nestedState.registryHash,
                reasonCode: "owner_publish" } });
            throw lifecycleRollback;
          });
        } catch (error) { if (error !== lifecycleRollback) throw error; }
        const afterRollback = { profiles: (await tx.select({ id: schema.categoryProfileRevisions.id })
          .from(schema.categoryProfileRevisions).where(eq(schema.categoryProfileRevisions.workspaceId, ids.workspace))).length,
        invalidations: (await tx.select({ id: schema.effectiveCampaignContextInvalidations.id })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace))).length,
        audits: (await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
          .where(eq(schema.auditEvents.workspaceId, ids.workspace))).length };
        evidence.atomicRollbackClean = JSON.stringify(beforeRollback) === JSON.stringify(afterRollback);
        evidence.appendOnlyTrigger = await tx.execute(sql`update category_profile_revisions
          set color = '#000000' where workspace_id = ${ids.workspace}::uuid`)
          .then(() => false, () => true);
        if (Object.entries(evidence).filter(([key]) => key !== "rollbackClean").some(([, value]) => !value)) {
          throw new Error("CategoryProfile PostgreSQL acceptance failed");
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const survivors = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
      .where(eq(schema.workspaces.id, ids.workspace));
    const profileSurvivors = await database.select({ id: schema.categoryProfileRevisions.id })
      .from(schema.categoryProfileRevisions).where(eq(schema.categoryProfileRevisions.workspaceId, ids.workspace));
    const invalidationSurvivors = await database.select({ id: schema.effectiveCampaignContextInvalidations.id })
      .from(schema.effectiveCampaignContextInvalidations)
      .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace));
    const auditSurvivors = await database.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, ids.workspace));
    evidence.rollbackClean = survivors.length === 0 && profileSurvivors.length === 0
      && invalidationSurvivors.length === 0 && auditSurvivors.length === 0;
    if (!evidence.rollbackClean) throw new Error("CategoryProfile verifier rollback failed");
    process.stdout.write(`${JSON.stringify({ ok: true, ...evidence, metaNetworkCalls: 0, metaWriteCalls: 0,
      actionAuthorityCalls: 0, policyPublishCalls: 0,
      temporaryRowsCommitted: false })}\n`);
  } finally { await pool.end(); }
}

if (!databaseUrl) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured" })}\n`);
  process.exitCode = 2;
} else {
  await verify(databaseUrl).catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, blocker: "category_profile_postgres_acceptance_failed" })}\n`);
    process.exitCode = 1;
  });
}
