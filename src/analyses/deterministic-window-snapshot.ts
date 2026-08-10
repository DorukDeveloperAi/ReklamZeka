import { createHash } from "node:crypto";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";
import { assertDeterministicFeatureSnapshot, type DeterministicFeatureSnapshot } from "./deterministic-feature-snapshot";
import { validateResolvedAnalysisTimeframe, type ResolvedAnalysisTimeframe } from "./timeframe-resolver";

export const DETERMINISTIC_WINDOW_SNAPSHOT_VERSION = "deterministic-window-snapshot/1.0.0" as const;

export type DeterministicWindowSnapshot = Readonly<{
  contractVersion: typeof DETERMINISTIC_WINDOW_SNAPSHOT_VERSION;
  windowRef: string;
  windowHash: string;
  scope: DeterministicFeatureSnapshot["scope"];
  resolvedTimeframe: ResolvedAnalysisTimeframe;
  featureRefs: readonly string[];
  featureHashes: readonly string[];
  sourceManifestHashes: readonly string[];
  capabilities: Readonly<{ containsRawL0: false; canAuthorizeAction: false; canExecuteWrite: false }>;
}>;

export class DeterministicWindowSnapshotError extends Error {
  constructor(readonly code: "invalid_input" | "inauthentic_component" | "forbidden_material") {
    super(`Deterministic window snapshot oluşturulamadı: ${code}`); this.name = "DeterministicWindowSnapshotError";
  }
}
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function fail(code: DeterministicWindowSnapshotError["code"]): never { throw new DeterministicWindowSnapshotError(code); }

/** Freezes only settled, ready L2 features exactly covered by a verified L3 window. */
export function buildDeterministicWindowSnapshot(input: Readonly<{ timeframe: ResolvedAnalysisTimeframe; features: readonly DeterministicFeatureSnapshot[] }>): DeterministicWindowSnapshot {
  if (!input || Object.keys(input).length !== 2 || !inspectMetaPersistenceWrite(input).compliant) fail("forbidden_material");
  try { validateResolvedAnalysisTimeframe(input.timeframe); } catch { fail("invalid_input"); }
  if (!Array.isArray(input.features) || input.features.length === 0) fail("invalid_input");
  try { input.features.forEach(assertDeterministicFeatureSnapshot); } catch { fail("inauthentic_component"); }
  const first = input.features[0]!;
  if (input.features.some((feature) => feature.scope.workspaceId !== first.scope.workspaceId || feature.scope.metaConnectionId !== first.scope.metaConnectionId || feature.scope.adAccountId !== first.scope.adAccountId || feature.scope.entityLevel !== first.scope.entityLevel || feature.scope.externalEntityId !== first.scope.externalEntityId || !feature.settled || feature.qualityStatus !== "ready" || feature.startDate < input.timeframe.startDate || feature.endDate > input.timeframe.endDate)) fail("inauthentic_component");
  const ordered = [...input.features].sort((a, b) => a.featureRef.localeCompare(b.featureRef));
  if (new Set(ordered.map((feature) => feature.featureRef)).size !== ordered.length) fail("invalid_input");
  const core = { contractVersion: DETERMINISTIC_WINDOW_SNAPSHOT_VERSION, scope: first.scope, resolvedTimeframe: input.timeframe,
    featureRefs: ordered.map((feature) => feature.featureRef), featureHashes: ordered.map((feature) => feature.featureHash),
    sourceManifestHashes: ordered.map((feature) => feature.sourceManifestHash), capabilities: { containsRawL0: false as const, canAuthorizeAction: false as const, canExecuteWrite: false as const } };
  const windowHash = hash(core);
  return Object.freeze({ ...core, windowHash, windowRef: `window_${windowHash.slice(0, 24)}`, featureRefs: Object.freeze(core.featureRefs), featureHashes: Object.freeze(core.featureHashes), sourceManifestHashes: Object.freeze(core.sourceManifestHashes) });
}
