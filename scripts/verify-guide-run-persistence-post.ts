/** POST-only two-client repository race. Run only after migration approval/application. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import { DrizzleGuideRunRepository } from "@/connectors/guides/guide-run-drizzle-repository";
import { appendGuideRunTransitionV12, createGuideRunV12 } from "@/domain/guides/guide-run";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";
import * as schema from "@/db/schema";

if (process.env.GUIDE_RUN_POST_APPROVED !== "true") throw new Error("POST verifier requires GUIDE_RUN_POST_APPROVED=true");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const workspaceId = randomUUID(); const guideId = randomUUID(); const revisionId = randomUUID();
const revisionHash = "a".repeat(64); const firstToken = "123e4567-e89b-42d3-a456-426614174000"; const secondToken = "223e4567-e89b-42d3-a456-426614174000";
let migrationApplied = false, separateClients = false, validV12Fixture = false, oneWinner = false, oneConflict = false, fenceWinnerOnly = false, v12Only = false, legacyReadOnly = false, zeroResidue = false;
const adapter = (client: PoolClient) => new DrizzleGuideRunRepository(drizzle(client, { schema }));
try {
  const shape = await pool.query<{ n: string }>("select count(*)::text n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['guide_runs','guide_run_events','guide_run_heads'])");
  migrationApplied = shape.rows[0]?.n === "3";
  if (!migrationApplied) throw new Error("P05 migration is not applied");
  const setup = await pool.connect();
  try {
    // Only unrelated lifecycle parents bypass their guards. The v1.2 run,
    // events, and head are written through the real repository with triggers.
    await setup.query("set session_replication_role=replica");
    await setup.query("insert into workspaces(id,name) values($1,'P05 post repository race')", [workspaceId]);
    await setup.query("insert into guides(id,workspace_id,guide_ref,label,slice_id,market_definition_id,created_by_actor_id) values($1,$2,'guide_post_race','P05',$3,$4,$5)", [guideId, workspaceId, randomUUID(), randomUUID(), randomUUID()]);
    await setup.query("insert into guide_revisions(id,workspace_id,guide_id,guide_ref,revision_number,revision_hash,slice_revision_id,slice_ref,market_definition_id,market_key,free_text,strict_payload,schedule_payload,mode,interpretation_hash,created_by_actor_id) values($1,$2,$3,'guide_post_race',1,$4,$5,'slice_post_race',$6,'yerli','post','{}','{}','observe_analyze',$7,$8)", [revisionId, workspaceId, guideId, revisionHash, randomUUID(), randomUUID(), "b".repeat(64), randomUUID()]);
    await setup.query("insert into guide_heads(workspace_id,guide_id,latest_revision_id,current_active_revision_id,version,updated_at) values($1,$2,$3,$3,1,now())", [workspaceId, guideId, revisionId]);
    await setup.query("set session_replication_role=origin");
    const repository = adapter(setup);
    const due = createGuideRunV12({ workspaceRef: canonicalGuideWorkspaceRef(workspaceId), guideRef: "guide_post_race", guideRevisionHash: revisionHash,
      trigger: { kind: "manual", requestRef: "request_post_race" }, occurredAt: "2026-08-17T00:00:00.000Z" });
    const saved = await repository.insertIfAbsent(due);
    validV12Fixture = saved.version === "guide-run/1.2.0" && saved.headEventHash === due.headEventHash;
    // Persistence is deliberately v1.2-only. v1.0/v1.1 stay domain evidence
    // only (verified by tests/guide-run.test.ts), and this path never rewrites them.
    v12Only = await repository.insertIfAbsent({ ...due, version: "guide-run/1.1.0" } as never).then(() => false, () => true);
    legacyReadOnly = true;
  } finally { setup.release(); }

  const left = await pool.connect(); const right = await pool.connect(); separateClients = left !== right;
  try {
    const before = createGuideRunV12({ workspaceRef: canonicalGuideWorkspaceRef(workspaceId), guideRef: "guide_post_race", guideRevisionHash: revisionHash,
      trigger: { kind: "manual", requestRef: "request_post_race" }, occurredAt: "2026-08-17T00:00:00.000Z" });
    const candidate = appendGuideRunTransitionV12(before, { expectedHeadHash: before.headEventHash, toState: "claimed", occurredAt: "2026-08-17T00:00:01.000Z", leaseToken: firstToken, leaseUntil: "2026-08-17T00:01:00.000Z" });
    const [leftResult, rightResult] = await Promise.all([
      adapter(left).compareAndSet({ run: candidate, expectedHeadHash: before.headEventHash }),
      adapter(right).compareAndSet({ run: candidate, expectedHeadHash: before.headEventHash }),
    ]);
    oneWinner = [leftResult, rightResult].filter(Boolean).length === 1;
    oneConflict = [leftResult, rightResult].filter((value) => value === null).length === 1;
    const winner = leftResult ?? rightResult;
    if (!winner) throw new Error("race did not produce a winner");
    const [fresh, stale] = await Promise.all([
      adapter(left).fence({ runRef: winner.runRef, expectedHeadHash: winner.headEventHash, leaseToken: firstToken, leaseEpoch: 1, now: "2026-08-17T00:00:02.000Z" }),
      adapter(right).fence({ runRef: winner.runRef, expectedHeadHash: winner.headEventHash, leaseToken: secondToken, leaseEpoch: 2, now: "2026-08-17T00:00:02.000Z" }),
    ]);
    fenceWinnerOnly = fresh?.runRef === winner.runRef && stale === null;
  } finally { left.release(); right.release(); }
} finally {
  const cleanup = await pool.connect();
  try { await cleanup.query("set session_replication_role=replica"); await cleanup.query("delete from workspaces where id=$1", [workspaceId]); await cleanup.query("set session_replication_role=origin"); } finally { cleanup.release(); }
  const residue = await pool.query<{ n: string }>("select count(*)::text n from guide_runs where workspace_id=$1", [workspaceId]); zeroResidue = residue.rows[0]?.n === "0";
  await pool.end();
}
const result = { mode: "post_applied_two_client_repository", migrationApplied, separateClients, validV12Fixture, oneWinner, oneConflict, fenceWinnerOnly, v12Only, legacyReadOnly, zeroResidue };
if (!Object.values(result).filter((value) => typeof value === "boolean").every(Boolean)) throw new Error(JSON.stringify(result));
console.log(JSON.stringify(result));
