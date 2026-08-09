import { createHash } from "node:crypto";

export const STRICT_INSTRUCTION_POLICY_DSL_VERSION = "strict-instruction-policy/1.0.0" as const;
export const RAW_INSTRUCTION_PROVENANCE_VERSION = "raw-instruction-provenance/1.0.0" as const;

export type InstructionPolicyType =
  | "hard_constraint"
  | "target"
  | "preference"
  | "exception"
  | "prohibition"
  | "approval"
  | "schedule";
export type InstructionPolicyStatus = "draft" | "published" | "paused" | "archived";
export type InstructionPolicyOwnerRole = "owner" | "admin" | "analyst";
export type InstructionPolicyOperation =
  | "status_pause"
  | "status_activate"
  | "budget_decrease"
  | "budget_increase"
  | "budget_transfer"
  | "existing_post_promotion";

export type InstructionPolicyWindow = Readonly<{
  kind: "rolling" | "calendar";
  duration: number;
  unit: "hour" | "day" | "week" | "month";
  timezone: string;
}>;

export type InstructionPolicyScope = Readonly<{
  global: boolean;
  accountGroupRefs: readonly string[];
  accountRefs: readonly string[];
  objectiveRefs: readonly string[];
  internalCategoryRefs: readonly string[];
  entities: readonly Readonly<{ level: "campaign" | "adset" | "ad" | "creative"; ref: string }>[];
  topicRefs: readonly string[];
}>;

export type HardConstraintClause = Readonly<{
  kind: "hard_constraint";
  constraint:
    | Readonly<{
      kind: "metric_bound";
      metricRef: string;
      operator: "gte" | "lte" | "eq";
      valueDecimal: string;
      unit: string;
      window: InstructionPolicyWindow;
    }>
    | Readonly<{
      kind: "allocation_bound";
      budgetPoolRef: string;
      mode: "floor" | "cap" | "fixed";
      valueDecimal: string;
      currency: string;
      window: InstructionPolicyWindow;
    }>
    | Readonly<{
      kind: "budget_protection";
      budgetPoolRefs: readonly string[];
      behavior: "fixed" | "no_outflow" | "no_transfer";
    }>;
}>;

export type TargetClause = Readonly<{
  kind: "target";
  metricRef: string;
  targetDecimal: string;
  unit: string;
  window: InstructionPolicyWindow;
  toleranceBasisPoints: number;
}>;

export type PreferenceClause = Readonly<{
  kind: "preference";
  subjectRef: string;
  preferredRefs: readonly string[];
  weightBasisPoints: number;
}>;

export type ExceptionClause = Readonly<{
  kind: "exception";
  policyRefs: readonly string[];
  effect: "suppress";
  justificationReasonCode: string;
}>;

export type ProhibitionClause = Readonly<{
  kind: "prohibition";
  operations: readonly InstructionPolicyOperation[];
}>;

export type ApprovalClause = Readonly<{
  kind: "approval";
  operations: readonly InstructionPolicyOperation[];
  requiredRoles: readonly ("owner" | "admin")[];
  minimumApprovals: number;
  threshold: Readonly<{ currency: string; amountDecimal: string }> | null;
}>;

export type ScheduleClause = Readonly<{
  kind: "schedule";
  routineRef: string;
  cadence: Readonly<{
    frequency: "hourly" | "daily" | "weekly" | "monthly";
    interval: number;
    atLocalTime: string | null;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    timezone: string;
  }>;
  misfirePolicy: "skip" | "run_once";
}>;

export type StrictInstructionPolicyClause =
  | HardConstraintClause
  | TargetClause
  | PreferenceClause
  | ExceptionClause
  | ProhibitionClause
  | ApprovalClause
  | ScheduleClause;

export type StrictInstructionPolicyInput = Readonly<{
  dslVersion: typeof STRICT_INSTRUCTION_POLICY_DSL_VERSION;
  workspaceRef: string;
  policyRef: string;
  policyVersion: number;
  previousVersionHash: string | null;
  policyType: InstructionPolicyType;
  owner: Readonly<{ actorRef: string; role: InstructionPolicyOwnerRole }>;
  status: InstructionPolicyStatus;
  reasonCode: string;
  priority: number;
  effectiveDates: Readonly<{ from: string; until: string | null }>;
  scope: InstructionPolicyScope;
  source: Readonly<{
    rawProvenanceRef: string;
    rawTextHash: string;
    promotedFromGuidanceRefs: readonly string[];
  }>;
  clause: StrictInstructionPolicyClause;
}>;

export type StrictInstructionPolicy = Readonly<StrictInstructionPolicyInput & {
  authority: Readonly<{
    canExecute: false;
    canWriteMeta: false;
    canApprove: false;
    canSchedule: false;
    canCallTool: false;
    canAccessNetwork: false;
    canQuerySql: false;
  }>;
  canonicalHash: string;
}>;

export type RawInstructionProvenanceInput = Readonly<{
  version: typeof RAW_INSTRUCTION_PROVENANCE_VERSION;
  workspaceRef: string;
  provenanceRef: string;
  capturedAt: string;
  capturedByRef: string;
  rawText: string;
}>;

export type RawInstructionProvenance = Readonly<RawInstructionProvenanceInput & {
  rawTextHash: string;
  authority: Readonly<{
    canCreatePolicy: false;
    canExecute: false;
    canWriteMeta: false;
    canCallTool: false;
  }>;
}>;

export class InstructionPolicyDslError extends Error {
  constructor(readonly code:
    | "invalid_json"
    | "invalid_contract"
    | "unsupported_version"
    | "type_clause_mismatch"
    | "invalid_hash") {
    super("Talimat politikası strict DSL sözleşmesine uymuyor");
    this.name = "InstructionPolicyDslError";
  }
}

const POLICY_KEYS = ["dslVersion", "workspaceRef", "policyRef", "policyVersion", "previousVersionHash", "policyType",
  "owner", "status", "reasonCode", "priority", "effectiveDates", "scope", "source", "clause"] as const;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const REASON = /^[a-z][a-z0-9_]{1,63}$/;
const UNIT = /^[A-Za-z][A-Za-z0-9_%.-]{0,31}$/;
const CURRENCY = /^[A-Z]{3}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,8})?$/;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const POLICY_TYPES = new Set<InstructionPolicyType>([
  "hard_constraint", "target", "preference", "exception", "prohibition", "approval", "schedule",
]);
const STATUSES = new Set<InstructionPolicyStatus>(["draft", "published", "paused", "archived"]);
const OPERATIONS = new Set<InstructionPolicyOperation>([
  "status_pause", "status_activate", "budget_decrease", "budget_increase", "budget_transfer", "existing_post_promotion",
]);
const AUTHORITY = Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canApprove: false as const,
  canSchedule: false as const, canCallTool: false as const, canAccessNetwork: false as const, canQuerySql: false as const });
const RAW_AUTHORITY = Object.freeze({ canCreatePolicy: false as const, canExecute: false as const,
  canWriteMeta: false as const, canCallTool: false as const });

function fail(code: InstructionPolicyDslError["code"] = "invalid_contract"): never {
  throw new InstructionPolicyDslError(code);
}

function decode(value: unknown, maximumCharacters: number): unknown {
  if (typeof value !== "string") return value;
  if (value.length === 0 || value.length > maximumCharacters) fail("invalid_json");
  try { return JSON.parse(value) as unknown; } catch { return fail("invalid_json"); }
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail();
}

function reference(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || value.includes("*") || value.includes("://")) fail();
  return value;
}

function reason(value: unknown): string {
  if (typeof value !== "string" || !REASON.test(value)) fail();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail("invalid_hash");
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail();
  return value as number;
}

function decimal(value: unknown): string {
  if (typeof value !== "string" || !DECIMAL.test(value) || !Number.isFinite(Number(value))) fail();
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return value;
}

function timezone(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) fail();
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); } catch { return fail(); }
  return value;
}

function uniqueRefs(value: unknown, allowEmpty = true): readonly string[] {
  if (!Array.isArray(value) || value.length > 100 || (!allowEmpty && value.length === 0)) fail();
  const normalized = value.map(reference).sort();
  if (new Set(normalized).size !== normalized.length) fail();
  return Object.freeze(normalized);
}

function uniqueEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, maximum: number): readonly T[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum
    || value.some((entry) => typeof entry !== "string" || !allowed.has(entry as T))) fail();
  const normalized = [...value as T[]].sort();
  if (new Set(normalized).size !== normalized.length) fail();
  return Object.freeze(normalized);
}

function normalizeWindow(value: unknown): InstructionPolicyWindow {
  exact(value, ["kind", "duration", "unit", "timezone"]);
  if (value.kind !== "rolling" && value.kind !== "calendar") fail();
  if (!["hour", "day", "week", "month"].includes(value.unit as string)) fail();
  return freeze({ kind: value.kind, duration: integer(value.duration, 1, 366),
    unit: value.unit as InstructionPolicyWindow["unit"], timezone: timezone(value.timezone) });
}

function normalizeScope(value: unknown): InstructionPolicyScope {
  exact(value, ["global", "accountGroupRefs", "accountRefs", "objectiveRefs", "internalCategoryRefs", "entities", "topicRefs"]);
  if (typeof value.global !== "boolean" || !Array.isArray(value.entities) || value.entities.length > 100) fail();
  const entities = value.entities.map((entry) => {
    exact(entry, ["level", "ref"]);
    if (!["campaign", "adset", "ad", "creative"].includes(entry.level as string)) fail();
    return Object.freeze({ level: entry.level as "campaign" | "adset" | "ad" | "creative", ref: reference(entry.ref) });
  }).sort((left, right) => left.level.localeCompare(right.level) || left.ref.localeCompare(right.ref));
  if (new Set(entities.map((entry) => `${entry.level}:${entry.ref}`)).size !== entities.length) fail();
  const scope = freeze({ global: value.global, accountGroupRefs: uniqueRefs(value.accountGroupRefs),
    accountRefs: uniqueRefs(value.accountRefs), objectiveRefs: uniqueRefs(value.objectiveRefs),
    internalCategoryRefs: uniqueRefs(value.internalCategoryRefs), entities: Object.freeze(entities),
    topicRefs: uniqueRefs(value.topicRefs) });
  const scopedCount = scope.accountGroupRefs.length + scope.accountRefs.length + scope.objectiveRefs.length
    + scope.internalCategoryRefs.length + scope.entities.length + scope.topicRefs.length;
  if (scope.global ? scopedCount !== 0 : scopedCount === 0) fail();
  return scope;
}

function normalizeMetric(value: Record<string, unknown>) {
  if (typeof value.unit !== "string" || !UNIT.test(value.unit)) fail();
  return { metricRef: reference(value.metricRef), unit: value.unit, window: normalizeWindow(value.window) };
}

function normalizeHardConstraint(value: Record<string, unknown>): HardConstraintClause {
  exact(value, ["kind", "constraint"]);
  exact(value.constraint, value.constraint && typeof value.constraint === "object" && "kind" in value.constraint
    && (value.constraint as Record<string, unknown>).kind === "budget_protection"
    ? ["kind", "budgetPoolRefs", "behavior"]
    : value.constraint && typeof value.constraint === "object" && "kind" in value.constraint
      && (value.constraint as Record<string, unknown>).kind === "allocation_bound"
      ? ["kind", "budgetPoolRef", "mode", "valueDecimal", "currency", "window"]
      : ["kind", "metricRef", "operator", "valueDecimal", "unit", "window"]);
  const constraint = value.constraint;
  if (constraint.kind === "metric_bound") {
    if (!["gte", "lte", "eq"].includes(constraint.operator as string)) fail();
    return freeze({ kind: "hard_constraint", constraint: { kind: "metric_bound",
      ...normalizeMetric(constraint), operator: constraint.operator as "gte" | "lte" | "eq",
      valueDecimal: decimal(constraint.valueDecimal) } });
  }
  if (constraint.kind === "allocation_bound") {
    if (!["floor", "cap", "fixed"].includes(constraint.mode as string)
      || typeof constraint.currency !== "string" || !CURRENCY.test(constraint.currency)) fail();
    return freeze({ kind: "hard_constraint", constraint: { kind: "allocation_bound",
      budgetPoolRef: reference(constraint.budgetPoolRef), mode: constraint.mode as "floor" | "cap" | "fixed",
      valueDecimal: decimal(constraint.valueDecimal), currency: constraint.currency,
      window: normalizeWindow(constraint.window) } });
  }
  if (constraint.kind === "budget_protection") {
    if (!["fixed", "no_outflow", "no_transfer"].includes(constraint.behavior as string)) fail();
    return freeze({ kind: "hard_constraint", constraint: { kind: "budget_protection",
      budgetPoolRefs: uniqueRefs(constraint.budgetPoolRefs, false),
      behavior: constraint.behavior as "fixed" | "no_outflow" | "no_transfer" } });
  }
  return fail();
}

function normalizeClause(value: unknown): StrictInstructionPolicyClause {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const clause = value as Record<string, unknown>;
  if (clause.kind === "hard_constraint") return normalizeHardConstraint(clause);
  if (clause.kind === "target") {
    exact(clause, ["kind", "metricRef", "targetDecimal", "unit", "window", "toleranceBasisPoints"]);
    return freeze({ kind: "target", ...normalizeMetric(clause), targetDecimal: decimal(clause.targetDecimal),
      toleranceBasisPoints: integer(clause.toleranceBasisPoints, 0, 10_000) });
  }
  if (clause.kind === "preference") {
    exact(clause, ["kind", "subjectRef", "preferredRefs", "weightBasisPoints"]);
    return freeze({ kind: "preference", subjectRef: reference(clause.subjectRef),
      preferredRefs: uniqueRefs(clause.preferredRefs, false), weightBasisPoints: integer(clause.weightBasisPoints, 1, 10_000) });
  }
  if (clause.kind === "exception") {
    exact(clause, ["kind", "policyRefs", "effect", "justificationReasonCode"]);
    if (clause.effect !== "suppress") fail();
    return freeze({ kind: "exception", policyRefs: uniqueRefs(clause.policyRefs, false), effect: "suppress",
      justificationReasonCode: reason(clause.justificationReasonCode) });
  }
  if (clause.kind === "prohibition") {
    exact(clause, ["kind", "operations"]);
    return freeze({ kind: "prohibition", operations: uniqueEnum(clause.operations, OPERATIONS, OPERATIONS.size) });
  }
  if (clause.kind === "approval") {
    exact(clause, ["kind", "operations", "requiredRoles", "minimumApprovals", "threshold"]);
    const requiredRoles = uniqueEnum(clause.requiredRoles, new Set(["owner", "admin"] as const), 2);
    const minimumApprovals = integer(clause.minimumApprovals, 1, 2);
    if (minimumApprovals > requiredRoles.length) fail();
    let threshold: ApprovalClause["threshold"] = null;
    if (clause.threshold !== null) {
      exact(clause.threshold, ["currency", "amountDecimal"]);
      if (typeof clause.threshold.currency !== "string" || !CURRENCY.test(clause.threshold.currency)) fail();
      threshold = Object.freeze({ currency: clause.threshold.currency, amountDecimal: decimal(clause.threshold.amountDecimal) });
    }
    return freeze({ kind: "approval", operations: uniqueEnum(clause.operations, OPERATIONS, OPERATIONS.size),
      requiredRoles, minimumApprovals, threshold });
  }
  if (clause.kind === "schedule") {
    exact(clause, ["kind", "routineRef", "cadence", "misfirePolicy"]);
    exact(clause.cadence, ["frequency", "interval", "atLocalTime", "dayOfWeek", "dayOfMonth", "timezone"]);
    const cadence = clause.cadence;
    if (!["hourly", "daily", "weekly", "monthly"].includes(cadence.frequency as string)
      || !["skip", "run_once"].includes(clause.misfirePolicy as string)) fail();
    const frequency = cadence.frequency as ScheduleClause["cadence"]["frequency"];
    const atLocalTime = cadence.atLocalTime;
    if (atLocalTime !== null && (typeof atLocalTime !== "string" || !CLOCK.test(atLocalTime))) fail();
    const dayOfWeek = cadence.dayOfWeek === null ? null : integer(cadence.dayOfWeek, 1, 7);
    const dayOfMonth = cadence.dayOfMonth === null ? null : integer(cadence.dayOfMonth, 1, 28);
    if (frequency === "hourly" ? atLocalTime !== null || dayOfWeek !== null || dayOfMonth !== null
      : frequency === "daily" ? atLocalTime === null || dayOfWeek !== null || dayOfMonth !== null
        : frequency === "weekly" ? atLocalTime === null || dayOfWeek === null || dayOfMonth !== null
          : atLocalTime === null || dayOfWeek !== null || dayOfMonth === null) fail();
    return freeze({ kind: "schedule", routineRef: reference(clause.routineRef), cadence: {
      frequency, interval: integer(cadence.interval, 1, 365), atLocalTime, dayOfWeek, dayOfMonth,
      timezone: timezone(cadence.timezone) }, misfirePolicy: clause.misfirePolicy as "skip" | "run_once" });
  }
  return fail();
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

function digestText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export function parseRawInstructionProvenance(value: unknown): RawInstructionProvenance {
  const decoded = decode(value, 20_000);
  exact(decoded, ["version", "workspaceRef", "provenanceRef", "capturedAt", "capturedByRef", "rawText"]);
  if (decoded.version !== RAW_INSTRUCTION_PROVENANCE_VERSION) fail("unsupported_version");
  if (typeof decoded.rawText !== "string" || decoded.rawText.length === 0 || decoded.rawText.length > 16_000
    || decoded.rawText.trim().length === 0 || decoded.rawText.includes("\u0000")) fail();
  return freeze({ version: RAW_INSTRUCTION_PROVENANCE_VERSION, workspaceRef: reference(decoded.workspaceRef),
    provenanceRef: reference(decoded.provenanceRef), capturedAt: instant(decoded.capturedAt),
    capturedByRef: reference(decoded.capturedByRef), rawText: decoded.rawText,
    rawTextHash: digestText(decoded.rawText), authority: RAW_AUTHORITY });
}

export function parseStrictInstructionPolicy(value: unknown): StrictInstructionPolicy {
  const decoded = decode(value, 32_000);
  exact(decoded, POLICY_KEYS);
  if (decoded.dslVersion !== STRICT_INSTRUCTION_POLICY_DSL_VERSION) fail("unsupported_version");
  if (!POLICY_TYPES.has(decoded.policyType as InstructionPolicyType) || !STATUSES.has(decoded.status as InstructionPolicyStatus)) fail();
  exact(decoded.owner, ["actorRef", "role"]);
  if (!["owner", "admin", "analyst"].includes(decoded.owner.role as string)) fail();
  exact(decoded.effectiveDates, ["from", "until"]);
  const from = instant(decoded.effectiveDates.from);
  const until = decoded.effectiveDates.until === null ? null : instant(decoded.effectiveDates.until);
  if (until !== null && until <= from) fail();
  exact(decoded.source, ["rawProvenanceRef", "rawTextHash", "promotedFromGuidanceRefs"]);
  const policyVersion = integer(decoded.policyVersion, 1, 1_000_000);
  const previousVersionHash = decoded.previousVersionHash === null ? null : hash(decoded.previousVersionHash);
  if (policyVersion === 1 ? previousVersionHash !== null : previousVersionHash === null) fail();
  const clause = normalizeClause(decoded.clause);
  if (decoded.policyType !== clause.kind) fail("type_clause_mismatch");
  const core: StrictInstructionPolicyInput = freeze({
    dslVersion: STRICT_INSTRUCTION_POLICY_DSL_VERSION,
    workspaceRef: reference(decoded.workspaceRef), policyRef: reference(decoded.policyRef), policyVersion, previousVersionHash,
    policyType: decoded.policyType as InstructionPolicyType,
    owner: { actorRef: reference(decoded.owner.actorRef), role: decoded.owner.role as InstructionPolicyOwnerRole },
    status: decoded.status as InstructionPolicyStatus, reasonCode: reason(decoded.reasonCode),
    priority: integer(decoded.priority, 0, 1_000), effectiveDates: { from, until },
    scope: normalizeScope(decoded.scope), source: { rawProvenanceRef: reference(decoded.source.rawProvenanceRef),
      rawTextHash: hash(decoded.source.rawTextHash), promotedFromGuidanceRefs: uniqueRefs(decoded.source.promotedFromGuidanceRefs) },
    clause,
  });
  const artifact = freeze({ ...core, authority: AUTHORITY });
  return freeze({ ...artifact, canonicalHash: digest(artifact) });
}

export function assertStrictInstructionPolicyArtifact(value: unknown): StrictInstructionPolicy {
  exact(value, [...POLICY_KEYS, "authority", "canonicalHash"]);
  exact(value.authority, ["canExecute", "canWriteMeta", "canApprove", "canSchedule", "canCallTool", "canAccessNetwork", "canQuerySql"]);
  if (Object.values(value.authority).some((capability) => capability !== false)) fail();
  const parsed = parseStrictInstructionPolicy(Object.fromEntries(POLICY_KEYS.map((key) => [key, value[key]])));
  if (hash(value.canonicalHash) !== parsed.canonicalHash) fail("invalid_hash");
  return parsed;
}
