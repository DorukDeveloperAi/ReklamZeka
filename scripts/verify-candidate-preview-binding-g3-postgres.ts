import { existsSync } from "node:fs";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleCandidatePreviewBindingRepository } from "@/connectors/guidance/candidate-preview-binding-drizzle-repository";
import { createDrizzleAuthoritativeG3EvidenceBridge } from "@/connectors/guidance/authoritative-g3-evidence-bridge-drizzle-resolver";
import { DrizzleProgressiveFormalizationRepository, createPersistedProgressiveFormalizationPreviewResolver } from "@/connectors/guidance/progressive-formalization-drizzle-repository";
import { ProgressiveFormalizationService } from "@/application/progressive-formalization-service";
import { DrizzleInstructionPolicyLifecycleRepository } from "@/connectors/policies/instruction-policy-lifecycle-drizzle-repository";
import { InstructionPolicyLifecycleService } from "@/application/instruction-policy-lifecycle-service";
import * as schema from "@/db/schema";
import { materializeCandidatePreviewBindingG3Fixture } from "./support/candidate-preview-binding-g3-fixture";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:candidate-preview-binding-g3-db" })}\n`);
  process.exit(2);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
const ROLLBACK = "candidate_preview_binding_g3_outer_rollback";
type Fixture = Awaited<ReturnType<typeof materializeCandidatePreviewBindingG3Fixture>>;

async function rejects(work: () => Promise<unknown>): Promise<boolean> {
  try { await work(); return false; } catch { return true; }
}

let fixture: Fixture | null = null;
let candidateTierDecisionBound = false;
let productionAuthoritySourceBound = true;
let sourceBound = true;
let historicalOutcomeBound = false;
let crossTenantBlocked = false;
let tamperedBlocked = false;
let staleG2Blocked = false;
let g4Blocked = false;
let g4ActionCapsFalse = false;
let actionOrNetworkCalls = 0;
let outerRollbackObserved = false;
let primaryWorkspaceId: string | null = null;
let foreignWorkspaceId: string | null = null;
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = (async () => { actionOrNetworkCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  await database.transaction(async (outer) => {
    const tx = outer as never;
    fixture = await materializeCandidatePreviewBindingG3Fixture(tx);
    primaryWorkspaceId = fixture.workspaceId;
    foreignWorkspaceId = fixture.foreignWorkspaceId;
    const candidate = new DrizzleCandidatePreviewBindingRepository(tx);
    const occurredAt = new Date().toISOString();
    const command = {
      formalizationRef: fixture.formalizationRef, expectedHeadHash: "GENESIS" as const, expectedG2HeadHash: fixture.g2HeadHash,
      guidanceSetRef: fixture.guidanceSetRef, guidanceSetVersion: fixture.guidanceSetVersion, guidanceSetHash: fixture.guidanceSetHash,
      policyRef: fixture.policyRef, policyVersion: fixture.policyVersion, policyHash: fixture.policyHash,
      targetAccountRef: fixture.accountRef, authoritySnapshotRef: fixture.authoritySnapshotRef,
      authoritySnapshotHash: fixture.authoritySnapshotHash, authorityTier: fixture.authorityTier, decision: fixture.decision,
    };
    const bound = await candidate.bind({ workspaceId: fixture.workspaceId, workspaceRef: fixture.workspaceRef,
      actorId: fixture.actorId, actorRef: fixture.actorRef, role: "owner", occurredAt, command });
    if (bound.replayed || Object.values(bound.authority).some(Boolean)) throw new Error("candidate_preview_authority_escalation");

    const memberships = [{ workspaceId: fixture.workspaceId, userId: fixture.actorId, role: "owner" as const }];
    const principal = { actor: { userId: fixture.actorId }, workspaceId: fixture.workspaceId,
      workspaceRef: fixture.workspaceRef, readerRef: fixture.actorRef } as const;
    const policies = await new InstructionPolicyLifecycleService(new DrizzleInstructionPolicyLifecycleRepository(tx), memberships).inspect(principal);
    const policy = policies.current.find((entry) => entry.policy.policyRef === fixture!.policyRef)?.policy;
    if (!policy) throw new Error("candidate_preview_policy_missing");
    const bridge = createDrizzleAuthoritativeG3EvidenceBridge();
    const proof = await bridge.resolve(tx, { workspaceId: fixture.workspaceId,
      formalizationRef: fixture.formalizationRef, g2RevisionHash: fixture.g2HeadHash, policy,
      guidanceSetRef: fixture.guidanceSetRef, guidanceSetVersion: fixture.guidanceSetVersion, guidanceSetHash: fixture.guidanceSetHash });
    candidateTierDecisionBound = proof.candidateTierDecisionBound;
    productionAuthoritySourceBound = proof.sourceBound;
    sourceBound = proof.sourceBound;
    historicalOutcomeBound = proof.historicalRunsEvaluated > 0 && proof.outcomeEvidenceRefs.length > 0;
    // G4 receives no execution authority from a draft candidate binding.  The
    // separate progressive preview remains blocked and its actor caps remain
    // read/formalization-only.
    const progressive = new ProgressiveFormalizationService(
      new DrizzleProgressiveFormalizationRepository(tx, createPersistedProgressiveFormalizationPreviewResolver(bridge)), memberships,
    );
    // G4 cannot even be previewed before a G3 promotion. The rejection is the
    // desired gate, while the same service's exposed actor capabilities prove
    // no approval, execution, Meta write, scheduling, or tool authority.
    g4Blocked = await rejects(() => progressive.preview(principal, {
      formalizationRef: fixture!.formalizationRef, target: "G4", policyRef: null,
    }));
    const formalizationState = await progressive.inspect(principal);
    g4ActionCapsFalse = formalizationState.authority.canApprove === false && formalizationState.authority.canExecute === false
      && formalizationState.authority.canWriteMeta === false && formalizationState.authority.canSchedule === false
      && formalizationState.authority.canCallTool === false;

    // All three negative cases use the real private writer.  They are savepoint
    // scoped so an expected rejection cannot poison the acceptance transaction.
    crossTenantBlocked = await outer.transaction((savepoint) => rejects(() => new DrizzleCandidatePreviewBindingRepository(savepoint as never).bind({
      workspaceId: fixture!.foreignWorkspaceId, workspaceRef: fixture!.workspaceRef, actorId: fixture!.actorId,
      actorRef: fixture!.actorRef, role: "owner", occurredAt, command,
    })));
    tamperedBlocked = await outer.transaction((savepoint) => rejects(() => new DrizzleCandidatePreviewBindingRepository(savepoint as never).bind({
      workspaceId: fixture!.workspaceId, workspaceRef: fixture!.workspaceRef, actorId: fixture!.actorId,
      actorRef: fixture!.actorRef, role: "owner", occurredAt, command: { ...command, policyHash: "f".repeat(64) },
    })));
    staleG2Blocked = await outer.transaction((savepoint) => rejects(() => new DrizzleCandidatePreviewBindingRepository(savepoint as never).bind({
      workspaceId: fixture!.workspaceId, workspaceRef: fixture!.workspaceRef, actorId: fixture!.actorId,
      actorRef: fixture!.actorRef, role: "owner", occurredAt, command: { ...command, expectedG2HeadHash: "e".repeat(64) },
    })));
    if (!candidateTierDecisionBound || productionAuthoritySourceBound || sourceBound || !historicalOutcomeBound || !g4Blocked || !g4ActionCapsFalse
      || !crossTenantBlocked || !tamperedBlocked || !staleG2Blocked || actionOrNetworkCalls !== 0) {
      throw new Error("candidate_preview_binding_g3_acceptance_failed");
    }
    throw new Error(ROLLBACK);
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
  outerRollbackObserved = true;
} finally {
  globalThis.fetch = originalFetch;
}

let residueCount = -1;
try {
  if (primaryWorkspaceId && foreignWorkspaceId) {
    const result = await database.execute(sql`
      select count(*)::int as count from workspaces
      where id in (${primaryWorkspaceId}::uuid, ${foreignWorkspaceId}::uuid)
    `);
    residueCount = Number((result as unknown as { rows: readonly { count: unknown }[] }).rows[0]?.count ?? -1);
  }
} finally { await pool.end(); }

if (!outerRollbackObserved || residueCount !== 0 || !candidateTierDecisionBound || productionAuthoritySourceBound || sourceBound
  || !g4Blocked || !g4ActionCapsFalse
  || !historicalOutcomeBound || !crossTenantBlocked || !tamperedBlocked || !staleG2Blocked || actionOrNetworkCalls !== 0) {
  throw new Error("candidate_preview_binding_g3_postgres_acceptance_failed");
}
console.log(JSON.stringify({ ok: true, scope: "candidate_preview_g3_private_evidence_only", candidateTierDecisionBound,
  productionAuthoritySourceBound, sourceBound, historicalOutcomeBound, crossTenantBlocked, tamperedBlocked, staleG2Blocked,
  g4Blocked, g4ActionCapsFalse, actionOrNetworkCalls, outerRollbackObserved, residueCount }));
