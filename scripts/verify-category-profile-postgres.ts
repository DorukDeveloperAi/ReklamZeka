import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleCategoryProfileRepository } from
  "@/connectors/categories/category-profile-drizzle-repository";
import { createCategoryProfile, reviseCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const rollback = Symbol("rollback");
const ids = Object.freeze({ workspace: randomUUID(), dimension: randomUUID(), parent: randomUUID(), child: randomUUID() });
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
    parentCycleBlocked: false, appendOnlyTrigger: false, rollbackClean: false };
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
        await tx.insert(schema.workspaces).values({ id: ids.workspace, name: "CategoryProfile acceptance" });
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
        evidence.appendOnlyTrigger = await tx.execute(sql`update category_profile_revisions
          set color = '#000000' where workspace_id = ${ids.workspace}::uuid`)
          .then(() => false, () => true);
        if (Object.values(evidence).slice(0, 8).some((value) => !value)) {
          throw new Error("CategoryProfile PostgreSQL acceptance failed");
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const survivors = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
      .where(eq(schema.workspaces.id, ids.workspace));
    evidence.rollbackClean = survivors.length === 0;
    if (!evidence.rollbackClean) throw new Error("CategoryProfile verifier rollback failed");
    process.stdout.write(`${JSON.stringify({ ok: true, ...evidence, metaNetworkCalls: 0, metaWriteCalls: 0,
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
