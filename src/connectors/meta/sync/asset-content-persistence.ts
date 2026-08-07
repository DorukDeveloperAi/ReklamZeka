import type { CanonicalMetaAssetMirrorSnapshot, MetaAssetEdge, MetaMirroredAsset } from "@/domain/meta/asset-mirror";
import type { MetaAdContentExtraction } from "@/domain/meta/content/extract";
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

export type MetaContentRow = Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
  record: MetaAdContentRecord;
}>;

export interface MetaAssetContentTransaction {
  /**
   * Implementations use INSERT ... ON CONFLICT and compare revision + hash:
   * stale never mutates canonical data, unchanged may advance last_seen only,
   * and updated replaces canonical fields only for a newer/equal revision.
   */
  upsertAssets(rows: readonly MetaAssetRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
  upsertEdges(rows: readonly MetaAssetEdgeRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
  upsertContent(rows: readonly MetaContentRow[]): Promise<readonly MetaCanonicalWriteOutcome[]>;
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
  edge(scope: ResolvedMetaAssetContentScope, edge: MetaAssetEdge): MetaAssetEdgeRow;
  content(scope: ResolvedMetaAssetContentScope, record: MetaAdContentRecord): MetaContentRow;
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
    page.content.forEach(validateRecord);

    const assets = page.assetSnapshot?.assets.map((asset) => this.mapper.asset(this.scope, asset)) ?? [];
    const edges = page.assetSnapshot?.edges.map((edge) => {
      const row = this.mapper.edge(this.scope, edge);
      if (edge.sourceType === "ad_account" && !row.adAccountId) {
        throw persistenceError("cross_account", "Asset edge run kapsamı dışındaki reklam hesabına ait");
      }
      return row;
    }) ?? [];
    const content = page.content.map((record) => this.mapper.content(this.scope, record));
    const recordCount = assets.length + edges.length + content.length;

    return this.repository.transaction(async (transaction) => {
      const summary: Record<MetaCanonicalWriteOutcome, number> = {
        inserted: 0, updated: 0, unchanged: 0, stale: 0,
      };
      for (const batch of chunks(assets, this.batchSize)) addOutcomes(summary, await transaction.upsertAssets(batch));
      for (const batch of chunks(edges, this.batchSize)) addOutcomes(summary, await transaction.upsertEdges(batch));
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
