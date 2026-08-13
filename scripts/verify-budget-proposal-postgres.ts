import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { buildFindingObservationPlan, buildFindingObservations } from "@/analyses/finding-observation-builder";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { BudgetLabDraftService } from "@/application/budget-lab-draft-service";
import { BudgetProposalService, type BudgetProposalInput } from "@/application/budget-proposal-service";
import { DrizzleDeterministicFeatureSnapshotRepository } from "@/connectors/analyses/deterministic-feature-snapshot-drizzle-repository";
import { DrizzleDeterministicWindowSnapshotRepository } from "@/connectors/analyses/deterministic-window-snapshot-drizzle-repository";
import { DrizzleFindingObservationReadPort, FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION } from "@/connectors/analyses/finding-observation-drizzle-read-port";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import * as schema from "@/db/schema";
import type { BudgetScenarioDefinition } from "@/domain/budget/scenario-composer";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";
import { createDrizzleTimeframeBoundAnalysisContextComposer } from "@/server/timeframe-bound-analysis-context-composer-runtime";
import { materializeCurrentEffectiveAnalysisContextSourceFixture } from "./support/current-effective-analysis-context-source-fixture";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("budget-proposal-rollback");

const evidence = {
  tablesApplied: false, sourceBoundContext: false, readyL3Context: false, exactContextBinding: false, mappingSuppression: false,
  mappingIndependentScenarios: false, idempotency: false, revisionChain: false,
  draftAuditAtomic: false, draftIdempotency: false,
  publicProjectionSafe: false, crossTenantBlocked: false, immutableRows: false,
  rlsAndGrants: false, metaCalls: 0, executionCalls: 0, proposalRowsRolledBack: false,
  fixtureCommitted: false, tombstoneCleanup: false, purgeCandidateCount: -1, foreignPurgeCandidateCount: -1,
  activeSurvivorCount: -1, foreignActiveSurvivorCount: -1,
};

function rows(result: unknown): readonly Record<string, unknown>[] {
  return result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
    ? result.rows as readonly Record<string, unknown>[] : [];
}

function scenario(kind: BudgetScenarioDefinition["kind"], requestedBudgetMinor: number): BudgetScenarioDefinition {
  const allocations = [
    { ref: "ankara", currentAmountMinor: 6_000, categoryRef: "local", geoRef: "ankara", groupRefs: ["tr"] },
    { ref: "dubai", currentAmountMinor: 4_000, categoryRef: "intl", geoRef: "dubai", groupRefs: ["intl"] },
  ];
  return {
    scenarioRef: `scenario.${kind}`, kind, minorUnitScale: 2, requestedBudgetMinor,
    allocations, constraints: [],
    strategy: { mode: "proportional", weights: [{ ref: "ankara", weight: 3 }, { ref: "dubai", weight: 2 }] },
    pacing: {
      period: { startDate: "2026-08-01", endDate: "2026-08-10", timezone: "Europe/Istanbul" },
      asOfAt: "2026-08-06T00:00:00.000Z",
      amounts: { currency: "TRY", plannedDecimal: "100.00", committedDecimal: "100.00", actualDecimal: "55.00", requestedCommitmentDecimal: (requestedBudgetMinor / 100).toFixed(2) },
      signal: {
        kind: kind === "target_seeking" ? "proxy" : "business_outcome", metricRef: kind === "target_seeking" ? "meta.lead" : "spend_pace",
        sampleSize: 120, coverageBps: 9500, observedThroughAt: "2026-08-04T00:00:00.000Z",
        retrievedAt: "2026-08-05T23:45:00.000Z", learningPhase: false, lastMaterialChangeAt: "2026-08-03T00:00:00.000Z",
      },
      policy: {
        moneyScale: 2, moneyRounding: "half_even", minimumElapsedBps: 1000, conservativeRemainingRateBps: 8000,
        forecastMinimumDecimal: "0", forecastMaximumDecimal: "140", maximumFreshnessMinutes: 60,
        minimumCoverageBps: 9000, minimumSampleSize: 100, attributionLagMinutes: 1440,
        suppressDuringLearning: true, cooldownMinutes: 1440, allowProxyAction: true,
        maximumChangeBps: 1000, maximumChangeAbsoluteDecimal: "15",
      },
    },
  };
}

/**
 * The source reader owns a repeatable-read/read-only snapshot.  This verifier
 * therefore commits its L1/L2 evidence before composing the source context,
 * then binds that context to L3 through the normal production materializer.
 * The outer rollback below remains limited to proposal/draft acceptance rows;
 * the committed fixture branch is always removed by the tombstone lifecycle.
 */
async function materializeReadyBudgetContext(source: NonNullable<typeof fixture>): Promise<Readonly<{
  contextHash: string;
  ready: boolean;
}>> {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  let featureRef = "";
  let analysisConnectionId = "";
  let analysisAccountId = "";
  await database.transaction(async (transaction) => {
    const scope = rows(await transaction.execute(sql`
      select connection.id::text as connection_id, account.id::text as account_id
      from meta_connections connection
      join data_sources source on source.workspace_id = connection.workspace_id and source.meta_connection_id = connection.id
      join ad_accounts account on account.workspace_id = source.workspace_id and account.data_source_id = source.id
      where connection.workspace_id = ${source.workspaceId}::uuid and account.external_account_id = ${source.accountRef}
      limit 2
    `))[0];
    if (!scope || typeof scope.connection_id !== "string" || typeof scope.account_id !== "string") {
      throw new Error("budget_verifier_l1_scope_missing");
    }
    analysisConnectionId = scope.connection_id;
    analysisAccountId = scope.account_id;
    const stream = crypto.randomUUID(); const syncRun = crypto.randomUUID(); const slice = crypto.randomUUID(); const insight = crypto.randomUUID();
    await transaction.insert(schema.metaSyncStreams).values({ id: stream, workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, streamType: "insights", status: "completed" });
    await transaction.insert(schema.metaSyncRuns).values({ id: syncRun, workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, streamId: stream, streamType: "insights", idempotencyKey: `budget_verifier_${source.workspaceId}`,
      status: "completed", startedAt: new Date(now.getTime() - 90_000), finishedAt: new Date(now.getTime() - 60_000) });
    await transaction.insert(schema.metaSyncSlices).values({ id: slice, workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, runId: syncRun, streamType: "insights", entityLevel: "campaign", dateStart: day, dateStop: day,
      sliceKey: `budget_verifier_${day}`, status: "completed", completedAt: new Date(now.getTime() - 60_000) });
    await transaction.insert(schema.metaDailyInsights).values({ id: insight, workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, syncRunId: syncRun, syncSliceId: slice, entityLevel: "campaign", externalEntityId: source.campaignRef,
      dateStart: day, dateStop: day, attributionLabel: "7d_click_1d_view", attributionWindow: { click: 7, view: 1 }, currency: "TRY",
      timezone: "Europe/Istanbul", sourceRevision: "budget-verifier-v1", sourcePayloadHash: "b".repeat(64),
      sourceUpdatedAt: new Date(now.getTime() - 60_000), metricProvenance: { source: "acceptance_fixture" } });
    await transaction.insert(schema.metaDailyInsightMetrics).values({ dailyInsightId: insight, metricKey: "spend", aggregation: "additive", valueMinor: 100,
      currency: "TRY", provenance: { field: "spend" }, sourceRevision: "budget-verifier-v1", sourcePayloadHash: "b".repeat(64) });

    const asOf = new Date(now.getTime() + 1_000).toISOString();
    const timeframe = resolveAnalysisTimeframe({ timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" }, comparison: "none", asOf, anchors: {} });
    const plan = buildFindingObservationPlan({ workspaceId: source.workspaceId, metaConnectionId: scope.connection_id, adAccountId: scope.account_id,
      entityLevel: "campaign", externalEntityId: source.campaignRef, attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY", timeframe,
      spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1", minimumSample: 1 }, maxRowsPerQuery: 10 });
    const query = plan.queries[0];
    if (!query) throw new Error("budget_verifier_l1_plan_empty");
    const reads = new DrizzleFindingObservationReadPort(transaction as never, { resolve: async () => ({
      policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION, policyRef: "settlement_budget_verifier",
      evaluatedAsOf: now.toISOString(), settledThroughDate: day,
    }) });
    const observed = buildFindingObservations({ plan, reads: [(await reads.readForFeatureSnapshot(query)).read] })[0];
    if (!observed || observed.qualityStatus !== "ready" || !observed.settled) throw new Error("budget_verifier_l1_not_ready");
    const feature = buildDeterministicFeatureSnapshot({ scope: { workspaceId: source.workspaceId, metaConnectionId: scope.connection_id,
      adAccountId: scope.account_id, entityLevel: "campaign", externalEntityId: source.campaignRef }, observation: observed });
    const stored = await new DrizzleDeterministicFeatureSnapshotRepository(transaction as never).save({ feature,
      source: await reads.readForFeatureSnapshot(query) });
    if (stored.outcome !== "inserted") throw new Error("budget_verifier_l2_not_persisted");
    featureRef = feature.featureRef;
  });

  const base = await createDrizzleEffectiveAnalysisContextComposer({ database: database as never }).composeAndSave(source.request);
  const l3AsOf = new Date(Math.max(Date.now() + 1_000, Date.parse(base.context.capturedAt) + 1_000)).toISOString();
  const timeframe = resolveAnalysisTimeframe({ timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" }, comparison: "none", asOf: l3AsOf, anchors: {} });
  if (!analysisConnectionId || !analysisAccountId) throw new Error("budget_verifier_l3_scope_missing");
  // Surface the bounded repository error before the higher-level composer
  // deliberately collapses it to source_rejected. This remains verifier-only
  // and writes the same immutable L3 window the composer would materialize.
  let l3QueryStage = 0;
  const l3Database = Object.freeze({
    transaction: async (work: (transaction: unknown) => Promise<unknown>) => database.transaction(async (transaction) => {
      const observed = Object.create(transaction) as { execute: (query: unknown) => Promise<unknown> };
      observed.execute = async (query) => {
        l3QueryStage += 1;
        try { return await transaction.execute(query as never); }
        catch (error) {
          const message = error instanceof Error ? error.message.replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, "<uuid>") : "unknown";
          throw new Error(`budget_verifier_l3_query_${l3QueryStage}:${message}`);
        }
      };
      return work(observed);
    }),
  });
  try {
    await new DrizzleDeterministicWindowSnapshotRepository(l3Database as never).materializeForTimeframe({
      workspaceId: source.workspaceId,
      metaConnectionId: analysisConnectionId,
      adAccountId: analysisAccountId,
      entityLevel: "campaign",
      externalEntityId: source.campaignRef,
      timeframe,
    });
  } catch (error) {
    let code = "unknown";
    let candidate: unknown = error;
    for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
      if ("code" in candidate && typeof candidate.code === "string") { code = candidate.code; break; }
      candidate = "cause" in candidate ? candidate.cause : undefined;
    }
    const kind = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,80}$/.test(error.name)
      ? error.name : "unknown";
    const messages: string[] = [];
    candidate = error;
    for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
      if (candidate instanceof Error) messages.push(candidate.message.toLowerCase());
      candidate = "cause" in candidate ? candidate.cause : undefined;
    }
    const category = messages.some((message) => message.includes("uuid")) ? "uuid"
      : messages.some((message) => message.includes("date")) ? "date"
      : messages.some((message) => message.includes("json")) ? "json"
      : "other";
    const stage = messages.find((message) => message.startsWith("budget_verifier_l3_query_")) ?? "budget_verifier_l3_query_unknown";
    throw new Error(`budget_verifier_l3_window_${code}_${kind}_${category}_${stage}`);
  }
  let l3: Awaited<ReturnType<ReturnType<typeof createDrizzleTimeframeBoundAnalysisContextComposer>["composeAndSave"]>>;
  try {
    l3 = await createDrizzleTimeframeBoundAnalysisContextComposer({ database: database as never, now: () => new Date(l3AsOf) })
      .composeAndSave({ workspaceId: source.workspaceId, entityType: "campaign", entityRef: source.campaignRef, timeframe });
  } catch (error) {
    const code = error && typeof error === "object" && "diagnosticCode" in error && typeof error.diagnosticCode === "string"
      ? error.diagnosticCode : "unknown";
    throw new Error(`budget_verifier_l3_persistence_${code}`);
  }
  return Object.freeze({ contextHash: l3.context.contextHash,
    ready: l3.context.data.trustStatus === "ready" && l3.context.data.blockers.length === 0
      && l3.context.data.featureRefs.length === 1 && l3.context.data.featureRefs[0] === featureRef
      && l3.context.data.windowRefs.length === 1 });
}

const originalFetch = globalThis.fetch;
let fixture: Awaited<ReturnType<typeof materializeCurrentEffectiveAnalysisContextSourceFixture>> | null = null;
try {
  globalThis.fetch = (async () => { evidence.metaCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  fixture = await materializeCurrentEffectiveAnalysisContextSourceFixture(database as never);
  const sourceFixture = fixture;
  evidence.fixtureCommitted = true;
  const prepared = await materializeReadyBudgetContext(sourceFixture);
  evidence.sourceBoundContext = prepared.ready;
  evidence.readyL3Context = prepared.ready;
  await database.transaction(async (transaction) => {
    const applied = rows(await transaction.execute(sql`
      select to_regclass('public.budget_proposal_versions')::text as versions,
        to_regclass('public.budget_proposal_alternatives')::text as alternatives
    `))[0];
    evidence.tablesApplied = Boolean(applied?.versions && applied?.alternatives);
    if (!evidence.tablesApplied) throw new Error("Budget proposal migration uygulanmadı");

    const scope = { workspaceId: sourceFixture.workspaceId, adAccountId: sourceFixture.adAccountId, campaignId: sourceFixture.campaignId, contextHash: prepared.contextHash };
    const repository = new DrizzleBudgetProposalRepository(transaction as never);
    const service = new BudgetProposalService(repository, repository);
    const base: BudgetProposalInput = {
      scope, seriesRef: "budget.series.verifier", revision: 1, previousProposalHash: "GENESIS",
      idempotencyKey: "budget.verifier.r1", createdAt: "2026-08-07T12:30:00.000Z",
      scenarios: [scenario("keep", 10_000), scenario("conservative", 11_000), scenario("target_seeking", 12_000)],
      outcomeProxy: {
        target: { targetRef: "target.patient", outcomeRef: "patient", direction: "maximize", targetValueDecimal: "10", unitRef: "patient", timeframeRef: "monthly_august" },
        context: { categoryRef: "category.health", objectiveRef: "objective.sales" }, asOfAt: "2026-08-07T12:00:00.000Z", mappings: [],
        policy: { minimumSampleSize: 100, minimumCoverageBps: 9000, maximumLagMinutes: 2880, minimumConfidenceBps: 7500, maximumEvidenceFreshnessMinutes: 180 },
      },
    };
    const first = await service.create(base);
    evidence.exactContextBinding = first.proposal.scope.contextHash === prepared.contextHash;
    evidence.mappingSuppression = first.proposal.alternatives[2]?.status === "suppressed";
    evidence.mappingIndependentScenarios = first.proposal.alternatives.slice(0, 2).every((item) => item.status === "composed");
    evidence.idempotency = (await service.create(base)).persistence === "unchanged";
    const second = await service.create({
      ...base, revision: 2, previousProposalHash: first.proposal.proposalHash,
      idempotencyKey: "budget.verifier.r2", createdAt: "2026-08-07T13:30:00.000Z",
    });
    evidence.revisionChain = second.proposal.revision === 2;
    const draftService = new BudgetLabDraftService(repository, repository);
    const draftCommand = {
      ...base,
      scope: { adAccountId: sourceFixture.adAccountId, campaignId: sourceFixture.campaignId, contextHash: prepared.contextHash },
      seriesRef: "budget.series.draft-verifier", revision: 1, previousProposalHash: "GENESIS",
      idempotencyKey: "budget.verifier.draft.r1", createdAt: "2026-08-07T14:00:00.000Z",
    } as const;
    const draft = await draftService.saveDraft(sourceFixture.workspaceId, sourceFixture.actorId, "2026-08-07T14:00:01.000Z", draftCommand);
    const replay = await draftService.saveDraft(sourceFixture.workspaceId, sourceFixture.actorId, "2026-08-07T14:00:02.000Z", draftCommand);
    const auditRows = rows(await transaction.execute(sql`
      select action, resource_id, previous_hash, event_hash from audit_events
      where workspace_id = ${sourceFixture.workspaceId}::uuid and action = 'budget.draft_saved'
    `));
    evidence.draftAuditAtomic = draft.persistence === "inserted" && draft.auditAppended
      && auditRows.length === 1 && auditRows[0]?.resource_id === draft.proposal.proposalRef
      && typeof auditRows[0]?.previous_hash === "string" && typeof auditRows[0]?.event_hash === "string";
    evidence.draftIdempotency = replay.persistence === "unchanged" && !replay.auditAppended && auditRows.length === 1;
    const publicView = await repository.loadPublic({ workspaceId: sourceFixture.workspaceId, seriesRef: base.seriesRef });
    const serialized = JSON.stringify(publicView);
    evidence.publicProjectionSafe = ![sourceFixture.workspaceId, sourceFixture.adAccountId, sourceFixture.campaignId, prepared.contextHash,
      sourceFixture.accountRef, sourceFixture.campaignRef, "ankara", "dubai"]
      .some((secret) => serialized.includes(secret)) && publicView.writeOperations === 0;
    try {
      await new DrizzleBudgetProposalRepository(transaction as never).loadPublic({ workspaceId: sourceFixture.foreignWorkspaceId, seriesRef: base.seriesRef });
    } catch {
      evidence.crossTenantBlocked = true;
    }
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`update budget_proposal_versions set series_ref = 'tampered' where workspace_id = ${sourceFixture.workspaceId}::uuid`);
      });
    } catch {
      evidence.immutableRows = true;
    }
    const security = rows(await transaction.execute(sql`
      select count(*) filter (where c.relrowsecurity)::int as rls_count,
        (select count(*)::int from information_schema.role_table_grants
          where table_schema = 'public' and table_name in ('budget_proposal_versions', 'budget_proposal_alternatives')
            and grantee in ('anon', 'authenticated')) as api_grants
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('budget_proposal_versions', 'budget_proposal_alternatives')
    `))[0];
    evidence.rlsAndGrants = Number(security?.rls_count) === 2 && Number(security?.api_grants) === 0;
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  globalThis.fetch = originalFetch;
  if (fixture) {
    const residual = rows(await database.execute(sql`
      select (select count(*)::int from budget_proposal_versions where workspace_id = ${fixture.workspaceId}::uuid)
        + (select count(*)::int from budget_proposal_alternatives where workspace_id = ${fixture.workspaceId}::uuid)
        + (select count(*)::int from audit_events where workspace_id = ${fixture.workspaceId}::uuid and action = 'budget.draft_saved') as count
    `))[0];
    evidence.proposalRowsRolledBack = Number(residual?.count) === 0;
    const purge = new DrizzleWorkspaceTombstonePurgePort();
    const tombstones = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge),
      { authorize: async (input) => input.approvalRef === "ephemeral-fixture-approved" }, fixture.actorId, 60_000);
    for (const workspaceId of [fixture.workspaceId, fixture.foreignWorkspaceId]) {
      const plan = await tombstones.dryRun(workspaceId, new Date().toISOString());
      await tombstones.execute({ planRef: plan.planRef, approvalRef: "ephemeral-fixture-approved", now: new Date().toISOString() });
    }
    evidence.purgeCandidateCount = (await purge.inspect(database as never, fixture.workspaceId)).candidateCount;
    evidence.foreignPurgeCandidateCount = (await purge.inspect(database as never, fixture.foreignWorkspaceId)).candidateCount;
    const survivors = rows(await database.execute(sql`
      select count(*) filter (where id = ${fixture.workspaceId}::uuid and lifecycle_state = 'active')::int as primary_count,
        count(*) filter (where id = ${fixture.foreignWorkspaceId}::uuid and lifecycle_state = 'active')::int as foreign_count
      from workspaces where id in (${fixture.workspaceId}::uuid, ${fixture.foreignWorkspaceId}::uuid)
    `))[0];
    evidence.activeSurvivorCount = Number(survivors?.primary_count ?? -1);
    evidence.foreignActiveSurvivorCount = Number(survivors?.foreign_count ?? -1);
    evidence.tombstoneCleanup = evidence.purgeCandidateCount === 0 && evidence.foreignPurgeCandidateCount === 0
      && evidence.activeSurvivorCount === 0 && evidence.foreignActiveSurvivorCount === 0;
  }
}
await pool.end();

const evidencePassed = evidence.tablesApplied && evidence.sourceBoundContext && evidence.readyL3Context
  && evidence.exactContextBinding && evidence.mappingSuppression && evidence.mappingIndependentScenarios
  && evidence.idempotency && evidence.revisionChain && evidence.draftAuditAtomic && evidence.draftIdempotency
  && evidence.publicProjectionSafe && evidence.crossTenantBlocked && evidence.immutableRows && evidence.rlsAndGrants
  && evidence.metaCalls === 0 && evidence.executionCalls === 0 && evidence.proposalRowsRolledBack && evidence.fixtureCommitted
  && evidence.tombstoneCleanup && evidence.purgeCandidateCount === 0 && evidence.foreignPurgeCandidateCount === 0
  && evidence.activeSurvivorCount === 0 && evidence.foreignActiveSurvivorCount === 0;
if (!evidencePassed) {
  throw new Error(`Budget proposal doğrulaması başarısız: ${JSON.stringify(evidence)}`);
}
console.log(JSON.stringify(evidence));
