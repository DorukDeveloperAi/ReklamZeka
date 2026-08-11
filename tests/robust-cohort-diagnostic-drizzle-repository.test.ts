import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { DrizzleRobustCohortDiagnosticRepository, RobustCohortDiagnosticRepositoryError } from "@/connectors/analyses/robust-cohort-diagnostic-drizzle-repository";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";

const workspaceId = "00000000-0000-4000-8000-000000000101";
const targetEvidenceId = "00000000-0000-4000-8000-000000000102";
function feature(entityRef: string, value: number) {
  const row = normalizeMetaDailyInsight({ schemaVersion: 1, workspaceId: "workspace", metaConnectionId: "connection", adAccountId: "account", entityLevel: "campaign", externalEntityId: entityRef, dateStart: "2026-08-01", dateStop: "2026-08-01", attributionLabel: "default", currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "1", sourcePayloadHash: `hash-${entityRef}`, metricProvenance: {}, metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: value, currency: "TRY", provenance: {} }] });
  return buildDeterministicFeatureSnapshot({ scope: { workspaceId, metaConnectionId: "00000000-0000-4000-8000-000000000103", adAccountId: "00000000-0000-4000-8000-000000000104", entityLevel: "campaign", externalEntityId: entityRef }, observation: { observationRef: `observation_${entityRef}`, role: "primary", startDate: "2026-08-01", endDate: "2026-08-01", timezone: "Europe/Istanbul", sampleSize: 10, settled: true, qualityStatus: "ready", qualityReasonCodes: [], metricResult: aggregateMetaMetrics({ rows: [row], metrics: ["spendMinor"] }), snapshotRefs: [`snapshot_${entityRef}`] } });
}
const input = Object.freeze({ workspaceId, targetEvidenceId, metricKey: "spendMinor" as const, funnel: "conversion" as const, direction: "lower_is_better" as const, minimumSampleSize: 5, findingThresholdRobustZ: 2.5, occurredAt: "2026-08-11T12:00:00.000Z" });
function candidate(entityRef: string, value: number, evidenceId = `00000000-0000-4000-8000-0000000001${entityRef.at(-1)}`) {
  const frozen = feature(entityRef, value);
  const marker = ({ campaign_alpha: "a", campaign_beta: "b", campaign_gamma: "c", campaign_delta: "d" } as Record<string, string>)[entityRef]!;
  return { evidence_id: evidenceId, evidence_hash: marker.repeat(64), entity_ref: entityRef, feature_ref: frozen.featureRef, feature_hash: frozen.featureHash, feature_payload: frozen };
}

describe("DrizzleRobustCohortDiagnosticRepository", () => {
  it("repository-selects four exact compatible frozen members and persists only the advisory replay asset", async () => {
    const selected = [candidate("campaign_alpha", 10, targetEvidenceId), candidate("campaign_beta", 11, "00000000-0000-4000-8000-000000000106"), candidate("campaign_gamma", 12, "00000000-0000-4000-8000-000000000107"), candidate("campaign_delta", 30, "00000000-0000-4000-8000-000000000108")];
    const calls: string[] = []; const dialect = new PgDialect();
    const database = { transaction: vi.fn(async (work) => work(database)), execute: vi.fn(async (query) => {
      calls.push(dialect.sqlToQuery(query).sql);
      if (calls.length === 1) return { rows: [{ id: workspaceId }] };
      if (calls.length === 2) return { rows: selected };
      if (calls.length === 3) return { rows: [{ objective: "sales", funnel: "conversion", optimization_event: "purchase", category_cohort_profile_hash: "a".repeat(64), policy_set_hash: "b".repeat(64) }] };
      return { rows: [{ id: "00000000-0000-4000-8000-000000000105" }] };
    }) };
    const result = await new DrizzleRobustCohortDiagnosticRepository(database as never).materialize(input);
    expect(result).toMatchObject({ outcome: "inserted", cohortRef: expect.stringMatching(/^cohort_[a-f0-9]{24}$/), result: { median: 11.5, medianAbsoluteDeviation: 1 }, capabilities: { canAuthorizeAction: false, canAccessNetwork: false } });
    expect(result.result.assessments.find((assessment) => assessment.entityRef === "campaign_delta")).toMatchObject({ status: "finding", reason: "outlier_against_cohort" });
    expect(calls[1]).toContain("join target");
    expect(calls[1]).toContain("target.ad_account_id = context.ad_account_id");
    expect(calls[1]).toContain("category_cohort_profile_hash");
    expect(calls[1]).toContain("policy_set_hash");
    expect(calls[3]).toContain("insert into robust_cohort_diagnostic_assets");
    expect(calls[3]).toContain("on conflict (workspace_id, cohort_hash) do nothing");
  });

  it("fails closed before persistence when selector cannot return four exact repository members", async () => {
    let calls = 0; const database = { transaction: vi.fn(async (work) => work(database)), execute: vi.fn(async () => ({ rows: ++calls === 1 ? [{ id: workspaceId }] : [] })) };
    await expect(new DrizzleRobustCohortDiagnosticRepository(database as never).materialize(input))
      .rejects.toMatchObject({ code: "not_found" } satisfies Partial<RobustCohortDiagnosticRepositoryError>);
    expect(database.execute).toHaveBeenCalledTimes(2);
  });

  it("has no caller-controlled member list in its public materialization contract", () => {
    const source = DrizzleRobustCohortDiagnosticRepository.prototype.materialize.toString();
    expect(source).toContain("join target");
    expect(source).toContain("minimumMemberCount: 4");
  });
});
