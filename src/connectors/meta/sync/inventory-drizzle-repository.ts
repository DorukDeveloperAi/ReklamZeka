import { and, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { DrizzleMetaAffectedGeoSnapshotRepository } from "@/connectors/meta/meta-affected-geo-snapshot-drizzle-repository";
import { appendKnownAffectedGeoForCanonicalAdSetPage, type MetaAffectedGeoAppendPort } from "./affected-geo-page-persistence";
import { classifyMetaInventoryCanonicalDelta } from "./inventory-materialization";
import { assertCanonicalMetaTargetingEvidence } from "./targeting-evidence";
import type {
  CanonicalMetaInventoryAd,
  CanonicalMetaInventoryAdSet,
  CanonicalMetaInventoryCampaign,
  CanonicalMetaInventoryPage,
  MetaInventoryFieldIssue,
  MetaInventoryCanonicalWriteOutcome,
  MetaInventoryPagePersistencePort,
  MetaInventoryWriteSummary,
} from "./inventory-materialization";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type WriteOutcome = MetaInventoryCanonicalWriteOutcome;
type Existing = Readonly<{ externalId: string; sourceRevision: string; sourcePriority: number; payloadHash: string }>;
type AffectedGeoRepositoryFactory = (database: ReklamZekaDatabase, workspaceId: string) => MetaAffectedGeoAppendPort;
type InventoryPersistenceOptions = Readonly<{
  materializeAffectedGeo?: boolean;
  /** Only for a connection that cannot complete PostgreSQL transaction callbacks. */
  transactionMode?: "atomic" | "idempotent_page";
}>;

const incomingRevision = sql<string>`excluded.provenance ->> 'sourceRevision'`;
const incomingPriority = sql<number>`case
  when excluded.provenance ->> 'sourcePriority' ~ '^[0-9]+$'
    then (excluded.provenance ->> 'sourcePriority')::integer
  else 10
end`;

function revisionCanReplace(currentProvenance: SQLWrapper) {
  const current = sql<string>`coalesce(${currentProvenance} ->> 'sourceRevision', '')`;
  const currentPriority = sql<number>`case
    when ${currentProvenance} ->> 'sourcePriority' ~ '^[0-9]+$'
      then (${currentProvenance} ->> 'sourcePriority')::integer
    else 10
  end`;
  return sql<boolean>`case
    when ${incomingPriority} > ${currentPriority} then true
    when ${incomingPriority} < ${currentPriority} then false
    when ${current} ~ '^-?[0-9]+([.][0-9]+)?$'
      and ${incomingRevision} ~ '^-?[0-9]+([.][0-9]+)?$'
      then (${incomingRevision})::numeric >= (${current})::numeric
    else ${incomingRevision} >= ${current}
  end`;
}

function outcome(current: Existing | undefined, sourceRevision: string, sourcePriority: number, payloadHash: string): WriteOutcome {
  return classifyMetaInventoryCanonicalDelta(current ?? null, { sourceRevision, sourcePriority, payloadHash });
}

function summary(outcomes: readonly WriteOutcome[], disappeared: number, pageHash: string): MetaInventoryWriteSummary {
  return Object.freeze({
    inserted: outcomes.filter((entry) => entry === "inserted").length,
    updated: outcomes.filter((entry) => entry === "updated").length,
    unchanged: outcomes.filter((entry) => entry === "unchanged").length,
    stale: outcomes.filter((entry) => entry === "stale").length,
    disappeared,
    pageHash,
  });
}

function existingVersion(provenance: Record<string, unknown> | null, payloadHash: string | null): Readonly<{ sourceRevision: string; sourcePriority: number; payloadHash: string }> {
  return {
    sourceRevision: typeof provenance?.sourceRevision === "string" ? provenance.sourceRevision : "",
    sourcePriority: typeof provenance?.sourcePriority === "number" && Number.isSafeInteger(provenance.sourcePriority)
      ? provenance.sourcePriority : 10,
    payloadHash: payloadHash ?? "",
  };
}

function appendIssue(issues: readonly MetaInventoryFieldIssue[], field: string, reason: MetaInventoryFieldIssue["reason"]): readonly MetaInventoryFieldIssue[] {
  return Object.freeze([...issues, Object.freeze({ field, reason })]);
}

/** Fail-closed repository boundary: forged canonical pages cannot persist arbitrary JSON. */
export function metaAdSetTargetingPersistence(record: Pick<CanonicalMetaInventoryAdSet, "targetingSummary" | "targetingSignature">) {
  assertCanonicalMetaTargetingEvidence(record.targetingSummary, record.targetingSignature);
  return Object.freeze({ targetingSummary: record.targetingSummary, targetingSignature: record.targetingSignature });
}

/**
 * Canonical inventory writer. It accepts only parsed pages, performs no Meta
 * calls and never persists or logs the source page itself.
 */
export class DrizzleMetaInventoryPagePersistence implements MetaInventoryPagePersistencePort {
  private readonly materializeAffectedGeo: boolean;
  private readonly transactionMode: "atomic" | "idempotent_page";
  constructor(private readonly database: ReklamZekaDatabase,
    private readonly affectedGeoRepository: AffectedGeoRepositoryFactory = (database, workspaceId) =>
      // writeAdSets already owns the page transaction; nesting one savepoint per
      // ad set turns a normal targeting page into hundreds of remote round trips.
      new DrizzleMetaAffectedGeoSnapshotRepository(database, workspaceId, "caller"),
    options: InventoryPersistenceOptions = {}) {
    this.materializeAffectedGeo = options.materializeAffectedGeo ?? true;
    this.transactionMode = options.transactionMode ?? "atomic";
  }

  async writePage(page: CanonicalMetaInventoryPage, privateSource?: unknown): Promise<MetaInventoryWriteSummary> {
    const write = async (database: ReklamZekaDatabase) => {
      const accountId = await this.resolveAccount(database, page);
      const outcomes = page.entityLevel === "campaign"
        ? await this.writeCampaigns(database, accountId, page, page.records as readonly CanonicalMetaInventoryCampaign[])
        : page.entityLevel === "ad_set"
          ? await this.writeAdSets(database, accountId, page, page.records as readonly CanonicalMetaInventoryAdSet[], privateSource)
          : await this.writeAds(database, accountId, page, page.records as readonly CanonicalMetaInventoryAd[]);
      const disappeared = page.terminal ? await this.markDisappeared(database, accountId, page) : 0;
      return summary(outcomes, disappeared, page.pageHash);
    };
    // All canonical writes use deterministic identities and revision guards, so
    // a retry after a connection-level interruption is safe. The default stays
    // atomic; the opt-in fallback exists solely for broken transaction callbacks.
    return this.transactionMode === "atomic"
      ? this.database.transaction(async (transaction) => write(transaction as ReklamZekaDatabase))
      : write(this.database);
  }

  private async resolveAccount(database: ReklamZekaDatabase, page: CanonicalMetaInventoryPage): Promise<string> {
    const rows = await database.select({ id: schema.adAccounts.id })
      .from(schema.adAccounts)
      .innerJoin(schema.dataSources, and(
        eq(schema.adAccounts.dataSourceId, schema.dataSources.id),
        eq(schema.adAccounts.workspaceId, schema.dataSources.workspaceId),
      ))
      .where(and(
        eq(schema.adAccounts.workspaceId, page.workspaceId),
        eq(schema.dataSources.workspaceId, page.workspaceId),
        eq(schema.dataSources.metaConnectionId, page.connectionId),
        eq(schema.adAccounts.externalAccountId, page.externalAccountId),
      )).limit(2);
    if (rows.length !== 1) throw new Error("Meta inventory account scope tekil biçimde çözülemedi");
    return rows[0]!.id;
  }

  private async writeCampaigns(
    database: ReklamZekaDatabase,
    accountId: string,
    page: CanonicalMetaInventoryPage,
    records: readonly CanonicalMetaInventoryCampaign[],
  ): Promise<readonly WriteOutcome[]> {
    if (records.length === 0) return [];
    const ids = records.map((entry) => entry.externalId);
    const currentRows = await database.select({
      externalId: schema.adCampaigns.externalCampaignId,
      provenance: schema.adCampaigns.provenance,
      payloadHash: schema.adCampaigns.rawPayloadHash,
    }).from(schema.adCampaigns).where(and(
      eq(schema.adCampaigns.workspaceId, page.workspaceId),
      eq(schema.adCampaigns.adAccountId, accountId),
      inArray(schema.adCampaigns.externalCampaignId, ids),
    ));
    const current = new Map(currentRows.map((entry) => [entry.externalId, { externalId: entry.externalId, ...existingVersion(entry.provenance, entry.payloadHash) }]));
    const outcomes = records.map((entry) => outcome(current.get(entry.externalId), entry.trace.sourceRevision, entry.trace.provenance.sourcePriority, entry.trace.rawPayloadHash));
    const observedAt = new Date(page.observedAt);
    const accepted = records.filter((_, index) => outcomes[index] !== "stale");
    if (accepted.length > 0) await database.insert(schema.adCampaigns).values(accepted.map((entry) => ({
      workspaceId: page.workspaceId, adAccountId: accountId, externalCampaignId: entry.externalId,
      name: entry.name, configuredStatus: entry.configuredStatus, effectiveStatus: entry.effectiveStatus,
      statusIssues: entry.statusIssues, unsupportedFields: entry.unsupportedFields,
      objectiveSource: entry.objectiveSource, legacyObjectiveSource: entry.legacyObjectiveSource,
      canonicalObjective: entry.canonicalObjective, objectiveMappingVersion: entry.objectiveMappingVersion,
      buyingType: entry.buyingType, specialAdCategories: entry.specialAdCategories,
      campaignBudgetOptimization: entry.campaignBudgetOptimization,
      dailyBudgetMinor: entry.dailyBudgetMinor, lifetimeBudgetMinor: entry.lifetimeBudgetMinor,
      sourceUpdatedAt: entry.trace.sourceUpdatedAt ? new Date(entry.trace.sourceUpdatedAt) : null,
      fetchedAt: observedAt, rawPayloadHash: entry.trace.rawPayloadHash,
      sourceGraphVersion: entry.trace.sourceGraphVersion, fieldCatalogVersion: entry.trace.fieldCatalogVersion,
      provenance: entry.trace.provenance, lastSeenAt: observedAt,
    }))).onConflictDoUpdate({
      target: [schema.adCampaigns.adAccountId, schema.adCampaigns.externalCampaignId],
      set: {
        name: sql`excluded.name`, configuredStatus: sql`excluded.configured_status`, effectiveStatus: sql`excluded.effective_status`,
        statusIssues: sql`excluded.status_issues`, unsupportedFields: sql`excluded.unsupported_fields`,
        objectiveSource: sql`excluded.objective_source`, legacyObjectiveSource: sql`excluded.legacy_objective_source`,
        canonicalObjective: sql`excluded.canonical_objective`, objectiveMappingVersion: sql`excluded.objective_mapping_version`,
        buyingType: sql`excluded.buying_type`, specialAdCategories: sql`excluded.special_ad_categories`,
        campaignBudgetOptimization: sql`excluded.campaign_budget_optimization`, dailyBudgetMinor: sql`excluded.daily_budget_minor`,
        lifetimeBudgetMinor: sql`excluded.lifetime_budget_minor`, sourceUpdatedAt: sql`excluded.source_updated_at`,
        fetchedAt: sql`excluded.fetched_at`, rawPayloadHash: sql`excluded.raw_payload_hash`,
        sourceGraphVersion: sql`excluded.source_graph_version`, fieldCatalogVersion: sql`excluded.field_catalog_version`,
        provenance: sql`excluded.provenance`, lastSeenAt: observedAt, disappearedAt: null,
      },
      setWhere: revisionCanReplace(schema.adCampaigns.provenance),
    });
    await this.markObserved(database, schema.adCampaigns, schema.adCampaigns.externalCampaignId, schema.adCampaigns.adAccountId,
      schema.adCampaigns.workspaceId, schema.adCampaigns.fetchedAt, schema.adCampaigns.provenance, ids, accountId, page);
    return outcomes;
  }

  private async writeAdSets(
    database: ReklamZekaDatabase,
    accountId: string,
    page: CanonicalMetaInventoryPage,
    records: readonly CanonicalMetaInventoryAdSet[],
    privateSource: unknown,
  ): Promise<readonly WriteOutcome[]> {
    if (records.length === 0) return [];
    const campaignExternalIds = [...new Set(records.map((entry) => entry.externalCampaignId))];
    const campaignRows = await database.select({ id: schema.adCampaigns.id, externalId: schema.adCampaigns.externalCampaignId })
      .from(schema.adCampaigns).where(and(
        eq(schema.adCampaigns.workspaceId, page.workspaceId), eq(schema.adCampaigns.adAccountId, accountId),
        inArray(schema.adCampaigns.externalCampaignId, campaignExternalIds), isNull(schema.adCampaigns.disappearedAt),
      ));
    const campaigns = new Map(campaignRows.map((entry) => [entry.externalId, entry.id]));
    if (campaignExternalIds.some((externalId) => !campaigns.has(externalId))) throw new Error("Meta inventory ad set campaign kapsamı çözülemedi");
    const ids = records.map((entry) => entry.externalId);
    const currentRows = await database.select({
      externalId: schema.metaAdSets.externalAdSetId, provenance: schema.metaAdSets.provenance,
      payloadHash: schema.metaAdSets.rawPayloadHash,
    }).from(schema.metaAdSets).where(and(
      eq(schema.metaAdSets.workspaceId, page.workspaceId), eq(schema.metaAdSets.adAccountId, accountId),
      inArray(schema.metaAdSets.externalAdSetId, ids),
    ));
    const current = new Map(currentRows.map((entry) => [entry.externalId, { externalId: entry.externalId, ...existingVersion(entry.provenance, entry.payloadHash) }]));
    const outcomes = records.map((entry) => outcome(current.get(entry.externalId), entry.trace.sourceRevision, entry.trace.provenance.sourcePriority, entry.trace.rawPayloadHash));
    const observedAt = new Date(page.observedAt);
    const accepted = records.filter((_, index) => outcomes[index] !== "stale");
    if (accepted.length > 0) await database.insert(schema.metaAdSets).values(accepted.map((entry) => ({
      workspaceId: page.workspaceId, adAccountId: accountId, campaignId: campaigns.get(entry.externalCampaignId)!,
      externalAdSetId: entry.externalId, name: entry.name, configuredStatus: entry.configuredStatus,
      effectiveStatus: entry.effectiveStatus, statusIssues: entry.statusIssues, unsupportedFields: entry.unsupportedFields,
      optimizationGoal: entry.optimizationGoal, billingEvent: entry.billingEvent, bidStrategy: entry.bidStrategy,
      bidAmountMinor: entry.bidAmountMinor, dailyBudgetMinor: entry.dailyBudgetMinor,
      lifetimeBudgetMinor: entry.lifetimeBudgetMinor, attributionSpec: entry.attributionSpec,
      promotedObject: entry.promotedObject, ...metaAdSetTargetingPersistence(entry),
      sourceUpdatedAt: entry.trace.sourceUpdatedAt ? new Date(entry.trace.sourceUpdatedAt) : null,
      fetchedAt: observedAt, rawPayloadHash: entry.trace.rawPayloadHash,
      sourceGraphVersion: entry.trace.sourceGraphVersion, fieldCatalogVersion: entry.trace.fieldCatalogVersion,
      provenance: entry.trace.provenance, lastSeenAt: observedAt,
    }))).onConflictDoUpdate({
      target: [schema.metaAdSets.adAccountId, schema.metaAdSets.externalAdSetId],
      set: {
        campaignId: sql`excluded.campaign_id`, name: sql`excluded.name`, configuredStatus: sql`excluded.configured_status`,
        effectiveStatus: sql`excluded.effective_status`, statusIssues: sql`excluded.status_issues`, unsupportedFields: sql`excluded.unsupported_fields`,
        optimizationGoal: sql`excluded.optimization_goal`, billingEvent: sql`excluded.billing_event`, bidStrategy: sql`excluded.bid_strategy`,
        bidAmountMinor: sql`excluded.bid_amount_minor`, dailyBudgetMinor: sql`excluded.daily_budget_minor`, lifetimeBudgetMinor: sql`excluded.lifetime_budget_minor`,
        attributionSpec: sql`excluded.attribution_spec`, promotedObject: sql`excluded.promoted_object`, sourceUpdatedAt: sql`excluded.source_updated_at`,
        targetingSummary: sql`excluded.targeting_summary`, targetingSignature: sql`excluded.targeting_signature`,
        fetchedAt: sql`excluded.fetched_at`, rawPayloadHash: sql`excluded.raw_payload_hash`, sourceGraphVersion: sql`excluded.source_graph_version`,
        fieldCatalogVersion: sql`excluded.field_catalog_version`, provenance: sql`excluded.provenance`, lastSeenAt: observedAt, disappearedAt: null,
      },
      setWhere: revisionCanReplace(schema.metaAdSets.provenance),
    });
    const resolvedRows = await database.select({ id: schema.metaAdSets.id, campaignId: schema.metaAdSets.campaignId,
      externalAdSetId: schema.metaAdSets.externalAdSetId }).from(schema.metaAdSets).where(and(
      eq(schema.metaAdSets.workspaceId, page.workspaceId), eq(schema.metaAdSets.adAccountId, accountId),
      inArray(schema.metaAdSets.externalAdSetId, ids), isNull(schema.metaAdSets.disappearedAt),
    ));
    if (resolvedRows.length !== records.length || records.some((entry) => {
      const resolved = resolvedRows.find((row) => row.externalAdSetId === entry.externalId);
      return !resolved || resolved.campaignId !== campaigns.get(entry.externalCampaignId);
    })) throw new Error("Meta inventory affected-geo hierarchy kapsamı çözülemedi");
    if (this.materializeAffectedGeo) {
      await appendKnownAffectedGeoForCanonicalAdSetPage({ page, privateSource, adAccountId: accountId,
        hierarchy: resolvedRows.map((row) => ({ externalAdSetId: row.externalAdSetId,
          campaignId: row.campaignId, adSetId: row.id })), outcomes,
        repository: this.affectedGeoRepository(database, page.workspaceId) });
    }
    await this.markObserved(database, schema.metaAdSets, schema.metaAdSets.externalAdSetId, schema.metaAdSets.adAccountId,
      schema.metaAdSets.workspaceId, schema.metaAdSets.fetchedAt, schema.metaAdSets.provenance, ids, accountId, page);
    return outcomes;
  }

  private async writeAds(
    database: ReklamZekaDatabase,
    accountId: string,
    page: CanonicalMetaInventoryPage,
    records: readonly CanonicalMetaInventoryAd[],
  ): Promise<readonly WriteOutcome[]> {
    if (records.length === 0) return [];
    const campaignIds = [...new Set(records.map((entry) => entry.externalCampaignId))];
    const adSetIds = [...new Set(records.map((entry) => entry.externalAdSetId))];
    const campaignRows = await database.select({ id: schema.adCampaigns.id, externalId: schema.adCampaigns.externalCampaignId })
      .from(schema.adCampaigns).where(and(eq(schema.adCampaigns.workspaceId, page.workspaceId),
        eq(schema.adCampaigns.adAccountId, accountId), inArray(schema.adCampaigns.externalCampaignId, campaignIds), isNull(schema.adCampaigns.disappearedAt)));
    const adSetRows = await database.select({ id: schema.metaAdSets.id, campaignId: schema.metaAdSets.campaignId, externalId: schema.metaAdSets.externalAdSetId })
      .from(schema.metaAdSets).where(and(eq(schema.metaAdSets.workspaceId, page.workspaceId),
        eq(schema.metaAdSets.adAccountId, accountId), inArray(schema.metaAdSets.externalAdSetId, adSetIds), isNull(schema.metaAdSets.disappearedAt)));
    const campaigns = new Map(campaignRows.map((entry) => [entry.externalId, entry.id]));
    const adSets = new Map(adSetRows.map((entry) => [entry.externalId, entry]));
    for (const entry of records) {
      const campaignId = campaigns.get(entry.externalCampaignId);
      const adSet = adSets.get(entry.externalAdSetId);
      if (!campaignId || !adSet || adSet.campaignId !== campaignId) throw new Error("Meta inventory ad hierarchy hesap kapsamında çözülemedi");
    }
    const creativeExternalIds = [...new Set(records.map((entry) => entry.externalCreativeId).filter((entry): entry is string => entry !== null))];
    const creativeRows = creativeExternalIds.length === 0 ? [] : await database.select({ id: schema.metaCreatives.id, externalId: schema.metaCreatives.externalCreativeId })
      .from(schema.metaCreatives).where(and(eq(schema.metaCreatives.workspaceId, page.workspaceId),
        eq(schema.metaCreatives.adAccountId, accountId), inArray(schema.metaCreatives.externalCreativeId, creativeExternalIds), isNull(schema.metaCreatives.disappearedAt)));
    const creatives = new Map(creativeRows.map((entry) => [entry.externalId, entry.id]));
    const ids = records.map((entry) => entry.externalId);
    const currentRows = await database.select({ externalId: schema.metaAds.externalAdId, provenance: schema.metaAds.provenance, payloadHash: schema.metaAds.rawPayloadHash })
      .from(schema.metaAds).where(and(eq(schema.metaAds.workspaceId, page.workspaceId), eq(schema.metaAds.adAccountId, accountId), inArray(schema.metaAds.externalAdId, ids)));
    const current = new Map(currentRows.map((entry) => [entry.externalId, { externalId: entry.externalId, ...existingVersion(entry.provenance, entry.payloadHash) }]));
    const outcomes = records.map((entry) => outcome(current.get(entry.externalId), entry.trace.sourceRevision, entry.trace.provenance.sourcePriority, entry.trace.rawPayloadHash));
    const observedAt = new Date(page.observedAt);
    const accepted = records.filter((_, index) => outcomes[index] !== "stale");
    if (accepted.length > 0) await database.insert(schema.metaAds).values(accepted.map((entry) => {
      const creativeId = entry.externalCreativeId ? creatives.get(entry.externalCreativeId) ?? null : null;
      return {
        workspaceId: page.workspaceId, adAccountId: accountId, campaignId: campaigns.get(entry.externalCampaignId)!,
        adSetId: adSets.get(entry.externalAdSetId)!.id, creativeId, externalAdId: entry.externalId,
        name: entry.name, configuredStatus: entry.configuredStatus, effectiveStatus: entry.effectiveStatus,
        statusIssues: entry.statusIssues,
        unsupportedFields: entry.externalCreativeId && !creativeId
          ? appendIssue(entry.unsupportedFields, "creative", "reference_unresolved") : entry.unsupportedFields,
        sourceUpdatedAt: entry.trace.sourceUpdatedAt ? new Date(entry.trace.sourceUpdatedAt) : null,
        fetchedAt: observedAt, rawPayloadHash: entry.trace.rawPayloadHash,
        sourceGraphVersion: entry.trace.sourceGraphVersion, fieldCatalogVersion: entry.trace.fieldCatalogVersion,
        provenance: entry.trace.provenance, lastSeenAt: observedAt,
      };
    })).onConflictDoUpdate({
      target: [schema.metaAds.adAccountId, schema.metaAds.externalAdId],
      set: {
        campaignId: sql`excluded.campaign_id`, adSetId: sql`excluded.ad_set_id`,
        creativeId: sql`excluded.creative_id`, name: sql`excluded.name`,
        configuredStatus: sql`excluded.configured_status`, effectiveStatus: sql`excluded.effective_status`,
        statusIssues: sql`excluded.status_issues`, unsupportedFields: sql`excluded.unsupported_fields`,
        sourceUpdatedAt: sql`excluded.source_updated_at`, fetchedAt: sql`excluded.fetched_at`, rawPayloadHash: sql`excluded.raw_payload_hash`,
        sourceGraphVersion: sql`excluded.source_graph_version`, fieldCatalogVersion: sql`excluded.field_catalog_version`,
        provenance: sql`excluded.provenance`, lastSeenAt: observedAt, disappearedAt: null,
      },
      setWhere: revisionCanReplace(schema.metaAds.provenance),
    });
    await this.markObserved(database, schema.metaAds, schema.metaAds.externalAdId, schema.metaAds.adAccountId,
      schema.metaAds.workspaceId, schema.metaAds.fetchedAt, schema.metaAds.provenance, ids, accountId, page);
    return outcomes;
  }

  private async markObserved(
    database: ReklamZekaDatabase,
    table: typeof schema.adCampaigns | typeof schema.metaAdSets | typeof schema.metaAds,
    externalColumn: SQLWrapper,
    accountColumn: SQLWrapper,
    workspaceColumn: SQLWrapper,
    fetchedColumn: SQLWrapper,
    provenanceColumn: SQLWrapper,
    externalIds: readonly string[],
    accountId: string,
    page: CanonicalMetaInventoryPage,
  ): Promise<void> {
    if (externalIds.length === 0) return;
    await database.update(table as typeof schema.adCampaigns).set({
      lastSeenAt: new Date(page.observedAt), disappearedAt: null,
      provenance: sql`jsonb_set(coalesce(${provenanceColumn}, '{}'::jsonb), '{observationRunRef}', to_jsonb(${page.parentRunId}::text), true)`,
    }).where(and(
      eq(workspaceColumn as never, page.workspaceId), eq(accountColumn as never, accountId),
      inArray(externalColumn as never, externalIds), lte(fetchedColumn as never, new Date(page.observedAt)),
    ));
  }

  private async markDisappeared(database: ReklamZekaDatabase, accountId: string, page: CanonicalMetaInventoryPage): Promise<number> {
    const observedAt = new Date(page.observedAt);
    const common = (workspace: SQLWrapper, account: SQLWrapper, fetched: SQLWrapper, disappeared: SQLWrapper, provenance: SQLWrapper) => and(
      eq(workspace as never, page.workspaceId), eq(account as never, accountId), isNull(disappeared as never),
      lte(fetched as never, observedAt), ne(sql<string>`coalesce(${provenance} ->> 'observationRunRef', '')`, page.parentRunId),
    );
    const rows = page.entityLevel === "campaign"
      ? await database.update(schema.adCampaigns).set({ disappearedAt: observedAt }).where(common(
        schema.adCampaigns.workspaceId, schema.adCampaigns.adAccountId, schema.adCampaigns.fetchedAt,
        schema.adCampaigns.disappearedAt, schema.adCampaigns.provenance,
      )).returning({ id: schema.adCampaigns.id })
      : page.entityLevel === "ad_set"
        ? await database.update(schema.metaAdSets).set({ disappearedAt: observedAt }).where(common(
          schema.metaAdSets.workspaceId, schema.metaAdSets.adAccountId, schema.metaAdSets.fetchedAt,
          schema.metaAdSets.disappearedAt, schema.metaAdSets.provenance,
        )).returning({ id: schema.metaAdSets.id })
        : await database.update(schema.metaAds).set({ disappearedAt: observedAt }).where(common(
          schema.metaAds.workspaceId, schema.metaAds.adAccountId, schema.metaAds.fetchedAt,
          schema.metaAds.disappearedAt, schema.metaAds.provenance,
        )).returning({ id: schema.metaAds.id });
    return rows.length;
  }
}
