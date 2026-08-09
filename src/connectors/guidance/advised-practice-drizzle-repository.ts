import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  verifyAdvisedPracticeDefinition,
  verifyAdvisedPracticeHistory,
  appendAdvisedPracticeEvent,
  replayAdvisedPractice,
  type AdvisedPracticeDefinition,
  type AdvisedPracticeEvent,
} from "@/domain/guidance/advised-practice";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type PracticeDatabase = Pick<ReklamZekaDatabase, "select" | "insert" | "execute" | "transaction">;

export class AdvisedPracticeRepositoryError extends Error {
  constructor(readonly code:
    | "workspace_scope_mismatch"
    | "definition_missing"
    | "invalid_revision"
    | "invalid_transition"
    | "chain_conflict"
    | "record_conflict"
    | "forbidden"
    | "corrupt_store") {
    super("Advised practice kalıcılık işlemi güvenli biçimde tamamlanamadı");
    this.name = "AdvisedPracticeRepositoryError";
  }
}

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return [];
  return result.rows as readonly Record<string, unknown>[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRACTICE_REF = /^practice_[a-z0-9][a-z0-9_-]{0,86}$/;
const REVISION_REF = /^practice_revision_[a-f0-9]{64}$/;

function digest(value: unknown): string {
  const stable = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(stable)
    : entry && typeof entry === "object" ? Object.fromEntries(Object.entries(entry as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)])) : entry;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new AdvisedPracticeRepositoryError("workspace_scope_mismatch");
}

async function assertWorkspace(database: PracticeDatabase, workspaceId: string, lock: boolean): Promise<void> {
  assertUuid(workspaceId);
  const suffix = lock ? sql` for update` : sql``;
  const result = await database.execute(sql`
    select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 1${suffix}
  `);
  if (rowsOf(result).length !== 1) throw new AdvisedPracticeRepositoryError("workspace_scope_mismatch");
}

function definitionFromRow(row: typeof schema.advisedPracticeDefinitions.$inferSelect): AdvisedPracticeDefinition {
  const definition = row.payload as unknown as AdvisedPracticeDefinition;
  if (!verifyAdvisedPracticeDefinition(definition) || definition.workspaceRef !== row.workspaceRef
    || definition.practiceRef !== row.practiceRef || definition.version !== row.version
    || definition.schemaVersion !== row.schemaVersion
    || definition.previousDefinitionHash !== row.previousDefinitionHash || definition.definitionHash !== row.definitionHash) {
    throw new AdvisedPracticeRepositoryError("corrupt_store");
  }
  return definition;
}

function eventFromRow(row: typeof schema.advisedPracticeEvents.$inferSelect): AdvisedPracticeEvent {
  const event = row.payload as unknown as AdvisedPracticeEvent;
  if (!event || event.workspaceRef !== row.workspaceRef || event.practiceRef !== row.practiceRef
    || event.definitionVersion !== row.definitionVersion || event.definitionHash !== row.definitionHash
    || event.schemaVersion !== row.schemaVersion || event.sequence !== row.sequence
    || event.previousEventHash !== row.previousEventHash || event.eventId !== row.eventId
    || event.eventHash !== row.eventHash || event.eventType !== row.eventType
    || event.occurredAt !== row.occurredAt.toISOString()) throw new AdvisedPracticeRepositoryError("corrupt_store");
  return event;
}

export type PersistedAdvisedPractice = Readonly<{
  definition: AdvisedPracticeDefinition;
  history: readonly AdvisedPracticeEvent[];
}>;

export function advisedPracticeRevisionRef(record: PersistedAdvisedPractice): string {
  const replay = replayAdvisedPractice(record.definition, record.history);
  return `practice_revision_${digest({ definitionVersion: record.definition.version,
    definitionHash: record.definition.definitionHash, lastEventHash: record.history.at(-1)?.eventHash ?? "GENESIS",
    historyHash: replay.historyHash })}`;
}

export type AdvisedPracticeLifecycleMutationInput = Readonly<{
  workspaceId: string;
  actorId: string;
  actorRef: string;
  role: "owner" | "admin" | "analyst";
  practiceRef: string;
  expectedDefinitionVersion: number;
  expectedRevisionRef: string;
  occurredAt: string;
  command: Readonly<{ operation: "propose_standardization"; candidateNote: string }>
    | Readonly<{ operation: "standardize"; decisionRef: string; confirmationNote: string }>;
}>;

export type AdvisedPracticeLifecycleMutationResult = Readonly<{
  record: PersistedAdvisedPractice;
  revisionRef: string;
  auditAppended: true;
}>;

export class DrizzleAdvisedPracticeRepository {
  private readonly workspaceId: string;

  constructor(private readonly database: PracticeDatabase, workspaceId: string) {
    assertUuid(workspaceId);
    this.workspaceId = workspaceId;
  }

  async saveDefinition(
    definition: AdvisedPracticeDefinition,
  ): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>> {
    if (!verifyAdvisedPracticeDefinition(definition)) throw new AdvisedPracticeRepositoryError("invalid_revision");
    const workspaceId = this.workspaceId;
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction as PracticeDatabase, workspaceId, true);
      const rows = await transaction.select().from(schema.advisedPracticeDefinitions)
        .where(and(
          eq(schema.advisedPracticeDefinitions.workspaceId, workspaceId),
          eq(schema.advisedPracticeDefinitions.practiceRef, definition.practiceRef),
        )).orderBy(asc(schema.advisedPracticeDefinitions.version));
      const definitions = rows.map(definitionFromRow);
      const sameVersion = definitions.find((item) => item.version === definition.version);
      if (sameVersion) {
        if (sameVersion.definitionHash !== definition.definitionHash) {
          throw new AdvisedPracticeRepositoryError("record_conflict");
        }
        return Object.freeze({ outcome: "unchanged" as const });
      }
      const previous = definitions.at(-1);
      if ((!previous && (definition.version !== 1 || definition.previousDefinitionHash !== "GENESIS"))
        || (previous && (definition.version !== previous.version + 1
          || definition.previousDefinitionHash !== previous.definitionHash
          || definition.workspaceRef !== previous.workspaceRef))) {
        throw new AdvisedPracticeRepositoryError("invalid_revision");
      }
      await transaction.insert(schema.advisedPracticeDefinitions).values({
        workspaceId, workspaceRef: definition.workspaceRef, practiceRef: definition.practiceRef,
        version: definition.version, schemaVersion: definition.schemaVersion,
        previousDefinitionHash: definition.previousDefinitionHash, definitionHash: definition.definitionHash,
        payload: definition as unknown as Record<string, unknown>,
      });
      return Object.freeze({ outcome: "inserted" as const });
    });
  }

  async appendEvent(
    event: AdvisedPracticeEvent,
  ): Promise<Readonly<{ outcome: "inserted" | "unchanged" }>> {
    const workspaceId = this.workspaceId;
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction as PracticeDatabase, workspaceId, true);
      const definitionRows = await transaction.select().from(schema.advisedPracticeDefinitions)
        .where(and(
          eq(schema.advisedPracticeDefinitions.workspaceId, workspaceId),
          eq(schema.advisedPracticeDefinitions.practiceRef, event.practiceRef),
          eq(schema.advisedPracticeDefinitions.version, event.definitionVersion),
          eq(schema.advisedPracticeDefinitions.definitionHash, event.definitionHash),
        ));
      if (definitionRows.length !== 1) throw new AdvisedPracticeRepositoryError("definition_missing");
      const definitionRow = definitionRows[0]!;
      const definition = definitionFromRow(definitionRow);
      const eventRows = await transaction.select().from(schema.advisedPracticeEvents)
        .where(and(
          eq(schema.advisedPracticeEvents.workspaceId, workspaceId),
          eq(schema.advisedPracticeEvents.definitionId, definitionRow.id),
        )).orderBy(asc(schema.advisedPracticeEvents.sequence));
      const history = eventRows.map(eventFromRow);
      if (!verifyAdvisedPracticeHistory(definition, history)) throw new AdvisedPracticeRepositoryError("corrupt_store");
      const existing = history.find((item) => item.eventId === event.eventId);
      if (existing) {
        if (existing.eventHash !== event.eventHash) throw new AdvisedPracticeRepositoryError("record_conflict");
        return Object.freeze({ outcome: "unchanged" as const });
      }
      if (!verifyAdvisedPracticeHistory(definition, [...history, event])) {
        throw new AdvisedPracticeRepositoryError("chain_conflict");
      }
      await transaction.insert(schema.advisedPracticeEvents).values({
        workspaceId, definitionId: definitionRow.id, workspaceRef: event.workspaceRef,
        practiceRef: event.practiceRef, definitionVersion: event.definitionVersion,
        definitionHash: event.definitionHash, schemaVersion: event.schemaVersion,
        sequence: event.sequence, previousEventHash: event.previousEventHash,
        eventId: event.eventId, eventHash: event.eventHash, eventType: event.eventType,
        occurredAt: new Date(event.occurredAt), payload: event as unknown as Record<string, unknown>,
      });
      return Object.freeze({ outcome: "inserted" as const });
    });
  }

  async mutateLifecycle(input: AdvisedPracticeLifecycleMutationInput): Promise<AdvisedPracticeLifecycleMutationResult> {
    if (input.workspaceId !== this.workspaceId || !UUID.test(input.actorId) || !PRACTICE_REF.test(input.practiceRef)
      || !Number.isSafeInteger(input.expectedDefinitionVersion) || input.expectedDefinitionVersion < 1
      || !REVISION_REF.test(input.expectedRevisionRef) || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new AdvisedPracticeRepositoryError("invalid_revision");
    }
    return this.database.transaction(async (transaction) => {
      const tx = transaction as PracticeDatabase;
      await assertWorkspace(tx, this.workspaceId, true);
      const membership = rowsOf(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${this.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (membership.length !== 1 || membership[0]?.role !== input.role || input.role === "analyst" && input.command.operation === "standardize") {
        throw new AdvisedPracticeRepositoryError("forbidden");
      }
      const definitionRows = await transaction.select().from(schema.advisedPracticeDefinitions)
        .where(and(eq(schema.advisedPracticeDefinitions.workspaceId, this.workspaceId),
          eq(schema.advisedPracticeDefinitions.practiceRef, input.practiceRef)))
        .orderBy(asc(schema.advisedPracticeDefinitions.version));
      const definitionRow = definitionRows.at(-1);
      if (!definitionRow) throw new AdvisedPracticeRepositoryError("definition_missing");
      const definition = definitionFromRow(definitionRow);
      const eventRows = await transaction.select().from(schema.advisedPracticeEvents)
        .where(and(eq(schema.advisedPracticeEvents.workspaceId, this.workspaceId),
          eq(schema.advisedPracticeEvents.definitionId, definitionRow.id)))
        .orderBy(asc(schema.advisedPracticeEvents.sequence));
      const history = eventRows.map(eventFromRow);
      const record = Object.freeze({ definition, history: Object.freeze(history) });
      if (!verifyAdvisedPracticeHistory(definition, history)) throw new AdvisedPracticeRepositoryError("corrupt_store");
      if (definition.version !== input.expectedDefinitionVersion
        || advisedPracticeRevisionRef(record) !== input.expectedRevisionRef) {
        throw new AdvisedPracticeRepositoryError("record_conflict");
      }
      const replay = replayAdvisedPractice(definition, history);
      if (input.command.operation === "propose_standardization"
        ? replay.state !== "standardization_reviewed" : replay.state !== "standardization_candidate") {
        throw new AdvisedPracticeRepositoryError("invalid_transition");
      }
      const last = history.at(-1);
      const appended = input.command.operation === "propose_standardization"
        ? appendAdvisedPracticeEvent(definition, history, { eventType: "standardization_candidate",
          occurredAt: input.occurredAt, payload: { proposedByRef: input.actorRef, proposedByRole: input.role,
            reviewEventRef: last?.eventId ?? "missing_review", candidateNote: input.command.candidateNote } })
        : appendAdvisedPracticeEvent(definition, history, { eventType: "standardized", occurredAt: input.occurredAt,
          payload: { confirmedByRef: input.actorRef, confirmedByRole: input.role as "owner" | "admin",
            candidateEventRef: last?.eventId ?? "missing_candidate", decisionRef: input.command.decisionRef,
            confirmationNote: input.command.confirmationNote } });
      const event = appended.event;
      await transaction.insert(schema.advisedPracticeEvents).values({
        workspaceId: this.workspaceId, definitionId: definitionRow.id, workspaceRef: event.workspaceRef,
        practiceRef: event.practiceRef, definitionVersion: event.definitionVersion, definitionHash: event.definitionHash,
        schemaVersion: event.schemaVersion, sequence: event.sequence, previousEventHash: event.previousEventHash,
        eventId: event.eventId, eventHash: event.eventHash, eventType: event.eventType,
        occurredAt: new Date(event.occurredAt), payload: event as unknown as Record<string, unknown>,
      });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${this.workspaceId}`}, 0))`);
      const previousHash = String(rowsOf(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${this.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const audit = Object.freeze({ id: randomUUID(), workspaceId: this.workspaceId, actorId: input.actorId,
        action: `advised_practice.${input.command.operation}`, resourceType: "advised_practice",
        resourceId: input.practiceRef, occurredAt: input.occurredAt, previousHash,
        metadata: Object.freeze({ role: input.role, definitionVersion: definition.version,
          eventSequence: event.sequence, expectedRevisionRef: input.expectedRevisionRef,
          humanConfirmation: input.command.operation === "standardize" }) });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${audit.id}::uuid, ${audit.workspaceId}::uuid,
        ${audit.actorId}::uuid, ${audit.action}, ${audit.resourceType}, ${audit.resourceId},
        ${JSON.stringify(audit.metadata)}::jsonb, ${audit.previousHash}, ${digest(audit)}, ${audit.occurredAt}::timestamptz)`);
      const nextRecord = Object.freeze({ definition, history: appended.history });
      return Object.freeze({ record: nextRecord, revisionRef: advisedPracticeRevisionRef(nextRecord), auditAppended: true as const });
    });
  }

  async load(practiceRef: string, version?: number): Promise<PersistedAdvisedPractice | null> {
    const workspaceId = this.workspaceId;
    if (!PRACTICE_REF.test(practiceRef) || (version !== undefined && (!Number.isInteger(version) || version < 1))) {
      throw new AdvisedPracticeRepositoryError("definition_missing");
    }
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction as PracticeDatabase, workspaceId, false);
      const definitions = await transaction.select().from(schema.advisedPracticeDefinitions)
        .where(and(
          eq(schema.advisedPracticeDefinitions.workspaceId, workspaceId),
          eq(schema.advisedPracticeDefinitions.practiceRef, practiceRef),
          ...(version === undefined ? [] : [eq(schema.advisedPracticeDefinitions.version, version)]),
        )).orderBy(asc(schema.advisedPracticeDefinitions.version));
      const row = definitions.at(-1);
      if (!row) return null;
      const definition = definitionFromRow(row);
      const events = await transaction.select().from(schema.advisedPracticeEvents)
        .where(and(
          eq(schema.advisedPracticeEvents.workspaceId, workspaceId),
          eq(schema.advisedPracticeEvents.definitionId, row.id),
        )).orderBy(asc(schema.advisedPracticeEvents.sequence));
      const history = events.map(eventFromRow);
      if (!verifyAdvisedPracticeHistory(definition, history)) throw new AdvisedPracticeRepositoryError("corrupt_store");
      return Object.freeze({ definition, history: Object.freeze(history) });
    });
  }

  /**
   * Returns only public opaque practice references. Definition payloads and
   * database identifiers remain behind load(), where their integrity chain is
   * verified before use.
   */
  async listRefs(input: Readonly<{ after: string | null; limit: number }>): Promise<readonly string[]> {
    const { after, limit } = input;
    if ((after !== null && !PRACTICE_REF.test(after))
      || !Number.isInteger(limit) || limit < 1 || limit > 101) {
      throw new AdvisedPracticeRepositoryError("definition_missing");
    }
    const workspaceId = this.workspaceId;
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction as PracticeDatabase, workspaceId, false);
      const result = await transaction.execute(sql`
        select distinct practice_ref
        from advised_practice_definitions
        where workspace_id = ${workspaceId}::uuid
          and (${after}::text is null or practice_ref > ${after}::text)
        order by practice_ref asc
        limit ${limit}
      `);
      const refs = rowsOf(result).map((row) => row.practice_ref);
      if (refs.some((value) => typeof value !== "string" || !PRACTICE_REF.test(value))) {
        throw new AdvisedPracticeRepositoryError("corrupt_store");
      }
      return Object.freeze(refs as string[]);
    });
  }
}
