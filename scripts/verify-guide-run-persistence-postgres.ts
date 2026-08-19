import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DrizzleGuideRunRepository } from "@/connectors/guides/guide-run-drizzle-repository";
import { DrizzleGuideRunP01LedgerProjector } from "@/connectors/guides/guide-run-p01-ledger-projector";
import { DrizzleDataHealthFindingDevelopmentLogRepository } from "@/connectors/meta/data-health-finding-development-log-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { appendGuideRunTransitionV12, createGuideRunV12 } from "@/domain/guides/guide-run";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
/** Matches the GuideRun domain's JavaScript UTF-16 lexical key order. */
const stableHash = (value: unknown) => { const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)])) : item; return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); };
const names = ["guide_runs", "guide_run_events", "guide_run_heads", "guide_run_artifacts", "guide_run_schedule_receipts"];
let appliedOuterRollback = false, rlsForced = false, publicRevoked = false, appendOnlyTriggers = false, zeroResidue = false;
let repositoryReplay = false, singleClientCas = false, fencingAndReclaim = false, directLifecycleProbes = false, canonicalJsonVectors = false, nullForgeryRejected = false, activeLeaseNullForgeryRejected = false, forgedScheduleReceiptRejected = false, immutableArtifact = false, schedulerReceiptReplay = false, crashResume = false, p01LedgerReplay = false, humanTriagePreserved = false, tamperRejected = false, forgedArtifactRejected = false, tenantFkRejected = false, tombstonePurge = false;
// PostgreSQL cannot expose uncommitted DDL to a second connection. Real
// independent-client races are therefore a mandatory POST-only check against
// the applied migration, never a fake same-client PRE substitute.
const preApplyConcurrencySkipped = true;
try {
  const client = await pool.connect();
  try {
    let open = false;
    await client.query("begin"); open = true;
    try {
    await client.query(readFileSync("drizzle/20260817180000_guide_run_persistence.sql", "utf8"));
    const shape = await client.query<{ name: string; relforcerowsecurity: boolean }>(`select c.relname name,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`, [names]);
    appliedOuterRollback = shape.rows.length === names.length;
    rlsForced = shape.rows.every(row => row.relforcerowsecurity);
    const grants = await client.query<{ n: string }>(`select count(*)::text n from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('PUBLIC','anon','authenticated','service_role')`, [names]);
    publicRevoked = grants.rows[0]?.n === "0";
    const triggers = await client.query<{ n: string }>(`select count(*)::text n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) and not t.tgisinternal`, [names]);
    appendOnlyTriggers = Number(triggers.rows[0]?.n ?? 0) === 7;
    const workspaceId = randomUUID(), foreignWorkspaceId = randomUUID(), guideId = randomUUID(), revisionId = randomUUID();
    const workspaceRef = canonicalGuideWorkspaceRef(workspaceId);
    const guideRef = "guide_p05_persistence_fixture", revisionHash = "a".repeat(64);
    await client.query("set local session_replication_role=replica");
    await client.query("insert into workspaces(id,name) values($1,'P05 persistence'),($2,'P05 foreign')", [workspaceId, foreignWorkspaceId]);
    await client.query("insert into guides(id,workspace_id,guide_ref,label,slice_id,market_definition_id,created_by_actor_id) values($1,$2,$3,'P05',$4,$5,$6)", [guideId, workspaceId, guideRef, randomUUID(), randomUUID(), randomUUID()]);
    await client.query("insert into guide_revisions(id,workspace_id,guide_id,guide_ref,revision_number,revision_hash,slice_revision_id,slice_ref,market_definition_id,market_key,free_text,strict_payload,schedule_payload,mode,interpretation_hash,created_by_actor_id) values($1,$2,$3,$4,1,$5,$6,'slice_p05_fixture',$7,'yerli','fixture','{}','{}','observe_analyze',$8,$9)", [revisionId, workspaceId, guideId, guideRef, revisionHash, randomUUID(), randomUUID(), "b".repeat(64), randomUUID()]);
    await client.query("insert into guide_heads(workspace_id,guide_id,latest_revision_id,current_active_revision_id,version,updated_at) values($1,$2,$3,$3,1,'2026-08-17T00:00:00.000Z')", [workspaceId, guideId, revisionId]);
    const actorId = randomUUID(); await client.query("insert into users(id,email) values($1,'p05-ledger@example.test')", [actorId]); await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')", [workspaceId, actorId]);
    await client.query("set local session_replication_role=origin");
    const database = drizzle(client, { schema });
    // The verifier owns the outer rollback. Avoid nested BEGIN/COMMIT on the
    // same pg client, which would otherwise commit the migration fixture.
    const repository = new DrizzleGuideRunRepository({ execute: database.execute.bind(database), transaction: async (work: (tx: typeof database) => Promise<unknown>) => await work(database) } as never);
    const due = createGuideRunV12({ workspaceRef, guideRef, guideRevisionHash: revisionHash, trigger: { kind: "manual", requestRef: "request_p05_fixture" }, occurredAt: "2026-08-17T00:00:00.000Z" });
    const inserted = await repository.insertIfAbsent(due); const replay = await repository.insertIfAbsent(due);
    repositoryReplay = inserted.runRef === due.runRef && replay.headEventHash === due.headEventHash;
    const tokenOne = "11111111-1111-4111-8111-111111111111", tokenTwo = "22222222-2222-4222-8222-222222222222";
    const claimed = appendGuideRunTransitionV12(due, { expectedHeadHash: due.headEventHash, toState: "claimed", occurredAt: "2026-08-17T00:00:01.000Z", leaseToken: tokenOne, leaseUntil: "2026-08-17T00:01:00.000Z" });
    const first = await repository.compareAndSet({ run: claimed, expectedHeadHash: due.headEventHash }); const second = await repository.compareAndSet({ run: claimed, expectedHeadHash: due.headEventHash });
    singleClientCas = first?.headEventHash === claimed.headEventHash && second === null;
    const liveFence = await repository.fence({ runRef: due.runRef, expectedHeadHash: claimed.headEventHash, leaseToken: tokenOne, leaseEpoch: 1, now: "2026-08-17T00:00:02.000Z" });
    const renewed = appendGuideRunTransitionV12(claimed, { expectedHeadHash: claimed.headEventHash, toState: "claimed", occurredAt: "2026-08-17T00:00:30.000Z", leaseToken: tokenOne, leaseUntil: "2026-08-17T00:01:30.000Z" });
    const renewSaved = await repository.compareAndSet({ run: renewed, expectedHeadHash: claimed.headEventHash });
    const reclaimed = appendGuideRunTransitionV12(renewed, { expectedHeadHash: renewed.headEventHash, toState: "claimed", occurredAt: "2026-08-17T00:02:00.000Z", leaseToken: tokenTwo, leaseUntil: "2026-08-17T00:03:00.000Z" });
    const reclaimSaved = await repository.compareAndSet({ run: reclaimed, expectedHeadHash: renewed.headEventHash });
    const staleFence = await repository.fence({ runRef: due.runRef, expectedHeadHash: reclaimed.headEventHash, leaseToken: tokenOne, leaseEpoch: 2, now: "2026-08-17T00:02:01.000Z" });
    const newFence = await repository.fence({ runRef: due.runRef, expectedHeadHash: reclaimed.headEventHash, leaseToken: tokenTwo, leaseEpoch: 3, now: "2026-08-17T00:02:01.000Z" });
    const failedDue = createGuideRunV12({ workspaceRef, guideRef, guideRevisionHash: revisionHash, trigger: { kind: "manual", requestRef: "request_p05_due_failed" }, occurredAt: "2026-08-17T00:00:00.000Z" });
    await repository.insertIfAbsent(failedDue);
    const failed = appendGuideRunTransitionV12(failedDue, { expectedHeadHash: failedDue.headEventHash, toState: "failed", occurredAt: "2026-08-17T00:00:01.000Z", reasonCode: "source_missing" });
    const failedSaved = await repository.compareAndSet({ run: failed, expectedHeadHash: failedDue.headEventHash });
    fencingAndReclaim = liveFence !== null && reclaimSaved?.headEventHash === reclaimed.headEventHash && staleFence === null && newFence !== null;
    directLifecycleProbes = renewSaved?.lease?.epoch === 2 && renewSaved.lease.token === tokenOne && reclaimSaved?.lease?.epoch === 3 && reclaimSaved.lease.token === tokenTwo && failedSaved?.state === "failed" && failedSaved.lease === null;
    const vector = { Alpha: "x", alpha: "y" };
    const vectorHash = stableHash(vector);
    const sqlVector = await client.query<{ hash: string }>("select public.guide_run_sha256($1::jsonb) hash", [JSON.stringify(vector)]);
    let exponentRejected = false, fractionRejected = false;
    await client.query("savepoint p05_expected_unsupported_numbers");
    try { await client.query("select public.guide_run_sha256('{\"n\":1e21}'::jsonb)"); } catch { exponentRejected = true; await client.query("rollback to savepoint p05_expected_unsupported_numbers"); }
    await client.query("savepoint p05_expected_fraction_number");
    try { await client.query("select public.guide_run_sha256('{\"n\":1e-7}'::jsonb)"); } catch { fractionRejected = true; await client.query("rollback to savepoint p05_expected_fraction_number"); }
    canonicalJsonVectors = sqlVector.rows[0]?.hash === vectorHash && exponentRejected && fractionRejected;
    // Regression: raw event insertion can precede the head advance. The head
    // guard itself must reject JSON null mandatory scalars.
    const forgedDue = createGuideRunV12({ workspaceRef, guideRef, guideRevisionHash: revisionHash, trigger: { kind: "manual", requestRef: "request_p05_null_forgery" }, occurredAt: "2026-08-17T00:00:00.000Z" });
    await repository.insertIfAbsent(forgedDue);
    const forgedFailed = appendGuideRunTransitionV12(forgedDue, { expectedHeadHash: forgedDue.headEventHash, toState: "failed", occurredAt: "2026-08-17T00:00:01.000Z", reasonCode: "source_missing" });
    const forgedBody = { ...forgedFailed.events.at(-1)!, version: null, eventRef: undefined, eventHash: undefined };
    const forgedHash = stableHash(forgedBody);
    const forgedEvent = { ...forgedBody, eventRef: "guide_run_event_" + forgedHash.slice(0, 24), eventHash: forgedHash };
    const forgedRun = { ...forgedFailed, headEventHash: forgedHash, events: [...forgedFailed.events.slice(0, -1), forgedEvent], authority: null };
    const forgedRunId = (await client.query<{ id: string }>("select id::text id from guide_runs where run_ref=$1", [forgedDue.runRef])).rows[0]!.id;
    await client.query("savepoint p05_expected_null_scalar_forgery");
    try {
      await client.query("insert into guide_run_events(workspace_id,run_id,event_ref,event_hash,sequence,previous_event_hash,payload,occurred_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [workspaceId, forgedRunId, forgedEvent.eventRef, forgedEvent.eventHash, forgedEvent.sequence, forgedEvent.previousEventHash, JSON.stringify(forgedEvent), forgedEvent.occurredAt]);
      await client.query("update guide_run_heads set state=$1,sequence=$2,head_event_hash=$3,run_payload=$4::jsonb,updated_at=$5 where workspace_id=$6 and run_id=$7", [forgedRun.state, forgedRun.sequence, forgedRun.headEventHash, JSON.stringify(forgedRun), forgedEvent.occurredAt, workspaceId, forgedRunId]);
    } catch { nullForgeryRejected = true; await client.query("rollback to savepoint p05_expected_null_scalar_forgery"); }
    const activeDue = createGuideRunV12({ workspaceRef, guideRef, guideRevisionHash: revisionHash, trigger: { kind: "manual", requestRef: "request_p05_active_lease_null" }, occurredAt: "2026-08-17T00:00:00.000Z" });
    await repository.insertIfAbsent(activeDue);
    const activeClaimed = appendGuideRunTransitionV12(activeDue, { expectedHeadHash: activeDue.headEventHash, toState: "claimed", occurredAt: "2026-08-17T00:00:01.000Z", leaseToken: tokenOne, leaseUntil: "2026-08-17T00:01:00.000Z" });
    const activeBody = { ...activeClaimed.events.at(-1)!, leaseToken: null, leaseEpoch: null, leaseUntil: null, eventRef: undefined, eventHash: undefined };
    const activeHash = stableHash(activeBody);
    const activeEvent = { ...activeBody, eventRef: "guide_run_event_" + activeHash.slice(0, 24), eventHash: activeHash };
    const activeRun = { ...activeClaimed, headEventHash: activeHash, events: [...activeClaimed.events.slice(0, -1), activeEvent] };
    const activeRunId = (await client.query<{ id: string }>("select id::text id from guide_runs where run_ref=$1", [activeDue.runRef])).rows[0]!.id;
    await client.query("savepoint p05_expected_active_lease_null_forgery");
    try {
      await client.query("insert into guide_run_events(workspace_id,run_id,event_ref,event_hash,sequence,previous_event_hash,payload,occurred_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [workspaceId, activeRunId, activeEvent.eventRef, activeEvent.eventHash, activeEvent.sequence, activeEvent.previousEventHash, JSON.stringify(activeEvent), activeEvent.occurredAt]);
      await client.query("update guide_run_heads set state=$1,sequence=$2,head_event_hash=$3,lease_token=$4::uuid,lease_epoch=$5,lease_expires_at=$6::timestamptz,run_payload=$7::jsonb,updated_at=$8 where workspace_id=$9 and run_id=$10", [activeRun.state, activeRun.sequence, activeRun.headEventHash, tokenOne, 1, "2026-08-17T00:01:00.000Z", JSON.stringify(activeRun), activeEvent.occurredAt, workspaceId, activeRunId]);
    } catch { activeLeaseNullForgeryRejected = true; await client.query("rollback to savepoint p05_expected_active_lease_null_forgery"); }
    const artifactPayload = { runRef: due.runRef, guideRevisionHash: revisionHash, sliceRef: "slice_p05_fixture", sliceDefinitionHash: "c".repeat(64), sliceSnapshotHash: "d".repeat(64), members: [] };
    const artifactRef = `guide_run_artifact_${stableHash({ runRef: due.runRef, kind: "scope_snapshot", payload: artifactPayload }).slice(0, 24)}`;
    await repository.append({ artifactRef, runRef: due.runRef, kind: "scope_snapshot", payload: artifactPayload, payloadHash: stableHash(artifactPayload), occurredAt: "2026-08-17T00:02:01.000Z", authority: { canMutateGuide: false, canApprove: false, canExecute: false, canWriteMeta: false }, immutable: true });
    await repository.append({ artifactRef, runRef: due.runRef, kind: "scope_snapshot", payload: artifactPayload, payloadHash: stableHash(artifactPayload), occurredAt: "2026-08-17T00:02:01.000Z", authority: { canMutateGuide: false, canApprove: false, canExecute: false, canWriteMeta: false }, immutable: true });
    immutableArtifact = (await repository.list(due.runRef)).length === 1;
    const receipt = { workspaceId, guideRevisionId: revisionId, scheduledFor: "2026-08-17T00:00:00.000Z", missedFrom: "2026-08-16T00:00:00.000Z", missedTo: "2026-08-16T23:00:00.000Z", missedCount: 1, runRef: due.runRef, createdAt: "2026-08-17T00:02:01.000Z" } as const;
    await repository.recordScheduleReceipt(receipt); await repository.recordScheduleReceipt(receipt);
    schedulerReceiptReplay = Number((await client.query("select count(*)::text n from guide_run_schedule_receipts")).rows[0]?.n) === 1;
    await client.query("savepoint p05_expected_forged_schedule_receipt");
    try {
      const runId = (await client.query<{ id: string }>("select id::text id from guide_runs where run_ref=$1", [due.runRef])).rows[0]!.id;
      await client.query("insert into guide_run_schedule_receipts(workspace_id,guide_revision_id,fire_ref,scheduled_for,missed_from,missed_to,missed_count,run_id,receipt_hash,created_at) values($1,$2,$3,$4,null,null,0,$5,$6,$7)", [workspaceId, revisionId, "guide_fire_" + "f".repeat(64), "2026-08-17T00:10:00.000Z", runId, "e".repeat(64), "2026-08-17T00:10:01.000Z"]);
    } catch { forgedScheduleReceiptRejected = true; await client.query("rollback to savepoint p05_expected_forged_schedule_receipt"); }
    const resumed = await repository.findByIdempotencyKey({ workspaceRef, idempotencyKey: due.idempotencyKey });
    crashResume = resumed?.headEventHash === reclaimed.headEventHash && (await repository.list(due.runRef)).length === 1;
    const projector = new DrizzleGuideRunP01LedgerProjector({ execute: database.execute.bind(database), transaction: async (work: (tx: typeof database) => Promise<unknown>) => await work(database) } as never);
    const authority = { canMutateGuide: false, canApprove: false, canExecute: false, canWriteMeta: false } as const;
    const observation = { observationRef: "finding_observation_p05_fixture", findingRef: "finding_p05_fixture", evidenceHash: "f".repeat(64), fingerprint: "c".repeat(64), observationEvidenceHash: "f".repeat(64), lifecycle: "observed" as const, source: "holistic" as const, memberRef: null, authority };
    const developmentLog = { category: "agent_proposed_analysis" as const, producer: "agent" as const, state: "proposed" as const, outcome: "finding" as const, candidateRef: null, recommendationRef: "recommendation_p05_fixture", authority };
    await repository.append({ artifactRef: `guide_run_artifact_${stableHash({ runRef: due.runRef, kind: "finding_observation", payload: observation }).slice(0, 24)}`, runRef: due.runRef, kind: "finding_observation", payload: observation, payloadHash: stableHash(observation), occurredAt: "2026-08-17T00:02:01.000Z", authority, immutable: true });
    await repository.append({ artifactRef: `guide_run_artifact_${stableHash({ runRef: due.runRef, kind: "development_log_intent", payload: developmentLog }).slice(0, 24)}`, runRef: due.runRef, kind: "development_log_intent", payload: developmentLog, payloadHash: stableHash(developmentLog), occurredAt: "2026-08-17T00:02:01.000Z", authority, immutable: true });
    await projector.projectPersisted({ workspaceId, runRef: due.runRef }); await projector.projectPersisted({ workspaceId, runRef: due.runRef });
    p01LedgerReplay = Number((await client.query("select count(*)::text n from finding_lifecycle_events where namespace='guide_run'")).rows[0]?.n) === 1 && Number((await client.query("select count(*)::text n from development_log_events where namespace='guide_run'")).rows[0]?.n) === 1;
    const generic = new DrizzleDataHealthFindingDevelopmentLogRepository({ transaction: async (work: (tx: typeof database) => Promise<unknown>) => await work(database) } as never);
    await generic.triage({ workspaceId, userId: actorId, namespace: "guide_run", resolutionScope: due.runRef, fingerprint: observation.fingerprint, state: "triaged", occurredAt: "2026-08-17T00:02:02.000Z", payload: { source: "fixture" } });
    const secondObservation = { ...observation, observationRef: "finding_observation_p05_fixture_second", evidenceHash: "e".repeat(64), observationEvidenceHash: "e".repeat(64) };
    await repository.append({ artifactRef: `guide_run_artifact_${stableHash({ runRef: due.runRef, kind: "finding_observation", payload: secondObservation }).slice(0, 24)}`, runRef: due.runRef, kind: "finding_observation", payload: secondObservation, payloadHash: stableHash(secondObservation), occurredAt: "2026-08-17T00:02:03.000Z", authority, immutable: true });
    await projector.projectPersisted({ workspaceId, runRef: due.runRef }); await projector.projectPersisted({ workspaceId, runRef: due.runRef });
    const triage = (await client.query("select state,sequence from development_log_heads where namespace='guide_run' and resolution_scope=$1", [due.runRef])).rows[0]; humanTriagePreserved = triage?.state === "triaged" && Number(triage?.sequence) === 3;
    await client.query("savepoint p05_expected_artifact_tamper");
    try { await client.query("update guide_run_artifacts set payload='{}'::jsonb where artifact_ref=$1", [artifactRef]); } catch { tamperRejected = true; await client.query("rollback to savepoint p05_expected_artifact_tamper"); }
    await client.query("savepoint p05_expected_forged_artifact");
    try { await client.query("insert into guide_run_artifacts(workspace_id,run_id,artifact_ref,kind,payload_hash,payload,occurred_at,authority) values($1,$2,$3,'scope_snapshot',$4,'{}',$5,$6)", [workspaceId, (await client.query("select id from guide_runs where run_ref=$1", [due.runRef])).rows[0].id, "guide_run_artifact_" + "4".repeat(24), "4".repeat(64), "2026-08-17T00:02:04.000Z", JSON.stringify(authority)]); } catch { forgedArtifactRejected = true; await client.query("rollback to savepoint p05_expected_forged_artifact"); }
    const persistedRunId = (await client.query("select id from guide_runs where run_ref=$1", [due.runRef])).rows[0].id;
    await client.query("savepoint p05_expected_tenant_fk");
    try { await client.query("insert into guide_run_events(workspace_id,run_id,event_ref,event_hash,sequence,previous_event_hash,payload,occurred_at) values($1,$2,'guide_run_event_ffffffffffffffffffffffff',$3,99,$4,'{}',$5)", [foreignWorkspaceId, persistedRunId, "f".repeat(64), reclaimed.headEventHash, "2026-08-17T00:02:02.000Z"]); } catch { tenantFkRejected = true; await client.query("rollback to savepoint p05_expected_tenant_fk"); }
    // Exercise the real, allowlisted purge implementation after the workspace
    // transitions to tombstoning; ordinary immutable-row deletes remain denied.
    await client.query("update workspaces set lifecycle_state='tombstoning' where id=$1", [workspaceId]);
    const purge = new DrizzleWorkspaceTombstonePurgePort();
    const evidence = await purge.inspect(database as never, workspaceId);
    await purge.purge(database as never, { workspaceId, expectedRevision: evidence.revision });
    const purged = await client.query<{ table_name: string; n: string }>("select 'guide_runs' table_name,count(*)::text n from guide_runs where workspace_id=$1 union all select 'guide_run_events',count(*)::text from guide_run_events where workspace_id=$1 union all select 'guide_run_heads',count(*)::text from guide_run_heads where workspace_id=$1 union all select 'guide_run_artifacts',count(*)::text from guide_run_artifacts where workspace_id=$1 union all select 'guide_run_schedule_receipts',count(*)::text from guide_run_schedule_receipts where workspace_id=$1", [workspaceId]);
    tombstonePurge = purged.rows.length === 5 && purged.rows.every((row) => row.n === "0");
    await client.query("rollback"); open = false;
    } finally { if (open) await client.query("rollback").catch(() => undefined); }
  } finally { client.release(); }
  const verify = await pool.query<{ n: string }>(`select count(*)::text n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])`, [names]);
  zeroResidue = verify.rows[0]?.n === "0";
  const result = { mode: "pre_outer_rollback", preApplyConcurrencySkipped, appliedOuterRollback, rlsForced, publicRevoked, appendOnlyTriggers, repositoryReplay, singleClientCas, fencingAndReclaim, directLifecycleProbes, canonicalJsonVectors, nullForgeryRejected, activeLeaseNullForgeryRejected, forgedScheduleReceiptRejected, immutableArtifact, schedulerReceiptReplay, crashResume, p01LedgerReplay, humanTriagePreserved, tamperRejected, forgedArtifactRejected, tenantFkRejected, tombstonePurge, zeroResidue };
  if (!Object.values(result).filter(value => typeof value === "boolean").every(Boolean)) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify(result));
} finally { await pool.end(); }
