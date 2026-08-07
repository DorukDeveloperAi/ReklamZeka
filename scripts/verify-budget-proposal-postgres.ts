import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { BudgetLabDraftService } from "@/application/budget-lab-draft-service";
import { BudgetProposalService, type BudgetProposalInput } from "@/application/budget-proposal-service";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import * as schema from "@/db/schema";
import type { BudgetScenarioDefinition } from "@/domain/budget/scenario-composer";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const actorId = randomUUID();
const connectionId = randomUUID();
const sourceId = randomUUID();
const accountId = randomUUID();
const campaignId = randomUUID();
const snapshotRef = `snapshot_${"a".repeat(20)}`;
const now = "2026-08-07T12:00:00.000Z";

const evidence = {
  tablesApplied: false, exactContextBinding: false, mappingSuppression: false,
  mappingIndependentScenarios: false, idempotency: false, revisionChain: false,
  draftAuditAtomic: false, draftIdempotency: false,
  publicProjectionSafe: false, crossTenantBlocked: false, immutableRows: false,
  rlsAndGrants: false, metaCalls: 0, executionCalls: 0, temporaryRowsCommitted: true,
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

try {
  await database.transaction(async (transaction) => {
    const applied = rows(await transaction.execute(sql`
      select to_regclass('public.budget_proposal_versions')::text as versions,
        to_regclass('public.budget_proposal_alternatives')::text as alternatives
    `))[0];
    evidence.tablesApplied = Boolean(applied?.versions && applied?.alternatives);
    if (!evidence.tablesApplied) throw new Error("Budget proposal migration uygulanmadı");

    await transaction.insert(schema.workspaces).values([
      { id: workspaceId, name: "Budget proposal verifier" },
      { id: foreignWorkspaceId, name: "Foreign budget proposal verifier" },
    ]);
    await transaction.insert(schema.users).values({ id: actorId, email: `budget-verifier-${actorId}@example.invalid` });
    await transaction.insert(schema.metaConnections).values({
      id: connectionId, workspaceId, externalConnectionKey: "budget-verifier", displayName: "Budget verifier",
      graphApiVersion: "v1", fieldCatalogVersion: "fields-v1", status: "active",
    });
    await transaction.insert(schema.dataSources).values({
      id: sourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads",
      externalAccountId: "account_safe", displayName: "Budget verifier",
    });
    await transaction.insert(schema.adAccounts).values({
      id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: "account_safe",
      name: "Budget verifier", currency: "TRY", timezone: "Europe/Istanbul",
    });
    await transaction.insert(schema.adCampaigns).values({
      id: campaignId, workspaceId, adAccountId: accountId,
      externalCampaignId: "campaign_safe", name: "Budget verifier campaign",
    });
    await transaction.insert(schema.metaChangeSnapshots).values({
      workspaceId, metaConnectionId: connectionId, adAccountId: accountId,
      publicRef: snapshotRef, snapshotHash: "b".repeat(64), schemaVersion: 1,
      fieldCatalogVersion: "fields-v1", capturedAt: new Date(now), canonicalPayload: { entities: [] },
      safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 1, unknownFieldCount: 0 },
    });
    const registry = createGuidanceRegistry({ workspaceId, sources: [], cards: [], bindings: [], sets: [] });
    const guidance = buildEffectiveGuidancePack(registry, {
      workspaceId, accountId: "account_safe", objective: "sales", internalCategoryIds: [],
      entity: { type: "campaign", id: "campaign_safe" }, topics: [], requiredTopics: [], evaluatedAt: now,
      budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
    });
    const context = buildEffectiveCampaignContext({
      workspaceId, capturedAt: now,
      identity: { connectionRef: "budget-verifier", accountRef: "account_safe", campaignRef: "campaign_safe", entityRef: "campaign_safe", entityType: "campaign", hierarchyRefs: ["campaign_safe"] },
      meta: {
        objective: { state: "known", value: "sales" }, optimizationEvent: { state: "known", value: "purchase" },
        configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
        budgetOwnerRef: { state: "known", value: "campaign_safe" }, targetingSignature: { state: "unknown", reason: "not_loaded" },
        actorRef: { state: "known", value: "actor_safe" }, destinationRef: { state: "known", value: null },
      },
      categories: [], guidance, policies: [],
      cadence: { profileRef: "cadence_safe", decision: "eligible", reason: "window_open", cooldownUntil: null },
      data: { trustStatus: "ready", snapshotRefs: [snapshotRef], featureRefs: [snapshotRef], windowRefs: ["window_safe"], blockers: [] },
      history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
      versions: { metaCatalog: "meta_v1", categoryResolver: "category_v1", guidanceRegistry: "guidance_v1", metricCatalog: "metric_v1", formulaCatalog: "formula_v1", timeframeResolver: "timeframe_v1" },
    });
    await new DrizzleEffectiveCampaignContextRepository(transaction as never).save(context);

    const scope = { workspaceId, adAccountId: accountId, campaignId, contextHash: context.contextHash };
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
    evidence.exactContextBinding = first.proposal.scope.contextHash === context.contextHash;
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
      scope: { adAccountId: accountId, campaignId, contextHash: context.contextHash },
      seriesRef: "budget.series.draft-verifier", revision: 1, previousProposalHash: "GENESIS",
      idempotencyKey: "budget.verifier.draft.r1", createdAt: "2026-08-07T14:00:00.000Z",
    } as const;
    const draft = await draftService.saveDraft(workspaceId, actorId, "2026-08-07T14:00:01.000Z", draftCommand);
    const replay = await draftService.saveDraft(workspaceId, actorId, "2026-08-07T14:00:02.000Z", draftCommand);
    const auditRows = rows(await transaction.execute(sql`
      select action, resource_id, previous_hash, event_hash from audit_events
      where workspace_id = ${workspaceId}::uuid and action = 'budget.draft_saved'
    `));
    evidence.draftAuditAtomic = draft.persistence === "inserted" && draft.auditAppended
      && auditRows.length === 1 && auditRows[0]?.resource_id === draft.proposal.proposalRef
      && typeof auditRows[0]?.previous_hash === "string" && typeof auditRows[0]?.event_hash === "string";
    evidence.draftIdempotency = replay.persistence === "unchanged" && !replay.auditAppended && auditRows.length === 1;
    const publicView = await repository.loadPublic({ workspaceId, seriesRef: base.seriesRef });
    const serialized = JSON.stringify(publicView);
    evidence.publicProjectionSafe = ![workspaceId, accountId, campaignId, context.contextHash,
      "account_safe", "campaign_safe", "ankara", "dubai"]
      .some((secret) => serialized.includes(secret)) && publicView.writeOperations === 0;
    try {
      await new DrizzleBudgetProposalRepository(transaction as never).loadPublic({ workspaceId: foreignWorkspaceId, seriesRef: base.seriesRef });
    } catch {
      evidence.crossTenantBlocked = true;
    }
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`update budget_proposal_versions set series_ref = 'tampered' where workspace_id = ${workspaceId}::uuid`);
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
}

const residual = rows(await database.execute(sql`
  select (select count(*)::int from workspaces where id in (${workspaceId}::uuid, ${foreignWorkspaceId}::uuid))
    + (select count(*)::int from users where id = ${actorId}::uuid)
    + (select count(*)::int from budget_proposal_versions where workspace_id = ${workspaceId}::uuid)
    + (select count(*)::int from budget_proposal_alternatives where workspace_id = ${workspaceId}::uuid)
    + (select count(*)::int from audit_events where workspace_id = ${workspaceId}::uuid) as count
`))[0];
evidence.temporaryRowsCommitted = Number(residual?.count) !== 0;
await pool.end();

if (Object.entries(evidence).some(([key, value]) => key.endsWith("Calls") ? value !== 0 : value !== (key === "temporaryRowsCommitted" ? false : true))) {
  throw new Error(`Budget proposal doğrulaması başarısız: ${JSON.stringify(evidence)}`);
}
console.log(JSON.stringify(evidence));
