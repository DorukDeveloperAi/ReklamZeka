import { existsSync } from "node:fs";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleFrozenDiagnosticEvidenceRepository } from "@/connectors/analyses/frozen-diagnostic-evidence-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";
import * as schema from "@/db/schema";
import { materializeCurrentEffectiveAnalysisContextSourceFixture } from "./support/current-effective-analysis-context-source-fixture";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured", requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:frozen-diagnostic-evidence-db" })}\n`);
  process.exit(2);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
const ROLLBACK = "frozen_diagnostic_evidence_outer_rollback";

function rows<T extends Record<string, unknown>>(value: unknown): readonly T[] {
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as readonly T[] : [];
}
async function rejects(work: () => Promise<unknown>): Promise<boolean> {
  try { await work(); return false; } catch { return true; }
}

let workspaceId: string | null = null;
let foreignWorkspaceId: string | null = null;
let exactEvidencePersisted = false;
let capabilityEnvelopeClosed = false;
let crossTenantBlocked = false;
let tamperBlocked = false;
let missingEvidenceBlocked = false;
let rlsForced = false;
let publicPrivilegesRevoked = false;
let tombstoneCandidateDetected = false;
let actionOrNetworkCalls = 0;
let outerRollbackObserved = false;
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = (async () => { actionOrNetworkCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  await database.transaction(async (outer) => {
    const tx = outer as never;
    const fixture = await materializeCurrentEffectiveAnalysisContextSourceFixture(tx);
    workspaceId = fixture.workspaceId;
    foreignWorkspaceId = fixture.foreignWorkspaceId;
    const composed = await createDrizzleEffectiveAnalysisContextComposer({ database: tx }).composeAndSave(fixture.request);
    if (composed.outcome !== "inserted") throw new Error("diagnostic_context_not_inserted");

    const evidence = rows<{ id: string; context_id: string; workspace_id: string; context_hash: string; evidence_hash: string; capabilities: Record<string, unknown> }>(await outer.execute(sql`
      select evidence.id::text, evidence.context_id::text, evidence.workspace_id::text, evidence.context_hash, evidence.evidence_hash, evidence.capabilities
      from frozen_diagnostic_evidence evidence
      join effective_campaign_contexts context on context.workspace_id = evidence.workspace_id and context.id = evidence.context_id
      where evidence.workspace_id = ${fixture.workspaceId}::uuid and context.context_hash = ${composed.context.contextHash}
    `));
    const row = evidence[0];
    exactEvidencePersisted = evidence.length === 1 && row?.workspace_id === fixture.workspaceId
      && row.context_hash === composed.context.contextHash && /^[a-f0-9]{64}$/.test(row.evidence_hash ?? "");
    capabilityEnvelopeClosed = exactEvidencePersisted && JSON.stringify(row?.capabilities) === JSON.stringify({
      canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false, canPublish: false,
      canApprove: false, canExecute: false, canAccessNetwork: false,
    });

    // The writer re-reads every feature/window from the frozen context. A
    // nonexistent reference is therefore rejected before an evidence row can
    // be manufactured or silently accepted.
    const missingFeatureContext = {
      ...composed.context,
      data: { ...composed.context.data, featureRefs: [...composed.context.data.featureRefs, "feature_missing_evidence"] },
    };
    missingEvidenceBlocked = await outer.transaction((savepoint) => rejects(() =>
      new DrizzleFrozenDiagnosticEvidenceRepository().saveInTransaction(savepoint as never, {
        contextId: row!.context_id, context: missingFeatureContext as never,
      }),
    ));

    // The trigger protects every UPDATE, including an attempted tenant move.
    crossTenantBlocked = await outer.transaction((savepoint) => rejects(() => savepoint.execute(sql`
      update frozen_diagnostic_evidence set workspace_id = ${fixture.foreignWorkspaceId}::uuid where id = ${row!.id}::uuid
    `)));
    tamperBlocked = await outer.transaction((savepoint) => rejects(() => savepoint.execute(sql`
      update frozen_diagnostic_evidence set capabilities = '{"canAuthorizeAction":true}'::jsonb where id = ${row!.id}::uuid
    `)));

    const security = rows<{ relrowsecurity: boolean; relforcerowsecurity: boolean; public_select: boolean; anon_select: boolean; authenticated_select: boolean; service_role_select: boolean }>(await outer.execute(sql`
      select c.relrowsecurity, c.relforcerowsecurity,
        has_table_privilege('public', c.oid, 'select') as public_select,
        has_table_privilege('anon', c.oid, 'select') as anon_select,
        has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
        has_table_privilege('service_role', c.oid, 'select') as service_role_select
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'frozen_diagnostic_evidence'
    `))[0];
    rlsForced = security?.relrowsecurity === true && security.relforcerowsecurity === true;
    publicPrivilegesRevoked = security?.public_select === false && security.anon_select === false
      && security.authenticated_select === false && security.service_role_select === false;
    const purge = new DrizzleWorkspaceTombstonePurgePort();
    // The purge port exposes a sealed aggregate rather than individual tables;
    // the migration/static gate separately proves this sidecar is in its fixed
    // allowlist. A nonzero live candidate count proves that this real fixture
    // is covered by the tombstone inspection boundary.
    tombstoneCandidateDetected = (await purge.inspect(tx, fixture.workspaceId)).candidateCount > 0;

    if (!exactEvidencePersisted || !capabilityEnvelopeClosed || !crossTenantBlocked || !tamperBlocked || !missingEvidenceBlocked
      || !rlsForced || !publicPrivilegesRevoked || !tombstoneCandidateDetected || actionOrNetworkCalls !== 0) {
      throw new Error("frozen_diagnostic_evidence_acceptance_failed");
    }
    throw new Error(ROLLBACK);
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
  outerRollbackObserved = true;
} finally {
  globalThis.fetch = originalFetch;
}

const residueCount = workspaceId && foreignWorkspaceId ? Number(rows<{ count: number | string }>(await database.execute(sql`
  select count(*)::int as count from workspaces where id in (${workspaceId}::uuid, ${foreignWorkspaceId}::uuid)
`))[0]?.count ?? -1) : -1;
await pool.end();
if (!outerRollbackObserved || residueCount !== 0 || !exactEvidencePersisted || !capabilityEnvelopeClosed || !crossTenantBlocked
  || !tamperBlocked || !missingEvidenceBlocked || !rlsForced || !publicPrivilegesRevoked || !tombstoneCandidateDetected || actionOrNetworkCalls !== 0) {
  throw new Error("frozen_diagnostic_evidence_postgres_acceptance_failed");
}
console.log(JSON.stringify({ ok: true, scope: "a10_frozen_diagnostic_evidence_private_sidecar", exactEvidencePersisted,
  capabilityEnvelopeClosed, crossTenantBlocked, tamperBlocked, missingEvidenceBlocked, rlsForced, publicPrivilegesRevoked,
  tombstoneCandidateDetected, outerRollbackObserved, residueCount, actionOrNetworkCalls }));
