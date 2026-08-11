import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  createGuidanceRegistry,
  type GuidanceRegistry,
  type GuidanceBinding,
  type GuidanceCard,
  type GuidanceSet,
  type GuidanceSource,
} from "@/domain/guidance/registry";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export class CurrentReviewedGuidanceReaderError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "ambiguous" | "future" | "stale" | "corrupt_store") {
    super(`Current reviewed guidance rejected: ${code}`);
    this.name = "CurrentReviewedGuidanceReaderError";
  }
}

function fail(code: CurrentReviewedGuidanceReaderError["code"]): never {
  throw new CurrentReviewedGuidanceReaderError(code);
}

function rows(value: unknown): readonly Row[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly Row[];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("corrupt_store");
  }
  return value;
}

function nullableIso(value: unknown): string | null {
  return value === null ? null : iso(value);
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail("corrupt_store");
  return value;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail("corrupt_store");
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail("corrupt_store");
  return value;
}

function beforeSnapshot(value: string | null, capturedAt: string): void {
  if (value !== null && Date.parse(value) > Date.parse(capturedAt)) fail("future");
}

function exactKeys(row: Row, expected: readonly string[]): void {
  if (Object.keys(row).length !== expected.length || expected.some((key) => !(key in row))) fail("corrupt_store");
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) fail("corrupt_store");
  return Object.freeze([...value]);
}

type CurrentSource = GuidanceSource & Readonly<{ recordHash: string; createdAt: string; publishedAt: string | null; archivedAt: string | null }>;
type CurrentCard = GuidanceCard & Readonly<{ recordHash: string; createdAt: string; publishedAt: string | null; archivedAt: string | null }>;
type CurrentBinding = GuidanceBinding & Readonly<{ recordHash: string; createdAt: string }>;
type CurrentSet = GuidanceSet & Readonly<{ recordHash: string; createdAt: string; reviewedAt: string | null; archivedAt: string | null }>;

function source(row: Row, workspaceId: string, capturedAt: string): CurrentSource {
  exactKeys(row, ["workspace_id", "source_key", "version", "source_type", "title", "source_ref", "source_url", "content", "author",
    "captured_at", "reviewed_at", "review_by", "status", "published_at", "archived_at", "record_hash", "created_at"]);
  if (row.workspace_id !== workspaceId) fail("corrupt_store");
  const value = Object.freeze({ id: text(row.source_key), workspaceId, sourceType: text(row.source_type) as GuidanceSource["sourceType"],
    title: text(row.title), sourceRef: text(row.source_ref), sourceUrl: row.source_url === null ? null : text(row.source_url), content: text(row.content),
    author: row.author === null ? null : text(row.author), capturedAt: nullableIso(row.captured_at), reviewedAt: nullableIso(row.reviewed_at),
    reviewBy: nullableIso(row.review_by), status: text(row.status) as GuidanceSource["status"], version: positive(row.version) });
  const current = Object.freeze({ ...value, recordHash: hash(row.record_hash), createdAt: iso(row.created_at),
    publishedAt: nullableIso(row.published_at), archivedAt: nullableIso(row.archived_at) });
  for (const timestamp of [current.capturedAt, current.reviewedAt, current.reviewBy, current.publishedAt, current.archivedAt, current.createdAt]) {
    beforeSnapshot(timestamp, capturedAt);
  }
  if ((current.status === "draft" && (current.publishedAt !== null || current.archivedAt !== null))
    || (current.status === "published" && (current.publishedAt === null || current.archivedAt !== null))
    || (current.status === "archived" && current.archivedAt === null)) fail("corrupt_store");
  if (digest(value) !== current.recordHash) fail("corrupt_store");
  return current;
}

function card(row: Row, workspaceId: string, capturedAt: string): CurrentCard {
  exactKeys(row, ["workspace_id", "card_key", "version", "source_type", "source_ids", "title", "body", "rationale", "strength", "topic",
    "decision_key", "position_key", "authority", "status", "effective_from", "effective_to", "owner_ref", "published_at", "archived_at", "record_hash", "created_at"]);
  if (row.workspace_id !== workspaceId) fail("corrupt_store");
  const value = Object.freeze({ id: text(row.card_key), workspaceId, sourceType: text(row.source_type) as GuidanceCard["sourceType"],
    sourceIds: stringArray(row.source_ids), title: text(row.title), body: text(row.body), rationale: row.rationale === null ? null : text(row.rationale),
    strength: text(row.strength) as GuidanceCard["strength"], topic: text(row.topic), decisionKey: row.decision_key === null ? null : text(row.decision_key),
    positionKey: row.position_key === null ? null : text(row.position_key), authority: text(row.authority) as "guidance_only",
    status: text(row.status) as GuidanceCard["status"], effectiveFrom: nullableIso(row.effective_from), effectiveTo: nullableIso(row.effective_to),
    ownerRef: text(row.owner_ref), version: positive(row.version) });
  const current = Object.freeze({ ...value, recordHash: hash(row.record_hash), createdAt: iso(row.created_at),
    publishedAt: nullableIso(row.published_at), archivedAt: nullableIso(row.archived_at) });
  for (const timestamp of [current.effectiveFrom, current.effectiveTo, current.publishedAt, current.archivedAt, current.createdAt]) {
    beforeSnapshot(timestamp, capturedAt);
  }
  if ((current.status === "draft" && (current.publishedAt !== null || current.archivedAt !== null))
    || (current.status === "published" && (current.publishedAt === null || current.archivedAt !== null))
    || (current.status === "archived" && current.archivedAt === null)) fail("corrupt_store");
  if (digest(value) !== current.recordHash) fail("corrupt_store");
  return current;
}

function binding(row: Row, workspaceId: string, capturedAt: string): CurrentBinding {
  exactKeys(row, ["workspace_id", "binding_key", "version", "card_key", "facet", "value", "entity_type", "mode", "priority", "record_hash", "created_at"]);
  if (row.workspace_id !== workspaceId || typeof row.priority !== "number" || !Number.isSafeInteger(row.priority)) fail("corrupt_store");
  const value = Object.freeze({ id: text(row.binding_key), workspaceId, cardId: text(row.card_key), facet: text(row.facet) as GuidanceBinding["facet"],
    value: row.value === null ? null : text(row.value), entityType: row.entity_type === null ? null : text(row.entity_type) as GuidanceBinding["entityType"],
    mode: text(row.mode) as GuidanceBinding["mode"], priority: row.priority, version: positive(row.version) });
  const current = Object.freeze({ ...value, recordHash: hash(row.record_hash), createdAt: iso(row.created_at) });
  beforeSnapshot(current.createdAt, capturedAt);
  if (digest(value) !== current.recordHash) fail("corrupt_store");
  return current;
}

function set(row: Row, workspaceId: string, capturedAt: string): CurrentSet {
  exactKeys(row, ["workspace_id", "set_key", "version", "name", "ordered_card_ids", "review_status", "reviewed_at", "archived_at", "record_hash", "created_at"]);
  if (row.workspace_id !== workspaceId) fail("corrupt_store");
  const value = Object.freeze({ id: text(row.set_key), workspaceId, name: text(row.name), orderedCardIds: stringArray(row.ordered_card_ids),
    reviewStatus: text(row.review_status) as GuidanceSet["reviewStatus"], version: positive(row.version) });
  const current = Object.freeze({ ...value, recordHash: hash(row.record_hash), createdAt: iso(row.created_at),
    reviewedAt: nullableIso(row.reviewed_at), archivedAt: nullableIso(row.archived_at) });
  for (const timestamp of [current.reviewedAt, current.archivedAt, current.createdAt]) beforeSnapshot(timestamp, capturedAt);
  if ((current.reviewStatus === "draft" && (current.reviewedAt !== null || current.archivedAt !== null))
    || (current.reviewStatus === "reviewed" && (current.reviewedAt === null || current.archivedAt !== null))
    || (current.reviewStatus === "archived" && current.archivedAt === null)) fail("corrupt_store");
  if (digest(value) !== current.recordHash) fail("corrupt_store");
  return current;
}

export type CurrentReviewedGuidanceManifest = Readonly<{
  capturedAt: string;
  registryHash: string;
  /**
   * The complete registry reconstructed from hash-validated current rows.
   * This stays server-private: callers must still make their own explicit
   * set/topic/scope choice rather than treating a registry as a selection.
   */
  registry: GuidanceRegistry;
  reviewedSets: readonly Readonly<{
    setRef: string;
    setVersion: number;
    setHash: string;
    cards: readonly Readonly<{
      cardRef: string;
      cardVersion: number;
      cardHash: string;
      sources: readonly Readonly<{ sourceKey: string; sourceRef: string; sourceVersion: number; sourceHash: string }>[];
    }>[];
  }>[];
}>;

/**
 * Validates the complete current Guidance registry in a caller-owned read-only
 * snapshot. It deliberately makes no topic, scope, budget or set-selection
 * decision; it only returns exact immutable provenance for reviewed sets.
 */
export class CurrentReviewedGuidanceReader {
  async readCurrentInTransaction(transaction: Database, workspaceId: string, capturedAt: string): Promise<CurrentReviewedGuidanceManifest> {
    if (!UUID.test(workspaceId) || !Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt) {
      fail("invalid_input");
    }
    const scope = rows(await transaction.execute(sql`
      select workspace.id::text as workspace_id,
        to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as database_now
      from workspaces workspace
      where workspace.id = ${workspaceId}::uuid and workspace.lifecycle_state = 'active'
      limit 2
    `));
    if (scope.length === 0) fail("not_found");
    if (scope.length !== 1 || scope[0]!.workspace_id !== workspaceId || iso(scope[0]!.database_now) !== capturedAt) fail("ambiguous");
    // A transaction is a single PostgreSQL session: issue these bounded reads
    // sequentially rather than overlapping client queries on the same handle.
    const sourceRows = await transaction.execute(sql`select distinct on (source_key) workspace_id::text as workspace_id, source_key, version, source_type, title, source_ref,
        source_url, content, author, to_char(captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as captured_at,
        to_char(reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as reviewed_at,
        to_char(review_by at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as review_by, status,
        to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as published_at,
        to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as archived_at, record_hash,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        from guidance_sources where workspace_id = ${workspaceId}::uuid order by source_key, version desc`);
    const cardRows = await transaction.execute(sql`select distinct on (card_key) workspace_id::text as workspace_id, card_key, version, source_type, source_ids, title, body,
        rationale, strength, topic, decision_key, position_key, authority, status,
        to_char(effective_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as effective_from,
        to_char(effective_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as effective_to, owner_ref,
        to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as published_at,
        to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as archived_at, record_hash,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        from guidance_cards where workspace_id = ${workspaceId}::uuid order by card_key, version desc`);
    const bindingRows = await transaction.execute(sql`select distinct on (binding_key) workspace_id::text as workspace_id, binding_key, version, card_key, facet, value, entity_type,
        mode, priority, record_hash, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        from guidance_bindings where workspace_id = ${workspaceId}::uuid order by binding_key, version desc`);
    const setRows = await transaction.execute(sql`select distinct on (set_key) workspace_id::text as workspace_id, set_key, version, name, ordered_card_ids, review_status,
        to_char(reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as reviewed_at,
        to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as archived_at, record_hash,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        from guidance_sets where workspace_id = ${workspaceId}::uuid order by set_key, version desc`);
    let sources: readonly CurrentSource[]; let cards: readonly CurrentCard[]; let bindings: readonly CurrentBinding[]; let sets: readonly CurrentSet[];
    try {
      sources = rows(sourceRows).map((row) => source(row, workspaceId, capturedAt));
      cards = rows(cardRows).map((row) => card(row, workspaceId, capturedAt));
      bindings = rows(bindingRows).map((row) => binding(row, workspaceId, capturedAt));
      sets = rows(setRows).map((row) => set(row, workspaceId, capturedAt));
      // Lifecycle/provenance fields are validated above, but they are not part
      // of the immutable GuidanceRegistry domain records or their hashes.
      createGuidanceRegistry({ workspaceId,
        sources: sources.map(({ recordHash: _recordHash, createdAt: _createdAt, publishedAt: _publishedAt, archivedAt: _archivedAt, ...value }) => value),
        cards: cards.map(({ recordHash: _recordHash, createdAt: _createdAt, publishedAt: _publishedAt, archivedAt: _archivedAt, ...value }) => value),
        bindings: bindings.map(({ recordHash: _recordHash, createdAt: _createdAt, ...value }) => value),
        sets: sets.map(({ recordHash: _recordHash, createdAt: _createdAt, reviewedAt: _reviewedAt, archivedAt: _archivedAt, ...value }) => value),
      });
    } catch (error) {
      if (error instanceof CurrentReviewedGuidanceReaderError) throw error;
      fail("corrupt_store");
    }
    const sourcesByKey = new Map(sources.map((value) => [value.id, value] as const));
    const cardsByKey = new Map(cards.map((value) => [value.id, value] as const));
    const reviewedSets = sets.filter((value) => value.reviewStatus === "reviewed").sort((left, right) => left.id.localeCompare(right.id)).map((value) => {
      if (value.reviewedAt === null) fail("corrupt_store");
      const manifestCards = value.orderedCardIds.map((cardRef) => {
        const currentCard = cardsByKey.get(cardRef);
        if (!currentCard || currentCard.status !== "published" || currentCard.publishedAt === null) fail("stale");
        const manifestSources = currentCard.sourceIds.map((sourceKey) => {
          const currentSource = sourcesByKey.get(sourceKey);
          if (!currentSource || currentSource.status !== "published" || currentSource.publishedAt === null
            || (currentSource.reviewBy !== null && Date.parse(currentSource.reviewBy) <= Date.parse(capturedAt))) fail("stale");
          return Object.freeze({ sourceKey: currentSource.id, sourceRef: currentSource.sourceRef,
            sourceVersion: currentSource.version, sourceHash: currentSource.recordHash });
        });
        return Object.freeze({ cardRef: currentCard.id, cardVersion: currentCard.version, cardHash: currentCard.recordHash,
          sources: Object.freeze(manifestSources) });
      });
      return Object.freeze({ setRef: value.id, setVersion: value.version, setHash: value.recordHash, cards: Object.freeze(manifestCards) });
    });
    const registry = createGuidanceRegistry({ workspaceId,
      sources: sources.map(({ recordHash: _recordHash, createdAt: _createdAt, publishedAt: _publishedAt, archivedAt: _archivedAt, ...value }) => value),
      cards: cards.map(({ recordHash: _recordHash, createdAt: _createdAt, publishedAt: _publishedAt, archivedAt: _archivedAt, ...value }) => value),
      bindings: bindings.map(({ recordHash: _recordHash, createdAt: _createdAt, ...value }) => value),
      sets: sets.map(({ recordHash: _recordHash, createdAt: _createdAt, reviewedAt: _reviewedAt, archivedAt: _archivedAt, ...value }) => value),
    });
    return Object.freeze({ capturedAt, registryHash: registry.registryHash, registry, reviewedSets: Object.freeze(reviewedSets) });
  }
}
