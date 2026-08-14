import type {
  CanonicalMetaAssetMirrorSnapshot,
  MetaAssetDiscovery,
  MetaAssetEdge,
  MetaMirroredAsset,
} from "@/domain/meta/asset-mirror";
import type { MetaAdContentExtraction } from "@/domain/meta/content/extract";
import type {
  CanonicalMetaPostMediaInventory,
  MetaPostMediaDiscovery,
  MetaPostMediaItem,
} from "@/domain/meta/content/post-media-inventory";
import { stableHash } from "./types";

export const META_ASSET_CONTENT_MIN_BATCH_SIZE = 250;
export const META_ASSET_CONTENT_MAX_BATCH_SIZE = 500;

export type MetaAssetContentScope = Readonly<{
  workspaceId: string;
  connectionId: string;
  connectionExternalKey: string;
}>;

export type ResolvedMetaAssetContentScope = MetaAssetContentScope & Readonly<{
  /** Cached once by beginRun; page writes never resolve accounts again. */
  accountIdByExternalId: ReadonlyMap<string, string>;
}>;

export type MetaAdContentRecord = Readonly<{
  adAccountExternalId: string;
  extraction: MetaAdContentExtraction;
  sourceRevision: string;
  sourcePayloadHash: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  fetchedAt: string;
}>;

export type MetaAssetContentPage = Readonly<{
  sliceKey: string;
  cursor: string | null;
  checkpoint: Readonly<Record<string, unknown>>;
  assetSnapshot?: CanonicalMetaAssetMirrorSnapshot;
  postMediaInventory?: CanonicalMetaPostMediaInventory;
  content: readonly MetaAdContentRecord[];
}>;

export type MetaCanonicalWriteOutcome = "inserted" | "updated" | "unchanged" | "stale";

export type MetaCanonicalVersion = Readonly<{ sourceRevision: string; sourcePayloadHash: string }>;

function compareSourceRevision(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right);
}

/** Shared deterministic rule for concrete repositories and tests. */
export function classifyMetaCanonicalDelta(
  current: MetaCanonicalVersion | null,
  incoming: MetaCanonicalVersion,
): MetaCanonicalWriteOutcome {
  if (!current) return "inserted";
  if (compareSourceRevision(incoming.sourceRevision, current.sourceRevision) < 0) return "stale";
  return incoming.sourcePayloadHash === current.sourcePayloadHash ? "unchanged" : "updated";
}

export type MetaAssetContentWriteSummary = Readonly<Record<MetaCanonicalWriteOutcome, number>> & Readonly<{
  cursor: string | null;
  recordCount: number;
}>;

export class MetaAssetContentPersistenceError extends Error {
  constructor(
    readonly code:
      | "invalid_scope"
      | "invalid_page"
      | "cross_account"
      | "wrong_actor"
      | "wrong_post"
      | "secret_boundary",
    message: string,
  ) {
    super(message);
    this.name = "MetaAssetContentPersistenceError";
  }
}

export type MetaAssetRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  asset: MetaMirroredAsset;
  sourceRevision: string;
}>;

export type MetaAssetEdgeRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string | null;
  edge: MetaAssetEdge;
  sourceRevision: string;
}>;

export type MetaAssetDiscoveryRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string | null;
  discovery: MetaAssetDiscovery;
  sourceRevision: string;
}>;

export type MetaContentRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
  record: MetaAdContentRecord;
}>;

export type MetaPostMediaItemRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  item: MetaPostMediaItem;
  sourceRevision: string;
  sourcePayloadHash: string;
}>;

export type MetaPostMediaDiscoveryRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  discovery: MetaPostMediaDiscovery;
  sourceRevision: string;
  sourcePayloadHash: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  fetchedAt: string;
  inventorySnapshotHash: string;
}>;

export interface MetaAssetContentTransaction {
  /**
   * Implementations use INSERT ... ON CONFLICT and compare revision + hash:
   * stale never mutates canonical data, unchanged may advance last_seen only,
   * and updated replaces canonical fields only for a newer/equal revision.
   */
  upsertAssets(rows: readonly MetaAssetRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
  upsertDiscoveries(rows: readonly MetaAssetDiscoveryRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
  upsertEdges(rows: readonly MetaAssetEdgeRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
  /** Optional foundation extension: stores source-bound account read evidence only. */
  materializeAccountReadCapabilities?(scope: ResolvedMetaAssetContentScope, snapshot: CanonicalMetaAssetMirrorSnapshot): Promise<void>;
  upsertContent(rows: readonly MetaContentRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
  /** Optional for backward-compatible repositories; required when a page carries linked post/media inventory. */
  upsertPostMediaItems?(rows: readonly MetaPostMediaItemRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
  upsertPostMediaDiscoveries?(rows: readonly MetaPostMediaDiscoveryRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
  validatePostMediaReferences?(
    rows: readonly MetaPostMediaItemRow[],
    discoveries: readonly MetaPostMediaDiscoveryRow[],
  ): Promise<void>;
  /** Resolves actor/post references within this workspace + connection only. */
  validateReferences(rows: readonly MetaContentRow[]): Promise<void>;
  saveCheckpoint(input: Readonly<{
    scope: MetaAssetContentScope;
    sliceKey: string;
    cursor: string | null;
    checkpoint: Readonly<Record<string, unknown>>;
    summary: Readonly<Record<MetaCanonicalWriteOutcome, number>>;
  }>): Promise<void>;
}

export interface MetaAssetContentRepository {
  /** Must reject a connection outside workspace and return only accounts linked to it. */
  resolveRunScope(scope: MetaAssetContentScope): Promise<ResolvedMetaAssetContentScope>;
  /** No connector/fetch/logger is passed into this callback, keeping network and secrets outside the DB transaction. */
  transaction<T>(work: (transaction: MetaAssetContentTransaction) => Promise<T>): Promise<T>;
}

export interface MetaAssetContentMapper {
  asset(scope: ResolvedMetaAssetContentScope, asset: MetaMirroredAsset): MetaAssetRow;
  discovery(scope: ResolvedMetaAssetContentScope, discovery: MetaAssetDiscovery): MetaAssetDiscoveryRow;
  edge(scope: ResolvedMetaAssetContentScope, edge: MetaAssetEdge): MetaAssetEdgeRow;
  content(scope: ResolvedMetaAssetContentScope, record: MetaAdContentRecord): MetaContentRow;
  postMediaItem(scope: ResolvedMetaAssetContentScope, item: MetaPostMediaItem): MetaPostMediaItemRow;
  postMediaDiscovery(
    scope: ResolvedMetaAssetContentScope,
    inventory: CanonicalMetaPostMediaInventory,
    discovery: MetaPostMediaDiscovery,
  ): MetaPostMediaDiscoveryRow;
}

/**
 * Existing-schema mapper extension point. Concrete Drizzle code can map these
 * rows to meta_assets/meta_asset_edges/meta_posts/meta_creatives/bindings
 * without the orchestration layer depending on future columns.
 */
export const defaultMetaAssetContentMapper: MetaAssetContentMapper = {
  asset: (scope, asset) => ({
    workspaceId: scope.workspaceId,
    connectionId: scope.connectionId,
    asset,
    sourceRevision: asset.provenance.fetchedAt,
  }),
  discovery: (scope, discovery) => ({
    workspaceId: scope.workspaceId,
    connectionId: scope.connectionId,
    adAccountId: discovery.sourceType === "ad_account" && discovery.sourceExternalId
      ? scope.accountIdByExternalId.get(discovery.sourceExternalId) ?? null
      : null,
    discovery,
    sourceRevision: discovery.provenance.fetchedAt,
  }),
  edge: (scope, edge) => ({
    workspaceId: scope.workspaceId,
    connectionId: scope.connectionId,
    adAccountId: edge.sourceType === "ad_account"
      ? scope.accountIdByExternalId.get(edge.sourceExternalId) ?? null
      : null,
    edge,
    sourceRevision: edge.provenance.fetchedAt,
  }),
  content: (scope, record) => {
    const adAccountId = scope.accountIdByExternalId.get(record.adAccountExternalId);
    if (!adAccountId) throw persistenceError("cross_account", "İçerik run kapsamı dışındaki reklam hesabına ait");
    return { workspaceId: scope.workspaceId, connectionId: scope.connectionId, adAccountId, record };
  },
  postMediaItem: (scope, item) => ({
    workspaceId: scope.workspaceId,
    connectionId: scope.connectionId,
    item,
    sourceRevision: item.provenance.fetchedAt,
    sourcePayloadHash: item.provenance.rawPayloadHash,
  }),
  postMediaDiscovery: (scope, inventory, discovery) => {
    const actorItems = inventory.items.filter((item) =>
      item.actor.type === discovery.actorType && item.actor.externalId === discovery.actorExternalId);
    const graphVersions = [...new Set(actorItems.map((item) => item.provenance.sourceGraphVersion))].sort();
    const catalogVersions = [...new Set(actorItems.map((item) => item.provenance.fieldCatalogVersion))].sort();
    return {
      workspaceId: scope.workspaceId,
      connectionId: scope.connectionId,
      discovery,
      sourceRevision: inventory.fetchedAt,
      sourcePayloadHash: stableHash(discovery),
      sourceGraphVersion: graphVersions.join(",") || "unknown",
      fieldCatalogVersion: catalogVersions.join(",") || "post-media-inventory-v1",
      fetchedAt: inventory.fetchedAt,
      inventorySnapshotHash: inventory.snapshotHash,
    };
  },
};

function persistenceError(
  code: MetaAssetContentPersistenceError["code"],
  message: string,
): MetaAssetContentPersistenceError {
  return new MetaAssetContentPersistenceError(code, message);
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw persistenceError("invalid_page", `${label} zorunludur`);
}

function hasForbiddenSecretKey(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => hasForbiddenSecretKey(entry, seen));
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    const normalizedKey = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    return ["accesstoken", "token", "secret", "authorization", "password"].includes(normalizedKey)
      || hasForbiddenSecretKey(entry, seen);
  });
}

function validateRecord(record: MetaAdContentRecord): void {
  assertNonEmpty(record.adAccountExternalId, "Ad account external ID");
  assertNonEmpty(record.sourceRevision, "Source revision");
  assertNonEmpty(record.sourceGraphVersion, "Graph version");
  assertNonEmpty(record.fieldCatalogVersion, "Field catalog version");
  if (!/^[a-f0-9]{64}$/.test(record.sourcePayloadHash) || !Number.isFinite(Date.parse(record.fetchedAt))) {
    throw persistenceError("invalid_page", "İçerik provenance alanları geçersiz");
  }
  const post = record.extraction.post;
  if (post && !post.identities.some((identity) => identity.externalId === post.externalPostId)) {
    throw persistenceError("wrong_post", "Canonical post kimliği kaynak kimlikleriyle uyuşmuyor");
  }
  if (record.extraction.creative.externalCreativeId && !record.extraction.adContext.externalAdId) {
    throw persistenceError("invalid_page", "Creative kaydı reklam kimliği olmadan kalıcılaştırılamaz");
  }
}

function chunks<T>(rows: readonly T[], batchSize: number): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    result.push(rows.slice(offset, offset + batchSize));
  }
  return result;
}

function addOutcomes(
  summary: Record<MetaCanonicalWriteOutcome, number>,
  outcomes: readonly MetaCanonicalWriteOutcome[],
): void {
  for (const outcome of outcomes) summary[outcome] += 1;
}

/**
 * One instance represents one sync run. Account ownership is resolved once and
 * cached. Callers must finish every Graph HTTP request before writePage.
 */
export class MetaAssetContentPersistenceRun {
  private constructor(
    private readonly repository: MetaAssetContentRepository,
    private readonly scope: ResolvedMetaAssetContentScope,
    private readonly batchSize: number,
    private readonly mapper: MetaAssetContentMapper,
  ) {}

  static async begin(input: Readonly<{
    repository: MetaAssetContentRepository;
    scope: MetaAssetContentScope;
    batchSize?: number;
    mapper?: MetaAssetContentMapper;
  }>): Promise<MetaAssetContentPersistenceRun> {
    for (const [label, value] of Object.entries(input.scope)) assertNonEmpty(value, label);
    const batchSize = input.batchSize ?? META_ASSET_CONTENT_MIN_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < META_ASSET_CONTENT_MIN_BATCH_SIZE || batchSize > META_ASSET_CONTENT_MAX_BATCH_SIZE) {
      throw persistenceError("invalid_page", "Batch boyutu 250–500 aralığında olmalıdır");
    }
    if (hasForbiddenSecretKey(input.scope)) throw persistenceError("secret_boundary", "Secret alanı kalıcılık sınırına taşınamaz");
    const resolved = await input.repository.resolveRunScope(input.scope);
    if (
      resolved.workspaceId !== input.scope.workspaceId
      || resolved.connectionId !== input.scope.connectionId
      || resolved.connectionExternalKey !== input.scope.connectionExternalKey
    ) throw persistenceError("invalid_scope", "Repository workspace/connection kapsamını doğrulamadı");
    return new MetaAssetContentPersistenceRun(
      input.repository,
      resolved,
      batchSize,
      input.mapper ?? defaultMetaAssetContentMapper,
    );
  }

  async writePage(page: MetaAssetContentPage): Promise<MetaAssetContentWriteSummary> {
    assertNonEmpty(page.sliceKey, "Slice key");
    if (hasForbiddenSecretKey(page)) throw persistenceError("secret_boundary", "Secret alanı kalıcılık sınırına taşınamaz");
    if (page.assetSnapshot) {
      if (
        page.assetSnapshot.workspaceId !== this.scope.workspaceId
        || page.assetSnapshot.connectionExternalKey !== this.scope.connectionExternalKey
      ) throw persistenceError("invalid_scope", "Asset snapshot workspace/connection kapsamı uyuşmuyor");
      for (const externalAccountId of page.assetSnapshot.adAccountExternalIds) {
        if (!this.scope.accountIdByExternalId.has(externalAccountId)) {
          throw persistenceError("cross_account", "Asset snapshot run kapsamı dışındaki reklam hesabını içeriyor");
        }
      }
    }
    if (page.postMediaInventory && (
      page.postMediaInventory.workspaceId !== this.scope.workspaceId
      || page.postMediaInventory.connectionExternalKey !== this.scope.connectionExternalKey
    )) throw persistenceError("invalid_scope", "Post/media inventory workspace/connection kapsamı uyuşmuyor");
    page.content.forEach(validateRecord);

    const assets = page.assetSnapshot?.assets.map((asset) => this.mapper.asset(this.scope, asset)) ?? [];
    const discoveries = page.assetSnapshot?.discoveries.map((discovery) => {
      const row = this.mapper.discovery(this.scope, discovery);
      if (discovery.sourceType === "ad_account" && !row.adAccountId) {
        throw persistenceError("cross_account", "Asset discovery run kapsamı dışındaki reklam hesabına ait");
      }
      return row;
    }) ?? [];
    const edges = page.assetSnapshot?.edges.map((edge) => {
      const row = this.mapper.edge(this.scope, edge);
      if (edge.sourceType === "ad_account" && !row.adAccountId) {
        throw persistenceError("cross_account", "Asset edge run kapsamı dışındaki reklam hesabına ait");
      }
      return row;
    }) ?? [];
    const content = page.content.map((record) => this.mapper.content(this.scope, record));
    const postMediaItems = page.postMediaInventory?.items.map((item) =>
      this.mapper.postMediaItem(this.scope, item)) ?? [];
    const postMediaDiscoveries = page.postMediaInventory?.discoveries.map((discovery) =>
      this.mapper.postMediaDiscovery(this.scope, page.postMediaInventory!, discovery)) ?? [];
    const recordCount = assets.length + discoveries.length + edges.length + content.length
      + postMediaItems.length + postMediaDiscoveries.length;

    return this.repository.transaction(async (transaction) => {
      const summary: Record<MetaCanonicalWriteOutcome, number> = {
        inserted: 0, updated: 0, unchanged: 0, stale: 0,
      };
      if (page.assetSnapshot && transaction.materializeAccountReadCapabilities) {
        await transaction.materializeAccountReadCapabilities(this.scope, page.assetSnapshot);
      }
      for (const batch of chunks(assets, this.batchSize)) addOutcomes(summary, await transaction.upsertAssets(batch));
      for (const batch of chunks(discoveries, this.batchSize)) {
        addOutcomes(summary, await transaction.upsertDiscoveries(batch));
      }
      for (const batch of chunks(edges, this.batchSize)) addOutcomes(summary, await transaction.upsertEdges(batch));
      if (postMediaItems.length > 0 || postMediaDiscoveries.length > 0) {
        if (!transaction.upsertPostMediaItems || !transaction.upsertPostMediaDiscoveries || !transaction.validatePostMediaReferences) {
          throw persistenceError("invalid_scope", "Repository post/media inventory persistence portunu desteklemiyor");
        }
        await transaction.validatePostMediaReferences(postMediaItems, postMediaDiscoveries);
        for (const batch of chunks(postMediaItems, this.batchSize)) {
          addOutcomes(summary, await transaction.upsertPostMediaItems(batch));
        }
        for (const batch of chunks(postMediaDiscoveries, this.batchSize)) {
          addOutcomes(summary, await transaction.upsertPostMediaDiscoveries(batch));
        }
      }
      await transaction.validateReferences(content);
      for (const batch of chunks(content, this.batchSize)) addOutcomes(summary, await transaction.upsertContent(batch));
      await transaction.saveCheckpoint({
        scope: this.scope,
        sliceKey: page.sliceKey,
        cursor: page.cursor,
        checkpoint: page.checkpoint,
        summary,
      });
      return { ...summary, cursor: page.cursor, recordCount };
    });
  }
}

export function hashMetaContentPayload(value: unknown): string {
  return stableHash(value);
}
