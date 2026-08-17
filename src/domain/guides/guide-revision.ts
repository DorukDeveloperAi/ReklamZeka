import { createHash } from "node:crypto";

/** Pure, persistable Kılavuz contract. It intentionally contains no write capability. */
export const GUIDE_REVISION_VERSION = "guide-revision/1.0.0" as const;
export const GUIDE_MODES = Object.freeze(["observe_analyze", "recommend", "prepare_human_approval", "limited_autonomy"] as const);
export const GUIDE_ACTIONS = Object.freeze([
  "status_pause", "status_activate", "budget_decrease", "budget_increase", "campaign_rename", "adset_rename", "ad_rename",
] as const);

export type GuideMode = typeof GUIDE_MODES[number];
export type GuideAction = typeof GUIDE_ACTIONS[number];
export type GuideMarket = "yerli" | "yabanci";
export type GuideBudgetScope = "market" | "organization_campaign" | "geo_targeting_platform" | "campaign_ad_set";
export type GuideBudgetRef = Readonly<{ limitRef: string; scopeKind: GuideBudgetScope }>;
export type GuideSchedule =
  | Readonly<{ frequency: "daily"; timezone: string; localTime: string }>
  | Readonly<{ frequency: "weekly"; timezone: string; localTime: string; dayOfWeek: number }>
  | Readonly<{ frequency: "monthly"; timezone: string; localTime: string; dayOfMonth: number; monthEnd: "clamp" }>
  | Readonly<{ frequency: "custom_days"; timezone: string; localTime: string; intervalDays: number; anchorDate: string }>;

export type BudgetExpression =
  | Readonly<{ kind: "current_budget"; scope: "related_organization_campaign" | "canonical_budget_owner" }>
  | Readonly<{ kind: "money"; amountMinor: number; currency: "TRY" }>
  | Readonly<{ kind: "multiply"; operands: readonly [BudgetExpression, Readonly<{ kind: "decimal"; value: string }>] }>
  | Readonly<{ kind: "max" | "min"; operands: readonly [BudgetExpression, BudgetExpression] }>;

export type GuideBudgetInterpretationDraft = Readonly<{
  sourceText: string;
  expression: BudgetExpression | null;
  unresolvedRefs: readonly string[];
  currentExample: Readonly<{ ownerRef: string; amountMinor: number; currency: "TRY" }> | null;
  risks: readonly string[];
}>;
export type GuideBudgetInterpretation = Readonly<GuideBudgetInterpretationDraft & {
  state: "needs_input" | "ready_for_user_acceptance";
  canonicalExpression: string | null;
  reviewDiff: Readonly<{ sourceText: string; canonicalExpression: string | null }>;
  interpretationHash: string;
}>;

export type GuideRevisionDraft = Readonly<{
  workspaceRef: string;
  guideRef: string;
  revision: number;
  previousRevisionHash: string | null;
  sliceRef: string;
  market: GuideMarket;
  freeText: string;
  strict: Readonly<{ budgetRefs: readonly GuideBudgetRef[]; rollbackConditions: readonly string[]; budgetInterpretation: GuideBudgetInterpretation | null }>;
  schedule: GuideSchedule;
  mode: GuideMode;
  actionAllowlist: readonly GuideAction[];
}>;
export type GuideRevision = Readonly<GuideRevisionDraft & {
  schemaVersion: typeof GUIDE_REVISION_VERSION;
  authority: Readonly<{
    actionAuthority: "none" | "human_approval" | "limited_autonomy";
    autonomousActions: readonly GuideAction[];
    humanApprovalActions: readonly GuideAction[];
    renameRequiresHumanApproval: true;
    canWriteMeta: false;
    canActivateRevision: false;
  }>;
  /** Exact user-reviewed interpretation of the whole persisted revision, never optional. */
  interpretationHash: string;
  revisionHash: string;
}>;

export class GuideRevisionError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_schedule" | "invalid_interpretation") { super(code); this.name = "GuideRevisionError"; }
}
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function fail(code: GuideRevisionError["code"]): never { throw new GuideRevisionError(code); }
function exact(value: unknown, keys: readonly string[], code: GuideRevisionError["code"] = "invalid_input"): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
}
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])); return value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function text(value: unknown, maximum = 10_000, code: GuideRevisionError["code"] = "invalid_input"): string { if (typeof value !== "string") fail(code); const normalized = value.trim(); if (!normalized || normalized.length > maximum || CONTROL.test(normalized)) fail(code); return normalized; }
function ref(value: unknown, prefix: string, code: GuideRevisionError["code"] = "invalid_input"): string { const normalized = text(value, 159, code); if (!REF.test(normalized) || !normalized.startsWith(prefix)) fail(code); return normalized; }
/** Server-derived semantic reference; client input is never trusted as a workspace binding. */
export function canonicalGuideWorkspaceRef(workspaceId: string): string {
  if (typeof workspaceId !== "string" || !WORKSPACE_ID.test(workspaceId)) fail("invalid_input");
  return `workspace_${createHash("sha256").update(workspaceId).digest("hex").slice(0, 16)}`;
}
function refs(value: unknown, prefix: string, maximum: number, code: GuideRevisionError["code"] = "invalid_input"): readonly string[] { if (!Array.isArray(value) || value.length > maximum) fail(code); const normalized = value.map((item) => ref(item, prefix, code)).sort(); if (new Set(normalized).size !== normalized.length) fail(code); return Object.freeze(normalized); }
function budgetRefs(value: unknown): readonly GuideBudgetRef[] {
  if (!Array.isArray(value) || value.length > 64) fail("invalid_input");
  const normalized = value.map((item) => {
    exact(item, ["limitRef", "scopeKind"]);
    const scopeKind = (item as Record<string, unknown>).scopeKind;
    if (scopeKind !== "market" && scopeKind !== "organization_campaign" && scopeKind !== "geo_targeting_platform" && scopeKind !== "campaign_ad_set") fail("invalid_input");
    return Object.freeze({ limitRef: ref((item as Record<string, unknown>).limitRef, "limit_"), scopeKind });
  }).sort((a, b) => a.limitRef.localeCompare(b.limitRef));
  if (new Set(normalized.map((item) => item.limitRef)).size !== normalized.length) fail("invalid_input");
  return Object.freeze(normalized);
}
function strings(value: unknown, maximum: number, code: GuideRevisionError["code"] = "invalid_input"): readonly string[] { if (!Array.isArray(value) || value.length > maximum) fail(code); const normalized = value.map((item) => text(item, 500, code)).sort(); if (new Set(normalized).size !== normalized.length) fail(code); return Object.freeze(normalized); }
function timezone(value: unknown): string { const zone = text(value, 128, "invalid_schedule"); try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(0)); return zone; } catch { return fail("invalid_schedule"); } }
function localTime(value: unknown): string { if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fail("invalid_schedule"); return value; }
function validDate(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) fail("invalid_schedule");
  return value;
}

export function validateGuideSchedule(value: GuideSchedule): GuideSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_schedule");
  const candidate = value as Record<string, unknown>;
  const base = { timezone: timezone(candidate.timezone), localTime: localTime(candidate.localTime) };
  if (candidate.frequency === "daily") { exact(candidate, ["frequency", "timezone", "localTime"], "invalid_schedule"); return Object.freeze({ frequency: "daily" as const, ...base }); }
  if (candidate.frequency === "weekly") { exact(candidate, ["frequency", "timezone", "localTime", "dayOfWeek"], "invalid_schedule"); if (!Number.isInteger(candidate.dayOfWeek) || Number(candidate.dayOfWeek) < 0 || Number(candidate.dayOfWeek) > 6) fail("invalid_schedule"); return Object.freeze({ frequency: "weekly" as const, ...base, dayOfWeek: Number(candidate.dayOfWeek) }); }
  if (candidate.frequency === "monthly") { exact(candidate, ["frequency", "timezone", "localTime", "dayOfMonth", "monthEnd"], "invalid_schedule"); if (!Number.isInteger(candidate.dayOfMonth) || Number(candidate.dayOfMonth) < 1 || Number(candidate.dayOfMonth) > 31 || candidate.monthEnd !== "clamp") fail("invalid_schedule"); return Object.freeze({ frequency: "monthly" as const, ...base, dayOfMonth: Number(candidate.dayOfMonth), monthEnd: "clamp" as const }); }
  if (candidate.frequency === "custom_days") { exact(candidate, ["frequency", "timezone", "localTime", "intervalDays", "anchorDate"], "invalid_schedule"); if (!Number.isInteger(candidate.intervalDays) || Number(candidate.intervalDays) < 1 || Number(candidate.intervalDays) > 366) fail("invalid_schedule"); return Object.freeze({ frequency: "custom_days" as const, ...base, intervalDays: Number(candidate.intervalDays), anchorDate: validDate(candidate.anchorDate) }); }
  return fail("invalid_schedule");
}

function expression(value: unknown): BudgetExpression {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_interpretation"); const candidate = value as Record<string, unknown>;
  if (candidate.kind === "current_budget") { exact(candidate, ["kind", "scope"], "invalid_interpretation"); if (candidate.scope !== "related_organization_campaign" && candidate.scope !== "canonical_budget_owner") fail("invalid_interpretation"); return Object.freeze({ kind: "current_budget", scope: candidate.scope }); }
  if (candidate.kind === "money") { exact(candidate, ["kind", "amountMinor", "currency"], "invalid_interpretation"); if (!Number.isSafeInteger(candidate.amountMinor) || Number(candidate.amountMinor) < 0 || candidate.currency !== "TRY") fail("invalid_interpretation"); return Object.freeze({ kind: "money", amountMinor: Number(candidate.amountMinor), currency: "TRY" }); }
  if (candidate.kind === "multiply") { exact(candidate, ["kind", "operands"], "invalid_interpretation"); if (!Array.isArray(candidate.operands) || candidate.operands.length !== 2) fail("invalid_interpretation"); const base = expression(candidate.operands[0]); const decimal = candidate.operands[1]; if (!decimal || typeof decimal !== "object" || Array.isArray(decimal)) fail("invalid_interpretation"); exact(decimal, ["kind", "value"], "invalid_interpretation"); if ((decimal as { kind?: unknown }).kind !== "decimal" || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(String((decimal as { value?: unknown }).value))) fail("invalid_interpretation"); const operands: readonly [BudgetExpression, Readonly<{ kind: "decimal"; value: string }>] = [base, Object.freeze({ kind: "decimal" as const, value: String((decimal as { value: unknown }).value) })]; return Object.freeze({ kind: "multiply" as const, operands }); }
  if (candidate.kind === "max" || candidate.kind === "min") { exact(candidate, ["kind", "operands"], "invalid_interpretation"); if (!Array.isArray(candidate.operands) || candidate.operands.length !== 2) fail("invalid_interpretation"); const operands: readonly [BudgetExpression, BudgetExpression] = [expression(candidate.operands[0]), expression(candidate.operands[1])]; return Object.freeze({ kind: candidate.kind, operands }); }
  return fail("invalid_interpretation");
}
function renderExpression(value: BudgetExpression): string { if (value.kind === "current_budget") return `current_budget(${value.scope})`; if (value.kind === "money") return `money(${value.amountMinor},${value.currency})`; if (value.kind === "multiply") return `multiply(${renderExpression(value.operands[0])},${value.operands[1].value})`; return `${value.kind}(${renderExpression(value.operands[0])},${renderExpression(value.operands[1])})`; }
function needsBudget(value: BudgetExpression): boolean {
  if (value.kind === "current_budget") return true;
  if (value.kind === "multiply") return needsBudget(value.operands[0]);
  if (value.kind === "max" || value.kind === "min") return needsBudget(value.operands[0]) || needsBudget(value.operands[1]);
  return false;
}

export function interpretGuideBudget(value: GuideBudgetInterpretationDraft): GuideBudgetInterpretation {
  exact(value, ["sourceText", "expression", "unresolvedRefs", "currentExample", "risks"], "invalid_interpretation");
  const sourceText = text(value.sourceText, 10_000, "invalid_interpretation");
  const unresolvedRefs = strings(value.unresolvedRefs, 32, "invalid_interpretation"); const risks = strings(value.risks, 32, "invalid_interpretation");
  const parsed = value.expression === null ? null : expression(value.expression);
  let currentExample: GuideBudgetInterpretationDraft["currentExample"] = null;
  if (value.currentExample !== null) { exact(value.currentExample, ["ownerRef", "amountMinor", "currency"], "invalid_interpretation"); if (!Number.isSafeInteger(value.currentExample.amountMinor) || value.currentExample.amountMinor < 0 || value.currentExample.currency !== "TRY") fail("invalid_interpretation"); currentExample = Object.freeze({ ownerRef: ref(value.currentExample.ownerRef, "organization_campaign_", "invalid_interpretation"), amountMinor: value.currentExample.amountMinor, currency: "TRY" }); }
  if (parsed && needsBudget(parsed) && currentExample === null && !unresolvedRefs.includes("current_budget")) fail("invalid_interpretation");
  const state = parsed !== null && unresolvedRefs.length === 0 && (!needsBudget(parsed) || currentExample !== null) ? "ready_for_user_acceptance" as const : "needs_input" as const;
  const output = { sourceText, expression: parsed, unresolvedRefs, currentExample, risks, state, canonicalExpression: parsed ? renderExpression(parsed) : null, reviewDiff: Object.freeze({ sourceText, canonicalExpression: parsed ? renderExpression(parsed) : null }) };
  return Object.freeze({ ...output, interpretationHash: digest(output) });
}

export function guideAuthority(mode: GuideMode, actions: readonly GuideAction[]): GuideRevision["authority"] {
  const rename = actions.filter((action) => action.endsWith("_rename"));
  const autonomousActions = mode === "limited_autonomy" ? actions.filter((action) => !action.endsWith("_rename")) : [];
  const humanApprovalActions = mode === "prepare_human_approval" ? [...actions]
    : mode === "limited_autonomy" ? rename : [];
  const actionAuthority = autonomousActions.length > 0 ? "limited_autonomy"
    : humanApprovalActions.length > 0 ? "human_approval" : "none";
  return Object.freeze({ actionAuthority, autonomousActions: Object.freeze(autonomousActions),
    humanApprovalActions: Object.freeze(humanApprovalActions), renameRequiresHumanApproval: true,
    canWriteMeta: false, canActivateRevision: false });
}
export function createGuideRevision(value: GuideRevisionDraft): GuideRevision {
  exact(value, ["workspaceRef", "guideRef", "revision", "previousRevisionHash", "sliceRef", "market", "freeText", "strict", "schedule", "mode", "actionAllowlist"]);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 1_000_000 || (value.revision === 1 ? value.previousRevisionHash !== null : typeof value.previousRevisionHash !== "string" || !HASH.test(value.previousRevisionHash))) fail("invalid_input");
  if (value.market !== "yerli" && value.market !== "yabanci" || !GUIDE_MODES.includes(value.mode)) fail("invalid_input");
  if (!Array.isArray(value.actionAllowlist) || value.actionAllowlist.length > GUIDE_ACTIONS.length) fail("invalid_input"); const actions = [...value.actionAllowlist].sort(); if (new Set(actions).size !== actions.length || actions.some((action) => !GUIDE_ACTIONS.includes(action))) fail("invalid_input");
  if ((value.mode === "prepare_human_approval" || value.mode === "limited_autonomy") && actions.length === 0) fail("invalid_input");
  exact(value.strict, ["budgetRefs", "rollbackConditions", "budgetInterpretation"]);
  const budgetInterpretation = value.strict.budgetInterpretation === null ? null : interpretGuideBudget({
    sourceText: value.strict.budgetInterpretation.sourceText,
    expression: value.strict.budgetInterpretation.expression,
    unresolvedRefs: value.strict.budgetInterpretation.unresolvedRefs,
    currentExample: value.strict.budgetInterpretation.currentExample,
    risks: value.strict.budgetInterpretation.risks,
  });
  const normalized: GuideRevisionDraft = Object.freeze({ workspaceRef: ref(value.workspaceRef, "workspace_"), guideRef: ref(value.guideRef, "guide_"), revision: value.revision, previousRevisionHash: value.previousRevisionHash, sliceRef: ref(value.sliceRef, "slice_"), market: value.market, freeText: text(value.freeText), strict: Object.freeze({ budgetRefs: budgetRefs(value.strict.budgetRefs), rollbackConditions: strings(value.strict.rollbackConditions, 64), budgetInterpretation }), schedule: validateGuideSchedule(value.schedule), mode: value.mode, actionAllowlist: Object.freeze(actions) });
  const authority = guideAuthority(normalized.mode, normalized.actionAllowlist);
  const interpretationHash = digest({ sliceRef: normalized.sliceRef, market: normalized.market, freeText: normalized.freeText, strict: normalized.strict, schedule: normalized.schedule, mode: normalized.mode, actionAllowlist: normalized.actionAllowlist });
  return Object.freeze({ ...normalized, schemaVersion: GUIDE_REVISION_VERSION, authority, interpretationHash, revisionHash: digest({ ...normalized, schemaVersion: GUIDE_REVISION_VERSION, authority, interpretationHash }) });
}

type Local = Readonly<{ year: number; month: number; day: number; hour: number; minute: number }>;
const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(instant: Date, zone: string): Local { let f = formatters.get(zone); if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); formatters.set(zone, f); } const p = Object.fromEntries(f.formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])); return p as Local; }
function localDate(p: Local): string { return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }
function addDays(date: string, n: number): string { const [y, m, d] = date.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function resolveLocal(date: string, time: string, zone: string): Date { const [y,m,d] = date.split("-").map(Number) as [number, number, number]; const [h,min] = time.split(":").map(Number) as [number, number]; const approx = Date.UTC(y, m - 1, d, h, min); const candidates: number[] = []; const later: number[] = []; for (let candidate = approx - 18 * 3_600_000; candidate <= approx + 18 * 3_600_000; candidate += 60_000) { const parts = localParts(new Date(candidate), zone); if (localDate(parts) !== date) continue; if (parts.hour === h && parts.minute === min) candidates.push(candidate); else if (parts.hour * 60 + parts.minute > h * 60 + min) later.push(candidate); } if (candidates.length) return new Date(Math.min(...candidates)); if (later.length) return new Date(Math.min(...later)); fail("invalid_schedule"); }
function scheduleMatches(schedule: GuideSchedule, date: string): boolean { const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay(); if (schedule.frequency === "daily") return true; if (schedule.frequency === "weekly") return weekday === schedule.dayOfWeek; if (schedule.frequency === "monthly") { const [y,m] = date.split("-").map(Number) as [number, number]; return Number(date.slice(8)) === Math.min(schedule.dayOfMonth, daysInMonth(y,m)); } const distance = Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${schedule.anchorDate}T00:00:00.000Z`)) / 86_400_000); return distance >= 0 && distance % schedule.intervalDays === 0; }
/** Manual runs intentionally have no cursor: callers use this only for scheduled slots. */
export function nextGuideScheduledAt(scheduleInput: GuideSchedule, after: string): string {
  const schedule = validateGuideSchedule(scheduleInput); const at = new Date(after); if (!Number.isFinite(at.getTime())) fail("invalid_schedule"); const start = localDate(localParts(at, schedule.timezone)); for (let i = 0; i <= 800; i += 1) { const date = addDays(start, i); if (!scheduleMatches(schedule, date)) continue; const candidate = resolveLocal(date, schedule.localTime, schedule.timezone); if (candidate > at) return candidate.toISOString(); } return fail("invalid_schedule");
}
