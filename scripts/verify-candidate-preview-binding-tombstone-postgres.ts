import { existsSync } from "node:fs";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleCandidatePreviewBindingRepository } from "@/connectors/guidance/candidate-preview-binding-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import * as schema from "@/db/schema";
import { materializeCandidatePreviewBindingG3Fixture } from "./support/candidate-preview-binding-g3-fixture";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("postgres_connection_not_configured");

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
const ROLLBACK = "candidate_preview_tombstone_outer_rollback";
type Fixture = Awaited<ReturnType<typeof materializeCandidatePreviewBindingG3Fixture>>;
let workspaceId = "";
let materialized = false;
let tombstonePurged = false;
let cleanupSucceeded = false;
let fixture: Fixture | null = null;

function count(rows: unknown): number {
  const values = rows && typeof rows === "object" && "rows" in rows && Array.isArray(rows.rows) ? rows.rows : [];
  return Number((values[0] as Record<string, unknown> | undefined)?.count ?? -1);
}

try {
  // This fixture contains a current-guidance read that intentionally uses the
  // database transaction clock as its consistency boundary. Materialize it in
  // its own committed transaction; only the candidate binding/tombstone proof
  // is outer-rollback scoped below.
  fixture = await materializeCandidatePreviewBindingG3Fixture(database);
  const liveFixture = fixture;
  workspaceId = liveFixture.workspaceId;
  materialized = true;
  await database.transaction(async (transaction) => {
    const repository = new DrizzleCandidatePreviewBindingRepository(transaction as never);
    const command = {
      formalizationRef: liveFixture.formalizationRef, expectedG2HeadHash: liveFixture.g2HeadHash,
      guidanceSetRef: liveFixture.guidanceSetRef, guidanceSetVersion: liveFixture.guidanceSetVersion, guidanceSetHash: liveFixture.guidanceSetHash,
      policyRef: liveFixture.policyRef, policyVersion: liveFixture.policyVersion, policyHash: liveFixture.policyHash,
      targetAccountRef: liveFixture.accountRef, authoritySnapshotRef: liveFixture.authoritySnapshotRef,
      authoritySnapshotHash: liveFixture.authoritySnapshotHash, authorityTier: liveFixture.authorityTier, decision: liveFixture.decision,
    } as const;
    const first = await repository.bind({ workspaceId: liveFixture.workspaceId, workspaceRef: liveFixture.workspaceRef,
      actorId: liveFixture.actorId, actorRef: liveFixture.actorRef, role: "owner", occurredAt: new Date().toISOString(),
      command: { ...command, expectedHeadHash: "GENESIS" } });
    await repository.bind({ workspaceId: liveFixture.workspaceId, workspaceRef: liveFixture.workspaceRef,
      actorId: liveFixture.actorId, actorRef: liveFixture.actorRef, role: "owner", occurredAt: new Date(Date.now() + 1_000).toISOString(),
      command: { ...command, expectedHeadHash: first.revisionHash } });
    const before = count(await transaction.execute(sql`
      select count(*)::int as count from candidate_preview_binding_revisions where workspace_id = ${liveFixture.workspaceId}::uuid
    `));
    const invalidations = count(await transaction.execute(sql`
      select count(*)::int as count from candidate_preview_binding_invalidations where workspace_id = ${liveFixture.workspaceId}::uuid
    `));
    if (before !== 2 || invalidations !== 1) throw new Error("candidate_preview_fixture_incomplete");

    const purge = new DrizzleWorkspaceTombstonePurgePort();
    const service = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(transaction as never, purge),
      { authorize: async (input) => input.approvalRef === "candidate-preview-tombstone-approved" }, liveFixture.actorId, 60_000);
    const plan = await service.dryRun(liveFixture.workspaceId, new Date().toISOString());
    const result = await service.execute({ planRef: plan.planRef, approvalRef: "candidate-preview-tombstone-approved", now: new Date().toISOString() });
    const survivors = count(await transaction.execute(sql`
      select (
        (select count(*) from candidate_preview_binding_revisions where workspace_id = ${liveFixture.workspaceId}::uuid)
        + (select count(*) from candidate_preview_binding_heads where workspace_id = ${liveFixture.workspaceId}::uuid)
        + (select count(*) from candidate_preview_binding_invalidations where workspace_id = ${liveFixture.workspaceId}::uuid)
      )::int as count
    `));
    const tombstoned = count(await transaction.execute(sql`
      select count(*)::int as count from workspaces where id = ${liveFixture.workspaceId}::uuid and lifecycle_state = 'tombstoned'
    `));
    tombstonePurged = result.purgedRowCount > 0 && survivors === 0 && tombstoned === 1;
    if (!tombstonePurged) throw new Error("candidate_preview_tombstone_purge_failed");
    throw new Error(ROLLBACK);
  }, { isolationLevel: "serializable", accessMode: "read write" });
} catch (error) {
  if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
}

const rolledBack = workspaceId !== "" && count(await database.execute(sql`
  select (
    (select count(*) from candidate_preview_binding_revisions where workspace_id = ${workspaceId}::uuid)
    + (select count(*) from candidate_preview_binding_heads where workspace_id = ${workspaceId}::uuid)
    + (select count(*) from candidate_preview_binding_invalidations where workspace_id = ${workspaceId}::uuid)
  )::int as count
`)) === 0;
// The source fixture is intentionally committed so its current-guidance
// temporal boundary remains production-faithful. Remove it through the normal
// approved tombstone service, never direct SQL.
if (fixture) {
  let tombstoned = 0;
  for (const fixtureWorkspaceId of [fixture.workspaceId, fixture.foreignWorkspaceId]) {
    const fixtureRows = await database.execute(sql`
      select workspace_id::text, user_id::text from memberships where workspace_id = ${fixtureWorkspaceId}::uuid limit 2
    `);
    const row = fixtureRows.rows[0] as Record<string, unknown> | undefined;
    if (typeof row?.workspace_id !== "string" || typeof row.user_id !== "string") continue;
    const purge = new DrizzleWorkspaceTombstonePurgePort();
    const service = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge),
      { authorize: async (input) => input.approvalRef === "candidate-preview-tombstone-approved" }, row.user_id, 60_000);
    const plan = await service.dryRun(row.workspace_id, new Date().toISOString());
    await service.execute({ planRef: plan.planRef, approvalRef: "candidate-preview-tombstone-approved", now: new Date().toISOString() });
    tombstoned += count(await database.execute(sql`
      select count(*)::int as count from workspaces where id = ${row.workspace_id}::uuid and lifecycle_state = 'tombstoned'
    `));
  }
  cleanupSucceeded = tombstoned === 2;
}
await pool.end();
if (!materialized || !tombstonePurged || !rolledBack || !cleanupSucceeded) throw new Error("candidate_preview_tombstone_live_acceptance_failed");
console.log(JSON.stringify({ ok: true, scope: "candidate_preview_binding_tombstone_outer_rollback",
  materialized, tombstonePurged, rolledBack, cleanupSucceeded, actionOrNetworkCalls: 0 }));
