import { createHash } from "node:crypto";
import type { AnalysisMetric } from "@/analyses/schema";
import {
  assertDeterministicFeatureSnapshot,
  type DeterministicFeatureSnapshot,
} from "@/analyses/deterministic-feature-snapshot";

export const FROZEN_L2_ADVISORY_DIAGNOSTICS_VERSION = "frozen-l2-advisory-diagnostics/1.0.0" as const;

export type FrozenContributionDiagnostic = Readonly<{
  contractVersion: typeof FROZEN_L2_ADVISORY_DIAGNOSTICS_VERSION;
  diagnosticId: string;
  metric: AnalysisMetric;
  state: "available" | "insufficient_data" | "unknown";
  reason: "minimum_entities_not_met" | "incompatible_scope" | "metric_not_bound" | "metric_unknown" | "zero_total" | "available";
  contributions: readonly Readonly<{
    entityRef: string;
    valueDecimal: string | null;
    contributionFraction: string | null;
    featureRefs: readonly string[];
    sourceSnapshotRefs: readonly string[];
  }> [];
  capabilities: Readonly<{ canAuthorizeAction: false; canExecuteWrite: false; canWriteMeta: false }>;
}>;

export class FrozenL2AdvisoryDiagnosticError extends Error {
  constructor(readonly code: "invalid_input" | "inauthentic_component") {
    super(`Frozen L2 advisory diagnostic üretilemedi: ${code}`);
    this.name = "FrozenL2AdvisoryDiagnosticError";
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function decimal(value: string): number {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new FrozenL2AdvisoryDiagnosticError("inauthentic_component");
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    throw new FrozenL2AdvisoryDiagnosticError("inauthentic_component");
  }
  return result;
}

function format(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 1e12) / 1e12;
  return Object.is(rounded, -0) ? "0" : rounded.toString();
}

function emptyContribution(
  metric: AnalysisMetric,
  state: FrozenContributionDiagnostic["state"],
  reason: FrozenContributionDiagnostic["reason"],
  contributions: FrozenContributionDiagnostic["contributions"],
): FrozenContributionDiagnostic {
  const core = { contractVersion: FROZEN_L2_ADVISORY_DIAGNOSTICS_VERSION, metric, state, reason, contributions };
  return Object.freeze({
    ...core,
    diagnosticId: `l2_contribution_${digest(core).slice(0, 24)}`,
    capabilities: Object.freeze({ canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false }),
  });
}

/**
 * Computes a share only from the already-frozen L2 set supplied by the caller.
 * It never selects a cohort, replaces a missing peer, or makes a causal claim.
 */
export function calculateFrozenL2Contribution(input: Readonly<{
  metric: AnalysisMetric;
  features: readonly DeterministicFeatureSnapshot[];
}>): FrozenContributionDiagnostic {
  if (!input || Object.keys(input).length !== 2 || !Array.isArray(input.features)) {
    throw new FrozenL2AdvisoryDiagnosticError("invalid_input");
  }
  const features = [...input.features];
  try { features.forEach(assertDeterministicFeatureSnapshot); } catch (error) {
    if (error instanceof FrozenL2AdvisoryDiagnosticError) throw error;
    throw new FrozenL2AdvisoryDiagnosticError("inauthentic_component");
  }
  const ordered = features.sort((left, right) => left.featureRef.localeCompare(right.featureRef));
  const primary = ordered.filter((feature) => feature.role === "primary");
  const scopes = new Set(primary.map((feature) => [
    feature.scope.workspaceId, feature.scope.metaConnectionId, feature.scope.adAccountId,
    feature.scope.entityLevel, feature.startDate, feature.endDate, feature.timezone,
  ].join("\u0000")));
  if (scopes.size > 1) return emptyContribution(input.metric, "insufficient_data", "incompatible_scope", Object.freeze([]));

  const grouped = new Map<string, DeterministicFeatureSnapshot[]>();
  for (const feature of primary) grouped.set(feature.scope.externalEntityId, [...(grouped.get(feature.scope.externalEntityId) ?? []), feature]);
  const contributions = Object.freeze([...grouped.entries()].map(([entityRef, entries]) => Object.freeze({
    entityRef,
    valueDecimal: null,
    contributionFraction: null,
    featureRefs: Object.freeze(entries.map((entry) => entry.featureRef).sort()),
    sourceSnapshotRefs: Object.freeze([...new Set(entries.flatMap((entry) => entry.sourceSnapshotRefs))].sort()),
  })).sort((left, right) => left.entityRef.localeCompare(right.entityRef)));
  if (contributions.length < 2) return emptyContribution(input.metric, "insufficient_data", "minimum_entities_not_met", contributions);
  if (contributions.some((entry) => entry.featureRefs.length !== 1)) {
    return emptyContribution(input.metric, "insufficient_data", "incompatible_scope", contributions);
  }

  const values = contributions.map((entry) => {
    const feature = grouped.get(entry.entityRef)![0]!;
    const metric = feature.metricResult.metrics.find((candidate) => candidate.metric === input.metric);
    if (!metric) return { entry, state: "not_bound" as const };
    if (metric.status === "unknown") return { entry, state: "unknown" as const };
    return { entry, state: "available" as const, value: decimal(metric.valueDecimal) };
  });
  if (values.some((entry) => entry.state === "not_bound")) return emptyContribution(input.metric, "unknown", "metric_not_bound", contributions);
  if (values.some((entry) => entry.state === "unknown")) return emptyContribution(input.metric, "unknown", "metric_unknown", contributions);
  const available = values as readonly Readonly<{ entry: FrozenContributionDiagnostic["contributions"][number]; state: "available"; value: number }>[];
  const total = available.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0) return emptyContribution(input.metric, "insufficient_data", "zero_total", contributions);
  const resolved = Object.freeze(available.map(({ entry, value }) => Object.freeze({
    ...entry, valueDecimal: format(value), contributionFraction: format(value / total),
  })).sort((left, right) => left.entityRef.localeCompare(right.entityRef)));
  return emptyContribution(input.metric, "available", "available", resolved);
}
