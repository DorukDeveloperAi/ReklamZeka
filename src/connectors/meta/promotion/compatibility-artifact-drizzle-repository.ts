import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  assertValidMetaCompatibilityArtifact,
  resolveMetaCompatibility,
  type MetaCompatibilityArtifact,
  type MetaCompatibilityResolution,
} from "@/domain/meta/promotion/compatibility-artifact";

type Database = NodePgDatabase<typeof schema>;
type RegistryDatabase = Pick<Database, "execute" | "transaction">;

export class MetaCompatibilityArtifactRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "inactive_workspace"
    | "revision_conflict"
    | "transition_conflict"
    | "corrupt_store") {
    super("Meta uyumluluk artifact kaydı güvenli biçimde işlenemedi");
    this.name = "MetaCompatibilityArtifactRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;

type ExistingRow = Readonly<{ revision: number; state: MetaCompatibilityArtifact["state"]; canonical_hash: string; artifact_payload: unknown }>;

function fail(code: MetaCompatibilityArtifactRepositoryError["code"]): never { throw new MetaCompatibilityArtifactRepositoryError(code); }
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(stable(left)) === JSON.stringify(stable(right)); }

async function lockActiveWorkspace(database: Pick<Database, "execute">, workspaceId: string, mode: "share" | "update"): Promise<void> {
  const result = mode === "update" ? await database.execute(sql`
    select id, lifecycle_state from workspaces where id = ${workspaceId}::uuid limit 1 for update
  `) : await database.execute(sql`
    select id, lifecycle_state from workspaces where id = ${workspaceId}::uuid limit 1 for share
  `);
  const found = rows<{ id: string; lifecycle_state: string }>(result);
  if (found.length !== 1) fail("workspace_scope_mismatch");
  if (found[0]!.lifecycle_state !== "active") fail("inactive_workspace");
}

function validateExisting(row: ExistingRow): Readonly<{ row: ExistingRow; artifact: MetaCompatibilityArtifact }> {
  if (!Number.isSafeInteger(row.revision) || row.revision < 1 || !["draft", "reviewed", "published", "tombstoned"].includes(row.state)
    || !HASH.test(row.canonical_hash)) fail("corrupt_store");
  let artifact: MetaCompatibilityArtifact;
  try { artifact = assertValidMetaCompatibilityArtifact(row.artifact_payload); } catch { fail("corrupt_store"); }
  if (artifact.revision !== row.revision || artifact.state !== row.state || artifact.canonicalHash !== row.canonical_hash) fail("corrupt_store");
  return Object.freeze({ row, artifact });
}

function validTransition(previous: MetaCompatibilityArtifact | null, next: MetaCompatibilityArtifact): boolean {
  if (previous === null) return next.revision === 1 && next.state === "draft" && next.previousHash === null;
  const expected = previous.state === "draft" ? "reviewed" : previous.state === "reviewed" ? "published"
    : previous.state === "published" ? "tombstoned" : null;
  return expected === next.state && next.revision === previous.revision + 1 && next.previousHash === previous.canonicalHash
    && next.artifactRef === previous.artifactRef && next.workspaceRef === previous.workspaceRef
    && next.dimension === previous.dimension && equal(next.content, previous.content);
}

/** Server-only append/read port; no Meta transport, policy, approval, or action methods. */
export class DrizzleMetaCompatibilityArtifactRepository {
  private readonly workspaceId: string;
  private readonly workspaceRef: string;

  constructor(private readonly database: RegistryDatabase, workspaceId: string, workspaceRef: string) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) fail("invalid_input");
    this.workspaceId = workspaceId.toLowerCase(); this.workspaceRef = workspaceRef;
  }

  async append(unsafeArtifact: unknown): Promise<Readonly<{ outcome: "inserted" | "unchanged"; canonicalHash: string }>> {
    let artifact: MetaCompatibilityArtifact;
    try { artifact = assertValidMetaCompatibilityArtifact(unsafeArtifact); } catch { fail("invalid_input"); }
    if (artifact.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch");
    return this.database.transaction(async (transaction) => {
      await lockActiveWorkspace(transaction, this.workspaceId, "update");
      const exactRows = rows<ExistingRow>(await transaction.execute(sql`
        select revision, state, canonical_hash, artifact_payload
        from meta_compatibility_artifact_revisions
        where workspace_id = ${this.workspaceId}::uuid and artifact_ref = ${artifact.artifactRef} and revision = ${artifact.revision}
        limit 2
      `));
      if (exactRows.length > 1) fail("corrupt_store");
      if (exactRows[0]) {
        const existing = validateExisting(exactRows[0]).artifact;
        if (existing.canonicalHash !== artifact.canonicalHash || !equal(existing, artifact)) fail("revision_conflict");
        return Object.freeze({ outcome: "unchanged" as const, canonicalHash: artifact.canonicalHash });
      }
      const latestRows = rows<ExistingRow>(await transaction.execute(sql`
        select revision, state, canonical_hash, artifact_payload
        from meta_compatibility_artifact_revisions
        where workspace_id = ${this.workspaceId}::uuid and artifact_ref = ${artifact.artifactRef}
        order by revision desc limit 2 for update
      `));
      if (latestRows.length > 1 && latestRows[0]!.revision === latestRows[1]!.revision) fail("corrupt_store");
      const previous = latestRows[0] ? validateExisting(latestRows[0]).artifact : null;
      if (artifact.revision !== (previous?.revision ?? 0) + 1) fail("revision_conflict");
      if (!validTransition(previous, artifact)) fail("transition_conflict");
      const content = artifact.content;
      const inserted = rows<{ canonical_hash: string }>(await transaction.execute(sql`
        insert into meta_compatibility_artifact_revisions (
          workspace_id, artifact_ref, revision, schema_version, workspace_ref, artifact_kind, dimension, state,
          selection_hash, outcome, previous_hash, reviewed_by_actor_ref, reviewed_by_role, review_decision_ref,
          reviewed_at, review_by, published_by_actor_ref, published_by_role, publication_decision_ref, published_at,
          tombstoned_by_actor_ref, tombstone_decision_ref, tombstoned_at, canonical_hash, artifact_payload
        ) values (
          ${this.workspaceId}::uuid, ${artifact.artifactRef}, ${artifact.revision}, ${artifact.version}, ${artifact.workspaceRef},
          ${content.kind}, ${artifact.dimension}, ${artifact.state},
          ${content.kind === "evidence" ? content.selectionHash : null}, ${content.kind === "evidence" ? content.outcome : null},
          ${artifact.previousHash}, ${artifact.provenance.reviewedByActorRef}, ${artifact.provenance.reviewedByRole},
          ${artifact.provenance.reviewDecisionRef}, ${artifact.provenance.reviewedAt}::timestamptz, ${artifact.provenance.reviewBy}::timestamptz,
          ${artifact.provenance.publishedByActorRef}, ${artifact.provenance.publishedByRole}, ${artifact.provenance.publicationDecisionRef},
          ${artifact.provenance.publishedAt}::timestamptz, ${artifact.provenance.tombstonedByActorRef},
          ${artifact.provenance.tombstoneDecisionRef}, ${artifact.provenance.tombstonedAt}::timestamptz,
          ${artifact.canonicalHash}, ${JSON.stringify(artifact)}::jsonb
        ) returning canonical_hash
      `));
      if (inserted.length !== 1 || inserted[0]!.canonical_hash !== artifact.canonicalHash) fail("corrupt_store");
      return Object.freeze({ outcome: "inserted" as const, canonicalHash: artifact.canonicalHash });
    });
  }

  async resolve(selectionHash: string, evaluatedAt: string): Promise<MetaCompatibilityResolution> {
    if (!HASH.test(selectionHash) || !Number.isFinite(Date.parse(evaluatedAt))) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      await lockActiveWorkspace(transaction, this.workspaceId, "share");
      const found = rows<{ artifact_payload: unknown }>(await transaction.execute(sql`
        select artifact_payload from meta_compatibility_artifact_revisions
        where workspace_id = ${this.workspaceId}::uuid
        order by artifact_ref, revision
        limit 10001
      `));
      if (found.length > 10_000) fail("corrupt_store");
      let artifacts: MetaCompatibilityArtifact[];
      try { artifacts = found.map((row) => assertValidMetaCompatibilityArtifact(row.artifact_payload)); } catch { fail("corrupt_store"); }
      return resolveMetaCompatibility({ workspaceRef: this.workspaceRef, selectionHash, evaluatedAt, artifacts });
    });
  }

  async listArtifacts(): Promise<readonly MetaCompatibilityArtifact[]> {
    return this.database.transaction(async (transaction) => {
      await lockActiveWorkspace(transaction, this.workspaceId, "share");
      const found = rows<{ artifact_payload: unknown }>(await transaction.execute(sql`
        select artifact_payload from meta_compatibility_artifact_revisions
        where workspace_id = ${this.workspaceId}::uuid order by artifact_ref, revision desc limit 1001
      `));
      if (found.length > 1000) fail("corrupt_store");
      try { return Object.freeze(found.map((row) => {
        const artifact = assertValidMetaCompatibilityArtifact(row.artifact_payload);
        if (artifact.workspaceRef !== this.workspaceRef) fail("workspace_scope_mismatch"); return artifact;
      })); } catch (error) { if (error instanceof MetaCompatibilityArtifactRepositoryError) throw error; fail("corrupt_store"); }
    });
  }
}
