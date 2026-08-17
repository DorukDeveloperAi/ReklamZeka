import { createHash } from "node:crypto";
import "server-only";
import { META_ACTION_CAPABILITY_CATALOG } from "@/domain/meta/insights/capability-catalog";
import { isTrustedPrimaryResultActionCatalog } from "@/domain/operations/internal/trusted-primary-result-catalog";

/**
 * Primary-result bindings intentionally have a much smaller vocabulary than
 * the general metric engine. A user chooses one exact Meta action type; this
 * layer never infers an outcome from an objective, name, or a nearby metric.
 */
export const PRIMARY_RESULT_BINDING_VERSION = "primary-result-binding/1.0.0" as const;
export const PRIMARY_RESULT_ACTION_CATALOG_VERSION = "primary-result-action-catalog/1.0.0" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_TYPE = /^[a-z][a-z0-9_.:-]{0,120}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;
const CURRENCY = /^[A-Z]{3}$/;
const ATTRIBUTION = /^[a-z0-9][a-z0-9_.:-]{0,120}$/;
const MAX_OBSERVATIONS = 20_000;
const MAX_DECIMAL_DIGITS = 38;
const MAX_DECIMAL_SCALE = 18;

export type PrimaryResultSelector = `actions/${string}`;
export type PrimaryResultActionCatalog = Readonly<{
  version: typeof PRIMARY_RESULT_ACTION_CATALOG_VERSION;
  workspaceId: string;
  actionTypes: readonly string[];
  provenance: Readonly<{
    source: "meta_insights";
    field: "actions";
    breakdown: "action_type";
    extraction: "exact_action_type_only";
    observedThrough: string;
    sourceSnapshotHash: string;
    manifestHash: string;
    canonicalEvidenceHash: string;
  }>;
  catalogHash: string;
}>;
declare const trustedPrimaryResultCatalog: unique symbol;
/** Constructed only by the server-side canonical-catalog adapter. */
export type TrustedPrimaryResultActionCatalog = PrimaryResultActionCatalog & Readonly<{ [trustedPrimaryResultCatalog]: true }>;
export type PrimaryResultCanonicalCatalogEvidence = Readonly<{
  workspaceId: string;
  actionTypes: readonly string[];
  observedThrough: string;
  sourceSnapshotHash: string;
  manifestHash: string;
  canonicalEvidenceHash: string;
}>;

export type PrimaryResultBindingTarget =
  | Readonly<{ kind: "organization_campaign"; organizationCampaignId: string }>
  | Readonly<{ kind: "slice"; sliceId: string }>;

export type PrimaryResultBindingRevision = Readonly<{
  version: typeof PRIMARY_RESULT_BINDING_VERSION;
  bindingId: string;
  workspaceId: string;
  target: PrimaryResultBindingTarget;
  state: "bound" | "unbound";
  selector: PrimaryResultSelector | null;
  actionCatalogHash: string | null;
  previousRevisionHash: string | null;
  createdAt: string;
  revisionHash: string;
}>;

export type PrimaryResultBindingResolution = Readonly<{
  state: "bound" | "unbound";
  binding: PrimaryResultBindingRevision | null;
  reason: "slice_binding" | "organization_campaign_fallback" | "global_slice_ignored" | "unassigned" | "no_binding";
  resolutionHash: string;
}>;
export type PrimaryResultResolutionScope = Readonly<{
  expectedWorkspaceId: string;
  currentSlice: Readonly<{ kind: "none" | "global" | "scoped"; sliceId: string | null }>;
  assignedOrganizationCampaignId: string | null;
}>;

export type PrimaryResultObservation = Readonly<{
  action: Readonly<
    | { state: "known"; actionType: string; valueDecimal: string }
    | { state: "missing"; actionType: string }
    | { state: "unavailable"; actionType: string; reason: "permission_missing" | "unsupported" | "unknown" }
  >;
  spend: Readonly<
    | { state: "known"; valueMinorDecimal: string; currency: string }
    | { state: "missing" }
    | { state: "unavailable"; reason: "permission_missing" | "unsupported" | "unknown" }
  >;
  attributionLabel: string | null;
}>;

export type PrimaryResultAggregate = Readonly<{
  state: "available" | "unknown" | "unbound";
  resultDecimal: string | null;
  /** Null when unavailable or when a known result count is zero. */
  resultCostMinorDecimal: string | null;
  currency: string | null;
  reasonCodes: readonly ("unbound" | "empty_observations" | "action_missing" | "action_unavailable" | "spend_missing" | "spend_unavailable" | "attribution_mismatch" | "currency_mismatch" | "zero_result_cost_not_defined")[];
  provenance: Readonly<{
    selector: PrimaryResultSelector | null;
    actionCatalogHash: string | null;
    aggregation: "sum" | "ratio_of_sums" | null;
    inputRowCount: number;
  }>;
}>;
type PrimaryResultReason = PrimaryResultAggregate["reasonCodes"][number];

type Decimal = Readonly<{ coefficient: bigint; scale: number }>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, stable(item)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function matches(value: unknown, expression: RegExp): value is string { return typeof value === "string" && expression.test(value); }
function exactKeys(value: unknown, keys: readonly string[]): boolean { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).sort().join("|") === [...keys].sort().join("|"); }
function validDateTime(value: string): boolean { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function primaryResultCanonicalEvidenceHash(input: Readonly<{ workspaceId: string; actionTypes: readonly string[]; observedThrough: string; sourceSnapshotHash: string; manifestHash: string }>): string {
  return hash({ workspaceId: input.workspaceId, actionTypes: [...input.actionTypes].sort(), observedThrough: input.observedThrough, sourceSnapshotHash: input.sourceSnapshotHash, manifestHash: input.manifestHash });
}
function validEvidence(value: unknown): value is PrimaryResultCanonicalCatalogEvidence {
  if (!exactKeys(value, ["workspaceId", "actionTypes", "observedThrough", "sourceSnapshotHash", "manifestHash", "canonicalEvidenceHash"])) return false;
  const item = value as PrimaryResultCanonicalCatalogEvidence;
  return matches(item.workspaceId, UUID) && Array.isArray(item.actionTypes) && item.actionTypes.length > 0 && item.actionTypes.length <= 1_000 && item.actionTypes.every((actionType) => matches(actionType, ACTION_TYPE)) && new Set(item.actionTypes).size === item.actionTypes.length && [...item.actionTypes].every((actionType, index, all) => index === 0 || all[index - 1]! < actionType) && validDateTime(item.observedThrough) && matches(item.sourceSnapshotHash, HASH) && matches(item.manifestHash, HASH) && typeof item.canonicalEvidenceHash === "string" && item.canonicalEvidenceHash === primaryResultCanonicalEvidenceHash(item);
}
function parseDecimal(value: string): Decimal | null {
  if (!matches(value, DECIMAL)) return null;
  const [, whole, fraction = ""] = /^(\d+)(?:\.(\d+))?$/.exec(value)!;
  if (whole!.length + fraction.length > MAX_DECIMAL_DIGITS || fraction.length > MAX_DECIMAL_SCALE) return null;
  return Object.freeze({ coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length });
}
function power10(value: number): bigint { return 10n ** BigInt(value); }
function sumDecimal(values: readonly Decimal[]): Decimal {
  const scale = Math.max(...values.map((value) => value.scale));
  return Object.freeze({ coefficient: values.reduce((total, value) => total + value.coefficient * power10(scale - value.scale), 0n), scale });
}
function formatDecimal(value: Decimal): string {
  const digits = value.coefficient.toString().padStart(value.scale + 1, "0");
  if (value.scale === 0) return digits;
  const fraction = digits.slice(-value.scale).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -value.scale)}.${fraction}` : digits.slice(0, -value.scale);
}
function divideDecimal(numerator: Decimal, denominator: Decimal, precision = 12): string | null {
  if (denominator.coefficient === 0n) return null;
  const quotient = numerator.coefficient * power10(denominator.scale + precision) / (denominator.coefficient * power10(numerator.scale));
  return formatDecimal(Object.freeze({ coefficient: quotient, scale: precision }));
}
function assertion(condition: unknown, code = "invalid_primary_result"): asserts condition { if (!condition) throw new Error(`primary result rejected: ${code}`); }
function cloneTarget(target: PrimaryResultBindingTarget): PrimaryResultBindingTarget { return target.kind === "organization_campaign" ? Object.freeze({ kind: "organization_campaign" as const, organizationCampaignId: target.organizationCampaignId }) : Object.freeze({ kind: "slice" as const, sliceId: target.sliceId }); }
function cloneRevision(revision: PrimaryResultBindingRevision): PrimaryResultBindingRevision { return Object.freeze({ ...revision, target: cloneTarget(revision.target) }); }
function resolutionHash(scope: PrimaryResultResolutionScope, state: PrimaryResultBindingResolution["state"], reason: PrimaryResultBindingResolution["reason"], binding: PrimaryResultBindingRevision | null): string { return hash({ scope, state, reason, bindingRevisionHash: binding?.revisionHash ?? null }); }
function resolved(scope: PrimaryResultResolutionScope, state: PrimaryResultBindingResolution["state"], reason: PrimaryResultBindingResolution["reason"], binding: PrimaryResultBindingRevision | null): PrimaryResultBindingResolution { return Object.freeze({ state, reason, binding, resolutionHash: resolutionHash(scope, state, reason, binding) }); }

export function primaryResultSelector(actionType: string, catalog: TrustedPrimaryResultActionCatalog): PrimaryResultSelector {
  assertion(matches(actionType, ACTION_TYPE), "selector");
  assertion(isTrustedPrimaryResultActionCatalog(catalog), "catalog");
  assertion(catalog.actionTypes.includes(actionType), "selector_not_in_catalog");
  return `actions/${actionType}`;
}

function isPrimaryResultActionCatalog(value: unknown): value is PrimaryResultActionCatalog {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PrimaryResultActionCatalog;
  const closedActionTypes = new Set(META_ACTION_CAPABILITY_CATALOG.filter((item) => item.container === "actions" && item.outputKind === "decimal").map((item) => item.actionType));
  return exactKeys(candidate, ["version", "workspaceId", "actionTypes", "provenance", "catalogHash"]) && candidate.version === PRIMARY_RESULT_ACTION_CATALOG_VERSION && matches(candidate.workspaceId, UUID) && Array.isArray(candidate.actionTypes) && candidate.actionTypes.length > 0 && candidate.actionTypes.length <= 1_000 && candidate.actionTypes.every((actionType) => matches(actionType, ACTION_TYPE) && closedActionTypes.has(actionType)) && new Set(candidate.actionTypes).size === candidate.actionTypes.length && [...candidate.actionTypes].every((actionType, index, all) => index === 0 || all[index - 1]! < actionType) && exactKeys(candidate.provenance, ["source", "field", "breakdown", "extraction", "observedThrough", "sourceSnapshotHash", "manifestHash", "canonicalEvidenceHash"]) && candidate.provenance.source === "meta_insights" && candidate.provenance.field === "actions" && candidate.provenance.breakdown === "action_type" && candidate.provenance.extraction === "exact_action_type_only" && validEvidence({ workspaceId: candidate.workspaceId, actionTypes: candidate.actionTypes, observedThrough: candidate.provenance.observedThrough, sourceSnapshotHash: candidate.provenance.sourceSnapshotHash, manifestHash: candidate.provenance.manifestHash, canonicalEvidenceHash: candidate.provenance.canonicalEvidenceHash }) && matches(candidate.catalogHash, HASH) && candidate.catalogHash === hash({ version: candidate.version, workspaceId: candidate.workspaceId, actionTypes: candidate.actionTypes, provenance: candidate.provenance });
}

export function createPrimaryResultBindingRevision(input: Readonly<{
  bindingId: string; workspaceId: string; target: PrimaryResultBindingTarget; state: "bound" | "unbound"; selector?: PrimaryResultSelector; actionCatalog?: TrustedPrimaryResultActionCatalog; previousRevisionHash?: string | null; createdAt: string;
}>): PrimaryResultBindingRevision {
  assertion(exactKeys(input, ["bindingId", "workspaceId", "target", "state", "selector", "actionCatalog", "previousRevisionHash", "createdAt"].filter((key) => key in input)) && matches(input.bindingId, UUID) && matches(input.workspaceId, UUID) && validDateTime(input.createdAt), "binding");
  assertion(input.target?.kind === "organization_campaign" ? exactKeys(input.target, ["kind", "organizationCampaignId"]) && matches(input.target.organizationCampaignId, UUID) : input.target?.kind === "slice" && exactKeys(input.target, ["kind", "sliceId"]) && matches(input.target.sliceId, UUID), "binding_target");
  assertion(input.previousRevisionHash === undefined || input.previousRevisionHash === null || matches(input.previousRevisionHash, HASH), "binding_previous_hash");
  const bound = input.state === "bound";
  assertion(bound ? typeof input.selector === "string" && input.actionCatalog : !input.selector && !input.actionCatalog, "binding_state");
  if (bound) {
    assertion(isTrustedPrimaryResultActionCatalog(input.actionCatalog), "catalog");
    assertion(input.actionCatalog!.workspaceId === input.workspaceId, "catalog_workspace");
    const actionType = input.selector!.slice("actions/".length);
    assertion(input.selector === `actions/${actionType}` && primaryResultSelector(actionType, input.actionCatalog!) === input.selector, "selector");
  }
  const target = cloneTarget(input.target);
  const material = { version: PRIMARY_RESULT_BINDING_VERSION, bindingId: input.bindingId, workspaceId: input.workspaceId, target, state: input.state, selector: input.selector ?? null, actionCatalogHash: input.actionCatalog?.catalogHash ?? null, previousRevisionHash: input.previousRevisionHash ?? null, createdAt: input.createdAt } as const;
  return Object.freeze({ ...material, revisionHash: hash(material) });
}

export function isPrimaryResultBindingRevision(value: unknown): value is PrimaryResultBindingRevision {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PrimaryResultBindingRevision;
  try {
    assertion(exactKeys(candidate, ["version", "bindingId", "workspaceId", "target", "state", "selector", "actionCatalogHash", "previousRevisionHash", "createdAt", "revisionHash"]) && candidate.version === PRIMARY_RESULT_BINDING_VERSION && matches(candidate.revisionHash, HASH), "binding");
    assertion(candidate.state === "bound" || candidate.state === "unbound", "binding_state");
    assertion(matches(candidate.bindingId, UUID) && matches(candidate.workspaceId, UUID) && validDateTime(candidate.createdAt), "binding");
    assertion(candidate.target?.kind === "organization_campaign" ? exactKeys(candidate.target, ["kind", "organizationCampaignId"]) && matches(candidate.target.organizationCampaignId, UUID) : candidate.target?.kind === "slice" && exactKeys(candidate.target, ["kind", "sliceId"]) && matches(candidate.target.sliceId, UUID), "binding_target");
    assertion(candidate.previousRevisionHash === null || matches(candidate.previousRevisionHash, HASH), "binding_previous_hash");
    assertion(candidate.state === "bound"
      ? typeof candidate.selector === "string" && candidate.selector.startsWith("actions/") && matches(candidate.selector.slice("actions/".length), ACTION_TYPE) && typeof candidate.actionCatalogHash === "string" && matches(candidate.actionCatalogHash, HASH)
      : candidate.selector === null && candidate.actionCatalogHash === null, "binding_state");
    const material = { version: candidate.version, bindingId: candidate.bindingId, workspaceId: candidate.workspaceId, target: candidate.target, state: candidate.state, selector: candidate.selector, actionCatalogHash: candidate.actionCatalogHash, previousRevisionHash: candidate.previousRevisionHash, createdAt: candidate.createdAt };
    return candidate.revisionHash === hash(material);
  } catch { return false; }
}

/** A persisted bound revision is valid only with the exact catalog it cites. */
function validatePrimaryResultBindingRevision(revision: PrimaryResultBindingRevision, catalog: TrustedPrimaryResultActionCatalog | null, canonicalEvidence: PrimaryResultCanonicalCatalogEvidence | null): boolean {
  if (!isPrimaryResultBindingRevision(revision)) return false;
  if (revision.state === "unbound") return catalog === null && canonicalEvidence === null;
  if (!catalog || !canonicalEvidence || !validEvidence(canonicalEvidence) || !isTrustedPrimaryResultActionCatalog(catalog) || revision.workspaceId !== catalog.workspaceId || canonicalEvidence.workspaceId !== catalog.workspaceId || revision.actionCatalogHash !== catalog.catalogHash || !revision.selector) return false;
  if (catalog.actionTypes.join("|") !== canonicalEvidence.actionTypes.join("|") || catalog.provenance.observedThrough !== canonicalEvidence.observedThrough || catalog.provenance.sourceSnapshotHash !== canonicalEvidence.sourceSnapshotHash || catalog.provenance.manifestHash !== canonicalEvidence.manifestHash || catalog.provenance.canonicalEvidenceHash !== canonicalEvidence.canonicalEvidenceHash) return false;
  try { return primaryResultSelector(revision.selector.slice("actions/".length), catalog) === revision.selector; } catch { return false; }
}

/**
 * Global slices are reporting scopes, never a primary-result authority. An
 * explicit unbound slice does not mask an organization-campaign binding.
 */
export function resolvePrimaryResultBinding(input: Readonly<{
  expectedWorkspaceId: string;
  organizationCampaignBinding: PrimaryResultBindingRevision | null;
  sliceBinding: PrimaryResultBindingRevision | null;
  currentSlice: Readonly<{ kind: "none" | "global" | "scoped"; sliceId: string | null }>;
  assignedOrganizationCampaignId: string | null;
  actionCatalog: TrustedPrimaryResultActionCatalog | null;
  canonicalCatalogEvidence: PrimaryResultCanonicalCatalogEvidence | null;
}>): PrimaryResultBindingResolution {
  assertion(exactKeys(input, ["expectedWorkspaceId", "organizationCampaignBinding", "sliceBinding", "currentSlice", "assignedOrganizationCampaignId", "actionCatalog", "canonicalCatalogEvidence"]) && matches(input.expectedWorkspaceId, UUID), "scope");
  assertion(exactKeys(input.currentSlice, ["kind", "sliceId"]) && (input.currentSlice.kind === "none" && input.currentSlice.sliceId === null || input.currentSlice.kind === "global" && input.currentSlice.sliceId === null || input.currentSlice.kind === "scoped" && matches(input.currentSlice.sliceId, UUID)), "scope");
  assertion(input.assignedOrganizationCampaignId === null || matches(input.assignedOrganizationCampaignId, UUID), "scope");
  const scope: PrimaryResultResolutionScope = Object.freeze({ expectedWorkspaceId: input.expectedWorkspaceId, currentSlice: Object.freeze({ ...input.currentSlice }), assignedOrganizationCampaignId: input.assignedOrganizationCampaignId });
  // An unassigned entity never inherits a binding, and irrelevant foreign
  // envelope data must not turn this deterministic outcome into a failure.
  if (!input.assignedOrganizationCampaignId) return resolved(scope, "unbound", "unassigned", null);
  assertion(input.actionCatalog === null || input.actionCatalog.workspaceId === input.expectedWorkspaceId, "catalog_workspace");
  assertion(input.canonicalCatalogEvidence === null || input.canonicalCatalogEvidence.workspaceId === input.expectedWorkspaceId, "catalog_workspace");
  const valid = (binding: PrimaryResultBindingRevision | null): PrimaryResultBindingRevision | null => {
    if (!binding) return null;
    assertion(binding.workspaceId === input.expectedWorkspaceId && validatePrimaryResultBindingRevision(binding, binding.state === "bound" ? input.actionCatalog : null, binding.state === "bound" ? input.canonicalCatalogEvidence : null), "binding_integrity");
    return binding;
  };
  const validOrg = valid(input.organizationCampaignBinding);
  // A global/no-slice report has no slice authority; even a supplied slice
  // revision is deliberately ignored rather than allowed to influence it.
  const validSlice = input.currentSlice.kind === "scoped" ? valid(input.sliceBinding) : null;
  if (validOrg) assertion(validOrg.target.kind === "organization_campaign" && validOrg.target.organizationCampaignId === input.assignedOrganizationCampaignId, "organization_binding");
  if (validSlice) assertion(validSlice.target.kind === "slice" && validSlice.target.sliceId === input.currentSlice.sliceId, "slice_binding");
  if (input.currentSlice.kind === "global") return validOrg?.state === "bound" ? resolved(scope, "bound", "global_slice_ignored", cloneRevision(validOrg)) : resolved(scope, "unbound", "global_slice_ignored", null);
  if (input.currentSlice.kind === "scoped" && validSlice?.state === "bound") return resolved(scope, "bound", "slice_binding", cloneRevision(validSlice));
  if (validOrg?.state === "bound") return resolved(scope, "bound", "organization_campaign_fallback", cloneRevision(validOrg));
  return resolved(scope, "unbound", "no_binding", null);
}

export function aggregatePrimaryResult(input: Readonly<{ resolutionScope: PrimaryResultResolutionScope; organizationCampaignBinding: PrimaryResultBindingRevision | null; sliceBinding: PrimaryResultBindingRevision | null; actionCatalog: TrustedPrimaryResultActionCatalog | null; canonicalCatalogEvidence: PrimaryResultCanonicalCatalogEvidence | null; observations: readonly PrimaryResultObservation[] }>): PrimaryResultAggregate {
  assertion(exactKeys(input, ["resolutionScope", "organizationCampaignBinding", "sliceBinding", "actionCatalog", "canonicalCatalogEvidence", "observations"]) && Array.isArray(input.observations) && input.observations.length <= MAX_OBSERVATIONS && exactKeys(input.resolutionScope, ["expectedWorkspaceId", "currentSlice", "assignedOrganizationCampaignId"]), "observations");
  const resolution = resolvePrimaryResultBinding({ expectedWorkspaceId: input.resolutionScope.expectedWorkspaceId, organizationCampaignBinding: input.organizationCampaignBinding, sliceBinding: input.sliceBinding, currentSlice: input.resolutionScope.currentSlice, assignedOrganizationCampaignId: input.resolutionScope.assignedOrganizationCampaignId, actionCatalog: input.actionCatalog, canonicalCatalogEvidence: input.canonicalCatalogEvidence });
  const binding = resolution.binding;
  const base = { selector: binding?.selector ?? null, actionCatalogHash: binding?.actionCatalogHash ?? null, inputRowCount: input.observations.length } as const;
  if (resolution.state !== "bound" || !binding?.selector) return Object.freeze({ state: "unbound", resultDecimal: null, resultCostMinorDecimal: null, currency: null, reasonCodes: Object.freeze(["unbound"] as PrimaryResultReason[]), provenance: Object.freeze({ ...base, aggregation: null }) });
  if (!input.observations.length) return Object.freeze({ state: "unknown", resultDecimal: null, resultCostMinorDecimal: null, currency: null, reasonCodes: Object.freeze(["empty_observations"] as PrimaryResultReason[]), provenance: Object.freeze({ ...base, aggregation: null }) });
  const actionType = binding.selector.slice("actions/".length);
  const reasons = new Set<PrimaryResultReason>();
  const attributions = new Set<string>(); const currencies = new Set<string>(); const results: Decimal[] = []; const spend: Decimal[] = [];
  for (const observation of input.observations) {
    assertion(exactKeys(observation, ["action", "spend", "attributionLabel"]), "observation");
    assertion(exactKeys(observation.action, observation.action.state === "known" ? ["state", "actionType", "valueDecimal"] : observation.action.state === "missing" ? ["state", "actionType"] : observation.action.state === "unavailable" ? ["state", "actionType", "reason"] : []) && matches(observation.action.actionType, ACTION_TYPE), "observation_action");
    assertion(exactKeys(observation.spend, observation.spend.state === "known" ? ["state", "valueMinorDecimal", "currency"] : observation.spend.state === "missing" ? ["state"] : observation.spend.state === "unavailable" ? ["state", "reason"] : []), "observation_spend");
    assertion(observation.action.state !== "unavailable" || ["permission_missing", "unsupported", "unknown"].includes(observation.action.reason), "observation_action");
    assertion(observation.spend.state !== "unavailable" || ["permission_missing", "unsupported", "unknown"].includes(observation.spend.reason), "observation_spend");
    if (!matches(observation.attributionLabel, ATTRIBUTION)) reasons.add("attribution_mismatch"); else attributions.add(observation.attributionLabel);
    if (observation.action.actionType !== actionType) reasons.add("action_missing");
    else if (observation.action.state === "missing") reasons.add("action_missing");
    else if (observation.action.state === "unavailable") reasons.add("action_unavailable");
    else { const value = parseDecimal(observation.action.valueDecimal); if (!value) reasons.add("action_missing"); else results.push(value); }
    if (observation.spend.state === "missing") reasons.add("spend_missing");
    else if (observation.spend.state === "unavailable") reasons.add("spend_unavailable");
    else { const value = parseDecimal(observation.spend.valueMinorDecimal); if (!value) reasons.add("spend_missing"); else if (!matches(observation.spend.currency, CURRENCY)) reasons.add("currency_mismatch"); else { spend.push(value); currencies.add(observation.spend.currency); } }
  }
  if (attributions.size !== 1) reasons.add("attribution_mismatch");
  if (currencies.size !== 1) reasons.add("currency_mismatch");
  if (reasons.size) return Object.freeze({ state: "unknown", resultDecimal: null, resultCostMinorDecimal: null, currency: null, reasonCodes: Object.freeze([...reasons].sort() as PrimaryResultReason[]), provenance: Object.freeze({ ...base, aggregation: null }) });
  const totalResult = sumDecimal(results); const totalSpend = sumDecimal(spend); const currency = [...currencies][0]!;
  if (totalResult.coefficient === 0n) return Object.freeze({ state: "available", resultDecimal: formatDecimal(totalResult), resultCostMinorDecimal: null, currency, reasonCodes: Object.freeze(["zero_result_cost_not_defined"] as PrimaryResultReason[]), provenance: Object.freeze({ ...base, aggregation: "sum" }) });
  return Object.freeze({ state: "available", resultDecimal: formatDecimal(totalResult), resultCostMinorDecimal: divideDecimal(totalSpend, totalResult), currency, reasonCodes: Object.freeze([]), provenance: Object.freeze({ ...base, aggregation: "ratio_of_sums" }) });
}
