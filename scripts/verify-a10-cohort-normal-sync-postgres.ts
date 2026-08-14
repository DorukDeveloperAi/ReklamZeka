import { existsSync } from "node:fs";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import { materializeA10CohortRootScopeFixture } from "./support/a10-cohort-root-scope-fixture";
import { materializeA10CohortSyncFixture } from "./support/a10-cohort-sync-fixture";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
// Match the production read-sync verifier's transaction-pooler boundary. The
// direct endpoint cannot safely stand in for its independently committed runs.
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured", requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:a10-cohort-normal-sync-db" })}\n`);
  process.exit(2);
}

const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
let workspaceId: string | null = null;
let actorId: string | null = null;
let normalSourceWritten = false;
let canonicalSnapshotsWritten = false;
let noMetaWriteOrNetwork = false;
let cleanupVerified = false;
let phase = "root_bootstrap";

try {
  // The normal sync runtime owns nested transactions. Do not wrap it in an
  // outer transaction: that would make its committed writer chain untestable
  // under a transaction-pooler. Cleanup below uses the normal locked lifecycle.
  const fixture = await materializeA10CohortRootScopeFixture(database);
  workspaceId = fixture.root.workspaceId;
  actorId = fixture.actorId;
  phase = "normal_read_sync";
  const result = await materializeA10CohortSyncFixture({
    connectionString,
    root: fixture.root,
    parentRunId: `a10_cohort_live_${fixture.root.workspaceId.replaceAll("-", "")}`,
    observedAt: new Date("2026-08-10T12:00:00.000Z"),
  });
  phase = "persisted_counts";
  const counts = await Promise.all([
    database.select({ value: sql<number>`count(*)::int` }).from(schema.adCampaigns).where(eq(schema.adCampaigns.workspaceId, fixture.root.workspaceId)),
    database.select({ value: sql<number>`count(*)::int` }).from(schema.metaAdSets).where(eq(schema.metaAdSets.workspaceId, fixture.root.workspaceId)),
    database.select({ value: sql<number>`count(*)::int` }).from(schema.metaDailyInsights).where(eq(schema.metaDailyInsights.workspaceId, fixture.root.workspaceId)),
    database.select({ value: sql<number>`count(*)::int` }).from(schema.metaChangeSnapshots).where(eq(schema.metaChangeSnapshots.workspaceId, fixture.root.workspaceId)),
  ]);
  normalSourceWritten = result.runtimeStatus === "completed"
    && result.persisted.campaigns === 5 && result.persisted.adSets === 5 && result.persisted.campaignInsights === 5
    && counts[0][0]?.value === 5 && counts[1][0]?.value === 5 && counts[2][0]?.value === 5;
  canonicalSnapshotsWritten = result.snapshot.insertedSnapshots === 2 && counts[3][0]?.value === 2;
  noMetaWriteOrNetwork = result.transport.writeNetworkCalls === 0 && result.transport.requestCount === 5;
  if (!normalSourceWritten || !canonicalSnapshotsWritten || !noMetaWriteOrNetwork) {
    throw new Error(`a10_cohort_normal_sync_rejected:${JSON.stringify({ result, counts })}`);
  }
} finally {
  phase = "locked_tombstone_cleanup";
  if (workspaceId && actorId) {
    const purge = new DrizzleWorkspaceTombstonePurgePort();
    const tombstones = new WorkspaceTombstoneService(
      new DrizzleWorkspaceTombstoneStore(database, purge),
      { authorize: async (input) => input.approvalRef === "ephemeral-a10-cohort-fixture-approved" },
      actorId,
      60_000,
    );
    const plan = await tombstones.dryRun(workspaceId, new Date().toISOString());
    await tombstones.execute({ planRef: plan.planRef, approvalRef: "ephemeral-a10-cohort-fixture-approved", now: new Date().toISOString() });
    cleanupVerified = (await purge.inspect(database, workspaceId)).candidateCount === 0
      && (await database.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))).length === 1;
  }
  await pool.end();
}
if (!cleanupVerified) throw new Error(`a10_cohort_normal_sync_cleanup_failed:${phase}`);

console.log(JSON.stringify({
  ok: true,
  scope: "a10_root_identity_bootstrap_normal_get_only_sync_locked_tombstone_cleanup",
  normalSourceWritten,
  canonicalSnapshotsWritten,
  noMetaWriteOrNetwork,
  cleanupVerified,
  temporaryRowsCommitted: true,
  nextBoundary: "normal category/guidance/cadence/authority lifecycle plus L2/L3 evidence must be composed from this synced source before robust cohort persistence",
  phase: "complete",
}));
