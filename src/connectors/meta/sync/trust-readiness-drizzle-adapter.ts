import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  buildMetaTrustReadinessReport,
  META_TRUST_READINESS_SCHEMA_VERSION,
  type MetaTrustReadinessInput,
  type MetaTrustReadinessReport,
  type TrustAccountEvidence,
  type TrustPermission,
  type TrustReadinessThresholdOverrides,
  type TrustStreamEvidence,
} from "@/domain/meta/trust-readiness";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type PersistedStream = typeof schema.metaSyncStreamType.enumValues[number];

export type MetaTrustReadinessScope = Readonly<{
  workspaceId: string;
  connectionId: string;
  selectedExternalAccountIds: readonly string[];
  evaluatedAt: string;
  portfolioSegmentation?: Readonly<{ timezone: boolean; attribution: boolean }>;
}>;

type StoredPermissionEvidence = Readonly<{
  status: typeof schema.metaSyncRunStatus.enumValues[number] | null;
  error: typeof schema.metaSyncErrorClassification.enumValues[number] | null;
}>;

export type MetaTrustStoredAccountEvidence = Readonly<{
  workspaceId: string;
  connectionId: string;
  internalAccountId: string;
  externalAccountId: string;
  currency: string | null;
  timezone: string | null;
  attributionWindows: readonly string[] | null;
  streams: readonly TrustStreamEvidence[];
}>;

export interface MetaTrustReadStore {
  readScopedAccounts(scope: MetaTrustReadinessScope): Promise<readonly MetaTrustStoredAccountEvidence[]>;
}

export class MetaTrustReadinessScopeError extends Error {
  constructor(
    readonly code: "invalid_scope" | "duplicate_selection" | "account_scope_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "MetaTrustReadinessScopeError";
  }
}

function nullableCount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nullableIso(value: Date | null | undefined): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function latestIso(values: readonly (Date | null | undefined)[]): string | null {
  const timestamps = values
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    .map((value) => value.getTime());
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

/** An expected count smaller than the mirror cannot prove denominator coverage. */
function conservativeExpected(expected: number | null, observed: number | null): number | null {
  if (expected === null || observed === null || expected < observed) return null;
  return expected;
}

function permissionFromStream(evidence: StoredPermissionEvidence | null): TrustPermission {
  if (!evidence) return { status: "unknown", reason: "not_checked" };
  if (evidence.error === "permission_missing") {
    return { status: "permission_missing", reason: "asset_access_missing" };
  }
  if (evidence.error === "unsupported") {
    return { status: "unsupported", reason: "api_edge_unsupported" };
  }
  if (evidence.status === "completed" || evidence.status === "partial") {
    return { status: "verified", reason: "none" };
  }
  return { status: "unknown", reason: "not_checked" };
}

function permissionFromDiscoveries(
  statuses: readonly typeof schema.metaAssetDiscoveryStatus.enumValues[number][],
): TrustPermission {
  if (statuses.some((status) => status === "verified" || status === "empty" || status === "partial")) {
    return { status: "verified", reason: "none" };
  }
  if (statuses.includes("permission_missing")) {
    return { status: "permission_missing", reason: "asset_access_missing" };
  }
  if (statuses.length > 0 && statuses.every((status) => status === "unsupported")) {
    return { status: "unsupported", reason: "api_edge_unsupported" };
  }
  return { status: "unknown", reason: "not_checked" };
}

function notApplicableCoverage() {
  return { expected: 0, observed: 0 } as const;
}

function streamEvidence(input: Omit<TrustStreamEvidence, "coverage"> & {
  entityExpected: number | null;
  entityObserved: number | null;
  metricExpected?: number | null;
  metricObserved?: number | null;
  contentExpected?: number | null;
  contentObserved?: number | null;
}): TrustStreamEvidence {
  return {
    stream: input.stream,
    required: input.required,
    permission: input.permission,
    lastSuccessfulAt: input.lastSuccessfulAt,
    coverage: {
      entity: { expected: input.entityExpected, observed: input.entityObserved },
      metric: input.metricExpected === undefined && input.metricObserved === undefined
        ? notApplicableCoverage()
        : { expected: input.metricExpected ?? null, observed: input.metricObserved ?? null },
      content: input.contentExpected === undefined && input.contentObserved === undefined
        ? notApplicableCoverage()
        : { expected: input.contentExpected ?? null, observed: input.contentObserved ?? null },
    },
    orphanCount: input.orphanCount,
    duplicateCount: input.duplicateCount,
    replayCount: input.replayCount,
    entityIdentityKeys: input.entityIdentityKeys,
  };
}

/**
 * Validates that a store did not broaden the requested tenant/account scope.
 * It intentionally retains external IDs only in the private domain input; the
 * public report hashes them and never exposes identity keys.
 */
export function metaTrustInputFromStoredEvidence(
  scope: MetaTrustReadinessScope,
  stored: readonly MetaTrustStoredAccountEvidence[],
): MetaTrustReadinessInput {
  if (!scope.workspaceId || !scope.connectionId || !Number.isFinite(Date.parse(scope.evaluatedAt))) {
    throw new MetaTrustReadinessScopeError("invalid_scope", "Trust/readiness kapsamı geçersiz");
  }
  const selected = scope.selectedExternalAccountIds.map((id) => id.trim()).filter(Boolean);
  if (selected.length === 0) {
    throw new MetaTrustReadinessScopeError("invalid_scope", "En az bir reklam hesabı seçilmelidir");
  }
  if (new Set(selected).size !== selected.length) {
    throw new MetaTrustReadinessScopeError("duplicate_selection", "Reklam hesabı seçimi tekrarlı olamaz");
  }
  const selectedSet = new Set(selected);
  const returned = new Set<string>();
  for (const account of stored) {
    if (
      account.workspaceId !== scope.workspaceId
      || account.connectionId !== scope.connectionId
      || !selectedSet.has(account.externalAccountId)
      || returned.has(account.externalAccountId)
    ) {
      throw new MetaTrustReadinessScopeError("account_scope_mismatch", "Evidence store istek kapsamını aştı");
    }
    returned.add(account.externalAccountId);
  }
  if (returned.size !== selectedSet.size || selected.some((id) => !returned.has(id))) {
    throw new MetaTrustReadinessScopeError("account_scope_mismatch", "Seçili reklam hesabı kapsamı doğrulanamadı");
  }

  const accounts: TrustAccountEvidence[] = stored.map((account) => ({
    externalAccountId: account.externalAccountId,
    streams: account.streams,
    currencies: account.currency ? [account.currency] : null,
    timezones: account.timezone ? [account.timezone] : null,
    attributionWindows: account.attributionWindows,
  }));
  return {
    schemaVersion: META_TRUST_READINESS_SCHEMA_VERSION,
    evaluatedAt: new Date(scope.evaluatedAt).toISOString(),
    accounts,
    ...(scope.portfolioSegmentation ? { portfolioSegmentation: scope.portfolioSegmentation } : {}),
  };
}

export class MetaTrustReadinessEvidenceAdapter {
  constructor(private readonly store: MetaTrustReadStore) {}

  async readInput(scope: MetaTrustReadinessScope): Promise<MetaTrustReadinessInput> {
    return metaTrustInputFromStoredEvidence(scope, await this.store.readScopedAccounts(scope));
  }

  async buildReport(
    scope: MetaTrustReadinessScope,
    thresholds?: TrustReadinessThresholdOverrides,
  ): Promise<MetaTrustReadinessReport> {
    return buildMetaTrustReadinessReport(await this.readInput(scope), thresholds);
  }
}

/** Read-only evidence projection over the canonical Meta mirror tables. */
export class DrizzleMetaTrustReadStore implements MetaTrustReadStore {
  constructor(private readonly database: ReklamZekaDatabase) {}

  async readScopedAccounts(scope: MetaTrustReadinessScope): Promise<readonly MetaTrustStoredAccountEvidence[]> {
    const requested = [...new Set(scope.selectedExternalAccountIds.map((id) => id.trim()).filter(Boolean))];
    if (requested.length === 0) return [];
    const accounts = await this.database.select({
      workspaceId: schema.adAccounts.workspaceId,
      connectionId: schema.dataSources.metaConnectionId,
      internalAccountId: schema.adAccounts.id,
      externalAccountId: schema.adAccounts.externalAccountId,
      currency: schema.adAccounts.currency,
      timezone: schema.adAccounts.timezone,
    }).from(schema.adAccounts)
      .innerJoin(schema.dataSources, eq(schema.adAccounts.dataSourceId, schema.dataSources.id))
      .innerJoin(schema.metaConnections, eq(schema.dataSources.metaConnectionId, schema.metaConnections.id))
      .where(and(
        eq(schema.adAccounts.workspaceId, scope.workspaceId),
        eq(schema.dataSources.workspaceId, scope.workspaceId),
        eq(schema.metaConnections.workspaceId, scope.workspaceId),
        eq(schema.metaConnections.id, scope.connectionId),
        inArray(schema.adAccounts.externalAccountId, requested),
      ));

    const result: MetaTrustStoredAccountEvidence[] = [];
    // Keep account reads bounded; a five-account portfolio must not fan out all
    // evidence queries at once against a transaction-pooler connection budget.
    for (const account of accounts) {
      const [attributions, hierarchy, insights, content, assets] = await Promise.all([
        this.attributionWindows(scope, account.internalAccountId),
        this.hierarchyEvidence(scope, account.internalAccountId),
        this.insightEvidence(scope, account.internalAccountId),
        this.contentEvidence(scope, account.internalAccountId),
        this.assetEvidence(scope, account.internalAccountId),
      ]);
      result.push({
        workspaceId: account.workspaceId,
        connectionId: account.connectionId!,
        internalAccountId: account.internalAccountId,
        externalAccountId: account.externalAccountId,
        currency: account.currency || null,
        timezone: account.timezone || null,
        attributionWindows: attributions,
        streams: [hierarchy, insights, content, assets],
      });
    }
    return result;
  }

  private async latestStream(
    scope: MetaTrustReadinessScope,
    accountId: string,
    stream: PersistedStream,
  ): Promise<StoredPermissionEvidence | null> {
    const rows = await this.database.select({
      status: schema.metaSyncStreams.status,
      error: schema.metaSyncStreams.lastErrorClassification,
    }).from(schema.metaSyncStreams).where(and(
      eq(schema.metaSyncStreams.workspaceId, scope.workspaceId),
      eq(schema.metaSyncStreams.metaConnectionId, scope.connectionId),
      eq(schema.metaSyncStreams.adAccountId, accountId),
      eq(schema.metaSyncStreams.streamType, stream),
    )).orderBy(desc(schema.metaSyncStreams.updatedAt)).limit(1);
    return rows[0] ?? null;
  }

  private async latestCompletedAt(scope: MetaTrustReadinessScope, accountId: string, stream: PersistedStream) {
    const [runs, slices] = await Promise.all([
      this.database.select({ value: max(schema.metaSyncRuns.finishedAt) }).from(schema.metaSyncRuns).where(and(
        eq(schema.metaSyncRuns.workspaceId, scope.workspaceId),
        eq(schema.metaSyncRuns.metaConnectionId, scope.connectionId),
        eq(schema.metaSyncRuns.adAccountId, accountId),
        eq(schema.metaSyncRuns.streamType, stream),
        eq(schema.metaSyncRuns.status, "completed"),
      )),
      this.database.select({ value: max(schema.metaSyncSlices.completedAt) }).from(schema.metaSyncSlices).where(and(
        eq(schema.metaSyncSlices.workspaceId, scope.workspaceId),
        eq(schema.metaSyncSlices.metaConnectionId, scope.connectionId),
        eq(schema.metaSyncSlices.adAccountId, accountId),
        eq(schema.metaSyncSlices.streamType, stream),
        eq(schema.metaSyncSlices.status, "completed"),
      )),
    ]);
    return latestIso([runs[0]?.value, slices[0]?.value]);
  }

  private async ledgerStats(scope: MetaTrustReadinessScope, accountId: string, stream: PersistedStream) {
    const rows = await this.database.select({
      expected: count(),
      replay: count(sql`case when ${schema.metaSyncRecordLedger.lastSeenAt} > ${schema.metaSyncRecordLedger.firstSeenAt} then 1 end`),
    }).from(schema.metaSyncRecordLedger).where(and(
      eq(schema.metaSyncRecordLedger.workspaceId, scope.workspaceId),
      eq(schema.metaSyncRecordLedger.metaConnectionId, scope.connectionId),
      eq(schema.metaSyncRecordLedger.adAccountId, accountId),
      eq(schema.metaSyncRecordLedger.streamType, stream),
      isNotNull(schema.metaSyncRecordLedger.entityLevel),
    ));
    const expected = nullableCount(rows[0]?.expected);
    return { expected: expected === 0 ? null : expected, replay: expected === 0 ? null : nullableCount(rows[0]?.replay) };
  }

  private async hierarchyEvidence(scope: MetaTrustReadinessScope, accountId: string): Promise<TrustStreamEvidence> {
    const [campaigns, adSets, ads, permission, freshness, ledger] = await Promise.all([
      this.database.select({ id: schema.adCampaigns.externalCampaignId }).from(schema.adCampaigns).where(and(
        eq(schema.adCampaigns.workspaceId, scope.workspaceId), eq(schema.adCampaigns.adAccountId, accountId), isNull(schema.adCampaigns.disappearedAt),
      )),
      this.database.select({ id: schema.metaAdSets.externalAdSetId }).from(schema.metaAdSets).where(and(
        eq(schema.metaAdSets.workspaceId, scope.workspaceId), eq(schema.metaAdSets.adAccountId, accountId), isNull(schema.metaAdSets.disappearedAt),
      )),
      this.database.select({ id: schema.metaAds.externalAdId }).from(schema.metaAds).where(and(
        eq(schema.metaAds.workspaceId, scope.workspaceId), eq(schema.metaAds.adAccountId, accountId), isNull(schema.metaAds.disappearedAt),
      )),
      this.latestStream(scope, accountId, "inventory"),
      this.latestCompletedAt(scope, accountId, "inventory"),
      this.ledgerStats(scope, accountId, "inventory"),
    ]);
    const identities = [
      ...campaigns.map((row) => `campaign:${row.id}`),
      ...adSets.map((row) => `ad_set:${row.id}`),
      ...ads.map((row) => `ad:${row.id}`),
    ];
    const observed = identities.length;
    return streamEvidence({
      stream: "hierarchy", required: true, permission: permissionFromStream(permission), lastSuccessfulAt: freshness,
      entityExpected: conservativeExpected(ledger.expected, observed), entityObserved: observed,
      orphanCount: 0, duplicateCount: 0, replayCount: ledger.replay, entityIdentityKeys: identities,
    });
  }

  private async insightEvidence(scope: MetaTrustReadinessScope, accountId: string): Promise<TrustStreamEvidence> {
    const [snapshots, metricCovered, permission, freshness, ledger] = await Promise.all([
      this.database.select({
        level: schema.metaDailyInsights.entityLevel,
        id: schema.metaDailyInsights.externalEntityId,
        start: schema.metaDailyInsights.dateStart,
        stop: schema.metaDailyInsights.dateStop,
        attribution: schema.metaDailyInsights.attributionLabel,
      }).from(schema.metaDailyInsights).where(and(
        eq(schema.metaDailyInsights.workspaceId, scope.workspaceId),
        eq(schema.metaDailyInsights.metaConnectionId, scope.connectionId),
        eq(schema.metaDailyInsights.adAccountId, accountId),
      )),
      this.database.select({ value: countDistinct(schema.metaDailyInsightMetrics.dailyInsightId) })
        .from(schema.metaDailyInsightMetrics)
        .innerJoin(schema.metaDailyInsights, eq(schema.metaDailyInsightMetrics.dailyInsightId, schema.metaDailyInsights.id))
        .where(and(
          eq(schema.metaDailyInsights.workspaceId, scope.workspaceId),
          eq(schema.metaDailyInsights.metaConnectionId, scope.connectionId),
          eq(schema.metaDailyInsights.adAccountId, accountId),
        )),
      this.latestStream(scope, accountId, "insights"),
      this.database.select({ value: max(schema.metaDailyInsights.lastSeenAt) }).from(schema.metaDailyInsights).where(and(
        eq(schema.metaDailyInsights.workspaceId, scope.workspaceId),
        eq(schema.metaDailyInsights.metaConnectionId, scope.connectionId),
        eq(schema.metaDailyInsights.adAccountId, accountId),
      )),
      this.ledgerStats(scope, accountId, "insights"),
    ]);
    const observed = snapshots.length;
    return streamEvidence({
      stream: "insights", required: true, permission: permissionFromStream(permission),
      lastSuccessfulAt: nullableIso(freshness[0]?.value),
      entityExpected: conservativeExpected(ledger.expected, observed), entityObserved: observed,
      metricExpected: observed, metricObserved: nullableCount(metricCovered[0]?.value),
      orphanCount: 0, duplicateCount: 0, replayCount: ledger.replay,
      entityIdentityKeys: snapshots.map((row) => `insight:${row.level}:${row.id}:${row.start}:${row.stop}:${row.attribution}`),
    });
  }

  private async contentEvidence(scope: MetaTrustReadinessScope, accountId: string): Promise<TrustStreamEvidence> {
    const [ads, covered, readable, creatives, permission, freshness, ledger] = await Promise.all([
      this.database.select({ value: count() }).from(schema.metaAds).where(and(
        eq(schema.metaAds.workspaceId, scope.workspaceId), eq(schema.metaAds.adAccountId, accountId), isNull(schema.metaAds.disappearedAt),
      )),
      this.database.select({ value: countDistinct(schema.metaAdCreativeBindings.adId) })
        .from(schema.metaAdCreativeBindings)
        .innerJoin(schema.metaAds, eq(schema.metaAdCreativeBindings.adId, schema.metaAds.id))
        .innerJoin(schema.metaCreatives, eq(schema.metaAdCreativeBindings.creativeId, schema.metaCreatives.id))
        .where(and(
          eq(schema.metaAdCreativeBindings.workspaceId, scope.workspaceId),
          eq(schema.metaAds.adAccountId, accountId),
          eq(schema.metaCreatives.workspaceId, scope.workspaceId),
          eq(schema.metaCreatives.adAccountId, accountId),
          isNull(schema.metaAds.disappearedAt),
          isNull(schema.metaAdCreativeBindings.disappearedAt),
        )),
      this.database.select({ value: countDistinct(schema.metaAdCreativeBindings.adId) })
        .from(schema.metaAdCreativeBindings)
        .innerJoin(schema.metaAds, eq(schema.metaAdCreativeBindings.adId, schema.metaAds.id))
        .innerJoin(schema.metaCreatives, eq(schema.metaAdCreativeBindings.creativeId, schema.metaCreatives.id))
        .where(and(
          eq(schema.metaAdCreativeBindings.workspaceId, scope.workspaceId),
          eq(schema.metaAds.adAccountId, accountId),
          isNull(schema.metaAds.disappearedAt),
          isNull(schema.metaAdCreativeBindings.disappearedAt),
          or(
            isNotNull(schema.metaCreatives.primaryText), isNotNull(schema.metaCreatives.headline),
            isNotNull(schema.metaCreatives.description), isNotNull(schema.metaCreatives.caption),
            isNotNull(schema.metaCreatives.postId),
          ),
        )),
      this.database.select({ id: schema.metaCreatives.externalCreativeId }).from(schema.metaCreatives).where(and(
        eq(schema.metaCreatives.workspaceId, scope.workspaceId), eq(schema.metaCreatives.adAccountId, accountId), isNull(schema.metaCreatives.disappearedAt),
      )),
      this.latestStream(scope, accountId, "creative"),
      this.database.select({ value: max(schema.metaCreatives.lastSeenAt) }).from(schema.metaCreatives).where(and(
        eq(schema.metaCreatives.workspaceId, scope.workspaceId), eq(schema.metaCreatives.adAccountId, accountId), isNull(schema.metaCreatives.disappearedAt),
      )),
      this.ledgerStats(scope, accountId, "creative"),
    ]);
    const expected = nullableCount(ads[0]?.value);
    const observed = nullableCount(covered[0]?.value);
    const readableCount = nullableCount(readable[0]?.value);
    const provenPermission = (observed ?? 0) > 0
      ? { status: "verified", reason: "none" } as const
      : permissionFromStream(permission);
    return streamEvidence({
      stream: "content", required: false, permission: provenPermission, lastSuccessfulAt: nullableIso(freshness[0]?.value),
      entityExpected: expected, entityObserved: observed,
      contentExpected: expected, contentObserved: readableCount,
      orphanCount: 0, duplicateCount: 0, replayCount: ledger.replay,
      entityIdentityKeys: creatives.map((row) => `creative:${row.id}`),
    });
  }

  private async assetEvidence(scope: MetaTrustReadinessScope, accountId: string): Promise<TrustStreamEvidence> {
    const [discoveries, observed, orphans] = await Promise.all([
      this.database.select({
        status: schema.metaAssetDiscoveries.status,
        itemCount: schema.metaAssetDiscoveries.itemCount,
        fetchedAt: schema.metaAssetDiscoveries.fetchedAt,
        firstSeenAt: schema.metaAssetDiscoveries.firstSeenAt,
        lastSeenAt: schema.metaAssetDiscoveries.lastSeenAt,
      }).from(schema.metaAssetDiscoveries).where(and(
        eq(schema.metaAssetDiscoveries.workspaceId, scope.workspaceId),
        eq(schema.metaAssetDiscoveries.metaConnectionId, scope.connectionId),
        eq(schema.metaAssetDiscoveries.adAccountId, accountId),
      )),
      this.database.select({ value: countDistinct(schema.metaAssetEdges.targetAssetId) }).from(schema.metaAssetEdges).where(and(
        eq(schema.metaAssetEdges.workspaceId, scope.workspaceId),
        eq(schema.metaAssetEdges.metaConnectionId, scope.connectionId),
        eq(schema.metaAssetEdges.adAccountId, accountId),
        isNull(schema.metaAssetEdges.disappearedAt),
      )),
      this.database.select({ value: count() }).from(schema.metaAssetEdges).where(and(
        eq(schema.metaAssetEdges.workspaceId, scope.workspaceId),
        eq(schema.metaAssetEdges.metaConnectionId, scope.connectionId),
        eq(schema.metaAssetEdges.adAccountId, accountId),
        isNull(schema.metaAssetEdges.disappearedAt),
        isNotNull(schema.metaAssetEdges.orphanReason),
      )),
    ]);
    const expected = discoveries.length === 0
      ? null
      : discoveries.reduce((total, row) => total + row.itemCount, 0);
    const replay = discoveries.length === 0
      ? null
      : discoveries.filter((row) => row.lastSeenAt.getTime() > row.firstSeenAt.getTime()).length;
    return streamEvidence({
      stream: "assets", required: false,
      permission: permissionFromDiscoveries(discoveries.map((row) => row.status)),
      lastSuccessfulAt: latestIso(discoveries
        .filter((row) => row.status === "verified" || row.status === "empty" || row.status === "partial")
        .map((row) => row.fetchedAt)),
      entityExpected: conservativeExpected(expected, nullableCount(observed[0]?.value)),
      entityObserved: nullableCount(observed[0]?.value),
      orphanCount: discoveries.length === 0 ? null : nullableCount(orphans[0]?.value),
      duplicateCount: 0, replayCount: replay,
      // Assets can legitimately be shared across accounts; they are not collision identities.
      entityIdentityKeys: [],
    });
  }

  private async attributionWindows(scope: MetaTrustReadinessScope, accountId: string): Promise<readonly string[] | null> {
    const rows = await this.database.selectDistinct({ value: schema.metaDailyInsights.attributionLabel })
      .from(schema.metaDailyInsights).where(and(
        eq(schema.metaDailyInsights.workspaceId, scope.workspaceId),
        eq(schema.metaDailyInsights.metaConnectionId, scope.connectionId),
        eq(schema.metaDailyInsights.adAccountId, accountId),
      ));
    const values = rows.map((row) => row.value.trim()).filter(Boolean).sort();
    return values.length > 0 ? values : null;
  }
}
