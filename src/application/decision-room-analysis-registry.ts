import { createHash } from "node:crypto";
import type { AnalysisPassKey } from "@/analyses/agenda";
import type { AnalysisComparison, AnalysisTimeframe } from "@/analyses/schema";
import { resolveAnalysisTimeframe, type TimeframeAnchors } from "@/analyses/timeframe-resolver";
import type { DecisionRoomAnalysisRuntimeAssets, DecisionRoomAnalysisRuntimeCheck } from "@/application/decision-room-analysis-runtime";
import type { FindingHierarchyNode } from "@/analyses/finding-engine";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

export const ANALYSIS_TIMEFRAME_DEFINITION_VERSION = "analysis-timeframe-definition/1.0.0" as const;
export const ANALYSIS_TEMPLATE_DEFINITION_VERSION = "analysis-template-definition/1.0.0" as const;

export type AnalysisTimeframeDefinition = Readonly<{
  version: typeof ANALYSIS_TIMEFRAME_DEFINITION_VERSION;
  timeframeRef: string;
  revision: number;
  timeframe: AnalysisTimeframe;
  comparison: AnalysisComparison;
  anchors: TimeframeAnchors;
}>;

export type AnalysisTemplateDefinition = Readonly<{
  version: typeof ANALYSIS_TEMPLATE_DEFINITION_VERSION;
  templateRef: string;
  revision: number;
  timeframeRef: string;
  timeframeDefinitionHash: string;
  contextHash: string;
  requestedPasses: readonly AnalysisPassKey[];
  hierarchy: readonly FindingHierarchyNode[];
  checks: readonly DecisionRoomAnalysisRuntimeCheck[];
  cadence: DecisionRoomAnalysisRuntimeAssets["cadence"];
}>;

export class DecisionRoomAnalysisRegistryError extends Error {
  constructor(readonly code: "invalid_definition" | "forbidden_material") {
    super(`Analiz varlık kaydı reddedildi: ${code}`);
    this.name = "DecisionRoomAnalysisRegistryError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const HASH = /^[a-f0-9]{64}$/;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function analysisAssetDefinitionHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function exact(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new DecisionRoomAnalysisRegistryError("invalid_definition");
  }
}

function safe(value: unknown): void {
  const authority = /^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval)$/i;
  const containsAuthority = (candidate: unknown): boolean => Array.isArray(candidate)
    ? candidate.some(containsAuthority)
    : Boolean(candidate && typeof candidate === "object" && Object.entries(candidate as Record<string, unknown>)
      .some(([key, child]) => authority.test(key.replace(/[_-]/g, "")) || containsAuthority(child)));
  if (!inspectMetaPersistenceWrite(value).compliant || containsAuthority(value)) {
    throw new DecisionRoomAnalysisRegistryError("forbidden_material");
  }
}

export function validateAnalysisTimeframeDefinition(
  candidate: AnalysisTimeframeDefinition,
  asOf: string,
): AnalysisTimeframeDefinition {
  exact(candidate, ["version", "timeframeRef", "revision", "timeframe", "comparison", "anchors"]);
  if (candidate.version !== ANALYSIS_TIMEFRAME_DEFINITION_VERSION || !REF.test(candidate.timeframeRef)
    || !Number.isSafeInteger(candidate.revision) || candidate.revision < 1
    || !Number.isFinite(Date.parse(asOf))) {
    throw new DecisionRoomAnalysisRegistryError("invalid_definition");
  }
  safe(candidate);
  try {
    resolveAnalysisTimeframe({
      timeframe: candidate.timeframe,
      comparison: candidate.comparison,
      asOf: new Date(asOf).toISOString(),
      anchors: candidate.anchors,
    });
  } catch {
    throw new DecisionRoomAnalysisRegistryError("invalid_definition");
  }
  return Object.freeze(candidate);
}

export function validateAnalysisTemplateDefinition(candidate: AnalysisTemplateDefinition): AnalysisTemplateDefinition {
  exact(candidate, [
    "version", "templateRef", "revision", "timeframeRef", "timeframeDefinitionHash", "contextHash",
    "requestedPasses", "hierarchy", "checks", "cadence",
  ]);
  if (candidate.version !== ANALYSIS_TEMPLATE_DEFINITION_VERSION || !REF.test(candidate.templateRef)
    || !REF.test(candidate.timeframeRef) || !HASH.test(candidate.timeframeDefinitionHash)
    || !HASH.test(candidate.contextHash) || !Number.isSafeInteger(candidate.revision) || candidate.revision < 1
    || !Array.isArray(candidate.requestedPasses) || !Array.isArray(candidate.hierarchy)
    || !Array.isArray(candidate.checks) || candidate.checks.length < 1 || candidate.checks.length > 100) {
    throw new DecisionRoomAnalysisRegistryError("invalid_definition");
  }
  safe(candidate);
  return Object.freeze(candidate);
}
