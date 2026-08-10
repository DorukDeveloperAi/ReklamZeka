import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createPolicyScopeSnapshot, createTrustedPolicyCatalog, type FrozenPolicyManualLock, type PolicyScopeSnapshot, type TrustedPolicyCatalog } from "@/application/trusted-policy-composition";
import * as schema from "@/db/schema";

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
    const catalog = createTrustedPolicyCatalog(input.catalog);
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
      const policyRows = rows<{ policy_ref: unknown; policy_version: unknown; canonical_hash: unknown }>(await tx.execute(sql`
        select policy_ref, policy_version, canonical_hash from strict_instruction_policy_revisions where workspace_id = ${input.workspaceId}::uuid and status = 'published' for update`));
      const registry = policyRows.map((row) => ({ policyRef: String(row.policy_ref), policyVersion: Number(row.policy_version), canonicalHash: String(row.canonical_hash), status: "published" })).sort((a, b) => a.policyRef.localeCompare(b.policyRef));
      if (digest(registry) !== input.expectedPolicyRegistryHash || catalog.bindings.some((binding) => !policyRows.some((row) => row.policy_ref === binding.policyRef && Number(row.policy_version) === binding.policyVersion && row.canonical_hash === binding.policyHash))) fail("conflict");
      const catalogHead = rows<{ id: unknown; current_revision: unknown; current_revision_hash: unknown }>(await tx.execute(sql`select id::text, current_revision, current_revision_hash from policy_authority_catalogs where workspace_id = ${input.workspaceId}::uuid and catalog_ref = ${catalog.catalogRef} for update`));
      if (catalogHead.length > 1) fail("corrupt_store");
      const oldCatalogHash = catalogHead[0]?.current_revision_hash === null || catalogHead.length === 0 ? "GENESIS" : String(catalogHead[0]!.current_revision_hash);
      if (oldCatalogHash !== input.expectedCatalogHeadHash) fail("conflict");
      const revision = catalogHead.length === 0 ? 1 : Number(catalogHead[0]!.current_revision) + 1;
      const catalogId = catalogHead.length === 0 ? randomUUID() : String(catalogHead[0]!.id);
      const revisionId = randomUUID();
      if (catalogHead.length === 0) await tx.execute(sql`insert into policy_authority_catalogs (id, workspace_id, catalog_ref) values (${catalogId}::uuid, ${input.workspaceId}::uuid, ${catalog.catalogRef})`);
      await tx.execute(sql`insert into policy_authority_catalog_revisions (id, workspace_id, catalog_ref, revision, previous_revision_hash, revision_hash, payload, recorded_at)
        values (${revisionId}::uuid, ${input.workspaceId}::uuid, ${catalog.catalogRef}, ${revision}, ${revision === 1 ? null : oldCatalogHash}, ${catalog.catalogHash}, ${JSON.stringify(catalog)}::jsonb, ${input.occurredAt}::timestamptz)`);
      await tx.execute(sql`update policy_authority_catalogs set current_revision = ${revision}, current_revision_hash = ${catalog.catalogHash}
        where id = ${catalogId}::uuid and workspace_id = ${input.workspaceId}::uuid and current_revision = ${revision - 1}`);

      const snapshotCore = Object.freeze({ schemaVersion: "tenant-authority-snapshot/1.0.0", snapshotRef: `authority_snapshot_${catalog.catalogHash.slice(0, 24)}`,
        repository: { ref: input.repositoryRef, revision: input.repositoryRevision, verified: true }, authority: CAPABILITIES,
        policyAuthority: { catalogHash: catalog.catalogHash, scope, manualLocks: input.manualLocks } });
      const snapshotHash = digest(snapshotCore); const snapshot = Object.freeze({ ...snapshotCore, snapshotHash }); const snapshotId = randomUUID();
      const snapshotHead = rows<{ current_snapshot_hash: unknown }>(await tx.execute(sql`select current_snapshot_hash from tenant_authority_snapshot_heads where workspace_id = ${input.workspaceId}::uuid for update`));
      if (snapshotHead.length > 1) fail("corrupt_store");
      const oldSnapshotHash = snapshotHead.length === 0 ? "GENESIS" : String(snapshotHead[0]!.current_snapshot_hash);
      if (oldSnapshotHash !== input.expectedSnapshotHeadHash) fail("conflict");
      await tx.execute(sql`insert into tenant_authority_snapshots (id, workspace_id, snapshot_ref, snapshot_hash, repository_ref, repository_revision, verified_at, expires_at, snapshot_payload)
        values (${snapshotId}::uuid, ${input.workspaceId}::uuid, ${snapshot.snapshotRef}, ${snapshotHash}, ${input.repositoryRef}, ${input.repositoryRevision}, ${input.occurredAt}::timestamptz, ${input.expiresAt}::timestamptz, ${JSON.stringify(snapshot)}::jsonb)`);
      if (snapshotHead.length === 0) await tx.execute(sql`insert into tenant_authority_snapshot_heads (workspace_id, current_snapshot_id, current_snapshot_hash, updated_at) values (${input.workspaceId}::uuid, ${snapshotId}::uuid, ${snapshotHash}, ${input.occurredAt}::timestamptz)`);
      else await tx.execute(sql`update tenant_authority_snapshot_heads set current_snapshot_id = ${snapshotId}::uuid, current_snapshot_hash = ${snapshotHash}, updated_at = ${input.occurredAt}::timestamptz where workspace_id = ${input.workspaceId}::uuid and current_snapshot_hash = ${oldSnapshotHash}`);
      await tx.execute(sql`insert into effective_campaign_context_invalidations (workspace_id, event_hash, component_type, component_ref, component_version, scope_kind, entity_type, entity_ref, reason_code, observed_at)
        values (${input.workspaceId}::uuid, ${digest({ workspaceId: input.workspaceId, snapshotHash, catalogHash: catalog.catalogHash, occurredAt: input.occurredAt })}, 'policy_authority', 'policy_authority_catalog', ${snapshotHash}, 'workspace_component', null, null, 'source_changed', ${input.occurredAt}::timestamptz) on conflict (workspace_id, event_hash) do nothing`);
      return Object.freeze({ catalogRef: catalog.catalogRef, catalogRevision: revision, catalogHash: catalog.catalogHash, snapshotRef: snapshot.snapshotRef, snapshotHash, capabilities: CAPABILITIES });
    });
  }
}
