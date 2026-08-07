import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  verifyAdvisedPracticeDefinition,
  verifyAdvisedPracticeHistory,
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
    | "chain_conflict"
    | "record_conflict"
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
