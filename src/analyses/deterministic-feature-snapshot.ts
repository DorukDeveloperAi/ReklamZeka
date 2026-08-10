import { createHash } from "node:crypto";
import type { FindingObservation } from "@/analyses/finding-calculators";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";
import { META_METRIC_FORMULA_CATALOG_VERSION } from "@/domain/meta/insights/metric-engine";

export const DETERMINISTIC_FEATURE_SNAPSHOT_VERSION = "deterministic-feature-snapshot/1.0.0" as const;

export type DeterministicFeatureSnapshot = Readonly<{
  contractVersion: typeof DETERMINISTIC_FEATURE_SNAPSHOT_VERSION;
  featureRef: string;
  featureHash: string;
  scope: Readonly<{
    workspaceId: string;
    metaConnectionId: string;
    adAccountId: string;
    entityLevel: "campaign" | "ad_set" | "ad";
    externalEntityId: string;
  }>;
  observationRef: string;
  role: FindingObservation["role"];
  startDate: string;
  endDate: string;
  timezone: string;
  sampleSize: number;
  settled: boolean;
  qualityStatus: FindingObservation["qualityStatus"];
  qualityReasonCodes: readonly string[];
  sourceManifestHash: string;
  sourceSnapshotRefs: readonly string[];
  formulaCatalogVersion: typeof META_METRIC_FORMULA_CATALOG_VERSION;
  metricResult: FindingObservation["metricResult"];
  capabilities: Readonly<{ containsRawL0: false; canAuthorizeAction: false; canExecuteWrite: false }>;
}>;

export class DeterministicFeatureSnapshotError extends Error {
  constructor(readonly code: "invalid_input" | "inauthentic_component" | "forbidden_material") {
    super(`Deterministic feature snapshot oluşturulamadı: ${code}`);
    this.name = "DeterministicFeatureSnapshotError";
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function refs(values: readonly string[]): readonly string[] {
  const result = [...new Set(values)].sort();
  if (!result.length || result.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value))) {
    throw new DeterministicFeatureSnapshotError("invalid_input");
  }
  return Object.freeze(result);
}

/** Freezes one authenticated L2 observation as an immutable, source-manifest-bound feature value. */
export function buildDeterministicFeatureSnapshot(input: Readonly<{
  scope: DeterministicFeatureSnapshot["scope"];
  observation: FindingObservation;
}>): DeterministicFeatureSnapshot {
  if (Object.keys(input).some((key) => !["scope", "observation"].includes(key)) || !inspectMetaPersistenceWrite(input).compliant) {
    throw new DeterministicFeatureSnapshotError("forbidden_material");
  }
  const { scope, observation } = input;
  if (!scope || ![scope.workspaceId, scope.metaConnectionId, scope.adAccountId, scope.externalEntityId].every((value) => typeof value === "string" && value.trim().length > 0)
    || !["campaign", "ad_set", "ad"].includes(scope.entityLevel) || !observation || typeof observation !== "object") {
    throw new DeterministicFeatureSnapshotError("invalid_input");
  }
  const expectedResultHash = hash({ catalogVersion: observation.metricResult.catalogVersion, metrics: observation.metricResult.metrics });
  if (observation.metricResult.catalogVersion !== META_METRIC_FORMULA_CATALOG_VERSION || observation.metricResult.resultHash !== expectedResultHash
    || !observation.observationRef || !/^\d{4}-\d{2}-\d{2}$/.test(observation.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(observation.endDate)
    || !Number.isSafeInteger(observation.sampleSize) || observation.sampleSize < 0 || !["ready", "degraded"].includes(observation.qualityStatus)) {
    throw new DeterministicFeatureSnapshotError("inauthentic_component");
  }
  const sourceSnapshotRefs = refs(observation.snapshotRefs);
  const qualityReasonCodes = Object.freeze([...new Set(observation.qualityReasonCodes)].sort());
  const sourceManifestHash = hash({ sourceSnapshotRefs, observationRef: observation.observationRef, startDate: observation.startDate, endDate: observation.endDate });
  const core = {
    contractVersion: DETERMINISTIC_FEATURE_SNAPSHOT_VERSION,
    scope: Object.freeze({ ...scope }), observationRef: observation.observationRef, role: observation.role,
    startDate: observation.startDate, endDate: observation.endDate, timezone: observation.timezone,
    sampleSize: observation.sampleSize, settled: observation.settled, qualityStatus: observation.qualityStatus,
    qualityReasonCodes, sourceManifestHash, sourceSnapshotRefs,
    formulaCatalogVersion: META_METRIC_FORMULA_CATALOG_VERSION, metricResult: observation.metricResult,
    capabilities: { containsRawL0: false as const, canAuthorizeAction: false as const, canExecuteWrite: false as const },
  };
  const featureHash = hash(core);
  return Object.freeze({ ...core, featureHash, featureRef: `feature_${featureHash.slice(0, 24)}` });
}

/** Re-authenticates a persisted candidate before any repository write or replay. */
export function assertDeterministicFeatureSnapshot(value: unknown): asserts value is DeterministicFeatureSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value) || !inspectMetaPersistenceWrite(value).compliant) {
    throw new DeterministicFeatureSnapshotError("forbidden_material");
  }
  const snapshot = value as DeterministicFeatureSnapshot;
  const keys = ["contractVersion", "featureRef", "featureHash", "scope", "observationRef", "role", "startDate", "endDate", "timezone", "sampleSize", "settled", "qualityStatus", "qualityReasonCodes", "sourceManifestHash", "sourceSnapshotRefs", "formulaCatalogVersion", "metricResult", "capabilities"];
  if (Object.keys(snapshot).length !== keys.length || Object.keys(snapshot).some((key) => !keys.includes(key))
    || snapshot.contractVersion !== DETERMINISTIC_FEATURE_SNAPSHOT_VERSION
    || snapshot.formulaCatalogVersion !== META_METRIC_FORMULA_CATALOG_VERSION
    || !snapshot.scope || ![snapshot.scope.workspaceId, snapshot.scope.metaConnectionId, snapshot.scope.adAccountId, snapshot.scope.externalEntityId].every((entry) => typeof entry === "string" && entry.trim())
    || !["campaign", "ad_set", "ad"].includes(snapshot.scope.entityLevel)
    || !["primary", "comparison", "series", "pre", "post"].includes(snapshot.role)
    || !Number.isSafeInteger(snapshot.sampleSize) || snapshot.sampleSize < 0 || typeof snapshot.settled !== "boolean"
    || !["ready", "degraded"].includes(snapshot.qualityStatus) || !Array.isArray(snapshot.qualityReasonCodes)
    || !Array.isArray(snapshot.sourceSnapshotRefs) || snapshot.capabilities?.containsRawL0 !== false
    || snapshot.capabilities?.canAuthorizeAction !== false || snapshot.capabilities?.canExecuteWrite !== false) {
    throw new DeterministicFeatureSnapshotError("inauthentic_component");
  }
  const sourceSnapshotRefs = refs(snapshot.sourceSnapshotRefs);
  const qualityReasonCodes = Object.freeze([...new Set(snapshot.qualityReasonCodes)].sort());
  const expectedSourceManifestHash = hash({ sourceSnapshotRefs, observationRef: snapshot.observationRef, startDate: snapshot.startDate, endDate: snapshot.endDate });
  const expectedResultHash = hash({ catalogVersion: snapshot.metricResult?.catalogVersion, metrics: snapshot.metricResult?.metrics });
  const core = { contractVersion: snapshot.contractVersion, scope: snapshot.scope, observationRef: snapshot.observationRef, role: snapshot.role,
    startDate: snapshot.startDate, endDate: snapshot.endDate, timezone: snapshot.timezone, sampleSize: snapshot.sampleSize, settled: snapshot.settled,
    qualityStatus: snapshot.qualityStatus, qualityReasonCodes, sourceManifestHash: snapshot.sourceManifestHash, sourceSnapshotRefs,
    formulaCatalogVersion: snapshot.formulaCatalogVersion, metricResult: snapshot.metricResult, capabilities: snapshot.capabilities };
  const expectedFeatureHash = hash(core);
  if (snapshot.sourceManifestHash !== expectedSourceManifestHash || snapshot.metricResult?.resultHash !== expectedResultHash
    || snapshot.featureHash !== expectedFeatureHash || snapshot.featureRef !== `feature_${expectedFeatureHash.slice(0, 24)}`) {
    throw new DeterministicFeatureSnapshotError("inauthentic_component");
  }
}
