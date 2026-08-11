import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { buildFindingObservationPlan, buildFindingObservations } from "@/analyses/finding-observation-builder";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { ANALYSIS_TEMPLATE_DEFINITION_VERSION, ANALYSIS_TIMEFRAME_DEFINITION_VERSION, type AnalysisTemplateDefinition, type AnalysisTimeframeDefinition } from "@/application/decision-room-analysis-registry";
import { DrizzleDecisionRoomAnalysisAssetRegistry } from "@/connectors/analyses/decision-room-analysis-registry-drizzle";
import { DrizzleDeterministicFeatureSnapshotRepository } from "@/connectors/analyses/deterministic-feature-snapshot-drizzle-repository";
import { DrizzleFindingObservationReadPort, FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION } from "@/connectors/analyses/finding-observation-drizzle-read-port";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import * as schema from "@/db/schema";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";
import { createDrizzleTimeframeBoundAnalysisContextComposer } from "@/server/timeframe-bound-analysis-context-composer-runtime";
import { createLocalDecisionRoomDryRunHandler, localDecisionRoomDryRunConfig } from "@/server/local-decision-room-dry-run-runtime";
import { materializeCurrentEffectiveAnalysisContextSourceFixture } from "./support/current-effective-analysis-context-source-fixture";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
// Acceptance writers take locks and nested lifecycle transactions; prefer the
// direct endpoint exactly as the other live verifiers do, falling back only
// when local development config has no direct endpoint.
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured", continuation: "npm run verify:decision-room-dry-run-db" }));
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("outer_rollback");
const now = new Date();
const day = now.toISOString().slice(0, 10);
const signingKey = randomBytes(32);
let workspaceId = "";
let fixture: Awaited<ReturnType<typeof materializeCurrentEffectiveAnalysisContextSourceFixture>> | null = null;
let appliedTables = false;
let l1Observed = false;
let l2Persisted = false;
let l3Persisted = false;
let exactEvidenceRefs = false;
let dryRunCompleted = false;
let replayIdempotent = false;
let persistedRun = false;
let persistedLedger = false;
let persistedInbox = false;
let crossTenantRejected = false;
let tamperRejected = false;
let staleL1Rejected = false;
let metaNetworkCalls = 0;
let metaWriteCalls = 0;
let temporaryRowsCommitted = true;
let fixtureCleanupSucceeded = false;

function rows<T extends Record<string, unknown>>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new Error("invalid_store_result");
  return value.rows as readonly T[];
}

function definition(input: Readonly<{ timeframeRef: string; templateRef: string; contextHash: string; timeframeHash: string;
  campaignRef: string; connectionId: string; accountId: string; snapshotRefs: readonly string[]; cadence: AnalysisTemplateDefinition["cadence"] }>): AnalysisTemplateDefinition {
  return { version: ANALYSIS_TEMPLATE_DEFINITION_VERSION, templateRef: input.templateRef, revision: 1,
    timeframeRef: input.timeframeRef, timeframeDefinitionHash: input.timeframeHash, contextHash: input.contextHash,
    requestedPasses: ["campaign"], hierarchy: [{ entityRef: input.campaignRef, entityType: "campaign", parentEntityRef: null }],
    checks: [{ checkKey: "spend_guard", passKey: "campaign", entityRef: input.campaignRef, entityType: "campaign",
      parentEntityRef: null, hierarchyPathRefs: [input.campaignRef], driverEvidenceRefs: [], externalEntityId: input.campaignRef,
      metaConnectionId: input.connectionId, adAccountId: input.accountId, attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY",
      spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1", minimumSample: 1 },
      maxRowsPerQuery: 10, expectedSnapshotRefs: input.snapshotRefs }], cadence: input.cadence };
}

async function post(handler: ReturnType<typeof createLocalDecisionRoomDryRunHandler>, request: Record<string, string>, token: string): Promise<Readonly<{ status: number; body: Record<string, unknown> }>> {
  const response = await handler(new Request("http://localhost:3000/api/decision-room/dry-run", { method: "POST", headers: {
    host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json",
    "x-reklamzeka-intent": "decision-room-dry-run", cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
  }, body: JSON.stringify({ request }) }));
  return Object.freeze({ status: response.status, body: await response.json() as Record<string, unknown> });
}

try {
  // This fixture owns nested lifecycle transactions (notably authority
  // materialization), so it deliberately commits before the verifier's outer
  // rollback. It is always removed through the normal tombstone service below.
  fixture = await materializeCurrentEffectiveAnalysisContextSourceFixture(database as never, now);
  workspaceId = fixture.workspaceId;
  await database.transaction(async (transaction) => {
    const tables = rows<Record<string, unknown>>(await transaction.execute(sql`
      select to_regclass('public.deterministic_feature_snapshots')::text as feature,
        to_regclass('public.deterministic_window_snapshots')::text as window,
        to_regclass('public.effective_campaign_contexts')::text as context,
        to_regclass('public.decision_room_runs')::text as run,
        to_regclass('public.decision_ledger_records')::text as ledger,
        to_regclass('public.decision_room_inbox_items')::text as inbox
    `))[0];
    appliedTables = Boolean(tables?.feature && tables?.window && tables?.context && tables?.run && tables?.ledger && tables?.inbox);
    if (!appliedTables) throw new Error("dry_run_acceptance_migrations_not_applied");

    // The source fixture has normal category/guidance/cadence/authority writers;
    // only L1 mirror rows below are acceptance data, then every analytical layer
    // is built by its production repository/composer boundary.
    const source = fixture;
    if (!source) throw new Error("dry_run_fixture_missing");
    const scope = rows<{ connection_id: string; account_id: string }>(await transaction.execute(sql`
      select connection.id::text as connection_id, account.id::text as account_id
      from meta_connections connection join data_sources source on source.workspace_id = connection.workspace_id and source.meta_connection_id = connection.id
      join ad_accounts account on account.workspace_id = source.workspace_id and account.data_source_id = source.id
      where connection.workspace_id = ${source.workspaceId}::uuid and account.external_account_id = ${source.accountRef} limit 2
    `))[0];
    if (!scope) throw new Error("dry_run_scope_missing");
    const stream = crypto.randomUUID(), syncRun = crypto.randomUUID(), slice = crypto.randomUUID(), insight = crypto.randomUUID();
    await transaction.insert(schema.metaSyncStreams).values({ id: stream, workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, streamType: "insights", status: "completed" });
    await transaction.insert(schema.metaSyncRuns).values({ id: syncRun, workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, streamId: stream, streamType: "insights", idempotencyKey: `dryrun_${source.workspaceId}`, status: "completed",
      startedAt: new Date(now.getTime() - 90_000), finishedAt: new Date(now.getTime() - 60_000) });
    await transaction.insert(schema.metaSyncSlices).values({ id: slice, workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, runId: syncRun, streamType: "insights", entityLevel: "campaign", dateStart: day, dateStop: day,
      sliceKey: `dryrun_${day}`, status: "completed", completedAt: new Date(now.getTime() - 60_000) });
    await transaction.insert(schema.metaDailyInsights).values({ id: insight, workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, syncRunId: syncRun, syncSliceId: slice, entityLevel: "campaign", externalEntityId: source.campaignRef,
      dateStart: day, dateStop: day, attributionLabel: "7d_click_1d_view", attributionWindow: { click: 7, view: 1 }, currency: "TRY",
      timezone: "Europe/Istanbul", sourceRevision: "dryrun-v1", sourcePayloadHash: "d".repeat(64), sourceUpdatedAt: new Date(now.getTime() - 60_000), metricProvenance: { source: "acceptance_fixture" } });
    await transaction.insert(schema.metaDailyInsightMetrics).values({ dailyInsightId: insight, metricKey: "spend", aggregation: "additive", valueMinor: 100,
      currency: "TRY", provenance: { field: "spend" }, sourceRevision: "dryrun-v1", sourcePayloadHash: "d".repeat(64) });

    const l3AsOf = new Date(Date.now() + 1_000).toISOString();
    const resolved = resolveAnalysisTimeframe({ timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" }, comparison: "none", asOf: l3AsOf, anchors: {} });
    const observationPlan = buildFindingObservationPlan({ workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, entityLevel: "campaign", externalEntityId: source.campaignRef, attributionLabel: "7d_click_1d_view",
      expectedCurrency: "TRY", timeframe: resolved, spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1", minimumSample: 1 }, maxRowsPerQuery: 10 });
    const observationQuery = observationPlan.queries[0];
    if (!observationQuery) throw new Error("dry_run_l1_plan_empty");
    const observations = new DrizzleFindingObservationReadPort(transaction as never, { resolve: async () => ({ policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION,
      policyRef: "settlement_dryrun", evaluatedAsOf: now.toISOString(), settledThroughDate: day }) });
    const l1 = await observations.readForFeatureSnapshot(observationQuery);
    const observed = buildFindingObservations({ plan: observationPlan, reads: [l1.read] })[0];
    l1Observed = l1.read.rows.length === 1 && observed?.qualityStatus === "ready" && observed.settled && l1.sourceManifest.length === 1;
    if (!l1Observed) throw new Error("dry_run_l1_not_ready");
    const feature = buildDeterministicFeatureSnapshot({ scope: { workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, entityLevel: "campaign", externalEntityId: source.campaignRef }, observation: observed! });
    const storedFeature = await new DrizzleDeterministicFeatureSnapshotRepository(transaction as never).save({ feature, source: l1 });
    l2Persisted = storedFeature.feature.featureRef === feature.featureRef && storedFeature.outcome === "inserted";
    if (!l2Persisted) throw new Error("dry_run_l2_not_persisted");

    const sourceContext = await createDrizzleEffectiveAnalysisContextComposer({ database: transaction as never }).composeAndSave(source.request);
    const timeframeRef = `timeframe_dryrun_${source.workspaceId.replaceAll("-", "").slice(0, 12)}`;
    const templateRef = `template_dryrun_${source.workspaceId.replaceAll("-", "").slice(0, 12)}`;
    const timeframe: AnalysisTimeframeDefinition = { version: ANALYSIS_TIMEFRAME_DEFINITION_VERSION, timeframeRef, revision: 1,
      timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" }, comparison: "none", anchors: {} };
    const l3AsOfAfterSource = new Date(Math.max(Date.parse(l3AsOf), Date.parse(sourceContext.context.capturedAt) + 1_000)).toISOString();
    const resolvedAfterSource = resolveAnalysisTimeframe({ timeframe: timeframe.timeframe, comparison: timeframe.comparison, asOf: l3AsOfAfterSource, anchors: {} });
    const l3 = await createDrizzleTimeframeBoundAnalysisContextComposer({ database: transaction as never, now: () => new Date(l3AsOfAfterSource) }).composeAndSave({
      workspaceId: source.workspaceId, entityType: "campaign", entityRef: source.campaignRef, timeframe: resolvedAfterSource });
    l3Persisted = l3.outcome === "inserted" && l3.context.data.featureRefs.length === 1 && l3.context.data.windowRefs.length === 1;
    exactEvidenceRefs = l3.context.data.featureRefs[0] === feature.featureRef && l3.window.featureRefs[0] === feature.featureRef
      && l3.context.data.windowRefs[0] === l3.window.windowRef && l3.context.data.snapshotRefs.length === 1;
    if (!l3Persisted || !exactEvidenceRefs) throw new Error("dry_run_l3_evidence_not_exact");

    const registry = new DrizzleDecisionRoomAnalysisAssetRegistry(transaction as never, source.workspaceId);
    const publishedTimeframe = await registry.publishTimeframe(timeframe, l3AsOfAfterSource);
    await registry.publishTemplate({ accountRef: source.accountRef, campaignRef: source.campaignRef, publishedAt: l3AsOfAfterSource,
      definition: definition({ timeframeRef, templateRef, contextHash: l3.context.contextHash, timeframeHash: publishedTimeframe.definitionHash,
        campaignRef: source.campaignRef, connectionId: scope.connection_id, accountId: scope.account_id,
        snapshotRefs: feature.sourceSnapshotRefs, cadence: { profile: sourceContext.context.cadenceEvidence === undefined ? (() => { throw new Error("cadence_evidence_missing"); })() : {
          version: "decision-cadence/1.0.0", settleHours: 0, minimumObservationHours: 0, minimumLearningHours: 0, cooldownHours: 0,
          repeatSuppressionHours: 0, frequencyWindowHours: 24, maxDecisionsPerWindow: 3, maxActionsPerWindow: 1, maximumHistoryEntries: 20,
          minimumEvidenceCount: 1, minimumEvidenceScore: 0.5 }, observationStartedAt: source.occurredAt, lastMaterialChangeAt: null,
          learning: { state: "not_applicable", startedAt: null }, lastDecision: null, recentDecisions: [], requestedDisposition: "test", emergencyGuardrail: { breached: false, evidenceRef: null } } }) });

    const configured = localDecisionRoomDryRunConfig({ DATABASE_URL: databaseUrl, REKLAMZEKA_LOCAL_SESSION_ENABLED: "true", REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
      REKLAMZEKA_LOCAL_WORKSPACE_ID: source.workspaceId, REKLAMZEKA_LOCAL_WORKSPACE_REF: source.workspaceRef, REKLAMZEKA_LOCAL_USER_ID: source.actorId,
      REKLAMZEKA_LOCAL_READER_REF: source.actorRef, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
      REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF: "settlement_dryrun", REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE: day });
    if (!configured) throw new Error("dry_run_operator_policy_rejected");
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = mintLocalSessionCapability({ kind: "session", workspaceId: source.workspaceId, workspaceRef: source.workspaceRef, userId: source.actorId,
      readerRef: source.actorRef, osUid: typeof process.getuid === "function" ? process.getuid() : -1, issuedAt, expiresAt: issuedAt + 60 }, configured.local.signingKey).token;
    const handler = createLocalDecisionRoomDryRunHandler({ database: transaction as never, config: configured });
    const request = { requestRef: `request_dryrun_${source.workspaceId.replaceAll("-", "").slice(0, 12)}`, accountRef: source.accountRef, campaignRef: source.campaignRef, timeframeRef, templateRef };
    const first = await post(handler, request, token); const second = await post(handler, request, token);
    const firstExecution = first.body.execution as Record<string, unknown> | undefined;
    const secondExecution = second.body.execution as Record<string, unknown> | undefined;
    dryRunCompleted = first.status === 200 && firstExecution?.status === "completed";
    replayIdempotent = second.status === 200 && firstExecution?.runRef === secondExecution?.runRef;
    const persisted = rows<{ runs: number; ledger: number; inbox: number }>(await transaction.execute(sql`
      select (select count(*)::int from decision_room_runs where workspace_id = ${source.workspaceId}::uuid) as runs,
        (select count(*)::int from decision_ledger_records where workspace_id = ${source.workspaceId}::uuid) as ledger,
        (select count(*)::int from decision_room_inbox_items where workspace_id = ${source.workspaceId}::uuid) as inbox
    `))[0];
    persistedRun = Number(persisted?.runs) === 1; persistedLedger = Number(persisted?.ledger) >= 1; persistedInbox = Number(persisted?.inbox) === 1;
    const foreignToken = mintLocalSessionCapability({ kind: "session", workspaceId: source.foreignWorkspaceId, workspaceRef: "workspace_foreign_dryrun",
      userId: source.actorId, readerRef: source.actorRef, osUid: typeof process.getuid === "function" ? process.getuid() : -1, issuedAt, expiresAt: issuedAt + 60 }, configured.local.signingKey).token;
    crossTenantRejected = (await post(handler, request, foreignToken)).status === 403;
    tamperRejected = (await post(handler, { ...request, templateRef: `${templateRef}_tampered` }, token)).status === 503;
    // A changed L1 mirror payload invalidates L2; a fresh L3 admission must fail closed.
    await transaction.execute(sql`update meta_daily_insights set source_payload_hash = ${"e".repeat(64)} where workspace_id = ${source.workspaceId}::uuid and id = ${insight}::uuid`);
    staleL1Rejected = await createDrizzleTimeframeBoundAnalysisContextComposer({ database: transaction as never, now: () => new Date(Date.parse(l3AsOfAfterSource) + 2_000) })
      .composeAndSave({ workspaceId: source.workspaceId, entityType: "campaign", entityRef: source.campaignRef, timeframe: resolvedAfterSource })
      .then(() => false, () => true);
    if (![dryRunCompleted, replayIdempotent, persistedRun, persistedLedger, persistedInbox, crossTenantRejected, tamperRejected, staleL1Rejected].every(Boolean)) {
      throw new Error(`dry_run_acceptance_failed:${JSON.stringify({ first, second, dryRunCompleted, replayIdempotent, persistedRun, persistedLedger, persistedInbox, crossTenantRejected, tamperRejected, staleL1Rejected })}`);
    }
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally {
  if (workspaceId) {
    // The source fixture is intentionally persistent until its lifecycle-safe
    // tombstone cleanup. The entire verifier-owned L1/L2/L3/run branch must be
    // gone immediately after the outer rollback.
    const survivors = rows<{ count: number }>(await database.execute(sql`
      select count(*)::int as count from deterministic_feature_snapshots where workspace_id = ${workspaceId}::uuid
    `))[0];
    temporaryRowsCommitted = Number(survivors?.count ?? -1) !== 0;
  }
  if (fixture) {
    const purge = new DrizzleWorkspaceTombstonePurgePort();
    const service = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge),
      { authorize: async (input) => input.approvalRef === "ephemeral-fixture-approved" }, fixture.actorId, 60_000);
    try {
      for (const id of [fixture.workspaceId, fixture.foreignWorkspaceId]) {
        const plan = await service.dryRun(id, new Date().toISOString());
        await service.execute({ planRef: plan.planRef, approvalRef: "ephemeral-fixture-approved", now: new Date().toISOString() });
      }
      fixtureCleanupSucceeded = (await purge.inspect(database as never, fixture.workspaceId)).candidateCount === 0
        && (await purge.inspect(database as never, fixture.foreignWorkspaceId)).candidateCount === 0;
    } catch { fixtureCleanupSucceeded = false; }
  }
  await pool.end();
}

const report = { ok: !temporaryRowsCommitted && fixtureCleanupSucceeded && appliedTables && l1Observed && l2Persisted && l3Persisted && exactEvidenceRefs && dryRunCompleted && replayIdempotent && persistedRun && persistedLedger && persistedInbox && crossTenantRejected && tamperRejected && staleL1Rejected && metaNetworkCalls === 0 && metaWriteCalls === 0,
  scope: "l1_observed_l2_feature_l3_window_context_decision_room_dry_run", appliedTables, l1Observed, l2Persisted, l3Persisted, exactEvidenceRefs, dryRunCompleted, replayIdempotent, persistedRun, persistedLedger, persistedInbox, crossTenantRejected, tamperRejected, staleL1Rejected, metaNetworkCalls, metaWriteCalls, temporaryRowsCommitted, fixtureCleanupSucceeded };
console.log(JSON.stringify(report));
if (!report.ok) throw new Error("Decision Room dry-run PostgreSQL acceptance failed");
