import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { DrizzleFrozenDiagnosticEvidenceRepository, FrozenDiagnosticEvidenceRepositoryError } from "@/connectors/analyses/frozen-diagnostic-evidence-drizzle-repository";

const workspaceId = "00000000-0000-4000-8000-000000000101";
const contextId = "00000000-0000-4000-8000-000000000102";

function context(overrides: Partial<EffectiveCampaignContext> = {}): EffectiveCampaignContext {
  return {
    workspaceId, capturedAt: "2026-08-11T12:00:00.000Z", schemaVersion: "effective-campaign-context/1.0.0",
    contextHash: "a".repeat(64), identity: { connectionRef: "connection_test", accountRef: "account_test", campaignRef: "campaign_test", entityType: "campaign", entityRef: "campaign_test", hierarchyRefs: ["campaign_test"] },
    meta: { objective: { state: "known", value: "sales" }, optimizationEvent: { state: "known", value: "purchase" } },
    metaAnalysisConfigEvidence: { snapshot: { version: "meta-analysis-config/2.0.0", workspaceId, externalAccountId: "account_test", capturedAt: "2026-08-11T11:00:00.000Z", campaigns: [], adSets: [] } },
    categories: [{ dimension: { id: "dimension_test" }, resolutionHash: "b".repeat(64), profileBindings: [] }], policies: [],
    data: { trustStatus: "ready", blockers: [], featureRefs: ["feature_aaaaaaaaaaaaaaaaaaaaaaaa"], windowRefs: ["window_bbbbbbbbbbbbbbbbbbbbbbbb"], snapshotRefs: ["snapshot_test"] },
    ...overrides,
  } as unknown as EffectiveCampaignContext;
}

describe("DrizzleFrozenDiagnosticEvidenceRepository", () => {
  it("persists only exact ready context facts with a closed capability envelope", async () => {
    const calls: string[] = []; const dialect = new PgDialect();
    const database = { execute: vi.fn(async (query) => {
      calls.push(dialect.sqlToQuery(query).sql);
      return calls.length === 1 ? { rows: [{ feature_ref: "feature_aaaaaaaaaaaaaaaaaaaaaaaa", feature_hash: "c".repeat(64), window_ref: "window_bbbbbbbbbbbbbbbbbbbbbbbb", window_hash: "d".repeat(64), context_hash: "a".repeat(64), captured_at: "2026-08-11 12:00:00+00" }] } : { rows: [{ id: "00000000-0000-4000-8000-000000000103" }] };
    }) };
    const result = await new DrizzleFrozenDiagnosticEvidenceRepository().saveInTransaction(database as never, { contextId, context: context() });
    expect(result).toBe("inserted");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("insert into frozen_diagnostic_evidence");
    expect(calls[1]).toContain("canAccessNetwork");
    expect(calls[1]).toContain("on conflict (context_id) do nothing");
  });

  it.each([
    ["not-ready", context({ data: { trustStatus: "not_ready", blockers: ["analysis_window_not_bound"], featureRefs: [], windowRefs: [], snapshotRefs: ["snapshot_test"] } })],
    ["missing config", context({ metaAnalysisConfigEvidence: undefined })],
    ["missing category", context({ categories: [] })],
  ])("fails closed without a query when %s facts are insufficient", async (_label, candidate) => {
    const database = { execute: vi.fn() };
    await expect(new DrizzleFrozenDiagnosticEvidenceRepository().saveInTransaction(database as never, { contextId, context: candidate }))
      .rejects.toMatchObject({ code: "insufficient_evidence" } satisfies Partial<FrozenDiagnosticEvidenceRepositoryError>);
    expect(database.execute).not.toHaveBeenCalled();
  });
});
