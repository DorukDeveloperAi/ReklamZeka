import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  ActionGuardrailPolicyError,
  assertValidActionGuardrailPolicyRevision,
  resolveProtection,
  type ActionGuardrailPolicyRevision,
  type ProtectionResolution,
  type ProtectionResolutionInput,
} from "@/domain/actions/action-guardrail-policy";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type RegistryDatabase = Pick<Database, "execute" | "transaction">;
export type PersistedProtectionResolutionInput = Omit<ProtectionResolutionInput, "revisions" | "workspaceRef">;

export class ActionGuardrailPolicyRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "inactive_workspace"
    | "revision_conflict"
    | "transition_conflict"
    | "corrupt_store") {
    super("Aksiyon koruma politikası kalıcı depoda güvenli biçimde işlenemedi");
    this.name = "ActionGuardrailPolicyRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
type Row = Readonly<{
  id: string;
  workspace_ref: string;
  policy_ref: string;
  revision: number;
  previous_hash: string | null;
  state: "draft" | "published" | "disabled";
  canonical_hash: string;
  artifact_payload: unknown;
}>;

function fail(code: ActionGuardrailPolicyRepositoryError["code"]): never {
  throw new ActionGuardrailPolicyRepositoryError(code);
}
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(stable(left)) === JSON.stringify(stable(right)); }

async function lockWorkspace(database: Pick<Database, "execute">, workspaceId: string, mode: "share" | "update") {
  const result = mode === "update" ? await database.execute(sql`
    select id, lifecycle_state from workspaces where id = ${workspaceId}::uuid limit 1 for update
  `) : await database.execute(sql`
    select id, lifecycle_state from workspaces where id = ${workspaceId}::uuid limit 1 for share
  `);
  const found = rows<{ id: string; lifecycle_state: string }>(result);
  if (found.length !== 1) fail("workspace_scope_mismatch");
  if (found[0]!.lifecycle_state !== "active") fail("inactive_workspace");
}

function validateRow(row: Row): ActionGuardrailPolicyRevision {
  if (!UUID.test(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 1
    || !["draft", "published", "disabled"].includes(row.state)) fail("corrupt_store");
  let revision: ActionGuardrailPolicyRevision;
  try { revision = assertValidActionGuardrailPolicyRevision(row.artifact_payload); }
  catch { fail("corrupt_store"); }
  if (revision.workspaceRef !== row.workspace_ref || revision.policyRef !== row.policy_ref
    || revision.revision !== row.revision || revision.previousHash !== row.previous_hash
    || revision.state !== row.state || revision.canonicalHash !== row.canonical_hash) fail("corrupt_store");
  return revision;
}

/** Private registry/resolver port. It exposes no approval, execution, evidence materialization, or Meta transport method. */
export class DrizzleActionGuardrailPolicyRepository {
  private readonly workspaceId: string;
  private readonly workspaceRef: string;

  constructor(private readonly database: RegistryDatabase, workspaceId: string, workspaceRef: string) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) fail("invalid_input");
    this.workspaceId = workspaceId.toLowerCase();
    this.workspaceRef = workspaceRef;
  }

  async append(unsafeRevision: unknown): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    canonicalHash: string;
  }>> {
    let revision: ActionGuardrailPolicyRevision;
    try { revision = assertValidActionGuardrailPolicyRevision(unsafeRevision); }
    catch { fail("invalid_input"); }
    if (revision.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch");
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "update");
      const exact = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, canonical_hash, artifact_payload
        from action_guardrail_policy_revisions
        where workspace_id = ${this.workspaceId}::uuid and policy_ref = ${revision.policyRef}
          and revision = ${revision.revision}
        limit 2
      `));
      if (exact.length > 1) fail("corrupt_store");
      if (exact[0]) {
        const existing = validateRow(exact[0]);
        if (existing.canonicalHash !== revision.canonicalHash || !equal(existing, revision)) fail("revision_conflict");
        return Object.freeze({ outcome: "unchanged" as const, canonicalHash: revision.canonicalHash });
      }
      const latest = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, canonical_hash, artifact_payload
        from action_guardrail_policy_revisions
        where workspace_id = ${this.workspaceId}::uuid and policy_ref = ${revision.policyRef}
        order by revision desc limit 2 for update
      `));
      if (latest.length > 1 && latest[0]!.revision === latest[1]!.revision) fail("corrupt_store");
      const previous = latest[0] ? validateRow(latest[0]) : null;
      if (revision.revision !== (previous?.revision ?? 0) + 1
        || revision.previousHash !== (previous?.canonicalHash ?? null)) fail("revision_conflict");
      if (previous === null && revision.state !== "draft"
        || revision.state === "draft" && previous !== null && !["published", "disabled"].includes(previous.state)
        || revision.state === "published" && previous?.state !== "draft"
        || revision.state === "disabled" && previous?.state !== "published") fail("transition_conflict");
      const inserted = rows<{ canonical_hash: string }>(await transaction.execute(sql`
        insert into action_guardrail_policy_revisions (
          workspace_id, workspace_ref, policy_ref, revision, previous_hash, schema_version, state,
          effective_from, expires_at, default_disposition, action_types, account_refs, campaign_refs,
          entities, internal_category_refs, geo_refs, clauses, normalized_by_actor_ref, normalized_by_role,
          source_guidance_refs, published_by_actor_ref, published_by_role, publication_decision_ref,
          publication_reason_ref, published_at, disabled_by_actor_ref, disabled_by_role, disable_decision_ref,
          disable_reason_ref, disabled_at, canonical_hash, artifact_payload
        ) values (
          ${this.workspaceId}::uuid, ${revision.workspaceRef}, ${revision.policyRef}, ${revision.revision},
          ${revision.previousHash}, ${revision.version}, ${revision.state}, ${revision.effectiveFrom}::timestamptz,
          ${revision.expiresAt}::timestamptz, ${revision.defaultDisposition},
          ${JSON.stringify(revision.selector.actionTypes)}::jsonb, ${JSON.stringify(revision.selector.accountRefs)}::jsonb,
          ${JSON.stringify(revision.selector.campaignRefs)}::jsonb, ${JSON.stringify(revision.selector.entities)}::jsonb,
          ${JSON.stringify(revision.selector.internalCategoryRefs)}::jsonb, ${JSON.stringify(revision.selector.geoRefs)}::jsonb,
          ${JSON.stringify(revision.clauses)}::jsonb, ${revision.provenance.normalizedByActorRef},
          ${revision.provenance.normalizedByRole}, ${JSON.stringify(revision.provenance.sourceGuidanceRefs)}::jsonb,
          ${revision.provenance.publishedByActorRef}, ${revision.provenance.publishedByRole},
          ${revision.provenance.publicationDecisionRef}, ${revision.provenance.publicationReasonRef},
          ${revision.provenance.publishedAt}::timestamptz, ${revision.provenance.disabledByActorRef},
          ${revision.provenance.disabledByRole}, ${revision.provenance.disableDecisionRef},
          ${revision.provenance.disableReasonRef}, ${revision.provenance.disabledAt}::timestamptz,
          ${revision.canonicalHash}, ${JSON.stringify(revision)}::jsonb
        ) returning canonical_hash
      `));
      if (inserted.length !== 1 || inserted[0]!.canonical_hash !== revision.canonicalHash) fail("corrupt_store");
      return Object.freeze({ outcome: "inserted" as const, canonicalHash: revision.canonicalHash });
    });
  }

  async resolve(input: PersistedProtectionResolutionInput): Promise<ProtectionResolution> {
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "share");
      const stored = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, canonical_hash, artifact_payload
        from action_guardrail_policy_revisions
        where workspace_id = ${this.workspaceId}::uuid
        order by policy_ref, revision
        limit 10001
      `));
      if (stored.length > 10_000) fail("corrupt_store");
      const revisions = stored.map(validateRow);
      try { return resolveProtection({ ...input, workspaceRef: this.workspaceRef, revisions }); }
      catch (reason) {
        if (reason instanceof ActionGuardrailPolicyError && reason.code === "invalid_input") fail("invalid_input");
        return fail("corrupt_store");
      }
    });
  }

  /** Server-private revision feed. Public services must omit hashes and provenance actor refs. */
  async listArtifacts(): Promise<readonly ActionGuardrailPolicyRevision[]> {
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "share");
      const stored = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, canonical_hash, artifact_payload
        from action_guardrail_policy_revisions
        where workspace_id = ${this.workspaceId}::uuid
        order by policy_ref, revision desc
        limit 1001
      `));
      if (stored.length > 1000) fail("corrupt_store");
      const revisions = stored.map(validateRow);
      if (revisions.some((revision) => revision.workspaceRef !== this.workspaceRef)) fail("corrupt_store");
      return Object.freeze(revisions);
    });
  }

  async latestArtifact(policyRef: string): Promise<ActionGuardrailPolicyRevision | null> {
    if (!REF.test(policyRef)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "share");
      const stored = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, canonical_hash, artifact_payload
        from action_guardrail_policy_revisions
        where workspace_id = ${this.workspaceId}::uuid and policy_ref = ${policyRef}
        order by revision desc limit 1
      `));
      if (!stored[0]) return null;
      const revision = validateRow(stored[0]);
      if (revision.workspaceRef !== this.workspaceRef || revision.policyRef !== policyRef) fail("corrupt_store");
      return revision;
    });
  }
}
