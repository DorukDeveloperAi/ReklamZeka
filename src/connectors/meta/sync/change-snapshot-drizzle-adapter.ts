import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  META_CHANGE_SNAPSHOT_SCHEMA_VERSION,
  type MetaChangeSnapshotInput,
  type Observation,
} from "@/domain/meta/snapshot-diff";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type Evidence = Readonly<{
  unsupportedFields: readonly Record<string, unknown>[] | null;
  provenance: Readonly<Record<string, unknown>> | null;
}>;

export type MetaChangeSnapshotScope = Readonly<{
  workspaceId: string;
  connectionId: string;
  externalAccountId: string;
  capturedAt: string;
}>;

type StoredCampaign = Evidence & Readonly<{
  workspaceId: string;
  internalAdAccountId: string;
  internalCampaignId: string;
  externalCampaignId: string;
  configuredStatus: string | null;
  effectiveStatus: string | null;
  campaignBudgetOptimization: boolean | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
}>;

type StoredAdSet = Evidence & Readonly<{
  workspaceId: string;
  internalAdAccountId: string;
  internalAdSetId: string;
  internalCampaignId: string;
  externalAdSetId: string;
  configuredStatus: string | null;
  effectiveStatus: string | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  targetingSignature: string | null;
}>;

type StoredAd = Evidence & Readonly<{
  workspaceId: string;
  internalAdAccountId: string;
  internalAdId: string;
  internalCampaignId: string;
  internalAdSetId: string;
  externalAdId: string;
  configuredStatus: string | null;
  effectiveStatus: string | null;
}>;

type StoredCreative = Readonly<{
  workspaceId: string;
  internalAdAccountId: string;
  internalCreativeId: string;
  externalCreativeId: string;
}>;

type StoredBinding = Readonly<{
  workspaceId: string;
  internalAdId: string;
  internalCreativeId: string;
  internalPostId: string | null;
  externalCreativeId: string;
  externalPostId: string | null;
  postWorkspaceId: string | null;
  postConnectionId: string | null;
  bindingPayloadHash: string;
  provenance: Readonly<Record<string, unknown>>;
}>;

export type MetaChangeStoredAccount = Readonly<{
  workspaceId: string;
  connectionId: string;
  internalAccountId: string;
  externalAccountId: string;
  campaigns: readonly StoredCampaign[];
  adSets: readonly StoredAdSet[];
  ads: readonly StoredAd[];
  creatives: readonly StoredCreative[];
  bindings: readonly StoredBinding[];
}>;

export interface MetaChangeSnapshotReadStore {
  readScopedAccount(scope: MetaChangeSnapshotScope): Promise<readonly MetaChangeStoredAccount[]>;
}

export class MetaChangeSnapshotScopeError extends Error {
  constructor(
    readonly code: "invalid_scope" | "scope_mismatch" | "orphan_parent" | "duplicate_identity" | "collection_overflow",
    message: string,
  ) {
    super(message);
    this.name = "MetaChangeSnapshotScopeError";
  }
}

export const META_CHANGE_SNAPSHOT_COLLECTION_CAPS = Object.freeze({
  campaigns: 10_000,
  adSets: 50_000,
  ads: 100_000,
  creatives: 100_000,
  bindings: 100_000,
});

export function assertMetaChangeSnapshotCollectionBound(
  collection: keyof typeof META_CHANGE_SNAPSHOT_COLLECTION_CAPS,
  count: number,
): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > META_CHANGE_SNAPSHOT_COLLECTION_CAPS[collection]) {
    throw new MetaChangeSnapshotScopeError("collection_overflow", `${collection} snapshot sınırını aştı`);
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function canonicalField(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function knownNull(evidence: Evidence, field: string): boolean {
  const wanted = canonicalField(field);
  const fields = evidence.provenance?.knownNullFields;
  if (Array.isArray(fields) && fields.some((entry) => typeof entry === "string" && canonicalField(entry) === wanted)) {
    return true;
  }
  const states = evidence.provenance?.fieldStates;
  if (states && typeof states === "object" && !Array.isArray(states)) {
    return Object.entries(states as Record<string, unknown>)
      .some(([key, state]) => canonicalField(key) === wanted && (state === "known_null" || state === "known-null"));
  }
  return false;
}

function unsupported(evidence: Evidence, field: string): boolean {
  const wanted = canonicalField(field);
  return (evidence.unsupportedFields ?? []).some((issue) =>
    [issue.field, issue.fieldName, issue.name, issue.path]
      .some((value) => typeof value === "string" && canonicalField(value) === wanted));
}

function nullableObservation<T>(value: T | null, evidence: Evidence, field: string): Observation<T | null> {
  if (value !== null) return { state: "known", value };
  if (knownNull(evidence, field)) return { state: "known", value: null };
  return { state: "unknown", reason: unsupported(evidence, field) ? `${field}_unsupported` : `${field}_not_observed` };
}

function requiredObservation<T>(value: T | null, evidence: Evidence, field: string): Observation<T> {
  return value === null
    ? { state: "unknown", reason: unsupported(evidence, field) ? `${field}_unsupported` : `${field}_not_observed` }
    : { state: "known", value };
}

function targetingObservation(value: string | null, evidence: Evidence): Observation<string | null> {
  const observation = nullableObservation(value, evidence, "targetingSignature");
  if (observation.state === "unknown" || observation.value === null) return observation;
  return /^sha256:[a-f0-9]{64}$/.test(observation.value)
    ? observation
    : { state: "known", value: `sha256:${digest({ targetingSignature: observation.value })}` };
}

function assertUnique(values: readonly string[], kind: string): void {
  if (new Set(values).size !== values.length) {
    throw new MetaChangeSnapshotScopeError("duplicate_identity", `${kind} kimliği tekrarlı; snapshot üretilemedi`);
  }
}

function creativeBindingSignature(
  ad: StoredAd,
  bindings: readonly StoredBinding[],
  creativeIds: ReadonlySet<string>,
): Observation<string | null> {
  const active = bindings.filter((binding) => binding.internalAdId === ad.internalAdId);
  if (active.length === 0) {
    return knownNull(ad, "creativeBinding") || knownNull(ad, "creativeId")
      ? { state: "known", value: null }
      : { state: "unknown", reason: "creative_binding_not_observed" };
  }
  assertUnique(active.map((binding) => `${binding.internalAdId}:${binding.internalCreativeId}`), "Creative binding");
  if (active.some((binding) => !creativeIds.has(binding.internalCreativeId))) {
    throw new MetaChangeSnapshotScopeError("orphan_parent", "Creative binding kapsam dışı parent içeriyor");
  }
  const sourceStableIdentities = active.map((binding) => ({
    externalCreativeId: binding.externalCreativeId,
    externalPostId: binding.externalPostId,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return { state: "known", value: `sha256:${digest(sourceStableIdentities)}` };
}

/** Maps private canonical mirror rows into the server-only change-snapshot input. */
export function metaChangeSnapshotInputFromStoredAccount(
  scope: MetaChangeSnapshotScope,
  stored: readonly MetaChangeStoredAccount[],
): MetaChangeSnapshotInput {
  if (
    !scope.workspaceId.trim()
    || !scope.connectionId.trim()
    || !scope.externalAccountId.trim()
    || !Number.isFinite(Date.parse(scope.capturedAt))
  ) throw new MetaChangeSnapshotScopeError("invalid_scope", "Meta change snapshot kapsamı geçersiz");
  if (stored.length !== 1) {
    throw new MetaChangeSnapshotScopeError("scope_mismatch", "Tam olarak bir reklam hesabı kapsamı doğrulanamadı");
  }
  const account = stored[0]!;
  if (
    account.workspaceId !== scope.workspaceId
    || account.connectionId !== scope.connectionId
    || account.externalAccountId !== scope.externalAccountId
  ) throw new MetaChangeSnapshotScopeError("scope_mismatch", "Store istek kapsamını aştı");
  const scopedEntities = [
    ...account.campaigns,
    ...account.adSets,
    ...account.ads,
    ...account.creatives,
  ];
  if (scopedEntities.some((row) =>
    row.workspaceId !== scope.workspaceId || row.internalAdAccountId !== account.internalAccountId)
    || account.bindings.some((row) => row.workspaceId !== scope.workspaceId)) {
    throw new MetaChangeSnapshotScopeError("scope_mismatch", "Canonical entity satırı hesap kapsamını aştı");
  }

  assertUnique(account.campaigns.map((row) => row.internalCampaignId), "Campaign internal");
  assertUnique(account.campaigns.map((row) => row.externalCampaignId), "Campaign external");
  assertUnique(account.adSets.map((row) => row.internalAdSetId), "Ad set internal");
  assertUnique(account.adSets.map((row) => row.externalAdSetId), "Ad set external");
  assertUnique(account.ads.map((row) => row.internalAdId), "Ad internal");
  assertUnique(account.ads.map((row) => row.externalAdId), "Ad external");
  assertUnique(account.creatives.map((row) => row.internalCreativeId), "Creative internal");
  assertUnique(account.creatives.map((row) => row.externalCreativeId), "Creative external");

  const campaigns = new Map(account.campaigns.map((row) => [row.internalCampaignId, row] as const));
  const adSets = new Map(account.adSets.map((row) => [row.internalAdSetId, row] as const));
  for (const row of account.adSets) {
    if (!campaigns.has(row.internalCampaignId)) {
      throw new MetaChangeSnapshotScopeError("orphan_parent", "Ad set campaign parent bulunamadı");
    }
  }
  for (const row of account.ads) {
    const adSet = adSets.get(row.internalAdSetId);
    if (!adSet || adSet.internalCampaignId !== row.internalCampaignId || !campaigns.has(row.internalCampaignId)) {
      throw new MetaChangeSnapshotScopeError("orphan_parent", "Ad hierarchy parent bulunamadı");
    }
  }

  const creatives = new Map(account.creatives.map((row) => [row.internalCreativeId, row.externalCreativeId] as const));
  const creativeIds = new Set(creatives.keys());
  const adIds = new Set(account.ads.map((row) => row.internalAdId));
  assertUnique(account.bindings.map((row) => `${row.internalAdId}:${row.internalCreativeId}`), "Creative binding");
  if (account.bindings.some((row) => !adIds.has(row.internalAdId) || !creativeIds.has(row.internalCreativeId))) {
    throw new MetaChangeSnapshotScopeError("orphan_parent", "Creative binding kapsam dışı parent içeriyor");
  }
  if (account.bindings.some((row) =>
    !row.externalCreativeId.trim()
    || creatives.get(row.internalCreativeId) !== row.externalCreativeId
    || (row.internalPostId === null && (
      row.externalPostId !== null || row.postWorkspaceId !== null || row.postConnectionId !== null
    ))
    || (row.internalPostId !== null && (
      !row.externalPostId
      || row.postWorkspaceId !== scope.workspaceId
      || row.postConnectionId !== scope.connectionId
    )))) {
    throw new MetaChangeSnapshotScopeError("orphan_parent", "Creative binding source-stable parent içeremiyor");
  }
  return {
    schemaVersion: META_CHANGE_SNAPSHOT_SCHEMA_VERSION,
    workspaceId: scope.workspaceId,
    externalAccountId: scope.externalAccountId,
    capturedAt: new Date(scope.capturedAt).toISOString(),
    campaigns: [...account.campaigns].sort((left, right) => left.externalCampaignId.localeCompare(right.externalCampaignId)).map((row) => ({
      externalCampaignId: row.externalCampaignId,
      configuredStatus: nullableObservation(row.configuredStatus, row, "configuredStatus"),
      effectiveStatus: nullableObservation(row.effectiveStatus, row, "effectiveStatus"),
      campaignBudgetOptimization: requiredObservation(row.campaignBudgetOptimization, row, "campaignBudgetOptimization"),
      dailyBudgetMinor: nullableObservation(row.dailyBudgetMinor, row, "dailyBudgetMinor"),
      lifetimeBudgetMinor: nullableObservation(row.lifetimeBudgetMinor, row, "lifetimeBudgetMinor"),
    })),
    adSets: [...account.adSets].sort((left, right) => left.externalAdSetId.localeCompare(right.externalAdSetId)).map((row) => ({
      externalAdSetId: row.externalAdSetId,
      externalCampaignId: campaigns.get(row.internalCampaignId)!.externalCampaignId,
      configuredStatus: nullableObservation(row.configuredStatus, row, "configuredStatus"),
      effectiveStatus: nullableObservation(row.effectiveStatus, row, "effectiveStatus"),
      dailyBudgetMinor: nullableObservation(row.dailyBudgetMinor, row, "dailyBudgetMinor"),
      lifetimeBudgetMinor: nullableObservation(row.lifetimeBudgetMinor, row, "lifetimeBudgetMinor"),
      targetingSignature: targetingObservation(row.targetingSignature, row),
    })),
    ads: [...account.ads].sort((left, right) => left.externalAdId.localeCompare(right.externalAdId)).map((row) => ({
      externalAdId: row.externalAdId,
      externalAdSetId: adSets.get(row.internalAdSetId)!.externalAdSetId,
      externalCampaignId: campaigns.get(row.internalCampaignId)!.externalCampaignId,
      configuredStatus: nullableObservation(row.configuredStatus, row, "configuredStatus"),
      effectiveStatus: nullableObservation(row.effectiveStatus, row, "effectiveStatus"),
      creativeBindingSignature: creativeBindingSignature(row, account.bindings, creativeIds),
    })),
  };
}

/** Exact workspace + connection + account read boundary over the canonical mirror. */
export class DrizzleMetaChangeSnapshotStore implements MetaChangeSnapshotReadStore {
  constructor(private readonly database: ReklamZekaDatabase) {}

  async readScopedAccount(scope: MetaChangeSnapshotScope): Promise<readonly MetaChangeStoredAccount[]> {
    const accountRows = await this.database.select({
      workspaceId: schema.adAccounts.workspaceId,
      connectionId: schema.dataSources.metaConnectionId,
      internalAccountId: schema.adAccounts.id,
      externalAccountId: schema.adAccounts.externalAccountId,
    }).from(schema.adAccounts)
      .innerJoin(schema.dataSources, eq(schema.adAccounts.dataSourceId, schema.dataSources.id))
      .innerJoin(schema.metaConnections, eq(schema.dataSources.metaConnectionId, schema.metaConnections.id))
      .where(and(
        eq(schema.adAccounts.workspaceId, scope.workspaceId),
        eq(schema.dataSources.workspaceId, scope.workspaceId),
        eq(schema.metaConnections.workspaceId, scope.workspaceId),
        eq(schema.metaConnections.id, scope.connectionId),
        eq(schema.dataSources.externalAccountId, scope.externalAccountId),
        eq(schema.adAccounts.externalAccountId, scope.externalAccountId),
        isNull(schema.adAccounts.disappearedAt),
      )).limit(2);
    if (accountRows.length !== 1) return [];
    const account = accountRows[0]!;

    const [campaigns, adSets, ads, creatives] = await Promise.all([
      this.database.select({
        workspaceId: schema.adCampaigns.workspaceId,
        internalAdAccountId: schema.adCampaigns.adAccountId,
        internalCampaignId: schema.adCampaigns.id,
        externalCampaignId: schema.adCampaigns.externalCampaignId,
        configuredStatus: schema.adCampaigns.configuredStatus,
        effectiveStatus: schema.adCampaigns.effectiveStatus,
        campaignBudgetOptimization: schema.adCampaigns.campaignBudgetOptimization,
        dailyBudgetMinor: schema.adCampaigns.dailyBudgetMinor,
        lifetimeBudgetMinor: schema.adCampaigns.lifetimeBudgetMinor,
        unsupportedFields: schema.adCampaigns.unsupportedFields,
        provenance: schema.adCampaigns.provenance,
      }).from(schema.adCampaigns).where(and(
        eq(schema.adCampaigns.adAccountId, account.internalAccountId),
        isNull(schema.adCampaigns.disappearedAt),
      )).limit(META_CHANGE_SNAPSHOT_COLLECTION_CAPS.campaigns + 1),
      this.database.select({
        workspaceId: schema.metaAdSets.workspaceId,
        internalAdAccountId: schema.metaAdSets.adAccountId,
        internalAdSetId: schema.metaAdSets.id,
        internalCampaignId: schema.metaAdSets.campaignId,
        externalAdSetId: schema.metaAdSets.externalAdSetId,
        configuredStatus: schema.metaAdSets.configuredStatus,
        effectiveStatus: schema.metaAdSets.effectiveStatus,
        dailyBudgetMinor: schema.metaAdSets.dailyBudgetMinor,
        lifetimeBudgetMinor: schema.metaAdSets.lifetimeBudgetMinor,
        targetingSignature: schema.metaAdSets.targetingSignature,
        unsupportedFields: schema.metaAdSets.unsupportedFields,
        provenance: schema.metaAdSets.provenance,
      }).from(schema.metaAdSets).where(and(
        eq(schema.metaAdSets.adAccountId, account.internalAccountId),
        isNull(schema.metaAdSets.disappearedAt),
      )).limit(META_CHANGE_SNAPSHOT_COLLECTION_CAPS.adSets + 1),
      this.database.select({
        workspaceId: schema.metaAds.workspaceId,
        internalAdAccountId: schema.metaAds.adAccountId,
        internalAdId: schema.metaAds.id,
        internalCampaignId: schema.metaAds.campaignId,
        internalAdSetId: schema.metaAds.adSetId,
        externalAdId: schema.metaAds.externalAdId,
        configuredStatus: schema.metaAds.configuredStatus,
        effectiveStatus: schema.metaAds.effectiveStatus,
        unsupportedFields: schema.metaAds.unsupportedFields,
        provenance: schema.metaAds.provenance,
      }).from(schema.metaAds).where(and(
        eq(schema.metaAds.adAccountId, account.internalAccountId),
        isNull(schema.metaAds.disappearedAt),
      )).limit(META_CHANGE_SNAPSHOT_COLLECTION_CAPS.ads + 1),
      this.database.select({
        workspaceId: schema.metaCreatives.workspaceId,
        internalAdAccountId: schema.metaCreatives.adAccountId,
        internalCreativeId: schema.metaCreatives.id,
        externalCreativeId: schema.metaCreatives.externalCreativeId,
      }).from(schema.metaCreatives).where(and(
        eq(schema.metaCreatives.adAccountId, account.internalAccountId),
        isNull(schema.metaCreatives.disappearedAt),
      )).limit(META_CHANGE_SNAPSHOT_COLLECTION_CAPS.creatives + 1),
    ]);

    assertMetaChangeSnapshotCollectionBound("campaigns", campaigns.length);
    assertMetaChangeSnapshotCollectionBound("adSets", adSets.length);
    assertMetaChangeSnapshotCollectionBound("ads", ads.length);
    assertMetaChangeSnapshotCollectionBound("creatives", creatives.length);

    const bindings = ads.length === 0 ? [] : await this.database.select({
      workspaceId: schema.metaAdCreativeBindings.workspaceId,
      internalAdId: schema.metaAdCreativeBindings.adId,
      internalCreativeId: schema.metaAdCreativeBindings.creativeId,
      internalPostId: schema.metaAdCreativeBindings.postId,
      externalCreativeId: schema.metaCreatives.externalCreativeId,
      externalPostId: schema.metaPosts.externalPostId,
      postWorkspaceId: schema.metaPosts.workspaceId,
      postConnectionId: schema.metaPosts.metaConnectionId,
      bindingPayloadHash: schema.metaAdCreativeBindings.bindingPayloadHash,
      provenance: schema.metaAdCreativeBindings.provenance,
    }).from(schema.metaAdCreativeBindings)
      .innerJoin(schema.metaAds, eq(schema.metaAdCreativeBindings.adId, schema.metaAds.id))
      .innerJoin(schema.metaCreatives, eq(schema.metaAdCreativeBindings.creativeId, schema.metaCreatives.id))
      .leftJoin(schema.metaPosts, eq(schema.metaAdCreativeBindings.postId, schema.metaPosts.id))
      .where(and(
        eq(schema.metaAds.adAccountId, account.internalAccountId),
        isNull(schema.metaAdCreativeBindings.disappearedAt),
        isNull(schema.metaAds.disappearedAt),
        isNull(schema.metaCreatives.disappearedAt),
        isNull(schema.metaPosts.disappearedAt),
      )).limit(META_CHANGE_SNAPSHOT_COLLECTION_CAPS.bindings + 1);
    assertMetaChangeSnapshotCollectionBound("bindings", bindings.length);

    return [{
      workspaceId: account.workspaceId,
      connectionId: account.connectionId!,
      internalAccountId: account.internalAccountId,
      externalAccountId: account.externalAccountId,
      campaigns,
      adSets,
      ads,
      creatives,
      bindings,
    }];
  }
}

export class MetaChangeSnapshotDrizzleAdapter {
  constructor(private readonly store: MetaChangeSnapshotReadStore) {}

  async buildInput(scope: MetaChangeSnapshotScope): Promise<MetaChangeSnapshotInput> {
    return metaChangeSnapshotInputFromStoredAccount(scope, await this.store.readScopedAccount(scope));
  }
}
