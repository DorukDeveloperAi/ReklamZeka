import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { GuidanceStudioService } from "@/application/guidance-studio-service";
import { DrizzleGuidanceRegistryRepository } from "@/connectors/guidance/guidance-drizzle-repository";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:guidance-studio-live" }));
  process.exitCode = 2;
} else {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 8_000,
    statement_timeout: 20_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  const database = drizzle(pool, { schema });
  const workspaceId = randomUUID(); const userId = randomUUID();
  const dimensionId = randomUUID(); const definitionId = randomUUID();
  const principal = { actor: { userId }, workspaceId, workspaceRef: "workspace_guidance_acceptance",
    readerRef: "reader_guidance_acceptance" } as const;
  const membership = { workspaceId, userId, role: "owner" as const };
  const rollback = new Error("GUIDANCE_STUDIO_OUTER_ROLLBACK");
  let evidence: Record<string, unknown> | undefined;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;

  try {
    await database.transaction(async (outer) => {
      await outer.execute(sql`insert into users (id, email)
        values (${userId}::uuid, ${`guidance-${userId}@acceptance.invalid`})`);
      await outer.execute(sql`insert into workspaces (id, name)
        values (${workspaceId}::uuid, 'Guidance acceptance')`);
      await outer.execute(sql`insert into memberships (workspace_id, user_id, role)
        values (${workspaceId}::uuid, ${userId}::uuid, 'owner')`);
      await outer.execute(sql`insert into category_dimensions
        (id, workspace_id, key, name, cardinality, allowed_entity_levels, version)
        values (${dimensionId}::uuid, ${workspaceId}::uuid, 'internal_campaign_type', 'İç kampanya türü',
          'single', array['campaign']::category_entity_level[], 1)`);
      await outer.execute(sql`insert into category_definitions
        (id, workspace_id, dimension_id, key, label, version)
        values (${definitionId}::uuid, ${workspaceId}::uuid, ${dimensionId}::uuid,
          'protected_region', 'Korunan bölge', 1)`);

      const service = new GuidanceStudioService(
        new DrizzleGuidanceRegistryRepository(outer as never), [membership]);
      const initial = await service.list(principal);
      const category = initial.categories[0];
      if (!category?.ref.startsWith("category_")) throw new Error("category_catalog_missing");
      let result = await service.createDraft(principal, { title: "Korunan bölge bütçesi",
        body: "Bölge pahalılaşsa bile bütçeyi başka bölgeye taşıma.", strength: "must",
        topic: "budget_allocation", scopes: [
          { facet: "internal_category", value: category.ref, entityType: null, mode: "exception", priority: 90 },
          { facet: "topic", value: "budget_allocation", entityType: null, mode: "default", priority: 70 },
        ], expectedRegistryHash: initial.registryHash });
      result = await service.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 1,
        expectedRegistryHash: result.registryHash, operation: "revise", title: result.item.title,
        body: "Bölge pahalılaşsa bile bütçeyi başka bölgeye taşıma; tabanı koru.", strength: "must",
        topic: "budget_allocation", scopes: result.item.scopes });
      result = await service.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 2,
        expectedRegistryHash: result.registryHash, operation: "publish" });
      let staleRejected = false;
      try {
        await service.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 2,
          expectedRegistryHash: result.registryHash, operation: "archive" });
      } catch (reason) {
        staleRejected = reason instanceof Error && "code" in reason && reason.code === "conflict";
      }
      const restarted = new GuidanceStudioService(
        new DrizzleGuidanceRegistryRepository(outer as never), [membership]);
      const afterRestart = await restarted.list(principal);
      const restartStable = afterRestart.items[0]?.status === "published" && afterRestart.items[0].version === 3;
      result = await restarted.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 3,
        expectedRegistryHash: afterRestart.registryHash, operation: "archive" });
      const counts = (await outer.execute(sql`select
        (select count(*)::int from audit_events where workspace_id = ${workspaceId}::uuid) as audit_count,
        (select count(*)::int from guidance_cards where workspace_id = ${workspaceId}::uuid) as revision_count,
        (select count(distinct binding_key)::int from guidance_bindings
          where workspace_id = ${workspaceId}::uuid) as binding_count,
        (select count(*)::int from effective_campaign_context_invalidations
          where workspace_id = ${workspaceId}::uuid and component_type = 'guidance_registry') as invalidation_count`))
        .rows[0] as Record<string, unknown>;
      evidence = { categoryCatalog: initial.categories.length, revisions: Number(counts.revision_count),
        auditEvents: Number(counts.audit_count), bindingCount: Number(counts.binding_count),
        contextInvalidations: Number(counts.invalidation_count), finalArchived: result.item.status === "archived",
        contextInvalidated: result.contextInvalidated, restartStable, staleRejected,
        noMetaAuthority: result.authority.canWriteMeta === false };
      if (Number(counts.audit_count) !== 4 || Number(counts.revision_count) !== 4
        || Number(counts.binding_count) !== 2 || Number(counts.invalidation_count) !== 2
        || !Object.values({ finalArchived: evidence.finalArchived, contextInvalidated: evidence.contextInvalidated,
          restartStable, staleRejected, noMetaAuthority: evidence.noMetaAuthority }).every((value) => value === true)) {
        throw new Error("guidance_studio_acceptance_failed");
      }
      throw rollback;
    });
  } catch (reason) {
    if (reason !== rollback) throw reason;
  } finally {
    globalThis.fetch = originalFetch;
  }
  const residue = ((await database.execute(sql`select
    (select count(*)::int from workspaces where id = ${workspaceId}::uuid) as workspace_count,
    (select count(*)::int from users where id = ${userId}::uuid) as user_count,
    (select count(*)::int from guidance_sources where workspace_id = ${workspaceId}::uuid) as source_count,
    (select count(*)::int from guidance_cards where workspace_id = ${workspaceId}::uuid) as card_count,
    (select count(*)::int from guidance_bindings where workspace_id = ${workspaceId}::uuid) as binding_count,
    (select count(*)::int from audit_events where workspace_id = ${workspaceId}::uuid) as audit_count`)).rows[0]) as Record<string, unknown>;
  await pool.end();
  const residueCount = Object.values(residue).reduce<number>((sum, value) => sum + Number(value), 0);
  if (residueCount !== 0 || fetchCalls !== 0 || !evidence) throw new Error("guidance_studio_outer_rollback_failed");
  console.log(JSON.stringify({ ok: true, outerRollback: true, residueRows: residueCount,
    metaOrNetworkCalls: fetchCalls, ...evidence }));
}
