import { existsSync } from "node:fs";
import { ConnectorError } from "@/connectors/contract";
import {
  MetaGraphClient,
  META_GRAPH_API_VERSION,
  type MetaFetch,
} from "@/connectors/meta/graph-client";
import {
  META_INSIGHT_CAPABILITY_CATALOG_HASH,
  META_INSIGHT_CAPABILITY_CATALOG_VERSION,
  planMetaInsightQuery,
  type MetaInsightBreakdown,
} from "@/domain/meta/insights/capability-catalog";
import type { MetaInsightEntityLevel } from "@/domain/meta/insights/contract";
import type { AnalysisMetric } from "@/analyses/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const token = process.env.META_ACCESS_TOKEN?.trim();
if (!token) throw new Error("META_ACCESS_TOKEN yapılandırılmadı");

const ACCOUNT_LIMIT = 5;
const INSIGHT_ROW_LIMIT = 1;
const MAX_NETWORK_ATTEMPTS = 45;
const REQUEST_TIMEOUT_MS = 12_000;

type Probe = Readonly<{
  key: string;
  level: MetaInsightEntityLevel;
  metrics: readonly AnalysisMetric[];
  breakdowns?: readonly MetaInsightBreakdown[];
}>;

const BASELINE_METRICS = [
  "spendMinor", "impressions", "clicks", "reach", "frequency",
  "conversions", "revenueMinor",
] as const satisfies readonly AnalysisMetric[];

const probes: readonly Probe[] = [
  { key: "baseline_campaign", level: "campaign", metrics: BASELINE_METRICS },
  { key: "baseline_adset", level: "ad_set", metrics: BASELINE_METRICS },
  { key: "baseline_ad", level: "ad", metrics: BASELINE_METRICS },
  { key: "demographic_age_gender", level: "campaign", metrics: ["impressions", "clicks"], breakdowns: ["age", "gender"] },
  { key: "geo_country", level: "campaign", metrics: ["impressions", "clicks"], breakdowns: ["country"] },
  { key: "geo_region", level: "campaign", metrics: ["impressions", "clicks"], breakdowns: ["region"] },
  { key: "placement_device", level: "campaign", metrics: ["impressions", "clicks"], breakdowns: ["placement", "impression_device"] },
  { key: "device_platform", level: "campaign", metrics: ["impressions", "clicks"], breakdowns: ["device_platform"] },
];

let getNetworkCalls = 0;
let writeNetworkCalls = 0;
const permittedAccountPaths = new Set<string>();

function hasExactQueryKeys(url: URL, allowed: readonly string[]): boolean {
  const actual = [...url.searchParams.keys()].sort().join(",");
  return actual === [...allowed].sort().join(",");
}

function allowedRequest(url: URL): boolean {
  const prefix = `/${META_GRAPH_API_VERSION}/`;
  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com" || !url.pathname.startsWith(prefix)) return false;
  if (url.searchParams.has("access_token")) return false;
  if (url.pathname === `${prefix}me/adaccounts`) {
    return hasExactQueryKeys(url, ["fields", "limit"])
      && url.searchParams.get("fields") === "id"
      && url.searchParams.get("limit") === String(ACCOUNT_LIMIT);
  }
  const accountPath = url.pathname.slice(prefix.length).replace(/\/insights$/, "");
  if (!url.pathname.endsWith("/insights") || !permittedAccountPaths.has(accountPath)) return false;
  const allowed = [
    "fields", "level", "time_increment", "date_preset", "limit",
    "use_account_attribution_setting", "breakdowns", "action_breakdowns",
  ];
  return [...url.searchParams.keys()].every((key) => allowed.includes(key))
    && url.searchParams.get("date_preset") === "last_30d"
    && url.searchParams.get("limit") === String(INSIGHT_ROW_LIMIT);
}

const trackedFetch: MetaFetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" || init?.body !== undefined && init.body !== null) {
    writeNetworkCalls += 1;
    throw new Error("Capability verifier yalnız gövdesiz GET kabul eder");
  }
  const url = new URL(input);
  if (!allowedRequest(url)) throw new Error("Capability verifier izin verilmeyen Meta isteğini engelledi");
  if (!init?.headers || new Headers(init.headers).get("Authorization")?.startsWith("Bearer ") !== true) {
    throw new Error("Capability verifier güvenli Authorization header sınırını doğrulayamadı");
  }
  getNetworkCalls += 1;
  if (getNetworkCalls > MAX_NETWORK_ATTEMPTS) throw new Error("Capability verifier ağ çağrısı sınırını aştı");
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(url, { ...init, signal });
};

type GraphPage = Readonly<{ data?: readonly Readonly<Record<string, unknown>>[] }>;

function safeReason(error: unknown): string {
  if (error instanceof ConnectorError) return `connector_${error.code}`;
  return "verifier_failed_closed";
}

function countBy(values: readonly string[]): Readonly<Record<string, number>> {
  return Object.freeze(values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {}));
}

try {
  const client = new MetaGraphClient(token, trackedFetch);
  const accountPage = await client.get<GraphPage>("/me/adaccounts", {
    fields: "id",
    limit: String(ACCOUNT_LIMIT),
  });
  const accountIds = (Array.isArray(accountPage.data) ? accountPage.data : [])
    .map((account) => typeof account.id === "string" && /^act_\d+$/.test(account.id) ? account.id : null)
    .filter((accountId): accountId is string => accountId !== null)
    .slice(0, ACCOUNT_LIMIT);
  if (!accountIds.length) throw new Error("Verifier için güvenli reklam hesabı bulunamadı");
  accountIds.forEach((accountId) => permittedAccountPaths.add(accountId));

  const selectionPlan = planMetaInsightQuery({
    graphApiVersion: META_GRAPH_API_VERSION,
    level: "campaign",
    metrics: ["impressions"],
    attribution: { mode: "account_default" },
    timeIncrement: 1,
    grantedPermissions: ["ads_read"],
  });
  if (selectionPlan.status !== "planned") throw new Error("Verifier hesap seçimi planlanamadı");
  let accountId = accountIds[0]!;
  let accountsExamined = 0;
  let selectionRowsFound = false;
  let selectionFailures = 0;
  for (const candidateId of accountIds) {
    accountsExamined += 1;
    try {
      const selection = await client.get<GraphPage>(`/${candidateId}/insights`, {
        ...selectionPlan.parameters,
        date_preset: "last_30d",
        limit: String(INSIGHT_ROW_LIMIT),
      });
      if (!Array.isArray(selection.data)) throw new Error("Meta insight seçim yanıtı geçersiz");
      if (selection.data.length) {
        accountId = candidateId;
        selectionRowsFound = true;
        break;
      }
    } catch {
      selectionFailures += 1;
    }
  }

  const outcomes: Array<Readonly<{
    key: string;
    level: MetaInsightEntityLevel;
    status: "returned_rows" | "empty" | "failed";
    rows: number;
    requestedFields: number;
    returnedFieldSlots: number;
    rowsWithActions: number;
    rowsWithActionValues: number;
    reason?: string;
  }>> = [];
  let minimumUsageHeadroom = 1;

  for (const probe of probes) {
    const plan = planMetaInsightQuery({
      graphApiVersion: META_GRAPH_API_VERSION,
      level: probe.level,
      metrics: probe.metrics,
      ...(probe.breakdowns ? { breakdowns: probe.breakdowns } : {}),
      attribution: { mode: "account_default" },
      timeIncrement: 1,
      grantedPermissions: ["ads_read"],
    });
    if (plan.status !== "planned") throw new Error(`Verifier planı fail-closed kaldı: ${plan.reasonCode}`);
    try {
      const response = await client.getWithUsage<GraphPage>(`/${accountId}/insights`, {
        ...plan.parameters,
        date_preset: "last_30d",
        limit: String(INSIGHT_ROW_LIMIT),
      });
      if (!Array.isArray(response.data.data)) throw new Error("Meta insight yanıtı data dizisi içermiyor");
      minimumUsageHeadroom = Math.min(minimumUsageHeadroom, response.usageHeadroom);
      const rows = response.data.data.slice(0, INSIGHT_ROW_LIMIT);
      const requested = new Set(plan.fields);
      outcomes.push(Object.freeze({
        key: probe.key,
        level: probe.level,
        status: rows.length ? "returned_rows" : "empty",
        rows: rows.length,
        requestedFields: requested.size,
        returnedFieldSlots: rows.reduce((sum, row) => sum + Object.keys(row).filter((key) => requested.has(key)).length, 0),
        rowsWithActions: rows.filter((row) => Array.isArray(row.actions)).length,
        rowsWithActionValues: rows.filter((row) => Array.isArray(row.action_values)).length,
      }));
    } catch (error) {
      outcomes.push(Object.freeze({
        key: probe.key,
        level: probe.level,
        status: "failed",
        rows: 0,
        requestedFields: plan.fields.length,
        returnedFieldSlots: 0,
        rowsWithActions: 0,
        rowsWithActionValues: 0,
        reason: safeReason(error),
      }));
    }
  }

  const failed = outcomes.filter((outcome) => outcome.status === "failed");
  const requestedFieldSlots = outcomes.reduce((sum, outcome) => sum + outcome.requestedFields, 0);
  const returnedFieldSlots = outcomes.reduce((sum, outcome) => sum + outcome.returnedFieldSlots, 0);
  const rowsWithActions = outcomes.reduce((sum, outcome) => sum + outcome.rowsWithActions, 0);
  const rowsWithActionValues = outcomes.reduce((sum, outcome) => sum + outcome.rowsWithActionValues, 0);
  const coverageGaps = [
    ...(returnedFieldSlots < requestedFieldSlots ? ["requested_field_slots_unobserved"] : []),
    ...(rowsWithActions === 0 ? ["actions_container_unobserved"] : []),
    ...(rowsWithActionValues === 0 ? ["action_values_container_unobserved"] : []),
  ];
  const result = {
    status: failed.length ? "failed_closed" : coverageGaps.length ? "partial_coverage" : "verified_coverage",
    graphApiVersion: META_GRAPH_API_VERSION,
    catalogVersion: META_INSIGHT_CAPABILITY_CATALOG_VERSION,
    catalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH,
    limits: {
      accounts: ACCOUNT_LIMIT,
      accountsExamined,
      selectionRowsFound,
      selectionFailures,
      insightRowsPerProbe: INSIGHT_ROW_LIMIT,
      probes: probes.length,
      maxNetworkAttempts: MAX_NETWORK_ATTEMPTS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    },
    getNetworkCalls,
    writeNetworkCalls,
    probeStatuses: countBy(outcomes.map((outcome) => outcome.status)),
    levelCoverage: countBy(outcomes.filter((outcome) => outcome.status !== "failed").map((outcome) => outcome.level)),
    requestedFieldSlots,
    returnedFieldSlots,
    rowsWithActions,
    rowsWithActionValues,
    coverageGaps,
    failureReasons: countBy(failed.map((outcome) => outcome.reason ?? "unknown")),
    minimumUsageHeadroom: Number(minimumUsageHeadroom.toFixed(3)),
  };
  console.log(JSON.stringify(result, null, 2));
  if (failed.length || writeNetworkCalls !== 0) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({
    status: "failed_closed",
    reason: safeReason(error),
    graphApiVersion: META_GRAPH_API_VERSION,
    catalogVersion: META_INSIGHT_CAPABILITY_CATALOG_VERSION,
    catalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH,
    getNetworkCalls,
    writeNetworkCalls,
  }));
  process.exitCode = 1;
}
