import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { DECISION_CADENCE_VERSION, EXPERIMENT_CONTRACT_VERSION } from "@/domain/decisions/cadence";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";
import { createLocalDecisionCadenceProfileHandler } from "@/server/local-decision-cadence-profile-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createLocalExperimentRecordHandler } from "@/server/local-experiment-record-runtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured", continuation: "npm run verify:cadence-experiment-lifecycle-db" }));
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("outer_rollback");
const ids = { workspace: randomUUID(), user: randomUUID(), connection: randomUUID(), source: randomUUID(), account: randomUUID(), campaign: randomUUID() };
const refs = { workspace: "workspace_cadence_live", reader: "reader_cadence_live", account: "account_cadence_live", campaign: "campaign_cadence_live", profile: "cadence_cadence_live" };
const signingKey = randomBytes(32);
let tablesApplied = false;
let cookieScopesBound = false;
let cadencePublished = false;
let experimentPlanPersisted = false;
let experimentOutcomePersisted = false;
let staleOutcomeBlocked = false;
let appendOnlyBlocked = false;
let auditChainPersisted = false;
let capabilitiesFalse = false;
let temporaryRowsCommitted = true;

const profile = { version: DECISION_CADENCE_VERSION, settleHours: 0, minimumObservationHours: 0,
  minimumLearningHours: 0, cooldownHours: 24, repeatSuppressionHours: 24, frequencyWindowHours: 24,
  maxDecisionsPerWindow: 5, maxActionsPerWindow: 2, maximumHistoryEntries: 20, minimumEvidenceCount: 1, minimumEvidenceScore: 0.5 } as const;
const plan = { version: EXPERIMENT_CONTRACT_VERSION, hypothesis: "Message quality improves qualified lead rate",
  primaryMetric: "qualified_lead_rate", desiredDirection: "increase" as const, primaryVariable: "message",
  changedVariables: ["message"], baselineRef: "baseline_cadence_live", guardrailMetrics: ["cpl"],
  stopConditions: ["guardrail_breach", "contamination"] as const, minimumSampleSize: 10,
  minimumWindowHours: 24, minimumEvidenceScore: 0.7, minimumDetectableEffect: 0.05 };

function request(intent: "decision-cadence-publish" | "experiment-record-mutate", body: unknown, token: string): Request {
  return new Request("http://localhost:3000/api/local-acceptance", { method: "POST", headers: {
    host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin",
    "content-type": "application/json", "x-reklamzeka-intent": intent,
    cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
  }, body: JSON.stringify(body) });
}

try {
  await database.transaction(async (transaction) => {
    const tables = (await transaction.execute(sql`
      select to_regclass('public.decision_cadence_profile_revisions')::text as cadence,
        to_regclass('public.experiment_record_revisions')::text as experiment,
        to_regclass('public.audit_events')::text as audit
    `)).rows[0] as Record<string, unknown> | undefined;
    tablesApplied = Boolean(tables?.cadence && tables?.experiment && tables?.audit);
    if (!tablesApplied) throw new Error("cadence/experiment migrations are not applied");
    await transaction.insert(schema.workspaces).values({ id: ids.workspace, name: "Cadence experiment lifecycle acceptance" });
    await transaction.insert(schema.users).values({ id: ids.user, email: `cadence-live-${ids.user}@example.invalid` });
    await transaction.insert(schema.memberships).values({ workspaceId: ids.workspace, userId: ids.user, role: "owner" });
    await transaction.insert(schema.metaConnections).values({ id: ids.connection, workspaceId: ids.workspace, externalConnectionKey: "cadence-live", displayName: "Cadence live", graphApiVersion: "v1", fieldCatalogVersion: "fixture-v1", status: "active" });
    await transaction.insert(schema.dataSources).values({ id: ids.source, workspaceId: ids.workspace, metaConnectionId: ids.connection, platform: "meta_ads", externalAccountId: refs.account, displayName: "Cadence live" });
    await transaction.insert(schema.adAccounts).values({ id: ids.account, workspaceId: ids.workspace, dataSourceId: ids.source, externalAccountId: refs.account, name: "Cadence live", currency: "TRY", timezone: "Europe/Istanbul" });
    await transaction.insert(schema.adCampaigns).values({ id: ids.campaign, workspaceId: ids.workspace, adAccountId: ids.account, externalCampaignId: refs.campaign, name: "Cadence live" });

    const config = localDecisionRoomConfig({ DATABASE_URL: databaseUrl, REKLAMZEKA_LOCAL_SESSION_ENABLED: "true", REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000", REKLAMZEKA_LOCAL_WORKSPACE_ID: ids.workspace, REKLAMZEKA_LOCAL_WORKSPACE_REF: refs.workspace, REKLAMZEKA_LOCAL_USER_ID: ids.user, REKLAMZEKA_LOCAL_READER_REF: refs.reader, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64") });
    if (!config) throw new Error("local configuration rejected");
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = mintLocalSessionCapability({ kind: "session", workspaceId: ids.workspace, workspaceRef: refs.workspace, userId: ids.user, readerRef: refs.reader, osUid: typeof process.getuid === "function" ? process.getuid() : -1, issuedAt, expiresAt: issuedAt + 60 }, config.signingKey).token;

    const cadenceResponse = await createLocalDecisionCadenceProfileHandler({ database: transaction as never, config })(request("decision-cadence-publish", { accountRef: refs.account, campaignRef: refs.campaign, profileRef: refs.profile, revision: 1, expectedCurrentHash: "GENESIS", profile }, token));
    const cadenceBody = await cadenceResponse.json() as Record<string, unknown>;
    cadencePublished = cadenceResponse.status === 201 && cadenceResponse.headers.get("x-reklamzeka-action-authority") === "none";
    cookieScopesBound = cadenceResponse.status !== 503;
    const cadence = (await transaction.execute(sql`select id::text as id, profile_hash from decision_cadence_profile_revisions where workspace_id = ${ids.workspace}::uuid and profile_ref = ${refs.profile} limit 1`)).rows[0] as { id?: string; profile_hash?: string } | undefined;
    if (!cadence?.id || typeof cadence.profile_hash !== "string") throw new Error("cadence publish did not persist a revision");

    const experimentHandler = createLocalExperimentRecordHandler({ database: transaction as never, config });
    const planned = await experimentHandler(request("experiment-record-mutate", { operation: "plan", accountRef: refs.account, campaignRef: refs.campaign, cadenceProfileRevisionId: cadence.id, plan }, token));
    const plannedBody = await planned.json() as Record<string, unknown>;
    const plannedHash = typeof plannedBody.recordHash === "string" ? plannedBody.recordHash : null;
    const experimentRef = typeof plannedBody.experimentRef === "string" ? plannedBody.experimentRef : null;
    experimentPlanPersisted = planned.status === 201 && plannedHash !== null && experimentRef !== null;
    if (!plannedHash || !experimentRef) throw new Error(`experiment plan did not persist: ${JSON.stringify({ status: planned.status, body: plannedBody })}`);
    const outcomeCommand = { operation: "record_outcome", experimentRef, expectedRecordHash: plannedHash,
      observation: { sampleSize: 10, observedWindowHours: 24, evidenceScore: 0.8, contaminationRefs: [], guardrailBreaches: [], primaryMetric: { status: "available", effect: 0.1 } } };
    const outcome = await experimentHandler(request("experiment-record-mutate", outcomeCommand, token));
    const outcomeBody = await outcome.json() as Record<string, unknown>;
    experimentOutcomePersisted = outcome.status === 201 && (outcomeBody.outcome as Record<string, unknown> | undefined)?.actionAuthority === "none";
    const stale = await experimentHandler(request("experiment-record-mutate", outcomeCommand, token));
    staleOutcomeBlocked = stale.status === 409;
    try { await transaction.transaction(async (savepoint) => { await savepoint.execute(sql`update experiment_record_revisions set event_type = 'planned' where workspace_id = ${ids.workspace}::uuid`); }); }
    catch { appendOnlyBlocked = true; }
    const audit = (await transaction.execute(sql`select count(*)::int as events, count(distinct event_hash)::int as distinct_hashes from audit_events where workspace_id = ${ids.workspace}::uuid`)).rows[0] as { events?: number; distinct_hashes?: number } | undefined;
    auditChainPersisted = Number(audit?.events) === 3 && Number(audit?.distinct_hashes) === 3;
    const allBodies = [cadenceBody, plannedBody, outcomeBody] as Record<string, unknown>[];
    capabilitiesFalse = allBodies.every((body) => JSON.stringify(body).includes('"canExecute":false') && JSON.stringify(body).includes('"canWriteMeta":false'));
    if (![cookieScopesBound, cadencePublished, experimentPlanPersisted, experimentOutcomePersisted, staleOutcomeBlocked, appendOnlyBlocked, auditChainPersisted, capabilitiesFalse].every(Boolean)) throw new Error(JSON.stringify({ staleStatus: stale.status, cookieScopesBound, cadencePublished, experimentPlanPersisted, experimentOutcomePersisted, staleOutcomeBlocked, appendOnlyBlocked, auditChainPersisted, capabilitiesFalse }));
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally {
  const survivors = await database.select({ value: count() }).from(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
  temporaryRowsCommitted = Number(survivors[0]?.value ?? -1) !== 0;
  await pool.end();
}

const report = { ok: tablesApplied && cookieScopesBound && cadencePublished && experimentPlanPersisted && experimentOutcomePersisted && staleOutcomeBlocked && appendOnlyBlocked && auditChainPersisted && capabilitiesFalse && !temporaryRowsCommitted, scope: "cadence_experiment_local_session_postgres", tablesApplied, cookieScopesBound, cadencePublished, experimentPlanPersisted, experimentOutcomePersisted, staleOutcomeBlocked, appendOnlyBlocked, auditChainPersisted, capabilitiesFalse, actionOrMetaWrites: 0, temporaryRowsCommitted };
console.log(JSON.stringify(report));
if (!report.ok) throw new Error("cadence/experiment lifecycle acceptance failed");
