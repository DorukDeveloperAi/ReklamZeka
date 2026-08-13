import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  assertValidApprovalPolicyDefinition,
  resolvePublishedApprovalPolicy,
  type ApprovalPolicyApplicability,
  type ApprovalPolicyDefinitionRevision,
  type ResolvedApprovalPolicyDefinition,
} from "@/domain/actions/approval-policy-registry";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type RegistryDatabase = Pick<Database, "execute" | "transaction">;

export class ApprovalPolicyRegistryRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "inactive_workspace"
    | "revision_conflict"
    | "transition_conflict"
    | "not_found"
    | "ambiguous"
    | "corrupt_store") {
    super("Onay politikası kaydı kalıcı depoda güvenli biçimde işlenemedi");
    this.name = "ApprovalPolicyRegistryRepositoryError";
  }
}

export type PersistedApprovalPolicyResolution = Readonly<ResolvedApprovalPolicyDefinition & {
  source: ResolvedApprovalPolicyDefinition["source"] & Readonly<{
    definitionId: string;
    effectiveFrom: string;
    expiresAt: string | null;
  }>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
type Row = Readonly<{
  id: string;
  workspace_ref: string;
  policy_ref: string;
  revision: number;
  previous_hash: string | null;
  state: "draft" | "published" | "disabled";
  policy_hash: string;
  canonical_hash: string;
  artifact_payload: unknown;
}>;

function fail(code: ApprovalPolicyRegistryRepositoryError["code"]): never {
  throw new ApprovalPolicyRegistryRepositoryError(code);
}
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
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

function validateRow(row: Row): ApprovalPolicyDefinitionRevision {
  if (!UUID.test(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 1
    || !["draft", "published", "disabled"].includes(row.state)) fail("corrupt_store");
  let definition: ApprovalPolicyDefinitionRevision;
  try { definition = assertValidApprovalPolicyDefinition(row.artifact_payload); }
  catch { fail("corrupt_store"); }
  if (definition.revision !== row.revision || definition.state !== row.state
    || definition.workspaceRef !== row.workspace_ref || definition.policyRef !== row.policy_ref
    || definition.previousHash !== row.previous_hash
    || definition.policyHash !== row.policy_hash || definition.canonicalHash !== row.canonical_hash) fail("corrupt_store");
  return definition;
}

/** Private registry port only; no approval decision, grant, execution, or Meta transport method exists. */
export class DrizzleApprovalPolicyRegistryRepository {
  private readonly workspaceId: string;
  private readonly workspaceRef: string;

  constructor(private readonly database: RegistryDatabase, workspaceId: string, workspaceRef: string) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) fail("invalid_input");
    this.workspaceId = workspaceId.toLowerCase();
    this.workspaceRef = workspaceRef;
  }

  async append(unsafeDefinition: unknown): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    canonicalHash: string;
  }>> {
    let definition: ApprovalPolicyDefinitionRevision;
    try { definition = assertValidApprovalPolicyDefinition(unsafeDefinition); }
    catch { fail("invalid_input"); }
    if (definition.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch");
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "update");
      const exactRows = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, policy_hash, canonical_hash, artifact_payload
        from approval_policy_definition_revisions
        where workspace_id = ${this.workspaceId}::uuid and policy_ref = ${definition.policyRef}
          and revision = ${definition.revision}
        limit 2
      `));
      if (exactRows.length > 1) fail("corrupt_store");
      if (exactRows[0]) {
        const existing = validateRow(exactRows[0]);
        if (existing.canonicalHash !== definition.canonicalHash || !equal(existing, definition)) fail("revision_conflict");
        return Object.freeze({ outcome: "unchanged" as const, canonicalHash: definition.canonicalHash });
      }
      const latestRows = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, policy_hash, canonical_hash, artifact_payload
        from approval_policy_definition_revisions
        where workspace_id = ${this.workspaceId}::uuid and policy_ref = ${definition.policyRef}
        order by revision desc limit 2 for update
      `));
      if (latestRows.length > 1 && latestRows[0]!.revision === latestRows[1]!.revision) fail("corrupt_store");
      const previous = latestRows[0] ? validateRow(latestRows[0]) : null;
      if (definition.revision !== (previous?.revision ?? 0) + 1) fail("revision_conflict");
      if (definition.previousHash !== (previous?.canonicalHash ?? null)) fail("revision_conflict");
      if (previous === null && definition.state !== "draft"
        || definition.state === "draft" && previous !== null
          && previous.state !== "published" && previous.state !== "disabled"
        || definition.state === "published" && previous?.state !== "draft"
        || definition.state === "disabled" && previous?.state !== "published") {
        fail("transition_conflict");
      }
      const inserted = rows<{ canonical_hash: string }>(await transaction.execute(sql`
        insert into approval_policy_definition_revisions (
          workspace_id, workspace_ref, policy_ref, revision, previous_hash, schema_version, action_type, risk, state,
          effective_from, expires_at, normalized_by_actor_ref, normalized_by_role,
          published_by_actor_ref, published_by_role, publication_decision_ref, publication_reason_ref,
          published_at, disabled_by_actor_ref, disabled_by_role, disable_decision_ref, disable_reason_ref,
          disabled_at, policy_hash, canonical_hash, policy_payload, artifact_payload
        ) values (
          ${this.workspaceId}::uuid, ${definition.workspaceRef}, ${definition.policyRef}, ${definition.revision},
          ${definition.previousHash}, ${definition.version},
          ${definition.applicability.actionType}, ${definition.applicability.risk}, ${definition.state},
          ${definition.effectiveFrom}::timestamptz, ${definition.expiresAt}::timestamptz,
          ${definition.provenance.normalizedByActorRef}, ${definition.provenance.normalizedByRole},
          ${definition.provenance.publishedByActorRef}, ${definition.provenance.publishedByRole},
          ${definition.provenance.publicationDecisionRef}, ${definition.provenance.publicationReasonRef},
          ${definition.provenance.publishedAt}::timestamptz,
          ${definition.provenance.disabledByActorRef}, ${definition.provenance.disabledByRole},
          ${definition.provenance.disableDecisionRef}, ${definition.provenance.disableReasonRef},
          ${definition.provenance.disabledAt}::timestamptz, ${definition.policyHash}, ${definition.canonicalHash},
          ${JSON.stringify(definition.policy)}::jsonb, ${JSON.stringify(definition)}::jsonb
        ) returning canonical_hash
      `));
      if (inserted.length !== 1 || inserted[0]!.canonical_hash !== definition.canonicalHash) fail("corrupt_store");
      return Object.freeze({ outcome: "inserted" as const, canonicalHash: definition.canonicalHash });
    });
  }

  async resolveExistingPostPolicy(evaluatedAt: string): Promise<PersistedApprovalPolicyResolution> {
    return this.resolvePolicy({ actionType: "existing_post_promotion", risk: "K4" }, evaluatedAt);
  }

  /** Resolves one explicit action/risk pair; callers cannot widen a K4 policy to budget actions. */
  async resolvePolicy(
    applicability: ApprovalPolicyApplicability,
    evaluatedAt: string,
  ): Promise<PersistedApprovalPolicyResolution> {
    if (!applicability || typeof applicability !== "object") fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "share");
      const result = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, policy_hash, canonical_hash, artifact_payload
        from approval_policy_definition_revisions
        where workspace_id = ${this.workspaceId}::uuid
          and action_type = ${applicability.actionType} and risk = ${applicability.risk}
        order by policy_ref, revision
        limit 1001
      `));
      if (result.length > 1000) fail("corrupt_store");
      const definitions = result.map(validateRow);
      let resolved: ResolvedApprovalPolicyDefinition;
      try { resolved = resolvePublishedApprovalPolicy({ workspaceRef: this.workspaceRef, evaluatedAt, applicability, definitions }); }
      catch (reason) {
        if (reason && typeof reason === "object" && "code" in reason && reason.code === "not_found") fail("not_found");
        if (reason && typeof reason === "object" && "code" in reason && reason.code === "ambiguous") fail("ambiguous");
        fail("corrupt_store");
      }
      const sourceRow = result.find((row) => row.canonical_hash === resolved.source.canonicalHash
        && row.revision === resolved.source.revision);
      if (!sourceRow || !UUID.test(sourceRow.id)) fail("corrupt_store");
      const sourceDefinition = definitions.find((definition) => definition.canonicalHash === resolved.source.canonicalHash
        && definition.revision === resolved.source.revision);
      if (!sourceDefinition) fail("corrupt_store");
      return Object.freeze({ ...resolved, source: Object.freeze({ ...resolved.source, definitionId: sourceRow.id,
        effectiveFrom: sourceDefinition.effectiveFrom, expiresAt: sourceDefinition.expiresAt }) });
    });
  }

  /** Server-private revision feed. Public services must project hashes and actor refs away. */
  async listArtifacts(): Promise<readonly ApprovalPolicyDefinitionRevision[]> {
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "share");
      const result = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, policy_hash, canonical_hash, artifact_payload
        from approval_policy_definition_revisions
        where workspace_id = ${this.workspaceId}::uuid
          and action_type = 'existing_post_promotion' and risk = 'K4'
        order by policy_ref, revision desc
        limit 1001
      `));
      if (result.length > 1000) fail("corrupt_store");
      const definitions = result.map(validateRow);
      if (definitions.some((definition) => definition.workspaceRef !== this.workspaceRef)) fail("corrupt_store");
      return Object.freeze(definitions);
    });
  }

  async latestArtifact(policyRef: string): Promise<ApprovalPolicyDefinitionRevision | null> {
    if (!REF.test(policyRef)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      await lockWorkspace(transaction, this.workspaceId, "share");
      const result = rows<Row>(await transaction.execute(sql`
        select id, workspace_ref, policy_ref, revision, previous_hash, state, policy_hash, canonical_hash, artifact_payload
        from approval_policy_definition_revisions
        where workspace_id = ${this.workspaceId}::uuid and policy_ref = ${policyRef}
          and action_type = 'existing_post_promotion' and risk = 'K4'
        order by revision desc limit 1
      `));
      if (!result[0]) return null;
      const definition = validateRow(result[0]);
      if (definition.workspaceRef !== this.workspaceRef || definition.policyRef !== policyRef) fail("corrupt_store");
      return definition;
    });
  }
}
