import { createHash } from "node:crypto";
import { ANALYSIS_METRICS, type AnalysisMetric } from "@/analyses/schema";
import {
  META_METRIC_FORMULA_CATALOG,
  META_METRIC_FORMULA_CATALOG_VERSION,
} from "@/domain/meta/insights/metric-engine";
import type {
  MetaFieldAvailability,
  MetaInsightEntityLevel,
  MetaMetricAggregation,
  MetaMetricValue,
} from "@/domain/meta/insights/contract";

export const META_INSIGHT_CAPABILITY_CATALOG_VERSION =
  "meta-graph-v23-insight-capabilities/1.0.0" as const;
export const META_INSIGHT_CAPABILITY_GRAPH_VERSION = "v23.0" as const;

export const META_INSIGHT_BREAKDOWNS = [
  "age",
  "gender",
  "country",
  "region",
  "placement",
  "publisher_platform",
  "platform_position",
  "impression_device",
  "device_platform",
] as const;
export type MetaInsightBreakdown = (typeof META_INSIGHT_BREAKDOWNS)[number];

export const META_ATTRIBUTION_WINDOWS = [
  "1d_click",
  "7d_click",
  "1d_view",
  "incrementality",
] as const;
export type MetaAttributionWindow = (typeof META_ATTRIBUTION_WINDOWS)[number];

type SupportedSourceField = Readonly<{
  status: "supported";
  graphField: "spend" | "impressions" | "clicks" | "reach" | "frequency" | "actions" | "action_values";
  kind: "source";
  valueKind: "money_decimal" | "decimal" | "action_container" | "action_value_container";
  aggregation: "additive" | "non_additive";
  levels: readonly MetaInsightEntityLevel[];
  extraction: "scalar" | "exact_action_type_only";
}>;

type UnsupportedSourceField = Readonly<{
  status: "unsupported";
  graphField: string;
  kind: "source";
  reason: "not_a_verified_graph_v23_source_field";
}>;

export type MetaInsightSourceFieldCapability = SupportedSourceField | UnsupportedSourceField;

const ALL_LEVELS = ["campaign", "ad_set", "ad"] as const satisfies readonly MetaInsightEntityLevel[];

const supportedField = (
  graphField: SupportedSourceField["graphField"],
  valueKind: SupportedSourceField["valueKind"],
  aggregation: SupportedSourceField["aggregation"],
  extraction: SupportedSourceField["extraction"] = "scalar",
): SupportedSourceField => Object.freeze({
  status: "supported",
  graphField,
  kind: "source",
  valueKind,
  aggregation,
  levels: ALL_LEVELS,
  extraction,
});

const unsupportedField = (graphField: string): UnsupportedSourceField => Object.freeze({
  status: "unsupported",
  graphField,
  kind: "source",
  reason: "not_a_verified_graph_v23_source_field",
});

/**
 * Every source selector used by the metric formula engine is explicit here. Aliases that
 * are useful to the canonical engine but are not verified Graph v23 fields fail closed;
 * the planner may still use a later, supported fallback selector from the same formula.
 */
export const META_INSIGHT_SOURCE_FIELD_CATALOG: Readonly<Record<string, MetaInsightSourceFieldCapability>> =
  Object.freeze({
    spend: supportedField("spend", "money_decimal", "additive"),
    impressions: supportedField("impressions", "decimal", "additive"),
    clicks: supportedField("clicks", "decimal", "additive"),
    reach: supportedField("reach", "decimal", "non_additive"),
    frequency: supportedField("frequency", "decimal", "non_additive"),
    actions: supportedField("actions", "action_container", "additive", "exact_action_type_only"),
    action_values: supportedField("action_values", "action_value_container", "additive", "exact_action_type_only"),
    conversions: unsupportedField("conversions"),
    conversion_value: unsupportedField("conversion_value"),
    landing_page_views: unsupportedField("landing_page_views"),
    engagements: unsupportedField("engagements"),
    leads: unsupportedField("leads"),
    qualified_leads: unsupportedField("qualified_leads"),
    messages: unsupportedField("messages"),
    app_installs: unsupportedField("app_installs"),
    retention_d7: unsupportedField("retention_d7"),
    purchases: unsupportedField("purchases"),
    revenue: unsupportedField("revenue"),
  });

export type MetaActionDestination = "on_meta" | "off_meta" | "mixed_or_account_dependent";
export type MetaActionCapability = Readonly<{
  container: "actions" | "action_values";
  actionType: string;
  outputKind: "decimal" | "money_minor";
  aggregation: "additive";
  extraction: "exact_action_type_only";
  destination: MetaActionDestination;
}>;

const action = (
  container: MetaActionCapability["container"],
  actionType: string,
  outputKind: MetaActionCapability["outputKind"],
  destination: MetaActionDestination,
): MetaActionCapability => Object.freeze({
  container,
  actionType,
  outputKind,
  aggregation: "additive",
  extraction: "exact_action_type_only",
  destination,
});

/** Exact action types currently consumed by META_METRIC_FORMULA_CATALOG. */
export const META_ACTION_CAPABILITY_CATALOG: readonly MetaActionCapability[] = Object.freeze([
  action("actions", "conversion", "decimal", "off_meta"),
  action("actions", "offsite_conversion", "decimal", "off_meta"),
  action("actions", "purchase", "decimal", "off_meta"),
  action("action_values", "purchase", "money_minor", "off_meta"),
  action("actions", "landing_page_view", "decimal", "off_meta"),
  action("actions", "post_engagement", "decimal", "on_meta"),
  action("actions", "lead", "decimal", "mixed_or_account_dependent"),
  action("actions", "qualified_lead", "decimal", "mixed_or_account_dependent"),
  action("actions", "messaging_conversation_started", "decimal", "on_meta"),
  action("actions", "onsite_conversion.messaging_conversation_started_7d", "decimal", "on_meta"),
  action("actions", "app_install", "decimal", "off_meta"),
]);

type GraphBreakdown = Exclude<MetaInsightBreakdown, "placement">;

export type MetaBreakdownCompatibility = Readonly<{
  graphBreakdowns: readonly GraphBreakdown[];
  supportsScalarFields: true;
  supportsActionContainers: boolean;
  estimated: true;
  offMetaActionPolicy: "supported" | "unsupported";
}>;

/**
 * Meta documents that only selected breakdown permutations are stored. `placement` is a
 * ReklamZeka intent alias and expands to publisher_platform + platform_position.
 */
export const META_BREAKDOWN_COMPATIBILITY_MATRIX: readonly MetaBreakdownCompatibility[] = Object.freeze([
  { graphBreakdowns: [], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  { graphBreakdowns: ["age"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  { graphBreakdowns: ["gender"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  { graphBreakdowns: ["age", "gender"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  { graphBreakdowns: ["country"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  { graphBreakdowns: ["region"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "unsupported" },
  { graphBreakdowns: ["publisher_platform"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  { graphBreakdowns: ["publisher_platform", "impression_device"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  { graphBreakdowns: ["publisher_platform", "platform_position"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  { graphBreakdowns: ["publisher_platform", "platform_position", "impression_device"], supportsScalarFields: true, supportsActionContainers: true, estimated: true, offMetaActionPolicy: "supported" },
  // Listed as a generic breakdown in the v23 documentation, but not in the documented
  // action-compatible permutation table. Scalar-only is therefore the safe contract.
  { graphBreakdowns: ["device_platform"], supportsScalarFields: true, supportsActionContainers: false, estimated: true, offMetaActionPolicy: "supported" },
]);

const IDENTITY_FIELDS_BY_LEVEL: Readonly<Record<MetaInsightEntityLevel, readonly string[]>> = Object.freeze({
  campaign: ["account_id", "campaign_id", "date_start", "date_stop"],
  ad_set: ["account_id", "campaign_id", "adset_id", "date_start", "date_stop"],
  ad: ["account_id", "campaign_id", "adset_id", "ad_id", "date_start", "date_stop"],
});

const GRAPH_LEVEL_BY_LEVEL: Readonly<Record<MetaInsightEntityLevel, "campaign" | "adset" | "ad">> = Object.freeze({
  campaign: "campaign",
  ad_set: "adset",
  ad: "ad",
});

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => codePointCompare(left, right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

const METRIC_CAPABILITIES = Object.freeze(ANALYSIS_METRICS.map((metric) => {
  const formula = META_METRIC_FORMULA_CATALOG[metric];
  return Object.freeze({
    metric,
    kind: formula.kind === "source" ? "source" : "derived",
    aggregation: formula.aggregation,
    ...(formula.kind === "ratio" ? {
      numerator: formula.numerator,
      denominator: formula.denominator,
      factor: formula.factor,
    } : {}),
  });
}));

const CATALOG_MATERIAL = Object.freeze({
  version: META_INSIGHT_CAPABILITY_CATALOG_VERSION,
  graphApiVersion: META_INSIGHT_CAPABILITY_GRAPH_VERSION,
  formulaCatalogVersion: META_METRIC_FORMULA_CATALOG_VERSION,
  levels: ALL_LEVELS,
  identityFieldsByLevel: IDENTITY_FIELDS_BY_LEVEL,
  graphLevelByLevel: GRAPH_LEVEL_BY_LEVEL,
  sourceFields: META_INSIGHT_SOURCE_FIELD_CATALOG,
  actions: META_ACTION_CAPABILITY_CATALOG,
  breakdowns: META_BREAKDOWN_COMPATIBILITY_MATRIX,
  attribution: {
    modes: ["account_default", "explicit_windows"],
    explicitWindows: META_ATTRIBUTION_WINDOWS,
    aggregationAcrossMixedSettings: "unsupported",
  },
  timeIncrement: { allDays: "all_days", minimumDays: 1, maximumDays: 90 },
  metricCapabilities: METRIC_CAPABILITIES,
  evidence: [
    "https://developers.facebook.com/docs/marketing-api/insights/v23.0",
    "https://developers.facebook.com/docs/marketing-api/insights/breakdowns/v23.0",
  ],
});

export const META_INSIGHT_CAPABILITY_CATALOG_HASH = stableHash(CATALOG_MATERIAL);
export const META_INSIGHT_CAPABILITY_CATALOG = Object.freeze({
  ...CATALOG_MATERIAL,
  catalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH,
});

export type MetaInsightAttribution =
  | Readonly<{ mode: "account_default" }>
  | Readonly<{ mode: "explicit_windows"; windows: readonly MetaAttributionWindow[] }>;

export type MetaInsightPlanInput = Readonly<{
  graphApiVersion: string;
  level: MetaInsightEntityLevel;
  metrics: readonly AnalysisMetric[];
  breakdowns?: readonly MetaInsightBreakdown[];
  attribution: MetaInsightAttribution;
  timeIncrement: "all_days" | number;
  grantedPermissions: readonly string[];
}>;

export type MetaActionExtractionContract = Readonly<{
  container: "actions" | "action_values";
  actionType: string;
  outputKind: "decimal" | "money_minor";
  aggregation: "additive";
  destination: MetaActionDestination;
}>;

export type MetaInsightMetricPlan = Readonly<{
  metric: AnalysisMetric;
  kind: "source" | "derived";
  aggregation: MetaMetricAggregation;
}>;

export type MetaInsightCompatibilityFailure = Readonly<{
  status: "unsupported" | "permission_missing" | "unknown";
  reasonCode: string;
  availability: MetaFieldAvailability;
  catalogVersion: typeof META_INSIGHT_CAPABILITY_CATALOG_VERSION;
  catalogHash: string;
  planHash: string;
}>;

export type MetaInsightQueryPlan = Readonly<{
  status: "planned";
  catalogVersion: typeof META_INSIGHT_CAPABILITY_CATALOG_VERSION;
  catalogHash: string;
  graphApiVersion: typeof META_INSIGHT_CAPABILITY_GRAPH_VERSION;
  level: MetaInsightEntityLevel;
  graphLevel: "campaign" | "adset" | "ad";
  fields: readonly string[];
  graphBreakdowns: readonly GraphBreakdown[];
  parameters: Readonly<Record<string, string>>;
  metrics: readonly MetaInsightMetricPlan[];
  actionExtractions: readonly MetaActionExtractionContract[];
  warnings: readonly string[];
  planHash: string;
}>;

export type MetaInsightCompatibilityPlan = MetaInsightQueryPlan | MetaInsightCompatibilityFailure;

function failure(
  status: MetaInsightCompatibilityFailure["status"],
  reasonCode: string,
  hashInput: unknown,
): MetaInsightCompatibilityFailure {
  return Object.freeze({
    status,
    reasonCode,
    availability: Object.freeze({ reason: status, detail: reasonCode }),
    catalogVersion: META_INSIGHT_CAPABILITY_CATALOG_VERSION,
    catalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH,
    planHash: stableHash({ catalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH, input: hashInput, status, reasonCode }),
  });
}

function actionCapability(container: string, actionType: string): MetaActionCapability | undefined {
  return META_ACTION_CAPABILITY_CATALOG.find((candidate) =>
    candidate.container === container && candidate.actionType === actionType);
}

type ResolvedMetric = Readonly<{
  fields: readonly string[];
  actions: readonly MetaActionExtractionContract[];
  plan: MetaInsightMetricPlan;
}>;

function resolveMetric(metric: AnalysisMetric, seen = new Set<AnalysisMetric>()): ResolvedMetric | null {
  if (seen.has(metric)) return null;
  seen.add(metric);
  const formula = META_METRIC_FORMULA_CATALOG[metric];
  if (formula.kind === "ratio") {
    const numerator = resolveMetric(formula.numerator, new Set(seen));
    const denominator = resolveMetric(formula.denominator, new Set(seen));
    if (!numerator || !denominator) return null;
    return {
      fields: [...numerator.fields, ...denominator.fields],
      actions: [...numerator.actions, ...denominator.actions],
      plan: { metric, kind: "derived", aggregation: "derived" },
    };
  }

  const fields: string[] = [];
  const actions: MetaActionExtractionContract[] = [];
  for (const selector of formula.selectors) {
    const capability = META_INSIGHT_SOURCE_FIELD_CATALOG[selector.metricKey];
    if (!capability || capability.status !== "supported") continue;
    if (selector.actionType) {
      const actionEntry = actionCapability(selector.metricKey, selector.actionType);
      if (!actionEntry) continue;
      actions.push({
        container: actionEntry.container,
        actionType: actionEntry.actionType,
        outputKind: actionEntry.outputKind,
        aggregation: actionEntry.aggregation,
        destination: actionEntry.destination,
      });
    }
    fields.push(capability.graphField);
  }
  if (!fields.length) return null;
  return { fields, actions, plan: { metric, kind: "source", aggregation: formula.aggregation } };
}

function canonicalBreakdowns(input: readonly MetaInsightBreakdown[]): readonly GraphBreakdown[] {
  const expanded = input.flatMap<GraphBreakdown>((breakdown) => breakdown === "placement"
    ? ["publisher_platform", "platform_position"]
    : [breakdown]);
  const order = META_INSIGHT_BREAKDOWNS.filter((item): item is GraphBreakdown => item !== "placement");
  return order.filter((item) => expanded.includes(item));
}

function sameBreakdowns(left: readonly GraphBreakdown[], right: readonly GraphBreakdown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function canonicalPermissions(permissions: readonly string[]): readonly string[] {
  return [...new Set(permissions.map((value) => value.trim()).filter(Boolean))].sort(codePointCompare);
}

function planHashInput(input: MetaInsightPlanInput): unknown {
  const attribution = input.attribution;
  return {
    graphApiVersion: input.graphApiVersion,
    level: input.level,
    metrics: [...new Set(input.metrics)].sort(codePointCompare),
    breakdowns: canonicalBreakdowns(input.breakdowns ?? []),
    attribution: attribution.mode === "account_default"
      ? attribution
      : { mode: attribution.mode, windows: META_ATTRIBUTION_WINDOWS.filter((window) => attribution.windows.includes(window)) },
    timeIncrement: input.timeIncrement,
    grantedPermissions: canonicalPermissions(input.grantedPermissions),
  };
}

/** Build a data-only, account-ID-free Graph query plan. Callers add the account path and time range. */
export function planMetaInsightQuery(input: MetaInsightPlanInput): MetaInsightCompatibilityPlan {
  const hashInput = planHashInput(input);
  if (input.graphApiVersion !== META_INSIGHT_CAPABILITY_GRAPH_VERSION) {
    return failure("unknown", "graph_version_not_catalogued", hashInput);
  }
  const permissions = canonicalPermissions(input.grantedPermissions);
  if (!permissions.some((permission) => permission === "ads_read" || permission === "ads_management")) {
    return failure("permission_missing", "ads_insights_read_permission_missing", hashInput);
  }
  if (!input.metrics.length) return failure("unknown", "empty_metric_request", hashInput);
  if (input.timeIncrement !== "all_days" &&
      (!Number.isInteger(input.timeIncrement) || input.timeIncrement < 1 || input.timeIncrement > 90)) {
    return failure("unknown", "invalid_time_increment", hashInput);
  }

  let attributionParameters: Readonly<Record<string, string>>;
  const attribution = input.attribution;
  if (attribution.mode === "account_default") {
    attributionParameters = { use_account_attribution_setting: "true" };
  } else {
    const uniqueWindows = META_ATTRIBUTION_WINDOWS.filter((window) => attribution.windows.includes(window));
    if (!uniqueWindows.length || uniqueWindows.length !== attribution.windows.length) {
      return failure("unknown", "invalid_or_duplicate_attribution_window", hashInput);
    }
    attributionParameters = { action_attribution_windows: uniqueWindows.join(",") };
  }

  const requestedBreakdowns = input.breakdowns ?? [];
  const expandedBreakdownCount = requestedBreakdowns.reduce((count, breakdown) =>
    count + (breakdown === "placement" ? 2 : 1), 0);
  const graphBreakdowns = canonicalBreakdowns(requestedBreakdowns);
  if (graphBreakdowns.length !== expandedBreakdownCount) {
    return failure("unknown", "duplicate_or_overlapping_breakdown", hashInput);
  }
  const breakdownCompatibility = META_BREAKDOWN_COMPATIBILITY_MATRIX.find((candidate) =>
    sameBreakdowns(candidate.graphBreakdowns, graphBreakdowns));
  if (!breakdownCompatibility) {
    return failure("unsupported", "breakdown_permutation_unsupported", hashInput);
  }

  const resolved = [...new Set(input.metrics)].sort(codePointCompare).map((metric) => ({ metric, value: resolveMetric(metric) }));
  const unresolved = resolved.find((entry) => !entry.value);
  if (unresolved) return failure("unsupported", `metric_source_unsupported:${unresolved.metric}`, hashInput);

  const actionExtractions = resolved.flatMap((entry) => entry.value?.actions ?? []);
  if (actionExtractions.length && !breakdownCompatibility.supportsActionContainers) {
    return failure("unsupported", "breakdown_action_combination_unsupported", hashInput);
  }
  if (breakdownCompatibility.offMetaActionPolicy === "unsupported") {
    if (actionExtractions.some((entry) => entry.destination === "off_meta")) {
      return failure("unsupported", "breakdown_off_meta_action_unsupported", hashInput);
    }
    if (actionExtractions.some((entry) => entry.destination === "mixed_or_account_dependent")) {
      return failure("unknown", "breakdown_action_destination_unknown", hashInput);
    }
  }

  const actionKey = (entry: MetaActionExtractionContract) => `${entry.container}:${entry.actionType}`;
  const uniqueActions = [...new Map(actionExtractions.map((entry) => [actionKey(entry), entry])).values()]
    .sort((left, right) => codePointCompare(actionKey(left), actionKey(right)));
  const sourceFields = [...new Set(resolved.flatMap((entry) => entry.value?.fields ?? []))].sort(codePointCompare);
  const fields = [...IDENTITY_FIELDS_BY_LEVEL[input.level], ...sourceFields];
  const parameters = Object.freeze({
    fields: fields.join(","),
    level: GRAPH_LEVEL_BY_LEVEL[input.level],
    time_increment: String(input.timeIncrement),
    ...(graphBreakdowns.length ? { breakdowns: graphBreakdowns.join(",") } : {}),
    ...(uniqueActions.length ? { action_breakdowns: "action_type" } : {}),
    ...attributionParameters,
  });
  const warnings = [
    ...(graphBreakdowns.length ? ["breakdown_values_are_estimated"] : []),
    ...(input.timeIncrement !== "all_days" && resolved.some((entry) => entry.value?.plan.aggregation === "non_additive")
      ? ["non_additive_metrics_must_remain_at_source_grain"] : []),
  ];
  const material = {
    catalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH,
    graphApiVersion: META_INSIGHT_CAPABILITY_GRAPH_VERSION,
    level: input.level,
    graphLevel: GRAPH_LEVEL_BY_LEVEL[input.level],
    fields,
    graphBreakdowns,
    parameters,
    metrics: resolved.map((entry) => entry.value!.plan),
    actionExtractions: uniqueActions,
    warnings,
  };
  return Object.freeze({
    status: "planned",
    catalogVersion: META_INSIGHT_CAPABILITY_CATALOG_VERSION,
    ...material,
    planHash: stableHash(material),
  });
}

type RawAction = Readonly<{ action_type?: unknown; value?: unknown }>;

function decimalText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : null;
}

function decimalToMinor(value: string, scale: number): number | null {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[3] ?? "";
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) return null;
  const normalizedFraction = fraction.slice(0, scale).padEnd(scale, "0");
  const minor = BigInt(`${match[1] ?? ""}${match[2]}${normalizedFraction}`);
  const numeric = Number(minor);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

export type MetaActionExtractionInput = Readonly<{
  contracts: readonly MetaActionExtractionContract[];
  actions?: unknown;
  actionValues?: unknown;
  currency?: string;
  minorUnitScale?: number;
  availability?: Readonly<Partial<Record<"actions" | "action_values", MetaFieldAvailability>>>;
}>;

function unavailableMetric(
  contract: MetaActionExtractionContract,
  availability: MetaFieldAvailability,
): MetaMetricValue {
  return Object.freeze({
    metricKey: contract.container,
    actionType: contract.actionType,
    aggregation: contract.aggregation,
    provenance: Object.freeze({
      field: contract.container,
      actionType: contract.actionType,
      extraction: "exact_action_type_only",
      capabilityCatalogVersion: META_INSIGHT_CAPABILITY_CATALOG_VERSION,
      capabilityCatalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH,
    }),
    availability,
  });
}

/** Extract only exact action types; never total or infer absent actions as zero. */
export function extractMetaActionMetrics(input: MetaActionExtractionInput): readonly MetaMetricValue[] {
  return [...input.contracts].sort((left, right) => codePointCompare(
    `${left.container}:${left.actionType}`,
    `${right.container}:${right.actionType}`,
  )).map((contract) => {
    const explicitAvailability = input.availability?.[contract.container];
    if (explicitAvailability) return unavailableMetric(contract, explicitAvailability);
    const container = contract.container === "actions" ? input.actions : input.actionValues;
    if (container === undefined) {
      return unavailableMetric(contract, { reason: "unknown", detail: "source_container_absent" });
    }
    if (!Array.isArray(container)) {
      return unavailableMetric(contract, { reason: "unknown", detail: "source_container_malformed" });
    }
    const matches = (container as readonly RawAction[]).filter((entry) =>
      entry && typeof entry === "object" && entry.action_type === contract.actionType);
    if (matches.length !== 1) {
      return unavailableMetric(contract, {
        reason: "unknown",
        detail: matches.length ? "duplicate_exact_action_type" : "exact_action_type_absent",
      });
    }
    const value = decimalText(matches[0]?.value);
    if (value === null) return unavailableMetric(contract, { reason: "unknown", detail: "action_value_malformed" });
    const provenance = Object.freeze({
      field: contract.container,
      actionType: contract.actionType,
      extraction: "exact_action_type_only",
      capabilityCatalogVersion: META_INSIGHT_CAPABILITY_CATALOG_VERSION,
      capabilityCatalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH,
    });
    if (contract.outputKind === "decimal") {
      return Object.freeze({
        metricKey: contract.container,
        actionType: contract.actionType,
        aggregation: contract.aggregation,
        valueDecimal: value,
        provenance,
      });
    }
    const currency = input.currency?.trim().toUpperCase();
    const minor = input.minorUnitScale === undefined ? null : decimalToMinor(value, input.minorUnitScale);
    if (!currency || minor === null) {
      return unavailableMetric(contract, { reason: "unknown", detail: "money_scale_or_currency_unknown" });
    }
    return Object.freeze({
      metricKey: contract.container,
      actionType: contract.actionType,
      aggregation: contract.aggregation,
      valueMinor: minor,
      currency,
      provenance,
    });
  });
}
