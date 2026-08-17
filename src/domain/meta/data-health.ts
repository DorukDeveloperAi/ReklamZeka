import { createHash } from "node:crypto";

import { publicSource, type PublicSource } from "@/domain/source/public-source";

export const META_DATA_HEALTH_VERSION = "meta-data-health/1.0.0" as const;
/** One workspace-level currency issue plus at most six current account issues. */
export const META_DATA_HEALTH_MAX_ACCOUNTS = 250;
export const META_DATA_HEALTH_MAX_OBSERVATIONS_PER_ACCOUNT = 6;
export const META_DATA_HEALTH_MAX_WORKSPACE_OBSERVATIONS = 1;
export const META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS = META_DATA_HEALTH_MAX_WORKSPACE_OBSERVATIONS
  + META_DATA_HEALTH_MAX_ACCOUNTS * META_DATA_HEALTH_MAX_OBSERVATIONS_PER_ACCOUNT;
/**
 * History retains distinct fingerprints after source state changes. Each
 * account can accumulate 19 finding fingerprints (15 source-state variants,
 * required dates/fields, and two currency variants) plus one workspace issue.
 */
export const META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS = 1 + META_DATA_HEALTH_MAX_ACCOUNTS * 19;
export const META_DATA_HEALTH_MAX_PROJECTED_EVENTS = META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS
  + META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS;
/** @deprecated Use CURRENT/RETAINED constants to avoid conflating the two. */
export const META_DATA_HEALTH_MAX_OBSERVATIONS = META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS;

export type MetaDataHealthIssueCode =
  | "source_partial"
  | "source_stale"
  | "source_empty"
  | "source_unavailable"
  | "source_demo"
  | "required_dates_missing"
  | "required_fields_missing"
  | "workspace_currency_unknown"
  | "account_currency_unknown"
  | "account_currency_mismatch";

export type MetaDataHealthAccountEvidence = Readonly<{
  accountRef: string;
  currency: string | null;
  sources: Readonly<{
    mirror: PublicSource;
    performance: PublicSource;
    trust: PublicSource;
  }>;
  requiredDates: readonly string[];
  observedDates: readonly string[];
  requiredFields: readonly string[];
  observedFields: readonly string[];
}>;

export type MetaDataHealthObservation = Readonly<{
  fingerprint: string;
  accountRef: string | null;
  code: MetaDataHealthIssueCode;
  sourceKind: PublicSource["kind"] | null;
  expectedDates: readonly string[];
  observedDates: readonly string[];
  missingDates: readonly string[];
  missingFields: readonly string[];
  expectedCurrency: string | null;
  observedCurrency: string | null;
  evidenceHash: string;
  finding: Readonly<{ kind: "data_quality"; lifecycle: "open" }>;
  developmentLog: Readonly<{ category: "data"; state: "proposed" }>;
}>;

export type MetaDataHealthReport = Readonly<{
  version: typeof META_DATA_HEALTH_VERSION;
  workspaceRef: string;
  evaluatedAt: string;
  state: "ready" | "partial" | "empty" | "unavailable";
  workspaceCurrency: string | null;
  accounts: readonly Readonly<{
    accountRef: string;
    state: "ready" | "partial" | "empty" | "unavailable";
    currency: string | null;
    monetaryAggregationIncluded: boolean;
    reasonCodes: readonly MetaDataHealthIssueCode[];
    missingDates: readonly string[];
    missingFields: readonly string[];
  }>[];
  monetaryAggregationAccountRefs: readonly string[];
  excludedMonetaryAccountRefs: readonly string[];
  observations: readonly MetaDataHealthObservation[];
  gate: Readonly<{
    analysisMayRecord: true;
    actionStagingAllowed: boolean;
    actionDispatchDataHealthReady: boolean;
    reasonCodes: readonly MetaDataHealthIssueCode[];
  }>;
  reportHash: string;
}>;

export class MetaDataHealthError extends Error {
  constructor(readonly code: "invalid_input" | "duplicate_account" | "source_mismatch") {
    super(`Meta data health rejected: ${code}`);
    this.name = "MetaDataHealthError";
  }
}

const ACCOUNT_REF = /^account_[a-f0-9]{24}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD = /^[a-z][a-z0-9_.:-]{0,127}$/;
const SOURCE_KINDS = Object.freeze({
  mirror: "canonical_meta_mirror",
  performance: "canonical_performance",
  trust: "derived_trust",
} as const);

function fail(code: MetaDataHealthError["code"]): never { throw new MetaDataHealthError(code); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compare(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  const normalized = new Date(value).toISOString();
  if (normalized !== value) fail("invalid_input");
  return normalized;
}
function exact(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function normalizedSet(values: unknown, pattern: RegExp, maximum: number): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum || values.some((value) => typeof value !== "string" || !pattern.test(value))) {
    fail("invalid_input");
  }
  const result = [...values].sort(compare);
  if (new Set(result).size !== result.length) fail("invalid_input");
  return Object.freeze(result);
}
function canonicalSource(value: PublicSource, expectedKind: PublicSource["kind"]): PublicSource {
  exact(value, ["contractVersion", "kind", "state", "observedAt", "freshnessAt", "freshnessThresholdMinutes", "reasonCodes"]);
  if (value.kind !== expectedKind) fail("source_mismatch");
  try {
    const rebuilt = publicSource({ kind: value.kind, state: value.state, observedAt: value.observedAt,
      freshnessAt: value.freshnessAt, freshnessThresholdMinutes: value.freshnessThresholdMinutes,
      reasonCodes: value.reasonCodes });
    if (digest(rebuilt) !== digest(value)) fail("invalid_input");
    return rebuilt;
  } catch (error) {
    if (error instanceof MetaDataHealthError) throw error;
    return fail("invalid_input");
  }
}

type AccountWork = {
  accountRef: string;
  currency: string | null;
  state: "ready" | "partial" | "empty" | "unavailable";
  monetaryAggregationIncluded: boolean;
  reasonCodes: MetaDataHealthIssueCode[];
  missingDates: readonly string[];
  missingFields: readonly string[];
};

function sourceIssue(state: PublicSource["state"]): MetaDataHealthIssueCode | null {
  if (state === "partial") return "source_partial";
  if (state === "stale") return "source_stale";
  if (state === "empty") return "source_empty";
  if (state === "unavailable") return "source_unavailable";
  if (state === "demo") return "source_demo";
  return null;
}

function accountState(sources: readonly PublicSource[], missingDates: readonly string[], missingFields: readonly string[]): AccountWork["state"] {
  if (sources.some((source) => source.state === "unavailable" || source.state === "demo")) return "unavailable";
  if (sources.some((source) => source.state === "empty")) return "empty";
  if (sources.some((source) => source.state === "partial" || source.state === "stale")
    || missingDates.length > 0 || missingFields.length > 0) return "partial";
  return "ready";
}

function observation(input: Readonly<{
  workspaceRef: string;
  accountRef: string | null;
  code: MetaDataHealthIssueCode;
  sourceKind: PublicSource["kind"] | null;
  expectedDates?: readonly string[];
  observedDates?: readonly string[];
  missingDates?: readonly string[];
  missingFields?: readonly string[];
  expectedCurrency?: string | null;
  observedCurrency?: string | null;
}>): MetaDataHealthObservation {
  const evidence = Object.freeze({ version: META_DATA_HEALTH_VERSION, accountRef: input.accountRef, code: input.code,
    sourceKind: input.sourceKind, expectedDates: input.expectedDates ?? [], observedDates: input.observedDates ?? [],
    missingDates: input.missingDates ?? [], missingFields: input.missingFields ?? [],
    expectedCurrency: input.expectedCurrency ?? null, observedCurrency: input.observedCurrency ?? null });
  const fingerprint = `data_quality_${digest({ namespace: "meta-data-health-issue/1.0.0", workspaceRef: input.workspaceRef,
    accountRef: input.accountRef, code: input.code, sourceKind: input.sourceKind }).slice(0, 32)}`;
  return Object.freeze({ fingerprint, accountRef: input.accountRef, code: input.code, sourceKind: input.sourceKind,
    expectedDates: Object.freeze([...(input.expectedDates ?? [])]), observedDates: Object.freeze([...(input.observedDates ?? [])]),
    missingDates: Object.freeze([...(input.missingDates ?? [])]), missingFields: Object.freeze([...(input.missingFields ?? [])]),
    expectedCurrency: input.expectedCurrency ?? null, observedCurrency: input.observedCurrency ?? null,
    evidenceHash: digest(evidence), finding: Object.freeze({ kind: "data_quality", lifecycle: "open" }),
    developmentLog: Object.freeze({ category: "data", state: "proposed" }) });
}

/**
 * Produces one canonical health decision without suppressing analysis. Persistent
 * finding/Development Log adapters can upsert observations by `fingerprint`.
 */
export function buildMetaDataHealthReport(input: Readonly<{
  workspaceRef: string;
  workspaceCurrency: string | null;
  evaluatedAt: string;
  accounts: readonly MetaDataHealthAccountEvidence[];
}>): MetaDataHealthReport {
  exact(input, ["workspaceRef", "workspaceCurrency", "evaluatedAt", "accounts"]);
  if (!/^workspace_[a-f0-9]{24}$/.test(input.workspaceRef)
    || input.workspaceCurrency !== null && !CURRENCY.test(input.workspaceCurrency)
    || !Array.isArray(input.accounts) || input.accounts.length > META_DATA_HEALTH_MAX_ACCOUNTS) fail("invalid_input");
  const evaluatedAt = instant(input.evaluatedAt);
  const accountRefs = input.accounts.map((account) => account.accountRef);
  if (new Set(accountRefs).size !== accountRefs.length) fail("duplicate_account");

  const observations: MetaDataHealthObservation[] = [];
  if (input.workspaceCurrency === null) observations.push(observation({ workspaceRef: input.workspaceRef,
    accountRef: null, code: "workspace_currency_unknown", sourceKind: null }));
  const accounts: AccountWork[] = [];
  for (const account of input.accounts) {
    exact(account, ["accountRef", "currency", "sources", "requiredDates", "observedDates", "requiredFields", "observedFields"]);
    if (!ACCOUNT_REF.test(account.accountRef) || account.currency !== null && !CURRENCY.test(account.currency)) fail("invalid_input");
    exact(account.sources, ["mirror", "performance", "trust"]);
    const sources = (["mirror", "performance", "trust"] as const).map((key) => canonicalSource(account.sources[key], SOURCE_KINDS[key]));
    const requiredDates = normalizedSet(account.requiredDates, DATE, 366);
    const observedDates = normalizedSet(account.observedDates, DATE, 366);
    const requiredFields = normalizedSet(account.requiredFields, FIELD, 128);
    const observedFields = normalizedSet(account.observedFields, FIELD, 256);
    if (observedDates.some((date) => !requiredDates.includes(date))) fail("invalid_input");
    const missingDates = Object.freeze(requiredDates.filter((date) => !observedDates.includes(date)));
    const missingFields = Object.freeze(requiredFields.filter((field) => !observedFields.includes(field)));
    const reasons: MetaDataHealthIssueCode[] = [];
    for (const source of sources) {
      const issue = sourceIssue(source.state);
      if (issue) {
        reasons.push(issue);
        observations.push(observation({ workspaceRef: input.workspaceRef, accountRef: account.accountRef,
          code: issue, sourceKind: source.kind, expectedDates: requiredDates, observedDates, missingDates, missingFields }));
      }
    }
    if (missingDates.length) {
      reasons.push("required_dates_missing");
      observations.push(observation({ workspaceRef: input.workspaceRef, accountRef: account.accountRef,
        code: "required_dates_missing", sourceKind: "canonical_performance", expectedDates: requiredDates,
        observedDates, missingDates, missingFields: [] }));
    }
    if (missingFields.length) {
      reasons.push("required_fields_missing");
      observations.push(observation({ workspaceRef: input.workspaceRef, accountRef: account.accountRef,
        code: "required_fields_missing", sourceKind: "canonical_meta_mirror", expectedDates: [],
        observedDates: [], missingDates: [], missingFields }));
    }
    if (account.currency === null) {
      reasons.push("account_currency_unknown");
      observations.push(observation({ workspaceRef: input.workspaceRef, accountRef: account.accountRef,
        code: "account_currency_unknown", sourceKind: "derived_trust",
        expectedCurrency: input.workspaceCurrency, observedCurrency: null }));
    } else if (input.workspaceCurrency !== null && account.currency !== input.workspaceCurrency) {
      reasons.push("account_currency_mismatch");
      observations.push(observation({ workspaceRef: input.workspaceRef, accountRef: account.accountRef,
        code: "account_currency_mismatch", sourceKind: "derived_trust",
        expectedCurrency: input.workspaceCurrency, observedCurrency: account.currency }));
    }
    const sourceState = accountState(sources, missingDates, missingFields);
    const state = sourceState === "ready" && (input.workspaceCurrency === null || account.currency === null
      || account.currency !== input.workspaceCurrency) ? "partial" : sourceState;
    const monetaryAggregationIncluded = state === "ready" && input.workspaceCurrency !== null && account.currency === input.workspaceCurrency;
    accounts.push({ accountRef: account.accountRef, currency: account.currency, state, monetaryAggregationIncluded,
      reasonCodes: [...new Set(reasons)].sort(compare), missingDates, missingFields });
  }
  accounts.sort((left, right) => compare(left.accountRef, right.accountRef));
  observations.sort((left, right) => compare(left.fingerprint, right.fingerprint));
  // 1 workspace issue + 250 × 6 account issues = 1,501 observations. Keeping
  // history at the same bound caps one full lifecycle projection at 3,002.
  if (observations.length > META_DATA_HEALTH_MAX_CURRENT_OBSERVATIONS) fail("invalid_input");
  const state: MetaDataHealthReport["state"] = accounts.length === 0 ? "empty"
    : accounts.every((account) => account.state === "unavailable") ? "unavailable"
      : accounts.every((account) => account.state === "empty") ? "empty"
        : accounts.every((account) => account.state === "ready") && observations.length === 0 ? "ready" : "partial";
  const monetaryAggregationAccountRefs = Object.freeze(accounts.filter((account) => account.monetaryAggregationIncluded).map((account) => account.accountRef));
  const excludedMonetaryAccountRefs = Object.freeze(accounts.filter((account) => !account.monetaryAggregationIncluded).map((account) => account.accountRef));
  const reasonCodes = Object.freeze([...new Set(observations.map((item) => item.code))].sort(compare));
  const accountProjection = Object.freeze(accounts.map((account) => Object.freeze({ ...account,
    reasonCodes: Object.freeze(account.reasonCodes) })));
  const core = Object.freeze({ version: META_DATA_HEALTH_VERSION, workspaceRef: input.workspaceRef, evaluatedAt, state,
    workspaceCurrency: input.workspaceCurrency, accounts: accountProjection, monetaryAggregationAccountRefs,
    excludedMonetaryAccountRefs, observations: Object.freeze(observations), gate: Object.freeze({
      analysisMayRecord: true as const, actionStagingAllowed: state === "ready",
      actionDispatchDataHealthReady: state === "ready", reasonCodes,
    }) });
  return Object.freeze({ ...core, reportHash: digest(core) });
}
