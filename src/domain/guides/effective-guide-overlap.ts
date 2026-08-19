import { createHash } from "node:crypto";

import {
  GUIDE_ACTIONS,
  createGuideRevision,
  type GuideAction,
  type GuideMarket,
  type GuideMode,
  type GuideRevision,
} from "@/domain/guides/guide-revision";

export const EFFECTIVE_GUIDE_OVERLAP_VERSION = "effective-guide-overlap/1.0.0" as const;

export type GuideRestriction =
  | Readonly<{ restrictionRef: string; kind: "deny" | "manual_lock"; actions: readonly GuideAction[] }>
  | Readonly<{
    restrictionRef: string;
    kind: "protection";
    disposition: "deny" | "human_approval";
    actions: readonly GuideAction[];
  }>;

export type GuideNumericCap = Readonly<{
  capRef: string;
  action: GuideAction;
  kind: "maximum_actions_per_run" | "maximum_absolute_budget_delta_minor" | "maximum_relative_budget_delta_basis_points";
  value: number;
  currency: "TRY" | null;
}>;

export type EffectiveGuideBinding = Readonly<{
  revision: GuideRevision;
  restrictions: readonly GuideRestriction[];
  numericCaps: readonly GuideNumericCap[];
  unresolvedConflictRefs: readonly string[];
}>;

export type EffectiveGuideOverlap = Readonly<{
  version: typeof EFFECTIVE_GUIDE_OVERLAP_VERSION;
  workspaceRef: string;
  entityRef: string;
  market: GuideMarket;
  effectiveMode: GuideMode;
  guideEvidence: readonly Readonly<{
    guideRef: string;
    revision: number;
    revisionHash: string;
    restrictionSetHash: string;
  }>[];
  effectiveGuideSetHash: string;
  actionAllowlist: readonly GuideAction[];
  deniedActions: readonly GuideAction[];
  recommendationActions: readonly GuideAction[];
  humanApprovalActions: readonly GuideAction[];
  autonomousActions: readonly GuideAction[];
  restrictions: readonly GuideRestriction[];
  numericCaps: readonly Readonly<Omit<GuideNumericCap, "capRef"> & { sourceCapRefs: readonly string[] }>[];
  hold: Readonly<{ state: "clear" | "held"; reasonCodes: readonly string[]; conflictRefs: readonly string[] }>;
  authority: Readonly<{
    actionExecution: "none";
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canGrantAutonomy: false;
  }>;
  resolutionHash: string;
}>;

export class EffectiveGuideOverlapError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "market_boundary" | "corrupt_revision" | "active_guide_conflict") {
    super(code);
    this.name = "EffectiveGuideOverlapError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const MODE_RANK: Readonly<Record<GuideMode, number>> = Object.freeze({
  observe_analyze: 0,
  recommend: 1,
  prepare_human_approval: 2,
  limited_autonomy: 3,
});
const BUDGET_ACTIONS: ReadonlySet<GuideAction> = new Set(["budget_decrease", "budget_increase"]);

function fail(code: EffectiveGuideOverlapError["code"]): never { throw new EffectiveGuideOverlapError(code); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compare(left, right)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function reference(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) fail("invalid_input");
  return value;
}
function sortedUniqueRefs(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) fail("invalid_input");
  const result = value.map(reference).sort(compare);
  if (new Set(result).size !== result.length) fail("invalid_input");
  return Object.freeze(result);
}
function actions(value: unknown, allowEmpty = false): readonly GuideAction[] {
  if (!Array.isArray(value) || value.length > GUIDE_ACTIONS.length) fail("invalid_input");
  const result = value.map((item) => {
    if (typeof item !== "string" || !GUIDE_ACTIONS.includes(item as GuideAction)) fail("invalid_input");
    return item as GuideAction;
  }).sort(compare);
  if ((!allowEmpty && result.length === 0) || new Set(result).size !== result.length) fail("invalid_input");
  return Object.freeze(result);
}
function canonicalRevision(value: GuideRevision): GuideRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("corrupt_revision");
  try {
    const rebuilt = createGuideRevision({
      workspaceRef: value.workspaceRef,
      guideRef: value.guideRef,
      revision: value.revision,
      previousRevisionHash: value.previousRevisionHash,
      sliceRef: value.sliceRef,
      market: value.market,
      freeText: value.freeText,
      strict: value.strict,
      schedule: value.schedule,
      mode: value.mode,
      actionAllowlist: value.actionAllowlist,
    });
    const expectedKeys = Object.keys(rebuilt).sort(compare);
    const actualKeys = Object.keys(value).sort(compare);
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)
      || rebuilt.revisionHash !== value.revisionHash
      || digest(rebuilt) !== digest(value)) fail("corrupt_revision");
    return rebuilt;
  } catch (error) {
    if (error instanceof EffectiveGuideOverlapError) throw error;
    return fail("corrupt_revision");
  }
}
function normalizeRestriction(value: GuideRestriction): GuideRestriction {
  if (value.kind === "deny" || value.kind === "manual_lock") {
    exact(value, ["restrictionRef", "kind", "actions"]);
    return Object.freeze({ restrictionRef: reference(value.restrictionRef), kind: value.kind, actions: actions(value.actions) });
  }
  if (value.kind === "protection") {
    exact(value, ["restrictionRef", "kind", "disposition", "actions"]);
    if (value.disposition !== "deny" && value.disposition !== "human_approval") fail("invalid_input");
    return Object.freeze({ restrictionRef: reference(value.restrictionRef), kind: "protection", disposition: value.disposition, actions: actions(value.actions) });
  }
  return fail("invalid_input");
}
function normalizeCap(value: GuideNumericCap): GuideNumericCap {
  exact(value, ["capRef", "action", "kind", "value", "currency"]);
  const action = actions([value.action])[0]!;
  if (!Number.isSafeInteger(value.value) || value.value < 0) fail("invalid_input");
  if (value.kind === "maximum_actions_per_run") {
    if (value.value < 1 || value.value > 10_000 || value.currency !== null) fail("invalid_input");
  } else if (value.kind === "maximum_absolute_budget_delta_minor") {
    if (!BUDGET_ACTIONS.has(action) || value.value > Number.MAX_SAFE_INTEGER || value.currency !== "TRY") fail("invalid_input");
  } else if (value.kind === "maximum_relative_budget_delta_basis_points") {
    if (!BUDGET_ACTIONS.has(action) || value.value > 1_000_000 || value.currency !== null) fail("invalid_input");
  } else fail("invalid_input");
  return Object.freeze({ capRef: reference(value.capRef), action, kind: value.kind, value: value.value, currency: value.currency });
}

export function resolveEffectiveGuideOverlap(input: Readonly<{
  workspaceRef: string;
  entityRef: string;
  market: GuideMarket;
  guides: readonly EffectiveGuideBinding[];
}>): EffectiveGuideOverlap {
  exact(input, ["workspaceRef", "entityRef", "market", "guides"]);
  const workspaceRef = reference(input.workspaceRef);
  const entityRef = reference(input.entityRef);
  if (input.market !== "yerli" && input.market !== "yabanci") fail("invalid_input");
  if (!Array.isArray(input.guides) || input.guides.length < 1 || input.guides.length > 1_000) fail("invalid_input");

  const normalized = input.guides.map((binding) => {
    exact(binding as unknown, ["revision", "restrictions", "numericCaps", "unresolvedConflictRefs"]);
    const revision = canonicalRevision(binding.revision);
    if (revision.workspaceRef !== workspaceRef) fail("workspace_scope_mismatch");
    if (revision.market !== input.market) fail("market_boundary");
    const restrictionInput = binding.restrictions;
    const capInput = binding.numericCaps;
    if (!Array.isArray(restrictionInput) || restrictionInput.length > 1_000
      || !Array.isArray(capInput) || capInput.length > 1_000) fail("invalid_input");
    const restrictions = (restrictionInput as readonly GuideRestriction[]).map(normalizeRestriction)
      .sort((left, right) => compare(left.restrictionRef, right.restrictionRef));
    const numericCaps = (capInput as readonly GuideNumericCap[]).map(normalizeCap)
      .sort((left, right) => compare(left.capRef, right.capRef));
    if (new Set(restrictions.map((item) => item.restrictionRef)).size !== restrictions.length
      || new Set(numericCaps.map((item) => item.capRef)).size !== numericCaps.length) fail("invalid_input");
    const unresolvedConflictRefs = sortedUniqueRefs(binding.unresolvedConflictRefs, 256);
    return Object.freeze({ revision, restrictions: Object.freeze(restrictions), numericCaps: Object.freeze(numericCaps), unresolvedConflictRefs,
      restrictionSetHash: digest({ restrictions, numericCaps, unresolvedConflictRefs }) });
  }).sort((left, right) => compare(left.revision.guideRef, right.revision.guideRef)
    || left.revision.revision - right.revision.revision || compare(left.revision.revisionHash, right.revision.revisionHash));

  const guideKeys = normalized.map(({ revision }) => `${revision.guideRef}:${revision.revision}`);
  if (new Set(guideKeys).size !== guideKeys.length || new Set(normalized.map(({ revision }) => revision.guideRef)).size !== normalized.length) fail("active_guide_conflict");
  const effectiveMode = normalized.reduce<GuideMode>((current, item) => MODE_RANK[item.revision.mode] < MODE_RANK[current]
    ? item.revision.mode : current, "limited_autonomy");
  const actionAllowlist = Object.freeze(GUIDE_ACTIONS.filter((action) => normalized.every((item) => item.revision.actionAllowlist.includes(action))));
  const derivedConflictRefs: string[] = [];
  const restrictionByRef = new Map<string, GuideRestriction>();
  for (const restriction of normalized.flatMap((item) => item.restrictions)) {
    const current = restrictionByRef.get(restriction.restrictionRef);
    if (!current) restrictionByRef.set(restriction.restrictionRef, restriction);
    else if (digest(current) !== digest(restriction)) derivedConflictRefs.push(restriction.restrictionRef);
  }
  const restrictions = Object.freeze([...restrictionByRef.values()]
    .sort((left, right) => compare(left.restrictionRef, right.restrictionRef)));
  const denied = new Set<GuideAction>();
  const humanOnly = new Set<GuideAction>();
  for (const restriction of restrictions) {
    for (const action of restriction.actions) {
      if (restriction.kind === "deny" || restriction.kind === "manual_lock"
        || restriction.kind === "protection" && restriction.disposition === "deny") denied.add(action);
      else humanOnly.add(action);
    }
  }
  const deniedActions = Object.freeze(GUIDE_ACTIONS.filter((action) => denied.has(action)));
  const effectiveActions = actionAllowlist.filter((action) => !denied.has(action));
  const capByRef = new Map<string, GuideNumericCap>();
  for (const cap of normalized.flatMap((item) => item.numericCaps)) {
    const current = capByRef.get(cap.capRef);
    if (!current) capByRef.set(cap.capRef, cap);
    else if (digest(current) !== digest(cap)) derivedConflictRefs.push(cap.capRef);
  }
  const conflictRefs = Object.freeze([...new Set([
    ...normalized.flatMap((item) => item.unresolvedConflictRefs), ...derivedConflictRefs,
  ])].sort(compare));
  const held = conflictRefs.length > 0;
  const recommendationActions = Object.freeze(!held && effectiveMode === "recommend" ? [...effectiveActions] : []);
  const humanApprovalActions = Object.freeze(!held && effectiveMode === "prepare_human_approval"
    ? [...effectiveActions]
    : !held && effectiveMode === "limited_autonomy"
      ? effectiveActions.filter((action) => action.endsWith("_rename") || humanOnly.has(action))
      : []);
  const autonomousActions = Object.freeze(!held && effectiveMode === "limited_autonomy"
    ? effectiveActions.filter((action) => !action.endsWith("_rename") && !humanOnly.has(action))
    : []);

  const capGroups = new Map<string, GuideNumericCap[]>();
  for (const item of capByRef.values()) {
    const key = `${item.action}:${item.kind}:${item.currency ?? "none"}`;
    capGroups.set(key, [...(capGroups.get(key) ?? []), item]);
  }
  const numericCaps = Object.freeze([...capGroups.values()].map((items) => {
    const first = items[0]!;
    return Object.freeze({ action: first.action, kind: first.kind, value: Math.min(...items.map((item) => item.value)),
      currency: first.currency, sourceCapRefs: Object.freeze(items.map((item) => item.capRef).sort(compare)) });
  }).sort((left, right) => compare(`${left.action}:${left.kind}:${left.currency ?? "none"}`, `${right.action}:${right.kind}:${right.currency ?? "none"}`)));
  const reasonCodes = Object.freeze(conflictRefs.length > 0 ? ["unresolved_constraint_conflict"] : []);
  const hold = Object.freeze({ state: conflictRefs.length > 0 ? "held" as const : "clear" as const, reasonCodes, conflictRefs });
  const guideEvidence = Object.freeze(normalized.map((item) => Object.freeze({ guideRef: item.revision.guideRef,
    revision: item.revision.revision, revisionHash: item.revision.revisionHash, restrictionSetHash: item.restrictionSetHash })));
  const effectiveGuideSetHash = digest(guideEvidence);
  const authority = Object.freeze({ actionExecution: "none" as const, canApprove: false as const, canExecute: false as const,
    canWriteMeta: false as const, canGrantAutonomy: false as const });
  const core = { version: EFFECTIVE_GUIDE_OVERLAP_VERSION, workspaceRef, entityRef, market: input.market, effectiveMode,
    guideEvidence, effectiveGuideSetHash, actionAllowlist, deniedActions, recommendationActions, humanApprovalActions,
    autonomousActions, restrictions, numericCaps, hold, authority };
  return Object.freeze({ ...core, resolutionHash: digest(core) });
}
