import {
  and,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  classifyMetaCanonicalDelta,
  hashMetaContentPayload,
  MetaAssetContentPersistenceError,
  type MetaAssetContentRepository,
  type MetaAssetContentScope,
  type MetaAssetContentTransaction,
  type MetaAssetDiscoveryRow,
  type MetaAssetEdgeRow,
  type MetaAssetRow,
  type MetaCanonicalVersion,
  type MetaCanonicalWriteOutcome,
  type MetaContentRow,
  type ResolvedMetaAssetContentScope,
} from "./asset-content-persistence";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;

type ExistingVersion = Readonly<{
  sourceRevision: string;
  sourcePayloadHash: string;
}>;

type ActorReference = Readonly<{
  id: string;
  externalAssetId: string;
}>;

const incomingRevision = sql<string>`excluded.provenance ->> 'sourceRevision'`;

/** Numeric revisions compare numerically; ISO timestamps and opaque revisions compare lexically. */
function revisionCanReplace(currentProvenance: SQLWrapper) {
  const current = sql<string>`${currentProvenance} ->> 'sourceRevision'`;
  return sql<boolean>`case
    when ${current} ~ '^-?[0-9]+([.][0-9]+)?$'
      and ${incomingRevision} ~ '^-?[0-9]+([.][0-9]+)?$'
      then (${incomingRevision})::numeric >= (${current})::numeric
    else ${incomingRevision} >= ${current}
  end`;
}

function asVersion(
  provenance: Record<string, unknown>,
  sourcePayloadHash: string,
): ExistingVersion {
  return {
    sourceRevision: typeof provenance.sourceRevision === "string" ? provenance.sourceRevision : "",
    sourcePayloadHash,
  };
}

function outcome(
  current: ExistingVersion | undefined,
  incoming: MetaCanonicalVersion,
): MetaCanonicalWriteOutcome {
  return classifyMetaCanonicalDelta(current ?? null, incoming);
}

function compareRevision(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right);
}

function latestRowsBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
  revision: (row: T) => string,
): T[] {
  const result = new Map<string, T>();
  for (const row of rows) {
    const identity = key(row);
    const current = result.get(identity);
    if (!current || compareRevision(revision(row), revision(current)) >= 0) result.set(identity, row);
  }
  return [...result.values()];
}

function persistenceError(
  code: MetaAssetContentPersistenceError["code"],
  message: string,
): MetaAssetContentPersistenceError {
  return new MetaAssetContentPersistenceError(code, message);
}

function contentActorExternalIds(row: MetaContentRow): readonly string[] {
  const post = row.record.extraction.post;
  return [post?.actorPageExternalId, post?.actorInstagramExternalId]
    .filter((value): value is string => Boolean(value));
}

function actorFor(
  actors: ReadonlyMap<string, ActorReference>,
  row: MetaContentRow,
): ActorReference | null {
  const post = row.record.extraction.post;
  if (!post) return null;
  const preferred = post.platform === "instagram"
    ? [post.actorInstagramExternalId, post.actorPageExternalId]
    : [post.actorPageExternalId, post.actorInstagramExternalId];
  for (const externalId of preferred) {
    if (!externalId) continue;
    const actor = actors.get(externalId);
    if (actor) return actor;
  }
  return null;
}

function canonicalPostRevision(row: MetaContentRow): Record<string, unknown> {
  const post = row.record.extraction.post;
  return {
    sourceRevision: row.record.sourceRevision,
    identitySource: post?.identitySource ?? null,
    identities: post?.identities ?? [],
    fieldSources: post?.provenance ?? {},
  };
}

function canonicalCreativeRevision(row: MetaContentRow): Record<string, unknown> {
  return {
    sourceRevision: row.record.sourceRevision,
    issues: row.record.extraction.issues,
  };
}

/**
 * Concrete S1.4 persistence repository. The caller finishes Graph I/O before
 * invoking transaction(), so this class only performs bounded database work.
 */
export class DrizzleMetaAssetContentRepository implements MetaAssetContentRepository {
  constructor(private readonly database: ReklamZekaDatabase) {}

  async resolveRunScope(scope: MetaAssetContentScope): Promise<ResolvedMetaAssetContentScope> {
    const connections = await this.database
      .select({ id: schema.metaConnections.id })
      .from(schema.metaConnections)
      .where(and(
        eq(schema.metaConnections.id, scope.connectionId),
        eq(schema.metaConnections.workspaceId, scope.workspaceId),
        eq(schema.metaConnections.externalConnectionKey, scope.connectionExternalKey),
      ))
      .limit(1);
    if (!connections[0]) {
      throw persistenceError("invalid_scope", "Meta bağlantı kapsamı doğrulanamadı");
    }

    const accounts = await this.database
      .select({ id: schema.adAccounts.id, externalId: schema.adAccounts.externalAccountId })
      .from(schema.adAccounts)
      .innerJoin(schema.dataSources, eq(schema.adAccounts.dataSourceId, schema.dataSources.id))
      .where(and(
        eq(schema.adAccounts.workspaceId, scope.workspaceId),
        eq(schema.dataSources.workspaceId, scope.workspaceId),
        eq(schema.dataSources.metaConnectionId, scope.connectionId),
      ));

    return {
      ...scope,
      accountIdByExternalId: new Map(accounts.map((account) => [account.externalId, account.id])),
    };
  }

  transaction<T>(work: (transaction: MetaAssetContentTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction(async (databaseTransaction) => {
      const database = databaseTransaction as ReklamZekaDatabase;
      return work({
        upsertAssets: (rows) => this.upsertAssets(database, rows),
        upsertDiscoveries: (rows) => this.upsertDiscoveries(database, rows),
        upsertEdges: (rows) => this.upsertEdges(database, rows),
        validateReferences: (rows) => this.validateReferences(database, rows),
        upsertContent: (rows) => this.upsertContent(database, rows),
        saveCheckpoint: (input) => this.saveCheckpoint(database, input),
      });
    });
  }

  private async upsertDiscoveries(
    database: ReklamZekaDatabase,
    rows: readonly MetaAssetDiscoveryRow[],
  ): Promise<readonly MetaCanonicalWriteOutcome[]> {
    if (rows.length === 0) return [];
    const discoveryKey = (row: MetaAssetDiscoveryRow) =>
      `${row.discovery.sourceType}:${row.discovery.sourceExternalId ?? "connection"}:${row.discovery.resource}`;
    const keys = [...new Set(rows.map(discoveryKey))];
    const currentRows = await database.select({
      discoveryKey: schema.metaAssetDiscoveries.discoveryKey,
      provenance: schema.metaAssetDiscoveries.provenance,
      rawPayloadHash: schema.metaAssetDiscoveries.rawPayloadHash,
    }).from(schema.metaAssetDiscoveries).where(and(
      eq(schema.metaAssetDiscoveries.workspaceId, rows[0]!.workspaceId),
      eq(schema.metaAssetDiscoveries.metaConnectionId, rows[0]!.connectionId),
      inArray(schema.metaAssetDiscoveries.discoveryKey, keys),
    ));
    const current = new Map(currentRows.map((row) => [
      row.discoveryKey,
      asVersion(row.provenance, row.rawPayloadHash),
    ]));
    const outcomes = rows.map((row) => outcome(
      current.get(discoveryKey(row)),
      {
        sourceRevision: row.sourceRevision,
        sourcePayloadHash: row.discovery.provenance.rawPayloadHash,
      },
    ));
    const now = new Date();
    const canonicalRows = latestRowsBy(rows, discoveryKey, (row) => row.sourceRevision);
    await database.insert(schema.metaAssetDiscoveries).values(canonicalRows.map((row) => ({
      workspaceId: row.workspaceId,
      metaConnectionId: row.connectionId,
      adAccountId: row.adAccountId,
      discoveryKey: discoveryKey(row),
      resource: row.discovery.resource,
      sourceType: row.discovery.sourceType,
      sourceExternalId: row.discovery.sourceExternalId,
      status: row.discovery.status,
      reason: row.discovery.reason,
      itemCount: row.discovery.itemCount,
      sourceEdge: row.discovery.provenance.sourceEdge,
      rawPayloadHash: row.discovery.provenance.rawPayloadHash,
      sourceGraphVersion: row.discovery.provenance.sourceGraphVersion,
      fieldCatalogVersion: row.discovery.provenance.fieldCatalogVersion,
      provenance: { ...row.discovery.provenance, sourceRevision: row.sourceRevision },
      fetchedAt: new Date(row.discovery.provenance.fetchedAt),
      lastSeenAt: now,
    }))).onConflictDoUpdate({
      target: [
        schema.metaAssetDiscoveries.workspaceId,
        schema.metaAssetDiscoveries.metaConnectionId,
        schema.metaAssetDiscoveries.discoveryKey,
      ],
      set: {
        adAccountId: sql`excluded.ad_account_id`,
        resource: sql`excluded.resource`,
        sourceType: sql`excluded.source_type`,
        sourceExternalId: sql`excluded.source_external_id`,
        status: sql`excluded.status`,
        reason: sql`excluded.reason`,
        itemCount: sql`excluded.item_count`,
        sourceEdge: sql`excluded.source_edge`,
        rawPayloadHash: sql`excluded.raw_payload_hash`,
        sourceGraphVersion: sql`excluded.source_graph_version`,
        fieldCatalogVersion: sql`excluded.field_catalog_version`,
        provenance: sql`excluded.provenance`,
        fetchedAt: sql`excluded.fetched_at`,
        lastSeenAt: now,
      },
      setWhere: revisionCanReplace(schema.metaAssetDiscoveries.provenance),
    });
    return outcomes;
  }

  private async upsertAssets(
    database: ReklamZekaDatabase,
    rows: readonly MetaAssetRow[],
  ): Promise<readonly MetaCanonicalWriteOutcome[]> {
    if (rows.length === 0) return [];
    const externalIds = [...new Set(rows.map((row) => row.asset.externalAssetId))];
    const currentRows = await database
      .select({
        assetType: schema.metaAssets.assetType,
        externalAssetId: schema.metaAssets.externalAssetId,
        provenance: schema.metaAssets.provenance,
        rawPayloadHash: schema.metaAssets.rawPayloadHash,
      })
      .from(schema.metaAssets)
      .where(and(
        eq(schema.metaAssets.workspaceId, rows[0]!.workspaceId),
        eq(schema.metaAssets.metaConnectionId, rows[0]!.connectionId),
        inArray(schema.metaAssets.externalAssetId, externalIds),
      ));
    const current = new Map(currentRows.map((row) => [
      `${row.assetType}:${row.externalAssetId}`,
      asVersion(row.provenance, row.rawPayloadHash),
    ]));
    const outcomes = rows.map((row) => outcome(
      current.get(`${row.asset.assetType}:${row.asset.externalAssetId}`),
      { sourceRevision: row.sourceRevision, sourcePayloadHash: row.asset.provenance.rawPayloadHash },
    ));
    const now = new Date();
    const canonicalRows = latestRowsBy(
      rows,
      (row) => `${row.asset.assetType}:${row.asset.externalAssetId}`,
      (row) => row.sourceRevision,
    );
    await database.insert(schema.metaAssets).values(canonicalRows.map((row) => ({
      workspaceId: row.workspaceId,
      metaConnectionId: row.connectionId,
      assetType: row.asset.assetType,
      externalAssetId: row.asset.externalAssetId,
      displayName: row.asset.displayName,
      username: row.asset.username,
      ownershipKind: row.asset.ownership.kind,
      ownerBusinessExternalId: row.asset.ownership.ownerBusinessExternalId,
      ownershipEvidence: row.asset.ownership.evidence,
      capabilitySnapshot: { capabilities: row.asset.capabilities },
      orphanReason: row.asset.orphanReason,
      fetchedAt: new Date(row.asset.provenance.fetchedAt),
      rawPayloadHash: row.asset.provenance.rawPayloadHash,
      sourceGraphVersion: row.asset.provenance.sourceGraphVersion,
      fieldCatalogVersion: row.asset.provenance.fieldCatalogVersion,
      provenance: { ...row.asset.provenance, sourceRevision: row.sourceRevision },
      lastSeenAt: now,
    }))).onConflictDoUpdate({
      target: [schema.metaAssets.metaConnectionId, schema.metaAssets.assetType, schema.metaAssets.externalAssetId],
      set: {
        displayName: sql`excluded.display_name`,
        username: sql`excluded.username`,
        ownershipKind: sql`excluded.ownership_kind`,
        ownerBusinessExternalId: sql`excluded.owner_business_external_id`,
        ownershipEvidence: sql`excluded.ownership_evidence`,
        capabilitySnapshot: sql`excluded.capability_snapshot`,
        orphanReason: sql`excluded.orphan_reason`,
        fetchedAt: sql`excluded.fetched_at`,
        rawPayloadHash: sql`excluded.raw_payload_hash`,
        sourceGraphVersion: sql`excluded.source_graph_version`,
        fieldCatalogVersion: sql`excluded.field_catalog_version`,
        provenance: sql`excluded.provenance`,
        lastSeenAt: now,
        disappearedAt: null,
      },
      setWhere: revisionCanReplace(schema.metaAssets.provenance),
    });
    return outcomes;
  }

  private async upsertEdges(
    database: ReklamZekaDatabase,
    rows: readonly MetaAssetEdgeRow[],
  ): Promise<readonly MetaCanonicalWriteOutcome[]> {
    if (rows.length === 0) return [];
    const targetExternalIds = [...new Set(rows.map((row) => row.edge.targetExternalAssetId))];
    const targets = await database.select({
      id: schema.metaAssets.id,
      externalAssetId: schema.metaAssets.externalAssetId,
    }).from(schema.metaAssets).where(and(
      eq(schema.metaAssets.workspaceId, rows[0]!.workspaceId),
      eq(schema.metaAssets.metaConnectionId, rows[0]!.connectionId),
      inArray(schema.metaAssets.externalAssetId, targetExternalIds),
    ));
    const targetByExternalId = new Map<string, string>();
    for (const target of targets) {
      if (targetByExternalId.has(target.externalAssetId)) {
        throw persistenceError("invalid_scope", "Asset edge hedefi tekil değil");
      }
      targetByExternalId.set(target.externalAssetId, target.id);
    }
    if (rows.some((row) => !targetByExternalId.has(row.edge.targetExternalAssetId))) {
      throw persistenceError("invalid_scope", "Asset edge hedefi bağlantı kapsamında bulunamadı");
    }

    const targetIds = [...targetByExternalId.values()];
    const currentRows = await database.select({
      sourceEntityType: schema.metaAssetEdges.sourceEntityType,
      sourceExternalId: schema.metaAssetEdges.sourceExternalId,
      targetAssetId: schema.metaAssetEdges.targetAssetId,
      relationship: schema.metaAssetEdges.relationship,
      provenance: schema.metaAssetEdges.provenance,
      rawPayloadHash: schema.metaAssetEdges.rawPayloadHash,
    }).from(schema.metaAssetEdges).where(and(
      eq(schema.metaAssetEdges.workspaceId, rows[0]!.workspaceId),
      eq(schema.metaAssetEdges.metaConnectionId, rows[0]!.connectionId),
      inArray(schema.metaAssetEdges.targetAssetId, targetIds),
    ));
    const current = new Map(currentRows.map((row) => [
      `${row.sourceEntityType}:${row.sourceExternalId}:${row.targetAssetId}:${row.relationship}`,
      asVersion(row.provenance, row.rawPayloadHash),
    ]));
    const outcomes = rows.map((row) => {
      const targetId = targetByExternalId.get(row.edge.targetExternalAssetId)!;
      return outcome(
        current.get(`${row.edge.sourceType}:${row.edge.sourceExternalId}:${targetId}:${row.edge.relationship}`),
        { sourceRevision: row.sourceRevision, sourcePayloadHash: row.edge.provenance.rawPayloadHash },
      );
    });
    const now = new Date();
    const canonicalRows = latestRowsBy(
      rows,
      (row) => `${row.edge.sourceType}:${row.edge.sourceExternalId}:${targetByExternalId.get(row.edge.targetExternalAssetId)}:${row.edge.relationship}`,
      (row) => row.sourceRevision,
    );
    await database.insert(schema.metaAssetEdges).values(canonicalRows.map((row) => ({
      workspaceId: row.workspaceId,
      metaConnectionId: row.connectionId,
      adAccountId: row.adAccountId,
      sourceEntityType: row.edge.sourceType,
      sourceExternalId: row.edge.sourceExternalId,
      targetAssetId: targetByExternalId.get(row.edge.targetExternalAssetId)!,
      relationship: row.edge.relationship,
      rawPayloadHash: row.edge.provenance.rawPayloadHash,
      sourceGraphVersion: row.edge.provenance.sourceGraphVersion,
      fieldCatalogVersion: row.edge.provenance.fieldCatalogVersion,
      provenance: { ...row.edge.provenance, sourceRevision: row.sourceRevision },
      lastSeenAt: now,
    }))).onConflictDoUpdate({
      target: [
        schema.metaAssetEdges.metaConnectionId,
        schema.metaAssetEdges.sourceEntityType,
        schema.metaAssetEdges.sourceExternalId,
        schema.metaAssetEdges.targetAssetId,
        schema.metaAssetEdges.relationship,
      ],
      set: {
        adAccountId: sql`excluded.ad_account_id`,
        rawPayloadHash: sql`excluded.raw_payload_hash`,
        sourceGraphVersion: sql`excluded.source_graph_version`,
        fieldCatalogVersion: sql`excluded.field_catalog_version`,
        provenance: sql`excluded.provenance`,
        lastSeenAt: now,
        disappearedAt: null,
      },
      setWhere: revisionCanReplace(schema.metaAssetEdges.provenance),
    });
    return outcomes;
  }

  private async actorMap(
    database: ReklamZekaDatabase,
    rows: readonly MetaContentRow[],
  ): Promise<ReadonlyMap<string, ActorReference>> {
    const externalIds = [...new Set(rows.flatMap(contentActorExternalIds))];
    if (externalIds.length === 0) return new Map();
    const actors = await database.select({
      id: schema.metaAssets.id,
      externalAssetId: schema.metaAssets.externalAssetId,
    }).from(schema.metaAssets).where(and(
      eq(schema.metaAssets.workspaceId, rows[0]!.workspaceId),
      eq(schema.metaAssets.metaConnectionId, rows[0]!.connectionId),
      inArray(schema.metaAssets.externalAssetId, externalIds),
    ));
    const result = new Map<string, ActorReference>();
    for (const actor of actors) {
      if (result.has(actor.externalAssetId)) {
        throw persistenceError("wrong_actor", "İçerik actor referansı tekil değil");
      }
      result.set(actor.externalAssetId, actor);
    }
    return result;
  }

  private async validateReferences(
    database: ReklamZekaDatabase,
    rows: readonly MetaContentRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    if (rows.some((row) => row.workspaceId !== rows[0]!.workspaceId || row.connectionId !== rows[0]!.connectionId)) {
      throw persistenceError("invalid_scope", "İçerik batch kapsamı uyuşmuyor");
    }
    const actors = await this.actorMap(database, rows);
    for (const row of rows) {
      const expected = contentActorExternalIds(row);
      if (expected.some((externalId) => !actors.has(externalId))) {
        throw persistenceError("wrong_actor", "İçerik actor referansı bağlantı kapsamında bulunamadı");
      }
      if (row.record.extraction.post && !actorFor(actors, row)) {
        throw persistenceError("wrong_actor", "Canonical post actor referansı çözülemedi");
      }
    }

    const externalAdIds = [...new Set(rows
      .map((row) => row.record.extraction.adContext.externalAdId)
      .filter((value): value is string => Boolean(value)))];
    if (rows.some((row) => !row.record.extraction.adContext.externalAdId)) {
      throw persistenceError("invalid_page", "İçerik kaydı canonical reklam kimliği içermiyor");
    }
    const ads = await database.select({
      accountId: schema.metaAds.adAccountId,
      externalAdId: schema.metaAds.externalAdId,
    }).from(schema.metaAds).where(and(
      eq(schema.metaAds.workspaceId, rows[0]!.workspaceId),
      inArray(schema.metaAds.externalAdId, externalAdIds),
    ));
    const known = new Set(ads.map((ad) => `${ad.accountId}:${ad.externalAdId}`));
    if (rows.some((row) => !known.has(`${row.adAccountId}:${row.record.extraction.adContext.externalAdId}`))) {
      throw persistenceError("cross_account", "İçerik reklam referansı hesap kapsamında bulunamadı");
    }
  }

  private async upsertContent(
    database: ReklamZekaDatabase,
    rows: readonly MetaContentRow[],
  ): Promise<readonly MetaCanonicalWriteOutcome[]> {
    if (rows.length === 0) return [];
    const actors = await this.actorMap(database, rows);
    const externalCreativeIds = [...new Set(rows
      .map((row) => row.record.extraction.creative.externalCreativeId)
      .filter((value): value is string => Boolean(value)))];
    if (rows.some((row) => !row.record.extraction.creative.externalCreativeId)) {
      throw persistenceError("invalid_page", "İçerik kaydı canonical creative kimliği içermiyor");
    }

    const currentCreatives = await database.select({
      adAccountId: schema.metaCreatives.adAccountId,
      externalCreativeId: schema.metaCreatives.externalCreativeId,
      provenance: schema.metaCreatives.provenance,
      rawPayloadHash: schema.metaCreatives.rawPayloadHash,
    }).from(schema.metaCreatives).where(and(
      eq(schema.metaCreatives.workspaceId, rows[0]!.workspaceId),
      inArray(schema.metaCreatives.externalCreativeId, externalCreativeIds),
    ));
    const current = new Map(currentCreatives.map((creative) => [
      `${creative.adAccountId}:${creative.externalCreativeId}`,
      asVersion(creative.provenance, creative.rawPayloadHash),
    ]));
    const outcomes = rows.map((row) => outcome(
      current.get(`${row.adAccountId}:${row.record.extraction.creative.externalCreativeId}`),
      { sourceRevision: row.record.sourceRevision, sourcePayloadHash: row.record.sourcePayloadHash },
    ));
    const now = new Date();

    // A stale content record must not backfill a missing post/binding or rebind
    // the ad. Unchanged rows remain accepted so last_seen can advance.
    const acceptedRows = rows.filter((_, index) => outcomes[index] !== "stale");
    if (acceptedRows.length === 0) return outcomes;

    const postRows = latestRowsBy(
      acceptedRows.filter((row) => row.record.extraction.post !== null),
      (row) => row.record.extraction.post!.externalPostId,
      (row) => row.record.sourceRevision,
    );
    if (postRows.length > 0) {
      await database.insert(schema.metaPosts).values(postRows.map((row) => {
        const post = row.record.extraction.post!;
        return {
          workspaceId: row.workspaceId,
          metaConnectionId: row.connectionId,
          actorAssetId: actorFor(actors, row)?.id ?? null,
          externalPostId: post.externalPostId,
          externalMediaId: post.externalMediaId,
          mediaType: post.mediaType,
          permalink: post.permalink,
          contentHash: hashMetaContentPayload({
            post: {
              externalPostId: post.externalPostId,
              platform: post.platform,
              externalMediaId: post.externalMediaId,
              mediaType: post.mediaType,
              permalink: post.permalink,
            },
            visibleCreative: {
              primaryText: row.record.extraction.creative.primaryText,
              headline: row.record.extraction.creative.headline,
              description: row.record.extraction.creative.description,
              caption: row.record.extraction.creative.caption,
              callToActionType: row.record.extraction.creative.callToActionType,
              destinationUrl: row.record.extraction.creative.destinationUrl,
              dynamicVariants: row.record.extraction.creative.dynamicVariants,
            },
          }),
          fetchedAt: new Date(row.record.fetchedAt),
          rawPayloadHash: row.record.sourcePayloadHash,
          sourceGraphVersion: row.record.sourceGraphVersion,
          fieldCatalogVersion: row.record.fieldCatalogVersion,
          provenance: canonicalPostRevision(row),
          lastSeenAt: now,
        };
      })).onConflictDoUpdate({
        target: [schema.metaPosts.metaConnectionId, schema.metaPosts.externalPostId],
        set: {
          actorAssetId: sql`excluded.actor_asset_id`,
          externalMediaId: sql`excluded.external_media_id`,
          mediaType: sql`excluded.media_type`,
          permalink: sql`excluded.permalink`,
          contentHash: sql`excluded.content_hash`,
          fetchedAt: sql`excluded.fetched_at`,
          rawPayloadHash: sql`excluded.raw_payload_hash`,
          sourceGraphVersion: sql`excluded.source_graph_version`,
          fieldCatalogVersion: sql`excluded.field_catalog_version`,
          provenance: sql`excluded.provenance`,
          lastSeenAt: now,
          disappearedAt: null,
        },
        setWhere: revisionCanReplace(schema.metaPosts.provenance),
      });
    }

    const externalPostIds = [...new Set(postRows.map((row) => row.record.extraction.post!.externalPostId))];
    const persistedPosts = externalPostIds.length === 0 ? [] : await database.select({
      id: schema.metaPosts.id,
      externalPostId: schema.metaPosts.externalPostId,
    }).from(schema.metaPosts).where(and(
      eq(schema.metaPosts.workspaceId, rows[0]!.workspaceId),
      eq(schema.metaPosts.metaConnectionId, rows[0]!.connectionId),
      inArray(schema.metaPosts.externalPostId, externalPostIds),
    ));
    const postByExternalId = new Map(persistedPosts.map((post) => [post.externalPostId, post.id]));
    if (externalPostIds.some((externalId) => !postByExternalId.has(externalId))) {
      throw persistenceError("wrong_post", "Canonical post bağlantı kapsamında çözülemedi");
    }

    const canonicalCreativeRows = latestRowsBy(
      acceptedRows,
      (row) => `${row.adAccountId}:${row.record.extraction.creative.externalCreativeId}`,
      (row) => row.record.sourceRevision,
    );
    await database.insert(schema.metaCreatives).values(canonicalCreativeRows.map((row) => {
      const extraction = row.record.extraction;
      return {
        workspaceId: row.workspaceId,
        adAccountId: row.adAccountId,
        postId: extraction.post ? postByExternalId.get(extraction.post.externalPostId) ?? null : null,
        actorAssetId: actorFor(actors, row)?.id ?? null,
        externalCreativeId: extraction.creative.externalCreativeId!,
        name: extraction.creative.name,
        sourceType: extraction.creative.sourceType,
        primaryText: extraction.creative.primaryText,
        headline: extraction.creative.headline,
        description: extraction.creative.description,
        caption: extraction.creative.caption,
        callToActionType: extraction.creative.callToActionType,
        destinationUrl: extraction.creative.destinationUrl,
        creativeFormat: extraction.creative.creativeFormat,
        contentProvenance: extraction.creative.contentProvenance,
        dynamicVariants: extraction.creative.dynamicVariants,
        unsupportedFields: extraction.issues,
        effectiveStatus: extraction.adContext.effectiveStatus,
        fetchedAt: new Date(row.record.fetchedAt),
        rawPayloadHash: row.record.sourcePayloadHash,
        sourceGraphVersion: row.record.sourceGraphVersion,
        fieldCatalogVersion: row.record.fieldCatalogVersion,
        provenance: canonicalCreativeRevision(row),
        lastSeenAt: now,
      };
    })).onConflictDoUpdate({
      target: [schema.metaCreatives.adAccountId, schema.metaCreatives.externalCreativeId],
      set: {
        postId: sql`excluded.post_id`,
        actorAssetId: sql`excluded.actor_asset_id`,
        name: sql`excluded.name`,
        sourceType: sql`excluded.source_type`,
        primaryText: sql`excluded.primary_text`,
        headline: sql`excluded.headline`,
        description: sql`excluded.description`,
        caption: sql`excluded.caption`,
        callToActionType: sql`excluded.call_to_action_type`,
        destinationUrl: sql`excluded.destination_url`,
        creativeFormat: sql`excluded.creative_format`,
        contentProvenance: sql`excluded.content_provenance`,
        dynamicVariants: sql`excluded.dynamic_variants`,
        unsupportedFields: sql`excluded.unsupported_fields`,
        effectiveStatus: sql`excluded.effective_status`,
        fetchedAt: sql`excluded.fetched_at`,
        rawPayloadHash: sql`excluded.raw_payload_hash`,
        sourceGraphVersion: sql`excluded.source_graph_version`,
        fieldCatalogVersion: sql`excluded.field_catalog_version`,
        provenance: sql`excluded.provenance`,
        lastSeenAt: now,
        disappearedAt: null,
      },
      setWhere: revisionCanReplace(schema.metaCreatives.provenance),
    });

    const creatives = await database.select({
      id: schema.metaCreatives.id,
      adAccountId: schema.metaCreatives.adAccountId,
      externalCreativeId: schema.metaCreatives.externalCreativeId,
      postId: schema.metaCreatives.postId,
    }).from(schema.metaCreatives).where(and(
      eq(schema.metaCreatives.workspaceId, rows[0]!.workspaceId),
      inArray(schema.metaCreatives.externalCreativeId, externalCreativeIds),
    ));
    const creativeByKey = new Map(creatives.map((creative) => [
      `${creative.adAccountId}:${creative.externalCreativeId}`,
      creative,
    ]));
    const externalAdIds = acceptedRows.map((row) => row.record.extraction.adContext.externalAdId!);
    const ads = await database.select({
      id: schema.metaAds.id,
      adAccountId: schema.metaAds.adAccountId,
      externalAdId: schema.metaAds.externalAdId,
    }).from(schema.metaAds).where(and(
      eq(schema.metaAds.workspaceId, rows[0]!.workspaceId),
      inArray(schema.metaAds.externalAdId, externalAdIds),
    ));
    const adByKey = new Map(ads.map((ad) => [`${ad.adAccountId}:${ad.externalAdId}`, ad]));

    const bindings = latestRowsBy(acceptedRows.map((row) => {
      const creative = creativeByKey.get(`${row.adAccountId}:${row.record.extraction.creative.externalCreativeId}`);
      const ad = adByKey.get(`${row.adAccountId}:${row.record.extraction.adContext.externalAdId}`);
      if (!creative || !ad) throw persistenceError("cross_account", "Reklam/creative bağı hesap kapsamında çözülemedi");
      return {
        workspaceId: row.workspaceId,
        adId: ad.id,
        creativeId: creative.id,
        postId: creative.postId,
        bindingPayloadHash: row.record.sourcePayloadHash,
        provenance: {
          sourceRevision: row.record.sourceRevision,
          sourceGraphVersion: row.record.sourceGraphVersion,
          fieldCatalogVersion: row.record.fieldCatalogVersion,
        },
        lastSeenAt: now,
      };
    }), (binding) => `${binding.adId}:${binding.creativeId}`, (binding) => String(binding.provenance.sourceRevision));
    if (bindings.length > 0) {
      await database.insert(schema.metaAdCreativeBindings).values(bindings).onConflictDoUpdate({
        target: [schema.metaAdCreativeBindings.adId, schema.metaAdCreativeBindings.creativeId],
        set: {
          postId: sql`excluded.post_id`,
          bindingPayloadHash: sql`excluded.binding_payload_hash`,
          provenance: sql`excluded.provenance`,
          lastSeenAt: now,
          disappearedAt: null,
        },
        setWhere: revisionCanReplace(schema.metaAdCreativeBindings.provenance),
      });
      const caseBranches = bindings.map((binding) =>
        sql`when ${binding.adId}::uuid then ${binding.creativeId}::uuid`);
      await database.update(schema.metaAds).set({
        creativeId: sql`case ${schema.metaAds.id} ${sql.join(caseBranches, sql.raw(" "))} else ${schema.metaAds.creativeId} end`,
        lastSeenAt: now,
      }).where(and(
        eq(schema.metaAds.workspaceId, rows[0]!.workspaceId),
        inArray(schema.metaAds.id, bindings.map((binding) => binding.adId)),
      ));
    }
    return outcomes;
  }

  private async saveCheckpoint(
    database: ReklamZekaDatabase,
    input: Parameters<MetaAssetContentTransaction["saveCheckpoint"]>[0],
  ): Promise<void> {
    const sliceRows = await database.select({
      id: schema.metaSyncSlices.id,
      runId: schema.metaSyncSlices.runId,
      checkpoint: schema.metaSyncSlices.checkpoint,
      streamId: schema.metaSyncRuns.streamId,
      runCheckpoint: schema.metaSyncRuns.checkpoint,
      streamCheckpoint: schema.metaSyncStreams.checkpoint,
    }).from(schema.metaSyncSlices)
      .innerJoin(schema.metaSyncRuns, eq(schema.metaSyncSlices.runId, schema.metaSyncRuns.id))
      .innerJoin(schema.metaSyncStreams, eq(schema.metaSyncRuns.streamId, schema.metaSyncStreams.id))
      .where(and(
        eq(schema.metaSyncSlices.workspaceId, input.scope.workspaceId),
        eq(schema.metaSyncSlices.metaConnectionId, input.scope.connectionId),
        eq(schema.metaSyncSlices.sliceKey, input.sliceKey),
      ))
      .orderBy(desc(schema.metaSyncSlices.createdAt))
      .limit(1);
    const target = sliceRows[0];
    if (!target) {
      throw persistenceError("invalid_scope", "Checkpoint için mevcut sync slice bulunamadı");
    }
    const assetContentCheckpoint = {
      cursor: input.cursor,
      checkpoint: input.checkpoint,
      summary: input.summary,
    };
    const now = new Date();
    await database.update(schema.metaSyncSlices).set({
      cursor: input.cursor,
      checkpoint: { ...target.checkpoint, assetContent: assetContentCheckpoint },
    }).where(eq(schema.metaSyncSlices.id, target.id));
    await database.update(schema.metaSyncRuns).set({
      cursor: input.cursor,
      checkpoint: { ...target.runCheckpoint, assetContent: assetContentCheckpoint },
    }).where(and(
      eq(schema.metaSyncRuns.id, target.runId),
      eq(schema.metaSyncRuns.workspaceId, input.scope.workspaceId),
      eq(schema.metaSyncRuns.metaConnectionId, input.scope.connectionId),
    ));
    await database.update(schema.metaSyncStreams).set({
      cursor: input.cursor,
      checkpoint: { ...target.streamCheckpoint, assetContent: assetContentCheckpoint },
      updatedAt: now,
    }).where(and(
      eq(schema.metaSyncStreams.id, target.streamId),
      eq(schema.metaSyncStreams.workspaceId, input.scope.workspaceId),
      eq(schema.metaSyncStreams.metaConnectionId, input.scope.connectionId),
    ));
  }
}
