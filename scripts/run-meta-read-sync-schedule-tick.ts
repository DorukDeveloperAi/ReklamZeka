import { existsSync } from "node:fs";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { runDrizzleMetaReadSyncScheduleTick } from "@/server/meta-read-sync-schedule-tick";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/**
 * A cron supervisor may invoke this command, but it never receives a workspace,
 * connection, account, token, or transport argument.  A disabled runner is a
 * successful no-op so merely installing the command cannot start Meta traffic.
 */
const enabled = process.env.REKLAMZEKA_META_SCHEDULE_RUNNER_ENABLED === "true";
const rolloutEnabled = process.env.META_READ_ENABLED === "true";
const rotated = process.env.META_TOKEN_SECURITY_STATUS === "rotated";
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!enabled || !rolloutEnabled || !rotated || !databaseUrl) {
  console.log(JSON.stringify({ status: "disabled", dueCount: 0, actionAuthority: "none",
    writeNetworkCalls: 0, metaWriteCalls: 0 }));
  process.exitCode = 2;
} else {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000,
    statement_timeout: 90_000 });
  try {
    const result = await runDrizzleMetaReadSyncScheduleTick({ now: new Date().toISOString(), batchSize: 10,
      concurrency: 1, maxAttempts: 2, leaseMs: 10 * 60_000 }, { database: drizzle(pool, { schema }),
      environment: process.env });
    // The worker result intentionally contains only opaque scope/run aliases and aggregate counts.
    console.log(JSON.stringify({ status: "completed", dueCount: result.dueCount,
      completedCount: result.completedCount, partialCount: result.partialCount,
      failedCount: result.failedCount, duplicateCount: result.duplicateCount,
      actionAuthority: result.actionAuthority, writeNetworkCalls: result.writeNetworkCalls, metaWriteCalls: 0 }));
    if (result.actionAuthority !== "none" || result.writeNetworkCalls !== 0) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ status: "failed", actionAuthority: "none", writeNetworkCalls: 0,
      metaWriteCalls: 0 }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
