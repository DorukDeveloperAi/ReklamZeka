import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const NORMALIZATION_REF = /^normalization_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CAPABILITIES = Object.freeze({ canPublish: false as const, canPromotePolicy: false as const,
  canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });

export class NormalizationWorkbenchError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "needs_input" | "corrupt_store") {
    super(`Normalization workbench rejected: ${code}`); this.name = "NormalizationWorkbenchError";
  }
}
function fail(code: NormalizationWorkbenchError["code"]): never { throw new NormalizationWorkbenchError(code); }
function rows<T extends Row = Row>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown, expression = REF): string {
  if (typeof value !== "string" || !expression.test(value)) fail("invalid_input"); return value;
}
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function text(value: unknown, max = 4_000): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value || /\u0000/.test(value)) fail("invalid_input");
  return value;
}

export type NormalizationWorkbenchSelection = Readonly<{ sourceRef: string; cardRef: string; setRef: string }>;
export type NormalizationWorkbenchQuestion = Readonly<{ questionRef: string; prompt: string; required: boolean }>;
export type NormalizationWorkbenchAnswers = Readonly<{
  normalizedGuidance: Readonly<{ title: string; body: string; topic: string; strength: "must" | "should" | "consider" | "avoid" | "question" }>;
  assumptions: readonly Readonly<{ assumptionRef: string; text: string }>[];
  questions: readonly NormalizationWorkbenchQuestion[];
}>;
export type NormalizationWorkbenchPreview = Readonly<{
  contractVersion: "normalization-workbench/1.0.0";
  disposition: "ready" | "needs_input";
  missing: readonly ("sourceRef" | "cardRef" | "setRef")[];
  selection: Readonly<{ sourceRef: string; sourceVersion: number; sourceHash: string; cardRef: string; cardVersion: number;
    cardHash: string; setRef: string; setVersion: number; setHash: string }> | null;
  selectionHash: string | null;
  capabilities: typeof CAPABILITIES;
}>;
export type NormalizationWorkbenchRevision = Readonly<{
  normalizationRef: string; revision: number; revisionHash: string; selectionHash: string;
  capabilities: typeof CAPABILITIES;
}>;

type ResolvedSelection = Readonly<{ sourceId: string; cardId: string; setId: string; sourceRef: string; sourceVersion: number;
  sourceHash: string; cardRef: string; cardVersion: number; cardHash: string; setRef: string; setVersion: number; setHash: string;
  selectionHash: string }>;

function normalizedAnswers(value: NormalizationWorkbenchAnswers): NormalizationWorkbenchAnswers {
  if (!value || typeof value !== "object" || !value.normalizedGuidance || typeof value.normalizedGuidance !== "object") fail("invalid_input");
  const guidance = value.normalizedGuidance;
  const strength = guidance.strength;
  if (!["must", "should", "consider", "avoid", "question"].includes(strength)) fail("invalid_input");
  const assumptions = value.assumptions;
  const questions = value.questions;
  if (!Array.isArray(assumptions) || assumptions.length > 50 || !Array.isArray(questions) || questions.length > 50) fail("invalid_input");
  const normalizedAssumptions = assumptions.map((item) => ({ assumptionRef: ref(item?.assumptionRef, /^assumption_[a-z0-9][a-z0-9_.:-]{0,126}$/), text: text(item?.text) }))
    .sort((left, right) => left.assumptionRef.localeCompare(right.assumptionRef));
  const normalizedQuestions = questions.map((item) => ({ questionRef: ref(item?.questionRef, /^question_[a-z0-9][a-z0-9_.:-]{0,126}$/),
    prompt: text(item?.prompt), required: item?.required === true }))
    .sort((left, right) => left.questionRef.localeCompare(right.questionRef));
  if (new Set(normalizedAssumptions.map((item) => item.assumptionRef)).size !== normalizedAssumptions.length
    || new Set(normalizedQuestions.map((item) => item.questionRef)).size !== normalizedQuestions.length) fail("invalid_input");
  return Object.freeze({ normalizedGuidance: Object.freeze({ title: text(guidance.title, 240), body: text(guidance.body, 16_000),
    topic: text(guidance.topic, 160), strength }), assumptions: Object.freeze(normalizedAssumptions), questions: Object.freeze(normalizedQuestions) });
}

async function resolveSelection(database: Pick<Database, "execute">, workspaceId: string,
  selection: NormalizationWorkbenchSelection): Promise<ResolvedSelection> {
  const sourceRef = ref(selection.sourceRef); const cardRef = ref(selection.cardRef); const setRef = ref(selection.setRef);
  const sources = rows(await database.execute(sql`select id::text, source_key, version, record_hash, status
    from guidance_sources where workspace_id = ${workspaceId}::uuid and source_key = ${sourceRef}
    order by version desc limit 2 for update`));
  const source = sources[0];
  if (!source || sources.length > 1 && Number(sources[0]!.version) === Number(sources[1]!.version)
    || source.status === "archived" || typeof source.id !== "string" || !UUID.test(source.id)
    || !Number.isSafeInteger(Number(source.version)) || !HASH.test(String(source.record_hash))) fail("needs_input");
  const cards = rows(await database.execute(sql`select id::text, card_key, version, record_hash, status, source_ids
    from guidance_cards where workspace_id = ${workspaceId}::uuid and card_key = ${cardRef}
    order by version desc limit 2 for update`));
  const card = cards[0];
  if (!card || cards.length > 1 && Number(cards[0]!.version) === Number(cards[1]!.version)
    || card.status === "archived" || typeof card.id !== "string" || !UUID.test(card.id)
    || !Number.isSafeInteger(Number(card.version)) || !HASH.test(String(card.record_hash))
    || !Array.isArray(card.source_ids) || !card.source_ids.includes(source.id)) fail("needs_input");
  const sets = rows(await database.execute(sql`select id::text, set_key, version, record_hash, review_status, ordered_card_ids
    from guidance_sets where workspace_id = ${workspaceId}::uuid and set_key = ${setRef}
    order by version desc limit 2 for update`));
  const set = sets[0];
  if (!set || sets.length > 1 && Number(sets[0]!.version) === Number(sets[1]!.version)
    || set.review_status === "archived" || typeof set.id !== "string" || !UUID.test(set.id)
    || !Number.isSafeInteger(Number(set.version)) || !HASH.test(String(set.record_hash))
    || !Array.isArray(set.ordered_card_ids) || !set.ordered_card_ids.includes(card.id)) fail("needs_input");
  const resolved = Object.freeze({ sourceId: source.id, cardId: card.id, setId: set.id, sourceRef,
    sourceVersion: Number(source.version), sourceHash: String(source.record_hash), cardRef,
    cardVersion: Number(card.version), cardHash: String(card.record_hash), setRef,
    setVersion: Number(set.version), setHash: String(set.record_hash) });
  return Object.freeze({ ...resolved, selectionHash: digest(resolved) });
}

/**
 * Private persistence port for the draft-only natural-language workbench.
 * Clients send selected logical refs and structured answers only; raw owner
 * text is resolved inside the transaction and is never copied into a draft.
 */
export class DrizzleNormalizationWorkbenchRepository {
  constructor(private readonly database: Database) {}

  async inspect(workspaceId: string): Promise<readonly NormalizationWorkbenchRevision[]> {
    if (!UUID.test(workspaceId)) fail("invalid_input");
    const persisted = rows(await this.database.execute(sql`select normalization_ref, revision, revision_hash, revision_payload
      from normalization_workbench_revisions where workspace_id = ${workspaceId}::uuid
      order by normalization_ref, revision`));
    return Object.freeze(persisted.map((row) => {
      const payload = row.revision_payload as Record<string, unknown>;
      if (typeof row.normalization_ref !== "string" || !Number.isSafeInteger(Number(row.revision)) || !HASH.test(String(row.revision_hash))
        || !payload || typeof payload !== "object") fail("corrupt_store");
      const selection = payload.source && payload.card && payload.set ? digest({
        sourceRef: (payload.source as Row).ref, sourceVersion: (payload.source as Row).version, sourceHash: (payload.source as Row).recordHash,
        cardRef: (payload.card as Row).ref, cardVersion: (payload.card as Row).version, cardHash: (payload.card as Row).recordHash,
        setRef: (payload.set as Row).ref, setVersion: (payload.set as Row).version, setHash: (payload.set as Row).recordHash,
      }) : null;
      if (selection === null) fail("corrupt_store");
      return Object.freeze({ normalizationRef: row.normalization_ref, revision: Number(row.revision), revisionHash: String(row.revision_hash),
        selectionHash: selection, capabilities: CAPABILITIES });
    }));
  }

  async preview(input: Readonly<{ workspaceId: string; selection: Partial<NormalizationWorkbenchSelection> }>): Promise<NormalizationWorkbenchPreview> {
    if (!input || typeof input !== "object" || !UUID.test(input.workspaceId)
      || !input.selection || typeof input.selection !== "object") fail("invalid_input");
    const missing = (["sourceRef", "cardRef", "setRef"] as const).filter((key) => typeof input.selection[key] !== "string");
    if (missing.length > 0) return Object.freeze({ contractVersion: "normalization-workbench/1.0.0", disposition: "needs_input",
      missing: Object.freeze(missing), selection: null, selectionHash: null, capabilities: CAPABILITIES });
    try {
      const resolved = await this.database.transaction((transaction) => resolveSelection(transaction as unknown as Database, input.workspaceId,
        input.selection as NormalizationWorkbenchSelection));
      return Object.freeze({ contractVersion: "normalization-workbench/1.0.0", disposition: "ready", missing: Object.freeze([]),
        selection: Object.freeze({ sourceRef: resolved.sourceRef, sourceVersion: resolved.sourceVersion, sourceHash: resolved.sourceHash,
          cardRef: resolved.cardRef, cardVersion: resolved.cardVersion, cardHash: resolved.cardHash,
          setRef: resolved.setRef, setVersion: resolved.setVersion, setHash: resolved.setHash }),
        selectionHash: resolved.selectionHash, capabilities: CAPABILITIES });
    } catch (error) {
      if (error instanceof NormalizationWorkbenchError && error.code === "needs_input") return Object.freeze({
        contractVersion: "normalization-workbench/1.0.0", disposition: "needs_input", missing: Object.freeze([]), selection: null,
        selectionHash: null, capabilities: CAPABILITIES });
      throw error;
    }
  }

  async create(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: "owner" | "admin" | "analyst"; occurredAt: string; normalizationRef: string; expectedHeadHash: "GENESIS" | string;
    expectedSelectionHash: string; selection: NormalizationWorkbenchSelection; answers: NormalizationWorkbenchAnswers }>): Promise<NormalizationWorkbenchRevision> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin", "analyst"].includes(input.role)) fail("invalid_input");
    ref(input.workspaceRef); ref(input.actorRef); ref(input.normalizationRef, NORMALIZATION_REF); iso(input.occurredAt);
    if (input.expectedHeadHash !== "GENESIS") hash(input.expectedHeadHash); hash(input.expectedSelectionHash);
    const answers = normalizedAnswers(input.answers);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const memberships = rows(await tx.execute(sql`select role::text from memberships where workspace_id = ${input.workspaceId}::uuid
        and user_id = ${input.actorId}::uuid for update`));
      if (memberships.length !== 1 || memberships[0]!.role !== input.role) fail("forbidden");
      const selected = await resolveSelection(tx, input.workspaceId, input.selection);
      if (selected.selectionHash !== input.expectedSelectionHash) fail("conflict");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`normalization:${input.workspaceId}:${input.normalizationRef}`}, 0))`);
      const heads = rows(await tx.execute(sql`select revision, revision_hash from normalization_workbench_revisions
        where workspace_id = ${input.workspaceId}::uuid and normalization_ref = ${input.normalizationRef}
        order by revision desc limit 1 for update`));
      const head = heads[0]; const revision = head ? Number(head.revision) + 1 : 1;
      const previousRevisionHash = head ? String(head.revision_hash) : "GENESIS";
      if (!Number.isSafeInteger(revision) || revision > 1_000_000 || previousRevisionHash !== input.expectedHeadHash) fail("conflict");
      const core = { schemaVersion: "normalization-workbench/1.0.0", workspaceRef: input.workspaceRef,
        normalizationRef: input.normalizationRef, revision, previousRevisionHash,
        source: { ref: selected.sourceRef, version: selected.sourceVersion, recordHash: selected.sourceHash },
        card: { ref: selected.cardRef, version: selected.cardVersion, recordHash: selected.cardHash },
        set: { ref: selected.setRef, version: selected.setVersion, recordHash: selected.setHash },
        normalizedGuidance: answers.normalizedGuidance, assumptions: answers.assumptions, questions: answers.questions,
        impactSummary: { status: "not_applicable", affectedScopeRefs: [], unresolvedDependencyRefs: [] },
        actor: { ref: input.actorRef, role: input.role }, occurredAt: input.occurredAt, authority: CAPABILITIES };
      const revisionHash = digest(core); const payload = { ...core, revisionHash };
      await tx.execute(sql`insert into normalization_workbench_revisions (workspace_id, source_id, card_id, set_id, workspace_ref,
        normalization_ref, revision, previous_revision_hash, source_key, source_version, source_hash, card_key, card_version,
        card_hash, set_key, set_version, set_hash, actor_ref, actor_role, revision_hash, revision_payload, occurred_at)
        values (${input.workspaceId}::uuid, ${selected.sourceId}::uuid, ${selected.cardId}::uuid, ${selected.setId}::uuid,
          ${input.workspaceRef}, ${input.normalizationRef}, ${revision}, ${previousRevisionHash}, ${selected.sourceRef},
          ${selected.sourceVersion}, ${selected.sourceHash}, ${selected.cardRef}, ${selected.cardVersion}, ${selected.cardHash},
          ${selected.setRef}, ${selected.setVersion}, ${selected.setHash}, ${input.actorRef}, ${input.role}, ${revisionHash},
          ${JSON.stringify(payload)}::jsonb, ${input.occurredAt}::timestamptz)`);
      return Object.freeze({ normalizationRef: input.normalizationRef, revision, revisionHash,
        selectionHash: selected.selectionHash, capabilities: CAPABILITIES });
    });
  }
}
