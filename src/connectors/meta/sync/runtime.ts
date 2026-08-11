import { ConnectorError } from "@/connectors/contract";
import { META_SYNC_STREAMS, stableHash, type MetaParentSyncRun, type MetaReadRequest, type MetaReadTransport, type MetaStreamRun, type MetaSyncError, type MetaSyncErrorReason, type MetaSyncRecord, type MetaSyncSlice } from "./types";
import type { MetaSyncDurableKey, MetaSyncDurablePersistence } from "./persistence-adapter";
import { MetaInventoryMaterializationError, parseMetaInventoryPage, type MetaInventoryPagePersistencePort } from "./inventory-materialization";
import type { MetaInsightSourcePagePersistencePort } from "./insights-materialization";

type MutableStreamRun = { -readonly [Key in keyof MetaStreamRun]: MetaStreamRun[Key] } & { completedSliceIds: string[]; cursorBySlice: Record<string, { cursor: string | null; cursorId: string; updatedAt: string }> };
type MutableParentRun = { -readonly [Key in keyof MetaParentSyncRun]: MetaParentSyncRun[Key] } & { streamRunIds: string[] };

export type MetaSyncStoreSnapshot = Readonly<{
  parents: readonly MetaParentSyncRun[];
  streams: readonly MetaStreamRun[];
  records: readonly MetaSyncRecord[];
}>;

export class InMemoryMetaSyncStore {
  private readonly parents = new Map<string, MutableParentRun>();
  private readonly streams = new Map<string, MutableStreamRun>();
  private readonly records = new Map<string, MetaSyncRecord>();

  saveParent(run: MutableParentRun): void { this.parents.set(run.id, structuredClone(run)); }
  saveStream(run: MutableStreamRun): void { this.streams.set(run.id, structuredClone(run)); }
  parent(id: string): MetaParentSyncRun | undefined { const run = this.parents.get(id); return run && structuredClone(run); }
  stream(id: string): MetaStreamRun | undefined { const run = this.streams.get(id); return run && structuredClone(run); }
  streamsFor(parentRunId: string): readonly MetaStreamRun[] { return [...this.streams.values()].filter((run) => run.parentRunId === parentRunId).sort((a, b) => a.id.localeCompare(b.id)).map((run) => structuredClone(run)); }
  upsert(record: MetaSyncRecord): "inserted" | "updated" | "unchanged" {
    const old = this.records.get(record.identity);
    if (!old) { this.records.set(record.identity, record); return "inserted"; }
    if (old.snapshotHash === record.snapshotHash) { this.records.set(record.identity, { ...old, lastSeenAt: record.lastSeenAt }); return "unchanged"; }
    this.records.set(record.identity, { ...record, firstSeenAt: old.firstSeenAt }); return "updated";
  }
  values(): readonly MetaSyncRecord[] { return [...this.records.values()].sort((a, b) => a.identity.localeCompare(b.identity)); }
  snapshot(): MetaSyncStoreSnapshot {
    return {
      parents: [...this.parents.values()].map((run) => structuredClone(run)),
      streams: [...this.streams.values()].map((run) => structuredClone(run)),
      records: this.values().map((record) => structuredClone(record)),
    };
  }
  restore(snapshot: MetaSyncStoreSnapshot): void {
    for (const parent of snapshot.parents) this.parents.set(parent.id, structuredClone(parent) as MutableParentRun);
    for (const stream of snapshot.streams) this.streams.set(stream.id, structuredClone(stream) as MutableStreamRun);
    for (const record of snapshot.records) this.records.set(record.identity, structuredClone(record));
  }
}

export type MetaSyncRuntimeOptions = Readonly<{
  transport: MetaReadTransport;
  store?: InMemoryMetaSyncStore;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  minPageSize?: number;
  persistence?: MetaSyncDurablePersistence;
  inventoryPagePersistence?: MetaInventoryPagePersistencePort;
  insightPagePersistence?: MetaInsightSourcePagePersistencePort;
}>;
export type MetaSyncResult = Readonly<{ parentRun: MetaParentSyncRun; streamRuns: readonly MetaStreamRun[]; inserted: number; updated: number; unchanged: number; writeNetworkCalls: 0 }>;

export function classifyMetaSyncError(error: unknown): MetaSyncError {
  if (error instanceof ConnectorError) {
    const map: Record<ConnectorError["code"], MetaSyncErrorReason> = { authentication: "authentication", rate_limited: "rate_limited", transient: "connection_lost", invalid_data: "malformed_response" };
    return { reason: map[error.code], retryable: error.retryable, message: error.message };
  }
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "Meta sync hatası";
  if (name === "AbortError" || /timeout/i.test(message)) return { reason: "timeout", retryable: true, message };
  if (/\b500\b|http_500/i.test(message)) return { reason: "http_500", retryable: true, message };
  if (/reduce[ _-]?data|payload too large/i.test(message)) return { reason: "reduce_data", retryable: true, message };
  if (/malformed|invalid json/i.test(message)) return { reason: "malformed_response", retryable: false, message };
  if (/disconnect|network|connection/i.test(message)) return { reason: "connection_lost", retryable: true, message };
  return { reason: "unknown", retryable: false, message };
}

export class MetaPartialReadSyncRuntime {
  readonly store: InMemoryMetaSyncStore;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly minPageSize: number;

  constructor(private readonly options: MetaSyncRuntimeOptions) {
    this.store = options.store ?? new InMemoryMetaSyncStore();
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? (async () => undefined);
    this.random = options.random ?? Math.random;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.minPageSize = options.minPageSize ?? 10;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1) throw new Error("maxAttempts en az 1 olmalıdır");
  }

  async run(input: Readonly<{ parentRunId: string; workspaceId: string; connectionId: string; plan: readonly MetaSyncSlice[] }>): Promise<MetaSyncResult> {
    const observedAt = this.now().toISOString();
    const durableKey: MetaSyncDurableKey = {
      parentRunId: input.parentRunId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
    };
    let parent = this.store.parent(input.parentRunId) as MutableParentRun | undefined;
    if (!parent && this.options.persistence) {
      const snapshot = await this.options.persistence.restore(durableKey);
      if (snapshot) {
        this.store.restore(snapshot);
        parent = this.store.parent(input.parentRunId) as MutableParentRun | undefined;
      }
    }
    if (!parent) {
      parent = { id: input.parentRunId, workspaceId: input.workspaceId, connectionId: input.connectionId, status: "running", streamRunIds: [] };
      for (const slice of input.plan) {
        const id = `${input.parentRunId}:${slice.stream}:${slice.accountId}`;
        if (!parent.streamRunIds.includes(id)) parent.streamRunIds.push(id);
        if (!this.store.stream(id)) this.store.saveStream({ id, parentRunId: input.parentRunId, stream: slice.stream, accountId: slice.accountId, status: "pending", completedSliceIds: [], cursorBySlice: {}, error: null });
      }
      parent.streamRunIds.sort(); this.store.saveParent(parent);
      await this.persist(durableKey);
    }
    let inserted = 0; let updated = 0; let unchanged = 0;
    for (const streamName of META_SYNC_STREAMS) for (const streamId of parent.streamRunIds) {
      const stream = this.store.stream(streamId) as MutableStreamRun;
      if (stream.stream !== streamName || stream.status === "completed") continue;
      const slices = input.plan.filter((slice) => slice.stream === stream.stream && slice.accountId === stream.accountId);
      stream.status = "running"; stream.error = null;
      for (const slice of slices) {
        if (stream.completedSliceIds.includes(slice.id)) continue;
        const outcome = await this.processSlice(parent, stream, slice, durableKey, observedAt);
        inserted += outcome.inserted; updated += outcome.updated; unchanged += outcome.unchanged;
        if (!outcome.completed) { stream.status = "partial"; stream.error = outcome.error; this.store.saveStream(stream); await this.persist(durableKey); break; }
      }
      if (stream.completedSliceIds.length === slices.length) { stream.status = "completed"; stream.error = null; }
      this.store.saveStream(stream);
      // A completed final stream is persisted atomically with the parent below.
      // Persist intermediate/partial streams before the next external page so
      // restart durability is preserved without writing an identical snapshot
      // twice at the terminal boundary.
      if (stream.status !== "completed" || this.hasPendingWork(parent, input.plan)) {
        await this.persist(durableKey);
      }
    }
    const streams = this.store.streamsFor(parent.id);
    parent.status = streams.every((stream) => stream.status === "completed")
      ? "completed"
      : streams.some((stream) => stream.completedSliceIds.length > 0 || Object.keys(stream.cursorBySlice).length > 0)
        ? "partial"
        : "failed";
    this.store.saveParent(parent);
    await this.persist(durableKey);
    return { parentRun: this.store.parent(parent.id)!, streamRuns: this.store.streamsFor(parent.id), inserted, updated, unchanged, writeNetworkCalls: 0 };
  }

  private async processSlice(parent: MutableParentRun, stream: MutableStreamRun, slice: MetaSyncSlice, durableKey: MetaSyncDurableKey, observedAt: string): Promise<{ completed: boolean; inserted: number; updated: number; unchanged: number; error: MetaSyncError | null }> {
    let cursor = stream.cursorBySlice[slice.id]?.cursor ?? null;
    let pageSize = slice.pageSize;
    let inserted = 0; let updated = 0; let unchanged = 0;
    do {
      const cursorId = stableHash({ sliceId: slice.id, cursor });
      const request: MetaReadRequest = { method: "GET", stream: slice.stream, accountId: slice.accountId, entityLevel: slice.entityLevel, dateStart: slice.dateStart, dateStop: slice.dateStop, cursor, limit: pageSize, correlation: { parentRunId: parent.id, streamRunId: stream.id, accountId: slice.accountId, sliceId: slice.id, cursorId } };
      const pageResult = await this.fetchBounded(request);
      if ("error" in pageResult) {
        if (pageResult.error.reason === "reduce_data" || pageResult.error.reason === "rate_limited") pageSize = Math.max(this.minPageSize, Math.floor(pageSize / 2));
        stream.cursorBySlice[slice.id] = { cursor, cursorId, updatedAt: this.now().toISOString() };
        this.store.saveStream(stream);
        await this.persist(durableKey);
        return { completed: false, inserted, updated, unchanged, error: pageResult.error };
      }
      const page = pageResult.page;
      if (!Array.isArray(page.records) || typeof page.usageHeadroom !== "number" || page.usageHeadroom < 0 || page.usageHeadroom > 1) {
        return { completed: false, inserted, updated, unchanged, error: { reason: "malformed_response", retryable: false, message: "Meta page records/headroom sözleşmesini karşılamıyor" } };
      }
      if (this.options.inventoryPagePersistence && slice.stream === "inventory" && slice.entityLevel !== "account") {
        try {
          if (!page.sourceGraphVersion || !page.fieldCatalogVersion) {
            throw new MetaInventoryMaterializationError("invalid_page", "Inventory provenance metadata eksik");
          }
          const canonicalPage = parseMetaInventoryPage({
            workspaceId: parent.workspaceId, connectionId: parent.connectionId,
            externalAccountId: slice.accountId, parentRunId: parent.id,
            sliceId: slice.id, cursorId, entityLevel: slice.entityLevel, observedAt,
            sourceGraphVersion: page.sourceGraphVersion, fieldCatalogVersion: page.fieldCatalogVersion,
            terminal: page.nextCursor === null, records: page.records,
          });
          await this.options.inventoryPagePersistence.writePage(canonicalPage, { records: page.records });
        } catch (error) {
          return { completed: false, inserted, updated, unchanged, error: {
            reason: error instanceof MetaInventoryMaterializationError ? "malformed_response" : "unknown",
            retryable: false,
            message: error instanceof MetaInventoryMaterializationError
              ? "Meta inventory canonical materialization doğrulaması başarısız"
              : "Meta inventory canonical kaydı güvenli biçimde tamamlanamadı",
          } };
        }
      }
      if (this.options.insightPagePersistence && slice.stream === "insights" && slice.entityLevel !== "account") {
        try {
          // The canonical writer has an exact sync-run/slice FK. Persist the current (not next)
          // cursor first so a first page is materialized against an existing immutable scope.
          stream.cursorBySlice[slice.id] = { cursor, cursorId, updatedAt: this.now().toISOString() };
          this.store.saveStream(stream);
          await this.persist(durableKey);
          await this.options.insightPagePersistence.writeSourcePage({
            workspaceId: parent.workspaceId, connectionId: parent.connectionId, externalAccountId: slice.accountId,
            entityLevel: slice.entityLevel, parentRunId: parent.id, sliceId: slice.id, cursorId, observedAt,
            records: page.records,
          });
        } catch (error) {
          return { completed: false, inserted, updated, unchanged, error: {
            reason: "malformed_response", retryable: false,
            message: "Meta insight canonical materialization doğrulaması başarısız",
          } };
        }
      }
      for (const payload of page.records) {
        const externalId = typeof payload.id === "string" ? payload.id : stableHash(payload);
        const identity = `${parent.workspaceId}:${parent.connectionId}:${slice.accountId}:${slice.stream}:${slice.entityLevel}:${slice.dateStart ?? "all"}:${slice.dateStop ?? "all"}:${externalId}`;
        const outcome = this.store.upsert({
          identity,
          accountId: slice.accountId,
          stream: slice.stream,
          entityLevel: slice.entityLevel,
          snapshotHash: stableHash(payload),
          // Canonical inventory persistence already holds the validated fields;
          // the generic restart ledger needs only identity and hash evidence.
          payload: (this.options.inventoryPagePersistence && slice.stream === "inventory")
            || (this.options.insightPagePersistence && slice.stream === "insights") ? {} : payload,
          firstSeenAt: this.now().toISOString(),
          lastSeenAt: this.now().toISOString(),
        });
        if (outcome === "inserted") inserted += 1; else if (outcome === "updated") updated += 1; else unchanged += 1;
      }
      cursor = page.nextCursor;
      stream.cursorBySlice[slice.id] = { cursor, cursorId: stableHash({ sliceId: slice.id, cursor }), updatedAt: this.now().toISOString() };
      this.store.saveStream(stream);
      await this.persist(durableKey);
      pageSize = this.nextPageSize(pageSize, page.usageHeadroom);
    } while (cursor !== null);
    stream.completedSliceIds.push(slice.id);
    this.store.saveStream(stream);
    return { completed: true, inserted, updated, unchanged, error: null };
  }

  private hasPendingWork(parent: MutableParentRun, plan: readonly MetaSyncSlice[]): boolean {
    return parent.streamRunIds.some((streamId) => {
      const stream = this.store.stream(streamId);
      if (!stream || stream.status === "completed") return false;
      return plan.some((slice) => slice.stream === stream.stream
        && slice.accountId === stream.accountId
        && !stream.completedSliceIds.includes(slice.id));
    });
  }

  private async persist(key: MetaSyncDurableKey): Promise<void> {
    await this.options.persistence?.persist(key, this.store.snapshot());
  }

  private nextPageSize(size: number, headroom: number): number { return headroom < 0.2 ? Math.max(this.minPageSize, Math.floor(size / 2)) : headroom > 0.7 ? Math.min(500, size + Math.max(1, Math.floor(size / 4))) : size; }
  private async fetchBounded(request: MetaReadRequest): Promise<{ page: Awaited<ReturnType<MetaReadTransport["get"]>> } | { error: MetaSyncError }> {
    let lastError: MetaSyncError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try { return { page: await this.options.transport.get(request) }; }
      catch (error) {
        lastError = classifyMetaSyncError(error);
        if (!lastError.retryable || attempt === this.maxAttempts) break;
        const delay = Math.round(100 * 2 ** (attempt - 1) * (0.5 + this.random()));
        await this.sleep(delay);
      }
    }
    return { error: lastError ?? { reason: "unknown", retryable: false, message: "Bilinmeyen Meta sync hatası" } };
  }
}
