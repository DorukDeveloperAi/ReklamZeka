import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { DrizzleScopeReportSavedRepository } from "../src/connectors/slices/scope-report-saved-drizzle-repository";
const file = "drizzle/20260818000800_scope_report_saved_reports.sql",
  url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
const sqlText = await readFile(file, "utf8"),
  sha = createHash("sha256").update(sqlText).digest("hex"),
  pool = new Pool({ connectionString: url, max: 1 }),
  client = await pool.connect();
const flags: Record<string, boolean> = {};
const id = () => randomUUID();
async function rejected(work: () => Promise<unknown>) {
  const save = `s_${Math.random().toString(16).slice(2)}`;
  await client.query(`savepoint ${save}`);
  try {
    await work();
    await client.query(`rollback to savepoint ${save}`);
    return false;
  } catch {
    await client.query(`rollback to savepoint ${save}`);
    return true;
  }
}
try {
  await client.query("begin isolation level serializable");
  await client.query(sqlText);
  flags.migrationInstalled = true;
  const user = id(),
    ws = id(),
    dimension = id(),
    market = id(),
    slice = id(),
    revision = id();
  await client.query("set local session_replication_role=replica");
  await client.query("insert into users(id,email) values($1,$2)", [
    user,
    `${user}@invalid.local`,
  ]);
  await client.query(
    "insert into workspaces(id,name,lifecycle_state) values($1,'saved report verifier','active')",
    [ws],
  );
  await client.query(
    "insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')",
    [ws, user],
  );
  await client.query(
    "insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values($1,$2,'market','Market','single',array['campaign','ad_set']::category_entity_level[])",
    [dimension, ws],
  );
  await client.query(
    "insert into category_definitions(id,workspace_id,dimension_id,key,label) values($1,$2,$3,'yerli','Yerli')",
    [market, ws, dimension],
  );
  await client.query(
    "insert into slices(id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id,current_published_revision_id) values($1,$2,'slice_saved_verify','Saved',$3,$4,$5)",
    [slice, ws, market, user, revision],
  );
  await client.query(
    "insert into slice_revisions(id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values($1,$2,$3,'slice_saved_verify',1,'slice_revision_saved_verify',repeat('a',64),$4,'published',$5)",
    [revision, ws, slice, market, user],
  );
  await client.query("set local session_replication_role=origin");
  const base = drizzle(client, { schema });
  const dialect = new PgDialect();
  const transactionControls = new Set<string>();
  const tx = new Proxy(base, {
    get(target, property, receiver) {
      if (property !== "execute")
        return Reflect.get(target, property, receiver);
      return async (statement: Parameters<typeof base.execute>[0]) => {
        const rendered = dialect
          .sqlToQuery(statement as Parameters<PgDialect["sqlToQuery"]>[0])
          .sql.replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (
          rendered === "set local transaction isolation level serializable" ||
          rendered ===
            "set local transaction isolation level repeatable read" ||
          rendered === "set local transaction read only"
        ) {
          transactionControls.add(rendered);
          return { rows: [] };
        }
        return base.execute(statement);
      };
    },
  });
  const database = {
    transaction: async (work: (transaction: typeof base) => Promise<unknown>) =>
      work(tx as typeof base),
  };
  const repository = new DrizzleScopeReportSavedRepository(database as never);
  const query = {
    slice: "slice_saved_verify",
    start: "2026-08-01",
    end: "2026-08-18",
    granularity: "week" as const,
    level: "ad_set" as const,
    metric: null,
    action: "lead",
    sort: "entity" as const,
    direction: "desc" as const,
  };
  const command = `scope_report_save_${"b".repeat(64)}`;
  const first = await repository.save({
    workspaceId: ws,
    actorId: user,
    commandRef: command,
    reportRef: null,
    expectedVersion: null,
    label: "Haftalık lead",
    query,
    state: "active",
  });
  flags.created = first.revision.revisionNumber === 1 && !first.replay;
  const replay = await repository.save({
    workspaceId: ws,
    actorId: user,
    commandRef: command,
    reportRef: null,
    expectedVersion: null,
    label: "Haftalık lead",
    query,
    state: "active",
  });
  flags.exactReplay =
    replay.replay &&
    replay.revision.revisionHash === first.revision.revisionHash;
  flags.replayExpectedVersionBound = await rejected(() =>
    repository.save({
      workspaceId: ws,
      actorId: user,
      commandRef: command,
      reportRef: first.revision.reportRef,
      expectedVersion: 99,
      label: "Haftalık lead",
      query,
      state: "active",
    }),
  );
  const second = await repository.save({
    workspaceId: ws,
    actorId: user,
    commandRef: `scope_report_save_${"c".repeat(64)}`,
    reportRef: first.revision.reportRef,
    expectedVersion: 1,
    label: "Haftalık lead arşiv",
    query,
    state: "archived",
  });
  flags.occAdvance =
    second.revision.revisionNumber === 2 &&
    second.revision.previousRevisionHash === first.revision.revisionHash;
  flags.staleRejected = await rejected(() =>
    repository.save({
      workspaceId: ws,
      actorId: user,
      commandRef: `scope_report_save_${"d".repeat(64)}`,
      reportRef: first.revision.reportRef,
      expectedVersion: 1,
      label: "stale",
      query,
      state: "active",
    }),
  );
  flags.hashTamperRejected = await rejected(() =>
    client.query(
      "insert into scope_report_saved_revisions(workspace_id,binding_id,report_ref,command_ref,revision_number,previous_revision_hash,revision_hash,state,label,slice_ref,query_payload,created_by_actor_id,created_at) select workspace_id,binding_id,report_ref,$2,3,revision_hash,repeat('f',64),'active','tamper',slice_ref,query_payload,created_by_actor_id,date_trunc('milliseconds',transaction_timestamp()) from scope_report_saved_revisions where workspace_id=$1 and revision_number=2",
      [ws, `scope_report_save_${"e".repeat(64)}`],
    ),
  );
  flags.jsonTypeForgeryRejected = await rejected(() =>
    client.query(
      "with s as (select *,query_payload||jsonb_build_object('granularity',null) q from scope_report_saved_revisions where workspace_id=$1 and revision_number=2),h as (select *,guide_run_sha256(jsonb_build_object('version','saved-scope-report/1.0.0','workspaceId',workspace_id::text,'reportRef',report_ref,'commandRef',$2::text,'revisionNumber',3,'previousRevisionHash',revision_hash,'state','active','label','type forgery','query',q,'createdByActorId',created_by_actor_id::text)) expected from s) insert into scope_report_saved_revisions(workspace_id,binding_id,report_ref,command_ref,revision_number,previous_revision_hash,revision_hash,state,label,slice_ref,query_payload,created_by_actor_id,created_at) select workspace_id,binding_id,report_ref,$2,3,revision_hash,expected,'active','type forgery',slice_ref,q,created_by_actor_id,date_trunc('milliseconds',transaction_timestamp()) from h",
      [ws, `scope_report_save_${"f".repeat(64)}`],
    ),
  );
  flags.headTimestampForgeryRejected = await rejected(() =>
    client.query(
      "with s as (select *,query_payload q from scope_report_saved_revisions where workspace_id=$1 and revision_number=2),h as (select *,guide_run_sha256(jsonb_build_object('version','saved-scope-report/1.0.0','workspaceId',workspace_id::text,'reportRef',report_ref,'commandRef',$2::text,'revisionNumber',3,'previousRevisionHash',revision_hash,'state','active','label','timestamp forgery','query',q,'createdByActorId',created_by_actor_id::text)) expected from s),ins as (insert into scope_report_saved_revisions(workspace_id,binding_id,report_ref,command_ref,revision_number,previous_revision_hash,revision_hash,state,label,slice_ref,query_payload,created_by_actor_id,created_at) select workspace_id,binding_id,report_ref,$2,3,revision_hash,expected,'active','timestamp forgery',slice_ref,q,created_by_actor_id,date_trunc('milliseconds',transaction_timestamp()) from h returning id,workspace_id,binding_id,report_ref) update scope_report_saved_heads sh set latest_revision_id=ins.id,version=3,updated_at='2000-01-01T00:00:00.000Z' from ins where sh.workspace_id=ins.workspace_id and sh.binding_id=ins.binding_id and sh.report_ref=ins.report_ref",
      [ws, `scope_report_save_${"1".repeat(64)}`],
    ),
  );
  flags.appendOnly = await rejected(() =>
    client.query(
      "update scope_report_saved_revisions set label='tamper' where workspace_id=$1",
      [ws],
    ),
  );
  const listed = await repository.list(ws);
  flags.listCurrent =
    listed.length === 1 &&
    listed[0]?.state === "archived" &&
    listed[0]?.revisionNumber === 2;
  const isolation = await client.query("show transaction_isolation");
  flags.transactionContracts =
    isolation.rows[0]?.transaction_isolation === "serializable" &&
    transactionControls.has(
      "set local transaction isolation level serializable",
    ) &&
    transactionControls.has(
      "set local transaction isolation level repeatable read",
    ) &&
    transactionControls.has("set local transaction read only");
  await client.query("set constraints all immediate");
  const catalog = await client.query(
    "select count(*)::int tables,(select count(*)::int from pg_class c where c.relname in('scope_report_saved_revisions','scope_report_saved_heads') and c.relrowsecurity and c.relforcerowsecurity) rls,(select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name in('scope_report_saved_revisions','scope_report_saved_heads') and grantee in('PUBLIC','anon','authenticated','service_role')) grants,(select count(*)::int from pg_indexes where schemaname='public' and tablename in('scope_report_saved_revisions','scope_report_saved_heads')) indexes,(select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname in('scope_report_saved_revisions','scope_report_saved_heads') and not t.tgisinternal and t.tgenabled='O') triggers,(select count(*)::int from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relname in('scope_report_saved_revisions','scope_report_saved_heads') and k.convalidated) constraints from pg_class where relname in('scope_report_saved_revisions','scope_report_saved_heads')",
  );
  const c = catalog.rows[0];
  flags.catalog =
    c.tables === 2 &&
    c.rls === 2 &&
    c.grants === 0 &&
    c.indexes === 13 &&
    c.triggers === 3 &&
    c.constraints === 10;
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: Array<{ tag: string }> };
  const ledger = await client.query(
    "select count(*)::int count from drizzle.__drizzle_migrations where hash=$1",
    [sha],
  );
  flags.unjournaled =
    !journal.entries.some(
      (e) => e.tag === "20260818000800_scope_report_saved_reports",
    ) && ledger.rows[0]?.count === 0;
  await client.query("rollback");
  const gone = await client.query(
    "select to_regclass('public.scope_report_saved_revisions') revisions,to_regclass('public.scope_report_saved_heads') heads",
  );
  flags.zeroResidue =
    gone.rows[0]?.revisions === null && gone.rows[0]?.heads === null;
  if (Object.values(flags).some((value) => value !== true))
    throw new Error(JSON.stringify(flags));
  console.log(
    JSON.stringify({ mode: "pre_outer_rollback", sha256: sha, ...flags }),
  );
} catch (error) {
  try {
    await client.query("rollback");
  } catch {}
  throw error;
} finally {
  client.release();
  await pool.end();
}
