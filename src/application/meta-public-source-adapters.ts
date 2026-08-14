import type { MetaBootstrapPreflight } from "@/connectors/meta/bootstrap-preflight";
import type { MetaTrustReadinessReadProjection } from "@/application/meta-trust-readiness-read-service";
import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";
import type { CanonicalPerformanceReadProjection } from "@/domain/meta/performance-read-model";
import { publicSource, type PublicSource } from "@/domain/source/public-source";

function latest(values: readonly (string | null)[]): string | null {
  const timestamps = values.filter((value): value is string => value !== null);
  return timestamps.length ? [...timestamps].sort().at(-1) ?? null : null;
}

function unique(codes: readonly string[]): readonly string[] {
  return [...new Set(codes)].sort();
}

export function metaReadMirrorPublicSource(value: MetaReadMirrorProjection): PublicSource {
  return publicSource({ kind: "canonical_meta_mirror", state: value.sourceState === "ready" ? "ready" : value.sourceState,
    observedAt: value.observedAt, freshnessAt: value.latestCanonicalObservationAt,
    freshnessThresholdMinutes: value.freshnessThresholdMinutes, reasonCodes: value.reasonCodes });
}

export function canonicalPerformancePublicSource(value: CanonicalPerformanceReadProjection): PublicSource {
  const windows = value.accounts.flatMap((account) => account.windows);
  const reasonCodes = unique(windows.flatMap((window) => window.reasonCodes));
  return publicSource({ kind: "canonical_performance", state: value.state,
    observedAt: latest(windows.map((window) => window.freshnessAt)),
    freshnessAt: latest(windows.map((window) => window.freshnessAt)), freshnessThresholdMinutes: null,
    reasonCodes: reasonCodes.length ? reasonCodes : value.state === "unavailable" ? ["canonical_performance_empty"] : [] });
}

export function derivedTrustPublicSource(value: MetaTrustReadinessReadProjection): PublicSource {
  const reports = value.reports.map(({ report }) => report);
  const state = reports.length === 0 ? "empty" : reports.every((report) => report.status === "ready") ? "ready" : "partial";
  return publicSource({ kind: "derived_trust", state, observedAt: latest(reports.map((report) => report.evaluatedAt)),
    freshnessAt: latest(reports.map((report) => report.evaluatedAt)), freshnessThresholdMinutes: null,
    reasonCodes: reports.length ? unique(reports.flatMap((report) => report.reasonCodes)) : ["trust_reports_empty"] });
}

export function graphCapabilityPublicSource(input: Readonly<{
  state: "partial" | "unavailable";
  reasonCodes: readonly string[];
}>): PublicSource {
  return publicSource({ kind: "graph_capability", state: input.state, observedAt: null, freshnessAt: null,
    freshnessThresholdMinutes: null, reasonCodes: input.reasonCodes });
}

/** Bootstrap is configuration evidence only; it never upgrades Graph data to canonical. */
export function graphCapabilityPreflightPublicSource(value: MetaBootstrapPreflight): PublicSource {
  return graphCapabilityPublicSource(value.readiness === "configured"
    ? { state: "partial", reasonCodes: ["graph_capability_preflight_only"] }
    : { state: "unavailable", reasonCodes: [`graph_capability_${value.blocker ?? "blocked"}`] });
}
