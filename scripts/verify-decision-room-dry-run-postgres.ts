import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { ANALYSIS_TEMPLATE_DEFINITION_VERSION, ANALYSIS_TIMEFRAME_DEFINITION_VERSION, type AnalysisTemplateDefinition, type AnalysisTimeframeDefinition } from "@/application/decision-room-analysis-registry";
import { DrizzleDecisionRoomAnalysisAssetRegistry, DrizzleDecisionRoomAnalysisRuntimeAssetLoader } from "@/connectors/analyses/decision-room-analysis-registry-drizzle";
import { DrizzleFindingObservationReadPort, FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION } from "@/connectors/analyses/finding-observation-drizzle-read-port";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleDecisionCadenceProfileRepository } from "@/connectors/decisions/decision-cadence-profile-drizzle-repository";
import * as schema from "@/db/schema";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";
import { createLocalDecisionRoomDryRunHandler, localDecisionRoomDryRunConfig } from "@/server/local-decision-room-dry-run-runtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured", continuation: "npm run verify:decision-room-dry-run-db" }));
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("outer_rollback");
const ids = { workspace: randomUUID(), user: randomUUID(), connection: randomUUID(), source: randomUUID(), account: randomUUID(), campaign: randomUUID() };
const refs = { workspace: "workspace_dryrun", reader: "reader_dryrun", account: "account_dryrun", campaign: "campaign_dryrun", snapshot: `snapshot_${"a".repeat(20)}`, profile: "cadence_dryrun", timeframe: "timeframe_dryrun", template: "template_dryrun" };
const now = new Date();
const iso = now.toISOString();
const day = iso.slice(0, 10);
const signingKey = randomBytes(32);
let appliedTables = false;
let policyConfigured = false;
let cookieScopeBound = false;
let dryRunCompleted = false;
let authoritativeResult = false;
let persistedRun = false;
let persistedLedger = false;
let metaNetworkCalls = 0;
let metaWriteCalls = 0;
let temporaryRowsCommitted = true;

function dateAt(hour: string): Date { return new Date(`${day}T${hour}:00:00.000Z`); }

function timeframe(): AnalysisTimeframeDefinition {
  return { version: ANALYSIS_TIMEFRAME_DEFINITION_VERSION, timeframeRef: refs.timeframe, revision: 1,
    timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" }, comparison: "none", anchors: {} };
}

function template(contextHash: string, timeframeHash: string, snapshotRef: string): AnalysisTemplateDefinition {
  return { version: ANALYSIS_TEMPLATE_DEFINITION_VERSION, templateRef: refs.template, revision: 1,
    timeframeRef: refs.timeframe, timeframeDefinitionHash: timeframeHash, contextHash, requestedPasses: ["campaign"],
    hierarchy: [{ entityRef: refs.campaign, entityType: "campaign", parentEntityRef: null }],
    checks: [{ checkKey: "spend_guard", passKey: "campaign", entityRef: refs.campaign, entityType: "campaign",
      parentEntityRef: null, hierarchyPathRefs: [refs.campaign], driverEvidenceRefs: [], externalEntityId: refs.campaign,
      metaConnectionId: ids.connection, adAccountId: ids.account, attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY",
      spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "10", minimumSample: 1 },
      maxRowsPerQuery: 10, expectedSnapshotRefs: [snapshotRef] }],
    cadence: { profile: { version: DECISION_CADENCE_VERSION, settleHours: 0, minimumObservationHours: 0,
      minimumLearningHours: 0, cooldownHours: 24, repeatSuppressionHours: 24, frequencyWindowHours: 24,
      maxDecisionsPerWindow: 5, maxActionsPerWindow: 2, maximumHistoryEntries: 20, minimumEvidenceCount: 1, minimumEvidenceScore: 0.5 },
    observationStartedAt: dateAt("00").toISOString(), lastMaterialChangeAt: null, learning: { state: "not_applicable", startedAt: null },
    lastDecision: null, recentDecisions: [], requestedDisposition: "act", emergencyGuardrail: { breached: false, evidenceRef: null } } };
}

try {
  await database.transaction(async (transaction) => {
    const tables = (await transaction.execute(sql`
      select to_regclass('public.analysis_timeframe_definitions')::text as timeframe,
        to_regclass('public.analysis_template_definitions')::text as template,
        to_regclass('public.meta_daily_insights')::text as insight,
        to_regclass('public.decision_room_runs')::text as run,
        to_regclass('public.decision_ledger_records')::text as ledger
    `)).rows[0] as Record<string, unknown> | undefined;
    appliedTables = Boolean(tables?.timeframe && tables?.template && tables?.insight && tables?.run && tables?.ledger);
    if (!appliedTables) throw new Error("dry-run acceptance migrations are not applied");

    await transaction.insert(schema.workspaces).values({ id: ids.workspace, name: "Decision Room dry-run acceptance" });
    await transaction.insert(schema.users).values({ id: ids.user, email: `dry-run-${ids.user}@example.invalid` });
    await transaction.insert(schema.memberships).values({ workspaceId: ids.workspace, userId: ids.user, role: "owner" });
    await transaction.insert(schema.metaConnections).values({ id: ids.connection, workspaceId: ids.workspace, externalConnectionKey: "dryrun-connection", displayName: "Dry-run acceptance", graphApiVersion: "v1", fieldCatalogVersion: "fixture-v1", status: "active" });
    await transaction.insert(schema.dataSources).values({ id: ids.source, workspaceId: ids.workspace, metaConnectionId: ids.connection, platform: "meta_ads", externalAccountId: refs.account, displayName: "Dry-run account" });
    await transaction.insert(schema.adAccounts).values({ id: ids.account, workspaceId: ids.workspace, dataSourceId: ids.source, externalAccountId: refs.account, name: "Dry-run account", currency: "TRY", timezone: "Europe/Istanbul" });
    await transaction.insert(schema.adCampaigns).values({ id: ids.campaign, workspaceId: ids.workspace, adAccountId: ids.account, externalCampaignId: refs.campaign, name: "Dry-run campaign" });
    const stream = randomUUID(), run = randomUUID(), slice = randomUUID(), insight = randomUUID();
    await transaction.insert(schema.metaSyncStreams).values({ id: stream, workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, streamType: "insights", status: "completed" });
    await transaction.insert(schema.metaSyncRuns).values({ id: run, workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, streamId: stream, streamType: "insights", idempotencyKey: `dryrun-${ids.workspace}`, status: "completed", startedAt: dateAt("01"), finishedAt: dateAt("02") });
    await transaction.insert(schema.metaSyncSlices).values({ id: slice, workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, runId: run, streamType: "insights", entityLevel: "campaign", dateStart: day, dateStop: day, sliceKey: `dryrun:${day}`, status: "completed", completedAt: dateAt("02") });
    await transaction.insert(schema.metaDailyInsights).values({ id: insight, workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, syncRunId: run, syncSliceId: slice, entityLevel: "campaign", externalEntityId: refs.campaign, dateStart: day, dateStop: day, attributionLabel: "7d_click_1d_view", attributionWindow: { click: 7, view: 1 }, currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "revision-1", sourcePayloadHash: "payload-hash", sourceUpdatedAt: dateAt("02"), metricProvenance: { source: "fixture" } });
    await transaction.insert(schema.metaDailyInsightMetrics).values({ dailyInsightId: insight, metricKey: "spend", aggregation: "additive", valueMinor: 100, currency: "TRY", provenance: { field: "spend" }, sourceRevision: "revision-1", sourcePayloadHash: "payload-hash" });
    const frozenRead = await new DrizzleFindingObservationReadPort(transaction as never, { resolve: async () => ({ policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION, policyRef: "settlement_dryrun", evaluatedAsOf: iso, settledThroughDate: day }) }).read({ builderVersion: "finding-observation-builder/1.0.0", queryRef: "dryrun_snapshot_binding", workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, entityLevel: "campaign", externalEntityId: refs.campaign, attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY", role: "primary", startDate: day, endDate: day, timezone: "Europe/Istanbul", maxRows: 10 });
    const frozenSnapshotRef = frozenRead.snapshotRefs[0];
    if (!frozenSnapshotRef || frozenRead.snapshotRefs.length !== 1) throw new Error("observation snapshot binding unavailable");
    await transaction.insert(schema.metaChangeSnapshots).values({ workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, publicRef: frozenSnapshotRef, snapshotHash: "a".repeat(64), schemaVersion: 1, fieldCatalogVersion: "fixture-v1", capturedAt: now, canonicalPayload: { entities: [] }, safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 1, unknownFieldCount: 0 } });
    // The original 20-character alias remains legal for historical replay.
    await transaction.insert(schema.metaChangeSnapshots).values({ workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, publicRef: refs.snapshot, snapshotHash: "b".repeat(64), schemaVersion: 1, fieldCatalogVersion: "fixture-v1", capturedAt: now, canonicalPayload: { entities: [] }, safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 1, unknownFieldCount: 0 } });

    const guidanceRegistry = createGuidanceRegistry({ workspaceId: ids.workspace, sources: [], cards: [], bindings: [], sets: [] });
    const guidance = buildEffectiveGuidancePack(guidanceRegistry, { workspaceId: ids.workspace, accountId: refs.account,
      accountGroupIds: [], objective: "sales", internalCategoryIds: [], entity: { type: "campaign", id: refs.campaign },
      topics: [], requiredTopics: [], guidanceSetIds: [], evaluatedAt: iso,
      budget: { maxCards: 1, maxSources: 1, maxCharacters: 1 } });
    const context = buildEffectiveCampaignContext({ workspaceId: ids.workspace, capturedAt: iso,
      identity: { connectionRef: "dryrun-connection", accountRef: refs.account, campaignRef: refs.campaign, entityRef: refs.campaign, entityType: "campaign", hierarchyRefs: [refs.campaign] },
      meta: { objective: { state: "known", value: "sales" }, optimizationEvent: { state: "known", value: "purchase" }, configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" }, budgetOwnerRef: { state: "known", value: refs.campaign }, targetingSignature: { state: "unknown", reason: "not_loaded" }, actorRef: { state: "known", value: "actor_dryrun" }, destinationRef: { state: "known", value: null } },
      categories: [], guidance, policies: [],
      cadence: { profileRef: refs.profile, decision: "eligible", reason: "window_open", cooldownUntil: null }, data: { trustStatus: "ready", snapshotRefs: [frozenSnapshotRef], featureRefs: [frozenSnapshotRef], windowRefs: ["window_dryrun"], blockers: [] }, history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
      versions: { metaCatalog: "meta_v1", categoryResolver: "category_v1", guidanceRegistry: "guidance_v1", metricCatalog: "metric_v1", formulaCatalog: "formula_v1", timeframeResolver: "timeframe_v1", instructionPolicyRegistry: "d".repeat(64), promotionRegistry: "e".repeat(64) } });
    await new DrizzleEffectiveCampaignContextRepository(transaction as never).save(context);
    await new DrizzleDecisionCadenceProfileRepository(transaction as never).publish({ workspaceId: ids.workspace, workspaceRef: refs.workspace, actorId: ids.user, actorRef: refs.reader, role: "owner", accountRef: refs.account, campaignRef: refs.campaign, profileRef: refs.profile, revision: 1, expectedCurrentHash: "GENESIS", profile: template(context.contextHash, "f".repeat(64), frozenSnapshotRef).cadence.profile, occurredAt: iso });
    const registry = new DrizzleDecisionRoomAnalysisAssetRegistry(transaction as never, ids.workspace);
    const timeframeResult = await registry.publishTimeframe(timeframe(), iso);
    await registry.publishTemplate({ accountRef: refs.account, campaignRef: refs.campaign, definition: template(context.contextHash, timeframeResult.definitionHash, frozenSnapshotRef), publishedAt: iso });

    const configured = localDecisionRoomDryRunConfig({ DATABASE_URL: databaseUrl, REKLAMZEKA_LOCAL_SESSION_ENABLED: "true", REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000", REKLAMZEKA_LOCAL_WORKSPACE_ID: ids.workspace, REKLAMZEKA_LOCAL_WORKSPACE_REF: refs.workspace, REKLAMZEKA_LOCAL_USER_ID: ids.user, REKLAMZEKA_LOCAL_READER_REF: refs.reader, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"), REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF: "settlement_dryrun", REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE: day });
    if (!configured) throw new Error("operator policy configuration rejected");
    policyConfigured = configured.settlementPolicyRef === "settlement_dryrun" && configured.settledThroughDate === day;
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = mintLocalSessionCapability({ kind: "session", workspaceId: ids.workspace, workspaceRef: refs.workspace, userId: ids.user, readerRef: refs.reader, osUid: typeof process.getuid === "function" ? process.getuid() : -1, issuedAt, expiresAt: issuedAt + 60 }, configured.local.signingKey).token;
    const response = await createLocalDecisionRoomDryRunHandler({ database: transaction as never, config: configured })(new Request("http://localhost:3000/api/decision-room/dry-run", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-reklamzeka-intent": "decision-room-dry-run", cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}` }, body: JSON.stringify({ request: { requestRef: "request_dryrun", accountRef: refs.account, campaignRef: refs.campaign, timeframeRef: refs.timeframe, templateRef: refs.template } }) }));
    const body = await response.json() as Record<string, unknown>;
    cookieScopeBound = response.status !== 403 && response.status !== 503;
    dryRunCompleted = response.status === 200 && response.headers.get("x-reklamzeka-access-mode") === "analysis-dry-run";
    const execution = body.execution as Record<string, unknown> | undefined;
    authoritativeResult = body.authority !== null && typeof body.authority === "object" && (body.authority as Record<string, unknown>).metaWrite === false && execution?.actionAuthority === "none";
    const persisted = (await transaction.execute(sql`select count(*)::int as runs, (select count(*)::int from decision_ledger_records where workspace_id = ${ids.workspace}::uuid) as ledger from decision_room_runs where workspace_id = ${ids.workspace}::uuid`)).rows[0] as { runs?: number; ledger?: number } | undefined;
    persistedRun = Number(persisted?.runs) === 1;
    persistedLedger = Number(persisted?.ledger) >= 1;
    let loaderError: string | null = null;
    if (execution?.status === "failed" && typeof execution.runRef === "string") {
      try { await new DrizzleDecisionRoomAnalysisRuntimeAssetLoader(transaction as never, ids.workspace).loadExact({ runRef: execution.runRef, workspaceRef: refs.workspace, accountRef: refs.account, campaignRef: refs.campaign, timeframeRef: refs.timeframe, templateRef: refs.template, triggerKind: "manual" }); }
      catch (error) { loaderError = error instanceof Error ? `${error.name}:${error.message}` : String(error); }
    }
    if (![policyConfigured, cookieScopeBound, dryRunCompleted, authoritativeResult, persistedRun, persistedLedger].every(Boolean)) throw new Error(`policy configured dry-run acceptance failed: ${JSON.stringify({ status: response.status, body, loaderError, policyConfigured, cookieScopeBound, dryRunCompleted, authoritativeResult, persistedRun, persistedLedger })}`);
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally {
  const survivors = await database.select({ value: count() }).from(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
  temporaryRowsCommitted = Number(survivors[0]?.value ?? -1) !== 0;
  await pool.end();
}

const report = { ok: !temporaryRowsCommitted && appliedTables && policyConfigured && cookieScopeBound && dryRunCompleted && authoritativeResult && persistedRun && persistedLedger, scope: "policy_configured_postgres_dry_run", appliedTables, policyConfigured, cookieScopeBound, dryRunCompleted, authoritativeResult, persistedRun, persistedLedger, metaNetworkCalls, metaWriteCalls, temporaryRowsCommitted };
console.log(JSON.stringify(report));
if (!report.ok) throw new Error("Decision Room dry-run PostgreSQL acceptance failed");
