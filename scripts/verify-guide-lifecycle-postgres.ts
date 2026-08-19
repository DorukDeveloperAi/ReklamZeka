import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { canonicalGuideWorkspaceRef, createGuideRevision } from "@/domain/guides/guide-revision";
import { DrizzleGuideLifecycleRepository, GuideLifecycleRepositoryError } from "@/connectors/guides/guide-lifecycle-drizzle-repository";
import { GuideLifecycleService } from "@/application/guide-lifecycle-service";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("postgres_connection_not_configured");
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 8_000 });
const now = "2026-08-17T12:00:00.000Z";
const reject = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch (error) { return error instanceof GuideLifecycleRepositoryError && (error.code === "forbidden" || error.code === "conflict" || error.code === "invalid_input"); } };
const rejected = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
const guide = (workspaceId: string, revision: number, previousRevisionHash: string | null, text: string, market: "yerli" | "yabanci" = "yerli") => createGuideRevision({
  workspaceRef: canonicalGuideWorkspaceRef(workspaceId), guideRef: "guide_verify", revision, previousRevisionHash, sliceRef: "slice_guide_verify", market, freeText: text,
  strict: { budgetRefs: [{ limitRef: "limit_budget", scopeKind: "organization_campaign" }], rollbackConditions: [], budgetInterpretation: null },
  schedule: { frequency: "daily", timezone: "Europe/Istanbul", localTime: "09:00" }, mode: "prepare_human_approval", actionAllowlist: ["budget_increase", "campaign_rename"],
});
try {
  const client = await pool.connect();
  try {
    await client.query("begin");
    let negativeQuerySequence = 0;
    const directQueryRejected = async (statement: string, values: readonly unknown[] = []) => {
      const savepoint = `guide_negative_${negativeQuerySequence++}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        await client.query(statement, [...values]);
        await client.query(`release savepoint ${savepoint}`);
        return false;
      } catch {
        await client.query(`rollback to savepoint ${savepoint}`);
        await client.query(`release savepoint ${savepoint}`);
        return true;
      }
    };
    const ws=randomUUID(), foreignWs=randomUUID(), owner=randomUUID(), analyst=randomUUID(), foreignOwner=randomUUID(), dim=randomUUID(), market=randomUUID(), slice=randomUUID(), sliceRevision=randomUUID();
    for (const table of ["guides","guide_revisions","guide_revision_actions","guide_revision_budget_refs","guide_interpretation_acceptances","guide_heads","guide_lifecycle_events","guide_activation_outbox"]) {
      const state=(await client.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[`public.${table}`])).rows[0];
      if (state?.relrowsecurity!==true || state?.relforcerowsecurity!==true) throw new Error(`rls_missing:${table}`);
    }
    await client.query("insert into users(id,email) values($1,$2),($3,$4),($5,$6)",[owner,`guide-${owner}@invalid.local`,analyst,`guide-${analyst}@invalid.local`,foreignOwner,`guide-${foreignOwner}@invalid.local`]);
    await client.query("insert into workspaces(id,name) values($1,'guide verifier'),($2,'guide verifier foreign')",[ws,foreignWs]);
    await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'analyst'),($4,$5,'owner')",[ws,owner,analyst,foreignWs,foreignOwner]);
    await client.query("insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values($1,$2,'market','Market','single',array['campaign']::category_entity_level[])",[dim,ws]);
    await client.query("insert into category_definitions(id,workspace_id,dimension_id,key,label) values($1,$2,$3,'yerli','Yerli')",[market,ws,dim]);
    await client.query("insert into slices(id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values($1,$2,'slice_guide_verify','scope',$3,$4)",[slice,ws,market,owner]);
    await client.query("insert into slice_revisions(id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values($1,$2,$3,'slice_guide_verify',1,'slice_revision_guide_verify',repeat('a',64),$4,'published',$5)",[sliceRevision,ws,slice,market,owner]);
    await client.query("update slices set current_published_revision_id=$1 where workspace_id=$2 and id=$3",[sliceRevision,ws,slice]);
    const drizzleClient=drizzle(client);
    const savepointDatabase={ transaction: async <T>(fn: (tx: typeof drizzleClient) => Promise<T>) => { await client.query("savepoint guide_repository"); try { const result=await fn(drizzleClient); await client.query("release savepoint guide_repository"); return result; } catch (error) { await client.query("rollback to savepoint guide_repository"); await client.query("release savepoint guide_repository"); throw error; } } };
    const repository=new DrizzleGuideLifecycleRepository(savepointDatabase as never);
    const service=new GuideLifecycleService({execute:drizzleClient.execute.bind(drizzleClient),transaction:savepointDatabase.transaction} as never,[{workspaceId:ws,userId:owner,role:"owner"}]);
    const serverDraft=await service.create({actor:{userId:owner},workspaceId:ws,workspaceRef:canonicalGuideWorkspaceRef(ws),readerRef:"reader_guide_verify"},{label:"Sunucu Kılavuzu",sliceRef:"slice_guide_verify",market:"yerli",freeText:"Durum değişiklikleri insan onayından geçsin.",schedule:{frequency:"daily",timezone:"Europe/Istanbul",localTime:"10:00"},mode:"prepare_human_approval",actionAllowlist:["status_pause","status_activate"],budgetRefs:[],rollbackConditions:["Kaynak durum değişirse durdur"]});
    const serverRevised=await service.mutate({actor:{userId:owner},workspaceId:ws,workspaceRef:canonicalGuideWorkspaceRef(ws),readerRef:"reader_guide_verify"},{operation:"revise",guideId:serverDraft.guideId,expectedHeadVersion:serverDraft.headVersion,expectedLatestRevisionId:serverDraft.revisionId,expectedLatestRevisionHash:serverDraft.revisionHash,sliceRef:"slice_guide_verify",market:"yerli",freeText:"Durum değişiklikleri her zaman insan onayından geçsin.",schedule:{frequency:"daily",timezone:"Europe/Istanbul",localTime:"10:00"},mode:"prepare_human_approval",actionAllowlist:["status_pause","status_activate"],budgetRefs:[],rollbackConditions:["Kaynak durum değişirse durdur"]});
    if (!("revisionId" in serverRevised)) throw new Error("server revision draft missing");
    const serverProjection=await service.list({actor:{userId:owner},workspaceId:ws,workspaceRef:canonicalGuideWorkspaceRef(ws),readerRef:"reader_guide_verify"});
    const serverOwnedLifecycle=serverProjection.items.some(item=>item.guideId===serverDraft.guideId&&item.revisionId===serverRevised.revisionId&&item.revision===2&&item.activeRevisionId===null&&!item.interpretationAccepted&&item.sliceRef==="slice_guide_verify")&&!serverProjection.authority.canWriteMeta&&!serverProjection.authority.canExecute;
    const first=guide(ws,1,null,"Birinci sürüm.");
    const created=await repository.createDraft({workspaceId:ws,actorId:owner,role:"owner",label:"Kılavuz",guide:first,sliceId:slice,sliceRevisionId:sliceRevision,marketDefinitionId:market,occurredAt:now});
    const reloaded=await repository.loadCanonicalRevision({workspaceId:ws,guideId:created.guideId,revisionId:created.revisionId});
    const canonicalReloaded=reloaded.revisionHash===first.revisionHash&&reloaded.actionAllowlist.join(",")==="budget_increase,campaign_rename"&&reloaded.authority.humanApprovalActions.join(",")==="budget_increase,campaign_rename"&&reloaded.strict.budgetRefs.length===1;
    const analystRejected=await reject(()=>repository.createNextDraft({workspaceId:ws,actorId:analyst,role:"owner",guideId:created.guideId,expectedHeadVersion:0,expectedLatestRevisionId:created.revisionId,expectedLatestRevisionHash:first.revisionHash,guide:guide(ws,2,first.revisionHash,"İkinci sürüm."),sliceRevisionId:sliceRevision,marketDefinitionId:market,occurredAt:"2026-08-17T12:01:00.000Z"}));
    const missingAcceptanceRejected=await reject(()=>repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:created.revisionId,expectedHeadVersion:0,expectedCurrentRevisionId:null,occurredAt:"2026-08-17T12:01:00.000Z"}));
    const headBefore=(await client.query("select current_active_revision_id from guide_heads where workspace_id=$1 and guide_id=$2",[ws,created.guideId])).rows[0];
    await repository.acceptInterpretation({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:created.revisionId,interpretationHash:first.interpretationHash,occurredAt:"2026-08-17T12:02:00.000Z"});
    const acceptanceIdempotent=(await repository.acceptInterpretation({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:created.revisionId,interpretationHash:first.interpretationHash,occurredAt:"2026-08-17T12:02:00.000Z"})).created===false;
    const active1=await repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:created.revisionId,expectedHeadVersion:0,expectedCurrentRevisionId:null,occurredAt:"2026-08-17T12:03:00.000Z"});
    const second=guide(ws,2,first.revisionHash,"İkinci sürüm.");
    const drafted2=await repository.createNextDraft({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,expectedHeadVersion:1,expectedLatestRevisionId:created.revisionId,expectedLatestRevisionHash:first.revisionHash,guide:second,sliceRevisionId:sliceRevision,marketDefinitionId:market,occurredAt:"2026-08-17T12:04:00.000Z"});
    const oldActiveSurvives=(await client.query("select current_active_revision_id::text active from guide_heads where workspace_id=$1 and guide_id=$2",[ws,created.guideId])).rows[0]?.active===created.revisionId;
    const staleRejected=await reject(()=>repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,expectedHeadVersion:1,expectedCurrentRevisionId:created.revisionId,occurredAt:"2026-08-17T12:05:00.000Z"}));
    const failedActivationKeepsOld=(await client.query("select current_active_revision_id::text active from guide_heads where workspace_id=$1 and guide_id=$2",[ws,created.guideId])).rows[0]?.active===created.revisionId;
    await repository.acceptInterpretation({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,interpretationHash:second.interpretationHash,occurredAt:"2026-08-17T12:06:00.000Z"});
    await repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,expectedHeadVersion:2,expectedCurrentRevisionId:created.revisionId,occurredAt:"2026-08-17T12:07:00.000Z"});
    const paused=await repository.pause({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,expectedHeadVersion:3,expectedCurrentRevisionId:drafted2.revisionId,occurredAt:"2026-08-17T12:08:00.000Z"});
    const reactivated=await repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,expectedHeadVersion:paused.headVersion,expectedCurrentRevisionId:null,occurredAt:"2026-08-17T12:09:00.000Z"});
    if (reactivated.idempotent) throw new Error("reactivation_must_create_new_lifecycle_occurrence");
    const reactivationRetry=await repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,expectedHeadVersion:paused.headVersion,expectedCurrentRevisionId:null,occurredAt:"2026-08-17T12:09:00.000Z"});
    const tamperedReactivationRejected=await reject(()=>repository.activate({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,revisionId:drafted2.revisionId,expectedHeadVersion:paused.headVersion,expectedCurrentRevisionId:null,occurredAt:"2026-08-17T12:09:01.000Z"}));
    const pausedAgain=await repository.pause({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,expectedHeadVersion:reactivated.headVersion,expectedCurrentRevisionId:drafted2.revisionId,occurredAt:"2026-08-17T12:10:00.000Z"});
    const archived=await repository.archive({workspaceId:ws,actorId:owner,role:"owner",guideId:created.guideId,expectedHeadVersion:pausedAgain.headVersion,occurredAt:"2026-08-17T12:11:00.000Z"});
    const crossWorkspaceRejected=await reject(()=>repository.createDraft({workspaceId:ws,actorId:owner,role:"owner",label:"Kılavuz",guide:guide(randomUUID(),1,null,"Yabancı bağlam."),sliceId:slice,sliceRevisionId:sliceRevision,marketDefinitionId:market,occurredAt:"2026-08-17T12:12:00.000Z"}));
    const crossMarketRejected=await rejected(()=>repository.createDraft({workspaceId:ws,actorId:owner,role:"owner",label:"Kılavuz",guide:guide(ws,1,null,"Yabancı market.","yabanci"),sliceId:slice,sliceRevisionId:sliceRevision,marketDefinitionId:market,occurredAt:"2026-08-17T12:12:00.000Z"}));
    const compositeFkRejected=await directQueryRejected("insert into guide_revision_actions(workspace_id,guide_revision_id,action,authority) values($1,$2,'budget_decrease','none')",[foreignWs,created.revisionId]);
    const revoked=(await client.query("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee=any(array['PUBLIC','anon','authenticated','service_role'])",[["guides","guide_revisions","guide_revision_actions","guide_revision_budget_refs","guide_interpretation_acceptances","guide_heads","guide_lifecycle_events","guide_activation_outbox"]])).rows[0]?.n===0;
    const eventCount=Number((await client.query("select count(*)::int n from guide_lifecycle_events where workspace_id=$1",[ws])).rows[0]?.n);
    await client.query("rollback");
    const zeroResidue=Number((await client.query("select count(*)::int n from workspaces where id=$1",[ws])).rows[0]?.n)===0;
    if (!serverOwnedLifecycle||!canonicalReloaded||!analystRejected||!missingAcceptanceRejected||!acceptanceIdempotent||headBefore.current_active_revision_id!==null||!active1.activated||!oldActiveSurvives||!staleRejected||!failedActivationKeepsOld||!reactivated.activated||!reactivationRetry.idempotent||!tamperedReactivationRejected||!crossWorkspaceRejected||!crossMarketRejected||!compositeFkRejected||!revoked||!archived.archived||eventCount<10||!zeroResidue) throw new Error(JSON.stringify({ serverOwnedLifecycle,canonicalReloaded,analystRejected,missingAcceptanceRejected,acceptanceIdempotent,headBefore,active1,oldActiveSurvives,staleRejected,failedActivationKeepsOld,reactivated,reactivationRetry,tamperedReactivationRejected,crossWorkspaceRejected,crossMarketRejected,compositeFkRejected,revoked,archived,eventCount,zeroResidue }));
    console.log(JSON.stringify({ok:true,outerRollback:true,serverOwnedLifecycle,canonicalReloaded,analystRejected,missingAcceptanceRejected,acceptanceIdempotent,oldActiveSurvives,failedActivationKeepsOld,reactivated:reactivated.activated,reactivationRetry:reactivationRetry.idempotent,tamperedReactivationRejected,crossWorkspaceRejected,crossMarketRejected,compositeFkRejected,revoked,archived:archived.archived,eventCount,zeroResidue}));
  } finally { client.release(); }
} finally { await pool.end(); }
