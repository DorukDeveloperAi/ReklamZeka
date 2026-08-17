import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL or DIRECT_DATABASE_URL is required");
const client = new pg.Client({ connectionString });
const fail = (message: string): never => { throw new Error(`slice registry verifier: ${message}`); };
async function rejected(label: string, run: () => Promise<unknown>) {
  await client.query("savepoint expected_failure");
  try { await run(); fail(`${label} unexpectedly succeeded`); }
  catch (error) { if ((error as Error).message.includes("unexpectedly succeeded")) throw error; }
  finally { await client.query("rollback to savepoint expected_failure"); await client.query("release savepoint expected_failure"); }
}

await client.connect();
try {
  await client.query("begin");
  const workspace = randomUUID(), otherWorkspace = randomUUID(), user = randomUUID(), otherUser = randomUUID();
  const marketDimension = randomUUID(), yerli = randomUUID(), yabanci = randomUUID(), slice = randomUUID(), revision = randomUUID();
  await client.query("insert into users (id, email) values ($1,$2),($3,$4)", [user, `slice-${user}@invalid.local`, otherUser, `slice-${otherUser}@invalid.local`]);
  await client.query("insert into workspaces (id, name) values ($1,$2),($3,$4)", [workspace, "slice verifier", otherWorkspace, "slice verifier other"]);
  await client.query("insert into memberships (workspace_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')", [workspace, user, otherWorkspace, otherUser]);
  await client.query("insert into category_dimensions (id,workspace_id,key,name,cardinality,allowed_entity_levels) values ($1,$2,'market','Market','single',array['campaign']::category_entity_level[])", [marketDimension, workspace]);
  await client.query("insert into category_definitions (id,workspace_id,dimension_id,key,label) values ($1,$2,$3,'yerli','Yerli'),($4,$2,$3,'yabanci','Yabancı')", [yerli, workspace, marketDimension, yabanci]);
  await client.query("insert into slices (id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values ($1,$2,'slice_verify','Verifier',$3,$4)", [slice, workspace, yerli, user]);
  await rejected("cross tenant revision", () => client.query("insert into slice_revisions (workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values ($1,$2,'slice_verify',1,'slice_revision_verify',repeat('a',64),$3,'draft',$4)", [otherWorkspace, slice, yerli, otherUser]));
  await client.query("insert into slice_revisions (id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values ($1,$2,$3,'slice_verify',1,'slice_revision_verify',repeat('a',64),$4,'draft',$5)", [revision, workspace, slice, yerli, user]);
  await rejected("market predicate", () => client.query("insert into slice_revision_predicates (workspace_id,slice_revision_id,dimension_id,position) values ($1,$2,$3,1)", [workspace, revision, marketDimension]));
  await rejected("append-only mutation", () => client.query("update slices set label='mutated' where id=$1", [slice]));
  const tables = await client.query("select relname from pg_class where relname in ('slices','slice_revisions','slice_revision_predicates','slice_revision_predicate_values','slice_revision_overrides','slice_resolution_snapshots','slice_resolution_snapshot_members') and relrowsecurity and relforcerowsecurity");
  if (tables.rowCount !== 7) fail("RLS/FORCE missing");
  await client.query("rollback");
  const residue = await client.query("select count(*)::int as count from slices where workspace_id=$1", [workspace]);
  if (residue.rows[0]?.count !== 0) fail("outer rollback left residue");
  console.log("slice registry postgres verification passed (outer rollback; zero residue)");
} catch (error) {
  try { await client.query("rollback"); } catch { /* best effort */ }
  throw error;
} finally { await client.end(); }
