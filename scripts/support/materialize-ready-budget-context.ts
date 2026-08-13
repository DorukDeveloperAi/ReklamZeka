import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { buildFindingObservationPlan, buildFindingObservations } from "@/analyses/finding-observation-builder";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { DrizzleDeterministicFeatureSnapshotRepository } from "@/connectors/analyses/deterministic-feature-snapshot-drizzle-repository";
import { DrizzleDeterministicWindowSnapshotRepository } from "@/connectors/analyses/deterministic-window-snapshot-drizzle-repository";
import { DrizzleFindingObservationReadPort, FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION } from "@/connectors/analyses/finding-observation-drizzle-read-port";
import * as schema from "@/db/schema";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";
import { createDrizzleTimeframeBoundAnalysisContextComposer } from "@/server/timeframe-bound-analysis-context-composer-runtime";

type Database = NodePgDatabase<typeof schema>;
export type ReadyBudgetContextSource = Readonly<{
  workspaceId: string;
  accountRef: string;
  campaignRef: string;
  request: Readonly<{
    workspaceId: string;
    accountRef: string;
    entityType: "campaign" | "ad_set";
    entityRef: string;
  }>;
}>;
const rows = (result: unknown): readonly Record<string, unknown>[] => result && typeof result === "object" && "rows" in result && Array.isArray(result.rows) ? result.rows as readonly Record<string, unknown>[] : [];

/**
 * Creates the smallest authentic L1→L3 evidence chain through the production
 * writers. The fixture's L1/L2 branch intentionally commits first: its source
 * reader takes a repeatable-read snapshot. Callers own tombstone cleanup.
 */
export async function materializeReadyBudgetContext(database: Database, source: ReadyBudgetContextSource): Promise<Readonly<{ contextHash: string; ready: boolean }>> {
  const now = new Date();
  // The observation window is market-timezone based. UTC date rolls earlier
  // than Europe/Istanbul around midnight, so fixture insight dates must come
  // from the resolved query window rather than `toISOString().slice(0, 10)`.
  const l1AsOf = new Date(now.getTime() + 1_000).toISOString();
  const l1Timeframe = resolveAnalysisTimeframe({ timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" }, comparison: "none", asOf: l1AsOf, anchors: {} });
  const day = l1Timeframe.startDate; let featureRef = ""; let connectionId = ""; let accountId = "";
  const entityLevel = source.request.entityType === "campaign" ? "campaign" : "ad_set";
  await database.transaction(async (transaction) => {
    const scope = rows(await transaction.execute(sql`select connection.id::text as connection_id, account.id::text as account_id from meta_connections connection join data_sources source on source.workspace_id=connection.workspace_id and source.meta_connection_id=connection.id join ad_accounts account on account.workspace_id=source.workspace_id and account.data_source_id=source.id where connection.workspace_id=${source.workspaceId}::uuid and account.external_account_id=${source.accountRef} limit 2`))[0];
    if (!scope || typeof scope.connection_id !== "string" || typeof scope.account_id !== "string") throw new Error("ready_budget_context_l1_scope_missing");
    connectionId = scope.connection_id; accountId = scope.account_id;
    const existingStream = rows(await transaction.execute(sql`select id::text as id from meta_sync_streams where workspace_id=${source.workspaceId}::uuid and meta_connection_id=${connectionId}::uuid and ad_account_id=${accountId}::uuid and stream_type='insights' limit 2`));
    if (existingStream.length > 1 || existingStream[0] && typeof existingStream[0].id !== "string") throw new Error("ready_budget_context_l1_stream_corrupt");
    const stream = typeof existingStream[0]?.id === "string" ? existingStream[0].id : crypto.randomUUID();
    const syncRun = crypto.randomUUID(), slice = crypto.randomUUID(), insight = crypto.randomUUID();
    if (!existingStream[0]) await transaction.insert(schema.metaSyncStreams).values({ id: stream, workspaceId: source.workspaceId, metaConnectionId: connectionId, adAccountId: accountId, streamType: "insights", status: "completed" });
    const runKey = `ready_budget_context_${createHash("sha256").update(`${source.workspaceId}\0${entityLevel}\0${source.request.entityRef}`).digest("hex").slice(0, 40)}`;
    await transaction.insert(schema.metaSyncRuns).values({ id: syncRun, workspaceId: source.workspaceId, metaConnectionId: connectionId, adAccountId: accountId, streamId: stream, streamType: "insights", idempotencyKey: runKey, status: "completed", startedAt: new Date(now.getTime() - 90_000), finishedAt: new Date(now.getTime() - 60_000) });
    await transaction.insert(schema.metaSyncSlices).values({ id: slice, workspaceId: source.workspaceId, metaConnectionId: connectionId, adAccountId: accountId, runId: syncRun, streamType: "insights", entityLevel, dateStart: day, dateStop: day, sliceKey: `ready_budget_context_${entityLevel}_${day}`, status: "completed", completedAt: new Date(now.getTime() - 60_000) });
    await transaction.insert(schema.metaDailyInsights).values({ id: insight, workspaceId: source.workspaceId, metaConnectionId: connectionId, adAccountId: accountId, syncRunId: syncRun, syncSliceId: slice, entityLevel, externalEntityId: source.request.entityRef, dateStart: day, dateStop: day, attributionLabel: "7d_click_1d_view", attributionWindow: { click: 7, view: 1 }, currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "ready-budget-context-v1", sourcePayloadHash: "b".repeat(64), sourceUpdatedAt: new Date(now.getTime() - 60_000), metricProvenance: { source: "acceptance_fixture" } });
    await transaction.insert(schema.metaDailyInsightMetrics).values({ dailyInsightId: insight, metricKey: "spend", aggregation: "additive", valueMinor: 100, currency: "TRY", provenance: { field: "spend" }, sourceRevision: "ready-budget-context-v1", sourcePayloadHash: "b".repeat(64) });
    const timeframe = l1Timeframe;
    const plan = buildFindingObservationPlan({ workspaceId: source.workspaceId, metaConnectionId: connectionId, adAccountId: accountId, entityLevel, externalEntityId: source.request.entityRef, attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY", timeframe, spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1", minimumSample: 1 }, maxRowsPerQuery: 10 });
    const query = plan.queries[0]; if (!query) throw new Error("ready_budget_context_l1_plan_empty");
    const reads = new DrizzleFindingObservationReadPort(transaction as never, { resolve: async () => ({ policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION, policyRef: "settlement_ready_budget_context", evaluatedAsOf: now.toISOString(), settledThroughDate: day }) });
    const observed = buildFindingObservations({ plan, reads: [(await reads.readForFeatureSnapshot(query)).read] })[0];
    if (!observed || observed.qualityStatus !== "ready" || !observed.settled) throw new Error("ready_budget_context_l1_not_ready");
    const feature = buildDeterministicFeatureSnapshot({ scope: { workspaceId: source.workspaceId, metaConnectionId: connectionId, adAccountId: accountId, entityLevel, externalEntityId: source.request.entityRef }, observation: observed });
    if ((await new DrizzleDeterministicFeatureSnapshotRepository(transaction as never).save({ feature, source: await reads.readForFeatureSnapshot(query) })).outcome !== "inserted") throw new Error("ready_budget_context_l2_not_persisted");
    featureRef = feature.featureRef;
  });
  const base = await createDrizzleEffectiveAnalysisContextComposer({ database: database as never }).composeAndSave(source.request);
  const asOf = new Date(Math.max(Date.now() + 1_000, Date.parse(base.context.capturedAt) + 1_000)).toISOString();
  const timeframe = resolveAnalysisTimeframe({ timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" }, comparison: "none", asOf, anchors: {} });
  if (!connectionId || !accountId) throw new Error("ready_budget_context_l3_scope_missing");
  await new DrizzleDeterministicWindowSnapshotRepository(database as never).materializeForTimeframe({ workspaceId: source.workspaceId, metaConnectionId: connectionId, adAccountId: accountId, entityLevel, externalEntityId: source.request.entityRef, timeframe });
  const l3 = await createDrizzleTimeframeBoundAnalysisContextComposer({ database: database as never, now: () => new Date(asOf) }).composeAndSave({ workspaceId: source.workspaceId, entityType: source.request.entityType, entityRef: source.request.entityRef, timeframe });
  return Object.freeze({ contextHash: l3.context.contextHash, ready: l3.context.data.trustStatus === "ready" && l3.context.data.blockers.length === 0 && l3.context.data.featureRefs.length === 1 && l3.context.data.featureRefs[0] === featureRef && l3.context.data.windowRefs.length === 1 });
}
