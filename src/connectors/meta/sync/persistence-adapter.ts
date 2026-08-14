import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import type { MetaSyncStoreSnapshot } from "./runtime";
import type { MetaEntityLevel, MetaStreamRun, MetaSyncStatus, MetaSyncStream } from "./types";

export type PersistedMetaSyncStream = "inventory" | "creative" | "insights";

export function persistedMetaSyncStream(stream: MetaSyncStream): PersistedMetaSyncStream {
  return stream === "creative_post" ? "creative" : stream;
}

function runtimeMetaSyncStream(stream: PersistedMetaSyncStream): MetaSyncStream {
  return stream === "creative" ? "creative_post" : stream;
}

function stableUuid(value: string): string {
  const source = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  source[12] = "5";
  source[16] = "a";
  const hex = source.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type MetaSyncDurableKey = Readonly<{
  parentRunId: string;
  workspaceId: string;
  connectionId: string;
}>;

/**
 * The concrete PostgreSQL repository implements these two operations with the
 * meta_portfolio_sync_runs/meta_sync_runs/meta_sync_slices tables. Keeping the
 * transaction manager injected makes the runtime independently testable.
 */
export interface MetaSyncPersistenceTransaction {
  load(key: MetaSyncDurableKey): Promise<MetaSyncStoreSnapshot | null>;
  save(key: MetaSyncDurableKey, snapshot: MetaSyncStoreSnapshot): Promise<void>;
}

export interface MetaSyncTransactionManager {
  transaction<T>(work: (transaction: MetaSyncPersistenceTransaction) => Promise<T>): Promise<T>;
}

export interface MetaSyncDurablePersistence {
  restore(key: MetaSyncDurableKey): Promise<MetaSyncStoreSnapshot | null>;
  persist(key: MetaSyncDurableKey, snapshot: MetaSyncStoreSnapshot): Promise<void>;
}

/**
 * A commit is all-or-nothing: run state, per-slice cursor and canonical records
 * are presented to one repository transaction. The repository is responsible
 * for idempotent upserts using the identities carried in the snapshot.
 */
export class TransactionBackedMetaSyncPersistenceAdapter implements MetaSyncDurablePersistence {
  constructor(private readonly transactions: MetaSyncTransactionManager) {}

  async restore(key: MetaSyncDurableKey): Promise<MetaSyncStoreSnapshot | null> {
    return this.transactions.transaction(async (transaction) => {
      const snapshot = await transaction.load(key);
      return snapshot ? structuredClone(snapshot) : null;
    });
  }

  async persist(key: MetaSyncDurableKey, snapshot: MetaSyncStoreSnapshot): Promise<void> {
    await this.transactions.transaction(async (transaction) => {
      await transaction.save(key, structuredClone(snapshot));
    });
  }
}

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;

/** Concrete PostgreSQL implementation for the Drizzle S1.3 tables. */
export class DrizzleMetaSyncTransactionManager implements MetaSyncTransactionManager {
  constructor(
    private readonly database: ReklamZekaDatabase,
    private readonly options: Readonly<{ transactionMode?: "atomic" | "idempotent_checkpoint" }> = {},
  ) {}

  transaction<T>(work: (transaction: MetaSyncPersistenceTransaction) => Promise<T>): Promise<T> {
    const bind = (database: ReklamZekaDatabase): MetaSyncPersistenceTransaction => ({
      load: (key) => this.load(database, key),
      save: (key, snapshot) => this.save(database, key, snapshot),
    });
    // This is a server-selected recovery path for a verified pooler callback
    // defect. Every durable relation uses deterministic identities/upserts, so
    // an interrupted checkpoint is safely replayed; the normal default remains
    // a single atomic transaction.
    return this.options.transactionMode === "idempotent_checkpoint"
      ? work(bind(this.database))
      : this.database.transaction(async (databaseTransaction) => work(bind(databaseTransaction as ReklamZekaDatabase)));
  }

  private async accountIds(
    database: ReklamZekaDatabase,
    key: MetaSyncDurableKey,
    externalAccountIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const expected = [...new Set(externalAccountIds)].sort();
    if (expected.length === 0) return new Map();
    const rows = await database.select({
      id: schema.adAccounts.id,
      externalAccountId: schema.adAccounts.externalAccountId,
    })
      .from(schema.adAccounts)
      .innerJoin(schema.dataSources, eq(schema.adAccounts.dataSourceId, schema.dataSources.id))
      .where(and(
        eq(schema.adAccounts.workspaceId, key.workspaceId),
        eq(schema.dataSources.metaConnectionId, key.connectionId),
        inArray(schema.adAccounts.externalAccountId, expected),
      ));
    const mapping = new Map(rows.map((row) => [row.externalAccountId, row.id]));
    const missing = expected.find((externalAccountId) => !mapping.has(externalAccountId));
    if (missing || mapping.size !== expected.length) {
      throw new Error(`Meta sync account mapping bulunamadı: ${missing ?? "ambiguous"}`);
    }
    return mapping;
  }

  private async save(database: ReklamZekaDatabase, key: MetaSyncDurableKey, snapshot: MetaSyncStoreSnapshot): Promise<void> {
    const parent = snapshot.parents.find((candidate) => candidate.id === key.parentRunId);
    if (!parent || parent.workspaceId !== key.workspaceId || parent.connectionId !== key.connectionId) {
      throw new Error("Meta sync durable snapshot scope uyuşmuyor");
    }
    const accountIds = await this.accountIds(database, key, [
      ...snapshot.streams.map((stream) => stream.accountId),
      ...snapshot.records.map((record) => record.accountId),
    ]);
    const accountId = (externalAccountId: string): string => {
      const resolved = accountIds.get(externalAccountId);
      if (!resolved) throw new Error(`Meta sync account mapping bulunamadı: ${externalAccountId}`);
      return resolved;
    };
    const portfolioId = stableUuid(`portfolio:${key.workspaceId}:${key.connectionId}:${key.parentRunId}`);
    await database.insert(schema.metaPortfolioSyncRuns).values({
      id: portfolioId,
      workspaceId: key.workspaceId,
      metaConnectionId: key.connectionId,
      idempotencyKey: key.parentRunId,
      status: parent.status,
      requestContext: { runtimeParentRunId: key.parentRunId },
      startedAt: new Date(),
      finishedAt: parent.status === "completed" ? new Date() : null,
    }).onConflictDoUpdate({
      target: [schema.metaPortfolioSyncRuns.workspaceId, schema.metaPortfolioSyncRuns.metaConnectionId, schema.metaPortfolioSyncRuns.idempotencyKey],
      set: { status: parent.status, finishedAt: parent.status === "completed" ? new Date() : null },
    });

    // A snapshot contains every stream so a restart is deterministic. Persisting
    // each stream/slice with an individual round trip made a normal 5-account
    // checkpoint hundreds of remote statements long. Build the exact immutable
    // checkpoint rows first, then upsert each relation in one statement.
    const persistedStreams = snapshot.streams.filter((candidate) => candidate.parentRunId === key.parentRunId).map((stream) => {
      const adAccountId = accountId(stream.accountId);
      const streamType = persistedMetaSyncStream(stream.stream);
      const streamId = stableUuid(`stream:${key.workspaceId}:${key.connectionId}:${adAccountId}:${streamType}`);
      const latestCursor = Object.values(stream.cursorBySlice).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1)?.cursor ?? null;
      const runId = stableUuid(`run:${key.workspaceId}:${key.connectionId}:${key.parentRunId}:${stream.stream}:${stream.accountId}`);
      return { stream, adAccountId, streamType, streamId, runId, latestCursor };
    });
    if (persistedStreams.length > 0) {
      await database.insert(schema.metaSyncStreams).values(persistedStreams.map(({ stream, adAccountId, streamType, streamId, latestCursor }) => ({
        id: streamId, workspaceId: key.workspaceId, metaConnectionId: key.connectionId, adAccountId,
        streamType, status: stream.status, cursor: latestCursor,
        checkpoint: { completedSliceIds: stream.completedSliceIds, cursorBySlice: stream.cursorBySlice },
        lastErrorClassification: this.errorClassification(stream.error?.reason),
        lastError: stream.error ? { message: stream.error.message, retryable: stream.error.retryable } : null,
        updatedAt: new Date(),
      }))).onConflictDoUpdate({
        target: [schema.metaSyncStreams.workspaceId, schema.metaSyncStreams.metaConnectionId, schema.metaSyncStreams.adAccountId, schema.metaSyncStreams.streamType],
        set: { status: sql`excluded.status`, cursor: sql`excluded.cursor`, checkpoint: sql`excluded.checkpoint`, lastErrorClassification: sql`excluded.last_error_classification`, lastError: sql`excluded.last_error`, updatedAt: sql`excluded.updated_at` },
      });
      await database.insert(schema.metaSyncRuns).values(persistedStreams.map(({ stream, adAccountId, streamType, streamId, runId, latestCursor }) => ({
        id: runId, workspaceId: key.workspaceId, metaConnectionId: key.connectionId, adAccountId,
        portfolioRunId: portfolioId, streamId, streamType, idempotencyKey: stream.id,
        status: stream.status, cursor: latestCursor,
        checkpoint: { completedSliceIds: stream.completedSliceIds, cursorBySlice: stream.cursorBySlice },
        errorClassification: this.errorClassification(stream.error?.reason),
        errorDetail: stream.error ? { message: stream.error.message, retryable: stream.error.retryable } : null,
        startedAt: new Date(), finishedAt: stream.status === "completed" ? new Date() : null,
      }))).onConflictDoUpdate({
        target: [schema.metaSyncRuns.workspaceId, schema.metaSyncRuns.metaConnectionId, schema.metaSyncRuns.adAccountId, schema.metaSyncRuns.streamType, schema.metaSyncRuns.idempotencyKey],
        set: { status: sql`excluded.status`, cursor: sql`excluded.cursor`, checkpoint: sql`excluded.checkpoint`, errorClassification: sql`excluded.error_classification`, errorDetail: sql`excluded.error_detail`, finishedAt: sql`excluded.finished_at` },
      });
      const slices = persistedStreams.flatMap(({ stream, adAccountId, streamType, runId }) => Object.entries(stream.cursorBySlice).map(([sliceKey, cursor]) => {
        const prefix = `${stream.stream}:${stream.accountId}:`;
        const [entityLevel, dateStart, dateStop] = sliceKey.slice(prefix.length).split(":") as [MetaEntityLevel, string, string];
        return {
          id: stableUuid(`slice:${runId}:${sliceKey}`), workspaceId: key.workspaceId, metaConnectionId: key.connectionId,
          adAccountId, runId, streamType, entityLevel: entityLevel === "account" ? null : entityLevel,
          dateStart: dateStart === "all" ? null : dateStart, dateStop: dateStop === "all" ? null : dateStop,
          sliceKey, status: stream.completedSliceIds.includes(sliceKey) ? "completed" : stream.status,
          cursor: cursor.cursor, checkpoint: { cursorId: cursor.cursorId, updatedAt: cursor.updatedAt },
          errorClassification: stream.completedSliceIds.includes(sliceKey) ? null : this.errorClassification(stream.error?.reason),
          errorDetail: stream.completedSliceIds.includes(sliceKey) || !stream.error ? null : { message: stream.error.message, retryable: stream.error.retryable },
          completedAt: stream.completedSliceIds.includes(sliceKey) ? new Date(cursor.updatedAt) : null,
        };
      }));
      if (slices.length > 0) await database.insert(schema.metaSyncSlices).values(slices).onConflictDoUpdate({
          target: [schema.metaSyncSlices.runId, schema.metaSyncSlices.sliceKey],
          set: {
            status: sql`excluded.status`, cursor: sql`excluded.cursor`, checkpoint: sql`excluded.checkpoint`,
            errorClassification: sql`excluded.error_classification`, errorDetail: sql`excluded.error_detail`,
            completedAt: sql`excluded.completed_at`,
          },
        });
    }

    if (snapshot.records.length > 0) {
      await database.insert(schema.metaSyncRecordLedger).values(snapshot.records.map((record) => ({
        id: stableUuid(`record:${key.workspaceId}:${key.connectionId}:${record.identity}`),
        workspaceId: key.workspaceId, metaConnectionId: key.connectionId, adAccountId: accountId(record.accountId),
        streamType: persistedMetaSyncStream(record.stream), entityLevel: record.entityLevel === "account" ? null : record.entityLevel,
        recordIdentity: record.identity, snapshotHash: record.snapshotHash,
        firstSeenAt: new Date(record.firstSeenAt), lastSeenAt: new Date(record.lastSeenAt),
      }))).onConflictDoUpdate({
        target: [schema.metaSyncRecordLedger.workspaceId, schema.metaSyncRecordLedger.metaConnectionId, schema.metaSyncRecordLedger.recordIdentity],
        set: { snapshotHash: sql`excluded.snapshot_hash`, lastSeenAt: sql`excluded.last_seen_at` },
      });
    }
  }

  private async load(database: ReklamZekaDatabase, key: MetaSyncDurableKey): Promise<MetaSyncStoreSnapshot | null> {
    const portfolio = await database.select().from(schema.metaPortfolioSyncRuns).where(and(
      eq(schema.metaPortfolioSyncRuns.workspaceId, key.workspaceId),
      eq(schema.metaPortfolioSyncRuns.metaConnectionId, key.connectionId),
      eq(schema.metaPortfolioSyncRuns.idempotencyKey, key.parentRunId),
    )).limit(1);
    if (!portfolio[0]) return null;
    const runRows = await database.select({ run: schema.metaSyncRuns, accountExternalId: schema.adAccounts.externalAccountId })
      .from(schema.metaSyncRuns).innerJoin(schema.adAccounts, eq(schema.metaSyncRuns.adAccountId, schema.adAccounts.id))
      .where(eq(schema.metaSyncRuns.portfolioRunId, portfolio[0].id));
    const streams: MetaStreamRun[] = [];
    for (const row of runRows) {
      const sliceRows = await database.select().from(schema.metaSyncSlices).where(eq(schema.metaSyncSlices.runId, row.run.id));
      const stream = runtimeMetaSyncStream(row.run.streamType);
      const runtimeId = `${key.parentRunId}:${stream}:${row.accountExternalId}`;
      streams.push({
        id: runtimeId, parentRunId: key.parentRunId, stream, accountId: row.accountExternalId,
        status: row.run.status as MetaSyncStatus,
        completedSliceIds: sliceRows.filter((slice) => slice.status === "completed").map((slice) => slice.sliceKey),
        cursorBySlice: Object.fromEntries(sliceRows.map((slice) => [slice.sliceKey, {
          cursor: slice.cursor,
          cursorId: typeof slice.checkpoint.cursorId === "string" ? slice.checkpoint.cursorId : "restored",
          updatedAt: typeof slice.checkpoint.updatedAt === "string" ? slice.checkpoint.updatedAt : slice.createdAt.toISOString(),
        }])),
        error: row.run.errorClassification ? { reason: this.runtimeError(row.run.errorClassification), retryable: Boolean(row.run.errorDetail?.retryable), message: typeof row.run.errorDetail?.message === "string" ? row.run.errorDetail.message : "Meta sync persistence error" } : null,
      });
    }
    const ledger = await database.select({ ledger: schema.metaSyncRecordLedger, accountExternalId: schema.adAccounts.externalAccountId })
      .from(schema.metaSyncRecordLedger).innerJoin(schema.adAccounts, eq(schema.metaSyncRecordLedger.adAccountId, schema.adAccounts.id))
      .where(and(eq(schema.metaSyncRecordLedger.workspaceId, key.workspaceId), eq(schema.metaSyncRecordLedger.metaConnectionId, key.connectionId)));
    return {
      parents: [{ id: key.parentRunId, workspaceId: key.workspaceId, connectionId: key.connectionId, status: portfolio[0].status as MetaSyncStatus, streamRunIds: streams.map((stream) => stream.id).sort() }],
      streams,
      records: ledger.map(({ ledger: record, accountExternalId }) => ({
        identity: record.recordIdentity, accountId: accountExternalId,
        stream: runtimeMetaSyncStream(record.streamType), entityLevel: (record.entityLevel ?? "account") as MetaEntityLevel,
        snapshotHash: record.snapshotHash, payload: {}, firstSeenAt: record.firstSeenAt.toISOString(), lastSeenAt: record.lastSeenAt.toISOString(),
      })),
    };
  }

  private errorClassification(reason: string | undefined): typeof schema.metaSyncErrorClassification.enumValues[number] | null {
    if (!reason) return null;
    const mapping: Record<string, typeof schema.metaSyncErrorClassification.enumValues[number]> = {
      rate_limited: "rate_limited", reduce_data: "payload_too_large", timeout: "timeout",
      http_500: "upstream", malformed_response: "validation", connection_lost: "upstream",
      authentication: "authentication", unknown: "upstream",
    };
    return mapping[reason] ?? "upstream";
  }

  private runtimeError(reason: typeof schema.metaSyncErrorClassification.enumValues[number]): import("./types").MetaSyncErrorReason {
    const mapping: Partial<Record<typeof schema.metaSyncErrorClassification.enumValues[number], import("./types").MetaSyncErrorReason>> = {
      rate_limited: "rate_limited", payload_too_large: "reduce_data", timeout: "timeout",
      upstream: "connection_lost", validation: "malformed_response", authentication: "authentication",
    };
    return mapping[reason] ?? "unknown";
  }
}
