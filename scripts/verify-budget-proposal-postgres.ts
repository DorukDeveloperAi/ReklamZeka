import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { BudgetLabDraftService } from "@/application/budget-lab-draft-service";
import { BudgetProposalService, type BudgetProposalInput } from "@/application/budget-proposal-service";
import { DrizzleBudgetProposalRepository } from "@/connectors/budget/budget-proposal-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import * as schema from "@/db/schema";
import type { BudgetScenarioDefinition } from "@/domain/budget/scenario-composer";
import { materializeCurrentEffectiveAnalysisContextSourceFixture } from "./support/current-effective-analysis-context-source-fixture";
import { materializeReadyBudgetContext } from "./support/materialize-ready-budget-context";

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

const originalFetch = globalThis.fetch;
let fixture: Awaited<ReturnType<typeof materializeCurrentEffectiveAnalysisContextSourceFixture>> | null = null;
try {
  globalThis.fetch = (async () => { evidence.metaCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  fixture = await materializeCurrentEffectiveAnalysisContextSourceFixture(database as never);
  const sourceFixture = fixture;
  evidence.fixtureCommitted = true;
  const prepared = await materializeReadyBudgetContext(database, sourceFixture);
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
