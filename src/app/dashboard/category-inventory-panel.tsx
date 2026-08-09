"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./operating-dashboard.module.css";

type Level = "campaign" | "ad_set" | "ad" | "creative";
type Definition = Readonly<{ ref: string; key: string; label: string; description: string | null; version: number;
  assignments: Readonly<{ total: number; manualLocked: number; manual: number; agent: number;
    deterministic: number; add: number; override: number; deny: number }>;
  confidence: Readonly<{ minimumBasisPoints: number | null; averageBasisPoints: number | null;
    belowReviewThreshold: number }>;
  evidenceHealth: Readonly<{ evidenceRecords: number; assignmentsWithObservedAt: number;
    invalidEvidenceAssignments: number; kinds: readonly Readonly<{ kind: string; count: number }>[] }> }>;
type Dimension = Readonly<{ ref: string; key: string; name: string; description: string | null;
  cardinality: "single" | "multi"; allowedEntityLevels: readonly Level[]; version: number;
  definitions: readonly Definition[]; coverage: readonly Readonly<{ level: Level; totalEntities: number;
    directlyAssignedEntities: number; unmatchedEntities: number; coverageBasisPoints: number | null;
    deniedAssignments: number }>[] }>;
type Snapshot = Readonly<{ contractVersion: string; summary: Readonly<{ dimensions: number; definitions: number;
  directlyAssignedEntities: number; manualLocks: number; lowConfidenceAssignments: number;
  invalidEvidenceAssignments: number }>; classificationPolicy: Readonly<{ version: string;
  minimumTrustedConfidenceBasisPoints: number; purpose: "review_signal_only" }>;
  health: Readonly<{ dimensionsWithoutDefinitions: number;
  definitionsWithoutDirectAssignments: number; staleTargetAssignments: number;
  assignmentsUnderArchivedRegistry: number }>; dimensions: readonly Dimension[];
  authority: Readonly<{ canAssign: false; canWriteMeta: false; canAuthorizeAction: false }> }>;
export type ArchiveImpact = Readonly<{ contractVersion: "category-archive-impact/2.0.0"; impactHash: string;
  target: Readonly<{ kind: "dimension" | "definition"; ref: string; label: string; version: number }>;
  exactBlockers: Readonly<{ activeDefinitions: number; activeAssignments: number; manualLocks: number;
    guidanceDrafts: number; guidancePublished: number; activePromotionBindings: number;
    activePromotionTemplateScopes: number; activeAdvisedPractices: number; activeCategoryProfiles: number; autonomyDrafts: number;
    autonomyPublished: number; guardrailDrafts: number; guardrailPublished: number }>;
  conservativeBlockers: Readonly<{ nonTerminalActionProposalUnits: number }>;
  historicalImpact: Readonly<{ archivedGuidance: number; expiredPromotionBindings: number;
    supersededPromotionTemplateScopes: number; retiredAdvisedPractices: number;
    supersededAdvisedPractices: number; historicalCategoryProfiles: number;
    effectiveContexts: number; alreadyInvalidatedContexts: number;
    budgetProposals: number; terminalActionProposalUnits: number }>;
  invalidationPlan: Readonly<{ categoryResolutionComponents: number; contextsNeedingInvalidation: number }>;
  coverage: Readonly<{ complete: boolean; precision: "exact_with_conservative_action_queue";
    manifestVersion: string; exactRelational: readonly string[]; exactContractRef: readonly string[];
    conservative: readonly string[]; partialOrUnknown: readonly string[]; integrity: Readonly<{
      unclassifiedJsonbColumns: number; missingManifestJsonbColumns: number; unresolvedCategoryRefs: number;
      inconsistentPromotionEdges: number; malformedCategoryContracts: number; corruptLifecycleRows: number;
      ambiguousLineage: number }> }>;
  disposition: "blocked" | "review_required"; archiveAllowed: false;
  authority: Readonly<{ canArchive: false; canAssign: false; canAuthorizeAction: false; canWriteMeta: false }> }>;
type AuthoringDefinition = Readonly<{ ref: string; key: string; label: string; description: string | null; version: number }>;
type AuthoringDimension = Readonly<{ ref: string; key: string; name: string; description: string | null;
  cardinality: "single" | "multi"; allowedEntityLevels: readonly Level[]; version: number;
  definitions: readonly AuthoringDefinition[] }>;
type AuthoringAuthority = Readonly<{ canCreate: boolean; canRevise: boolean; canArchive: boolean; canAssign: false;
  canAuthorizeAction: false; canWriteMeta: false }>;
export type CategoryAuthoringState = Readonly<{ contractVersion: "category-authoring/1.0.0"; registryHash: string;
  dimensions: readonly AuthoringDimension[]; assignments: readonly Readonly<{ ref: string; dimensionRef: string;
    definitionRef: string; entity: Readonly<{ level: Level; ref: string }>; operation: "add" | "override" | "deny";
    manualLock: boolean; confidenceBasisPoints: number; version: number }>[]; authority: AuthoringAuthority }>;
export type CategoryMutationCommand = Readonly<Record<string, unknown> & { operation: "create_dimension" |
  "create_definition" | "revise_dimension" | "revise_definition" | "archive_dimension" | "archive_definition" }>;
type EffectiveHealth = Readonly<{ contractVersion: "category-effective-health/1.0.0"; status: "complete";
  evaluationBasis: "hierarchy_path"; limits: Readonly<{ maxHierarchyPaths: number; maxDimensions: number }>;
  counts: Readonly<{ dimensions: number; hierarchyPaths: number; evaluations: number; applied: number;
    unmatched: number; parkedConflict: number }>; reasonBreakdown: readonly Readonly<{ reason: string; count: number }>[];
  dimensions: readonly Readonly<{ dimension: Readonly<{ key: string; ref: string }>;
    evaluationBasis: "hierarchy_path"; counts: Readonly<{ total: number; applied: number; unmatched: number;
      parkedConflict: number }>; reasonBreakdown: readonly Readonly<{ reason: string; count: number }>[] }> [];
  authority: Readonly<{ canAssign: false; canWriteMeta: false; canAuthorizeAction: false }> }>;

class InventoryError extends Error { constructor(readonly code: string, message: string) { super(message); } }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function nonNegative(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
const HASH = /^[a-f0-9]{64}$/;
const DIMENSION_REF = /^dimension_[a-f0-9]{24}$/;
const DEFINITION_REF = /^category_[a-f0-9]{24}$/;
const ASSIGNMENT_REF = /^assignment_[a-f0-9]{24}$/;
const ENTITY_REF = /^category_entity_[a-f0-9]{24}$/;
const LEVELS: readonly Level[] = ["campaign", "ad_set", "ad", "creative"];
function definition(value: unknown): value is Definition {
  if (!object(value) || typeof value.ref !== "string" || typeof value.key !== "string"
    || typeof value.label !== "string" || !(value.description === null || typeof value.description === "string")
    || !nonNegative(value.version) || value.version < 1 || !object(value.assignments)) return false;
  const assignments = value.assignments;
  return ["total", "manualLocked", "manual", "agent", "deterministic", "add", "override", "deny"]
    .every((key) => nonNegative(assignments[key])) && object(value.confidence)
    && (value.confidence.minimumBasisPoints === null || nonNegative(value.confidence.minimumBasisPoints))
    && (value.confidence.averageBasisPoints === null || nonNegative(value.confidence.averageBasisPoints))
    && nonNegative(value.confidence.belowReviewThreshold) && object(value.evidenceHealth)
    && nonNegative(value.evidenceHealth.evidenceRecords) && nonNegative(value.evidenceHealth.assignmentsWithObservedAt)
    && nonNegative(value.evidenceHealth.invalidEvidenceAssignments) && Array.isArray(value.evidenceHealth.kinds)
    && value.evidenceHealth.kinds.every((item) => object(item) && typeof item.kind === "string" && nonNegative(item.count));
}
function dimension(value: unknown): value is Dimension {
  if (!object(value) || typeof value.ref !== "string" || typeof value.key !== "string" || typeof value.name !== "string"
    || !(value.description === null || typeof value.description === "string") || !["single", "multi"].includes(String(value.cardinality))
    || !nonNegative(value.version) || value.version < 1 || !Array.isArray(value.allowedEntityLevels)
    || !value.allowedEntityLevels.every((level) => ["campaign", "ad_set", "ad", "creative"].includes(String(level)))
    || !Array.isArray(value.definitions) || !value.definitions.every(definition) || !Array.isArray(value.coverage)) return false;
  return value.coverage.every((item) => object(item) && ["campaign", "ad_set", "ad", "creative"].includes(String(item.level))
    && nonNegative(item.totalEntities) && nonNegative(item.directlyAssignedEntities) && nonNegative(item.unmatchedEntities)
    && (item.coverageBasisPoints === null || nonNegative(item.coverageBasisPoints) && item.coverageBasisPoints <= 10_000)
    && nonNegative(item.deniedAssignments));
}
function parse(value: unknown): Snapshot {
  if (!object(value) || value.contractVersion !== "category-inventory/1.1.0"
    || !object(value.summary) || !object(value.health) || !object(value.classificationPolicy)) {
    throw new InventoryError("unsafe_response", "Kategori kaynağı güvenli sözleşmeyi döndürmedi.");
  }
  const summary = value.summary; const health = value.health;
  if (!["dimensions", "definitions", "directlyAssignedEntities", "manualLocks", "lowConfidenceAssignments",
    "invalidEvidenceAssignments"].every((key) => nonNegative(summary[key]))
    || !["dimensionsWithoutDefinitions", "definitionsWithoutDirectAssignments",
      "staleTargetAssignments", "assignmentsUnderArchivedRegistry"].every((key) => nonNegative(health[key]))
    || typeof value.classificationPolicy.version !== "string"
    || !nonNegative(value.classificationPolicy.minimumTrustedConfidenceBasisPoints)
    || value.classificationPolicy.purpose !== "review_signal_only"
    || !Array.isArray(value.dimensions) || !value.dimensions.every(dimension) || !object(value.authority)
    || value.authority.canAssign !== false || value.authority.canWriteMeta !== false
    || value.authority.canAuthorizeAction !== false) throw new InventoryError("unsafe_response", "Kategori kaynağı güvenli sözleşmeyi döndürmedi.");
  return value as unknown as Snapshot;
}
const EXACT_BLOCKERS = ["activeDefinitions", "activeAssignments", "manualLocks", "guidanceDrafts", "guidancePublished",
  "activePromotionBindings", "activePromotionTemplateScopes", "activeAdvisedPractices", "activeCategoryProfiles", "autonomyDrafts",
  "autonomyPublished", "guardrailDrafts", "guardrailPublished"] as const;
const HISTORICAL_IMPACT = ["archivedGuidance", "expiredPromotionBindings", "supersededPromotionTemplateScopes",
  "retiredAdvisedPractices", "supersededAdvisedPractices", "historicalCategoryProfiles", "effectiveContexts", "alreadyInvalidatedContexts",
  "budgetProposals", "terminalActionProposalUnits"] as const;
const INTEGRITY_COUNTS = ["unclassifiedJsonbColumns", "missingManifestJsonbColumns", "unresolvedCategoryRefs",
  "inconsistentPromotionEdges", "malformedCategoryContracts", "corruptLifecycleRows", "ambiguousLineage"] as const;
function countRecord(value: unknown, keys: readonly string[]) {
  return object(value) && exactKeys(value, keys) && keys.every((key) => nonNegative(value[key]));
}
function stringListRecord(value: Record<string, unknown>, keys: readonly string[]) {
  return keys.every((key) => Array.isArray(value[key])
    && (value[key] as unknown[]).every((item) => typeof item === "string" && item.length > 0));
}

export function parseCategoryArchiveImpact(value: unknown): ArchiveImpact {
  if (!object(value) || value.contractVersion !== "category-archive-impact/2.0.0"
    || typeof value.impactHash !== "string" || !HASH.test(value.impactHash) || !object(value.target)
    || !["dimension", "definition"].includes(String(value.target.kind)) || typeof value.target.ref !== "string"
    || value.target.kind === "dimension" && !DIMENSION_REF.test(value.target.ref)
    || value.target.kind === "definition" && !DEFINITION_REF.test(value.target.ref)
    || typeof value.target.label !== "string" || !value.target.label || !nonNegative(value.target.version)
    || value.target.version < 1 || !countRecord(value.exactBlockers, EXACT_BLOCKERS)
    || !countRecord(value.conservativeBlockers, ["nonTerminalActionProposalUnits"])
    || !countRecord(value.historicalImpact, HISTORICAL_IMPACT) || !object(value.invalidationPlan)
    || !exactKeys(value.invalidationPlan, ["categoryResolutionComponents", "contextsNeedingInvalidation"])
    || !nonNegative(value.invalidationPlan.categoryResolutionComponents)
    || !nonNegative(value.invalidationPlan.contextsNeedingInvalidation) || !object(value.coverage)
    || typeof value.coverage.complete !== "boolean" || value.coverage.precision !== "exact_with_conservative_action_queue"
    || typeof value.coverage.manifestVersion !== "string" || !value.coverage.manifestVersion
    || !stringListRecord(value.coverage, ["exactRelational", "exactContractRef", "conservative", "partialOrUnknown"])
    || !countRecord(value.coverage.integrity, INTEGRITY_COUNTS)
    || value.coverage.complete && ((value.coverage.partialOrUnknown as unknown[]).length > 0
      || Object.values(value.coverage.integrity as Record<string, unknown>).some((item) => Number(item) > 0))
    || !["blocked", "review_required"].includes(String(value.disposition)) || value.archiveAllowed !== false
    || !object(value.authority) || value.authority.canArchive !== false || value.authority.canAssign !== false
    || value.authority.canAuthorizeAction !== false || value.authority.canWriteMeta !== false) {
    throw new InventoryError("unsafe_response", "Arşiv etki kaynağı güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as ArchiveImpact;
}

function authoringDefinition(value: unknown): value is AuthoringDefinition {
  return object(value) && exactKeys(value, ["ref", "key", "label", "description", "version"])
    && typeof value.ref === "string" && DEFINITION_REF.test(value.ref) && typeof value.key === "string"
    && typeof value.label === "string" && (value.description === null || typeof value.description === "string")
    && nonNegative(value.version) && value.version >= 1;
}
function authoringDimension(value: unknown): value is AuthoringDimension {
  return object(value) && exactKeys(value, ["ref", "key", "name", "description", "cardinality", "allowedEntityLevels", "version", "definitions"])
    && typeof value.ref === "string" && DIMENSION_REF.test(value.ref) && typeof value.key === "string" && typeof value.name === "string"
    && (value.description === null || typeof value.description === "string") && ["single", "multi"].includes(String(value.cardinality))
    && Array.isArray(value.allowedEntityLevels) && value.allowedEntityLevels.length > 0
    && value.allowedEntityLevels.every((level) => LEVELS.includes(level as Level))
    && new Set(value.allowedEntityLevels).size === value.allowedEntityLevels.length
    && nonNegative(value.version) && value.version >= 1 && Array.isArray(value.definitions)
    && value.definitions.every(authoringDefinition);
}
function authoringAssignment(value: unknown) {
  return object(value) && exactKeys(value, ["ref", "dimensionRef", "definitionRef", "entity", "operation", "manualLock", "confidenceBasisPoints", "version"])
    && typeof value.ref === "string" && ASSIGNMENT_REF.test(value.ref) && typeof value.dimensionRef === "string"
    && DIMENSION_REF.test(value.dimensionRef) && typeof value.definitionRef === "string" && DEFINITION_REF.test(value.definitionRef)
    && object(value.entity) && exactKeys(value.entity, ["level", "ref"]) && LEVELS.includes(value.entity.level as Level)
    && typeof value.entity.ref === "string" && ENTITY_REF.test(value.entity.ref)
    && ["add", "override", "deny"].includes(String(value.operation)) && typeof value.manualLock === "boolean"
    && nonNegative(value.confidenceBasisPoints) && value.confidenceBasisPoints <= 10_000
    && nonNegative(value.version) && value.version >= 1;
}
function authoringAuthority(value: unknown): value is AuthoringAuthority {
  return object(value) && exactKeys(value, ["canCreate", "canRevise", "canArchive", "canAssign", "canAuthorizeAction", "canWriteMeta"])
    && ["canCreate", "canRevise", "canArchive"].every((key) => typeof value[key] === "boolean")
    && value.canAssign === false && value.canAuthorizeAction === false && value.canWriteMeta === false;
}
export function parseCategoryAuthoringState(value: unknown): CategoryAuthoringState {
  if (!object(value) || value.contractVersion !== "category-authoring/1.0.0" || typeof value.registryHash !== "string"
    || !HASH.test(value.registryHash) || !Array.isArray(value.dimensions) || !value.dimensions.every(authoringDimension)
    || !Array.isArray(value.assignments) || !value.assignments.every(authoringAssignment) || !authoringAuthority(value.authority)) {
    throw new InventoryError("unsafe_response", "Kategori authoring kaynağı güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as CategoryAuthoringState;
}

function impactTargetMatches(impact: ArchiveImpact, authoring: CategoryAuthoringState) {
  const current = impact.target.kind === "dimension"
    ? authoring.dimensions.find((item) => item.ref === impact.target.ref)
    : authoring.dimensions.flatMap((item) => item.definitions).find((item) => item.ref === impact.target.ref);
  return current?.version === impact.target.version;
}
function impactIsClean(impact: ArchiveImpact | null, authoring: CategoryAuthoringState | null) {
  if (!impact || !authoring || !impact.coverage.complete || impact.disposition !== "review_required"
    || impact.coverage.partialOrUnknown.length > 0 || Object.values(impact.exactBlockers).some((count) => count > 0)
    || Object.values(impact.conservativeBlockers).some((count) => count > 0)
    || Object.values(impact.coverage.integrity).some((count) => count > 0)) return false;
  return impactTargetMatches(impact, authoring);
}
export function isArchiveMutationReady(impact: ArchiveImpact | null, authoring: CategoryAuthoringState | null) {
  return Boolean(authoring?.authority.canArchive && impactIsClean(impact, authoring));
}
export function isRevisionMutationReady(impact: ArchiveImpact | null, authoring: CategoryAuthoringState | null) {
  return Boolean(authoring?.authority.canRevise && impactIsClean(impact, authoring));
}

function responseError(payload: unknown, fallback: string) {
  const found = object(payload) && object(payload.error) ? payload.error : null;
  return new InventoryError(found && typeof found.code === "string" ? found.code : "request_failed",
    found && typeof found.message === "string" ? found.message : fallback);
}

export async function loadCategoryAuthoringState(request: typeof fetch = fetch) {
  const response = await request("/api/category-authoring", { cache: "no-store", credentials: "same-origin",
    headers: { "X-ReklamZeka-Intent": "category-authoring-read" } });
  let payload: unknown = null; try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) throw responseError(payload, "Kategori authoring durumu alınamadı.");
  return parseCategoryAuthoringState(payload);
}

export async function runCategoryAuthoringMutation(command: CategoryMutationCommand, request: typeof fetch = fetch) {
  const response = await request("/api/category-authoring", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "category-authoring-mutate" },
    body: JSON.stringify({ command }) });
  let payload: unknown = null; try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) throw responseError(payload, "Kategori değişikliği tamamlanamadı.");
  if (!object(payload) || payload.contractVersion !== "category-authoring/1.0.0" || payload.auditAppended !== true
    || !nonNegative(payload.invalidationsAppended) || payload.canAuthorizeAction !== false || payload.canWriteMeta !== false
    || !object(payload.state) || !authoringAuthority(payload.authority)) {
    throw new InventoryError("unsafe_response", "Kategori mutation yanıtı güvenli sözleşmeyi döndürmedi.");
  }
  return Object.freeze({ state: parseCategoryAuthoringState({ contractVersion: payload.contractVersion, ...payload.state,
    authority: payload.authority }), invalidationsAppended: payload.invalidationsAppended });
}
function parseEffectiveHealth(value: unknown): EffectiveHealth {
  if (!object(value)) throw new InventoryError("unsafe_response", "Effective kategori kaynağı güvenli sözleşmeyi döndürmedi.");
  const limits = value.limits; const counts = value.counts; const dimensions = value.dimensions; const authority = value.authority;
  if (value.contractVersion !== "category-effective-health/1.0.0" || value.status !== "complete"
    || value.evaluationBasis !== "hierarchy_path" || !object(limits) || !object(counts)
    || !["maxHierarchyPaths", "maxDimensions"].every((key) => nonNegative(limits[key]))
    || !["dimensions", "hierarchyPaths", "evaluations", "applied", "unmatched", "parkedConflict"]
      .every((key) => nonNegative(counts[key]))
    || counts.evaluations !== Number(counts.applied) + Number(counts.unmatched) + Number(counts.parkedConflict)
    || !Array.isArray(value.reasonBreakdown) || !value.reasonBreakdown.every((item) => object(item)
      && typeof item.reason === "string" && nonNegative(item.count))
    || !Array.isArray(dimensions) || dimensions.length !== counts.dimensions || !dimensions.every((item) => object(item)
      && object(item.dimension) && typeof item.dimension.key === "string" && typeof item.dimension.ref === "string"
      && item.evaluationBasis === "hierarchy_path" && object(item.counts)
      && ["total", "applied", "unmatched", "parkedConflict"].every((key) => nonNegative((item.counts as Record<string, unknown>)[key]))
      && item.counts.total === Number(item.counts.applied) + Number(item.counts.unmatched) + Number(item.counts.parkedConflict)
      && Array.isArray(item.reasonBreakdown) && item.reasonBreakdown.every((reason) => object(reason)
        && typeof reason.reason === "string" && nonNegative(reason.count)))
    || !object(authority) || authority.canAssign !== false || authority.canWriteMeta !== false
    || authority.canAuthorizeAction !== false) {
    throw new InventoryError("unsafe_response", "Effective kategori kaynağı güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as EffectiveHealth;
}
function levelLabel(level: Level) { return level === "campaign" ? "Kampanya" : level === "ad_set" ? "Reklam seti" : level === "ad" ? "Reklam" : "Kreatif"; }
function number(value: number) { return new Intl.NumberFormat("tr-TR").format(value); }
function ratio(value: number | null) { return value === null ? "Veri yok" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value / 100)}`; }
function confidence(value: number | null) { return value === null ? "Veri yok" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value / 100)}`; }
type RevisionDraft = Readonly<{ kind: "dimension"; ref: string; name: string; description: string;
  cardinality: "single" | "multi"; levels: readonly Level[] } | { kind: "definition"; ref: string;
  label: string; description: string }>;

export function CategoryInventoryPanel(props: Readonly<{ onOpenSession?: () => void }> = {}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionRequired, setSessionRequired] = useState(false);
  const [impact, setImpact] = useState<ArchiveImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [effectiveHealth, setEffectiveHealth] = useState<EffectiveHealth | null>(null);
  const [effectiveHealthError, setEffectiveHealthError] = useState<string | null>(null);
  const [authoring, setAuthoring] = useState<CategoryAuthoringState | null>(null);
  const [authoringError, setAuthoringError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationStatus, setMutationStatus] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [revisionDraft, setRevisionDraft] = useState<RevisionDraft | null>(null);
  const [dimensionDraft, setDimensionDraft] = useState({ key: "", name: "", description: "", cardinality: "" as "" | "single" | "multi", levels: [] as Level[] });
  const [definitionDraft, setDefinitionDraft] = useState({ dimensionRef: "", key: "", label: "", description: "" });
  const refresh = useCallback(async () => {
    setLoading(true); setError(null); setSessionRequired(false); setAuthoring(null); setImpact(null);
    setArchiveConfirmed(false); setRevisionDraft(null);
    try {
      const response = await fetch("/api/category-inventory", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "category-inventory-read" } });
      let payload: unknown = null; try { payload = await response.json(); } catch { /* redacted below */ }
      if (!response.ok) {
        const found = object(payload) && object(payload.error) ? payload.error : null;
        const code = found && typeof found.code === "string" ? found.code : "request_failed";
        const message = found && typeof found.message === "string" ? found.message : "Kategori envanteri alınamadı.";
        throw new InventoryError(code, message);
      }
      setSnapshot(parse(payload));
      setAuthoringError(null);
      try {
        setAuthoring(await loadCategoryAuthoringState());
      } catch (reason) {
        setAuthoring(null);
        setAuthoringError(reason instanceof Error ? reason.message : "Kategori authoring durumu alınamadı.");
      }
      setEffectiveHealthError(null);
      try {
        const healthResponse = await fetch("/api/category-effective-health", { cache: "no-store", credentials: "same-origin",
          headers: { "X-ReklamZeka-Intent": "category-effective-health-read" } });
        let healthPayload: unknown = null; try { healthPayload = await healthResponse.json(); } catch { /* redacted below */ }
        if (!healthResponse.ok) {
          const found = object(healthPayload) && object(healthPayload.error) ? healthPayload.error : null;
          throw new InventoryError(found && typeof found.code === "string" ? found.code : "request_failed",
            found && typeof found.message === "string" ? found.message : "Effective kategori sağlığı alınamadı.");
        }
        setEffectiveHealth(parseEffectiveHealth(healthPayload));
      } catch (reason) {
        setEffectiveHealth(null);
        setEffectiveHealthError(reason instanceof Error ? reason.message : "Effective kategori sağlığı alınamadı.");
      }
    } catch (reason) {
      setSessionRequired(reason instanceof InventoryError && reason.code === "local_session_required");
      setError(reason instanceof Error ? reason.message : "Kategori envanteri alınamadı.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const previewImpact = useCallback(async (targetRef: string) => {
    setImpact(null); setArchiveConfirmed(false); setRevisionDraft(null); setImpactLoading(true); setImpactError(null); setMutationStatus(null);
    try {
      const response = await fetch(`/api/category-archive-impact?view=archive-impact&targetRef=${encodeURIComponent(targetRef)}`,
        { cache: "no-store", credentials: "same-origin", headers: {
          "X-ReklamZeka-Intent": "category-archive-impact-preview" } });
      let payload: unknown = null; try { payload = await response.json(); } catch { /* redacted below */ }
      if (!response.ok) {
        const found = object(payload) && object(payload.error) ? payload.error : null;
        throw new InventoryError(found && typeof found.code === "string" ? found.code : "request_failed",
          found && typeof found.message === "string" ? found.message : "Arşiv etkisi alınamadı.");
      }
      setImpact(parseCategoryArchiveImpact(payload));
    } catch (reason) { setImpact(null); setImpactError(reason instanceof Error ? reason.message : "Arşiv etkisi alınamadı."); }
    finally { setImpactLoading(false); }
  }, []);
  const mutate = useCallback(async (command: CategoryMutationCommand) => {
    setMutating(true); setMutationStatus(null); setMutationError(null); setImpactError(null);
    try {
      const result = await runCategoryAuthoringMutation(command);
      setAuthoring(result.state); setImpact(null); setArchiveConfirmed(false); setRevisionDraft(null);
      setMutationStatus(`Değişiklik denetim kaydına eklendi · ${number(result.invalidationsAppended)} context invalidation.`);
      await refresh();
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Kategori değişikliği tamamlanamadı.";
      setImpact(null); setArchiveConfirmed(false); setRevisionDraft(null); setAuthoring(null);
      await refresh();
      setMutationError(message);
      return false;
    } finally { setMutating(false); }
  }, [refresh]);

  if (loading && !snapshot) return <section className={`${styles.panel} ${styles.categoryState}`} aria-busy="true"><strong>İÇ KATEGORİLER</strong><h2>Kategori envanteri yükleniyor</h2><p>Aktif tanımlar ve doğrudan atama kapsamı okunuyor.</p></section>;
  if (error && !snapshot) return <section className={`${styles.panel} ${styles.categoryState}`} role="alert"><strong>{sessionRequired ? "YEREL OTURUM GEREKLİ" : "BAĞLANTI KURULAMADI"}</strong><h2>{sessionRequired ? "Dashboard oturumunu bağlayın" : "Kategori kaynağı kullanılamıyor"}</h2><p>{error}</p>{sessionRequired && props.onOpenSession ? <button type="button" onClick={props.onOpenSession}>Decision Room’da oturumu bağla</button> : <button type="button" onClick={() => void refresh()}>Yeniden dene</button>}</section>;
  if (!snapshot) return null;
  const healthTotal = snapshot.health.dimensionsWithoutDefinitions + snapshot.health.definitionsWithoutDirectAssignments
    + snapshot.health.staleTargetAssignments + snapshot.health.assignmentsUnderArchivedRegistry;
  const archiveReady = isArchiveMutationReady(impact, authoring);
  const revisionReady = isRevisionMutationReady(impact, authoring);
  const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
  return <>
    <section className={styles.pageHero}><div><span className={styles.kicker}>CATEGORY REGISTRY</span><h1>İç kategori diliniz, Meta hiyerarşisiyle birlikte görünür.</h1><p>Envanter doğrudan kapsamı gösterir; owner/admin için registry authoring, denetim ve optimistic concurrency kapılarıyla açılır.</p></div><button className={styles.primaryButton} type="button" onClick={() => void refresh()} disabled={loading || mutating}>{loading ? "Yükleniyor" : "Envanteri yenile"}</button></section>
    <section className={styles.categorySafety}><span>{authoring?.authority.canCreate ? "Owner/admin authoring" : "Salt okunur"}</span><p><strong>Action authorization ve Meta write daima kapalı.</strong> Public-safe referanslar kullanılır; istemci rol üretmez ve teknik Meta ID’lerini taşımaz.</p></section>
    {authoringError ? <section className={styles.guidanceInlineError} role="alert"><span>{authoringError} Authoring kontrolleri güvenli biçimde kapatıldı.</span><button type="button" onClick={() => void refresh()}>Yeniden doğrula</button></section> : null}
    {mutationError ? <section className={styles.guidanceInlineError} role="alert"><span>{mutationError} Önceki preview geçersizleştirildi; durum yeniden doğrulandı.</span><button type="button" onClick={() => setMutationError(null)}>Kapat</button></section> : null}
    {mutationStatus ? <section className={styles.categoryMutationStatus} role="status"><span>{mutationStatus}</span><button type="button" onClick={() => setMutationStatus(null)}>Kapat</button></section> : null}
    {authoring?.authority.canCreate ? <section className={`${styles.panel} ${styles.categoryAuthoring}`} aria-label="Kategori authoring">
      <header className={styles.panelHeader}><div><span className={styles.kicker}>GUARDED AUTHORING</span><h2>Boyut ve tanım oluştur</h2></div><span>{authoring.contractVersion}</span></header>
      <div className={styles.categoryAuthoringGrid}>
        <form onSubmit={(event) => { event.preventDefault(); if (!authoring || !keyPattern.test(dimensionDraft.key)
          || !dimensionDraft.name.trim() || !dimensionDraft.cardinality || dimensionDraft.levels.length === 0) return;
          void mutate({ operation: "create_dimension", key: dimensionDraft.key, name: dimensionDraft.name.trim(),
            description: dimensionDraft.description.trim() || null, cardinality: dimensionDraft.cardinality,
            allowedEntityLevels: dimensionDraft.levels, expectedRegistryHash: authoring.registryHash }).then((changed) => {
              if (changed) setDimensionDraft({ key: "", name: "", description: "", cardinality: "", levels: [] });
            }); }}>
          <strong>Yeni boyut</strong><label>Anahtar<input value={dimensionDraft.key} pattern="[a-z][a-z0-9_]{0,63}" maxLength={64}
            onChange={(event) => setDimensionDraft((draft) => ({ ...draft, key: event.target.value }))} placeholder="service_line" required /></label>
          <label>Ad<input value={dimensionDraft.name} maxLength={160} onChange={(event) => setDimensionDraft((draft) => ({ ...draft, name: event.target.value }))} required /></label>
          <label>Açıklama<textarea value={dimensionDraft.description} maxLength={2000} onChange={(event) => setDimensionDraft((draft) => ({ ...draft, description: event.target.value }))} /></label>
          <label>Kardinalite<select value={dimensionDraft.cardinality} onChange={(event) => setDimensionDraft((draft) => ({ ...draft, cardinality: event.target.value as "" | "single" | "multi" }))} required><option value="">Seçin</option><option value="single">Tek seçim</option><option value="multi">Çoklu seçim</option></select></label>
          <fieldset><legend>İzinli entity seviyeleri</legend>{LEVELS.map((level) => <label key={level}><input type="checkbox" checked={dimensionDraft.levels.includes(level)} onChange={(event) => setDimensionDraft((draft) => ({ ...draft, levels: event.target.checked ? [...draft.levels, level] : draft.levels.filter((item) => item !== level) }))} />{levelLabel(level)}</label>)}</fieldset>
          <button type="submit" disabled={mutating || !keyPattern.test(dimensionDraft.key) || !dimensionDraft.name.trim() || !dimensionDraft.cardinality || dimensionDraft.levels.length === 0}>{mutating ? "Kaydediliyor" : "Boyutu oluştur"}</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); if (!authoring || !DIMENSION_REF.test(definitionDraft.dimensionRef)
          || !keyPattern.test(definitionDraft.key) || !definitionDraft.label.trim()) return;
          void mutate({ operation: "create_definition", dimensionRef: definitionDraft.dimensionRef, key: definitionDraft.key,
            label: definitionDraft.label.trim(), description: definitionDraft.description.trim() || null,
            expectedRegistryHash: authoring.registryHash }).then((changed) => {
              if (changed) setDefinitionDraft({ dimensionRef: "", key: "", label: "", description: "" });
            }); }}>
          <strong>Yeni tanım</strong><label>Boyut<select value={definitionDraft.dimensionRef} onChange={(event) => setDefinitionDraft((draft) => ({ ...draft, dimensionRef: event.target.value }))} required><option value="">Seçin</option>{authoring.dimensions.map((item) => <option key={item.ref} value={item.ref}>{item.name}</option>)}</select></label>
          <label>Anahtar<input value={definitionDraft.key} pattern="[a-z][a-z0-9_]{0,63}" maxLength={64} onChange={(event) => setDefinitionDraft((draft) => ({ ...draft, key: event.target.value }))} placeholder="hair_transplant" required /></label>
          <label>Etiket<input value={definitionDraft.label} maxLength={160} onChange={(event) => setDefinitionDraft((draft) => ({ ...draft, label: event.target.value }))} required /></label>
          <label>Açıklama<textarea value={definitionDraft.description} maxLength={2000} onChange={(event) => setDefinitionDraft((draft) => ({ ...draft, description: event.target.value }))} /></label>
          <button type="submit" disabled={mutating || !DIMENSION_REF.test(definitionDraft.dimensionRef) || !keyPattern.test(definitionDraft.key) || !definitionDraft.label.trim()}>{mutating ? "Kaydediliyor" : "Tanımı oluştur"}</button>
        </form>
      </div>
      <footer>Registry hash: <code>{authoring.registryHash.slice(0, 12)}…</code> · Her mutation denetim kaydı ve sunucu tarafı concurrency doğrulaması gerektirir.</footer>
    </section> : null}
    <div className={styles.metaMetricGrid}>
      <article><span>Aktif boyut</span><strong>{number(snapshot.summary.dimensions)}</strong><small>Kategori eksenleri</small></article>
      <article><span>Aktif tanım</span><strong>{number(snapshot.summary.definitions)}</strong><small>Seçilebilir iç değerler</small></article>
      <article><span>Doğrudan kapsanan</span><strong>{number(snapshot.summary.directlyAssignedEntities)}</strong><small>Boyut bazında tekil toplam</small></article>
      <article><span>Manuel kilit</span><strong>{number(snapshot.summary.manualLocks)}</strong><small>Agent tarafından aşılmaz</small></article>
    </div>
    {healthTotal ? <section className={styles.categoryHealth} role="status"><strong>Kayıt sağlığı · {number(healthTotal)} inceleme noktası</strong><div><span>Tanımsız boyut {number(snapshot.health.dimensionsWithoutDefinitions)}</span><span>Atamasız tanım {number(snapshot.health.definitionsWithoutDirectAssignments)}</span><span>Kaybolmuş hedef {number(snapshot.health.staleTargetAssignments)}</span><span>Arşivli kayda bağlı {number(snapshot.health.assignmentsUnderArchivedRegistry)}</span></div></section> : <section className={styles.categoryHealth} data-clean="true"><strong>Kayıt sağlığı temiz</strong><span>Aktif registry için yapısal uyarı bulunmadı.</span></section>}
    <section className={styles.categoryReviewSignal}><div><strong>Kanıt ve güven inceleme sinyali</strong><p>Eşik {ratio(snapshot.classificationPolicy.minimumTrustedConfidenceBasisPoints)} · {snapshot.classificationPolicy.version}. Bu eşik otomatik karar veya kategori değişikliği üretmez.</p></div><span>{number(snapshot.summary.lowConfidenceAssignments)} düşük güven</span><span>{number(snapshot.summary.invalidEvidenceAssignments)} geçersiz kanıt</span></section>
    {effectiveHealth ? <section className={styles.categoryHealth} data-clean={effectiveHealth.counts.parkedConflict === 0 ? "true" : undefined}>
      <strong>Effective kategori sağlığı · hierarchy path bazlı</strong>
      <div><span>{number(effectiveHealth.counts.hierarchyPaths)} canlı yol</span><span>{number(effectiveHealth.counts.evaluations)} değerlendirme</span><span>{number(effectiveHealth.counts.applied)} uygulanmış</span><span>{number(effectiveHealth.counts.unmatched)} eşleşmemiş</span><span>{number(effectiveHealth.counts.parkedConflict)} park edilmiş çakışma</span></div>
      {effectiveHealth.reasonBreakdown.some((item) => item.count > 0) ? <p>Reason dağılımı: {effectiveHealth.reasonBreakdown.filter((item) => item.count > 0).map((item) => `${item.reason} · ${number(item.count)}`).join("  •  ")}</p> : null}
      <p>Yeniden kullanılan kreatifler her kampanya → reklam seti → reklam bağlamında ayrı değerlendirilir. Sınır: {number(effectiveHealth.limits.maxHierarchyPaths)} yol / {number(effectiveHealth.limits.maxDimensions)} boyut; aşımda kısmi sonuç gösterilmez.</p>
    </section> : effectiveHealthError ? <section className={styles.categoryHealth} role="status"><strong>Effective tarama tamamlanamadı</strong><span>{effectiveHealthError}</span></section> : null}
    {impactError ? <section className={styles.guidanceInlineError} role="alert"><span>{impactError}</span><button type="button" onClick={() => setImpactError(null)}>Kapat</button></section> : null}
    {impact ? <section className={styles.categoryImpact} aria-label={`${impact.target.label} arşiv etki önizlemesi`}>
      <header><div><span>MUTATION ETKİ ÖNİZLEMESİ · İŞLEM YAPILMADI</span><h2>{impact.target.label}</h2><p>{impact.target.kind === "dimension" ? "Boyut" : "Tanım"} · v{impact.target.version} · hash {impact.impactHash.slice(0, 12)}…</p></div><button type="button" onClick={() => { setImpact(null); setArchiveConfirmed(false); setRevisionDraft(null); }}>Kapat</button></header>
      <div className={styles.categoryImpactGrid}><article><strong>Kesin engeller</strong>{Object.entries(impact.exactBlockers).filter(([, value]) => value > 0).map(([key, value]) => <p key={key}><span>{key}</span><b>{number(value)}</b></p>)}{Object.values(impact.exactBlockers).every((value) => value === 0) ? <p><span>Kesin engel</span><b>0</b></p> : null}</article><article><strong>Muhafazakâr / bütünlük</strong><p><span>Non-terminal action unit</span><b>{number(impact.conservativeBlockers.nonTerminalActionProposalUnits)}</b></p>{Object.entries(impact.coverage.integrity).filter(([, value]) => value > 0).map(([key, value]) => <p key={key}><span>{key}</span><b>{number(value)}</b></p>)}{Object.values(impact.coverage.integrity).every((value) => value === 0) ? <p><span>Bütünlük bulgusu</span><b>0</b></p> : null}</article><article><strong>Tarihsel etki</strong>{Object.entries(impact.historicalImpact).map(([key, value]) => <p key={key}><span>{key}</span><b>{number(value)}</b></p>)}</article><article><strong>Gerekli invalidation</strong><p><span>Context</span><b>{number(impact.invalidationPlan.contextsNeedingInvalidation)}</b></p><p><span>Component</span><b>{number(impact.invalidationPlan.categoryResolutionComponents)}</b></p><p><span>Kapsama</span><b>{impact.coverage.complete ? "Tam" : "Eksik"}</b></p></article></div>
      {revisionDraft?.kind === "dimension" && revisionDraft.ref === impact.target.ref ? <form className={styles.categoryRevisionForm} onSubmit={(event) => {
        event.preventDefault(); if (!authoring || !impact || !isRevisionMutationReady(impact, authoring)
          || !revisionDraft.name.trim() || revisionDraft.levels.length === 0) return;
        void mutate({ operation: "revise_dimension", dimensionRef: revisionDraft.ref,
          expectedVersion: impact.target.version, name: revisionDraft.name.trim(),
          description: revisionDraft.description.trim() || null, cardinality: revisionDraft.cardinality,
          allowedEntityLevels: revisionDraft.levels, expectedRegistryHash: authoring.registryHash,
          expectedImpactHash: impact.impactHash });
      }}><strong>Boyut revizyonu</strong><label>Ad<input value={revisionDraft.name} maxLength={160} onChange={(event) => setRevisionDraft({ ...revisionDraft, name: event.target.value })} required /></label><label>Açıklama<textarea value={revisionDraft.description} maxLength={2000} onChange={(event) => setRevisionDraft({ ...revisionDraft, description: event.target.value })} /></label><label>Kardinalite<select value={revisionDraft.cardinality} onChange={(event) => setRevisionDraft({ ...revisionDraft, cardinality: event.target.value as "single" | "multi" })}><option value="single">Tek seçim</option><option value="multi">Çoklu seçim</option></select></label><fieldset><legend>İzinli entity seviyeleri</legend>{LEVELS.map((level) => <label key={level}><input type="checkbox" checked={revisionDraft.levels.includes(level)} onChange={(event) => setRevisionDraft({ ...revisionDraft, levels: event.target.checked ? [...revisionDraft.levels, level] : revisionDraft.levels.filter((item) => item !== level) })} />{levelLabel(level)}</label>)}</fieldset><div><button type="button" onClick={() => setRevisionDraft(null)}>Vazgeç</button><button type="submit" disabled={mutating || !revisionDraft.name.trim() || revisionDraft.levels.length === 0}>{mutating ? "Revize ediliyor" : "Revizyonu kaydet"}</button></div></form> : null}
      {revisionDraft?.kind === "definition" && revisionDraft.ref === impact.target.ref ? <form className={styles.categoryRevisionForm} onSubmit={(event) => {
        event.preventDefault(); if (!authoring || !impact || !isRevisionMutationReady(impact, authoring)
          || !revisionDraft.label.trim()) return;
        void mutate({ operation: "revise_definition", definitionRef: revisionDraft.ref,
          expectedVersion: impact.target.version, label: revisionDraft.label.trim(),
          description: revisionDraft.description.trim() || null, expectedRegistryHash: authoring.registryHash,
          expectedImpactHash: impact.impactHash });
      }}><strong>Tanım revizyonu</strong><label>Etiket<input value={revisionDraft.label} maxLength={160} onChange={(event) => setRevisionDraft({ ...revisionDraft, label: event.target.value })} required /></label><label>Açıklama<textarea value={revisionDraft.description} maxLength={2000} onChange={(event) => setRevisionDraft({ ...revisionDraft, description: event.target.value })} /></label><div><button type="button" onClick={() => setRevisionDraft(null)}>Vazgeç</button><button type="submit" disabled={mutating || !revisionDraft.label.trim()}>{mutating ? "Revize ediliyor" : "Revizyonu kaydet"}</button></div></form> : null}
      <footer><p>{archiveReady || revisionReady ? "Preview eksiksiz ve engel yok. Mutation bu registry/version/impact hash üçlüsüne bağlıdır." : impact.coverage.partialOrUnknown.length ? `Kapsama eksik: ${impact.coverage.partialOrUnknown.join(" · ")}.` : "Mutation kapısı; yetki, güncel sürüm, kesin/muhafazakâr engeller ve bütünlük bulguları temizlenmeden açılmaz."}</p><span>{impact.disposition === "blocked" ? "ENGELLİ" : archiveReady || revisionReady ? "ONAY BEKLİYOR" : "KAPALI"}</span>{revisionReady && !revisionDraft ? <button className={styles.categoryRevisionOpen} type="button" onClick={() => {
        if (!authoring || !impact || !isRevisionMutationReady(impact, authoring)) return;
        if (impact.target.kind === "dimension") {
          const current = authoring.dimensions.find((item) => item.ref === impact.target.ref); if (!current) return;
          setRevisionDraft({ kind: "dimension", ref: current.ref, name: current.name,
            description: current.description ?? "", cardinality: current.cardinality, levels: [...current.allowedEntityLevels] });
        } else {
          const current = authoring.dimensions.flatMap((item) => item.definitions).find((item) => item.ref === impact.target.ref);
          if (!current) return;
          setRevisionDraft({ kind: "definition", ref: current.ref, label: current.label, description: current.description ?? "" });
        }
      }}>Mevcut değerlerle revize et</button> : null}{archiveReady ? <div className={styles.categoryArchiveAction}><label><input type="checkbox" checked={archiveConfirmed} onChange={(event) => setArchiveConfirmed(event.target.checked)} /> Etkiyi inceledim; bu kaydı arşivle</label><button type="button" disabled={!archiveConfirmed || mutating} onClick={() => {
        if (!authoring || !impact || !isArchiveMutationReady(impact, authoring)) return;
        const command = impact.target.kind === "dimension"
          ? { operation: "archive_dimension" as const, dimensionRef: impact.target.ref, expectedVersion: impact.target.version,
              expectedRegistryHash: authoring.registryHash, expectedImpactHash: impact.impactHash }
          : { operation: "archive_definition" as const, definitionRef: impact.target.ref, expectedVersion: impact.target.version,
              expectedRegistryHash: authoring.registryHash, expectedImpactHash: impact.impactHash };
        void mutate(command);
      }}>{mutating ? "Arşivleniyor" : "Arşivlemeyi onayla"}</button></div> : null}</footer>
    </section> : null}
    <section className={`${styles.panel} ${styles.categoryRegistry}`}>
      <header className={styles.panelHeader}><div><span className={styles.kicker}>DOĞRUDAN KAPSAMA</span><h2>Boyutlar ve tanımlar</h2></div><span>{snapshot.contractVersion}</span></header>
      {!snapshot.dimensions.length ? <div className={styles.categoryEmpty}><strong>Henüz aktif iç kategori yok</strong><p>İlk registry tanımları ayrı, denetimli authoring diliminde eklenecek.</p></div> : snapshot.dimensions.map((dimension) => <details key={dimension.ref} open>
        <summary><div><strong>{dimension.name}</strong><small>{dimension.key} · v{dimension.version} · {dimension.cardinality === "single" ? "tek seçim" : "çoklu seçim"}</small></div><span>{dimension.definitions.length} tanım</span></summary>
        <div className={styles.categoryDetail}>
          <div className={styles.categoryDimensionActions}>{dimension.description ? <p>{dimension.description}</p> : <span /> }<button type="button" disabled={impactLoading} onClick={() => void previewImpact(dimension.ref)}>{impactLoading ? "Hesaplanıyor" : "Boyut arşiv etkisi"}</button></div>
          <div className={styles.categoryCoverage}>{dimension.coverage.map((coverage) => <article key={coverage.level}><span>{levelLabel(coverage.level)}</span><strong>{ratio(coverage.coverageBasisPoints)}</strong><small>{number(coverage.directlyAssignedEntities)} / {number(coverage.totalEntities)} doğrudan · {number(coverage.unmatchedEntities)} eşleşmemiş{coverage.deniedAssignments ? ` · ${number(coverage.deniedAssignments)} deny` : ""}</small></article>)}</div>
          <div className={styles.categoryDefinitions}>{dimension.definitions.map((definition) => <article key={definition.ref}><div><strong>{definition.label}</strong><small>{definition.key} · v{definition.version}</small></div><p>{definition.description ?? "Açıklama eklenmemiş."}</p><dl><div><dt>Ortalama güven</dt><dd>{confidence(definition.confidence.averageBasisPoints)}</dd></div><div><dt>En düşük</dt><dd>{confidence(definition.confidence.minimumBasisPoints)}</dd></div><div><dt>Eşik altı</dt><dd>{number(definition.confidence.belowReviewThreshold)}</dd></div><div><dt>Kanıt kaydı</dt><dd>{number(definition.evidenceHealth.evidenceRecords)}</dd></div></dl>{definition.evidenceHealth.kinds.length ? <p className={styles.categoryEvidenceKinds}>{definition.evidenceHealth.kinds.map((item) => `${item.kind} · ${number(item.count)}`).join("  •  ")}</p> : null}<footer><span>{number(definition.assignments.total)} atama</span><span>{number(definition.assignments.manualLocked)} kilit</span><span>{number(definition.assignments.manual)} manuel · {number(definition.assignments.agent)} agent · {number(definition.assignments.deterministic)} deterministik</span>{definition.evidenceHealth.invalidEvidenceAssignments ? <span>{number(definition.evidenceHealth.invalidEvidenceAssignments)} geçersiz kanıt</span> : null}<button type="button" disabled={impactLoading} onClick={() => void previewImpact(definition.ref)}>Arşiv etkisi</button></footer></article>)}</div>
        </div>
      </details>)}
    </section>
  </>;
}
