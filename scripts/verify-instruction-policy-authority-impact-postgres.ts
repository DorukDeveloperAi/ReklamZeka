import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { InstructionPolicyLifecycleService } from "@/application/instruction-policy-lifecycle-service";
import { createPolicyScopeSnapshot, createTrustedPolicyCatalog } from "@/application/trusted-policy-composition";
import { DrizzleInstructionPolicyImpactRepository } from "@/connectors/policies/instruction-policy-impact-drizzle-repository";
import { DrizzleInstructionPolicyLifecycleRepository } from "@/connectors/policies/instruction-policy-lifecycle-drizzle-repository";
import { DrizzlePolicyAuthorityCatalogMaterializerRepository } from "@/connectors/policies/policy-authority-catalog-materializer-drizzle-repository";
import { DrizzleAccountGroupLifecycleRepository } from "@/connectors/policies/account-group-lifecycle-drizzle-repository";
import { DrizzleAuthorityTopicLifecycleRepository } from "@/connectors/policies/authority-topic-lifecycle-drizzle-repository";
import { DrizzlePolicySemanticBindingLifecycleRepository } from "@/connectors/policies/policy-semantic-binding-lifecycle-drizzle-repository";
import { parseStrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"],
    continuation: "npm run verify:instruction-policy-authority-impact-db" })}\n`);
  process.exit(2);
}

function digest(value: unknown): string {
  const stable = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(stable)
    : entry && typeof entry === "object" ? Object.fromEntries(Object.entries(entry as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)])) : entry;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000,
  statement_timeout: 20_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
const database = drizzle(pool, { schema });
const requiredSidecarTables = ["effective_campaign_policy_compositions", "effective_campaign_policy_composition_items"] as const;
const sidecarPreflight = (await database.execute(sql`select candidate as relname
  from unnest(array['effective_campaign_policy_compositions', 'effective_campaign_policy_composition_items']) candidate
  where to_regclass('public.' || candidate) is not null`)).rows as unknown as readonly { relname: string }[];
const presentSidecarTables = new Set(sidecarPreflight.map((row) => row.relname));
const missingSidecarTables = requiredSidecarTables.filter((table) => !presentSidecarTables.has(table));
if (missingSidecarTables.length) {
  await pool.end();
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "a09_3b_policy_composition_schema_not_migrated",
    missingTables: missingSidecarTables, continuation: "apply the repository's pending forward migrations, then rerun npm run verify:instruction-policy-authority-impact-db" })}\n`);
  process.exit(2);
}
const workspaceId = randomUUID(); const foreignWorkspaceId = randomUUID(); const userId = randomUUID();
const workspaceRef = `workspace_impact_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
const actorRef = `actor_impact_${userId.replaceAll("-", "").slice(0, 12)}`;
const policyRef = `policy_impact_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
const accountRef = `account_impact_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
const groupRef = `account_group_impact_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
const topicRef = `topic_impact_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
const semanticRef = `semantic_impact_${workspaceId.replaceAll("-", "").slice(0, 12)}`;
const rawText = "Kaliteyi koru; bütçe kararını insan onayına bırak.";
const principal = { actor: { userId }, workspaceId, workspaceRef, readerRef: actorRef } as const;
const rollback = new Error("INSTRUCTION_POLICY_AUTHORITY_IMPACT_OUTER_ROLLBACK");
let fetchCalls = 0; let evidence: Record<string, unknown> | undefined;
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  await database.transaction(async (outer) => {
    await outer.execute(sql`insert into users (id, email) values (${userId}::uuid, ${`impact-${userId}@invalid.local`})`);
    await outer.execute(sql`insert into workspaces (id, name) values (${workspaceId}::uuid, 'authority impact verifier'),
      (${foreignWorkspaceId}::uuid, 'authority impact foreign verifier')`);
    await outer.execute(sql`insert into memberships (workspace_id, user_id, role)
      values (${workspaceId}::uuid, ${userId}::uuid, 'owner')`);
    const connectionId = randomUUID(); const sourceId = randomUUID(); const accountId = randomUUID();
    await outer.execute(sql`insert into meta_connections (id, workspace_id, external_connection_key, display_name,
      graph_api_version, field_catalog_version, access_mode, status, granted_scopes, enabled_capabilities, capability_snapshot)
      values (${connectionId}::uuid, ${workspaceId}::uuid, ${`connection_${workspaceId.replaceAll("-", "").slice(0, 12)}`},
      'authority impact verifier', 'v23.0', 'meta-fields/1.0.0', 'read_only', 'active', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)`);
    await outer.execute(sql`insert into data_sources (id, workspace_id, meta_connection_id, platform, external_account_id, display_name)
      values (${sourceId}::uuid, ${workspaceId}::uuid, ${connectionId}::uuid, 'meta_ads', ${accountRef}, 'authority impact source')`);
    await outer.execute(sql`insert into ad_accounts (id, workspace_id, data_source_id, external_account_id, name, currency, timezone)
      values (${accountId}::uuid, ${workspaceId}::uuid, ${sourceId}::uuid, ${accountRef}, 'authority impact account', 'TRY', 'Europe/Istanbul')`);

    const memberships = [{ workspaceId, userId, role: "owner" as const }];
    const lifecycle = new InstructionPolicyLifecycleService(
      new DrizzleInstructionPolicyLifecycleRepository(outer as never), memberships);
    const initial = await lifecycle.inspect(principal);
    const policy = parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef,
      policyRef, policyVersion: 1, previousVersionHash: null, policyType: "preference",
      owner: { actorRef, role: "owner" }, status: "draft", reasonCode: "impact_verify", priority: 500,
      effectiveDates: { from: "2026-08-10T12:00:00.000Z", until: null }, scope: { global: false,
        accountGroupRefs: [], accountRefs: ["account_impact"], objectiveRefs: [], internalCategoryRefs: [], entities: [], topicRefs: [] },
      source: { rawProvenanceRef: `provenance_${workspaceId.replaceAll("-", "").slice(0, 12)}`,
        rawTextHash: createHash("sha256").update(rawText).digest("hex"), promotedFromGuidanceRefs: [] },
      clause: { kind: "preference", subjectRef: "subject_impact", preferredRefs: ["category_quality"], weightBasisPoints: 7000 } });
    const drafted = await lifecycle.mutate(principal, { operation: "create_draft", expectedRegistryHash: initial.registryHash, rawText, policy });
    const draft = drafted.state.current[0]!.policy;

    // Empty bootstrap proves a draft policy cannot become authority by implication.
    const emptyRegistryHash = digest([]);
    const emptyCatalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: `authority_catalog_${workspaceId.replaceAll("-", "").slice(0, 12)}`,
      catalogVersion: 1, instructionPolicyRegistryHash: emptyRegistryHash, bindings: [] });
    const scope = createPolicyScopeSnapshot({ workspaceRef, evaluatedAt: "2026-08-10T12:00:00.000Z",
      accountGroupRefs: [], objectiveRefs: [], topicRefs: [], canonicalObjective: null });
    const materialized = await new DrizzlePolicyAuthorityCatalogMaterializerRepository(outer as never).materialize({
      workspaceId, workspaceRef, actorId: userId, actorRef, role: "owner", occurredAt: scope.evaluatedAt,
      expiresAt: "2026-08-11T12:00:00.000Z", repositoryRef: "repository_impact", repositoryRevision: "verify-1",
      expectedCatalogHeadHash: "GENESIS", expectedSnapshotHeadHash: "GENESIS", expectedPolicyRegistryHash: emptyRegistryHash,
      catalog: emptyCatalog, scope, manualLocks: [] });
    const beforePublish = await new DrizzleInstructionPolicyImpactRepository(outer as never).preview(workspaceId, policyRef, "publish");
    if (!beforePublish) throw new Error("draft_impact_not_found");
    const published = await lifecycle.mutate(principal, { operation: "publish", expectedRegistryHash: drafted.state.registryHash,
      policyRef, expectedVersion: draft.policyVersion, expectedPolicyHash: draft.canonicalHash,
      expectedImpactHash: beforePublish.impactHash, reasonCode: "impact_verified" });
    const afterPublishBeforeAuthority = await new DrizzleInstructionPolicyImpactRepository(outer as never).preview(workspaceId, policyRef, "pause");
    const publishedPolicy = published.state.current.find((entry) => entry.policy.policyRef === policyRef)?.policy;
    if (!publishedPolicy || publishedPolicy.status !== "published") throw new Error("published_policy_not_found");
    const occurredAt = "2026-08-10T12:00:00.000Z";
    const factWriterInput = { workspaceId, workspaceRef, actorId: userId, actorRef, role: "owner" as const, occurredAt };
    const semantic = await new DrizzlePolicySemanticBindingLifecycleRepository(outer as never).append({ ...factWriterInput,
      command: { policyRef, expectedPolicyVersion: publishedPolicy.policyVersion, expectedPolicyHash: publishedPolicy.canonicalHash,
        semanticRef, expectedHeadHash: "GENESIS", fact: { kind: "impact_verifier", version: 1 } } });
    const group = await new DrizzleAccountGroupLifecycleRepository(outer as never).mutate({ ...factWriterInput,
      command: { operation: "create_active", groupRef, expectedHeadHash: "GENESIS", accountRefs: [accountRef] } });
    const topic = await new DrizzleAuthorityTopicLifecycleRepository(outer as never).mutate({ ...factWriterInput,
      command: { operation: "create_active", topicRef, expectedHeadHash: "GENESIS", categoryRefs: [] } });
    const registry = published.state.registryHash;
    const boundCatalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: `authority_catalog_bound_${workspaceId.replaceAll("-", "").slice(0, 12)}`,
      catalogVersion: 1, instructionPolicyRegistryHash: registry, bindings: [{ policyRef, policyVersion: publishedPolicy.policyVersion,
        policyHash: publishedPolicy.canonicalHash, authorityTier: "metric_rule", decision: null, categoryProfileRef: null,
        categoryProfileVersion: null, categoryProfileHash: null, manualLockRef: null }] });
    const boundOccurredAt = "2026-08-10T12:01:00.000Z";
    const boundScope = createPolicyScopeSnapshot({ workspaceRef, evaluatedAt: boundOccurredAt, accountGroupRefs: [groupRef],
      objectiveRefs: [], topicRefs: [topicRef], canonicalObjective: null });
    const boundMaterialized = await new DrizzlePolicyAuthorityCatalogMaterializerRepository(outer as never).materialize({
      workspaceId, workspaceRef, actorId: userId, actorRef, role: "owner", occurredAt: boundOccurredAt, expiresAt: "2026-08-11T12:00:00.000Z",
      repositoryRef: "repository_impact", repositoryRevision: "verify-2", expectedCatalogHeadHash: "GENESIS",
      expectedSnapshotHeadHash: materialized.snapshotHash, expectedPolicyRegistryHash: registry, catalog: boundCatalog, scope: boundScope, manualLocks: [] });
    const afterPublish = await new DrizzleInstructionPolicyImpactRepository(outer as never).preview(workspaceId, policyRef, "pause");
    const foreign = await new DrizzleInstructionPolicyImpactRepository(outer as never).preview(foreignWorkspaceId, policyRef, "publish");
    const security = (await outer.execute(sql`select
      (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'policy_authority_catalog_revisions'::regclass) as catalog_rls,
      not has_table_privilege('anon', 'policy_authority_catalog_revisions', 'select') as catalog_anon_revoked,
      exists (select 1 from pg_trigger where tgname = 'policy_authority_catalog_revisions_chain_trigger' and not tgisinternal) as catalog_append_only,
      exists (select 1 from pg_trigger where tgname = 'policy_manual_lock_revisions_append_only_trigger' and not tgisinternal) as manual_lock_append_only,
      (select count(*)::int from policy_authority_catalog_revisions where workspace_id = ${workspaceId}::uuid) as catalog_revisions,
      (select count(*)::int from tenant_authority_snapshots where workspace_id = ${workspaceId}::uuid) as snapshots,
      (select count(*)::int from policy_authority_bindings where workspace_id = ${workspaceId}::uuid) as authority_bindings,
      (select count(*)::int from policy_semantic_binding_revisions where workspace_id = ${workspaceId}::uuid) as semantic_bindings`)).rows[0] as Record<string, unknown>;
    evidence = {
      outerRollback: true, actualDraftPersisted: drafted.auditAppended, emptyAuthorityBootstrapMaterialized: materialized.capabilities.productionAuthoritySourceBound === false,
      publishUsesRealImpactOCC: published.auditAppended, prePublishComplete: beforePublish.coverage.complete,
      postPublishFailClosed: afterPublishBeforeAuthority?.mutationAllowed === false && afterPublishBeforeAuthority.disposition === "blocked"
        && afterPublishBeforeAuthority.coverage.partialOrUnknown.includes("trusted_authority_catalog"),
      postPublishPartialFamilies: afterPublishBeforeAuthority?.coverage.partialOrUnknown,
      postPublishIntegrity: afterPublishBeforeAuthority?.coverage.integrity,
      realRelationalWriterFacts: semantic.replayed === false && group.replayed === false && topic.replayed === false
        && boundMaterialized.capabilities.productionAuthoritySourceBound === false
        && Number(security.authority_bindings) === 3 && Number(security.semantic_bindings) === 1,
      crossTenantNoPolicyVisible: foreign === null, catalogRls: security.catalog_rls === true,
      catalogAnonRevoked: security.catalog_anon_revoked === true, catalogAppendOnly: security.catalog_append_only === true,
      manualLockAppendOnly: security.manual_lock_append_only === true, catalogRevisions: Number(security.catalog_revisions),
      snapshots: Number(security.snapshots), actionOrNetworkCalls: fetchCalls,
      completeAuthorityImpact: afterPublish?.coverage.complete === true && afterPublish.mutationAllowed === true
        && afterPublish.coverage.partialOrUnknown.length === 0,
    };
    if (!evidence.actualDraftPersisted || !evidence.emptyAuthorityBootstrapMaterialized || !evidence.publishUsesRealImpactOCC
      || !evidence.prePublishComplete || !evidence.realRelationalWriterFacts || !evidence.completeAuthorityImpact
      || !evidence.crossTenantNoPolicyVisible || !evidence.catalogRls || !evidence.catalogAnonRevoked
      || !evidence.catalogAppendOnly || !evidence.manualLockAppendOnly || evidence.catalogRevisions !== 2
      || evidence.snapshots !== 2 || evidence.actionOrNetworkCalls !== 0) throw new Error(`verifier_assertion_failed:${JSON.stringify(evidence)}`);
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  globalThis.fetch = originalFetch;
}
const survivors = await database.execute(sql`select count(*)::int as count from workspaces where id = ${workspaceId}::uuid`);
await pool.end();
if (Number(survivors.rows[0]?.count) !== 0 || fetchCalls !== 0 || !evidence) throw new Error("outer_rollback_failed");
console.log(JSON.stringify({ ok: true, scope: "real_relational_authority_impact_live",
  completeExactFixture: true, temporaryRowsCommitted: false, ...evidence }));
