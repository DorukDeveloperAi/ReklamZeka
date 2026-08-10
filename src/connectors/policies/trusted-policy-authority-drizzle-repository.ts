import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  composeTrustedPolicyContext,
  createFrozenPolicyManualLock,
  createPolicyScopeSnapshot,
  createTrustedPolicyCatalog,
  type FrozenPolicyManualLock,
  type PolicyScopeSnapshot,
  type TrustedPolicyCatalog,
} from "@/application/trusted-policy-composition";
import type { EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import type { InstructionPolicyLifecycleState } from "@/application/instruction-policy-lifecycle-service";
import type { RepositoryVerifiedPolicyAuthoritySnapshot } from "@/domain/policies/trusted-policy-authority";
import * as schema from "@/db/schema";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export class TrustedPolicyAuthorityRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "not_found" | "ambiguous_authority" | "corrupt_store") {
    super(`Trusted policy authority rejected: ${code}`); this.name = "TrustedPolicyAuthorityRepositoryError";
  }
}
function fail(code: TrustedPolicyAuthorityRepositoryError["code"]): never { throw new TrustedPolicyAuthorityRepositoryError(code); }
function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("corrupt_store");
  return value as Record<string, unknown>;
}
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("corrupt_store");
  return value;
}
function list(value: unknown): readonly unknown[] { if (!Array.isArray(value) || value.length > 1_000) fail("corrupt_store"); return value; }
function sorted(values: readonly string[]): readonly string[] {
  const copy = [...values].sort(); if (new Set(copy).size !== copy.length) fail("corrupt_store"); return Object.freeze(copy);
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

export type LoadedTrustedPolicyAuthority = Readonly<{
  catalog: TrustedPolicyCatalog;
  scope: PolicyScopeSnapshot;
  manualLocks: readonly FrozenPolicyManualLock[];
  authoritySnapshot: RepositoryVerifiedPolicyAuthoritySnapshot;
  /** This closure is created only after the repository has verified the tenant rows. */
  compose(baseContext: EffectiveCampaignContextInput, lifecycle: InstructionPolicyLifecycleState): RepositoryTrustedPolicyComposition;
}>;
type RepositoryTrustedPolicyComposition = Omit<ReturnType<typeof composeTrustedPolicyContext>, "validationBoundary"> & Readonly<{
  validationBoundary: Readonly<{ contractIntegrity: "self_hash_validated"; productionAuthoritySourceBound: true }>;
}>;

type AuthorityRow = Readonly<{ snapshot_id: unknown; snapshot_ref: unknown; snapshot_hash: unknown;
  repository_ref: unknown; repository_revision: unknown; verified_at: unknown; expires_at: unknown;
  snapshot_payload: unknown; catalog_id: unknown; catalog_revision_hash: unknown; catalog_payload: unknown;
  binding_rows: unknown; account_group_refs: unknown; manual_lock_rows: unknown; current_snapshot_count: unknown }>;

/**
 * Reads one current tenant authority snapshot and proves its relational backing.
 * This is deliberately server-only: callers receive an opaque proof rather than
 * a capability grant. Ambiguity, stale rows, and any unlinked family fail closed.
 */
export class DrizzleTrustedPolicyAuthorityRepository {
  constructor(private readonly database: Database) {}

  async load(input: Readonly<{ workspaceId: string; accountRef: string; evaluatedAt: string;
    /** Historical replay must name both immutable snapshot ref and hash; current loads use protected heads. */
    snapshotRef?: string; snapshotHash?: string }>): Promise<LoadedTrustedPolicyAuthority> {
    if (!UUID.test(input.workspaceId) || !REF.test(input.accountRef)
      || !Number.isFinite(Date.parse(input.evaluatedAt)) || new Date(input.evaluatedAt).toISOString() !== input.evaluatedAt
      || ((input.snapshotRef === undefined) !== (input.snapshotHash === undefined))
      || (input.snapshotRef !== undefined && (!REF.test(input.snapshotRef) || !HASH.test(input.snapshotHash!)))) fail("invalid_input");
    const active = rows(await this.database.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
      and lifecycle_state = 'active' limit 2`));
    if (active.length !== 1) fail("workspace_scope_mismatch");
    const result = rows<AuthorityRow>(await this.database.execute(sql`
      with selected_snapshot as (
        select snapshot.* from tenant_authority_snapshot_heads head
          join tenant_authority_snapshots snapshot on snapshot.workspace_id = head.workspace_id
            and snapshot.id = head.current_snapshot_id and snapshot.snapshot_hash = head.current_snapshot_hash
        where head.workspace_id = ${input.workspaceId}::uuid and ${input.snapshotRef === undefined}
        union all
        select snapshot.* from tenant_authority_snapshots snapshot
        where snapshot.workspace_id = ${input.workspaceId}::uuid and ${input.snapshotRef !== undefined}
          and snapshot.snapshot_ref = ${input.snapshotRef ?? ""} and snapshot.snapshot_hash = ${input.snapshotHash ?? ""}
      ), linked_catalog as (
        select catalog.* from policy_authority_catalog_revisions catalog
        join selected_snapshot snapshot on snapshot.workspace_id = catalog.workspace_id
          and catalog.revision_hash = snapshot.snapshot_payload #>> '{policyAuthority,catalogHash}'
        where ${input.snapshotRef !== undefined} or exists (select 1 from policy_authority_catalogs catalog_head
          where catalog_head.workspace_id = catalog.workspace_id and catalog_head.catalog_ref = catalog.catalog_ref
            and catalog_head.current_revision = catalog.revision and catalog_head.current_revision_hash = catalog.revision_hash)
      )
      select snapshot.id::text as snapshot_id, snapshot.snapshot_ref, snapshot.snapshot_hash,
        snapshot.repository_ref, snapshot.repository_revision, snapshot.verified_at::text, snapshot.expires_at::text,
        snapshot.snapshot_payload, catalog.id::text as catalog_id, catalog.revision_hash as catalog_revision_hash,
        catalog.payload as catalog_payload, (select count(*)::int from selected_snapshot) as current_snapshot_count,
        coalesce((select jsonb_agg(jsonb_build_object('policyRef', policy.policy_ref, 'policyVersion', policy.policy_version,
          'policyHash', policy.canonical_hash, 'bindingKind', binding.binding_kind, 'bindingRef', binding.binding_ref,
          'bindingVersion', binding.binding_version, 'bindingHash', binding.binding_hash, 'authorityTierRef', binding.authority_tier_ref,
          'decisionRef', binding.decision_ref) order by binding.binding_kind, binding.binding_ref, binding.binding_version)
          from policy_authority_bindings binding join strict_instruction_policy_revisions policy
            on policy.workspace_id = binding.workspace_id and policy.id = binding.policy_revision_id
          where binding.workspace_id = snapshot.workspace_id and binding.authority_snapshot_id = snapshot.id
            and binding.authority_catalog_revision_id = catalog.id
            and (binding.binding_kind <> 'account_group' or exists (select 1 from account_groups group_head
              join account_group_revisions group_revision on group_revision.workspace_id = group_head.workspace_id
                and group_revision.account_group_id = group_head.id and group_revision.revision = group_head.current_revision
                and group_revision.revision_hash = group_head.current_revision_hash
              where group_head.workspace_id = binding.workspace_id and group_head.group_ref = binding.binding_ref
                and group_revision.status = 'active'))
            and (binding.binding_kind <> 'topic' or exists (select 1 from authority_topics topic_head
              join authority_topic_revisions topic_revision on topic_revision.workspace_id = topic_head.workspace_id
                and topic_revision.topic_id = topic_head.id and topic_revision.revision = topic_head.current_revision
                and topic_revision.revision_hash = topic_head.current_revision_hash
              where topic_head.workspace_id = binding.workspace_id and topic_head.topic_ref = binding.binding_ref
                and topic_revision.status = 'active' and topic_revision.revision::text = binding.binding_version
                and topic_revision.revision_hash = binding.binding_hash))
            and (binding.binding_kind <> 'semantic' or exists (select 1 from policy_semantic_binding_revisions semantic
              where semantic.workspace_id = binding.workspace_id and semantic.policy_revision_id = binding.policy_revision_id
                and semantic.semantic_ref = binding.binding_ref and semantic.revision::text = binding.binding_version
                and semantic.revision_hash = binding.binding_hash))), '[]'::jsonb) as binding_rows,
        coalesce((select jsonb_agg(group_revision.group_ref order by group_revision.group_ref)
          from account_groups group join account_group_revisions group_revision
            on group.workspace_id = group_revision.workspace_id and group.id = group_revision.account_group_id
              and group.current_revision = group_revision.revision and group.current_revision_hash = group_revision.revision_hash
          join account_group_account_bindings membership
            on membership.workspace_id = group_revision.workspace_id and membership.account_group_revision_id = group_revision.id
          join ad_accounts account on account.workspace_id = membership.workspace_id and account.id = membership.ad_account_id
          where group_revision.workspace_id = snapshot.workspace_id and group_revision.status = 'active'
            and account.external_account_id = ${input.accountRef}), '[]'::jsonb) as account_group_refs,
        coalesce((select jsonb_agg(jsonb_build_object('lockRef', lock.lock_ref, 'policyRef', policy.policy_ref,
          'policyVersion', policy.policy_version, 'policyHash', policy.canonical_hash, 'operation', lock.operation,
          'revisionHash', lock.revision_hash, 'recordedAt', lock.recorded_at::text) order by lock.lock_ref, lock.sequence)
          from (select distinct on (lock.workspace_id, lock.policy_revision_id, lock.lock_ref) lock.*
            from policy_manual_lock_revisions lock where lock.recorded_at <= ${input.evaluatedAt}::timestamptz
            order by lock.workspace_id, lock.policy_revision_id, lock.lock_ref, lock.sequence desc) lock
          join strict_instruction_policy_revisions policy
            on policy.workspace_id = lock.workspace_id and policy.id = lock.policy_revision_id
          where lock.workspace_id = snapshot.workspace_id), '[]'::jsonb) as manual_lock_rows
      from selected_snapshot snapshot join linked_catalog catalog on catalog.workspace_id = snapshot.workspace_id
    `));
    if (result.length === 0) fail("not_found");
    if (result.length !== 1) fail("ambiguous_authority");
    return this.project(result[0]!, input);
  }

  private project(row: AuthorityRow, input: Readonly<{ workspaceId: string; accountRef: string; evaluatedAt: string; snapshotRef?: string; snapshotHash?: string }>): LoadedTrustedPolicyAuthority {
    if (![row.snapshot_id, row.catalog_id].every((value) => typeof value === "string" && UUID.test(value))
      || typeof row.snapshot_ref !== "string" || !REF.test(row.snapshot_ref) || typeof row.snapshot_hash !== "string" || !HASH.test(row.snapshot_hash)
      || typeof row.repository_ref !== "string" || !REF.test(row.repository_ref) || typeof row.repository_revision !== "string" || !row.repository_revision.trim()
      || typeof row.catalog_revision_hash !== "string" || !HASH.test(row.catalog_revision_hash)) fail("corrupt_store");
    const snapshotCount = Number(row.current_snapshot_count);
    if (!Number.isSafeInteger(snapshotCount) || snapshotCount < 1) fail("corrupt_store");
    if (snapshotCount !== 1) fail("ambiguous_authority");
    const verifiedAt = iso(row.verified_at); const expiresAt = iso(row.expires_at);
    if (Date.parse(verifiedAt) > Date.parse(input.evaluatedAt) || Date.parse(expiresAt) <= Date.parse(input.evaluatedAt)
      || (input.snapshotRef !== undefined && (row.snapshot_ref !== input.snapshotRef || row.snapshot_hash !== input.snapshotHash))) fail("corrupt_store");
    const payload = exact(row.snapshot_payload, ["schemaVersion", "snapshotRef", "snapshotHash", "repository", "authority", "policyAuthority"]);
    const repository = exact(payload.repository, ["ref", "revision", "verified"]);
    const authority = exact(payload.authority, ["productionAuthoritySourceBound", "canPublish", "canApprove", "canExecute", "canWriteMeta"]);
    const policyAuthority = exact(payload.policyAuthority, ["catalogHash", "scope", "manualLocks"]);
    if (payload.schemaVersion !== "tenant-authority-snapshot/1.0.0" || payload.snapshotRef !== row.snapshot_ref || payload.snapshotHash !== row.snapshot_hash
      || repository.ref !== row.repository_ref || repository.revision !== row.repository_revision || repository.verified !== true
      || Object.values(authority).some((value) => value !== false) || policyAuthority.catalogHash !== row.catalog_revision_hash) fail("corrupt_store");
    const { snapshotHash: _snapshotHash, ...snapshotCore } = payload;
    if (digest(snapshotCore) !== row.snapshot_hash) fail("corrupt_store");
    const storedCatalog = row.catalog_payload as TrustedPolicyCatalog;
    let catalog: TrustedPolicyCatalog; let scope: PolicyScopeSnapshot; let manualLocks: readonly FrozenPolicyManualLock[];
    try {
      const rawCatalog = exact(storedCatalog, ["schemaVersion", "workspaceRef", "catalogRef", "catalogVersion", "instructionPolicyRegistryHash", "bindings", "authority", "catalogHash"]);
      catalog = createTrustedPolicyCatalog({ workspaceRef: rawCatalog.workspaceRef as string, catalogRef: rawCatalog.catalogRef as string,
        catalogVersion: rawCatalog.catalogVersion as number, instructionPolicyRegistryHash: rawCatalog.instructionPolicyRegistryHash as string,
        bindings: rawCatalog.bindings as TrustedPolicyCatalog["bindings"] });
      if (catalog.catalogHash !== row.catalog_revision_hash || rawCatalog.catalogHash !== catalog.catalogHash) fail("corrupt_store");
      const rawScope = exact(policyAuthority.scope, ["schemaVersion", "workspaceRef", "evaluatedAt", "accountGroupRefs", "objectiveRefs", "topicRefs", "objectiveEvidence", "scopeHash"]);
      scope = createPolicyScopeSnapshot({ workspaceRef: rawScope.workspaceRef as string, evaluatedAt: rawScope.evaluatedAt as string,
        accountGroupRefs: rawScope.accountGroupRefs as string[], objectiveRefs: rawScope.objectiveRefs as string[],
        topicRefs: rawScope.topicRefs as string[], canonicalObjective: exact(rawScope.objectiveEvidence, ["canonicalObjective", "mappingVersion", "mappingHash"]).canonicalObjective as never });
      if (scope.scopeHash !== rawScope.scopeHash || scope.workspaceRef !== catalog.workspaceRef || scope.evaluatedAt !== input.evaluatedAt) fail("corrupt_store");
      manualLocks = list(policyAuthority.manualLocks).map((raw) => {
        const lock = exact(raw, ["schemaVersion", "workspaceRef", "lockRef", "policyRef", "policyVersion", "policyHash", "state", "evaluatedAt", "lockHash"]);
        const rebuilt = createFrozenPolicyManualLock({ workspaceRef: lock.workspaceRef as string, lockRef: lock.lockRef as string,
          policyRef: lock.policyRef as string, policyVersion: lock.policyVersion as number, policyHash: lock.policyHash as string,
          evaluatedAt: lock.evaluatedAt as string });
        if (rebuilt.lockHash !== lock.lockHash || rebuilt.workspaceRef !== catalog.workspaceRef || rebuilt.evaluatedAt !== input.evaluatedAt) fail("corrupt_store");
        return rebuilt;
      });
    } catch (error) { if (error instanceof TrustedPolicyAuthorityRepositoryError) throw error; fail("corrupt_store"); }
    this.assertRelationalBacking(row, catalog, scope, manualLocks);
    const authoritySnapshot = Object.freeze({ schemaVersion: "tenant-authority-snapshot/1.0.0" as const,
      workspaceId: input.workspaceId, workspaceRef: catalog.workspaceRef, snapshotRef: row.snapshot_ref as string,
      snapshotHash: row.snapshot_hash as string, repositoryRef: row.repository_ref as string, repositoryRevision: row.repository_revision as string,
      catalogHash: catalog.catalogHash, scopeHash: scope.scopeHash, verifiedAt, expiresAt });
    const composition = (baseContext: EffectiveCampaignContextInput, lifecycle: InstructionPolicyLifecycleState) => {
      if (baseContext.workspaceId !== input.workspaceId || baseContext.identity.accountRef !== input.accountRef
        || new Date(baseContext.capturedAt).toISOString() !== input.evaluatedAt) {
        throw new TrustedPolicyAuthorityRepositoryError("workspace_scope_mismatch");
      }
      const selfValidated = composeTrustedPolicyContext({ baseContext, workspaceRef: catalog.workspaceRef, lifecycle, catalog, scope, manualLocks });
      const authorityVersion = createHash("sha256").update(JSON.stringify({ snapshotRef: authoritySnapshot.snapshotRef,
        snapshotHash: authoritySnapshot.snapshotHash, catalogHash: authoritySnapshot.catalogHash, scopeHash: authoritySnapshot.scopeHash,
        accountGroups: scope.accountGroupRefs, topics: scope.topicRefs, manualLocks: manualLocks.map((lock) => lock.lockHash) })).digest("hex");
      const resolvedBindings = list(row.binding_rows).map((value) => exact(value, ["policyRef", "policyVersion", "policyHash", "bindingKind", "bindingRef", "bindingVersion", "bindingHash", "authorityTierRef", "decisionRef"]));
      const bindingHashes = (kind: string) => sorted(resolvedBindings.filter((binding) => binding.bindingKind === kind)
        .map((binding) => binding.bindingHash as string));
      const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...contextInput } = selfValidated.context;
      const context = buildEffectiveCampaignContext({ ...contextInput, versions: { ...contextInput.versions, policyAuthority: authorityVersion },
        policyAuthorityEvidence: { snapshotRef: authoritySnapshot.snapshotRef, snapshotHash: authoritySnapshot.snapshotHash,
          catalogHash: authoritySnapshot.catalogHash, scopeHash: authoritySnapshot.scopeHash,
          accountGroupBindingHashes: bindingHashes("account_group"), topicBindingHashes: bindingHashes("topic"),
          semanticBindingHashes: bindingHashes("semantic"), manualLockBindingHashes: sorted(manualLocks.map((lock) => lock.lockHash)) } });
      return Object.freeze({ ...selfValidated, context, validationBoundary: Object.freeze({ contractIntegrity: "self_hash_validated" as const,
        productionAuthoritySourceBound: true as const }) });
    };
    return Object.freeze({ catalog, scope, manualLocks: Object.freeze([...manualLocks]), authoritySnapshot, compose: composition });
  }

  private assertRelationalBacking(row: AuthorityRow, catalog: TrustedPolicyCatalog, scope: PolicyScopeSnapshot,
    manualLocks: readonly FrozenPolicyManualLock[]): void {
    const bindings = list(row.binding_rows).map((value) => exact(value, ["policyRef", "policyVersion", "policyHash", "bindingKind", "bindingRef", "bindingVersion", "bindingHash", "authorityTierRef", "decisionRef"]));
    if (bindings.length === 0 || bindings.some((binding) => typeof binding.policyRef !== "string" || typeof binding.policyVersion !== "number"
      || typeof binding.policyHash !== "string" || !HASH.test(binding.policyHash) || !["account_group", "topic", "semantic"].includes(binding.bindingKind as string)
      || typeof binding.bindingRef !== "string" || !REF.test(binding.bindingRef) || typeof binding.bindingVersion !== "string" || !(binding.bindingVersion as string).trim()
      || typeof binding.bindingHash !== "string" || !HASH.test(binding.bindingHash) || typeof binding.authorityTierRef !== "string" || !REF.test(binding.authorityTierRef)
      || typeof binding.decisionRef !== "string" || !REF.test(binding.decisionRef))) fail("corrupt_store");
    const policyIdentity = new Set(catalog.bindings.map((binding) => `${binding.policyRef}:${binding.policyVersion}:${binding.policyHash}`));
    if (bindings.some((binding) => !policyIdentity.has(`${binding.policyRef}:${binding.policyVersion}:${binding.policyHash}`))
      || new Set(bindings.map((binding) => `${binding.policyRef}:${binding.bindingKind}:${binding.bindingRef}:${binding.bindingVersion}`)).size !== bindings.length
      || !catalog.bindings.every((binding) => bindings.some((rowBinding) => rowBinding.policyRef === binding.policyRef
        && rowBinding.policyVersion === binding.policyVersion && rowBinding.policyHash === binding.policyHash && rowBinding.bindingKind === "semantic"))) fail("corrupt_store");
    const groups = sorted(list(row.account_group_refs).map((value) => { if (typeof value !== "string" || !REF.test(value)) fail("corrupt_store"); return value; }));
    if (JSON.stringify(groups) !== JSON.stringify(scope.accountGroupRefs)) fail("corrupt_store");
    const topics = sorted(bindings.filter((binding) => binding.bindingKind === "topic").map((binding) => binding.bindingRef as string));
    if (JSON.stringify(topics) !== JSON.stringify(scope.topicRefs)) fail("corrupt_store");
    const lockRows = list(row.manual_lock_rows).map((value) => exact(value, ["lockRef", "policyRef", "policyVersion", "policyHash", "operation", "revisionHash", "recordedAt"]));
    const latest = new Map<string, Record<string, unknown>>();
    for (const lock of lockRows) {
      if (typeof lock.lockRef !== "string" || typeof lock.policyRef !== "string" || typeof lock.policyVersion !== "number" || typeof lock.policyHash !== "string"
        || !HASH.test(lock.policyHash) || !["lock", "unlock"].includes(lock.operation as string) || typeof lock.revisionHash !== "string" || !HASH.test(lock.revisionHash)
        || typeof lock.recordedAt !== "string") fail("corrupt_store");
      latest.set(lock.lockRef as string, lock);
    }
    const expected = new Set(manualLocks.map((lock) => `${lock.lockRef}:${lock.policyRef}:${lock.policyVersion}:${lock.policyHash}`));
    const actual = new Set([...latest.values()].filter((lock) => lock.operation === "lock").map((lock) => `${lock.lockRef}:${lock.policyRef}:${lock.policyVersion}:${lock.policyHash}`));
    if (expected.size !== actual.size || [...expected].some((key) => !actual.has(key))) fail("corrupt_store");
  }
}
