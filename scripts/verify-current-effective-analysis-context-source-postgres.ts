import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleCurrentEffectiveAnalysisContextSourceReader } from "@/connectors/analyses/current-effective-analysis-context-source-drizzle-reader";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";
import { EffectiveAnalysisContextComposerError } from "@/application/effective-analysis-context-composer";
import { projectMetaAnalysisConfig } from "@/domain/meta/analysis-config-projection";
import * as schema from "@/db/schema";
import { materializeCurrentEffectiveAnalysisContextSourceFixture } from "./support/current-effective-analysis-context-source-fixture";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:current-effective-analysis-context-source-db" })}\n`);
  process.exit(2);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const fixtureResidue = rows(await database.execute(sql`
  select count(*)::int as count from workspaces
  where lifecycle_state = 'active' and name in ('Current source verifier', 'Current source foreign')
`))[0]?.count;
if (Number(fixtureResidue ?? -1) !== 0) {
  await pool.end();
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "ephemeral_current_source_fixture_residue_detected",
    activeFixtureCount: Number(fixtureResidue ?? -1), continuation: "ALLOW_EPHEMERAL_CURRENT_SOURCE_FIXTURE_RECOVERY=1 npm run recover:current-effective-analysis-context-source-fixtures-db" })}\n`);
  process.exit(2);
}
const cleanupPrerequisite = rows(await database.execute(sql`
  select to_regclass('public.action_execution_attempts')::text as action_execution_attempts
`))[0]?.action_execution_attempts;
if (cleanupPrerequisite !== "action_execution_attempts") {
  await pool.end();
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "workspace_tombstone_purge_schema_not_migrated",
    requiredTable: "action_execution_attempts", continuation: "apply pending forward migrations, then rerun npm run verify:current-effective-analysis-context-source-db" })}\n`);
  process.exit(2);
}
let verificationPhase = "bootstrap";
function phase(value: string): void {
  verificationPhase = value;
  if (process.env.VERIFIER_PHASE_OUTPUT === "1") {
    process.stderr.write(`${JSON.stringify({ verifier: "current_effective_analysis_context_source", phase: value })}\n`);
  }
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as readonly Record<string, unknown>[] : [];
}

let fetchCalls = 0; let ready = false; let saved = false; let reloaded = false;
let crossTenantBlocked = false; let malformedBlocked = false; let fixtureCommitted = false;
let cleanupSucceeded = false; let activeSurvivorCount = -1; let purgeCandidateCount = -1;
let foreignActiveSurvivorCount = -1; let foreignPurgeCandidateCount = -1;
let cleanupError: string | null = null;
const originalFetch = globalThis.fetch;
let fixture: Awaited<ReturnType<typeof materializeCurrentEffectiveAnalysisContextSourceFixture>> | null = null;

try {
  phase("fixture_materialization");
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  fixture = await materializeCurrentEffectiveAnalysisContextSourceFixture(database as never);
  fixtureCommitted = true;
  const { workspaceId, foreignWorkspaceId, actorId, campaignRef, request } = fixture;
  const reader = new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never);
    phase("closed_world_read_compose_reload");
    const source = await reader.loadCurrent(request);
    if (source.status !== "ready") throw new Error("closed_world_source_not_ready");
    const readySource = source;
    ready = true;
    if (process.env.VERIFIER_PHASE_OUTPUT === "1") {
      const authority = readySource.authority as unknown as { catalog?: { workspaceRef?: unknown }; scope?: {
        workspaceRef?: unknown; evaluatedAt?: unknown; objectiveEvidence?: { canonicalObjective?: unknown } } };
      const projectedObjective = projectMetaAnalysisConfig(readySource.facts.metaAnalysisConfigSnapshot, readySource.facts.identity.campaignRef).objective;
      process.stderr.write(`${JSON.stringify({ verifier: "current_effective_analysis_context_source", phase: verificationPhase,
        authorityScopeWorkspaceMatchesCatalog: authority.scope?.workspaceRef === authority.catalog?.workspaceRef,
        authorityScopeAtOrBeforeCapture: typeof authority.scope?.evaluatedAt === "string" && authority.scope.evaluatedAt <= readySource.capturedAt,
        authorityScopeObjectiveMatchesMeta: authority.scope?.objectiveEvidence?.canonicalObjective === (projectedObjective.state === "known" ? projectedObjective.value : null) })}\n`);
    }
    const composer = createDrizzleEffectiveAnalysisContextComposer({ database: database as never });
    const composed = await composer.composeAndSave(request).catch((error: unknown) => {
      if (error instanceof EffectiveAnalysisContextComposerError) {
        process.stderr.write(`${JSON.stringify({ verifier: "current_effective_analysis_context_source", phase: verificationPhase,
          composeRejection: error.code, diagnosticCode: error.diagnosticCode ?? null })}\n`);
      }
      throw error;
    }); saved = composed.outcome === "inserted";
    const stored = await new DrizzleEffectiveCampaignContextRepository(database as never).loadLatestValidCampaignPublic({ workspaceId,
      campaignRef: `ref_${createHash("sha256").update(campaignRef).digest("hex").slice(0, 12)}` });
    reloaded = stored !== null && stored.context.contextHash === composed.context.contextHash;
    crossTenantBlocked = await reader.loadCurrent({ ...request, workspaceId: foreignWorkspaceId }).then(() => false, () => true);
    malformedBlocked = await reader.loadCurrent({ ...request, entityRef: "bad ref" }).then(() => false, () => true);
    if (!saved || !reloaded || !crossTenantBlocked || !malformedBlocked || fetchCalls !== 0) throw new Error("closed_world_acceptance_failed");
} finally {
  globalThis.fetch = originalFetch;
  if (fixtureCommitted && fixture) {
    try {
      phase("tombstone_cleanup");
      const purge = new DrizzleWorkspaceTombstonePurgePort();
      const service = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge),
        { authorize: async (input) => input.approvalRef === "ephemeral-fixture-approved" }, fixture.actorId, 60_000);
      for (const fixtureWorkspaceId of [fixture.workspaceId, fixture.foreignWorkspaceId]) {
        phase(fixtureWorkspaceId === fixture.workspaceId ? "tombstone_primary" : "tombstone_foreign");
        const plan = await service.dryRun(fixtureWorkspaceId, new Date().toISOString());
        await service.execute({ planRef: plan.planRef, approvalRef: "ephemeral-fixture-approved", now: new Date().toISOString() });
      }
      purgeCandidateCount = (await purge.inspect(database as never, fixture.workspaceId)).candidateCount;
      foreignPurgeCandidateCount = (await purge.inspect(database as never, fixture.foreignWorkspaceId)).candidateCount;
      const activeRows = rows(await database.execute(sql`select count(*) filter (where id = ${fixture.workspaceId}::uuid and lifecycle_state = 'active')::int as primary_count,
        count(*) filter (where id = ${fixture.foreignWorkspaceId}::uuid and lifecycle_state = 'active')::int as foreign_count from workspaces
        where id in (${fixture.workspaceId}::uuid, ${fixture.foreignWorkspaceId}::uuid)`));
      activeSurvivorCount = Number(activeRows[0]?.primary_count ?? -1);
      foreignActiveSurvivorCount = Number(activeRows[0]?.foreign_count ?? -1);
      cleanupSucceeded = purgeCandidateCount === 0 && foreignPurgeCandidateCount === 0 && activeSurvivorCount === 0 && foreignActiveSurvivorCount === 0;
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : "unknown_cleanup_error";
      process.stderr.write(`${JSON.stringify({ ok: false, phase: verificationPhase, cleanupError })}\n`);
    }
  }
}
await pool.end();
if (cleanupError) throw new Error(`ephemeral_fixture_cleanup_failed:${cleanupError}`);
if (!cleanupSucceeded || fetchCalls !== 0) throw new Error("ephemeral_fixture_cleanup_failed");
phase("complete");
console.log(JSON.stringify({ ok: ready && saved && reloaded && crossTenantBlocked && malformedBlocked,
  scope: "closed_world_current_source_ready_compose_save_reload", ready, saved, reloaded, crossTenantBlocked, malformedBlocked,
  actionOrNetworkCalls: fetchCalls, fixtureCommitted, cleanup: "locked_workspace_tombstone", purgeCandidateCount, activeSurvivorCount,
  foreignPurgeCandidateCount, foreignActiveSurvivorCount, verificationPhase }));
