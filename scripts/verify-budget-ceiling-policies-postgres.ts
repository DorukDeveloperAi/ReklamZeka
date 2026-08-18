import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { assertValidBudgetCeilingPolicy, createBudgetCeilingPolicy, resolveBudgetCeilingPolicies, type BudgetCeilingLayer, type BudgetCeilingPolicy } from "../src/domain/budget/budget-ceiling-policy";
import { BudgetCeilingPolicyService, budgetCeilingPublisherRef } from "../src/application/budget-ceiling-policy-service";
import { DrizzleBudgetCeilingPolicyRepository } from "../src/connectors/budget/budget-ceiling-policy-drizzle-repository";
import * as schema from "../src/db/schema";

const { Client } = pg;
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL required");
const migrationPath = new URL("../drizzle/20260818000400_p04_budget_ceiling_policies.sql", import.meta.url);
const migration = await readFile(migrationPath, "utf8");
const migrationHash = createHash("sha256").update(migration).digest("hex");
const client = new Client({ connectionString: url });
const ws = randomUUID(), owner = randomUUID();
const layers: readonly BudgetCeilingLayer[] = ["market", "organization_campaign", "geo_targeting_platform", "campaign_ad_set"];
const at = "2026-08-18T08:00:00.000Z", until = "2026-09-18T08:00:00.000Z";
const policies: BudgetCeilingPolicy[] = layers.map((layer, index) => createBudgetCeilingPolicy({
  workspaceRef: `workspace_${createHash("sha256").update(ws).digest("hex").slice(0, 16)}`,
  limitRef: `limit_${layer}`, revision: 1, previousPolicyHash: null, poolRef: `budget_pool_${layer}`,
  parentLimitRef: index === 0 ? null : `limit_${layers[index - 1]}`, layer, targetScopeRef: "ad_set_public_123",
  market: "yerli", currency: "TRY", ceilingDecimal: String(1000-index*100), effectiveFrom: at, effectiveTo: until,
  state: "published", publishedByActorRef: budgetCeilingPublisherRef(owner), publishedAt: "2026-08-18T07:00:00.000Z",
}));
const flags: Record<string, boolean> = {};
const savepointReject = async (name: string, fn: () => Promise<void>) => {
  await client.query(`savepoint ${name}`); try { await fn(); flags[name] = false; } catch { flags[name] = true; } finally { await client.query(`rollback to savepoint ${name}`); }
};
try {
  await client.connect(); await client.query("begin"); await client.query(migration);
  flags.appliedOuterRollback = true;
  await client.query("set local session_replication_role=replica");
  await client.query("insert into users(id,email) values($1,$2)",[owner,`budget-ceiling-${owner}@invalid.local`]);
  await client.query("insert into workspaces(id,name) values($1,'budget ceiling verifier')",[ws]);
  await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')",[ws,owner]);
  await client.query("set local session_replication_role=origin");
  const db=drizzle(client,{schema});
  const transactionless={select:db.select.bind(db),insert:db.insert.bind(db),execute:db.execute.bind(db),transaction:async<T>(callback:(tx:typeof db)=>Promise<T>)=>callback(db)};
  const service=new BudgetCeilingPolicyService(new DrizzleBudgetCeilingPolicyRepository(transactionless as never),()=>"2026-08-18T07:00:00.000Z");
  for (const policy of policies) {
    const {workspaceRef:_workspaceRef,publishedByActorRef:_actor,publishedAt:_at,schemaVersion:_version,authority:_authority,policyHash:_hash,...draft}=policy;
    const result=await service.publish(owner,{workspaceId:ws,...draft});
    if(result.persistence!=="inserted"||!result.auditAppended) throw new Error("publication path failed");
  }
  const replayPolicy=policies[0]!;
  const {workspaceRef:_wr,publishedByActorRef:_pa,publishedAt:_pt,schemaVersion:_sv,authority:_au,policyHash:_ph,...replayDraft}=replayPolicy;
  flags.repositoryReplay=(await service.publish(owner,{workspaceId:ws,...replayDraft})).persistence==="unchanged";
  flags.canonicalFourLayers = Number((await client.query("select count(*) count from budget_ceiling_policy_revisions where workspace_id=$1",[ws])).rows[0].count)===4;
  const persisted = (await client.query("select policy_payload from budget_ceiling_policy_revisions where workspace_id=$1 order by limit_ref,revision",[ws])).rows.map((row)=>assertValidBudgetCeilingPolicy(row.policy_payload));
  const resolution = resolveBudgetCeilingPolicies({workspaceRef:policies[0]!.workspaceRef,targetScopeRef:"ad_set_public_123",market:"yerli",currency:"TRY",evaluatedAt:"2026-08-18T09:00:00.000Z",guideBudgetRefs:layers.map((scopeKind)=>({scopeKind,limitRef:`limit_${scopeKind}`})),policies:persisted});
  flags.persistedResolution = resolution.status==="ready" && resolution.effectiveParentCeilingDecimal==="700";
  await savepointReject("forgedHashRejected", async()=>{ const p=policies[3]!; await client.query(`insert into budget_ceiling_policy_revisions(workspace_id,limit_ref,revision,previous_policy_hash,policy_hash,pool_ref,parent_limit_ref,layer,target_scope_ref,market,currency,ceiling_decimal,effective_from,effective_to,state,published_by_actor_id,published_at,policy_payload) values($1,$2,2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'disabled',$14,$15,$16::jsonb)`,[ws,p.limitRef,p.policyHash,"f".repeat(64),p.poolRef,p.parentLimitRef,p.layer,p.targetScopeRef,p.market,p.currency,p.ceilingDecimal,p.effectiveFrom,p.effectiveTo,owner,"2026-08-18T07:30:00.000Z",JSON.stringify({...p,revision:2,previousPolicyHash:p.policyHash,state:"disabled",policyHash:"f".repeat(64),publishedAt:"2026-08-18T07:30:00.000Z"})]); });
  await savepointReject("chainGapRejected", async()=>{ const p=policies[3]!; await client.query(`insert into budget_ceiling_policy_revisions(workspace_id,limit_ref,revision,previous_policy_hash,policy_hash,pool_ref,parent_limit_ref,layer,target_scope_ref,market,currency,ceiling_decimal,effective_from,effective_to,state,published_by_actor_id,published_at,policy_payload) values($1,$2,3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'published',$14,$15,$16::jsonb)`,[ws,p.limitRef,p.policyHash,p.policyHash,p.poolRef,p.parentLimitRef,p.layer,p.targetScopeRef,p.market,p.currency,p.ceilingDecimal,p.effectiveFrom,p.effectiveTo,owner,p.publishedAt,JSON.stringify({...p,revision:3,previousPolicyHash:p.policyHash})]); });
  await savepointReject("forgedIdentityRejected", async()=>{ const p=policies[0]!; const forged=createBudgetCeilingPolicy({workspaceRef:"workspace_ffffffffffffffff",limitRef:"limit_forged",revision:1,previousPolicyHash:null,poolRef:"budget_pool_forged",parentLimitRef:null,layer:"market",targetScopeRef:p.targetScopeRef,market:"yerli",currency:"TRY",ceilingDecimal:"1",effectiveFrom:p.effectiveFrom,effectiveTo:p.effectiveTo,state:"published",publishedByActorRef:budgetCeilingPublisherRef(owner),publishedAt:p.publishedAt}); await client.query(`insert into budget_ceiling_policy_revisions(workspace_id,limit_ref,revision,previous_policy_hash,policy_hash,pool_ref,parent_limit_ref,layer,target_scope_ref,market,currency,ceiling_decimal,effective_from,effective_to,state,published_by_actor_id,published_at,policy_payload) values($1,$2,1,null,$3,$4,null,'market',$5,'yerli','TRY','1',$6,$7,'published',$8,$9,$10::jsonb)`,[ws,forged.limitRef,forged.policyHash,forged.poolRef,forged.targetScopeRef,forged.effectiveFrom,forged.effectiveTo,owner,forged.publishedAt,JSON.stringify(forged)]); });
  await savepointReject("immutableRejected", async()=>{ await client.query("update budget_ceiling_policy_revisions set ceiling_decimal='1' where workspace_id=$1",[ws]); });
  const catalog = await client.query(`select c.relrowsecurity,c.relforcerowsecurity,(select count(*) from pg_policy p where p.polrelid=c.oid) policies,(select count(*) from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=c.relname and g.grantee in ('PUBLIC','anon','authenticated','service_role')) grants from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='budget_ceiling_policy_revisions'`);
  flags.rlsForced = catalog.rows[0]?.relrowsecurity===true && catalog.rows[0]?.relforcerowsecurity===true;
  flags.publicRevoked = Number(catalog.rows[0]?.policies)===0 && Number(catalog.rows[0]?.grants)===0;
  flags.migrationHashUnjournaled = Number((await client.query("select count(*) count from drizzle.__drizzle_migrations where hash=$1",[migrationHash])).rows[0].count)===0;
  await client.query("rollback");
  flags.zeroResidue = (await client.query("select to_regclass('public.budget_ceiling_policy_revisions') value")).rows[0].value===null;
  if (!Object.values(flags).every(Boolean)) throw new Error(JSON.stringify(flags));
  console.log(JSON.stringify({mode:"pre_outer_rollback",migrationHash,...flags}));
} finally { try { await client.query("rollback"); } catch {} await client.end(); }
