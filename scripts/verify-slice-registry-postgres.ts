import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { SliceRegistryService } from "@/application/slice-registry-service";
import { DrizzleSliceRegistryRepository } from "@/connectors/slices/slice-registry-drizzle-repository";
import { createSliceRevision } from "@/domain/slices/slice-definition";
import { buildFrozenSliceSnapshot, resolveSlice } from "@/domain/slices/slice-resolver";
import { organizationCampaignPublicRef } from "@/domain/campaigns/organization-campaign";

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
  const marketDimension = randomUUID(), yerli = randomUUID(), yabanci = randomUUID(), slice = randomUUID(), revision = randomUUID(), localOrg = randomUUID(), foreignOrg = randomUUID(), snapshot = randomUUID();
  const initial = createSliceRevision({ sliceRef: "slice_verify", revisionRef: "slice_revision_verify", revisionNumber: 1, market: { dimensionId: "dimension_market", valueId: "category_yerli", key: "yerli" }, predicates: [] });
  await client.query("insert into users (id, email) values ($1,$2),($3,$4)", [user, `slice-${user}@invalid.local`, otherUser, `slice-${otherUser}@invalid.local`]);
  await client.query("insert into workspaces (id, name) values ($1,$2),($3,$4)", [workspace, "slice verifier", otherWorkspace, "slice verifier other"]);
  await client.query("insert into memberships (workspace_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')", [workspace, user, otherWorkspace, otherUser]);
  await client.query("insert into category_dimensions (id,workspace_id,key,name,cardinality,allowed_entity_levels) values ($1,$2,'market','Market','single',array['campaign']::category_entity_level[])", [marketDimension, workspace]);
  await client.query("insert into category_definitions (id,workspace_id,dimension_id,key,label) values ($1,$2,$3,'yerli','Yerli'),($4,$2,$3,'yabanci','Yabancı')", [yerli, workspace, marketDimension, yabanci]);
  await client.query("insert into organization_campaigns (id,workspace_id,label,market_definition_id,created_by_actor_id) values ($1,$2,'Yerli hedef',$3,$4),($5,$2,'Yabancı hedef',$6,$4)", [localOrg, workspace, yerli, user, foreignOrg, yabanci]);
  await client.query("insert into slices (id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values ($1,$2,'slice_verify','Verifier',$3,$4)", [slice, workspace, yerli, user]);
  await rejected("cross tenant revision", () => client.query("insert into slice_revisions (workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values ($1,$2,'slice_verify',1,'slice_revision_verify',repeat('a',64),$3,'draft',$4)", [otherWorkspace, slice, yerli, otherUser]));
  await client.query("insert into slice_revisions (id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values ($1,$2,$3,'slice_verify',1,'slice_revision_verify',$4,$5,'draft',$6)", [revision, workspace, slice, initial.definitionHash, yerli, user]);
  await rejected("market predicate", () => client.query("insert into slice_revision_predicates (workspace_id,slice_revision_id,dimension_id,position) values ($1,$2,$3,1)", [workspace, revision, marketDimension]));
  await rejected("explicit include market crossing", () => client.query("insert into slice_revision_overrides (workspace_id,slice_revision_id,operation,entity_level,organization_campaign_id) values ($1,$2,'include','organization_campaign',$3)", [workspace, revision, foreignOrg]));
  await rejected("append-only mutation", () => client.query("update slices set label='mutated' where id=$1", [slice]));
  await client.query("insert into slice_resolution_snapshots (id,workspace_id,slice_revision_id,snapshot_hash,resolved_at) values ($1,$2,$3,repeat('b',64),now())", [snapshot, workspace, revision]);
  await rejected("revision append-only delete", () => client.query("delete from slice_revisions where id=$1", [revision]));
  await rejected("snapshot append-only delete", () => client.query("delete from slice_resolution_snapshots where id=$1", [snapshot]));
  await client.query("insert into slice_resolution_snapshot_members (workspace_id,snapshot_id,ordinal,entity_level,organization_campaign_id,reason,market_evidence_refs,matched_dimension_ids,matched_dimension_evidence_refs) values ($1,$2,1,'organization_campaign',$3,'dynamic_filter','[]'::jsonb,'[]'::jsonb,'[]'::jsonb)", [workspace, snapshot, localOrg]);
  await rejected("snapshot member append-only update", () => client.query("update slice_resolution_snapshot_members set ordinal=2 where workspace_id=$1 and snapshot_id=$2", [workspace, snapshot]));
  const tables = await client.query("select relname from pg_class where relname in ('slices','slice_revisions','slice_revision_predicates','slice_revision_predicate_values','slice_revision_overrides','slice_resolution_snapshots','slice_resolution_snapshot_members') and relrowsecurity and relforcerowsecurity");
  if (tables.rowCount !== 7) fail("RLS/FORCE missing");
  const grants = await client.query("select 1 from information_schema.role_table_grants where table_schema='public' and table_name in ('slices','slice_revisions','slice_revision_predicates','slice_revision_predicate_values','slice_revision_overrides','slice_resolution_snapshots','slice_resolution_snapshot_members') and grantee in ('PUBLIC','anon','authenticated','service_role') limit 1");
  if (grants.rowCount) fail("Data API role grant remains");
  const database = drizzle(client, { schema });
  const repository = new DrizzleSliceRegistryRepository({ transaction: async (work) => work(database as never) });
  const service = new SliceRegistryService(repository);
  const bindings = { market: { dimensionRef: "dimension_market", dimensionId: marketDimension, valueRef: "category_yerli", valueId: yerli }, predicates: [], overrides: [] } as const;
  const publishedDraft = { sliceRef: "slice_verify", revisionRef: "slice_revision_verify_2", revisionNumber: 2, market: initial.market, predicates: [] } as const;
  const published = createSliceRevision(publishedDraft);
  const publishedResult = await service.publish({ workspaceId: workspace, actorId: user, sliceId: slice, draft: publishedDraft, bindings, expectedCurrent: { revisionId: null, definitionHash: null } });
  await rejected("stale publish OCC", () => service.publish({ workspaceId: workspace, actorId: user, sliceId: slice, draft: { ...publishedDraft, revisionRef: "slice_revision_verify_3", revisionNumber: 3 }, bindings, expectedCurrent: { revisionId: null, definitionHash: null } }));
  const entityRef = organizationCampaignPublicRef(workspace, localOrg);
  const frozen = buildFrozenSliceSnapshot(resolveSlice({ revision: published, resolvedAt: "2026-08-17T12:00:00.000Z", candidates: [{ entityRef, entityLevel: "organization_campaign", market: { state: "resolved", dimensionId: "dimension_market", valueId: "category_yerli", key: "yerli", evidenceRefs: ["assignment_market"] }, dimensions: [] }] }));
  const frozenBindings = [{ entityRef, entityLevel: "organization_campaign" as const, organizationCampaignId: localOrg, reason: "dynamic_filter" as const, marketEvidenceRefs: ["assignment_market"], matchedDimensionIds: [], matchedDimensionEvidenceRefs: [] }];
  await service.freeze({ workspaceId: workspace, revisionId: publishedResult.revisionId, revision: published, snapshot: frozen, bindings: frozenBindings });
  await rejected("tampered frozen snapshot", () => service.freeze({ workspaceId: workspace, revisionId: publishedResult.revisionId, revision: published, snapshot: { ...frozen, members: [{ ...frozen.members[0]!, marketEvidenceRefs: [] }] }, bindings: frozenBindings }));
  await rejected("wrong persisted revision binding", () => service.freeze({ workspaceId: workspace, revisionId: revision, revision: published, snapshot: frozen, bindings: frozenBindings }));
  await client.query("update workspaces set lifecycle_state='tombstoning' where id=$1", [workspace]);
  await rejected("parent-first tombstone purge", () => client.query("delete from slices where id=$1", [slice]));
  await client.query("rollback");
  const residue = await client.query("select count(*)::int as count from slices where workspace_id=$1", [workspace]);
  if (residue.rows[0]?.count !== 0) fail("outer rollback left residue");
  console.log("slice registry postgres verification passed (outer rollback; zero residue)");
} catch (error) {
  try { await client.query("rollback"); } catch { /* best effort */ }
  throw error;
} finally { await client.end(); }
