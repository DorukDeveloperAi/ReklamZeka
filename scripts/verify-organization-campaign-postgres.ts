import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) { console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured" })); process.exit(2); }

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 5_000 });
try {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const rejects = async (query: string, values: readonly unknown[]) => { await client.query("savepoint expected_error"); try { await client.query(query, [...values]); await client.query("release savepoint expected_error"); return false; } catch { await client.query("rollback to savepoint expected_error"); await client.query("release savepoint expected_error"); return true; } };
    const tables = await client.query("select to_regclass('public.organization_campaigns') org, to_regclass('public.organization_campaign_meta_memberships') links");
    if (!tables.rows[0]?.org || !tables.rows[0]?.links) throw new Error("organization_campaign_migration_not_applied");
    const ws = randomUUID(), foreignWs = randomUUID(), user = randomUUID(), foreignUser = randomUUID();
    const dimension = randomUUID(), yabanci = randomUUID(), yerli = randomUUID(), account = randomUUID(), source = randomUUID();
    const campaign = randomUUID(), missingCampaign = randomUUID(), conflictingCampaign = randomUUID();
    const orgA = randomUUID(), orgB = randomUUID(), orgYerli = randomUUID();
    await client.query("insert into users(id,email) values($1,$2)", [user, `oc-${user}@test.local`]);
    await client.query("insert into users(id,email) values($1,$2)", [foreignUser, `oc-${foreignUser}@test.local`]);
    await client.query("insert into workspaces(id,name) values($1,'oc verifier')", [ws]);
    await client.query("insert into workspaces(id,name) values($1,'oc verifier foreign')", [foreignWs]);
    await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')", [ws,user]);
    await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')", [foreignWs,foreignUser]);
    await client.query("insert into data_sources(id,workspace_id,platform,external_account_id,display_name) values($1,$2,'meta_ads','oc','oc')", [source,ws]);
    await client.query("insert into ad_accounts(id,workspace_id,data_source_id,external_account_id,name,currency,timezone) values($1,$2,$3,'oc','oc','TRY','Europe/Istanbul')", [account,ws,source]);
    await client.query("insert into ad_campaigns(id,workspace_id,ad_account_id,external_campaign_id,name) values($1,$2,$3,'oc','oc'),($4,$2,$3,'oc-missing','oc missing'),($5,$2,$3,'oc-conflict','oc conflict')", [campaign,ws,account,missingCampaign,conflictingCampaign]);
    await client.query("insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values($1,$2,'market','market','single',array['campaign']::category_entity_level[])", [dimension,ws]);
    await client.query("insert into category_definitions(id,workspace_id,dimension_id,key,label) values($1,$2,$3,'yabanci','Yabancı'),($4,$2,$3,'yerli','Yerli')", [yabanci,ws,dimension,yerli]);
    await client.query("insert into category_assignments(workspace_id,dimension_id,definition_id,entity_level,campaign_id,operation,source,evidence,confidence) values($1,$2,$3,'campaign',$4,'add','manual','[{\"kind\":\"mirror\",\"ref\":\"oc\"}]',1)", [ws,dimension,yabanci,campaign]);
    await client.query("insert into category_assignments(workspace_id,dimension_id,definition_id,entity_level,campaign_id,operation,source,evidence,confidence) values($1,$2,$3,'campaign',$4,'add','manual','[{\"kind\":\"mirror\",\"ref\":\"oc-conflict-y\"}]',1),($1,$2,$5,'campaign',$4,'add','manual','[{\"kind\":\"mirror\",\"ref\":\"oc-conflict-d\"}]',1)", [ws,dimension,yabanci,conflictingCampaign,yerli]);
    await client.query("insert into organization_campaigns(id,workspace_id,label,market_definition_id,created_by_actor_id) values($1,$2,'A',$3,$4),($5,$2,'B',$3,$4),($6,$2,'Yerli',$7,$4)", [orgA,ws,yabanci,user,orgB,orgYerli,yerli]);
    const insert = "insert into organization_campaign_meta_memberships(workspace_id,organization_campaign_id,campaign_id,market_definition_id,effective_from,assigned_by_actor_id) values($1,$2,$3,$4,'2026-01-01',$5)";
    await client.query(insert,[ws,orgA,campaign,yabanci,user]);
    const overlap = await rejects(insert,[ws,orgB,campaign,yabanci,user]);
    const missingMarketRejected = await rejects(insert,[ws,orgA,missingCampaign,yabanci,user]);
    const conflictingMarketRejected = await rejects(insert,[ws,orgA,conflictingCampaign,yabanci,user]);
    const crossMarketRejected = await rejects(insert,[ws,orgYerli,campaign,yerli,user]);
    const crossTenantRejected = await rejects(insert,[foreignWs,orgA,campaign,yabanci,foreignUser]);
    const unassignedAtStart = Number((await client.query("select count(*)::int n from ad_campaigns candidate where candidate.workspace_id=$1 and not exists (select 1 from organization_campaign_meta_memberships membership where membership.workspace_id=candidate.workspace_id and membership.campaign_id=candidate.id and membership.effective_from <= '2026-01-15'::timestamptz and (membership.effective_to is null or membership.effective_to > '2026-01-15'::timestamptz))",[ws])).rows[0].n);
    const link = (await client.query("select id from organization_campaign_meta_memberships where workspace_id=$1 and organization_campaign_id=$2",[ws,orgA])).rows[0].id;
    const close = (await client.query("update organization_campaign_meta_memberships set effective_to='2026-02-01' where id=$1 and effective_to is null",[link])).rowCount === 1;
    const secondClose = await rejects("update organization_campaign_meta_memberships set effective_to='2026-03-01' where id=$1",[link]);
    const reassigned = !(await rejects("insert into organization_campaign_meta_memberships(workspace_id,organization_campaign_id,campaign_id,market_definition_id,effective_from,assigned_by_actor_id) values($1,$2,$3,$4,'2026-02-01',$5)",[ws,orgB,campaign,yabanci,user]));
    const security = await client.query(`select count(*) filter (where relrowsecurity and relforcerowsecurity)::int as secured,
      bool_and(not has_table_privilege(role_name, table_name, 'SELECT,INSERT,UPDATE,DELETE')) as dark
      from (values ('organization_campaigns'),('organization_campaign_meta_memberships')) tables(table_name)
      cross join (values ('anon'),('authenticated'),('service_role')) roles(role_name)
      join pg_class on relname=table_name join pg_namespace on pg_namespace.oid=pg_class.relnamespace and nspname='public'`);
    const securityClosed = security.rows[0]?.secured === 6 && security.rows[0]?.dark === true;
    await client.query("rollback");
    const zeroResidue = Number((await client.query("select count(*)::int n from workspaces where id in ($1,$2)",[ws,foreignWs])).rows[0].n) === 0;
    if (!overlap || !missingMarketRejected || !conflictingMarketRejected || !crossMarketRejected || !crossTenantRejected
      || unassignedAtStart !== 2 || !close || !secondClose || !reassigned || !securityClosed || !zeroResidue) {
      throw new Error("organization_campaign_acceptance_assertion_failed");
    }
    console.log(JSON.stringify({ok:true,outerRollback:true,canonicalMarketBound:true,overlapRejected:overlap,
      missingMarketRejected,conflictingMarketRejected,crossMarketRejected,crossTenantRejected,
      virtualUnassignedCount:unassignedAtStart,closeOnce:close,secondCloseRejected:secondClose,reassigned,
      rlsForcedAndDataApiDark:securityClosed,zeroResidue}));
  } finally { client.release(); }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, blocker: /ENOTFOUND|EAI_AGAIN/.test(message) ? "external_dns_unavailable" : "postgres_unavailable", detail: message }));
  process.exitCode = 2;
} finally { await pool.end(); }
