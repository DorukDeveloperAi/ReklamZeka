import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import { DrizzleTrustedPolicyAuthorityRepository } from "@/connectors/policies/trusted-policy-authority-drizzle-repository";
import { POLICY_AUTHORITY_ORDER, type PolicyAuthorityTier } from "@/domain/policies/policy-precedence-resolver";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const TIER = new Set<string>(POLICY_AUTHORITY_ORDER);

export class CandidatePreviewBindingRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store" | "incomplete_authority") {
    super(`Candidate preview binding rejected: ${code}`); this.name = "CandidatePreviewBindingRepositoryError";
  }
}
function fail(code: CandidatePreviewBindingRepositoryError["code"]): never { throw new CandidatePreviewBindingRepositoryError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) fail("invalid_input"); return value; }
function iso(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input"); return value; }
function textArray(values: readonly string[]) { return values.length === 0 ? sql`array[]::text[]` : sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`; }
function manifest(set: Row, orderedCardRefs: readonly string[], cards: readonly Row[]): string | null {
  if (typeof set.set_key !== "string" || !Number.isSafeInteger(Number(set.version)) || !HASH.test(String(set.record_hash))
    || !Array.isArray(set.ordered_card_ids) || JSON.stringify(set.ordered_card_ids) !== JSON.stringify(orderedCardRefs)) return null;
  const byRef = new Map(cards.map((card) => [String(card.card_key), card]));
  const ordered = orderedCardRefs.map((card) => byRef.get(card));
  if (ordered.some((card, index) => !card || card.card_key !== orderedCardRefs[index] || !Number.isSafeInteger(Number(card.version)) || card.status !== "published" || !HASH.test(String(card.record_hash)))) return null;
  return digest({ set: { ref: set.set_key, version: Number(set.version), recordHash: set.record_hash, orderedCardRefs }, cards: ordered.map((card, index) => ({ ref: orderedCardRefs[index], version: Number(card!.version), recordHash: card!.record_hash, status: "published" })) });
}

export type PrivateCandidatePreviewBindingCommand = Readonly<{
  formalizationRef: string; expectedHeadHash: "GENESIS" | string; expectedG2HeadHash: string;
  guidanceSetRef: string; guidanceSetVersion: number; guidanceSetHash: string;
  policyRef: string; policyVersion: number; policyHash: string; targetAccountRef: string;
  authoritySnapshotRef: string; authoritySnapshotHash: string; authorityTier: PolicyAuthorityTier;
  decision: Readonly<{ decisionKey: string; positionKey: string }>;
}>;

/** Private owner/admin-only writer. Candidate bindings are evidence, never a publish or execution capability. */
export class DrizzleCandidatePreviewBindingRepository {
  constructor(private readonly database: Database,
    private readonly authority: Pick<DrizzleTrustedPolicyAuthorityRepository, "loadInTransaction"> = new DrizzleTrustedPolicyAuthorityRepository(database)) {}

  async bind(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string; role: "owner" | "admin"; occurredAt: string; command: PrivateCandidatePreviewBindingCommand }>) {
    const c = input.command;
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role)
      || !Number.isSafeInteger(c.guidanceSetVersion) || c.guidanceSetVersion < 1 || !Number.isSafeInteger(c.policyVersion) || c.policyVersion < 1
      || !TIER.has(c.authorityTier) || !c.decision || !/^[a-z][a-z0-9_.:-]{1,127}$/.test(c.decision.decisionKey)
      || !/^[a-z][a-z0-9_.:-]{1,127}$/.test(c.decision.positionKey)) fail("invalid_input");
    for (const value of [input.workspaceRef, input.actorRef, c.formalizationRef, c.guidanceSetRef, c.policyRef, c.targetAccountRef, c.authoritySnapshotRef]) ref(value);
    for (const value of [c.expectedG2HeadHash, c.guidanceSetHash, c.policyHash, c.authoritySnapshotHash]) hash(value);
    if (c.expectedHeadHash !== "GENESIS") hash(c.expectedHeadHash); iso(input.occurredAt);

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid for update`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`candidate-preview:${input.workspaceId}:${c.formalizationRef}`}, 0))`);

      const formalizationRows = rows<{ sequence: unknown; to_level: unknown; revision_hash: unknown; revision_payload: unknown }>(await tx.execute(sql`select sequence, to_level, revision_hash, revision_payload from progressive_formalization_revisions where workspace_id = ${input.workspaceId}::uuid and formalization_ref = ${c.formalizationRef} order by sequence for update`));
      if (formalizationRows.length !== 3 || !["G0", "G1", "G2"].every((level, index) => formalizationRows[index]?.sequence === index + 1 && formalizationRows[index]?.to_level === level)) fail(formalizationRows.length === 0 ? "not_found" : "conflict");
      const g2Rows = [formalizationRows[2]!]; const g1Rows = [formalizationRows[1]!];
      if (g2Rows[0]!.revision_hash !== c.expectedG2HeadHash) fail("conflict");
      const g2Payload = g2Rows[0]!.revision_payload as { payload?: { guidanceSetRef?: unknown; reviewedGuidanceHash?: unknown } };
      const g1Payload = g1Rows[0]!.revision_payload as { payload?: { guidanceCardRefs?: unknown } };
      const reviewed = g2Payload?.payload; const scoped = g1Payload?.payload?.guidanceCardRefs;
      if (!reviewed || reviewed.guidanceSetRef !== c.guidanceSetRef || !Array.isArray(scoped) || scoped.some((entry) => typeof entry !== "string")) fail("corrupt_store");
      const setRows = rows<{ id: unknown; set_key: unknown; version: unknown; ordered_card_ids: unknown; record_hash: unknown; review_status: unknown }>(await tx.execute(sql`select id::text, set_key, version, ordered_card_ids, record_hash, review_status from guidance_sets where workspace_id = ${input.workspaceId}::uuid and set_key = ${c.guidanceSetRef} order by version desc limit 2 for update`));
      const set = setRows[0];
      const cards = rows(await tx.execute(sql`select distinct on (card_key) card_key, version, status, record_hash from guidance_cards where workspace_id = ${input.workspaceId}::uuid and card_key = any(${textArray(scoped as readonly string[])}) order by card_key, version desc`));
      if (!set || typeof set.id !== "string" || !UUID.test(set.id) || set.review_status !== "reviewed" || Number(set.version) !== c.guidanceSetVersion || set.record_hash !== c.guidanceSetHash || reviewed.reviewedGuidanceHash !== manifest(set, scoped as readonly string[], cards)) fail("conflict");

      const policyRows = rows<{ id: unknown; workspace_ref: unknown; policy_version: unknown; canonical_hash: unknown; status: unknown }>(await tx.execute(sql`select id::text, workspace_ref, policy_version, canonical_hash, status from strict_instruction_policy_revisions where workspace_id = ${input.workspaceId}::uuid and policy_ref = ${c.policyRef} and policy_version = ${c.policyVersion} limit 2 for update`));
      if (policyRows.length !== 1 || typeof policyRows[0]!.id !== "string" || !UUID.test(policyRows[0]!.id) || policyRows[0]!.workspace_ref !== input.workspaceRef || policyRows[0]!.canonical_hash !== c.policyHash || policyRows[0]!.status !== "draft") fail(policyRows.length === 0 ? "not_found" : "conflict");
      const accountRows = rows<{ id: unknown; external_account_id: unknown }>(await tx.execute(sql`select id::text, external_account_id from ad_accounts where workspace_id = ${input.workspaceId}::uuid and external_account_id = ${c.targetAccountRef} and disappeared_at is null limit 2 for update`));
      if (accountRows.length !== 1 || typeof accountRows[0]!.id !== "string" || !UUID.test(accountRows[0]!.id)) fail(accountRows.length === 0 ? "not_found" : "corrupt_store");
      try { await this.authority.loadInTransaction(tx, { workspaceId: input.workspaceId, accountRef: c.targetAccountRef,
        evaluatedAt: input.occurredAt, snapshotRef: c.authoritySnapshotRef, snapshotHash: c.authoritySnapshotHash }); }
      catch { fail("incomplete_authority"); }
      const authorityRows = rows<{ id: unknown; snapshot_ref: unknown; snapshot_hash: unknown }>(await tx.execute(sql`select id::text, snapshot_ref, snapshot_hash from tenant_authority_snapshots where workspace_id = ${input.workspaceId}::uuid and snapshot_ref = ${c.authoritySnapshotRef} and snapshot_hash = ${c.authoritySnapshotHash} limit 2 for share`));
      if (authorityRows.length !== 1 || typeof authorityRows[0]!.id !== "string" || !UUID.test(authorityRows[0]!.id)) fail(authorityRows.length === 0 ? "incomplete_authority" : "corrupt_store");

      const headRows = rows<{ current_revision_id: unknown; current_revision: unknown; current_revision_hash: unknown }>(await tx.execute(sql`select current_revision_id::text, current_revision, current_revision_hash from candidate_preview_binding_heads where workspace_id = ${input.workspaceId}::uuid and formalization_ref = ${c.formalizationRef} limit 2 for update`));
      if (headRows.length > 1) fail("corrupt_store"); const head = headRows[0]; const previousHash = head ? String(head.current_revision_hash) : "GENESIS";
      if (previousHash !== c.expectedHeadHash) {
        const replay = rows<{ payload: unknown }>(await tx.execute(sql`select payload from candidate_preview_binding_revisions where workspace_id = ${input.workspaceId}::uuid and formalization_ref = ${c.formalizationRef} and revision_hash = ${previousHash} limit 2 for share`));
        const p = replay[0]?.payload as Record<string, unknown> | undefined;
        const guidance = p?.guidanceSet as Record<string, unknown> | undefined; const policy = p?.policy as Record<string, unknown> | undefined;
        const targetAccount = p?.targetAccount as Record<string, unknown> | undefined; const snapshot = p?.authoritySnapshot as Record<string, unknown> | undefined;
        const decision = p?.decision as Record<string, unknown> | undefined;
        if (replay.length === 1 && p?.formalizationRef === c.formalizationRef && p.g2RevisionHash === c.expectedG2HeadHash
          && guidance?.ref === c.guidanceSetRef && guidance.version === c.guidanceSetVersion && guidance.hash === c.guidanceSetHash
          && policy?.ref === c.policyRef && policy.version === c.policyVersion && policy.hash === c.policyHash
          && targetAccount?.ref === c.targetAccountRef && snapshot?.ref === c.authoritySnapshotRef && snapshot?.hash === c.authoritySnapshotHash
          && p.authorityTier === c.authorityTier && decision?.decisionKey === c.decision.decisionKey && decision.positionKey === c.decision.positionKey
          && (p.actor as Record<string, unknown> | undefined)?.ref === input.actorRef && (p.actor as Record<string, unknown> | undefined)?.role === input.role && p.recordedAt === input.occurredAt) return Object.freeze({ formalizationRef: c.formalizationRef, revision: Number(head!.current_revision), revisionHash: previousHash, replayed: true as const, authority: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
        fail("conflict");
      }
      const revision = head ? Number(head.current_revision) + 1 : 1; if (!Number.isSafeInteger(revision) || revision < 1) fail("corrupt_store");
      const core = Object.freeze({ schemaVersion: "candidate-preview-binding/1.0.0", formalizationRef: c.formalizationRef, revision, previousRevisionHash: previousHash, g2RevisionHash: c.expectedG2HeadHash, guidanceSet: { ref: c.guidanceSetRef, version: c.guidanceSetVersion, hash: c.guidanceSetHash }, policy: { ref: c.policyRef, version: c.policyVersion, hash: c.policyHash }, targetAccount: { ref: c.targetAccountRef }, authoritySnapshot: { ref: c.authoritySnapshotRef, hash: c.authoritySnapshotHash }, authorityTier: c.authorityTier, decision: c.decision, actor: { ref: input.actorRef, role: input.role }, recordedAt: input.occurredAt, authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canSchedule: false, canCallTool: false, canAccessNetwork: false, canQuerySql: false } });
      const revisionHash = digest(core); const payload = Object.freeze({ ...core, revisionHash }); const revisionId = randomUUID();
      await tx.execute(sql`insert into candidate_preview_binding_revisions (id, workspace_id, formalization_ref, revision, previous_revision_hash, revision_hash, g2_revision_hash, guidance_set_id, guidance_set_ref, guidance_set_version, guidance_set_hash, policy_revision_id, policy_ref, policy_version, policy_hash, target_account_id, target_account_ref, authority_snapshot_id, authority_snapshot_ref, authority_snapshot_hash, authority_tier, decision, actor_ref, actor_role, payload, recorded_at) values (${revisionId}::uuid, ${input.workspaceId}::uuid, ${c.formalizationRef}, ${revision}, ${previousHash}, ${revisionHash}, ${c.expectedG2HeadHash}, ${set.id}::uuid, ${c.guidanceSetRef}, ${c.guidanceSetVersion}, ${c.guidanceSetHash}, ${policyRows[0]!.id}::uuid, ${c.policyRef}, ${c.policyVersion}, ${c.policyHash}, ${accountRows[0]!.id}::uuid, ${c.targetAccountRef}, ${authorityRows[0]!.id}::uuid, ${c.authoritySnapshotRef}, ${c.authoritySnapshotHash}, ${c.authorityTier}, ${JSON.stringify(c.decision)}::jsonb, ${input.actorRef}, ${input.role}, ${JSON.stringify(payload)}::jsonb, ${input.occurredAt}::timestamptz)`);
      if (!head) await tx.execute(sql`insert into candidate_preview_binding_heads (workspace_id, formalization_ref, current_revision_id, current_revision, current_revision_hash, updated_at) values (${input.workspaceId}::uuid, ${c.formalizationRef}, ${revisionId}::uuid, ${revision}, ${revisionHash}, ${input.occurredAt}::timestamptz)`);
      else {
        const advanced = rows(await tx.execute(sql`update candidate_preview_binding_heads set current_revision_id = ${revisionId}::uuid, current_revision = ${revision}, current_revision_hash = ${revisionHash}, updated_at = ${input.occurredAt}::timestamptz where workspace_id = ${input.workspaceId}::uuid and formalization_ref = ${c.formalizationRef} and current_revision = ${Number(head.current_revision)} and current_revision_hash = ${previousHash} returning current_revision_id`));
        if (advanced.length !== 1) fail("conflict");
        const invalidationCore = Object.freeze({ version: "candidate-preview-binding-invalidation/1.0.0", bindingRevisionHash: previousHash, invalidatedByRevisionHash: revisionHash, observedAt: input.occurredAt });
        await tx.execute(sql`insert into candidate_preview_binding_invalidations (id, workspace_id, binding_revision_id, binding_revision_hash, invalidated_by_revision_id, invalidation_hash, observed_at) values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${String(head.current_revision_id)}::uuid, ${previousHash}, ${revisionId}::uuid, ${digest(invalidationCore)}, ${input.occurredAt}::timestamptz)`);
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const audit = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId, action: "candidate_preview_binding.bound", resourceType: "candidate_preview_binding", resourceId: c.formalizationRef, metadata: { revision, revisionHash, g2RevisionHash: c.expectedG2HeadHash, policyRef: c.policyRef, policyVersion: c.policyVersion, policyHash: c.policyHash, targetAccountRef: c.targetAccountRef, authoritySnapshotRef: c.authoritySnapshotRef, authoritySnapshotHash: c.authoritySnapshotHash, authorityTier: c.authorityTier, decision: c.decision, authorityGranted: false }, previousHash: previousAuditHash, occurredAt: input.occurredAt });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at) values (${audit.id}::uuid, ${audit.workspaceId}::uuid, ${audit.actorId}::uuid, ${audit.action}, ${audit.resourceType}, ${audit.resourceId}, ${JSON.stringify(audit.metadata)}::jsonb, ${audit.previousHash}, ${digest(audit)}, ${audit.occurredAt}::timestamptz)`);
      return Object.freeze({ formalizationRef: c.formalizationRef, revision, revisionHash, replayed: false as const, authority: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
    });
  }
}
