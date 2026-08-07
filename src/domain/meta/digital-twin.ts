import { createHash } from "node:crypto";

export const META_DIGITAL_TWIN_SCHEMA_VERSION = 1 as const;

export type MetaSourceTrace = Readonly<{
  rawPayloadHash: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  provenance: Readonly<Record<string, unknown>>;
}>;

export type MetaDigitalTwinSnapshotInput = Readonly<{
  schemaVersion: typeof META_DIGITAL_TWIN_SCHEMA_VERSION;
  workspaceId: string;
  connectionExternalKey: string;
  account: Readonly<{
    externalAccountId: string;
    name: string;
    currency: string;
    timezone: string;
    configuredStatus: string | null;
    effectiveStatus: string | null;
    trace: MetaSourceTrace;
  }>;
  campaigns: readonly Readonly<{
    externalCampaignId: string;
    externalAccountId: string;
    name: string;
    configuredStatus: string | null;
    effectiveStatus: string | null;
    objectiveSource: string | null;
    legacyObjectiveSource: string | null;
    canonicalObjective: string | null;
    objectiveMappingVersion: string | null;
    buyingType: string | null;
    bidStrategy: string | null;
    specialAdCategories: readonly string[];
    advantagePlusEnabled: boolean | null;
    campaignBudgetOptimization: boolean | null;
    dailyBudgetMinor: number | null;
    lifetimeBudgetMinor: number | null;
    trace: MetaSourceTrace;
  }>[];
  adSets: readonly Readonly<{
    externalAdSetId: string;
    externalCampaignId: string;
    externalAccountId: string;
    name: string;
    configuredStatus: string | null;
    effectiveStatus: string | null;
    optimizationGoal: string | null;
    billingEvent: string | null;
    bidStrategy: string | null;
    bidAmountMinor: number | null;
    costCapMinor: number | null;
    dailyBudgetMinor: number | null;
    lifetimeBudgetMinor: number | null;
    attributionSpec: readonly Record<string, unknown>[];
    promotedObject: Readonly<Record<string, unknown>> | null;
    targetingSummary: Readonly<Record<string, unknown>> | null;
    targetingSignature: string | null;
    trace: MetaSourceTrace;
  }>[];
  ads: readonly Readonly<{
    externalAdId: string;
    externalAdSetId: string;
    externalCampaignId: string;
    externalAccountId: string;
    externalCreativeId: string | null;
    name: string;
    configuredStatus: string | null;
    effectiveStatus: string | null;
    trackingSpecs: readonly Record<string, unknown>[];
    reviewFeedback: Readonly<Record<string, unknown>> | null;
    trace: MetaSourceTrace;
  }>[];
  creatives: readonly Readonly<{
    externalCreativeId: string;
    externalAccountId: string;
    externalPostId: string | null;
    actorExternalAssetId: string | null;
    name: string | null;
    sourceType: string;
    primaryText: string | null;
    headline: string | null;
    description: string | null;
    caption: string | null;
    callToActionType: string | null;
    destinationUrl: string | null;
    creativeFormat: string | null;
    contentProvenance: Readonly<Record<string, unknown>>;
    dynamicVariants: readonly Record<string, unknown>[];
    trace: MetaSourceTrace;
  }>[];
  posts: readonly Readonly<{
    externalPostId: string;
    actorExternalAssetId: string | null;
    externalMediaId: string | null;
    mediaType: string | null;
    permalink: string | null;
    trace: MetaSourceTrace;
  }>[];
  assets: readonly Readonly<{
    externalAssetId: string;
    assetType: string;
    displayName: string | null;
    orphanReason: string | null;
    trace: MetaSourceTrace;
  }>[];
  assetEdges: readonly Readonly<{
    sourceEntityType: "campaign" | "ad_set" | "ad" | "creative" | "post";
    sourceExternalId: string;
    targetExternalAssetId: string;
    relationship: string;
    orphanReason: string | null;
    trace: MetaSourceTrace;
  }>[];
}>;

export type CanonicalMetaDigitalTwinSnapshot = MetaDigitalTwinSnapshotInput & Readonly<{
  snapshotHash: string;
}>;

export class MetaDigitalTwinValidationError extends Error {
  constructor(
    readonly code:
      | "invalid_snapshot"
      | "invalid_provenance"
      | "duplicate_identity"
      | "orphan_parent"
      | "cross_account_reference"
      | "ad_level_budget_not_supported",
    readonly entityExternalId: string,
    message: string,
  ) {
    super(message);
    this.name = "MetaDigitalTwinValidationError";
  }
}

function assertRequired(value: string, label: string): void {
  if (!value.trim()) {
    throw new MetaDigitalTwinValidationError("invalid_snapshot", value, `${label} zorunludur`);
  }
}

function assertTrace(trace: MetaSourceTrace, externalId: string): void {
  if (
    !trace.rawPayloadHash.trim()
    || !trace.sourceGraphVersion.trim()
    || !trace.fieldCatalogVersion.trim()
    || !Number.isFinite(Date.parse(trace.fetchedAt))
    || (trace.sourceUpdatedAt !== null && !Number.isFinite(Date.parse(trace.sourceUpdatedAt)))
  ) {
    throw new MetaDigitalTwinValidationError(
      "invalid_provenance",
      externalId,
      "Raw hash, Graph/catalog sürümü ve geçerli fetch zamanı zorunludur",
    );
  }
}

function assertUnique(values: readonly string[], entityType: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertRequired(value, `${entityType} external ID`);
    if (seen.has(value)) {
      throw new MetaDigitalTwinValidationError(
        "duplicate_identity",
        value,
        `${entityType} external ID snapshot içinde tekrarlanamaz`,
      );
    }
    seen.add(value);
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableValue(entryValue)]),
    );
  }
  return value;
}

function sortBy<T>(items: readonly T[], identity: (item: T) => string): T[] {
  return [...items]
    .sort((left, right) => identity(left).localeCompare(identity(right)))
    .map((item) => stableValue(item) as T);
}

function assertParent(
  parentIds: ReadonlySet<string>,
  parentExternalId: string,
  childExternalId: string,
  relation: string,
): void {
  if (!parentIds.has(parentExternalId)) {
    throw new MetaDigitalTwinValidationError(
      "orphan_parent",
      childExternalId,
      `${relation} parent ${parentExternalId} snapshot içinde bulunamadı`,
    );
  }
}

function assertAccount(expected: string, actual: string, externalId: string): void {
  if (actual !== expected) {
    throw new MetaDigitalTwinValidationError(
      "cross_account_reference",
      externalId,
      `Entity ${actual} hesabına ait; snapshot hesabı ${expected}`,
    );
  }
}

/**
 * Validates hierarchy/provenance and produces byte-stable ordering and hashing.
 * It does not infer missing platform fields or retain raw payloads.
 */
export function normalizeMetaDigitalTwinSnapshot(
  input: MetaDigitalTwinSnapshotInput,
): CanonicalMetaDigitalTwinSnapshot {
  if (input.schemaVersion !== META_DIGITAL_TWIN_SCHEMA_VERSION) {
    throw new MetaDigitalTwinValidationError("invalid_snapshot", String(input.schemaVersion), "Şema sürümü desteklenmiyor");
  }
  assertRequired(input.workspaceId, "Workspace ID");
  assertRequired(input.connectionExternalKey, "Connection external key");
  assertRequired(input.account.externalAccountId, "Ad account external ID");
  assertTrace(input.account.trace, input.account.externalAccountId);

  assertUnique(input.campaigns.map((entity) => entity.externalCampaignId), "Campaign");
  assertUnique(input.adSets.map((entity) => entity.externalAdSetId), "Ad set");
  assertUnique(input.ads.map((entity) => entity.externalAdId), "Ad");
  assertUnique(input.creatives.map((entity) => entity.externalCreativeId), "Creative");
  assertUnique(input.posts.map((entity) => entity.externalPostId), "Post");
  assertUnique(input.assets.map((entity) => entity.externalAssetId), "Asset");

  const campaignIds = new Set(input.campaigns.map((entity) => entity.externalCampaignId));
  const adSetIds = new Set(input.adSets.map((entity) => entity.externalAdSetId));
  const adIds = new Set(input.ads.map((entity) => entity.externalAdId));
  const creativeIds = new Set(input.creatives.map((entity) => entity.externalCreativeId));
  const postIds = new Set(input.posts.map((entity) => entity.externalPostId));
  const assetIds = new Set(input.assets.map((entity) => entity.externalAssetId));
  const sourceIds: Record<MetaDigitalTwinSnapshotInput["assetEdges"][number]["sourceEntityType"], Set<string>> = {
    campaign: campaignIds,
    ad_set: adSetIds,
    ad: adIds,
    creative: creativeIds,
    post: postIds,
  };

  for (const campaign of input.campaigns) {
    assertAccount(input.account.externalAccountId, campaign.externalAccountId, campaign.externalCampaignId);
    assertTrace(campaign.trace, campaign.externalCampaignId);
  }
  for (const adSet of input.adSets) {
    assertAccount(input.account.externalAccountId, adSet.externalAccountId, adSet.externalAdSetId);
    assertParent(campaignIds, adSet.externalCampaignId, adSet.externalAdSetId, "Campaign→ad set");
    assertTrace(adSet.trace, adSet.externalAdSetId);
  }
  for (const ad of input.ads) {
    assertAccount(input.account.externalAccountId, ad.externalAccountId, ad.externalAdId);
    assertParent(campaignIds, ad.externalCampaignId, ad.externalAdId, "Campaign→ad");
    assertParent(adSetIds, ad.externalAdSetId, ad.externalAdId, "Ad set→ad");
    if (ad.externalCreativeId !== null) {
      assertParent(creativeIds, ad.externalCreativeId, ad.externalAdId, "Creative→ad");
    }
    const unsafeAd = ad as typeof ad & { dailyBudgetMinor?: unknown; lifetimeBudgetMinor?: unknown };
    if (unsafeAd.dailyBudgetMinor !== undefined || unsafeAd.lifetimeBudgetMinor !== undefined) {
      throw new MetaDigitalTwinValidationError(
        "ad_level_budget_not_supported",
        ad.externalAdId,
        "Ad seviyesinde budget alanı dijital ikiz sözleşmesine alınamaz",
      );
    }
    assertTrace(ad.trace, ad.externalAdId);
  }
  for (const creative of input.creatives) {
    assertAccount(input.account.externalAccountId, creative.externalAccountId, creative.externalCreativeId);
    if (creative.externalPostId !== null) {
      assertParent(postIds, creative.externalPostId, creative.externalCreativeId, "Post→creative");
    }
    if (creative.actorExternalAssetId !== null) {
      assertParent(assetIds, creative.actorExternalAssetId, creative.externalCreativeId, "Actor asset→creative");
    }
    assertTrace(creative.trace, creative.externalCreativeId);
  }
  for (const post of input.posts) {
    if (post.actorExternalAssetId !== null) {
      assertParent(assetIds, post.actorExternalAssetId, post.externalPostId, "Actor asset→post");
    }
    assertTrace(post.trace, post.externalPostId);
  }
  for (const asset of input.assets) assertTrace(asset.trace, asset.externalAssetId);
  for (const edge of input.assetEdges) {
    assertParent(sourceIds[edge.sourceEntityType], edge.sourceExternalId, edge.sourceExternalId, "Entity→asset edge");
    assertParent(assetIds, edge.targetExternalAssetId, edge.sourceExternalId, "Asset edge target");
    assertTrace(edge.trace, `${edge.sourceEntityType}:${edge.sourceExternalId}`);
  }

  const normalized = stableValue({
    ...input,
    account: stableValue(input.account),
    campaigns: sortBy(input.campaigns, (entity) => entity.externalCampaignId),
    adSets: sortBy(input.adSets, (entity) => entity.externalAdSetId),
    ads: sortBy(input.ads, (entity) => entity.externalAdId),
    creatives: sortBy(input.creatives, (entity) => entity.externalCreativeId),
    posts: sortBy(input.posts, (entity) => entity.externalPostId),
    assets: sortBy(input.assets, (entity) => `${entity.assetType}:${entity.externalAssetId}`),
    assetEdges: sortBy(
      input.assetEdges,
      (edge) => `${edge.sourceEntityType}:${edge.sourceExternalId}:${edge.relationship}:${edge.targetExternalAssetId}`,
    ),
  }) as MetaDigitalTwinSnapshotInput;
  const snapshotHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return { ...normalized, snapshotHash };
}
