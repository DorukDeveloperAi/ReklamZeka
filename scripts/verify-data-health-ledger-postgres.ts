/** Post-apply acceptance: repository writes are always rolled back with the fixture transaction. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import { DrizzleDataHealthFindingDevelopmentLogRepository } from "@/connectors/meta/data-health-finding-development-log-drizzle-repository";
import { buildMetaDataHealthReport, type MetaDataHealthAccountEvidence } from "@/domain/meta/data-health";
import { projectMetaDataHealthObservationEvents } from "@/domain/meta/data-health-observation-lifecycle";
import { publicSource } from "@/domain/source/public-source";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("postgres_connection_not_configured");

const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 8_000 });
const tables = ["finding_lifecycle_events", "finding_heads", "development_log_events", "development_log_heads"] as const;
const mode = process.env.DATA_HEALTH_LEDGER_VERIFY_MODE ?? "post_apply";
const zero = "0".repeat(64);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const workspaceRef = (id: string) => `workspace_${hash(id).slice(0, 24)}`;
const accountRef = (id: string) => `account_${hash(`account:${id}`).slice(0, 24)}`;
const rows = <T>(result: unknown): readonly T[] => result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
  ? result.rows as readonly T[] : [];
const report = (workspaceId: string, occurredAt: string, healthy: boolean) => {
  const source = (kind: "canonical_meta_mirror" | "canonical_performance" | "derived_trust") => publicSource({ kind,
    state: "ready", observedAt: occurredAt, freshnessAt: occurredAt, freshnessThresholdMinutes: 1_440, reasonCodes: [] });
  const account: MetaDataHealthAccountEvidence = {
    accountRef: accountRef(workspaceId), currency: "TRY",
    sources: { mirror: source("canonical_meta_mirror"), performance: source("canonical_performance"), trust: source("derived_trust") },
    requiredDates: ["2026-08-16"], observedDates: healthy ? ["2026-08-16"] : [],
    requiredFields: ["campaign"], observedFields: ["campaign"],
  };
  return buildMetaDataHealthReport({ workspaceRef: workspaceRef(workspaceId), workspaceCurrency: "TRY", evaluatedAt: occurredAt, accounts: [account] });
};
async function rejected(client: PoolClient, work: () => Promise<unknown>) {
  await client.query("savepoint data_health_ledger_negative");
  try { await work(); await client.query("release savepoint data_health_ledger_negative"); return false; }
  catch { await client.query("rollback to savepoint data_health_ledger_negative"); return true; }
}

const client = await pool.connect();
let second: PoolClient | undefined;
const evidence = {
  outerRollback: false, repositoryMaterialized: false, exactReplay: false, observed: false, resolved: false, reopened: false,
  triagePreserved: false, tamperRejected: false, staleCasRejected: false, crossTenantRejected: false,
  concurrentLostHeadPrevented: false, rlsForced: false, zeroResidue: false,
};
try {
  const found = await client.query("select relname from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])", [tables]);
  if (mode === "pre_apply") {
    if (found.rows.length) throw new Error("migration_already_applied");
    await client.query("begin");
    await client.query(readFileSync("drizzle/20260817160000_data_health_finding_development_log_ledger.sql", "utf8"));
  } else if (mode === "post_apply") {
    if (found.rows.length !== tables.length) throw new Error("migration_not_applied");
    await client.query("begin");
  } else throw new Error("invalid_verify_mode");

  const workspaceId = randomUUID(); const foreignWorkspaceId = randomUUID(); const userId = randomUUID();
  try {
    const security = (await client.query(`select count(*) filter (where relrowsecurity and relforcerowsecurity)::int as forced
      from pg_class where oid = any(array[${tables.map(table => `'public.${table}'::regclass`).join(",")}])`)).rows[0];
    evidence.rlsForced = Number(security?.forced) === tables.length;
    await client.query("insert into users(id,email) values($1,$2)", [userId, `data-health-${userId}@example.test`]);
    await client.query("insert into workspaces(id,name) values($1,'data health verifier'),($2,'data health foreign')", [workspaceId, foreignWorkspaceId]);
    await client.query("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')", [workspaceId, userId]);

    // Bound to the raw outer client; the execution context prevents a nested BEGIN.
    const execution = drizzle(client, { schema });
    const repository = new DrizzleDataHealthFindingDevelopmentLogRepository(execution as never);
    const firstAt = "2026-08-17T12:00:00.000Z";
    const firstReport = report(workspaceId, firstAt, false);
    const first = await repository.materialize({ workspaceId, report: firstReport, occurredAt: firstAt }, execution as never);
    evidence.repositoryMaterialized = first.outcome === "inserted" && first.eventHashes.length === 1;
    const replay = await repository.materialize({ workspaceId, report: firstReport, occurredAt: firstAt }, execution as never);
    evidence.exactReplay = replay.outcome === "unchanged" && replay.eventHashes[0] === first.eventHashes[0];
    const fingerprint = rows<{ fingerprint: string }>(await execution.execute(`select fingerprint from finding_heads where workspace_id='${workspaceId}'::uuid`))[0]?.fingerprint;
    if (!fingerprint) throw new Error("repository_did_not_create_finding_head");
    await repository.triage({ workspaceId, userId, namespace: "meta_data_health", resolutionScope: workspaceRef(workspaceId), fingerprint,
      state: "triaged", occurredAt: "2026-08-17T12:10:00.000Z", payload: { verifier: true } }, execution as never);

    const observedAt = "2026-08-18T12:00:00.000Z";
    const observedRun = await repository.materialize({ workspaceId, report: report(workspaceId, observedAt, false), occurredAt: observedAt }, execution as never);
    const observedHead = rows<{ sequence: number; state: string }>(await execution.execute(`select sequence,state from development_log_heads where workspace_id='${workspaceId}'::uuid and fingerprint='${fingerprint}'`))[0];
    evidence.observed = observedRun.outcome === "inserted";
    evidence.triagePreserved = observedHead?.state === "triaged" && Number(observedHead.sequence) === 3;
    const resolvedAt = "2026-08-19T12:00:00.000Z";
    const resolvedRun = await repository.materialize({ workspaceId, report: report(workspaceId, resolvedAt, true), occurredAt: resolvedAt }, execution as never);
    evidence.resolved = resolvedRun.outcome === "inserted" && rows<{ state: string }>(await execution.execute(`select state from finding_heads where workspace_id='${workspaceId}'::uuid and fingerprint='${fingerprint}'`))[0]?.state === "resolved";
    const reopenedAt = "2026-08-20T12:00:00.000Z";
    const reopenedRun = await repository.materialize({ workspaceId, report: report(workspaceId, reopenedAt, false), occurredAt: reopenedAt }, execution as never);
    evidence.reopened = reopenedRun.outcome === "inserted" && rows<{ sequence: number; state: string }>(await execution.execute(`select sequence,state from finding_heads where workspace_id='${workspaceId}'::uuid and fingerprint='${fingerprint}'`))[0]?.state === "open";

    evidence.tamperRejected = await rejected(client, () => client.query("update finding_lifecycle_events set state='resolved' where workspace_id=$1", [workspaceId]));
    const staleEvents = projectMetaDataHealthObservationEvents({ workspaceRef: workspaceRef(workspaceId), report: report(workspaceId, "2026-08-21T12:00:00.000Z", false), previousHeads: [], occurredAt: "2026-08-21T12:00:00.000Z" });
    evidence.staleCasRejected = await rejected(client, () => repository.append({ workspaceId, events: staleEvents }, execution as never));
    const eventHash = rows<{ event_hash: string }>(await execution.execute(`select event_hash from finding_lifecycle_events where workspace_id='${workspaceId}'::uuid order by sequence limit 1`))[0]?.event_hash;
    if (!eventHash) throw new Error("finding_event_missing");
    evidence.crossTenantRejected = await rejected(client, () => client.query(`insert into development_log_events(workspace_id,namespace,resolution_scope,fingerprint,sequence,finding_event_hash,source_occurrence_hash,category,state,event_type,actor_kind,actor_user_id,previous_event_hash,event_hash,occurred_at,payload) values($1,'meta_data_health',$2,$3,1,$4,$5,'data','proposed','proposed','system',null,$6,$7,now(),'{}'::jsonb)`, [foreignWorkspaceId, workspaceRef(workspaceId), fingerprint, eventHash, hash("foreign-source"), zero, hash("foreign-event")]));

    await client.query("select 1 from finding_heads where workspace_id=$1 and namespace='meta_data_health' and resolution_scope=$2 and fingerprint=$3 for update", [workspaceId, workspaceRef(workspaceId), fingerprint]);
    second = await pool.connect(); await second.query("set lock_timeout='150ms'");
    try { await second.query("select 1 from finding_heads where workspace_id=$1 and namespace='meta_data_health' and resolution_scope=$2 and fingerprint=$3 for update", [workspaceId, workspaceRef(workspaceId), fingerprint]); }
    catch { evidence.concurrentLostHeadPrevented = true; }
  } finally {
    await client.query("rollback");
    evidence.outerRollback = true;
  }
  const remaining = await client.query("select (select count(*)::int from users where id=$1) + (select count(*)::int from workspaces where id in ($1,$2)) as count", [userId, workspaceId]);
  const liveTables = await client.query("select relname from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])", [tables]);
  const noFixtureRows = Number(remaining.rows[0]?.count) === 0;
  const expectedSchema = mode === "pre_apply" ? liveTables.rows.length === 0 : liveTables.rows.length === tables.length;
  evidence.zeroResidue = noFixtureRows && expectedSchema;
} finally {
  second?.release(); client.release(); await pool.end();
}
if (!Object.values(evidence).every(Boolean)) throw new Error(`data_health_ledger_verification_failed:${JSON.stringify(evidence)}`);
console.log(JSON.stringify({ ok: true, mode, ...evidence }));
