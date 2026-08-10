import { createHash } from "node:crypto";
import type { CampaignObjective, OptimizationEvent } from "@/analyses/schema";
import {
  META_OBJECTIVE_MAPPING_VERSION,
  normalizeMetaCampaignObjective,
} from "@/domain/meta/objective-mapping";
import {
  META_OPTIMIZATION_MAPPING_VERSION,
  normalizeMetaAdSetOptimizationGoal,
} from "@/domain/meta/optimization-mapping";
import type { CanonicalMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";

export const META_ANALYSIS_CONFIG_SNAPSHOT_VERSION = "meta-analysis-config-snapshot/2.0.0" as const;

type SourceObservation =
  | Readonly<{ state: "known"; value: string | null }>
  | Readonly<{ state: "unknown"; reason: string }>;

type ConfigObservation<T, R extends string> =
  | Readonly<{ state: "known"; value: T }>
  | Readonly<{ state: "unknown"; reason: R }>;

export type MetaAnalysisConfigSnapshotV2Input = Readonly<{
  version: typeof META_ANALYSIS_CONFIG_SNAPSHOT_VERSION;
  workspaceId: string;
  externalAccountId: string;
  capturedAt: string;
  campaigns: readonly Readonly<{
    externalCampaignId: string;
    objective: SourceObservation;
  }>[];
  adSets: readonly Readonly<{
    externalAdSetId: string;
    externalCampaignId: string;
    optimizationGoal: SourceObservation;
  }>[];
}>;

export type MetaConfigObjectiveUnknownReason =
  | "objective_missing"
  | "objective_invalid"
  | "objective_unmapped"
  | "objective_not_observed";

export type MetaConfigOptimizationUnknownReason =
  | "optimization_goal_missing"
  | "optimization_goal_invalid"
  | "optimization_goal_unmapped"
  | "optimization_goal_not_observed"
  | "no_ad_sets"
  | "mixed_ad_set_optimization_goals"
  | "ambiguous_ad_set_optimization_goals"
  | "legacy_snapshot_missing_optimization_goal";

export type CanonicalMetaAnalysisConfigSnapshotV2 = Readonly<{
  version: typeof META_ANALYSIS_CONFIG_SNAPSHOT_VERSION;
  objectiveMappingVersion: typeof META_OBJECTIVE_MAPPING_VERSION;
  optimizationMappingVersion: typeof META_OPTIMIZATION_MAPPING_VERSION;
  workspaceId: string;
  externalAccountId: string;
  capturedAt: string;
  campaigns: readonly Readonly<{
    externalCampaignId: string;
    objective: ConfigObservation<CampaignObjective, MetaConfigObjectiveUnknownReason>;
  }>[];
  adSets: readonly Readonly<{
    externalAdSetId: string;
    externalCampaignId: string;
    optimizationEvent: ConfigObservation<OptimizationEvent, Exclude<MetaConfigOptimizationUnknownReason, "no_ad_sets" | "mixed_ad_set_optimization_goals" | "ambiguous_ad_set_optimization_goals" | "legacy_snapshot_missing_optimization_goal">>;
  }>[];
  snapshotHash: string;
  capabilities: Readonly<{
    canAuthorizeAction: false;
    canExecuteWrite: false;
    canWriteMeta: false;
  }>;
}>;

export type MetaAnalysisConfigProjection = Readonly<{
  version: typeof META_ANALYSIS_CONFIG_SNAPSHOT_VERSION;
  snapshotHash: string;
  externalCampaignId: string;
  objective: ConfigObservation<CampaignObjective, MetaConfigObjectiveUnknownReason | "legacy_snapshot_missing_objective">;
  optimizationEvent: ConfigObservation<OptimizationEvent, MetaConfigOptimizationUnknownReason>;
  adSetOptimizationEvents: readonly Readonly<{
    externalAdSetId: string;
    optimizationEvent: CanonicalMetaAnalysisConfigSnapshotV2["adSets"][number]["optimizationEvent"];
  }>[];
  capabilities: Readonly<{
    canAuthorizeAction: false;
    canExecuteWrite: false;
    canWriteMeta: false;
  }>;
}>;

export class MetaAnalysisConfigSnapshotError extends Error {
  constructor(readonly code: "invalid_snapshot" | "duplicate_identity" | "orphan_parent" | "inauthentic_snapshot" | "campaign_not_found") {
    super(`Meta analysis config snapshot reddedildi: ${code}`);
    this.name = "MetaAnalysisConfigSnapshotError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CAPABILITIES = Object.freeze({ canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false } as const);

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stable(entry)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function validText(value: string): boolean { return ID.test(value); }

function exact(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new MetaAnalysisConfigSnapshotError("invalid_snapshot");
  }
}

function observed(value: unknown): SourceObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MetaAnalysisConfigSnapshotError("invalid_snapshot");
  const candidate = value as Readonly<Record<string, unknown>>;
  exact(candidate, candidate.state === "known" ? ["state", "value"] : ["state", "reason"]);
  if (candidate.state === "known") {
    if (candidate.value !== null && (typeof candidate.value !== "string" || candidate.value.length > 64)) {
      throw new MetaAnalysisConfigSnapshotError("invalid_snapshot");
    }
    return Object.freeze({ state: "known", value: candidate.value as string | null });
  }
  if (candidate.state !== "unknown" || typeof candidate.reason !== "string" || !candidate.reason.trim() || candidate.reason.length > 128) {
    throw new MetaAnalysisConfigSnapshotError("invalid_snapshot");
  }
  return Object.freeze({ state: "unknown", reason: candidate.reason.trim() });
}

function objective(value: SourceObservation): CanonicalMetaAnalysisConfigSnapshotV2["campaigns"][number]["objective"] {
  const normalized = observed(value);
  if (normalized.state === "unknown") return Object.freeze({ state: "unknown", reason: "objective_not_observed" });
  const mapped = normalizeMetaCampaignObjective(normalized.value);
  if (mapped.status === "mapped") return Object.freeze({ state: "known", value: mapped.canonicalObjective as CampaignObjective });
  const reason = mapped.reason === "source_missing" ? "objective_missing"
    : mapped.reason === "source_invalid" ? "objective_invalid" : "objective_unmapped";
  return Object.freeze({ state: "unknown", reason });
}

function optimization(value: SourceObservation): CanonicalMetaAnalysisConfigSnapshotV2["adSets"][number]["optimizationEvent"] {
  const normalized = observed(value);
  if (normalized.state === "unknown") return Object.freeze({ state: "unknown", reason: "optimization_goal_not_observed" });
  const mapped = normalizeMetaAdSetOptimizationGoal(normalized.value);
  if (mapped.status === "mapped") return Object.freeze({ state: "known", value: mapped.canonicalOptimizationEvent as OptimizationEvent });
  const reason = mapped.reason === "source_missing" ? "optimization_goal_missing"
    : mapped.reason === "source_invalid" ? "optimization_goal_invalid" : "optimization_goal_unmapped";
  return Object.freeze({ state: "unknown", reason });
}

/** Canonicalizes only bounded config fields and freezes mapping versions into the hash. */
export function normalizeMetaAnalysisConfigSnapshotV2(input: MetaAnalysisConfigSnapshotV2Input): CanonicalMetaAnalysisConfigSnapshotV2 {
  exact(input, ["version", "workspaceId", "externalAccountId", "capturedAt", "campaigns", "adSets"]);
  if (input.version !== META_ANALYSIS_CONFIG_SNAPSHOT_VERSION || !validText(input.workspaceId)
    || !validText(input.externalAccountId) || !Number.isFinite(Date.parse(input.capturedAt))) {
    throw new MetaAnalysisConfigSnapshotError("invalid_snapshot");
  }
  const campaignIds = input.campaigns.map((campaign) => campaign.externalCampaignId);
  const adSetIds = input.adSets.map((adSet) => adSet.externalAdSetId);
  if (campaignIds.some((id) => !validText(id)) || adSetIds.some((id) => !validText(id))
    || new Set(campaignIds).size !== campaignIds.length || new Set(adSetIds).size !== adSetIds.length) {
    throw new MetaAnalysisConfigSnapshotError("duplicate_identity");
  }
  const campaignSet = new Set(campaignIds);
  if (input.adSets.some((adSet) => !validText(adSet.externalCampaignId) || !campaignSet.has(adSet.externalCampaignId))) {
    throw new MetaAnalysisConfigSnapshotError("orphan_parent");
  }
  const canonical = stable({
    version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
    objectiveMappingVersion: META_OBJECTIVE_MAPPING_VERSION,
    optimizationMappingVersion: META_OPTIMIZATION_MAPPING_VERSION,
    workspaceId: input.workspaceId,
    externalAccountId: input.externalAccountId,
    capturedAt: new Date(input.capturedAt).toISOString(),
    campaigns: input.campaigns.map((campaign) => Object.freeze({ externalCampaignId: campaign.externalCampaignId, objective: objective(campaign.objective) }))
      .sort((left, right) => left.externalCampaignId.localeCompare(right.externalCampaignId)),
    adSets: input.adSets.map((adSet) => Object.freeze({ externalAdSetId: adSet.externalAdSetId,
      externalCampaignId: adSet.externalCampaignId, optimizationEvent: optimization(adSet.optimizationGoal) }))
      .sort((left, right) => left.externalAdSetId.localeCompare(right.externalAdSetId)),
    capabilities: CAPABILITIES,
  }) as Omit<CanonicalMetaAnalysisConfigSnapshotV2, "snapshotHash">;
  return Object.freeze({ ...canonical, snapshotHash: hash(canonical) });
}

function authentic(snapshot: CanonicalMetaAnalysisConfigSnapshotV2): boolean {
  const { snapshotHash, ...core } = snapshot;
  return /^[a-f0-9]{64}$/.test(snapshotHash) && hash(core) === snapshotHash;
}

function projectOptimization(
  adSets: readonly CanonicalMetaAnalysisConfigSnapshotV2["adSets"][number][],
): MetaAnalysisConfigProjection["optimizationEvent"] {
  if (adSets.length === 0) return Object.freeze({ state: "unknown", reason: "no_ad_sets" });
  const known = adSets.filter((adSet): adSet is typeof adSet & { optimizationEvent: Readonly<{ state: "known"; value: OptimizationEvent }> } => adSet.optimizationEvent.state === "known");
  if (known.length === 0) return Object.freeze({ state: "unknown", reason: "ambiguous_ad_set_optimization_goals" });
  if (known.length !== adSets.length) return Object.freeze({ state: "unknown", reason: "ambiguous_ad_set_optimization_goals" });
  if (new Set(known.map((adSet) => adSet.optimizationEvent.value)).size !== 1) {
    return Object.freeze({ state: "unknown", reason: "mixed_ad_set_optimization_goals" });
  }
  return Object.freeze({ state: "known", value: known[0]!.optimizationEvent.value });
}

/**
 * Pure projection for analysis context assembly. It validates the immutable snapshot
 * before reading it and never re-runs a newer mapping during replay.
 */
export function projectMetaAnalysisConfig(
  snapshot: CanonicalMetaAnalysisConfigSnapshotV2,
  externalCampaignId: string,
): MetaAnalysisConfigProjection {
  if (!authentic(snapshot)) throw new MetaAnalysisConfigSnapshotError("inauthentic_snapshot");
  const campaign = snapshot.campaigns.find((entry) => entry.externalCampaignId === externalCampaignId);
  if (!campaign) throw new MetaAnalysisConfigSnapshotError("campaign_not_found");
  const adSets = snapshot.adSets.filter((entry) => entry.externalCampaignId === externalCampaignId);
  return Object.freeze({
    version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
    snapshotHash: snapshot.snapshotHash,
    externalCampaignId,
    objective: campaign.objective,
    optimizationEvent: projectOptimization(adSets),
    adSetOptimizationEvents: Object.freeze(adSets.map((adSet) => Object.freeze({ externalAdSetId: adSet.externalAdSetId,
      optimizationEvent: adSet.optimizationEvent }))),
    capabilities: CAPABILITIES,
  });
}

/** Existing v1 change snapshots remain replayable, but cannot invent config fields they never captured. */
export function projectLegacyMetaChangeSnapshotConfig(
  snapshot: CanonicalMetaChangeSnapshot,
  externalCampaignId: string,
): MetaAnalysisConfigProjection {
  const { snapshotHash, ...core } = snapshot;
  if (!/^[a-f0-9]{64}$/.test(snapshotHash) || hash(core) !== snapshotHash) {
    throw new MetaAnalysisConfigSnapshotError("inauthentic_snapshot");
  }
  if (!snapshot.entities.some((entity) => entity.entityType === "campaign" && entity.externalId === externalCampaignId)) {
    throw new MetaAnalysisConfigSnapshotError("campaign_not_found");
  }
  const adSetOptimizationEvents = snapshot.entities
    .filter((entity) => entity.entityType === "ad_set" && entity.parentExternalIds[0] === externalCampaignId)
    .sort((left, right) => left.externalId.localeCompare(right.externalId))
    .map((entity) => Object.freeze({ externalAdSetId: entity.externalId,
      optimizationEvent: Object.freeze({ state: "unknown" as const, reason: "optimization_goal_not_observed" as const }) }));
  return Object.freeze({
    version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
    snapshotHash: snapshot.snapshotHash,
    externalCampaignId,
    objective: Object.freeze({ state: "unknown", reason: "legacy_snapshot_missing_objective" }),
    optimizationEvent: Object.freeze({ state: "unknown", reason: "legacy_snapshot_missing_optimization_goal" }),
    adSetOptimizationEvents: Object.freeze(adSetOptimizationEvents),
    capabilities: CAPABILITIES,
  });
}
