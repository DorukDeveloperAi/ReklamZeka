import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { DrizzleBusinessOutcomeEvidenceRepository } from "@/connectors/analyses/business-outcome-evidence-drizzle-repository";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured", requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:business-outcome-evidence-db" })}\n`);
  process.exit(2);
}
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema }); const rollback = Symbol("rollback"); const workspaceId = randomUUID(); const headHash = "a".repeat(64);
let rls = false; let revoked = false; let guards = false; let materialized = false; let headGuarded = false; let snapshotImmutable = false; let temporaryRowsCommitted = true;
try {
  const catalog = await database.execute(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
    not has_table_privilege('public', c.oid, 'select,insert,update,delete') as public_revoked,
    not has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon_revoked,
    not has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') as authenticated_revoked,
    not has_table_privilege('service_role', c.oid, 'select,insert,update,delete') as service_role_revoked
    from pg_class c where c.relname in ('business_outcome_entity_heads','business_outcome_evidence_snapshots')`);
  const catalogRows = (catalog as { rows: readonly Record<string, unknown>[] }).rows;
  rls = catalogRows.length === 2 && catalogRows.every((row) => row.relrowsecurity === true && row.relforcerowsecurity === true);
  revoked = catalogRows.length === 2 && catalogRows.every((row) => row.public_revoked === true && row.anon_revoked === true && row.authenticated_revoked === true && row.service_role_revoked === true);
  const triggerRows = (await database.execute(`select tgname from pg_trigger where tgrelid in ('business_outcome_entity_heads'::regclass, 'business_outcome_evidence_snapshots'::regclass) and not tgisinternal`) as { rows: readonly { tgname: string }[] }).rows;
  guards = triggerRows.some((row) => row.tgname === "business_outcome_entity_heads_guard") && triggerRows.some((row) => row.tgname === "business_outcome_evidence_snapshots_guard");
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "Business outcome evidence acceptance" });
    await transaction.insert(schema.businessOutcomeEntityHeads).values({ workspaceId, entityRef: "campaign_primary", currentRevision: 1, currentHeadHash: headHash, updatedAt: new Date("2026-08-10T12:00:00.000Z") });
    const evidence = await new DrizzleBusinessOutcomeEvidenceRepository(transaction as never).materialize({ workspaceId, entityRef: "campaign_primary", windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-02T00:00:00.000Z" });
    materialized = evidence.sourceHeadHash === headHash && evidence.summary.signalCount === 0;
    headGuarded = await transaction.update(schema.businessOutcomeEntityHeads).set({ entityRef: "campaign_forged" }).where(eq(schema.businessOutcomeEntityHeads.workspaceId, workspaceId)).then(() => false, () => true);
    snapshotImmutable = await transaction.update(schema.businessOutcomeEvidenceSnapshots).set({ evidenceRef: "outcome_evidence_" + "b".repeat(24) }).where(eq(schema.businessOutcomeEvidenceSnapshots.workspaceId, workspaceId)).then(() => false, () => true);
    if (!materialized || !headGuarded || !snapshotImmutable) throw new Error("business_outcome_evidence_postgres_acceptance_failed");
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  temporaryRowsCommitted = false;
} finally { await pool.end(); }
if (!rls || !revoked || !guards || !materialized || !headGuarded || !snapshotImmutable || temporaryRowsCommitted) throw new Error("business_outcome_evidence_postgres_acceptance_failed");
console.log(JSON.stringify({ rls, revoked, guards, materialized, headGuarded, snapshotImmutable, temporaryRowsCommitted, writeNetworkCalls: 0 }));
