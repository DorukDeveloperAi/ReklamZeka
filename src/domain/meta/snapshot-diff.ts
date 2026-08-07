import { createHash } from "node:crypto";
import { resolveBudgetOwners } from "@/domain/meta/budget-owner";

export const META_CHANGE_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const META_CHANGE_FIELD_CATALOG_VERSION = "meta-change-fields-v1" as const;

export type Observation<T> =
  | Readonly<{ state: "known"; value: T }>
  | Readonly<{ state: "unknown"; reason: string }>;

export type MetaChangeEntityType = "campaign" | "ad_set" | "ad";
export type MetaChangeField =
  | "configured_status"
  | "effective_status"
  | "campaign_budget_optimization"
  | "daily_budget_minor"
  | "lifetime_budget_minor"
  | "budget_owner"
  | "targeting_signature"
  | "creative_binding_signature";

export type BudgetOwnerValue = Readonly<{
  model: "CBO" | "ABO";
  level: "campaign" | "ad_set";
  budgetType: "daily" | "lifetime";
  amountMinor: number;
}>;

export type MetaComparableValue = string | number | boolean | null | BudgetOwnerValue;

type StatusFields = Readonly<{
  configuredStatus: Observation<string | null>;
  effectiveStatus: Observation<string | null>;
}>;

type BudgetFields = Readonly<{
  dailyBudgetMinor: Observation<number | null>;
  lifetimeBudgetMinor: Observation<number | null>;
}>;

export type MetaChangeSnapshotInput = Readonly<{
  schemaVersion: typeof META_CHANGE_SNAPSHOT_SCHEMA_VERSION;
  workspaceId: string;
  externalAccountId: string;
  capturedAt: string;
  campaigns: readonly (StatusFields & BudgetFields & Readonly<{
    externalCampaignId: string;
    campaignBudgetOptimization: Observation<boolean>;
  }>)[];
  adSets: readonly (StatusFields & BudgetFields & Readonly<{
    externalAdSetId: string;
    externalCampaignId: string;
    targetingSignature: Observation<string | null>;
  }>)[];
  ads: readonly (StatusFields & Readonly<{
    externalAdId: string;
    externalAdSetId: string;
    externalCampaignId: string;
    creativeBindingSignature: Observation<string | null>;
  }>)[];
}>;

type CanonicalTrackedEntity = Readonly<{
  entityType: MetaChangeEntityType;
  externalId: string;
  parentExternalIds: readonly string[];
  fields: Readonly<Partial<Record<MetaChangeField, Observation<MetaComparableValue>>>>;
}>;

export type CanonicalMetaChangeSnapshot = Readonly<{
  schemaVersion: typeof META_CHANGE_SNAPSHOT_SCHEMA_VERSION;
  fieldCatalogVersion: typeof META_CHANGE_FIELD_CATALOG_VERSION;
  workspaceId: string;
  externalAccountId: string;
  capturedAt: string;
  entities: readonly CanonicalTrackedEntity[];
  snapshotHash: string;
}>;

export type MetaActionLedgerRecord = Readonly<{
  actionId: string;
  entityType: MetaChangeEntityType;
  externalEntityId: string;
  field: MetaChangeField;
  expectedFrom: MetaComparableValue;
  expectedTo: MetaComparableValue;
  appliedAt: string;
  verificationStatus: "verified" | "unverified" | "failed";
}>;

export type MetaChangeEvent = Readonly<{
  changeRef: string;
  entityRef: string;
  entityType: MetaChangeEntityType;
  field: MetaChangeField;
  before: MetaComparableValue;
  after: MetaComparableValue;
  classification: "internal_expected" | "external_change";
  correlatedActionRef: string | null;
}>;

export type MetaChangeTimeline = Readonly<{
  schemaVersion: typeof META_CHANGE_SNAPSHOT_SCHEMA_VERSION;
  fieldCatalogVersion: typeof META_CHANGE_FIELD_CATALOG_VERSION;
  previousSnapshotHash: string;
  currentSnapshotHash: string;
  period: Readonly<{ from: string; to: string }>;
  changes: readonly MetaChangeEvent[];
  diagnostics: Readonly<{
    unknownComparisons: number;
    unmatchedPreviousEntities: number;
    unmatchedCurrentEntities: number;
  }>;
  timelineHash: string;
}>;

export class MetaSnapshotDiffError extends Error {
  constructor(
    readonly code: "invalid_snapshot" | "duplicate_identity" | "orphan_parent" | "incompatible_snapshots" | "invalid_action",
    message: string,
  ) {
    super(message);
    this.name = "MetaSnapshotDiffError";
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function assertText(value: string, label: string): void {
  if (!value.trim()) throw new MetaSnapshotDiffError("invalid_snapshot", `${label} zorunludur`);
}

function assertTimestamp(value: string, label: string, action = false): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new MetaSnapshotDiffError(action ? "invalid_action" : "invalid_snapshot", `${label} geçerli olmalıdır`);
  }
}

function normalizeObservation<T extends MetaComparableValue>(
  observation: Observation<T>,
  validateKnown?: (value: T) => void,
): Observation<T> {
  if (observation.state === "unknown") {
    assertText(observation.reason, "Unknown nedeni");
    return { state: "unknown", reason: observation.reason.trim() };
  }
  validateKnown?.(observation.value);
  return { state: "known", value: stableValue(observation.value) as T };
}

function normalizeStatus(observation: Observation<string | null>): Observation<string | null> {
  return normalizeObservation(observation, (value) => {
    if (value !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) {
      throw new MetaSnapshotDiffError("invalid_snapshot", "Status güvenli Meta enum biçiminde olmalıdır");
    }
  });
}

function normalizeMoney(observation: Observation<number | null>): Observation<number | null> {
  return normalizeObservation(observation, (value) => {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new MetaSnapshotDiffError("invalid_snapshot", "Budget negatif olmayan güvenli tam sayı olmalıdır");
    }
  });
}

function normalizeSignature(observation: Observation<string | null>): Observation<string | null> {
  return normalizeObservation(observation, (value) => {
    if (value !== null && !/^sha256:[a-f0-9]{64}$/.test(value)) {
      throw new MetaSnapshotDiffError("invalid_snapshot", "Signature yalnız sha256 özeti olabilir");
    }
  });
}

function unknown<T>(reason: string): Observation<T> {
  return { state: "unknown", reason };
}

function deriveBudgetOwners(
  campaign: MetaChangeSnapshotInput["campaigns"][number],
  adSets: readonly MetaChangeSnapshotInput["adSets"][number][],
): ReadonlyMap<string, Observation<BudgetOwnerValue | null>> {
  const result = new Map<string, Observation<BudgetOwnerValue | null>>();
  const inputs = [campaign.campaignBudgetOptimization, campaign.dailyBudgetMinor, campaign.lifetimeBudgetMinor,
    ...adSets.flatMap((adSet) => [adSet.dailyBudgetMinor, adSet.lifetimeBudgetMinor])];
  if (inputs.some((entry) => entry.state === "unknown")) {
    result.set(campaign.externalCampaignId, unknown("budget_inputs_unknown"));
    for (const adSet of adSets) result.set(adSet.externalAdSetId, unknown("budget_inputs_unknown"));
    return result;
  }

  const cbo = (campaign.campaignBudgetOptimization as { state: "known"; value: boolean }).value;
  const campaignDaily = (campaign.dailyBudgetMinor as { state: "known"; value: number | null }).value;
  const campaignLifetime = (campaign.lifetimeBudgetMinor as { state: "known"; value: number | null }).value;
  const resolution = resolveBudgetOwners({
    campaign: {
      externalCampaignId: campaign.externalCampaignId,
      campaignBudgetOptimization: cbo,
      dailyBudgetMinor: campaignDaily,
      lifetimeBudgetMinor: campaignLifetime,
    },
    adSets: adSets.map((adSet) => ({
      externalAdSetId: adSet.externalAdSetId,
      dailyBudgetMinor: (adSet.dailyBudgetMinor as { state: "known"; value: number | null }).value,
      lifetimeBudgetMinor: (adSet.lifetimeBudgetMinor as { state: "known"; value: number | null }).value,
    })),
  });
  if (resolution.status === "unknown") {
    result.set(campaign.externalCampaignId, unknown(`budget_owner_${resolution.reason}`));
    for (const adSet of adSets) result.set(adSet.externalAdSetId, unknown(`budget_owner_${resolution.reason}`));
    return result;
  }

  const ownerById = new Map(resolution.owners.map((owner) => [owner.externalId, owner] as const));
  const mapOwner = (externalId: string): Observation<BudgetOwnerValue | null> => {
    const owner = ownerById.get(externalId);
    return owner
      ? { state: "known", value: { model: resolution.model, level: owner.level, budgetType: owner.budgetType, amountMinor: owner.amountMinor } }
      : { state: "known", value: null };
  };
  result.set(campaign.externalCampaignId, mapOwner(campaign.externalCampaignId));
  for (const adSet of adSets) result.set(adSet.externalAdSetId, mapOwner(adSet.externalAdSetId));
  return result;
}

/** Builds a replay-stable change snapshot. Missing platform fields must be supplied as unknown. */
export function normalizeMetaChangeSnapshot(input: MetaChangeSnapshotInput): CanonicalMetaChangeSnapshot {
  if (input.schemaVersion !== META_CHANGE_SNAPSHOT_SCHEMA_VERSION) {
    throw new MetaSnapshotDiffError("invalid_snapshot", "Snapshot şema sürümü desteklenmiyor");
  }
  assertText(input.workspaceId, "Workspace ID");
  assertText(input.externalAccountId, "Account ID");
  assertTimestamp(input.capturedAt, "Snapshot zamanı");

  const identities = [
    ...input.campaigns.map((row) => `campaign:${row.externalCampaignId}`),
    ...input.adSets.map((row) => `ad_set:${row.externalAdSetId}`),
    ...input.ads.map((row) => `ad:${row.externalAdId}`),
  ];
  if (new Set(identities).size !== identities.length) {
    throw new MetaSnapshotDiffError("duplicate_identity", "Snapshot entity kimliği tekrarlanamaz");
  }
  for (const identity of identities) assertText(identity.split(":").slice(1).join(":"), "Entity ID");

  const campaignIds = new Set(input.campaigns.map((row) => row.externalCampaignId));
  const adSetCampaign = new Map(input.adSets.map((row) => [row.externalAdSetId, row.externalCampaignId] as const));
  for (const row of input.adSets) {
    if (!campaignIds.has(row.externalCampaignId)) throw new MetaSnapshotDiffError("orphan_parent", "Ad set campaign parent bulunamadı");
  }
  for (const row of input.ads) {
    if (!campaignIds.has(row.externalCampaignId) || adSetCampaign.get(row.externalAdSetId) !== row.externalCampaignId) {
      throw new MetaSnapshotDiffError("orphan_parent", "Ad hierarchy parent bulunamadı");
    }
  }

  const budgetOwners = new Map<string, Observation<BudgetOwnerValue | null>>();
  for (const campaign of input.campaigns) {
    const ownedAdSets = input.adSets.filter((row) => row.externalCampaignId === campaign.externalCampaignId);
    for (const [id, owner] of deriveBudgetOwners(campaign, ownedAdSets)) budgetOwners.set(id, owner);
  }

  const entities: CanonicalTrackedEntity[] = [
    ...input.campaigns.map((row): CanonicalTrackedEntity => ({
      entityType: "campaign", externalId: row.externalCampaignId, parentExternalIds: [],
      fields: {
        configured_status: normalizeStatus(row.configuredStatus),
        effective_status: normalizeStatus(row.effectiveStatus),
        campaign_budget_optimization: normalizeObservation(row.campaignBudgetOptimization),
        daily_budget_minor: normalizeMoney(row.dailyBudgetMinor),
        lifetime_budget_minor: normalizeMoney(row.lifetimeBudgetMinor),
        budget_owner: budgetOwners.get(row.externalCampaignId)!,
      },
    })),
    ...input.adSets.map((row): CanonicalTrackedEntity => ({
      entityType: "ad_set", externalId: row.externalAdSetId, parentExternalIds: [row.externalCampaignId],
      fields: {
        configured_status: normalizeStatus(row.configuredStatus),
        effective_status: normalizeStatus(row.effectiveStatus),
        daily_budget_minor: normalizeMoney(row.dailyBudgetMinor),
        lifetime_budget_minor: normalizeMoney(row.lifetimeBudgetMinor),
        budget_owner: budgetOwners.get(row.externalAdSetId)!,
        targeting_signature: normalizeSignature(row.targetingSignature),
      },
    })),
    ...input.ads.map((row): CanonicalTrackedEntity => ({
      entityType: "ad", externalId: row.externalAdId, parentExternalIds: [row.externalCampaignId, row.externalAdSetId],
      fields: {
        configured_status: normalizeStatus(row.configuredStatus),
        effective_status: normalizeStatus(row.effectiveStatus),
        creative_binding_signature: normalizeSignature(row.creativeBindingSignature),
      },
    })),
  ].sort((left, right) => `${left.entityType}:${left.externalId}`.localeCompare(`${right.entityType}:${right.externalId}`));

  const canonical = stableValue({
    schemaVersion: META_CHANGE_SNAPSHOT_SCHEMA_VERSION,
    fieldCatalogVersion: META_CHANGE_FIELD_CATALOG_VERSION,
    workspaceId: input.workspaceId,
    externalAccountId: input.externalAccountId,
    capturedAt: new Date(input.capturedAt).toISOString(),
    entities,
  }) as Omit<CanonicalMetaChangeSnapshot, "snapshotHash">;
  return { ...canonical, snapshotHash: digest(canonical) };
}

function equalValue(left: MetaComparableValue, right: MetaComparableValue): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function opaqueRef(parts: readonly string[]): string {
  return `ref_${digest(parts).slice(0, 20)}`;
}

/** Produces a privacy-safe timeline; unknown observations never become invented changes. */
export function diffMetaChangeSnapshots(input: Readonly<{
  previous: CanonicalMetaChangeSnapshot;
  current: CanonicalMetaChangeSnapshot;
  actionLedger?: readonly MetaActionLedgerRecord[];
}>): MetaChangeTimeline {
  const { previous, current } = input;
  const authentic = (snapshot: CanonicalMetaChangeSnapshot): boolean => {
    const { snapshotHash, ...core } = snapshot;
    return /^[a-f0-9]{64}$/.test(snapshotHash) && digest(core) === snapshotHash;
  };
  if (
    !authentic(previous)
    || !authentic(current)
    || previous.schemaVersion !== current.schemaVersion
    || previous.fieldCatalogVersion !== current.fieldCatalogVersion
    || previous.workspaceId !== current.workspaceId
    || previous.externalAccountId !== current.externalAccountId
    || Date.parse(previous.capturedAt) > Date.parse(current.capturedAt)
  ) throw new MetaSnapshotDiffError("incompatible_snapshots", "Snapshotlar aynı account/catalog ve kronolojik sırada olmalıdır");

  const actions = [...(input.actionLedger ?? [])].map((action) => {
    assertText(action.actionId, "Action ID");
    assertText(action.externalEntityId, "Action entity ID");
    assertTimestamp(action.appliedAt, "Action zamanı", true);
    if (!["verified", "unverified", "failed"].includes(action.verificationStatus)) {
      throw new MetaSnapshotDiffError("invalid_action", "Action verification durumu geçersiz");
    }
    return action;
  }).sort((left, right) => left.appliedAt.localeCompare(right.appliedAt) || left.actionId.localeCompare(right.actionId));
  const previousMap = new Map(previous.entities.map((entity) => [`${entity.entityType}:${entity.externalId}`, entity]));
  const currentMap = new Map(current.entities.map((entity) => [`${entity.entityType}:${entity.externalId}`, entity]));
  let unknownComparisons = 0;
  const changes: MetaChangeEvent[] = [];

  for (const [key, currentEntity] of currentMap) {
    const previousEntity = previousMap.get(key);
    if (!previousEntity) continue;
    const fields = Object.keys(currentEntity.fields).sort() as MetaChangeField[];
    for (const field of fields) {
      const before = previousEntity.fields[field];
      const after = currentEntity.fields[field];
      if (!before || !after || before.state === "unknown" || after.state === "unknown") {
        unknownComparisons += 1;
        continue;
      }
      if (equalValue(before.value, after.value)) continue;
      const correlated = [...actions].reverse().find((action) =>
        action.verificationStatus === "verified"
        && action.entityType === currentEntity.entityType
        && action.externalEntityId === currentEntity.externalId
        && action.field === field
        && Date.parse(action.appliedAt) > Date.parse(previous.capturedAt)
        && Date.parse(action.appliedAt) <= Date.parse(current.capturedAt)
        && equalValue(action.expectedTo, after.value)
        && equalValue(action.expectedFrom, before.value));
      changes.push({
        changeRef: opaqueRef([previous.snapshotHash, current.snapshotHash, key, field]),
        entityRef: opaqueRef([current.workspaceId, current.externalAccountId, key]),
        entityType: currentEntity.entityType,
        field,
        before: before.value,
        after: after.value,
        classification: correlated ? "internal_expected" : "external_change",
        correlatedActionRef: correlated ? opaqueRef([current.workspaceId, correlated.actionId]) : null,
      });
    }
  }
  const entityRank: Record<MetaChangeEntityType, number> = { campaign: 0, ad_set: 1, ad: 2 };
  changes.sort((left, right) =>
    entityRank[left.entityType] - entityRank[right.entityType]
    || left.entityRef.localeCompare(right.entityRef)
    || left.field.localeCompare(right.field));
  const timelineCore = {
    schemaVersion: META_CHANGE_SNAPSHOT_SCHEMA_VERSION,
    fieldCatalogVersion: META_CHANGE_FIELD_CATALOG_VERSION,
    previousSnapshotHash: previous.snapshotHash,
    currentSnapshotHash: current.snapshotHash,
    period: { from: previous.capturedAt, to: current.capturedAt },
    changes,
    diagnostics: {
      unknownComparisons,
      unmatchedPreviousEntities: [...previousMap.keys()].filter((key) => !currentMap.has(key)).length,
      unmatchedCurrentEntities: [...currentMap.keys()].filter((key) => !previousMap.has(key)).length,
    },
  } as const;
  return { ...timelineCore, timelineHash: digest(timelineCore) };
}
