import { describe, expect, it } from "vitest";
import { ANALYSIS_METRICS } from "@/analyses/schema";
import {
  META_ACTION_CAPABILITY_CATALOG,
  META_BREAKDOWN_COMPATIBILITY_MATRIX,
  META_INSIGHT_CAPABILITY_CATALOG,
  META_INSIGHT_CAPABILITY_CATALOG_HASH,
  META_INSIGHT_CAPABILITY_CATALOG_VERSION,
  META_INSIGHT_SOURCE_FIELD_CATALOG,
  extractMetaActionMetrics,
  planMetaInsightQuery,
  type MetaInsightPlanInput,
} from "@/domain/meta/insights/capability-catalog";

const base = (overrides: Partial<MetaInsightPlanInput> = {}): MetaInsightPlanInput => ({
  graphApiVersion: "v23.0",
  level: "campaign",
  metrics: ["spendMinor", "impressions", "clicks", "conversions", "revenueMinor"],
  attribution: { mode: "account_default" },
  timeIncrement: 1,
  grantedPermissions: ["ads_read"],
  ...overrides,
});

describe("Meta Graph v23 insight capability catalog", () => {
  it("is versioned, deterministic and aligned with the complete metric formula vocabulary", () => {
    expect(META_INSIGHT_CAPABILITY_CATALOG_VERSION).toBe("meta-graph-v23-insight-capabilities/1.0.0");
    expect(META_INSIGHT_CAPABILITY_CATALOG.graphApiVersion).toBe("v23.0");
    expect(META_INSIGHT_CAPABILITY_CATALOG.catalogHash).toBe(META_INSIGHT_CAPABILITY_CATALOG_HASH);
    expect(META_INSIGHT_CAPABILITY_CATALOG_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(META_INSIGHT_CAPABILITY_CATALOG.metricCapabilities.map((entry) => entry.metric).sort())
      .toEqual([...ANALYSIS_METRICS].sort());
    expect(META_INSIGHT_CAPABILITY_CATALOG.formulaCatalogVersion).toBe("meta-metric-formulas/1.0.0");
  });

  it("distinguishes source, action container, non-additive and unsupported aliases", () => {
    expect(META_INSIGHT_SOURCE_FIELD_CATALOG.spend).toMatchObject({
      status: "supported", kind: "source", valueKind: "money_decimal", aggregation: "additive",
    });
    expect(META_INSIGHT_SOURCE_FIELD_CATALOG.reach).toMatchObject({
      status: "supported", aggregation: "non_additive",
    });
    expect(META_INSIGHT_SOURCE_FIELD_CATALOG.actions).toMatchObject({
      status: "supported", valueKind: "action_container", extraction: "exact_action_type_only",
    });
    expect(META_INSIGHT_SOURCE_FIELD_CATALOG.retention_d7).toEqual({
      status: "unsupported",
      graphField: "retention_d7",
      kind: "source",
      reason: "not_a_verified_graph_v23_source_field",
    });
    expect(META_ACTION_CAPABILITY_CATALOG.find((entry) => entry.container === "action_values"))
      .toMatchObject({ actionType: "purchase", outputKind: "money_minor", aggregation: "additive" });
  });

  it("documents the safe demographic, geo, placement and device/platform permutations", () => {
    const combinations = META_BREAKDOWN_COMPATIBILITY_MATRIX.map((entry) => entry.graphBreakdowns.join(","));
    expect(combinations).toEqual(expect.arrayContaining([
      "age", "gender", "age,gender", "country", "region", "publisher_platform",
      "publisher_platform,platform_position",
      "publisher_platform,platform_position,impression_device",
      "device_platform",
    ]));
    expect(META_BREAKDOWN_COMPATIBILITY_MATRIX.find((entry) => entry.graphBreakdowns[0] === "device_platform"))
      .toMatchObject({ supportsActionContainers: false });
  });
});

describe("Meta insight compatibility planner", () => {
  it("expands source and derived metrics without account IDs and emits exact action extraction contracts", () => {
    const plan = planMetaInsightQuery(base({ level: "ad_set", metrics: ["roas", "cpaMinor", "reach"] }));
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.graphLevel).toBe("adset");
    expect(plan.fields).toEqual(expect.arrayContaining([
      "account_id", "campaign_id", "adset_id", "date_start", "date_stop",
      "spend", "reach", "actions", "action_values",
    ]));
    expect(plan.fields).not.toContain("account-a");
    expect(plan.parameters).toMatchObject({
      level: "adset",
      time_increment: "1",
      action_breakdowns: "action_type",
      use_account_attribution_setting: "true",
    });
    expect(plan.metrics).toEqual(expect.arrayContaining([
      { metric: "cpaMinor", kind: "derived", aggregation: "derived" },
      { metric: "reach", kind: "source", aggregation: "non_additive" },
      { metric: "roas", kind: "derived", aggregation: "derived" },
    ]));
    expect(plan.actionExtractions).toEqual(expect.arrayContaining([
      expect.objectContaining({ container: "actions", actionType: "purchase", outputKind: "decimal" }),
      expect.objectContaining({ container: "action_values", actionType: "purchase", outputKind: "money_minor" }),
    ]));
    expect(plan.warnings).toContain("non_additive_metrics_must_remain_at_source_grain");
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("canonicalizes metric and demographic breakdown order into the same deterministic plan", () => {
    const first = planMetaInsightQuery(base({ metrics: ["clicks", "impressions"], breakdowns: ["gender", "age"] }));
    const second = planMetaInsightQuery(base({ metrics: ["impressions", "clicks"], breakdowns: ["age", "gender"] }));
    expect(first.status).toBe("planned");
    expect(second.status).toBe("planned");
    expect(first.planHash).toBe(second.planHash);
    if (first.status !== "planned") return;
    expect(first.parameters.breakdowns).toBe("age,gender");
    expect(first.warnings).toContain("breakdown_values_are_estimated");
  });

  it("expands placement intent and accepts only documented placement/device combinations", () => {
    const placement = planMetaInsightQuery(base({ metrics: ["impressions"], breakdowns: ["placement", "impression_device"] }));
    expect(placement.status).toBe("planned");
    if (placement.status === "planned") {
      expect(placement.parameters.breakdowns).toBe("publisher_platform,platform_position,impression_device");
    }

    expect(planMetaInsightQuery(base({ metrics: ["impressions"], breakdowns: ["platform_position"] })))
      .toMatchObject({ status: "unsupported", reasonCode: "breakdown_permutation_unsupported" });
    expect(planMetaInsightQuery(base({ metrics: ["impressions"], breakdowns: ["device_platform", "country"] })))
      .toMatchObject({ status: "unsupported", reasonCode: "breakdown_permutation_unsupported" });
  });

  it("fails closed for permission, version, unsupported metric, attribution and time constraints", () => {
    expect(planMetaInsightQuery(base({ grantedPermissions: [] }))).toMatchObject({
      status: "permission_missing",
      reasonCode: "ads_insights_read_permission_missing",
      availability: { reason: "permission_missing" },
    });
    expect(planMetaInsightQuery(base({ graphApiVersion: "v24.0" }))).toMatchObject({
      status: "unknown", reasonCode: "graph_version_not_catalogued",
    });
    expect(planMetaInsightQuery(base({ metrics: ["retentionD7"] }))).toMatchObject({
      status: "unsupported", reasonCode: "metric_source_unsupported:retentionD7",
    });
    expect(planMetaInsightQuery(base({ attribution: { mode: "explicit_windows", windows: ["1d_click", "1d_click"] } })))
      .toMatchObject({ status: "unknown", reasonCode: "invalid_or_duplicate_attribution_window" });
    expect(planMetaInsightQuery(base({ timeIncrement: 91 })))
      .toMatchObject({ status: "unknown", reasonCode: "invalid_time_increment" });
  });

  it("applies the official region restriction without guessing mixed action destinations", () => {
    expect(planMetaInsightQuery(base({ metrics: ["conversions"], breakdowns: ["region"] })))
      .toMatchObject({ status: "unsupported", reasonCode: "breakdown_off_meta_action_unsupported" });
    expect(planMetaInsightQuery(base({ metrics: ["leads"], breakdowns: ["region"] })))
      .toMatchObject({ status: "unknown", reasonCode: "breakdown_action_destination_unknown" });
    expect(planMetaInsightQuery(base({ metrics: ["engagements"], breakdowns: ["region"] }))).toMatchObject({ status: "planned" });
    expect(planMetaInsightQuery(base({ metrics: ["conversions"], breakdowns: ["device_platform"] })))
      .toMatchObject({ status: "unsupported", reasonCode: "breakdown_action_combination_unsupported" });
  });
});

describe("Meta action/action-value extraction contract", () => {
  const contracts = [
    { container: "actions", actionType: "purchase", outputKind: "decimal", aggregation: "additive", destination: "off_meta" },
    { container: "action_values", actionType: "purchase", outputKind: "money_minor", aggregation: "additive", destination: "off_meta" },
  ] as const;

  it("extracts exact action types and converts monetary decimal text without floating point", () => {
    const metrics = extractMetaActionMetrics({
      contracts,
      actions: [
        { action_type: "post_engagement", value: "200" },
        { action_type: "purchase", value: "3" },
      ],
      actionValues: [{ action_type: "purchase", value: "1250.50" }],
      currency: "try",
      minorUnitScale: 2,
    });
    expect(metrics).toEqual([
      expect.objectContaining({ metricKey: "action_values", actionType: "purchase", valueMinor: 125050, currency: "TRY" }),
      expect.objectContaining({ metricKey: "actions", actionType: "purchase", valueDecimal: "3" }),
    ]);
    expect(metrics.every((metric) => metric.provenance.extraction === "exact_action_type_only")).toBe(true);
  });

  it("never totals hierarchical actions or infers absent and malformed values as zero", () => {
    const absent = extractMetaActionMetrics({
      contracts: [contracts[0]],
      actions: [{ action_type: "post_engagement", value: "10" }, { action_type: "link_click", value: "4" }],
    });
    expect(absent[0]).toMatchObject({ availability: { reason: "unknown", detail: "exact_action_type_absent" } });
    expect(absent[0]).not.toHaveProperty("valueDecimal");

    const duplicate = extractMetaActionMetrics({
      contracts: [contracts[0]],
      actions: [{ action_type: "purchase", value: "1" }, { action_type: "purchase", value: "2" }],
    });
    expect(duplicate[0]).toMatchObject({ availability: { reason: "unknown", detail: "duplicate_exact_action_type" } });

    const fractionalMinor = extractMetaActionMetrics({
      contracts: [contracts[1]], actionValues: [{ action_type: "purchase", value: "1.001" }],
      currency: "TRY", minorUnitScale: 2,
    });
    expect(fractionalMinor[0]).toMatchObject({ availability: { reason: "unknown", detail: "money_scale_or_currency_unknown" } });
  });

  it("propagates permission_missing availability without inspecting a payload", () => {
    const metrics = extractMetaActionMetrics({
      contracts: [contracts[0]],
      actions: [{ action_type: "purchase", value: "99" }],
      availability: { actions: { reason: "permission_missing", detail: "ads_read" } },
    });
    expect(metrics[0]).toMatchObject({ availability: { reason: "permission_missing", detail: "ads_read" } });
    expect(metrics[0]).not.toHaveProperty("valueDecimal");
  });
});
