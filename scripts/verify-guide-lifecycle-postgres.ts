import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createGuideRevision } from "@/domain/guides/guide-revision";
import { DrizzleGuideLifecycleRepository, GuideLifecycleRepositoryError } from "@/connectors/guides/guide-lifecycle-drizzle-repository";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("postgres_connection_not_configured");
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 8_000 });
const now = "2026-08-17T12:00:00.000Z";
const reject = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch (error) { return error instanceof GuideLifecycleRepositoryError && (error.code === "forbidden" || error.code === "conflict"); } };
const guide = (revision: number, previousRevisionHash: string | null, text: string) => createGuideRevision({
  workspaceRef: "workspace_verify", guideRef: "guide_verify", revision, previousRevisionHash, sliceRef: "slice_guide_verify", market: "yerli", freeText: text,
  strict: { budgetRefs: [{ limitRef: "limit_budget", scopeKind: "organization_campaign" }], rollbackConditions: [], budgetInterpretation: null },
  schedule: { frequency: "daily", timezone: "Europe/Istanbul", localTime: "09:00" }, mode: "recommend", actionAllowlist: [],
});
try {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const ws=randomUUID(), owner=randomUUID(), analyst=randomUUID(), dim=randomUUID(), market=randomUUID(), slice=randomUUID(), sliceRevision=randomUUID();
    for (const table of ["guides","guide_revisions","guide_revision_actions","guide_revision_budget_refs","guide_interpretation_acceptances","guide_heads","guide_lifecycle_events","guide_activation_outbox"]) {
      const state=(await client.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[`public.${table}`])).rows[0];
      if (state?.relrowsecurity!==true || state?.relforcerowsecurity!==true) throw new Error(`rls_missing:${table}`);
    }
    await client.query("insert into users(id,email) values($1,$2),($3,$4)",[owner,`guide-${owner}@invalid.local`,analyst,`guide-${analyst}@invalid.local`]);
    await client.query("insert into workspaces(id,name) values($1,'guide verifier')",[ws]);
    await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'analyst')",[ws,owner,analyst]);
    await client.query("insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values($1,$2,'market','Market','single',array['campaign']::category_entity_level[])",[dim,ws]);
    await client.query("insert into category_definitions(id,workspace_id,dimension_id,key,label) values($1,$2,$3,'yerli','Yerli')",[market,ws,dim]);
    await client.query("insert into slices(id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values($1,$2,'slice_guide_verify','scope',$3,$4)",[slice,ws,market,owner]);
    await client.query("insert into slice_revisions(id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values($1,$2,$3,'slice_guide_verify',1,'slice_revision_guide_verify',repeat('a',64),$4,'published',$5)",[sliceRevision,ws,slice,market,owner]);
    await client.query("update slices set current_published_revision_id=$1 where workspace_id=$2 and id=$3",[sliceRevision,ws,slice]);
    const drizzleClient=drizzle(client);
    const savepointDatabase={ transaction: async <T>(fn: (tx: typeof drizzleClient) => Promise<T>) => { await client.query("savepoint guide_repository"); try { const result=await fn(drizzleClient); await client.query("release savepoint guide_repository"); return result; } catch (error) { await client.query("rollback to savepoint guide_repository"); await client.query("release savepoint guide_repository"); throw error; } } };
    const repository=new DrizzleGuideLifecycleRepository(savepointDatabase as never);
    const first=guide(1,null,"Birinci sürüm.");
    const created=await repository.createDraft({workspaceId:ws,actorId:owner,role:"owner",label:"Kılavuz",guide:first,sliceId:slice,sliceRevisionId:sliceRevision,marketDefinitionId:market,occurredAt:now});
    const analystRejected=await reject(()=>repository.createNextDraft({workspaceId:ws,actorId:analyst,role:"analyst",guideId:created.guideId,expectedHeadVersion:0,expectedLatestRevisionId:created.revisionId,expectedLatestRevisionHash:first.revisionHash,guide:guide(2,first.revisionHash,"İkinci sürüm."),sliceRevisionId:sliceRevision,marketDefinitionId:market,occurredAt:"2026-08-17T12:01:00.000Z"}));
    const missingAcceptanceRejected=await reject(()=>repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:created.revisionId,expectedHeadVersion:0,expectedCurrentRevisionId:null,occurredAt:"2026-08-17T12:01:00.000Z"}));
    const headBefore=(await client.query("select current_active_revision_id from guide_heads where workspace_id=$1 and guide_id=$2",[ws,created.guideId])).rows[0];
    await repository.acceptInterpretation({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:created.revisionId,interpretationHash:first.interpretationHash,occurredAt:"2026-08-17T12:02:00.000Z"});
    const active1=await repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:created.revisionId,expectedHeadVersion:0,expectedCurrentRevisionId:null,occurredAt:"2026-08-17T12:03:00.000Z"});
    const second=guide(2,first.revisionHash,"İkinci sürüm.");
    const drafted2=await repository.createNextDraft({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,expectedHeadVersion:1,expectedLatestRevisionId:created.revisionId,expectedLatestRevisionHash:first.revisionHash,guide:second,sliceRevisionId:sliceRevision,marketDefinitionId:market,occurredAt:"2026-08-17T12:04:00.000Z"});
    const oldActiveSurvives=(await client.query("select current_active_revision_id::text active from guide_heads where workspace_id=$1 and guide_id=$2",[ws,created.guideId])).rows[0]?.active===created.revisionId;
    const staleRejected=await reject(()=>repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,expectedHeadVersion:1,expectedCurrentRevisionId:created.revisionId,occurredAt:"2026-08-17T12:05:00.000Z"}));
    const failedActivationKeepsOld=(await client.query("select current_active_revision_id::text active from guide_heads where workspace_id=$1 and guide_id=$2",[ws,created.guideId])).rows[0]?.active===created.revisionId;
    await repository.acceptInterpretation({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,interpretationHash:second.interpretationHash,occurredAt:"2026-08-17T12:06:00.000Z"});
    await repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,expectedHeadVersion:2,expectedCurrentRevisionId:created.revisionId,occurredAt:"2026-08-17T12:07:00.000Z"});
    const paused=await repository.pause({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,expectedHeadVersion:3,expectedCurrentRevisionId:drafted2.revisionId,occurredAt:"2026-08-17T12:08:00.000Z"});
    const archived=await repository.archive({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,expectedHeadVersion:paused.headVersion,occurredAt:"2026-08-17T12:09:00.000Z"});
    const eventCount=Number((await client.query("select count(*)::int n from guide_lifecycle_events where workspace_id=$1",[ws])).rows[0]?.n);
    await client.query("rollback");
    const zeroResidue=Number((await client.query("select count(*)::int n from workspaces where id=$1",[ws])).rows[0]?.n)===0;
    if (!analystRejected||!missingAcceptanceRejected||headBefore.current_active_revision_id!==null||!active1.activated||!oldActiveSurvives||!staleRejected||!failedActivationKeepsOld||!archived.archived||eventCount<7||!zeroResidue) throw new Error(JSON.stringify({ analystRejected,missingAcceptanceRejected,headBefore,active1,oldActiveSurvives,staleRejected,failedActivationKeepsOld,archived,eventCount,zeroResidue }));
    console.log(JSON.stringify({ok:true,outerRollback:true,analystRejected,missingAcceptanceRejected,oldActiveSurvives,failedActivationKeepsOld,archived:archived.archived,eventCount,zeroResidue}));
  } finally { client.release(); }
} finally { await pool.end(); }
