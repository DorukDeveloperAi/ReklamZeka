import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { createPrimaryResultBindingRevision, primaryResultSelector } from "@/domain/operations/primary-result";
import { DrizzlePrimaryResultActionCatalogAdapter } from "@/connectors/operations/primary-result-action-catalog-drizzle-adapter";
import { DrizzlePrimaryResultBindingLifecycleRepository, PrimaryResultBindingRepositoryError } from "@/connectors/operations/primary-result-binding-lifecycle-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("postgres_connection_not_configured");
const migration = readFileSync("drizzle/20260817162000_primary_result_binding_lifecycle.sql", "utf8");
const migrationHash = createHash("sha256").update(migration).digest("hex");
const rows = (result: unknown): readonly Record<string, unknown>[] => result && typeof result === "object" && "rows" in result && Array.isArray(result.rows) ? result.rows as readonly Record<string, unknown>[] : [];
const reject = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch (error) { return error instanceof PrimaryResultBindingRepositoryError && ["conflict", "forbidden", "not_found", "invalid_input"].includes(error.code); } };
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const writerA = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const writerB = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const workspaceId = randomUUID(), foreignWorkspaceId = randomUUID(), dimensionId = randomUUID(), marketId = randomUUID(), foreignMarketId = randomUUID(), organizationCampaignId = randomUUID(), sliceId = randomUUID(), connectionId = randomUUID(), sourceId = randomUUID(), accountId = randomUUID(), insightId = randomUUID();
let ownerId = "", primaryPostUsersBefore = -1;
let fixtureCommitted = false;
let cleanupPrimary = false, cleanupForeign = false;
const evidence: Record<string, boolean> = {
  appliedTables: false, ledgerHash: false, bound: false, idempotent: false, twoClientOcc: false, unbound: false,
  forgedRoleRejected: false, crossTenantRejected: false, crossMarketRejected: false, appendOnly: false, headGuard: false,
  rlsForce: false, noPolicies: false, revoked: false, requiredIndexes: false, uniqueConstraints: false,
  tombstoneWriteRejected: false, tombstoneReadEmpty: false, cleanupZeroResidue: false, globalUserDeltaZero: false,
};

async function cleanup(workspace: string): Promise<boolean> {
  const purge = new DrizzleWorkspaceTombstonePurgePort();
  const tombstones = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge), { authorize: async (input) => input.approvalRef === "primary-result-post-fixture-approved" }, ownerId, 60_000);
  const plan = await tombstones.dryRun(workspace, new Date().toISOString());
  await tombstones.execute({ planRef: plan.planRef, approvalRef: "primary-result-post-fixture-approved", now: new Date().toISOString() });
  const candidateCount = (await purge.inspect(database as never, workspace)).candidateCount;
  const residual = rows(await database.execute(sql`select (select count(*)::int from primary_result_binding_heads where workspace_id=${workspace}::uuid) + (select count(*)::int from primary_result_binding_revisions where workspace_id=${workspace}::uuid) as n, (select count(*)::int from workspaces where id=${workspace}::uuid and lifecycle_state='active') as active`))[0];
  return candidateCount === 0 && Number(residual?.n) === 0 && Number(residual?.active) === 0;
}

try {
  const applied = rows(await database.execute(sql`select to_regclass('public.primary_result_binding_revisions')::text revisions, to_regclass('public.primary_result_binding_heads')::text heads, (select count(*)::int from drizzle.__drizzle_migrations where hash=${migrationHash}) ledger_count`))[0];
  evidence.appliedTables = Boolean(applied?.revisions && applied?.heads);
  evidence.ledgerHash = Number(applied?.ledger_count) === 1;
  if (!evidence.appliedTables || !evidence.ledgerHash) throw new Error(`primary_result_binding_migration_not_applied_or_hash_mismatch:${JSON.stringify(applied)}`);
  const owner = rows(await database.execute(sql`select id::text id from users where email='local-owner@reklamzeka.invalid' limit 2`));
  if (owner.length !== 1 || typeof owner[0]?.id !== "string") throw new Error("local_owner_fixture_missing_or_ambiguous");
  ownerId = owner[0].id;
  primaryPostUsersBefore = Number(rows(await database.execute(sql`select count(*)::int n from users where email like 'primary-post-%@invalid.local'`))[0]?.n);
  await database.transaction(async (tx) => {
    await tx.execute(sql`insert into workspaces(id,name) values(${workspaceId}::uuid,'Primary post verifier'),(${foreignWorkspaceId}::uuid,'Primary post verifier foreign')`);
    await tx.execute(sql`insert into memberships(workspace_id,user_id,role) values(${workspaceId}::uuid,${ownerId}::uuid,'owner'),(${foreignWorkspaceId}::uuid,${ownerId}::uuid,'owner')`);
    await tx.execute(sql`insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values(${dimensionId}::uuid,${workspaceId}::uuid,'market','Market','single',array['campaign']::category_entity_level[])`);
    await tx.execute(sql`insert into category_definitions(id,workspace_id,dimension_id,key,label) values(${marketId}::uuid,${workspaceId}::uuid,${dimensionId}::uuid,'yerli','Yerli'),(${foreignMarketId}::uuid,${workspaceId}::uuid,${dimensionId}::uuid,'yabanci','Yabancı')`);
    await tx.execute(sql`insert into organization_campaigns(id,workspace_id,label,market_definition_id,created_by_actor_id) values(${organizationCampaignId}::uuid,${workspaceId}::uuid,'Post doğrulama',${marketId}::uuid,${ownerId}::uuid)`);
    await tx.execute(sql`insert into slices(id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values(${sliceId}::uuid,${workspaceId}::uuid,'slice_primary_post','Post Scope',${marketId}::uuid,${ownerId}::uuid)`);
    await tx.execute(sql`insert into meta_connections(id,workspace_id,external_connection_key,display_name,graph_api_version,field_catalog_version) values(${connectionId}::uuid,${workspaceId}::uuid,'primary-post','Primary post','v23.0','verify')`);
    await tx.execute(sql`insert into data_sources(id,workspace_id,meta_connection_id,platform,external_account_id,display_name) values(${sourceId}::uuid,${workspaceId}::uuid,${connectionId}::uuid,'meta_ads','primary-post-account','Primary post account')`);
    await tx.execute(sql`insert into ad_accounts(id,workspace_id,data_source_id,external_account_id,name,currency,timezone) values(${accountId}::uuid,${workspaceId}::uuid,${sourceId}::uuid,'primary-post-account','Primary post account','TRY','Europe/Istanbul')`);
    await tx.execute(sql`insert into meta_daily_insights(id,workspace_id,meta_connection_id,ad_account_id,entity_level,external_entity_id,date_start,date_stop,attribution_label,currency,timezone,source_revision,source_payload_hash,first_seen_at,last_seen_at) values(${insightId}::uuid,${workspaceId}::uuid,${connectionId}::uuid,${accountId}::uuid,'campaign','primary-post-campaign','2026-08-16','2026-08-16','7d_click','TRY','Europe/Istanbul','verify',repeat('a',64),now(),now())`);
    await tx.execute(sql`insert into meta_daily_insight_metrics(daily_insight_id,metric_key,action_type,aggregation,value_decimal,currency,provenance,availability,source_revision,source_payload_hash,first_seen_at,last_seen_at) values(${insightId}::uuid,'actions','lead','additive',1,'TRY','{}'::jsonb,'{}'::jsonb,'verify',repeat('b',64),now(),now())`);
  });
  fixtureCommitted = true;
  const catalogRecord = await new DrizzlePrimaryResultActionCatalogAdapter(database as never).load(workspaceId);
  if (!catalogRecord) throw new Error("catalog_fixture_unavailable");
  const repository = new DrizzlePrimaryResultBindingLifecycleRepository(database as never);
  const bound = createPrimaryResultBindingRevision({ bindingId: randomUUID(), workspaceId, target: { kind: "organization_campaign", organizationCampaignId }, state: "bound", selector: primaryResultSelector("lead", catalogRecord.catalog), actionCatalog: catalogRecord.catalog, createdAt: "2026-08-17T14:00:00.000Z" });
  const first = await repository.persist({ workspaceId, actorId: ownerId, actorRole: "owner", expectedHeadVersion: 0, expectedRevisionHash: null, revision: bound, actionCatalog: catalogRecord.catalog });
  const replay = await repository.persist({ workspaceId, actorId: ownerId, actorRole: "owner", expectedHeadVersion: 0, expectedRevisionHash: null, revision: bound, actionCatalog: catalogRecord.catalog });
  evidence.bound = first.version === 1;
  evidence.idempotent = replay.version === 1 && replay.latestRevision.revisionHash === bound.revisionHash;
  const concurrentA = createPrimaryResultBindingRevision({ bindingId: bound.bindingId, workspaceId, target: bound.target, state: "bound", selector: bound.selector!, actionCatalog: catalogRecord.catalog, previousRevisionHash: bound.revisionHash, createdAt: "2026-08-17T14:01:00.000Z" });
  const concurrentB = createPrimaryResultBindingRevision({ bindingId: bound.bindingId, workspaceId, target: bound.target, state: "bound", selector: bound.selector!, actionCatalog: catalogRecord.catalog, previousRevisionHash: bound.revisionHash, createdAt: "2026-08-17T14:02:00.000Z" });
  const [raceA, raceB] = await Promise.allSettled([new DrizzlePrimaryResultBindingLifecycleRepository(drizzle(writerA, { schema }) as never).persist({ workspaceId, actorId: ownerId, actorRole: "owner", expectedHeadVersion: 1, expectedRevisionHash: bound.revisionHash, revision: concurrentA, actionCatalog: catalogRecord.catalog }), new DrizzlePrimaryResultBindingLifecycleRepository(drizzle(writerB, { schema }) as never).persist({ workspaceId, actorId: ownerId, actorRole: "owner", expectedHeadVersion: 1, expectedRevisionHash: bound.revisionHash, revision: concurrentB, actionCatalog: catalogRecord.catalog })]);
  const winners = [raceA, raceB].filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof repository.persist>>> => result.status === "fulfilled");
  const conflicts = [raceA, raceB].filter((result) => result.status === "rejected" && result.reason instanceof PrimaryResultBindingRepositoryError && result.reason.code === "conflict");
  evidence.twoClientOcc = winners.length === 1 && conflicts.length === 1 && winners[0]!.value.version === 2;
  if (!evidence.twoClientOcc) throw new Error(`two_client_occ_failed:${JSON.stringify([raceA, raceB])}`);
  const winner = winners[0]!.value.latestRevision;
  const unbound = createPrimaryResultBindingRevision({ bindingId: bound.bindingId, workspaceId, target: bound.target, state: "unbound", previousRevisionHash: winner.revisionHash, createdAt: "2026-08-17T14:03:00.000Z" });
  const unboundHead = await repository.persist({ workspaceId, actorId: ownerId, actorRole: "owner", expectedHeadVersion: 2, expectedRevisionHash: winner.revisionHash, revision: unbound, actionCatalog: null });
  const unboundReplay = await repository.persist({ workspaceId, actorId: ownerId, actorRole: "owner", expectedHeadVersion: 2, expectedRevisionHash: winner.revisionHash, revision: unbound, actionCatalog: null });
  evidence.unbound = unboundHead.version === 3 && unboundReplay.version === 3;
  await database.execute(sql`update memberships set role='analyst' where workspace_id=${workspaceId}::uuid and user_id=${ownerId}::uuid`);
  try { evidence.forgedRoleRejected = await reject(() => repository.persist({ workspaceId, actorId: ownerId, actorRole: "owner", expectedHeadVersion: 3, expectedRevisionHash: unbound.revisionHash, revision: unbound, actionCatalog: null })); }
  finally { await database.execute(sql`update memberships set role='owner' where workspace_id=${workspaceId}::uuid and user_id=${ownerId}::uuid`); }
  const directReject = async (statement: ReturnType<typeof sql>) => { try { await database.execute(statement); return false; } catch { return true; } };
  evidence.appendOnly = await directReject(sql`update primary_result_binding_revisions set state='bound' where workspace_id=${workspaceId}::uuid`);
  evidence.headGuard = await directReject(sql`update primary_result_binding_heads set version=99 where workspace_id=${workspaceId}::uuid`) && await directReject(sql`delete from primary_result_binding_heads where workspace_id=${workspaceId}::uuid`);
  evidence.crossTenantRejected = await directReject(sql`insert into primary_result_binding_revisions(workspace_id,binding_id,subject_kind,organization_campaign_id,market_definition_id,revision_number,revision_hash,state,created_by_actor_id,created_at) values(${foreignWorkspaceId}::uuid,${randomUUID()}::uuid,'organization_campaign',${organizationCampaignId}::uuid,${marketId}::uuid,1,repeat('c',64),'unbound',${ownerId}::uuid,now())`);
  evidence.crossMarketRejected = await directReject(sql`insert into primary_result_binding_revisions(workspace_id,binding_id,subject_kind,organization_campaign_id,market_definition_id,revision_number,revision_hash,state,created_by_actor_id,created_at) values(${workspaceId}::uuid,${randomUUID()}::uuid,'organization_campaign',${organizationCampaignId}::uuid,${foreignMarketId}::uuid,1,repeat('d',64),'unbound',${ownerId}::uuid,now())`);
  const security = rows(await database.execute(sql`select count(*) filter(where relrowsecurity and relforcerowsecurity)::int force_count, (select count(*)::int from pg_policies where schemaname='public' and tablename in ('primary_result_binding_revisions','primary_result_binding_heads')) policy_count, (select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name in ('primary_result_binding_revisions','primary_result_binding_heads') and grantee=any(array['PUBLIC','anon','authenticated','service_role'])) grant_count from pg_class where oid=any(array['public.primary_result_binding_revisions'::regclass,'public.primary_result_binding_heads'::regclass])`))[0];
  evidence.rlsForce = Number(security?.force_count) === 2; evidence.noPolicies = Number(security?.policy_count) === 0; evidence.revoked = Number(security?.grant_count) === 0;
  const indexNames = ["primary_result_binding_revisions_workspace_org_market_fk_idx","primary_result_binding_revisions_workspace_slice_market_fk_idx","primary_result_binding_revisions_workspace_market_fk_idx","primary_result_binding_heads_workspace_org_market_fk_idx","primary_result_binding_heads_workspace_slice_market_fk_idx","primary_result_binding_heads_workspace_market_fk_idx"];
  const constraintNames = ["primary_result_binding_revisions_subject_number_uq","primary_result_binding_revisions_workspace_subject_row_unique","primary_result_binding_heads_workspace_subject_unique"];
  const indexRows = rows(await database.execute(sql`select indexname from pg_indexes where schemaname='public' and tablename in ('primary_result_binding_revisions','primary_result_binding_heads')`)).map((row) => String(row.indexname));
  const constraintRows = rows(await database.execute(sql`select conname from pg_constraint where conname in ('primary_result_binding_revisions_subject_number_uq','primary_result_binding_revisions_workspace_subject_row_unique','primary_result_binding_heads_workspace_subject_unique') and contype='u'`)).map((row) => String(row.conname));
  evidence.requiredIndexes = indexNames.every((name) => indexRows.includes(name)); evidence.uniqueConstraints = constraintNames.every((name) => constraintRows.includes(name));
} finally {
  await writerA.end(); await writerB.end();
  if (fixtureCommitted) {
    cleanupPrimary = await cleanup(workspaceId);
    cleanupForeign = await cleanup(foreignWorkspaceId);
    const tombstonedRepository = new DrizzlePrimaryResultBindingLifecycleRepository(database as never);
    evidence.tombstoneReadEmpty = (await tombstonedRepository.current(workspaceId, [{ kind: "organization_campaign", organizationCampaignId }])).size === 0;
    const tombstonedWrite = createPrimaryResultBindingRevision({ bindingId: randomUUID(), workspaceId, target: { kind: "organization_campaign", organizationCampaignId }, state: "unbound", createdAt: "2026-08-17T14:04:00.000Z" });
    evidence.tombstoneWriteRejected = await reject(() => tombstonedRepository.persist({ workspaceId, actorId: ownerId, actorRole: "owner", expectedHeadVersion: 0, expectedRevisionHash: null, revision: tombstonedWrite, actionCatalog: null }));
    const after = rows(await database.execute(sql`select (select count(*)::int from primary_result_binding_heads where workspace_id=${workspaceId}::uuid) + (select count(*)::int from primary_result_binding_revisions where workspace_id=${workspaceId}::uuid) + (select count(*)::int from primary_result_binding_heads where workspace_id=${foreignWorkspaceId}::uuid) + (select count(*)::int from primary_result_binding_revisions where workspace_id=${foreignWorkspaceId}::uuid) as n`))[0];
    evidence.cleanupZeroResidue = cleanupPrimary && cleanupForeign && Number(after?.n) === 0;
    const primaryPostUsersAfter = Number(rows(await database.execute(sql`select count(*)::int n from users where email like 'primary-post-%@invalid.local'`))[0]?.n);
    evidence.globalUserDeltaZero = primaryPostUsersBefore >= 0 && primaryPostUsersAfter === primaryPostUsersBefore;
  }
  await pool.end();
}
if (!Object.values(evidence).every(Boolean)) throw new Error(`primary_result_binding_post_failed:${JSON.stringify({ ...evidence, fixtureCommitted, cleanupPrimary, cleanupForeign })}`);
console.log(JSON.stringify({ ok: true, mode: "post_applied_two_client", ...evidence }));
