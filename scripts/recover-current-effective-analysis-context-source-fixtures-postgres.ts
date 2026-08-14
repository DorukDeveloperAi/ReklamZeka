import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import * as schema from "@/db/schema";
import { retryWorkspaceTombstoneTransport } from "./support/workspace-tombstone-transport-retry";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (process.env.ALLOW_EPHEMERAL_CURRENT_SOURCE_FIXTURE_RECOVERY !== "1") {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "explicit_ephemeral_recovery_consent_required" })}\n`);
  process.exit(2);
}
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("postgres_connection_not_configured");
const createPool = () => new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000,
  statement_timeout: 20_000, query_timeout: 45_000, keepAlive: true, keepAliveInitialDelayMillis: 1_000 });
let pool = createPool();
let database = drizzle(pool, { schema });
const rows = (value: unknown): readonly Record<string, unknown>[] => value && typeof value === "object" && "rows" in value && Array.isArray(value.rows) ? value.rows as readonly Record<string, unknown>[] : [];
try {
  const fixtures = rows(await database.execute(sql`select workspace.id::text as workspace_id, workspace.name, owner.user_id::text as actor_id
    from workspaces workspace left join lateral (select membership.user_id from memberships membership where membership.workspace_id = workspace.id order by membership.id limit 1) owner on true
    where workspace.lifecycle_state = 'active' and workspace.name in ('Current source verifier', 'Current source foreign') order by workspace.created_at`));
  const fixtureActor = rows(await database.execute(sql`select id::text as actor_id from users
    where email like 'current-source-%@example.invalid' order by created_at desc limit 1`))[0]?.actor_id;
  // An interrupted verifier can leave only the foreign workspace, which never
  // has a membership. Reuse an already-materialized verifier test actor for
  // the append-only cleanup audit; do not create a new actor or bypass the
  // tombstone service merely to remove the damaged fixture.
  const fallbackActor = fixtures.find((row) => row.name === "Current source verifier" && row.actor_id)?.actor_id ?? fixtureActor;
  if (fixtures.some((row) => typeof (row.actor_id ?? fallbackActor) !== "string")) throw new Error("fixture_recovery_actor_unavailable");
  const purge = new DrizzleWorkspaceTombstonePurgePort({ onDeletePhase: (phase) => {
    if (phase % 20 === 0) process.stderr.write(`${JSON.stringify({ recoveryPhase: phase })}\n`);
  } });
  for (const fixture of fixtures) {
    const workspaceId = String(fixture.workspace_id);
    await retryWorkspaceTombstoneTransport({
      execute: async () => {
        const service = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge),
          { authorize: async (input) => input.approvalRef === "ephemeral-fixture-recovery-approved" }, String(fallbackActor), 60_000);
        const plan = await service.dryRun(workspaceId, new Date().toISOString());
        await service.execute({ planRef: plan.planRef, approvalRef: "ephemeral-fixture-recovery-approved", now: new Date().toISOString() });
      },
      reconnect: async () => {
        await pool.end();
        pool = createPool();
        database = drizzle(pool, { schema });
      },
      completedAfterReconnect: async () => {
        const lifecycle = rows(await database.execute(sql`select lifecycle_state from workspaces where id = ${workspaceId}::uuid`))[0]?.lifecycle_state;
        return lifecycle === "tombstoned" && (await purge.inspect(database as never, workspaceId)).candidateCount === 0;
      },
    });
  }
  const survivors = rows(await database.execute(sql`select count(*)::int as count from workspaces where lifecycle_state = 'active' and name in ('Current source verifier', 'Current source foreign')`))[0]?.count;
  if (Number(survivors ?? -1) !== 0) throw new Error("fixture_recovery_survivors_detected");
  console.log(JSON.stringify({ ok: true, recoveredFixtureCount: fixtures.length, activeSurvivorCount: 0, cleanup: "locked_workspace_tombstone" }));
} finally { await pool.end(); }
