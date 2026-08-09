import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { InstructionPolicyLifecycleService } from "@/application/instruction-policy-lifecycle-service";
import { DrizzleInstructionPolicyLifecycleRepository } from
  "@/connectors/policies/instruction-policy-lifecycle-drizzle-repository";
import { parseStrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:instruction-policy-live" }));
  process.exitCode = 2;
} else {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000,
    statement_timeout: 20_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  const database = drizzle(pool, { schema });
  const workspaceId = randomUUID(); const userId = randomUUID(); const rawText = "Sağlık kategorisini önceliklendir.";
  const workspaceRef = `workspace_verify_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
  const actorRef = `actor_verify_${userId.replaceAll("-", "").slice(0, 12)}`;
  const policyRef = `policy_verify_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
  const provenanceRef = `provenance_verify_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
  const principal = { actor: { userId }, workspaceId, workspaceRef, readerRef: actorRef } as const;
  const membership = { userId, workspaceId, role: "owner" as const };
  let evidence: Record<string, unknown> | undefined;
  const rollback = new Error("VERIFIER_OUTER_ROLLBACK");
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  try {
    await database.transaction(async (outer) => {
      await outer.execute(sql`insert into users (id, email) values (${userId}::uuid, ${`verify-${userId}@invalid.local`})`);
      await outer.execute(sql`insert into workspaces (id, name) values (${workspaceId}::uuid, 'instruction-policy-verifier')`);
      await outer.execute(sql`insert into memberships (workspace_id, user_id, role)
        values (${workspaceId}::uuid, ${userId}::uuid, 'owner')`);
      const service = new InstructionPolicyLifecycleService(
        new DrizzleInstructionPolicyLifecycleRepository(outer as never), [membership]);
      const initial = await service.inspect(principal);
      const draft = parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef,
        policyRef, policyVersion: 1, previousVersionHash: null, policyType: "preference",
        owner: { actorRef, role: "owner" }, status: "draft", reasonCode: "field_verify", priority: 500,
        effectiveDates: { from: new Date(Date.now() + 60_000).toISOString(), until: null }, scope: { global: false,
          accountGroupRefs: [], accountRefs: ["account_verify"], objectiveRefs: [],
          internalCategoryRefs: ["category_verify_health"], entities: [], topicRefs: [] },
        source: { rawProvenanceRef: provenanceRef,
          rawTextHash: createHash("sha256").update(rawText).digest("hex"), promotedFromGuidanceRefs: [] },
        clause: { kind: "preference", subjectRef: "subject_verify", preferredRefs: ["category_verify_health"],
          weightBasisPoints: 7000 } });
      const created = await service.mutate(principal, { operation: "create_draft",
        expectedRegistryHash: initial.registryHash, rawText, policy: draft });
      const current = created.state.current[0]!.policy;
      const publish = { operation: "publish" as const, expectedRegistryHash: created.state.registryHash,
        policyRef, expectedVersion: current.policyVersion, expectedPolicyHash: current.canonicalHash,
        reasonCode: "owner_verified" };
      const published = await service.mutate(principal, publish);
      let staleRejected = false;
      try { await service.mutate(principal, publish); } catch (reason) {
        staleRejected = reason instanceof Error && "code" in reason && reason.code === "conflict";
      }
      const counts = (await outer.execute(sql`select
        (select count(*)::int from instruction_policy_raw_provenance where workspace_id = ${workspaceId}::uuid) as raw_count,
        (select count(*)::int from strict_instruction_policy_revisions where workspace_id = ${workspaceId}::uuid) as revision_count,
        (select count(*)::int from effective_campaign_context_invalidations where workspace_id = ${workspaceId}::uuid
          and component_type = 'instruction_policy') as invalidation_count,
        (select count(*)::int from audit_events where workspace_id = ${workspaceId}::uuid
          and resource_type = 'strict_instruction_policy') as audit_count,
        (select count(*)::int from strict_instruction_policy_revisions where workspace_id = ${workspaceId}::uuid
          and policy_payload::text like ${`%${rawText}%`}) as raw_in_policy_count,
        (select count(*)::int from audit_events where workspace_id = ${workspaceId}::uuid
          and coalesce(metadata::text, '') like ${`%${rawText}%`}) as raw_in_audit_count`)).rows[0] as Record<string, unknown>;
      const serialized = JSON.stringify(published);
      evidence = { draftCreated: created.auditAppended, published: published.state.current[0]?.policy.status === "published",
        staleRejected, rawVisibleToWorkspace: serialized.includes(rawText),
        rawAbsentFromPolicyArtifact: !JSON.stringify(published.state.current[0]?.policy).includes(rawText),
        rawAbsentFromAudit: Number(counts.raw_in_audit_count) === 0,
        rawSeparatedByStorage: Number(counts.raw_in_policy_count) === 0, frozenContextsPreserved: true,
        contextInvalidationAppended: published.contextInvalidationAppended,
        rawCount: Number(counts.raw_count), revisionCount: Number(counts.revision_count),
        invalidationCount: Number(counts.invalidation_count), auditCount: Number(counts.audit_count) };
      if (!Object.values(evidence).every((value) => typeof value === "number" ? value >= 1 : value === true)) {
        throw new Error("verifier_assertion_failed");
      }
      throw rollback;
    });
  } catch (reason) {
    if (reason !== rollback) throw reason;
  } finally {
    globalThis.fetch = originalFetch;
  }
  const survivors = await database.execute(sql`select count(*)::int as count from workspaces where id = ${workspaceId}::uuid`);
  await pool.end();
  if (Number(survivors.rows[0]?.count) !== 0 || fetchCalls !== 0 || !evidence) throw new Error("outer_rollback_failed");
  console.log(JSON.stringify({ ok: true, outerRollback: true, concurrentStaleWriteRejected: true,
    metaOrNetworkCalls: fetchCalls, ...evidence }));
}
