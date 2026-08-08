export const OUTCOME_PROXY_MAPPING_VERSION = "outcome-proxy-mapping/1.0.0" as const;

export type BusinessOutcomeTarget = Readonly<{
  targetRef: string;
  outcomeRef: string;
  direction: "maximize" | "minimize" | "maintain";
  targetValueDecimal: string;
  unitRef: string;
  timeframeRef: string;
}>;

export type MetaProxyMetric = Readonly<{
  metricRef: string;
  entityLevel: "campaign" | "adset" | "ad";
  aggregation: "sum" | "average" | "ratio";
  attributionWindowRef: string;
}>;

export type OutcomeProxyMapping = Readonly<{
  mappingRef: string;
  outcomeRef: string;
  timeframeRef: string;
  proxy: MetaProxyMetric;
  scope: Readonly<{
    categoryRefs: readonly string[];
    objectiveRefs: readonly string[];
  }>;
  evidence: Readonly<{
    sampleSize: number;
    coverageBps: number;
    observedFromAt: string;
    observedThroughAt: string;
    retrievedAt: string;
    proxyToOutcomeLagMinutes: number;
    confidenceBps: number;
  }>;
  review: Readonly<{
    status: "pending" | "approved" | "rejected";
    reviewerRef: string | null;
    reviewedAt: string | null;
    reviewDueAt: string;
  }>;
  provenance: Readonly<{
    sourceKind: "owner_instruction" | "validated_observation" | "external_research";
    sourceRef: string;
    configuredByRef: string;
    configuredAt: string;
  }>;
}>;

export type MappingSuppressionReason =
  | "target_mismatch"
  | "timeframe_mismatch"
  | "category_scope_mismatch"
  | "objective_scope_mismatch"
  | "review_pending"
  | "review_rejected"
  | "review_stale"
  | "evidence_stale"
  | "insufficient_sample"
  | "insufficient_coverage"
  | "excessive_lag"
  | "insufficient_confidence";

export type OutcomeProxyMappingInput = Readonly<{
  target: BusinessOutcomeTarget;
  context: Readonly<{
    categoryRef: string;
    objectiveRef: string;
  }>;
  asOfAt: string;
  mappings: readonly OutcomeProxyMapping[];
  policy: Readonly<{
    minimumSampleSize: number;
    minimumCoverageBps: number;
    maximumLagMinutes: number;
    minimumConfidenceBps: number;
    maximumEvidenceFreshnessMinutes: number;
  }>;
}>;

export type OutcomeProxyMappingPlan = Readonly<{
  schemaVersion: typeof OUTCOME_PROXY_MAPPING_VERSION;
  status: "ready" | "suppressed";
  target: BusinessOutcomeTarget;
  context: OutcomeProxyMappingInput["context"];
  asOfAt: string;
  policy: OutcomeProxyMappingInput["policy"];
  selected: OutcomeProxyMapping | null;
  suppressionReasons: readonly ("missing_mapping" | "no_eligible_mapping" | "ambiguous_mapping")[];
  evaluations: readonly Readonly<{
    mappingRef: string;
    eligible: boolean;
    suppressionReasons: readonly MappingSuppressionReason[];
  }>[];
  actionAuthority: "none";
}>;

export class OutcomeProxyMappingError extends Error {
  constructor(readonly code: "invalid_contract" | "invalid_target" | "invalid_mapping" | "invalid_policy") {
    super("İş sonucu ile Meta proxy eşlemesi güvenli biçimde değerlendirilemedi");
    this.name = "OutcomeProxyMappingError";
  }
}

const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const DECIMAL = /^-?(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;

function fail(code: OutcomeProxyMappingError["code"]): never {
  throw new OutcomeProxyMappingError(code);
}

function exactKeys(value: unknown, keys: readonly string[], code: OutcomeProxyMappingError["code"]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(code);
}

function reference(value: unknown, code: OutcomeProxyMappingError["code"]): string {
  if (typeof value !== "string" || !REF.test(value)) fail(code);
  return value;
}

function instant(value: unknown, code: OutcomeProxyMappingError["code"]): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail(code);
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch)) fail(code);
  return epoch;
}

function integer(value: unknown, minimum: number, maximum: number, code: OutcomeProxyMappingError["code"]): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(code);
  return value as number;
}

function references(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) fail("invalid_mapping");
  const refs = value.map((item) => reference(item, "invalid_mapping"));
  if (new Set(refs).size !== refs.length) fail("invalid_mapping");
  return refs;
}

function validateTarget(target: BusinessOutcomeTarget): void {
  exactKeys(target, ["targetRef", "outcomeRef", "direction", "targetValueDecimal", "unitRef", "timeframeRef"], "invalid_contract");
  reference(target.targetRef, "invalid_target");
  reference(target.outcomeRef, "invalid_target");
  reference(target.unitRef, "invalid_target");
  reference(target.timeframeRef, "invalid_target");
  if (!["maximize", "minimize", "maintain"].includes(target.direction) || !DECIMAL.test(target.targetValueDecimal)) fail("invalid_target");
}

function validateMapping(mapping: OutcomeProxyMapping, asOfAt: number): void {
  exactKeys(mapping, ["mappingRef", "outcomeRef", "timeframeRef", "proxy", "scope", "evidence", "review", "provenance"], "invalid_contract");
  exactKeys(mapping.proxy, ["metricRef", "entityLevel", "aggregation", "attributionWindowRef"], "invalid_contract");
  exactKeys(mapping.scope, ["categoryRefs", "objectiveRefs"], "invalid_contract");
  exactKeys(mapping.evidence, ["sampleSize", "coverageBps", "observedFromAt", "observedThroughAt", "retrievedAt", "proxyToOutcomeLagMinutes", "confidenceBps"], "invalid_contract");
  exactKeys(mapping.review, ["status", "reviewerRef", "reviewedAt", "reviewDueAt"], "invalid_contract");
  exactKeys(mapping.provenance, ["sourceKind", "sourceRef", "configuredByRef", "configuredAt"], "invalid_contract");

  reference(mapping.mappingRef, "invalid_mapping");
  reference(mapping.outcomeRef, "invalid_mapping");
  reference(mapping.timeframeRef, "invalid_mapping");
  reference(mapping.proxy.metricRef, "invalid_mapping");
  reference(mapping.proxy.attributionWindowRef, "invalid_mapping");
  if (mapping.proxy.metricRef === mapping.outcomeRef) fail("invalid_mapping");
  if (!["campaign", "adset", "ad"].includes(mapping.proxy.entityLevel) || !["sum", "average", "ratio"].includes(mapping.proxy.aggregation)) fail("invalid_mapping");
  references(mapping.scope.categoryRefs);
  references(mapping.scope.objectiveRefs);

  integer(mapping.evidence.sampleSize, 0, Number.MAX_SAFE_INTEGER, "invalid_mapping");
  integer(mapping.evidence.coverageBps, 0, 10_000, "invalid_mapping");
  integer(mapping.evidence.proxyToOutcomeLagMinutes, 0, 5_256_000, "invalid_mapping");
  integer(mapping.evidence.confidenceBps, 0, 10_000, "invalid_mapping");
  const observedFrom = instant(mapping.evidence.observedFromAt, "invalid_mapping");
  const observedThrough = instant(mapping.evidence.observedThroughAt, "invalid_mapping");
  const retrievedAt = instant(mapping.evidence.retrievedAt, "invalid_mapping");
  if (observedFrom > observedThrough || observedThrough > retrievedAt || retrievedAt > asOfAt) fail("invalid_mapping");

  if (!["pending", "approved", "rejected"].includes(mapping.review.status)) fail("invalid_mapping");
  const reviewDueAt = instant(mapping.review.reviewDueAt, "invalid_mapping");
  if (mapping.review.status === "pending") {
    if (mapping.review.reviewerRef !== null || mapping.review.reviewedAt !== null) fail("invalid_mapping");
  } else {
    reference(mapping.review.reviewerRef, "invalid_mapping");
    const reviewedAt = instant(mapping.review.reviewedAt, "invalid_mapping");
    if (reviewedAt > reviewDueAt || reviewedAt > asOfAt) fail("invalid_mapping");
  }

  if (!["owner_instruction", "validated_observation", "external_research"].includes(mapping.provenance.sourceKind)) fail("invalid_mapping");
  reference(mapping.provenance.sourceRef, "invalid_mapping");
  reference(mapping.provenance.configuredByRef, "invalid_mapping");
  if (instant(mapping.provenance.configuredAt, "invalid_mapping") > asOfAt) fail("invalid_mapping");
}

/**
 * Pure, configuration-only mapping gate. It never invents a proxy, selects
 * between multiple eligible mappings, persists data, or grants action authority.
 */
export function buildOutcomeProxyMappingPlan(input: OutcomeProxyMappingInput): OutcomeProxyMappingPlan {
  exactKeys(input, ["target", "context", "asOfAt", "mappings", "policy"], "invalid_contract");
  exactKeys(input.context, ["categoryRef", "objectiveRef"], "invalid_contract");
  exactKeys(input.policy, ["minimumSampleSize", "minimumCoverageBps", "maximumLagMinutes", "minimumConfidenceBps", "maximumEvidenceFreshnessMinutes"], "invalid_contract");
  validateTarget(input.target);
  reference(input.context.categoryRef, "invalid_contract");
  reference(input.context.objectiveRef, "invalid_contract");
  const asOfAt = instant(input.asOfAt, "invalid_contract");
  if (!Array.isArray(input.mappings)) fail("invalid_contract");

  integer(input.policy.minimumSampleSize, 1, Number.MAX_SAFE_INTEGER, "invalid_policy");
  integer(input.policy.minimumCoverageBps, 1, 10_000, "invalid_policy");
  integer(input.policy.maximumLagMinutes, 0, 5_256_000, "invalid_policy");
  integer(input.policy.minimumConfidenceBps, 1, 10_000, "invalid_policy");
  integer(input.policy.maximumEvidenceFreshnessMinutes, 0, 5_256_000, "invalid_policy");

  const mappingRefs = new Set<string>();
  input.mappings.forEach((mapping) => {
    validateMapping(mapping, asOfAt);
    if (mappingRefs.has(mapping.mappingRef)) fail("invalid_mapping");
    mappingRefs.add(mapping.mappingRef);
  });

  const evaluations = [...input.mappings]
    .sort((left, right) => left.mappingRef.localeCompare(right.mappingRef))
    .map((mapping) => {
      const reasons: MappingSuppressionReason[] = [];
      if (mapping.outcomeRef !== input.target.outcomeRef) reasons.push("target_mismatch");
      if (mapping.timeframeRef !== input.target.timeframeRef) reasons.push("timeframe_mismatch");
      if (!mapping.scope.categoryRefs.includes(input.context.categoryRef)) reasons.push("category_scope_mismatch");
      if (!mapping.scope.objectiveRefs.includes(input.context.objectiveRef)) reasons.push("objective_scope_mismatch");
      if (mapping.review.status === "pending") reasons.push("review_pending");
      if (mapping.review.status === "rejected") reasons.push("review_rejected");
      if (Date.parse(mapping.review.reviewDueAt) < asOfAt) reasons.push("review_stale");
      if (asOfAt - Date.parse(mapping.evidence.observedThroughAt) > input.policy.maximumEvidenceFreshnessMinutes * 60_000) reasons.push("evidence_stale");
      if (mapping.evidence.sampleSize < input.policy.minimumSampleSize) reasons.push("insufficient_sample");
      if (mapping.evidence.coverageBps < input.policy.minimumCoverageBps) reasons.push("insufficient_coverage");
      if (mapping.evidence.proxyToOutcomeLagMinutes > input.policy.maximumLagMinutes) reasons.push("excessive_lag");
      if (mapping.evidence.confidenceBps < input.policy.minimumConfidenceBps) reasons.push("insufficient_confidence");
      return Object.freeze({ mappingRef: mapping.mappingRef, eligible: reasons.length === 0, suppressionReasons: Object.freeze(reasons) });
    });

  const eligibleRefs = evaluations.filter((evaluation) => evaluation.eligible).map((evaluation) => evaluation.mappingRef);
  const structurallyRelevant = evaluations.filter((evaluation) => !evaluation.suppressionReasons.some((reason) =>
    ["target_mismatch", "timeframe_mismatch", "category_scope_mismatch", "objective_scope_mismatch"].includes(reason),
  ));
  const suppressionReasons: OutcomeProxyMappingPlan["suppressionReasons"] = eligibleRefs.length === 1
    ? []
    : eligibleRefs.length > 1
      ? ["ambiguous_mapping"]
      : structurallyRelevant.length === 0
        ? ["missing_mapping"]
        : ["no_eligible_mapping"];
  const selectedMapping = eligibleRefs.length === 1
    ? input.mappings.find((mapping) => mapping.mappingRef === eligibleRefs[0]) ?? null
    : null;

  return Object.freeze({
    schemaVersion: OUTCOME_PROXY_MAPPING_VERSION,
    status: selectedMapping === null ? "suppressed" : "ready",
    target: Object.freeze({ ...input.target }),
    context: Object.freeze({ ...input.context }),
    asOfAt: input.asOfAt,
    policy: Object.freeze({ ...input.policy }),
    selected: selectedMapping === null ? null : Object.freeze({
      ...selectedMapping,
      proxy: Object.freeze({ ...selectedMapping.proxy }),
      scope: Object.freeze({
        categoryRefs: Object.freeze([...selectedMapping.scope.categoryRefs]),
        objectiveRefs: Object.freeze([...selectedMapping.scope.objectiveRefs]),
      }),
      evidence: Object.freeze({ ...selectedMapping.evidence }),
      review: Object.freeze({ ...selectedMapping.review }),
      provenance: Object.freeze({ ...selectedMapping.provenance }),
    }),
    suppressionReasons: Object.freeze(suppressionReasons),
    evaluations: Object.freeze(evaluations),
    actionAuthority: "none",
  });
}
