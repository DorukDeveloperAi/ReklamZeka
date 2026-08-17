import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ActionProposalStagingService } from "@/application/action-proposal-staging-service";
import { DrizzleActionProposalQueueRepository } from "@/connectors/actions/action-proposal-queue-drizzle-repository";
import { DrizzleGuideRunActionBindingRepository } from "@/connectors/guides/guide-run-action-binding-drizzle-repository";
import { DrizzleGuideRunRepository } from "@/connectors/guides/guide-run-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import * as schema from "@/db/schema";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import { buildActionPlan, type AutonomyRule } from "@/domain/actions/autonomy-valve";
import { appendGuideRunTransitionV12, createGuideRunV12, type GuideRunV12 } from "@/domain/guides/guide-run";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const rollback = Symbol("rollback");
const digest = (value: unknown) => {
  const stable = (x: unknown): unknown => Array.isArray(x) ? x.map(stable) : x && typeof x === "object"
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])) : x;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
};
const rows = (value: unknown) => value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
  ? value.rows as readonly Record<string, unknown>[] : [];
const closed = { canMutateGuide: false, canApprove: false, canExecute: false, canWriteMeta: false } as const;
const evidence = {
  mode: "pre_outer_rollback", p05Prerequisite: false, p06AppliedOuterRollback: false, rlsForced: false, publicRevoked: false,
  actionQueuePersisted: false, completedRun: false, materialized: false, replay: false, staleGuideHeadRejected: false,
  candidateTamperRejected: false, refHashAuthorityTamperRejected: false, wrongScopeRejected: false, crossTenantRejected: false,
  appendDeleteGuard: false, tombstonePurge: false, zeroResidue: false,
};
const mark = (stage: string) => console.log(JSON.stringify({ p06PreStage: stage }));
function transition(run: GuideRunV12, toState: Parameters<typeof appendGuideRunTransitionV12>[1]["toState"], occurredAt: string, token: string): GuideRunV12 {
  return appendGuideRunTransitionV12(run, { expectedHeadHash: run.headEventHash, toState, occurredAt, leaseToken: token, leaseUntil: "2026-08-17T00:10:00.000Z" });
}
async function rejected(client: { query: (text: string, values?: readonly unknown[]) => Promise<unknown> }, work: () => Promise<unknown>): Promise<boolean> {
  await client.query("savepoint p06_expected_failure");
  try { await work(); await client.query("release savepoint p06_expected_failure"); return false; }
  catch { await client.query("rollback to savepoint p06_expected_failure"); return true; }
}
try {
  const client = await pool.connect();
  try {
    await client.query("begin");
    try {
      const prerequisite = await client.query<{ exists: boolean }>("select to_regclass('public.guide_runs') is not null as exists");
      evidence.p05Prerequisite = prerequisite.rows[0]?.exists === true;
      if (!evidence.p05Prerequisite) throw new Error("P05 prerequisite is not applied");
      await client.query(readFileSync("drizzle/20260817210000_p06_action_bindings.sql", "utf8"));
      mark("migration_installed_outer_rollback");
      const shape = await client.query<{ force: boolean }>("select relforcerowsecurity force from pg_class where oid='public.guide_run_action_bindings'::regclass");
      evidence.p06AppliedOuterRollback = shape.rows.length === 1;
      evidence.rlsForced = shape.rows[0]?.force === true;
      const grants = await client.query<{ n: string }>("select count(*)::text n from information_schema.role_table_grants where table_schema='public' and table_name='guide_run_action_bindings' and grantee in ('PUBLIC','anon','authenticated','service_role')");
      evidence.publicRevoked = grants.rows[0]?.n === "0";
      const workspaceId = randomUUID(), foreignWorkspaceId = randomUUID(), guideId = randomUUID(), revisionId = randomUUID();
      const connectionId = randomUUID(), sourceId = randomUUID(), accountId = randomUUID(), campaignId = randomUUID(), contextId = randomUUID();
      const guideRef = "guide_p06_binding_fixture", revisionHash = "a".repeat(64), workspaceRef = canonicalGuideWorkspaceRef(workspaceId);
      await client.query("set local session_replication_role=replica");
      await client.query("insert into workspaces(id,name) values($1,'P06 binding'),($2,'P06 foreign')", [workspaceId, foreignWorkspaceId]);
      await client.query("insert into guides(id,workspace_id,guide_ref,label,slice_id,market_definition_id,created_by_actor_id) values($1,$2,$3,'P06',$4,$5,$6)", [guideId, workspaceId, guideRef, randomUUID(), randomUUID(), randomUUID()]);
      await client.query("insert into guide_revisions(id,workspace_id,guide_id,guide_ref,revision_number,revision_hash,slice_revision_id,slice_ref,market_definition_id,market_key,free_text,strict_payload,schedule_payload,mode,interpretation_hash,created_by_actor_id) values($1,$2,$3,$4,1,$5,$6,'slice_p06_fixture',$7,'yerli','fixture','{}','{}','observe_analyze',$8,$9)", [revisionId, workspaceId, guideId, guideRef, revisionHash, randomUUID(), randomUUID(), "b".repeat(64), randomUUID()]);
      await client.query("insert into guide_heads(workspace_id,guide_id,latest_revision_id,current_active_revision_id,version,updated_at) values($1,$2,$3,$3,1,now())", [workspaceId, guideId, revisionId]);
      await client.query("set local session_replication_role=origin");
      const db = drizzle(client, { schema });
      // All repositories below are deliberately given a transaction facade.
      // Their normal nested transaction callbacks therefore stay inside this
      // verifier's one outer BEGIN and can never commit its PRE-only DDL.
      const outerDb: any = {
        execute: db.execute.bind(db), select: db.select.bind(db), insert: db.insert.bind(db),
        transaction: async (work: (tx: unknown) => Promise<unknown>) => await work(outerDb),
      };
      await db.insert(schema.metaConnections).values({ id: connectionId, workspaceId, externalConnectionKey: "p06-binding", displayName: "P06", graphApiVersion: "v23.0", fieldCatalogVersion: "p06" });
      await db.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads", externalAccountId: "act_12345", displayName: "P06" });
      await db.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: "act_12345", name: "P06", currency: "TRY", timezone: "Europe/Istanbul" });
      await db.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId, externalCampaignId: "campaign_12345", name: "P06" });
      const contextHash = "c".repeat(64), capturedAt = new Date("2026-08-17T00:00:00.000Z"), snapshotRefs = ["snapshot_aaaaaaaaaaaaaaaaaaaa"];
      await db.insert(schema.effectiveCampaignContexts).values({ id: contextId, workspaceId, identityHash: "d".repeat(64), contextHash, schemaVersion: "effective-campaign-context/1.0.0", metaConnectionId: connectionId, adAccountId: accountId, campaignId, connectionRef: "p06-binding", accountRef: "act_12345", campaignRef: "campaign_12345", entityType: "campaign", entityRef: "campaign_12345", capturedAt, snapshotRefs, contextPayload: { workspaceId, schemaVersion: "effective-campaign-context/1.0.0", contextHash, capturedAt: capturedAt.toISOString(), identity: { connectionRef: "p06-binding", accountRef: "act_12345", campaignRef: "campaign_12345", entityType: "campaign", entityRef: "campaign_12345" }, data: { snapshotRefs }, capabilities: { containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false } } });
      await db.insert(schema.effectiveCampaignContextComponents).values({ workspaceId, contextId, componentType: "policy_authority", componentRef: "policy_authority_p06", componentVersion: "e".repeat(64) });
      const rule: AutonomyRule = { ruleRef: "autonomy_p06", workspaceRef, scope: { level: "workspace", ref: workspaceRef }, mode: "approval_only", state: "published", effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null, killSwitch: false, maximumActionsPerRun: null };
      const action = { kind: "status_change" as const, entity: { level: "campaign" as const, ref: "campaign_12345" }, fromStatus: "ACTIVE" as const, toStatus: "PAUSED" as const };
      const actionPlan = buildActionPlan(action, { workspaceRef, accountGroupRef: null, accountRef: "act_12345", internalCategoryRefs: [], campaignRef: "campaign_12345", entity: action.entity, evaluatedAt: "2026-08-17T00:00:00.000Z", rules: [rule], budgetLimits: null, protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] }, frozenContextHash: contextHash });
      const staged = new ActionProposalStagingService({ version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_p06", revision: 1, autonomyMode: "approval_only", requesterRoles: ["operator"], approverRoles: [{ risk: "K2", roles: ["owner"] }], grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3600, maximumProposalLifetimeSeconds: 86400, maximumGrantLifetimeSeconds: 300 }).stage({ plan: { planRef: "plan_p06", revision: 1, planHash: "f".repeat(64) }, workspaceRef, accountRef: "act_12345", requester: { actorRef: "actor_p06", role: "operator" }, proposedAt: "2026-08-17T00:01:00.000Z", expiresAt: "2026-08-18T00:01:00.000Z", units: [{ unitKey: "unit_p06_pause", plan: { planRef: "plan_p06", revision: 1, planHash: "f".repeat(64) }, actionPlan, workspaceRef, accountRef: "act_12345", entityRef: "campaign_12345", actionType: actionPlan.actionType, risk: actionPlan.risk, actionHash: digest(actionPlan.action), dependencies: [], summary: { safety: "public_safe", before: { label: "Önce", value: "Aktif" }, after: { label: "Sonra", value: "Duraklat" }, evidence: [{ evidenceRef: "evidence_p06", label: "Kanıt" }] } }] });
      const queue = new DrizzleActionProposalQueueRepository(outerDb, workspaceId);
      evidence.actionQueuePersisted = (await queue.appendInitial(staged)).outcome === "inserted" && (await queue.appendInitial(staged)).outcome === "unchanged";
      mark("canonical_action_bundle_persisted");
      const unit = staged.bundle.units[0]!;
      const runs = new DrizzleGuideRunRepository(outerDb);
      const makeCompleted = async (requestRef: string, token: string) => {
        let run = createGuideRunV12({ workspaceRef, guideRef, guideRevisionHash: revisionHash, trigger: { kind: "manual", requestRef }, occurredAt: "2026-08-17T00:00:00.000Z" });
        await runs.insertIfAbsent(run);
        for (const [state, at] of [["claimed", "2026-08-17T00:00:01.000Z"], ["scope_frozen", "2026-08-17T00:00:02.000Z"], ["analyzing", "2026-08-17T00:00:03.000Z"], ["recorded", "2026-08-17T00:00:04.000Z"], ["staged", "2026-08-17T00:00:05.000Z"], ["completed", "2026-08-17T00:00:06.000Z"]] as const) {
          run = transition(run, state, at, token); if (!await runs.compareAndSet({ run, expectedHeadHash: run.events.at(-2)!.eventHash })) throw new Error("run_cas_failed");
        }
        const candidate = { candidateRef: "candidate_p06_fixture", candidateHash: unit.sourceHash, action: unit.scope.actionType as "status_pause", routing: "human_approval" as const };
        const payload = { disposition: { state: "staged", reason: "candidate_ready", recommendationRef: "recommendation_p06_fixture", candidate, authority: { canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } }, trusted: { dataQuality: "ready", evidenceHash: "1".repeat(64) }, analysisOutcome: "no_change", guideRevisionHash: revisionHash, mode: "observe_analyze", actionAllowlist: [candidate.action] } as const;
        await runs.append({ artifactRef: `guide_run_artifact_${digest({ runRef: run.runRef, kind: "disposition", payload }).slice(0, 24)}`, runRef: run.runRef, kind: "disposition", payload, payloadHash: digest(payload), occurredAt: "2026-08-17T00:00:07.000Z", authority: closed, immutable: true });
        return run;
      };
      const first = await makeCompleted("request_p06_first", "11111111-1111-4111-8111-111111111111");
      mark("completed_run_and_disposition_artifact_persisted");
      evidence.completedRun = first.state === "completed";
      const binding = new DrizzleGuideRunActionBindingRepository(outerDb);
      const saved = await binding.bind({ workspaceId, runRef: first.runRef }); const replay = await binding.bind({ workspaceId, runRef: first.runRef });
      evidence.materialized = saved.replay === false; evidence.replay = replay.replay === true && replay.bindingId === saved.bindingId;
      mark("materializer_and_replay_verified");
      const second = await makeCompleted("request_p06_second", "22222222-2222-4222-8222-222222222222");
      mark("second_completed_run_for_negative_matrix_persisted");
      const base = rows(await db.execute(sql`select b.id::text binding_id,a.id::text artifact_id from guide_run_action_bindings b join guide_run_artifacts a on a.workspace_id=b.workspace_id and a.id=b.disposition_artifact_id where b.workspace_id=${workspaceId}::uuid and b.run_id=(select id from guide_runs where workspace_id=${workspaceId}::uuid and run_ref=${first.runRef})`))[0]!;
      evidence.candidateTamperRejected = await rejected(client, () => client.query("update guide_run_artifacts set payload=jsonb_set(payload,'{disposition,candidate,candidateHash}','\\\"0\\\"'::jsonb) where id=$1::uuid", [base.artifact_id]));
      evidence.refHashAuthorityTamperRejected = await rejected(client, () => client.query("update guide_run_artifacts set authority='{}'::jsonb where id=$1::uuid", [base.artifact_id]));
      mark("artifact_candidate_ref_hash_authority_tamper_rejected");
      const secondIds = rows(await db.execute(sql`select r.id::text run_id,r.guide_revision_id::text revision_id,a.id::text artifact_id,u.id::text unit_id,p.id::text proposal_id from guide_runs r join guide_run_artifacts a on a.workspace_id=r.workspace_id and a.run_id=r.id join action_proposal_units u on u.workspace_id=r.workspace_id and u.unit_ref=${unit.unitRef} join action_proposal_bundles p on p.workspace_id=u.workspace_id and p.id=u.bundle_id where r.workspace_id=${workspaceId}::uuid and r.run_ref=${second.runRef}`))[0]!;
      const insert = (o: Record<string, string> = {}, tenant = workspaceId) => client.query("insert into guide_run_action_bindings(workspace_id,run_id,guide_revision_id,disposition_artifact_id,action_unit_id,proposal_bundle_id,action_unit_ref,action_unit_hash,proposal_ref,proposal_hash,entity_ref,slice_ref,market_key,effective_guide_set_hash,resolution_hash) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [tenant, secondIds.run_id, secondIds.revision_id, secondIds.artifact_id, secondIds.unit_id, secondIds.proposal_id, o.unitRef ?? unit.unitRef, o.unitHash ?? unit.unitHash, o.proposalRef ?? staged.bundle.bundleRef, o.proposalHash ?? staged.bundle.bundleHash, o.entityRef ?? "campaign_12345", o.sliceRef ?? "slice_p06_fixture", o.marketKey ?? "yerli", o.guideHash ?? digest({ guideRef, guideRevisionHash: revisionHash, sliceRef: "slice_p06_fixture", market: "yerli" }), o.resolutionHash ?? digest({ guideRevisionHash: revisionHash, candidateHash: unit.sourceHash, actionUnitHash: unit.unitHash, proposalHash: staged.bundle.bundleHash })]);
      evidence.wrongScopeRejected = (await rejected(client, () => insert({ entityRef: "campaign_wrong" }))) && (await rejected(client, () => insert({ sliceRef: "slice_wrong" }))) && (await rejected(client, () => insert({ marketKey: "yabanci" })));
      evidence.crossTenantRejected = await rejected(client, () => insert({}, foreignWorkspaceId));
      mark("scope_and_cross_tenant_rejected");
      evidence.appendDeleteGuard = (await rejected(client, () => client.query("update guide_run_action_bindings set decision='approved' where id=$1::uuid", [base.binding_id]))) && (await rejected(client, () => client.query("delete from guide_run_action_bindings where id=$1::uuid", [base.binding_id])));
      await client.query("savepoint p06_stale_guide_head");
      await client.query("set local session_replication_role=replica");
      await client.query("update guide_heads set current_active_revision_id=null where workspace_id=$1::uuid and guide_id=$2::uuid", [workspaceId, guideId]);
      await client.query("set local session_replication_role=origin");
      try { await binding.bind({ workspaceId, runRef: first.runRef }); } catch { evidence.staleGuideHeadRejected = true; }
      await client.query("rollback to savepoint p06_stale_guide_head");
      const purge = new DrizzleWorkspaceTombstonePurgePort(); await client.query("update workspaces set lifecycle_state='tombstoning' where id=$1::uuid", [workspaceId]);
      const inspection = await purge.inspect(outerDb, workspaceId); await purge.purge(outerDb, { workspaceId, expectedRevision: inspection.revision });
      const remaining = await client.query<{ n: string }>("select ((select count(*) from guide_run_action_bindings where workspace_id=$1::uuid)+(select count(*) from guide_runs where workspace_id=$1::uuid)+(select count(*) from guide_run_artifacts where workspace_id=$1::uuid))::text n", [workspaceId]);
      evidence.tombstonePurge = remaining.rows[0]?.n === "0";
      mark("tombstone_purge_verified");
      throw rollback;
    } catch (error) {
      if (error !== rollback) throw error;
    } finally { await client.query("rollback").catch(() => undefined); }
  } finally { client.release(); }
  const residue = await pool.query<{ n: string }>("select count(*)::text n from pg_class where oid=to_regclass('public.guide_run_action_bindings')");
  evidence.zeroResidue = residue.rows[0]?.n === "0";
  if (!Object.values(evidence).filter((x) => typeof x === "boolean").every(Boolean)) throw new Error(JSON.stringify(evidence));
  console.log(JSON.stringify(evidence));
} finally { await pool.end(); }
