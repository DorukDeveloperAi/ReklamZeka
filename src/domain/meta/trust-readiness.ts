import { createHash } from "node:crypto";

export const META_TRUST_READINESS_SCHEMA_VERSION = 1 as const;
export const META_TRUST_READINESS_THRESHOLD_VERSION = "trust-readiness/v1" as const;

export type TrustReadinessStatus = "ready" | "degraded" | "not_ready";
export type TrustStreamKind = "hierarchy" | "insights" | "content" | "assets";
export type TrustCoverageKind = "entity" | "metric" | "content";

export type TrustPermission = Readonly<{
  status: "verified" | "permission_missing" | "unsupported" | "unknown";
  reason:
    | "none"
    | "token_scope_missing"
    | "asset_access_missing"
    | "api_edge_unsupported"
    | "not_checked";
}>;

export type TrustCoverage = Readonly<{
  expected: number | null;
  observed: number | null;
}>;

export type TrustStreamEvidence = Readonly<{
  stream: TrustStreamKind;
  required: boolean;
  permission: TrustPermission;
  lastSuccessfulAt: string | null;
  coverage: Readonly<Record<TrustCoverageKind, TrustCoverage>>;
  orphanCount: number | null;
  duplicateCount: number | null;
  replayCount: number | null;
  /** Internal canonical identities used only to reject cross-account collisions. */
  entityIdentityKeys: readonly string[];
}>;

export type TrustAccountEvidence = Readonly<{
  externalAccountId: string;
  streams: readonly TrustStreamEvidence[];
  currencies: readonly string[] | null;
  timezones: readonly string[] | null;
  attributionWindows: readonly string[] | null;
}>;

export type MetaTrustReadinessInput = Readonly<{
  schemaVersion: typeof META_TRUST_READINESS_SCHEMA_VERSION;
  evaluatedAt: string;
  accounts: readonly TrustAccountEvidence[];
  portfolioSegmentation?: Readonly<{
    timezone: boolean;
    attribution: boolean;
  }>;
}>;

export type TrustReadinessThresholds = Readonly<{
  version: string;
  freshness: Readonly<{
    degradedAfterHours: number;
    notReadyAfterHours: number;
  }>;
  coverage: Readonly<{
    readyMinimum: number;
    degradedMinimum: number;
  }>;
  quality: Readonly<{
    orphanNotReadyAbove: number;
    duplicateNotReadyAbove: number;
    replayNotReadyAbove: number;
  }>;
}>;

export type TrustReadinessThresholdOverrides = Readonly<{
  freshness?: Partial<TrustReadinessThresholds["freshness"]>;
  coverage?: Partial<TrustReadinessThresholds["coverage"]>;
  quality?: Partial<TrustReadinessThresholds["quality"]>;
}>;

export const DEFAULT_TRUST_READINESS_THRESHOLDS: TrustReadinessThresholds = Object.freeze({
  version: META_TRUST_READINESS_THRESHOLD_VERSION,
  freshness: Object.freeze({ degradedAfterHours: 30, notReadyAfterHours: 72 }),
  coverage: Object.freeze({ readyMinimum: 0.98, degradedMinimum: 0.9 }),
  quality: Object.freeze({
    orphanNotReadyAbove: 10,
    duplicateNotReadyAbove: 0,
    replayNotReadyAbove: 10,
  }),
});

export type TrustReasonCode =
  | "ACCOUNT_CURRENCY_UNKNOWN"
  | "ACCOUNT_CURRENCY_MIXED"
  | "ACCOUNT_STREAMS_MISSING"
  | "ACCOUNT_TIMEZONE_UNKNOWN"
  | "ACCOUNT_TIMEZONE_SEGMENT_REQUIRED"
  | "ACCOUNT_ATTRIBUTION_UNKNOWN"
  | "ACCOUNT_ATTRIBUTION_SEGMENT_REQUIRED"
  | "STREAM_PERMISSION_MISSING"
  | "STREAM_UNSUPPORTED"
  | "STREAM_PERMISSION_UNKNOWN"
  | "STREAM_FRESHNESS_UNKNOWN"
  | "STREAM_STALE"
  | "STREAM_EXPIRED"
  | "ENTITY_COVERAGE_UNKNOWN"
  | "ENTITY_COVERAGE_LOW"
  | "ENTITY_COVERAGE_CRITICAL"
  | "METRIC_COVERAGE_UNKNOWN"
  | "METRIC_COVERAGE_LOW"
  | "METRIC_COVERAGE_CRITICAL"
  | "CONTENT_COVERAGE_UNKNOWN"
  | "CONTENT_COVERAGE_LOW"
  | "CONTENT_COVERAGE_CRITICAL"
  | "ORPHAN_COUNT_UNKNOWN"
  | "ORPHANS_PRESENT"
  | "ORPHAN_COUNT_CRITICAL"
  | "DUPLICATE_COUNT_UNKNOWN"
  | "DUPLICATES_PRESENT"
  | "REPLAY_COUNT_UNKNOWN"
  | "REPLAYS_PRESENT"
  | "REPLAY_COUNT_CRITICAL"
  | "PORTFOLIO_ACCOUNTS_MISSING"
  | "PORTFOLIO_CURRENCY_MIXED"
  | "PORTFOLIO_TIMEZONE_SEGMENT_REQUIRED"
  | "PORTFOLIO_ATTRIBUTION_SEGMENT_REQUIRED";

type Reason = Readonly<{ code: TrustReasonCode; status: Exclude<TrustReadinessStatus, "ready"> }>;

export type PublicTrustStreamSummary = Readonly<{
  stream: TrustStreamKind;
  required: boolean;
  status: TrustReadinessStatus;
  reasonCodes: readonly TrustReasonCode[];
  freshnessAgeHours: number | null;
  coverageRatios: Readonly<Record<TrustCoverageKind, number | null>>;
  orphanCount: number | null;
  duplicateCount: number | null;
  replayCount: number | null;
}>;

export type PublicTrustAccountSummary = Readonly<{
  accountRef: string;
  status: TrustReadinessStatus;
  reasonCodes: readonly TrustReasonCode[];
  streams: readonly PublicTrustStreamSummary[];
}>;

export type MetaTrustReadinessReport = Readonly<{
  schemaVersion: typeof META_TRUST_READINESS_SCHEMA_VERSION;
  thresholdVersion: string;
  evaluatedAt: string;
  status: TrustReadinessStatus;
  reasonCodes: readonly TrustReasonCode[];
  accounts: readonly PublicTrustAccountSummary[];
  reportHash: string;
}>;

export class MetaTrustReadinessValidationError extends Error {
  constructor(
    readonly code: "invalid_input" | "duplicate_identity" | "cross_account_duplicate_identity",
    readonly accountRef: string,
    message: string,
  ) {
    super(message);
    this.name = "MetaTrustReadinessValidationError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function maskAccountRef(externalAccountId: string): string {
  return `acct_${sha256(externalAccountId).slice(0, 12)}`;
}

function fail(accountId: string, message: string): never {
  throw new MetaTrustReadinessValidationError("invalid_input", maskAccountRef(accountId), message);
}

function mergeThresholds(overrides?: TrustReadinessThresholdOverrides): TrustReadinessThresholds {
  const values = {
    freshness: { ...DEFAULT_TRUST_READINESS_THRESHOLDS.freshness, ...overrides?.freshness },
    coverage: { ...DEFAULT_TRUST_READINESS_THRESHOLDS.coverage, ...overrides?.coverage },
    quality: { ...DEFAULT_TRUST_READINESS_THRESHOLDS.quality, ...overrides?.quality },
  };
  const thresholds: TrustReadinessThresholds = {
    version: overrides
      ? `${DEFAULT_TRUST_READINESS_THRESHOLDS.version}+custom_${sha256(JSON.stringify(stableValue(values))).slice(0, 8)}`
      : DEFAULT_TRUST_READINESS_THRESHOLDS.version,
    ...values,
  };
  if (
    thresholds.freshness.degradedAfterHours < 0
    || thresholds.freshness.notReadyAfterHours <= thresholds.freshness.degradedAfterHours
    || thresholds.coverage.readyMinimum < 0
    || thresholds.coverage.readyMinimum > 1
    || thresholds.coverage.degradedMinimum < 0
    || thresholds.coverage.degradedMinimum > thresholds.coverage.readyMinimum
    || Object.values(thresholds.quality).some((value) => !Number.isInteger(value) || value < 0)
  ) {
    throw new MetaTrustReadinessValidationError("invalid_input", "[portfolio]", "Trust thresholds geçersiz");
  }
  return thresholds;
}

function statusFromReasons(reasons: readonly Reason[]): TrustReadinessStatus {
  if (reasons.some((reason) => reason.status === "not_ready")) return "not_ready";
  if (reasons.length > 0) return "degraded";
  return "ready";
}

function uniqueReasonCodes(reasons: readonly Reason[]): TrustReasonCode[] {
  return [...new Set(reasons.map((reason) => reason.code))].sort();
}

function issue(code: TrustReasonCode, required: boolean): Reason {
  return { code, status: required ? "not_ready" : "degraded" };
}

function assertNullableCount(value: number | null, accountId: string, label: string): void {
  if (value !== null && (!Number.isInteger(value) || value < 0)) fail(accountId, `${label} negatif veya kesirli olamaz`);
}

function normalizeSet(values: readonly string[] | null, accountId: string, label: string): string[] | null {
  if (values === null) return null;
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (normalized.length !== values.length) fail(accountId, `${label} boş veya tekrarlı değer içeremez`);
  return normalized;
}

function coverageRatio(coverage: TrustCoverage, accountId: string, label: string): number | null {
  assertNullableCount(coverage.expected, accountId, `${label} expected`);
  assertNullableCount(coverage.observed, accountId, `${label} observed`);
  if (coverage.expected === null || coverage.observed === null) return null;
  if (coverage.expected === 0) return coverage.observed === 0 ? 1 : 0;
  return Math.min(coverage.observed / coverage.expected, 1);
}

function coverageReason(
  kind: TrustCoverageKind,
  ratio: number | null,
  required: boolean,
  thresholds: TrustReadinessThresholds,
): Reason | null {
  const prefix = kind.toUpperCase() as Uppercase<TrustCoverageKind>;
  if (ratio === null) return issue(`${prefix}_COVERAGE_UNKNOWN` as TrustReasonCode, required);
  if (ratio < thresholds.coverage.degradedMinimum) {
    return { code: `${prefix}_COVERAGE_CRITICAL` as TrustReasonCode, status: required ? "not_ready" : "degraded" };
  }
  if (ratio < thresholds.coverage.readyMinimum) {
    return { code: `${prefix}_COVERAGE_LOW` as TrustReasonCode, status: "degraded" };
  }
  return null;
}

function evaluateStream(
  stream: TrustStreamEvidence,
  accountId: string,
  evaluatedAtMs: number,
  thresholds: TrustReadinessThresholds,
): PublicTrustStreamSummary {
  const reasons: Reason[] = [];
  if (stream.permission.status === "verified" && stream.permission.reason !== "none") {
    fail(accountId, "Verified permission reason none olmalıdır");
  }
  if (stream.permission.status !== "verified" && stream.permission.reason === "none") {
    fail(accountId, "Doğrulanmamış permission için reason zorunludur");
  }
  if (stream.permission.status === "permission_missing") reasons.push(issue("STREAM_PERMISSION_MISSING", stream.required));
  if (stream.permission.status === "unsupported") reasons.push(issue("STREAM_UNSUPPORTED", stream.required));
  if (stream.permission.status === "unknown") reasons.push(issue("STREAM_PERMISSION_UNKNOWN", stream.required));

  let freshnessAgeHours: number | null = null;
  if (stream.lastSuccessfulAt === null) {
    reasons.push(issue("STREAM_FRESHNESS_UNKNOWN", stream.required));
  } else {
    const lastSuccessfulAtMs = Date.parse(stream.lastSuccessfulAt);
    if (!Number.isFinite(lastSuccessfulAtMs) || lastSuccessfulAtMs > evaluatedAtMs) {
      fail(accountId, "Stream freshness zamanı geçersiz veya gelecekte");
    }
    freshnessAgeHours = (evaluatedAtMs - lastSuccessfulAtMs) / 3_600_000;
    if (freshnessAgeHours > thresholds.freshness.notReadyAfterHours) {
      reasons.push(issue("STREAM_EXPIRED", stream.required));
    } else if (freshnessAgeHours > thresholds.freshness.degradedAfterHours) {
      reasons.push({ code: "STREAM_STALE", status: "degraded" });
    }
  }

  const coverageRatios = {
    entity: coverageRatio(stream.coverage.entity, accountId, "Entity coverage"),
    metric: coverageRatio(stream.coverage.metric, accountId, "Metric coverage"),
    content: coverageRatio(stream.coverage.content, accountId, "Content coverage"),
  };
  for (const kind of ["entity", "metric", "content"] as const) {
    const reason = coverageReason(kind, coverageRatios[kind], stream.required, thresholds);
    if (reason) reasons.push(reason);
  }

  assertNullableCount(stream.orphanCount, accountId, "Orphan count");
  assertNullableCount(stream.duplicateCount, accountId, "Duplicate count");
  assertNullableCount(stream.replayCount, accountId, "Replay count");
  if (stream.orphanCount === null) reasons.push(issue("ORPHAN_COUNT_UNKNOWN", stream.required));
  else if (stream.orphanCount > thresholds.quality.orphanNotReadyAbove) reasons.push(issue("ORPHAN_COUNT_CRITICAL", stream.required));
  else if (stream.orphanCount > 0) reasons.push({ code: "ORPHANS_PRESENT", status: "degraded" });
  if (stream.duplicateCount === null) reasons.push(issue("DUPLICATE_COUNT_UNKNOWN", stream.required));
  else if (stream.duplicateCount > thresholds.quality.duplicateNotReadyAbove) reasons.push(issue("DUPLICATES_PRESENT", stream.required));
  if (stream.replayCount === null) reasons.push(issue("REPLAY_COUNT_UNKNOWN", stream.required));
  else if (stream.replayCount > thresholds.quality.replayNotReadyAbove) reasons.push(issue("REPLAY_COUNT_CRITICAL", stream.required));
  else if (stream.replayCount > 0) reasons.push({ code: "REPLAYS_PRESENT", status: "degraded" });

  return {
    stream: stream.stream,
    required: stream.required,
    status: statusFromReasons(reasons),
    reasonCodes: uniqueReasonCodes(reasons),
    freshnessAgeHours,
    coverageRatios,
    orphanCount: stream.orphanCount,
    duplicateCount: stream.duplicateCount,
    replayCount: stream.replayCount,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableValue(entryValue)]),
    );
  }
  return value;
}

export function buildMetaTrustReadinessReport(
  input: MetaTrustReadinessInput,
  thresholdOverrides?: TrustReadinessThresholdOverrides,
): MetaTrustReadinessReport {
  if (input.schemaVersion !== META_TRUST_READINESS_SCHEMA_VERSION) {
    throw new MetaTrustReadinessValidationError("invalid_input", "[portfolio]", "Trust schema version desteklenmiyor");
  }
  const evaluatedAtMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) {
    throw new MetaTrustReadinessValidationError("invalid_input", "[portfolio]", "Evaluation zamanı geçersiz");
  }
  const thresholds = mergeThresholds(thresholdOverrides);
  const accountIds = new Set<string>();
  const identityOwners = new Map<string, string>();
  const normalizedAccounts = input.accounts.map((account) => {
    if (!account.externalAccountId.trim()) fail(account.externalAccountId, "Account identity zorunludur");
    if (accountIds.has(account.externalAccountId)) {
      throw new MetaTrustReadinessValidationError(
        "duplicate_identity",
        maskAccountRef(account.externalAccountId),
        "Account identity portfolio içinde tekrarlanamaz",
      );
    }
    accountIds.add(account.externalAccountId);
    const streamKinds = new Set<TrustStreamKind>();
    const streams = [...account.streams].sort((left, right) => left.stream.localeCompare(right.stream));
    for (const stream of streams) {
      if (streamKinds.has(stream.stream)) fail(account.externalAccountId, "Stream kind hesap içinde tekrarlanamaz");
      streamKinds.add(stream.stream);
      const localIdentities = new Set<string>();
      for (const identity of stream.entityIdentityKeys) {
        if (!identity.trim() || localIdentities.has(identity)) {
          throw new MetaTrustReadinessValidationError(
            "duplicate_identity",
            maskAccountRef(account.externalAccountId),
            "Entity identity boş veya stream içinde tekrarlı olamaz",
          );
        }
        localIdentities.add(identity);
        const owner = identityOwners.get(identity);
        if (owner && owner !== account.externalAccountId) {
          throw new MetaTrustReadinessValidationError(
            "cross_account_duplicate_identity",
            maskAccountRef(account.externalAccountId),
            "Entity identity birden fazla hesaba bağlanamaz",
          );
        }
        identityOwners.set(identity, account.externalAccountId);
      }
    }
    return {
      account,
      streams,
      currencies: normalizeSet(account.currencies, account.externalAccountId, "Currency set"),
      timezones: normalizeSet(account.timezones, account.externalAccountId, "Timezone set"),
      attributionWindows: normalizeSet(account.attributionWindows, account.externalAccountId, "Attribution set"),
    };
  });

  const segmentation = input.portfolioSegmentation ?? { timezone: false, attribution: false };
  const accountSummaries = normalizedAccounts.map(({ account, streams, currencies, timezones, attributionWindows }) => {
    const accountReasons: Reason[] = [];
    if (streams.length === 0) accountReasons.push({ code: "ACCOUNT_STREAMS_MISSING", status: "not_ready" });
    if (currencies === null || currencies.length === 0) accountReasons.push({ code: "ACCOUNT_CURRENCY_UNKNOWN", status: "not_ready" });
    else if (currencies.length > 1) accountReasons.push({ code: "ACCOUNT_CURRENCY_MIXED", status: "not_ready" });
    if (timezones === null || timezones.length === 0) accountReasons.push({ code: "ACCOUNT_TIMEZONE_UNKNOWN", status: "not_ready" });
    else if (timezones.length > 1 && !segmentation.timezone) accountReasons.push({ code: "ACCOUNT_TIMEZONE_SEGMENT_REQUIRED", status: "not_ready" });
    if (attributionWindows === null || attributionWindows.length === 0) accountReasons.push({ code: "ACCOUNT_ATTRIBUTION_UNKNOWN", status: "not_ready" });
    else if (attributionWindows.length > 1 && !segmentation.attribution) accountReasons.push({ code: "ACCOUNT_ATTRIBUTION_SEGMENT_REQUIRED", status: "not_ready" });

    const streamSummaries = streams.map((stream) => evaluateStream(stream, account.externalAccountId, evaluatedAtMs, thresholds));
    for (const stream of streamSummaries) {
      for (const code of stream.reasonCodes) accountReasons.push({ code, status: stream.status === "not_ready" ? "not_ready" : "degraded" });
    }
    return {
      accountRef: maskAccountRef(account.externalAccountId),
      status: statusFromReasons(accountReasons),
      reasonCodes: uniqueReasonCodes(accountReasons),
      streams: streamSummaries,
    } satisfies PublicTrustAccountSummary;
  }).sort((left, right) => left.accountRef.localeCompare(right.accountRef));

  const portfolioReasons: Reason[] = [];
  if (accountSummaries.length === 0) portfolioReasons.push({ code: "PORTFOLIO_ACCOUNTS_MISSING", status: "not_ready" });
  for (const account of accountSummaries) {
    for (const code of account.reasonCodes) portfolioReasons.push({ code, status: account.status === "not_ready" ? "not_ready" : "degraded" });
  }
  const portfolioCurrencies = new Set(normalizedAccounts.flatMap(({ currencies }) => currencies ?? []));
  const portfolioTimezones = new Set(normalizedAccounts.flatMap(({ timezones }) => timezones ?? []));
  const portfolioAttributions = new Set(normalizedAccounts.flatMap(({ attributionWindows }) => attributionWindows ?? []));
  if (portfolioCurrencies.size > 1) portfolioReasons.push({ code: "PORTFOLIO_CURRENCY_MIXED", status: "not_ready" });
  if (portfolioTimezones.size > 1 && !segmentation.timezone) {
    portfolioReasons.push({ code: "PORTFOLIO_TIMEZONE_SEGMENT_REQUIRED", status: "not_ready" });
  }
  if (portfolioAttributions.size > 1 && !segmentation.attribution) {
    portfolioReasons.push({ code: "PORTFOLIO_ATTRIBUTION_SEGMENT_REQUIRED", status: "not_ready" });
  }

  const reportWithoutHash = {
    schemaVersion: input.schemaVersion,
    thresholdVersion: thresholds.version,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    status: statusFromReasons(portfolioReasons),
    reasonCodes: uniqueReasonCodes(portfolioReasons),
    accounts: accountSummaries,
  };
  const reportHash = sha256(JSON.stringify(stableValue(reportWithoutHash)));
  return { ...reportWithoutHash, reportHash };
}
