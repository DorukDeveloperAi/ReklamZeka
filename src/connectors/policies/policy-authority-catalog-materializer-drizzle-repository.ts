import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createPolicyScopeSnapshot, createTrustedPolicyCatalog, type FrozenPolicyManualLock, type PolicyScopeSnapshot, type TrustedPolicyCatalog } from "@/application/trusted-policy-composition";
import * as schema from "@/db/schema";
import { invalidatePersistedPolicyAuthorityContexts } from "@/connectors/policies/policy-authority-context-invalidation";

type Database = Pick<NodePgDatabase<typeof schema>, "execute" | "transaction">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CAPABILITIES = Object.freeze({ productionAuthoritySourceBound: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });

export class PolicyAuthorityCatalogMaterializerError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store" | "incomplete_authority") {
    super(`Policy authority catalog materialization rejected: ${code}`); this.name = "PolicyAuthorityCatalogMaterializerError";
  }
}
function fail(code: PolicyAuthorityCatalogMaterializerError["code"]): never { throw new PolicyAuthorityCatalogMaterializerError(code); }
function rows<T>(value: unknown): readonly T[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store"); return value.rows as readonly T[]; }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function iso(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input"); return value; }

/**
 * Server-private writer for authority-free catalog materialization. It never grants
 * a capability and only advances protected heads after every relational fact is proven.
 */
export class DrizzlePolicyAuthorityCatalogMaterializerRepository {
  constructor(private readonly database: Database) {}

  async materialize(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string; role: "owner" | "admin";
    occurredAt: string; expiresAt: string; repositoryRef: string; repositoryRevision: string;
    expectedCatalogHeadHash: "GENESIS" | string; expectedSnapshotHeadHash: "GENESIS" | string;
    expectedPolicyRegistryHash: string; catalog: TrustedPolicyCatalog; scope: PolicyScopeSnapshot; manualLocks: readonly FrozenPolicyManualLock[] }>) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !REF.test(input.workspaceRef) || !REF.test(input.actorRef)
      || !["owner", "admin"].includes(input.role) || !REF.test(input.repositoryRef) || !input.repositoryRevision.trim()
      || (input.expectedCatalogHeadHash !== "GENESIS" && !HASH.test(input.expectedCatalogHeadHash))
      || (input.expectedSnapshotHeadHash !== "GENESIS" && !HASH.test(input.expectedSnapshotHeadHash)) || !HASH.test(input.expectedPolicyRegistryHash)
      || Date.parse(iso(input.expiresAt)) <= Date.parse(iso(input.occurredAt))) fail("invalid_input");
    const { schemaVersion: _catalogSchemaVersion, authority: _catalogAuthority, catalogHash: suppliedCatalogHash, ...catalogInput } = input.catalog;
    const catalog = createTrustedPolicyCatalog(catalogInput);
    if (catalog.catalogHash !== suppliedCatalogHash) fail("invalid_input");
    const scope = createPolicyScopeSnapshot({ workspaceRef: input.scope.workspaceRef, evaluatedAt: input.scope.evaluatedAt,
      accountGroupRefs: input.scope.accountGroupRefs, objectiveRefs: input.scope.objectiveRefs, topicRefs: input.scope.topicRefs,
      canonicalObjective: input.scope.objectiveEvidence.canonicalObjective });
    if (scope.scopeHash !== input.scope.scopeHash) fail("invalid_input");
    if (catalog.workspaceRef !== input.workspaceRef || scope.workspaceRef !== input.workspaceRef || scope.evaluatedAt !== input.occurredAt
      || catalog.instructionPolicyRegistryHash !== input.expectedPolicyRegistryHash) fail("invalid_input");
    const lockIdentity = new Set(input.manualLocks.map((lock) => `${lock.lockRef}:${lock.policyRef}:${lock.policyVersion}:${lock.policyHash}`));
    if (lockIdentity.size !== input.manualLocks.length || input.manualLocks.some((lock) => lock.workspaceRef !== input.workspaceRef || lock.evaluatedAt !== input.occurredAt || lock.state !== "locked")) fail("invalid_input");

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Pick<NodePgDatabase<typeof schema>, "execute">;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid for update`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      const policyRows = rows<{ id: unknown; policy_ref: unknown; policy_version: unknown; canonical_hash: unknown }>(await tx.execute(sql`
        select policy.id::text, policy.policy_ref, policy.policy_version, policy.canonical_hash
          from strict_instruction_policy_revisions policy where policy.workspace_id = ${input.workspaceId}::uuid and policy.status = 'published'
            and policy.policy_version = (select max(candidate.policy_version) from strict_instruction_policy_revisions candidate
              where candidate.workspace_id = policy.workspace_id and candidate.policy_ref = policy.policy_ref and candidate.status = 'published') for update`));
      const registry = policyRows.map((row) => ({ policyRef: String(row.policy_ref), policyVersion: Number(row.policy_version), canonicalHash: String(row.canonical_hash), status: "published" })).sort((a, b) => a.policyRef.localeCompare(b.policyRef));
      if (digest(registry) !== input.expectedPolicyRegistryHash || catalog.bindings.some((binding) => !policyRows.some((row) => row.policy_ref === binding.policyRef && Number(row.policy_version) === binding.policyVersion && row.canonical_hash === binding.policyHash))) fail("conflict");
      const groupFacts = rows<{ group_ref: unknown; current_revision: unknown; current_revision_hash: unknown }>(await tx.execute(sql`
        select group_row.group_ref, group_row.current_revision, group_row.current_revision_hash
          from account_groups group_row join account_group_revisions revision
            on revision.workspace_id = group_row.workspace_id and revision.account_group_id = group_row.id
              and revision.revision = group_row.current_revision and revision.revision_hash = group_row.current_revision_hash
              and revision.status = 'active'
          where group_row.workspace_id = ${input.workspaceId}::uuid and group_row.current_revision > 0 for update of group_row, revision`));
      const topicFacts = rows<{ topic_ref: unknown; current_revision: unknown; current_revision_hash: unknown }>(await tx.execute(sql`
        select topic.topic_ref, topic.current_revision, topic.current_revision_hash
          from authority_topics topic join authority_topic_revisions revision
            on revision.workspace_id = topic.workspace_id and revision.topic_id = topic.id
              and revision.revision = topic.current_revision and revision.revision_hash = topic.current_revision_hash
              and revision.status = 'active'
          where topic.workspace_id = ${input.workspaceId}::uuid and topic.current_revision > 0 for update of topic, revision`));
      if (scope.accountGroupRefs.some((ref) => !groupFacts.some((row) => row.group_ref === ref && HASH.test(String(row.current_revision_hash))))
        || scope.topicRefs.some((ref) => !topicFacts.some((row) => row.topic_ref === ref && HASH.test(String(row.current_revision_hash))))) fail("incomplete_authority");
      const semanticFactsByPolicy = new Map<string, readonly { semantic_ref: unknown; revision: unknown; revision_hash: unknown }[]>();
      for (const binding of catalog.bindings) {
        const policy = policyRows.find((row) => row.policy_ref === binding.policyRef && Number(row.policy_version) === binding.policyVersion && row.canonical_hash === binding.policyHash);
        if (!policy || typeof policy.id !== "string" || !UUID.test(policy.id)) fail("corrupt_store");
        const facts = rows<{ semantic_ref: unknown; revision: unknown; revision_hash: unknown }>(await tx.execute(sql`
          select semantic.semantic_ref, semantic.revision, semantic.revision_hash from policy_semantic_binding_revisions semantic
          where semantic.workspace_id = ${input.workspaceId}::uuid and semantic.policy_revision_id = ${policy.id}::uuid
            and not exists (select 1 from policy_semantic_binding_revisions later
              where later.workspace_id = semantic.workspace_id and later.policy_revision_id = semantic.policy_revision_id
                and later.semantic_ref = semantic.semantic_ref and later.revision > semantic.revision)
          for update`));
        if (facts.length === 0 || facts.some((fact) => !REF.test(String(fact.semantic_ref)) || !HASH.test(String(fact.revision_hash)))) fail("incomplete_authority");
        semanticFactsByPolicy.set(policy.id, facts);
      }
      for (const lock of input.manualLocks) {
        const lockRows = rows<{ operation: unknown }>(await tx.execute(sql`select operation from policy_manual_lock_revisions lock join strict_instruction_policy_revisions policy on policy.workspace_id = lock.workspace_id and policy.id = lock.policy_revision_id where lock.workspace_id = ${input.workspaceId}::uuid and lock.lock_ref = ${lock.lockRef} and policy.policy_ref = ${lock.policyRef} and policy.policy_version = ${lock.policyVersion} and policy.canonical_hash = ${lock.policyHash} order by lock.sequence desc limit 1 for update`));
        if (lockRows.length !== 1 || lockRows[0]!.operation !== "lock") fail("incomplete_authority");
      }
      const catalogHead = rows<{ id: unknown; current_revision: unknown; current_revision_hash: unknown }>(await tx.execute(sql`select id::text, current_revision, current_revision_hash from policy_authority_catalogs where workspace_id = ${input.workspaceId}::uuid and catalog_ref = ${catalog.catalogRef} for update`));
      if (catalogHead.length > 1) fail("corrupt_store");
      const oldCatalogHash = catalogHead[0]?.current_revision_hash === null || catalogHead.length === 0 ? "GENESIS" : String(catalogHead[0]!.current_revision_hash);
      if (oldCatalogHash !== input.expectedCatalogHeadHash) fail("conflict");
      const existingCatalogRevision = rows<{ id: unknown; revision: unknown }>(await tx.execute(sql`
        select id::text, revision from policy_authority_catalog_revisions
          where workspace_id = ${input.workspaceId}::uuid and catalog_ref = ${catalog.catalogRef}
            and revision_hash = ${catalog.catalogHash} limit 2 for share`));
      if (existingCatalogRevision.length > 1) fail("corrupt_store");
      const reusingCatalogRevision = existingCatalogRevision.length === 1;
      const revision = reusingCatalogRevision ? Number(existingCatalogRevision[0]!.revision) : catalogHead.length === 0 ? 1 : Number(catalogHead[0]!.current_revision) + 1;
      const catalogId = catalogHead.length === 0 ? randomUUID() : String(catalogHead[0]!.id);
      const revisionId = reusingCatalogRevision ? String(existingCatalogRevision[0]!.id) : randomUUID();
      if (reusingCatalogRevision && (catalogHead.length === 0 || oldCatalogHash !== catalog.catalogHash || Number(catalogHead[0]!.current_revision) !== revision)) fail("conflict");
      if (catalogHead.length === 0) await tx.execute(sql`insert into policy_authority_catalogs (id, workspace_id, catalog_ref) values (${catalogId}::uuid, ${input.workspaceId}::uuid, ${catalog.catalogRef})`);
      if (!reusingCatalogRevision) {
        await tx.execute(sql`insert into policy_authority_catalog_revisions (id, workspace_id, catalog_ref, revision, previous_revision_hash, revision_hash, payload, recorded_at)
          values (${revisionId}::uuid, ${input.workspaceId}::uuid, ${catalog.catalogRef}, ${revision}, ${revision === 1 ? null : oldCatalogHash}, ${catalog.catalogHash}, ${JSON.stringify(catalog)}::jsonb, ${input.occurredAt}::timestamptz)`);
        await tx.execute(sql`update policy_authority_catalogs set current_revision = ${revision}, current_revision_hash = ${catalog.catalogHash}
          where id = ${catalogId}::uuid and workspace_id = ${input.workspaceId}::uuid and current_revision = ${revision - 1}`);
      }

      const snapshotCore = Object.freeze({ schemaVersion: "tenant-authority-snapshot/1.0.0", snapshotRef: `authority_snapshot_${digest({ catalogHash: catalog.catalogHash, repositoryRef: input.repositoryRef, repositoryRevision: input.repositoryRevision, expiresAt: input.expiresAt }).slice(0, 24)}`,
        repository: { ref: input.repositoryRef, revision: input.repositoryRevision, verified: true }, authority: CAPABILITIES,
        // Both ends are in the signed immutable payload.  A later read can
        // therefore use this pre-materialized snapshot only inside its exact
        // validity window; it cannot rely on a mutable wall-clock assertion.
        validity: { notBefore: input.occurredAt, expiresAt: input.expiresAt },
        policyAuthority: { catalogHash: catalog.catalogHash, scope, manualLocks: input.manualLocks } });
      const snapshotHash = digest(snapshotCore); const snapshot = Object.freeze({ ...snapshotCore, snapshotHash }); const snapshotId = randomUUID();
      const snapshotHead = rows<{ current_snapshot_hash: unknown }>(await tx.execute(sql`select current_snapshot_hash from tenant_authority_snapshot_heads where workspace_id = ${input.workspaceId}::uuid for update`));
      if (snapshotHead.length > 1) fail("corrupt_store");
      const oldSnapshotHash = snapshotHead.length === 0 ? "GENESIS" : String(snapshotHead[0]!.current_snapshot_hash);
      if (oldSnapshotHash !== input.expectedSnapshotHeadHash) fail("conflict");
      const expectedBindingCount = catalog.bindings.length === 0 ? 0 : [...semanticFactsByPolicy.values()].reduce((count, facts) => count + facts.length, 0)
        + catalog.bindings.length * (groupFacts.filter((entry) => scope.accountGroupRefs.includes(String(entry.group_ref))).length
          + topicFacts.filter((entry) => scope.topicRefs.includes(String(entry.topic_ref))).length);
      const currentExactSnapshot = rows<{ id: unknown; binding_count: unknown }>(await tx.execute(sql`
        select snapshot.id::text, (select count(*)::int from policy_authority_bindings binding
          where binding.workspace_id = snapshot.workspace_id and binding.authority_snapshot_id = snapshot.id) as binding_count
          from tenant_authority_snapshots snapshot join tenant_authority_snapshot_heads head
          on head.workspace_id = snapshot.workspace_id and head.current_snapshot_id = snapshot.id and head.current_snapshot_hash = snapshot.snapshot_hash
          where snapshot.workspace_id = ${input.workspaceId}::uuid and snapshot.snapshot_hash = ${snapshotHash}
            and snapshot.expires_at > ${input.occurredAt}::timestamptz limit 2 for share`));
      if (currentExactSnapshot.length > 1) fail("corrupt_store");
      if (currentExactSnapshot.length === 1 && Number(currentExactSnapshot[0]!.binding_count) === expectedBindingCount) return Object.freeze({ catalogRef: catalog.catalogRef, catalogRevision: revision,
        catalogHash: catalog.catalogHash, snapshotRef: snapshot.snapshotRef, snapshotHash, capabilities: CAPABILITIES });
      if (currentExactSnapshot.length === 1) fail("corrupt_store");
      await tx.execute(sql`insert into tenant_authority_snapshots (id, workspace_id, snapshot_ref, snapshot_hash, repository_ref, repository_revision, verified_at, expires_at, snapshot_payload)
        values (${snapshotId}::uuid, ${input.workspaceId}::uuid, ${snapshot.snapshotRef}, ${snapshotHash}, ${input.repositoryRef}, ${input.repositoryRevision}, ${input.occurredAt}::timestamptz, ${input.expiresAt}::timestamptz, ${JSON.stringify(snapshot)}::jsonb)`);
      for (const binding of catalog.bindings) {
        const policy = policyRows.find((row) => row.policy_ref === binding.policyRef && Number(row.policy_version) === binding.policyVersion && row.canonical_hash === binding.policyHash);
        if (!policy || typeof policy.id !== "string" || !UUID.test(policy.id)) fail("corrupt_store");
        const facts = semanticFactsByPolicy.get(policy.id);
        if (!facts) fail("corrupt_store");
        const tierRef = `authority_tier_${binding.authorityTier}`; const decisionRef = `decision_${binding.decision?.decisionKey ?? "default"}_${binding.decision?.positionKey ?? "default"}`;
        for (const fact of facts) await tx.execute(sql`insert into policy_authority_bindings (id, workspace_id, policy_revision_id, authority_snapshot_id, authority_catalog_revision_id, authority_tier_ref, decision_ref, binding_kind, binding_ref, binding_version, binding_hash)
          values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${policy.id}::uuid, ${snapshotId}::uuid, ${revisionId}::uuid, ${tierRef}, ${decisionRef}, 'semantic', ${String(fact.semantic_ref)}, ${String(fact.revision)}, ${String(fact.revision_hash)})`);
        for (const fact of groupFacts.filter((entry) => scope.accountGroupRefs.includes(String(entry.group_ref)))) await tx.execute(sql`insert into policy_authority_bindings (id, workspace_id, policy_revision_id, authority_snapshot_id, authority_catalog_revision_id, authority_tier_ref, decision_ref, binding_kind, binding_ref, binding_version, binding_hash)
          values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${policy.id}::uuid, ${snapshotId}::uuid, ${revisionId}::uuid, ${tierRef}, ${decisionRef}, 'account_group', ${String(fact.group_ref)}, ${String(fact.current_revision)}, ${String(fact.current_revision_hash)})`);
        for (const fact of topicFacts.filter((entry) => scope.topicRefs.includes(String(entry.topic_ref)))) await tx.execute(sql`insert into policy_authority_bindings (id, workspace_id, policy_revision_id, authority_snapshot_id, authority_catalog_revision_id, authority_tier_ref, decision_ref, binding_kind, binding_ref, binding_version, binding_hash)
          values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${policy.id}::uuid, ${snapshotId}::uuid, ${revisionId}::uuid, ${tierRef}, ${decisionRef}, 'topic', ${String(fact.topic_ref)}, ${String(fact.current_revision)}, ${String(fact.current_revision_hash)})`);
      }
      if (snapshotHead.length === 0) await tx.execute(sql`insert into tenant_authority_snapshot_heads (workspace_id, current_snapshot_id, current_snapshot_hash, updated_at) values (${input.workspaceId}::uuid, ${snapshotId}::uuid, ${snapshotHash}, ${input.occurredAt}::timestamptz)`);
      else await tx.execute(sql`update tenant_authority_snapshot_heads set current_snapshot_id = ${snapshotId}::uuid, current_snapshot_hash = ${snapshotHash}, updated_at = ${input.occurredAt}::timestamptz where workspace_id = ${input.workspaceId}::uuid and current_snapshot_hash = ${oldSnapshotHash}`);
      await invalidatePersistedPolicyAuthorityContexts({ executor: tx, workspaceId: input.workspaceId,
        observedAt: input.occurredAt, changeRef: snapshotHash });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const audit = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId, action: "policy_authority_catalog.materialized",
        resourceType: "policy_authority_catalog", resourceId: catalog.catalogRef, metadata: { catalogHash: catalog.catalogHash, snapshotRef: snapshot.snapshotRef, snapshotHash, revision }, previousHash: previousAuditHash, occurredAt: input.occurredAt });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at)
        values (${audit.id}::uuid, ${audit.workspaceId}::uuid, ${audit.actorId}::uuid, ${audit.action}, ${audit.resourceType}, ${audit.resourceId}, ${JSON.stringify(audit.metadata)}::jsonb, ${audit.previousHash}, ${digest(audit)}, ${audit.occurredAt}::timestamptz)`);
      return Object.freeze({ catalogRef: catalog.catalogRef, catalogRevision: revision, catalogHash: catalog.catalogHash, snapshotRef: snapshot.snapshotRef, snapshotHash, capabilities: CAPABILITIES });
    });
  }
}
