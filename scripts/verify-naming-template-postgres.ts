import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { DrizzleNamingTemplateRepository } from "../src/connectors/campaigns/naming-template-drizzle-repository";
import { DrizzleNamingTemplateReplayEvidenceRepository } from "../src/connectors/campaigns/naming-template-replay-evidence-drizzle-repository";
import { metaPublicReference } from "../src/domain/meta/public-reference";

const file = "drizzle/20260818000900_naming_template_lifecycle.sql";
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
const sqlText = await readFile(file, "utf8");
const sha = createHash("sha256").update(sqlText).digest("hex");
const postMode = process.env.NAMING_TEMPLATE_POST_APPROVED === "true";
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
const flags: Record<string, boolean> = {};
const id = () => randomUUID();
async function rejected(work: () => Promise<unknown>) {
  const save = `s_${Math.random().toString(16).slice(2)}`;
  await client.query(`savepoint ${save}`);
  try { await work(); await client.query(`rollback to savepoint ${save}`); return false; }
  catch { await client.query(`rollback to savepoint ${save}`); return true; }
}

try {
  const before=await client.query("select (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname in('naming_template_revisions','naming_template_heads')) tables,(select count(*)::int from drizzle.__drizzle_migrations where hash=$1 and created_at=1787011740000) ledger",[sha]);
  if(before.rows[0]?.tables!==(postMode?2:0)||before.rows[0]?.ledger!==(postMode?1:0)) throw new Error("naming template migration state exact değil");
  await client.query("begin isolation level serializable");
  if(!postMode) await client.query(sqlText);
  flags.migrationInstalled = true;
  const user = id(), ws = id(), source = id(), account = id(), campaign=id(), adSet=id();
  await client.query("set local session_replication_role=replica");
  await client.query("insert into users(id,email) values($1,$2)", [user, `${user}@invalid.local`]);
  await client.query("insert into workspaces(id,name,lifecycle_state) values($1,'naming verifier','active')", [ws]);
  await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')", [ws,user]);
  await client.query("insert into data_sources(id,workspace_id,platform,external_account_id,display_name) values($1,$2,'meta_ads','ext-account','Verifier')", [source,ws]);
  await client.query("insert into ad_accounts(id,workspace_id,data_source_id,external_account_id,name,currency,timezone) values($1,$2,$3,'ext-account','Verifier','TRY','Europe/Istanbul')", [account,ws,source]);
  await client.query("insert into ad_campaigns(id,workspace_id,ad_account_id,external_campaign_id,name,canonical_objective,raw_payload_hash) values($1,$2,$3,'campaign-ext','Summer Launch','sales',repeat('a',64))",[campaign,ws,account]);
  await client.query("insert into meta_ad_sets(id,workspace_id,ad_account_id,campaign_id,external_ad_set_id,name,optimization_goal,raw_payload_hash,source_graph_version,field_catalog_version,provenance) values($1,$2,$3,$4,'adset-ext','Retarget Audience','offsite_conversions',repeat('b',64),'v23.0','fixture','{}'::jsonb)",[adSet,ws,account,campaign]);
  await client.query("set local session_replication_role=origin");
  const base = drizzle(client,{schema});
  const dialect = new PgDialect();
  const controls = new Set<string>();
  const tx = new Proxy(base,{get(target,property,receiver){
    if(property!=="execute") return Reflect.get(target,property,receiver);
    return async(statement:Parameters<typeof base.execute>[0])=>{
      const rendered=dialect.sqlToQuery(statement as Parameters<PgDialect["sqlToQuery"]>[0]).sql.replace(/\s+/g," ").trim().toLowerCase();
      if(rendered==="set local transaction isolation level serializable"||rendered==="set local transaction isolation level repeatable read"||rendered==="set local transaction read only") { controls.add(rendered); return {rows:[]}; }
      return base.execute(statement);
    };
  }});
  const database={transaction:async(work:(transaction:typeof base)=>Promise<unknown>)=>work(tx as typeof base)};
  const repository=new DrizzleNamingTemplateRepository(database as never);
  const accountRef=metaPublicReference("account",ws,account);
  const shared={workspaceId:ws,actorId:user,accountRef,templateRef:"naming_template_launch",namingFamily:"launch",entityLevel:"ad_set" as const,
    nameRules:[{source:"campaign_name" as const,match:"all" as const,tokens:["Summer","Launch"]},{source:"ad_set_name" as const,match:"any" as const,tokens:["retarget"]}],
    corroboration:[{kind:"objective" as const,operator:"equals" as const,expected:["sales"]},{kind:"geo" as const,operator:"present" as const,expected:[]}],
    proposedAssignments:[{dimensionRef:`dimension_${"a".repeat(24)}`,definitionRef:`category_${"b".repeat(24)}`}],};
  const first=await repository.save({...shared,commandRef:`naming_template_command_${"1".repeat(64)}`,expectedRevision:null,state:"draft"});
  flags.created=!first.replay&&first.revision.revision===1&&first.revision.state==="draft";
  const replay=await repository.save({...shared,commandRef:`naming_template_command_${"1".repeat(64)}`,expectedRevision:null,state:"draft"});
  flags.exactReplay=replay.replay&&replay.revision.revisionHash===first.revision.revisionHash;
  const published=await repository.save({...shared,commandRef:`naming_template_command_${"2".repeat(64)}`,expectedRevision:1,state:"published"});
  flags.occAdvance=published.revision.revision===2&&published.revision.previousRevisionHash===first.revision.revisionHash;
  const evidenceRepository=new DrizzleNamingTemplateReplayEvidenceRepository(database as never);
  const preview=await evidenceRepository.replay({workspaceId:ws,template:published.revision,entityRef:metaPublicReference("ad_set",ws,adSet)});
  flags.canonicalPreviewFailClosed=preview.status==="insufficient_evidence"&&preview.proposals.length===0&&preview.reasonCodes.includes("geo_insufficient");
  flags.staleRejected=await rejected(()=>repository.save({...shared,commandRef:`naming_template_command_${"3".repeat(64)}`,expectedRevision:1,state:"draft"}));
  flags.invalidTransitionRejected=await rejected(()=>repository.save({...shared,commandRef:`naming_template_command_${"4".repeat(64)}`,expectedRevision:2,state:"published"}));
  flags.hashTamperRejected=await rejected(()=>client.query("insert into naming_template_revisions(workspace_id,ad_account_id,template_ref,command_ref,revision,previous_revision_hash,revision_hash,state,naming_family,entity_level,template_payload,created_by_actor_id,created_at) select workspace_id,ad_account_id,template_ref,$2,3,revision_hash,repeat('f',64),'draft',naming_family,entity_level,template_payload,created_by_actor_id,date_trunc('milliseconds',transaction_timestamp()) from naming_template_revisions where workspace_id=$1 and revision=2",[ws,`naming_template_command_${"5".repeat(64)}`]));
  flags.jsonTypeForgeryRejected=await rejected(()=>client.query("with s as (select *,template_payload||jsonb_build_object('revision',3,'previousRevisionHash',revision_hash,'state','draft','authority',jsonb_set(template_payload->'authority','{canPropose}',to_jsonb('true'::text))) p from naming_template_revisions where workspace_id=$1 and revision=2),h as (select *,guide_run_sha256(p-'revisionHash') expected from s) insert into naming_template_revisions(workspace_id,ad_account_id,template_ref,command_ref,revision,previous_revision_hash,revision_hash,state,naming_family,entity_level,template_payload,created_by_actor_id,created_at) select workspace_id,ad_account_id,template_ref,$2,3,revision_hash,expected,'draft',naming_family,entity_level,jsonb_set(p,'{revisionHash}',to_jsonb(expected)),created_by_actor_id,date_trunc('milliseconds',transaction_timestamp()) from h",[ws,`naming_template_command_${"6".repeat(64)}`]));
  flags.nonCanonicalOrderRejected=await rejected(()=>client.query("with s as (select *,template_payload||jsonb_build_object('revision',3,'previousRevisionHash',revision_hash,'state','draft','nameRules',(select jsonb_agg(value order by ord desc) from jsonb_array_elements(template_payload->'nameRules') with ordinality x(value,ord))) p from naming_template_revisions where workspace_id=$1 and revision=2),h as (select *,guide_run_sha256(p-'revisionHash') expected from s) insert into naming_template_revisions(workspace_id,ad_account_id,template_ref,command_ref,revision,previous_revision_hash,revision_hash,state,naming_family,entity_level,template_payload,created_by_actor_id,created_at) select workspace_id,ad_account_id,template_ref,$2,3,revision_hash,expected,'draft',naming_family,entity_level,jsonb_set(p,'{revisionHash}',to_jsonb(expected)),created_by_actor_id,date_trunc('milliseconds',transaction_timestamp()) from h",[ws,`naming_template_command_${"7".repeat(64)}`]));
  flags.nonNormalizedTokenRejected=await rejected(()=>client.query("with s as (select *,jsonb_set(template_payload||jsonb_build_object('revision',3,'previousRevisionHash',revision_hash,'state','draft'),'{nameRules,0,tokens,0}',to_jsonb('Summer'::text)) p from naming_template_revisions where workspace_id=$1 and revision=2),h as (select *,guide_run_sha256(p-'revisionHash') expected from s) insert into naming_template_revisions(workspace_id,ad_account_id,template_ref,command_ref,revision,previous_revision_hash,revision_hash,state,naming_family,entity_level,template_payload,created_by_actor_id,created_at) select workspace_id,ad_account_id,template_ref,$2,3,revision_hash,expected,'draft',naming_family,entity_level,jsonb_set(p,'{revisionHash}',to_jsonb(expected)),created_by_actor_id,date_trunc('milliseconds',transaction_timestamp()) from h",[ws,`naming_template_command_${"8".repeat(64)}`]));
  flags.headTimestampForgeryRejected=await rejected(()=>client.query("with s as (select *,template_payload||jsonb_build_object('revision',3,'previousRevisionHash',revision_hash,'state','draft') p from naming_template_revisions where workspace_id=$1 and revision=2),h as (select *,guide_run_sha256(p-'revisionHash') expected from s),ins as (insert into naming_template_revisions(workspace_id,ad_account_id,template_ref,command_ref,revision,previous_revision_hash,revision_hash,state,naming_family,entity_level,template_payload,created_by_actor_id,created_at) select workspace_id,ad_account_id,template_ref,$2,3,revision_hash,expected,'draft',naming_family,entity_level,jsonb_set(p,'{revisionHash}',to_jsonb(expected)),created_by_actor_id,date_trunc('milliseconds',transaction_timestamp()) from h returning id,workspace_id,ad_account_id,template_ref) update naming_template_heads nh set latest_revision_id=ins.id,version=3,updated_at='2000-01-01T00:00:00.000Z' from ins where nh.workspace_id=ins.workspace_id and nh.ad_account_id=ins.ad_account_id and nh.template_ref=ins.template_ref",[ws,`naming_template_command_${"9".repeat(64)}`]));
  flags.appendOnly=await rejected(()=>client.query("update naming_template_revisions set state='disabled' where workspace_id=$1",[ws]));
  const listed=await repository.list(ws,accountRef);
  flags.listCurrent=listed.length===1&&listed[0]?.state==="published"&&listed[0]?.revision===2;
  flags.transactionContracts=controls.has("set local transaction isolation level serializable")&&controls.has("set local transaction isolation level repeatable read")&&controls.has("set local transaction read only");
  await client.query("set constraints all immediate");
  const catalog=await client.query("select count(*)::int tables,(select count(*)::int from pg_class c where c.relname in('naming_template_revisions','naming_template_heads') and c.relrowsecurity and c.relforcerowsecurity) rls,(select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name in('naming_template_revisions','naming_template_heads') and grantee in('PUBLIC','anon','authenticated','service_role')) grants,(select count(*)::int from pg_indexes where schemaname='public' and tablename in('naming_template_revisions','naming_template_heads')) indexes,(select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname in('naming_template_revisions','naming_template_heads') and not t.tgisinternal and t.tgenabled='O') triggers,(select count(*)::int from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relname in('naming_template_revisions','naming_template_heads') and k.convalidated) constraints from pg_class where relname in('naming_template_revisions','naming_template_heads')");
  const c=catalog.rows[0]; flags.catalog=c.tables===2&&c.rls===2&&c.grants===0&&c.indexes===12&&c.triggers===3&&c.constraints===11;
  const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8")) as {entries:Array<{tag:string}>};
  const ledger=await client.query("select count(*)::int count from drizzle.__drizzle_migrations where hash=$1",[sha]);
  flags.exactMigrationState=postMode
    ? journal.entries.some(e=>e.tag==="20260818000900_naming_template_lifecycle")&&ledger.rows[0]?.count===1
    : !journal.entries.some(e=>e.tag==="20260818000900_naming_template_lifecycle")&&ledger.rows[0]?.count===0;
  await client.query("rollback");
  const gone=await client.query("select to_regclass('public.naming_template_revisions') revisions,to_regclass('public.naming_template_heads') heads");
  flags.zeroResidue=postMode
    ? gone.rows[0]?.revisions==="naming_template_revisions"&&gone.rows[0]?.heads==="naming_template_heads"&&Number((await client.query("select (select count(*) from naming_template_revisions)+(select count(*) from naming_template_heads) count")).rows[0].count)===0
    : gone.rows[0]?.revisions===null&&gone.rows[0]?.heads===null;
  if(Object.values(flags).some(value=>value!==true)) throw new Error(JSON.stringify(flags));
  console.log(JSON.stringify({mode:postMode?"post_applied_outer_rollback":"pre_outer_rollback",sha256:sha,...flags}));
} catch(error){try{await client.query("rollback");}catch{} throw error;}
finally{client.release();await pool.end();}
