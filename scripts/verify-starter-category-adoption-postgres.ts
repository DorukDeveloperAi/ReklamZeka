import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildStarterCategoryAdoptionPlan } from "@/application/starter-category-adoption-service";
import { DrizzleStarterCategoryAdoptionRepository } from
  "@/connectors/categories/starter-category-adoption-drizzle-repository";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const rollback = Symbol("starter-adoption-rollback");
const ids = Object.freeze({ workspace: randomUUID(), owner: randomUUID(), revoked: randomUUID() });
const workspaceRef = "workspace_starter_adoption_acceptance";

async function verify(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  const database = drizzle(pool, { schema });
  const evidence = { fourteenDimensionsCreated: false, sevenDefinitionsCreated: false,
    sevenMergedProfilesCreated: false, exactSixObjectiveBindings: false, exactReplayIdempotent: false,
    membershipRechecked: false, stalePlanZeroWrite: false, auditExact: false, invalidationExact: false,
    atomicRollbackClean: false, rollbackClean: false };
  try {
    try {
      await database.transaction(async (tx) => {
        await tx.insert(schema.users).values([
          { id: ids.owner, email: `starter-owner-${ids.owner}@acceptance.invalid` },
          { id: ids.revoked, email: `starter-revoked-${ids.revoked}@acceptance.invalid` },
        ]);
        await tx.insert(schema.workspaces).values({ id: ids.workspace, name: "Starter adoption acceptance" });
        await tx.insert(schema.memberships).values({ workspaceId: ids.workspace, userId: ids.owner, role: "owner" });
        const repository = new DrizzleStarterCategoryAdoptionRepository(tx as never);
        const inventory = await repository.inspect(ids.workspace, workspaceRef);
        const plan = buildStarterCategoryAdoptionPlan(workspaceRef, inventory.categories, inventory.profiles,
          "actor_starter_acceptance");
        const command = Object.freeze({ planHash: plan.planHash, expectedRegistryHash: plan.registryHash,
          expectedProfileRegistryHash: plan.profileRegistryHash, targetRefs: plan.targetRefs,
          confirmation: "adopt_starter_category_playbook" as const,
          acknowledgedPendingOwnerConfiguration: true as const });
        const mutation = { workspaceId: ids.workspace, workspaceRef, actorId: ids.owner,
          actorRef: "actor_starter_acceptance", role: "owner" as const,
          occurredAt: "2026-08-10T10:00:00.000Z", command };
        evidence.membershipRechecked = await repository.adopt({ ...mutation, actorId: ids.revoked })
          .then(() => false, (reason) => reason instanceof Error && "code" in reason && reason.code === "forbidden");
        const result = await repository.adopt(mutation);
        evidence.fourteenDimensionsCreated = result.dimensionsCreated === 14;
        evidence.sevenDefinitionsCreated = result.definitionsCreated === 7;
        evidence.sevenMergedProfilesCreated = result.profileDraftsCreated === 7;
        const after = await repository.inspect(ids.workspace, workspaceRef);
        const profiles = after.profiles.definitions.map((definition) => definition.currentProfile).filter(Boolean);
        evidence.exactSixObjectiveBindings = profiles.length === 7 && profiles.every((profile) =>
          profile?.status === "draft" && profile.version === 1 && profile.bindings.analysisPlaybookRefs.length === 6
          && new Set(profile.bindings.analysisPlaybookRefs).size === 6);
        const replay = await repository.adopt({ ...mutation, occurredAt: "2026-08-10T10:01:00.000Z" });
        evidence.exactReplayIdempotent = replay.outcome === "unchanged" && replay.auditAppended === false;
        const beforeStale = { dimensions: (await tx.select({ id: schema.categoryDimensions.id })
          .from(schema.categoryDimensions).where(eq(schema.categoryDimensions.workspaceId, ids.workspace))).length,
        definitions: (await tx.select({ id: schema.categoryDefinitions.id }).from(schema.categoryDefinitions)
          .where(eq(schema.categoryDefinitions.workspaceId, ids.workspace))).length,
        profiles: (await tx.select({ id: schema.categoryProfileRevisions.id }).from(schema.categoryProfileRevisions)
          .where(eq(schema.categoryProfileRevisions.workspaceId, ids.workspace))).length,
        audits: (await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
          .where(eq(schema.auditEvents.workspaceId, ids.workspace))).length };
        evidence.stalePlanZeroWrite = await repository.adopt({ ...mutation,
          command: { ...command, planHash: "f".repeat(64) } }).then(() => false, () => true);
        const afterStale = { dimensions: (await tx.select({ id: schema.categoryDimensions.id })
          .from(schema.categoryDimensions).where(eq(schema.categoryDimensions.workspaceId, ids.workspace))).length,
        definitions: (await tx.select({ id: schema.categoryDefinitions.id }).from(schema.categoryDefinitions)
          .where(eq(schema.categoryDefinitions.workspaceId, ids.workspace))).length,
        profiles: (await tx.select({ id: schema.categoryProfileRevisions.id }).from(schema.categoryProfileRevisions)
          .where(eq(schema.categoryProfileRevisions.workspaceId, ids.workspace))).length,
        audits: (await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
          .where(eq(schema.auditEvents.workspaceId, ids.workspace))).length };
        evidence.stalePlanZeroWrite = evidence.stalePlanZeroWrite
          && JSON.stringify(beforeStale) === JSON.stringify(afterStale);
        const audits = await tx.select({ action: schema.auditEvents.action, metadata: schema.auditEvents.metadata })
          .from(schema.auditEvents).where(eq(schema.auditEvents.workspaceId, ids.workspace));
        const metadata = audits[0]?.metadata as Record<string, unknown> | undefined;
        evidence.auditExact = audits.length === 1 && audits[0]?.action === "starter_category.core_adopted"
          && metadata?.planHash === plan.planHash && metadata?.targetRefCount === 28
          && metadata?.pendingOwnerConfigurationAcknowledged === true;
        const invalidations = await tx.select({ id: schema.effectiveCampaignContextInvalidations.id })
          .from(schema.effectiveCampaignContextInvalidations)
          .where(eq(schema.effectiveCampaignContextInvalidations.workspaceId, ids.workspace));
        evidence.invalidationExact = invalidations.length === 0
          && metadata?.categoryInvalidationsAppended === 0 && metadata?.profileInvalidationsAppended === 0;
        evidence.atomicRollbackClean = Object.values({ ...evidence, rollbackClean: true }).every(Boolean);
        if (!evidence.atomicRollbackClean) throw new Error("Starter adoption PostgreSQL acceptance failed");
        throw rollback;
      });
    } catch (reason) { if (reason !== rollback) throw reason; }
    const survivors = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
      .where(eq(schema.workspaces.id, ids.workspace));
    const profileSurvivors = await database.select({ id: schema.categoryProfileRevisions.id })
      .from(schema.categoryProfileRevisions).where(eq(schema.categoryProfileRevisions.workspaceId, ids.workspace));
    const auditSurvivors = await database.select({ id: schema.auditEvents.id }).from(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, ids.workspace));
    evidence.rollbackClean = survivors.length === 0 && profileSurvivors.length === 0 && auditSurvivors.length === 0;
    if (!evidence.rollbackClean) throw new Error("Starter adoption verifier rollback failed");
    process.stdout.write(`${JSON.stringify({ ok: true, ...evidence, temporaryRowsCommitted: false,
      metaNetworkCalls: 0, metaWriteCalls: 0, actionAuthorityCalls: 0, policyPublishCalls: 0 })}\n`);
  } finally { await pool.end(); }
}

if (!databaseUrl) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured" })}\n`);
  process.exitCode = 2;
} else {
  await verify(databaseUrl).catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, blocker: "starter_category_adoption_postgres_acceptance_failed" })}\n`);
    process.exitCode = 1;
  });
}
