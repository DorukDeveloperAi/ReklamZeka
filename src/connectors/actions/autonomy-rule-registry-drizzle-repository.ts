import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  assertValidAutonomyRuleArtifact,
  resolveAutonomyRules,
  type AutonomyRuleArtifact,
} from "@/domain/actions/autonomy-rule-registry";
import type { AutonomyRule } from "@/domain/actions/autonomy-valve";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type RegistryDatabase = Pick<Database, "execute" | "transaction">;

export class AutonomyRuleRegistryRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "scope_unavailable"
    | "inactive_workspace"
    | "revision_conflict"
    | "transition_conflict"
    | "corrupt_store") {
    super("Otonomi kural kaydı kalıcı depoda güvenli biçimde işlenemedi");
    this.name = "AutonomyRuleRegistryRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

type ExistingRow = Readonly<{
  revision: number;
  state: "draft" | "published" | "disabled";
  canonical_hash: string;
  artifact_payload: unknown;
}>;

function fail(code: AutonomyRuleRegistryRepositoryError["code"]): never {
  throw new AutonomyRuleRegistryRepositoryError(code);
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

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function scopeColumns(scope: AutonomyRuleArtifact["scope"]): Readonly<{
  scopeRef: string | null;
  entityLevel: string | null;
  actionType: string | null;
}> {
  if (scope.level === "action_type") return Object.freeze({ scopeRef: null, entityLevel: null, actionType: scope.actionType });
  if (scope.level === "entity") return Object.freeze({ scopeRef: scope.ref, entityLevel: scope.entityLevel, actionType: null });
  return Object.freeze({ scopeRef: scope.ref, entityLevel: null, actionType: null });
}

async function lockActiveWorkspace(
  database: Pick<Database, "execute">,
  workspaceId: string,
  mode: "share" | "update",
): Promise<void> {
  const result = mode === "update"
    ? await database.execute(sql`
      select id, lifecycle_state from workspaces
      where id = ${workspaceId}::uuid
      limit 1 for update
    `)
    : await database.execute(sql`
      select id, lifecycle_state from workspaces
      where id = ${workspaceId}::uuid
      limit 1 for share
    `);
  const found = rows<{ id: string; lifecycle_state: string }>(result);
  if (found.length !== 1) fail("workspace_scope_mismatch");
  if (found[0]!.lifecycle_state !== "active") fail("inactive_workspace");
}

function validateExisting(row: ExistingRow): ExistingRow {
  if (!Number.isSafeInteger(row.revision) || row.revision < 1
    || !["draft", "published", "disabled"].includes(row.state)
    || typeof row.canonical_hash !== "string") fail("corrupt_store");
  const artifact = assertValidAutonomyRuleArtifact(row.artifact_payload);
  if (artifact.revision !== row.revision || artifact.state !== row.state || artifact.canonicalHash !== row.canonical_hash) {
    fail("corrupt_store");
  }
  return row;
}

/**
 * A group-scoped draft must bind to the tenant's current active group head.
 * The persisted ref stays opaque, but it can no longer be an arbitrary string
 * that happens to satisfy the public-reference grammar.
 */
async function assertCurrentAccountGroupScope(
  database: Pick<Database, "execute">,
  workspaceId: string,
  scope: AutonomyRuleArtifact["scope"],
): Promise<void> {
  if (scope.level !== "account_group") return;
  const result = rows<{ id: string }>(await database.execute(sql`
    select group_head.id
    from account_groups group_head
    join account_group_revisions revision
      on revision.workspace_id = group_head.workspace_id
      and revision.account_group_id = group_head.id
      and revision.revision = group_head.current_revision
      and revision.revision_hash = group_head.current_revision_hash
      and revision.status = 'active'
    where group_head.workspace_id = ${workspaceId}::uuid
      and group_head.group_ref = ${scope.ref}
    limit 2 for share
  `));
  if (result.length !== 1 || typeof result[0]!.id !== "string" || !UUID.test(result[0]!.id)) fail("scope_unavailable");
}

/** Server-only append and resolve port. It has no guidance promotion, approval, execution, or Meta methods. */
export class DrizzleAutonomyRuleRegistryRepository {
  private readonly workspaceId: string;
  private readonly workspaceRef: string;

  constructor(private readonly database: RegistryDatabase, workspaceId: string, workspaceRef: string) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) fail("invalid_input");
    this.workspaceId = workspaceId.toLowerCase();
    this.workspaceRef = workspaceRef;
  }

  async append(unsafeArtifact: unknown): Promise<Readonly<{ outcome: "inserted" | "unchanged"; canonicalHash: string }>> {
    let artifact: AutonomyRuleArtifact;
    try {
      artifact = assertValidAutonomyRuleArtifact(unsafeArtifact);
    } catch {
      fail("invalid_input");
    }
    if (artifact.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch");
    const scope = scopeColumns(artifact.scope);
    return this.database.transaction(async (transaction) => {
      // Serializes every revision allocation for this low-volume tenant registry.
      await lockActiveWorkspace(transaction, this.workspaceId, "update");
      await assertCurrentAccountGroupScope(transaction, this.workspaceId, artifact.scope);
      const exactRows = rows<ExistingRow>(await transaction.execute(sql`
        select revision, state, canonical_hash, artifact_payload
        from autonomy_rule_revisions
        where workspace_id = ${this.workspaceId}::uuid and rule_ref = ${artifact.ruleRef}
          and revision = ${artifact.revision}
        limit 2
      `));
      if (exactRows.length > 1) fail("corrupt_store");
      if (exactRows[0]) {
        const existing = validateExisting(exactRows[0]);
        if (existing.canonical_hash !== artifact.canonicalHash || !equal(existing.artifact_payload, artifact)) {
          fail("revision_conflict");
        }
        return Object.freeze({ outcome: "unchanged" as const, canonicalHash: artifact.canonicalHash });
      }

      const latestRows = rows<ExistingRow>(await transaction.execute(sql`
        select revision, state, canonical_hash, artifact_payload
        from autonomy_rule_revisions
        where workspace_id = ${this.workspaceId}::uuid and rule_ref = ${artifact.ruleRef}
        order by revision desc
        limit 2
        for update
      `));
      if (latestRows.length > 1 && latestRows[0]!.revision === latestRows[1]!.revision) fail("corrupt_store");
      const previous = latestRows[0] ? validateExisting(latestRows[0]) : null;
      if (artifact.revision !== (previous?.revision ?? 0) + 1) fail("revision_conflict");
      if (previous === null && artifact.state !== "draft"
        || artifact.state === "published" && previous?.state !== "draft"
        || artifact.state === "disabled" && previous?.state !== "published" && previous?.state !== "disabled") {
        fail("transition_conflict");
      }

      const inserted = rows<{ canonical_hash: string }>(await transaction.execute(sql`
        insert into autonomy_rule_revisions (
          workspace_id, rule_ref, revision, schema_version, workspace_ref,
          scope_level, scope_ref, entity_level, action_type, mode, state,
          effective_from, expires_at, kill_switch, maximum_actions_per_run,
          normalized_by_actor_ref, normalized_by_role, source_guidance_refs,
          published_by_actor_ref, published_by_role, publication_decision_ref,
          publication_reason_ref, published_at, canonical_hash, artifact_payload
        ) values (
          ${this.workspaceId}::uuid, ${artifact.ruleRef}, ${artifact.revision}, ${artifact.version}, ${artifact.workspaceRef},
          ${artifact.scope.level}, ${scope.scopeRef}, ${scope.entityLevel}, ${scope.actionType}, ${artifact.mode}, ${artifact.state},
          ${artifact.effectiveFrom}::timestamptz, ${artifact.expiresAt}::timestamptz, ${artifact.killSwitch}, ${artifact.maximumActionsPerRun},
          ${artifact.provenance.normalizedByActorRef}, ${artifact.provenance.normalizedByRole}, ${JSON.stringify(artifact.provenance.sourceGuidanceRefs)}::jsonb,
          ${artifact.provenance.publishedByActorRef}, ${artifact.provenance.publishedByRole}, ${artifact.provenance.publicationDecisionRef},
          ${artifact.provenance.publicationReasonRef}, ${artifact.provenance.publishedAt}::timestamptz,
          ${artifact.canonicalHash}, ${JSON.stringify(artifact)}::jsonb
        )
        returning canonical_hash
      `));
      if (inserted.length !== 1 || inserted[0]!.canonical_hash !== artifact.canonicalHash) fail("corrupt_store");
      return Object.freeze({ outcome: "inserted" as const, canonicalHash: artifact.canonicalHash });
    });
  }

  async resolve(): Promise<readonly AutonomyRule[]> {
    return this.database.transaction(async (transaction) => {
      await lockActiveWorkspace(transaction, this.workspaceId, "share");
      const result = rows<{ artifact_payload: unknown }>(await transaction.execute(sql`
        select artifact_payload
        from autonomy_rule_revisions
        where workspace_id = ${this.workspaceId}::uuid and state in ('published', 'disabled')
        order by rule_ref, revision
        limit 10001
      `));
      if (result.length > 10_000) fail("corrupt_store");
      let artifacts: AutonomyRuleArtifact[];
      try {
        artifacts = result.map((row) => assertValidAutonomyRuleArtifact(row.artifact_payload));
      } catch {
        fail("corrupt_store");
      }
      return resolveAutonomyRules({ workspaceRef: this.workspaceRef, artifacts });
    });
  }

  /** Server-private revision feed. Callers must project before crossing an HTTP boundary. */
  async listArtifacts(): Promise<readonly AutonomyRuleArtifact[]> {
    return this.database.transaction(async (transaction) => {
      await lockActiveWorkspace(transaction, this.workspaceId, "share");
      const result = rows<{ artifact_payload: unknown }>(await transaction.execute(sql`
        select artifact_payload from autonomy_rule_revisions
        where workspace_id = ${this.workspaceId}::uuid
        order by rule_ref, revision desc
        limit 1001
      `));
      if (result.length > 1000) fail("corrupt_store");
      try {
        return Object.freeze(result.map((row) => {
          const artifact = assertValidAutonomyRuleArtifact(row.artifact_payload);
          if (artifact.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch");
          return artifact;
        }));
      } catch (reason) {
        if (reason instanceof AutonomyRuleRegistryRepositoryError) throw reason;
        fail("corrupt_store");
      }
    });
  }

  async latestArtifact(ruleRef: string): Promise<AutonomyRuleArtifact | null> {
    if (!REF.test(ruleRef)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      await lockActiveWorkspace(transaction, this.workspaceId, "share");
      const result = rows<{ artifact_payload: unknown }>(await transaction.execute(sql`
        select artifact_payload from autonomy_rule_revisions
        where workspace_id = ${this.workspaceId}::uuid and rule_ref = ${ruleRef}
        order by revision desc limit 1
      `));
      if (!result[0]) return null;
      try {
        const artifact = assertValidAutonomyRuleArtifact(result[0].artifact_payload);
        if (artifact.workspaceRef !== this.workspaceRef || artifact.ruleRef !== ruleRef) fail("workspace_scope_mismatch");
        return artifact;
      } catch (reason) {
        if (reason instanceof AutonomyRuleRegistryRepositoryError) throw reason;
        fail("corrupt_store");
      }
    });
  }
}
