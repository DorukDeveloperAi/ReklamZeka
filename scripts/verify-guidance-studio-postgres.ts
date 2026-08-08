import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { GuidanceStudioService } from "@/application/guidance-studio-service";
import { DrizzleGuidanceRegistryRepository } from "@/connectors/guidance/guidance-drizzle-repository";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 8_000, statement_timeout: 15_000 });
const workspaceId = randomUUID(); const userId = randomUUID(); const dimensionId = randomUUID(); const definitionId = randomUUID();
const principal = { actor: { userId }, workspaceId, workspaceRef: "workspace_guidance_acceptance",
  readerRef: "reader_guidance_acceptance" } as const;

try {
  await pool.query("insert into users (id, email) values ($1, $2)", [userId, `guidance-${userId}@acceptance.invalid`]);
  await pool.query("insert into workspaces (id, name) values ($1, $2)", [workspaceId, "Guidance acceptance"]);
  await pool.query("insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
  await pool.query(`insert into category_dimensions
    (id, workspace_id, key, name, cardinality, allowed_entity_levels, version)
    values ($1, $2, 'internal_campaign_type', 'İç kampanya türü', 'single', array['campaign']::category_entity_level[], 1)`,
  [dimensionId, workspaceId]);
  await pool.query(`insert into category_definitions
    (id, workspace_id, dimension_id, key, label, version)
    values ($1, $2, $3, 'protected_region', 'Korunan bölge', 1)`, [definitionId, workspaceId, dimensionId]);

  const database = drizzle(pool, { schema });
  const repository = new DrizzleGuidanceRegistryRepository(database);
  const service = new GuidanceStudioService(repository, [{ workspaceId, userId, role: "owner" }]);
  const initial = await service.list(principal);
  const category = initial.categories[0];
  if (!category?.ref.startsWith("category_")) throw new Error("category catalog missing");
  let result = await service.createDraft(principal, { title: "Korunan bölge bütçesi",
    body: "Bölge pahalılaşsa bile bütçeyi başka bölgeye taşıma.", strength: "must", topic: "budget_allocation",
    scope: { facet: "internal_category", value: category.ref, entityType: null, mode: "exception", priority: 90 },
    expectedRegistryHash: initial.registryHash });
  result = await service.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 1,
    expectedRegistryHash: result.registryHash, operation: "revise", title: result.item.title,
    body: "Bölge pahalılaşsa bile bütçeyi başka bölgeye taşıma; tabanı koru.", strength: "must",
    topic: "budget_allocation", scope: result.item.scope });
  result = await service.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 2,
    expectedRegistryHash: result.registryHash, operation: "publish" });
  const restarted = new GuidanceStudioService(new DrizzleGuidanceRegistryRepository(database),
    [{ workspaceId, userId, role: "owner" }]);
  const afterRestart = await restarted.list(principal);
  if (afterRestart.items[0]?.status !== "published" || afterRestart.items[0].version !== 3) {
    throw new Error("restart persistence failed");
  }
  result = await restarted.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 3,
    expectedRegistryHash: afterRestart.registryHash, operation: "archive" });
  const audit = await pool.query("select action from audit_events where workspace_id = $1 order by occurred_at, created_at, id", [workspaceId]);
  const versions = await pool.query("select version, status from guidance_cards where workspace_id = $1 order by version", [workspaceId]);
  const invalidations = await pool.query(`select component_type, component_ref, component_version, reason_code
    from effective_campaign_context_invalidations where workspace_id = $1 order by observed_at, created_at, id`, [workspaceId]);
  if (audit.rowCount !== 4 || versions.rowCount !== 4 || invalidations.rowCount !== 2
    || invalidations.rows[0]?.reason_code !== "source_changed" || invalidations.rows[1]?.reason_code !== "source_removed"
    || result.item.status !== "archived" || result.contextInvalidated !== true) throw new Error("audit/version/invalidation acceptance failed");
  process.stdout.write(JSON.stringify({ ok: true, categoryCatalog: initial.categories.length, revisions: versions.rowCount,
    auditEvents: audit.rowCount, contextInvalidations: invalidations.rowCount,
    finalStatus: result.item.status, canWriteMeta: result.authority.canWriteMeta }) + "\n");
} finally {
  await pool.query("delete from audit_events where workspace_id = $1", [workspaceId]).catch(() => undefined);
  await pool.query("delete from memberships where workspace_id = $1", [workspaceId]).catch(() => undefined);
  await pool.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
  await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
  await pool.end();
}
