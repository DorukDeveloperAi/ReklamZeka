import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleCurrentEffectiveAnalysisContextSourceReader } from "@/connectors/analyses/current-effective-analysis-context-source-drizzle-reader";
import type { CurrentDecisionCadence } from "@/connectors/decisions/current-decision-cadence-reader";
import type { CurrentReviewedGuidanceManifest } from "@/connectors/guidance/current-reviewed-guidance-reader";
import type { CurrentMetaHierarchyConfig } from "@/connectors/meta/current-meta-hierarchy-config-reader";

const input = Object.freeze({ workspaceId: "61b10d7d-132c-4c6d-b49f-cddc9b10d025", accountRef: "account_primary",
  entityType: "campaign" as const, entityRef: "campaign_primary" });

describe("DrizzleCurrentEffectiveAnalysisContextSourceReader", () => {
  it("uses one repeatable read-only scope snapshot and explicitly remains not ready", async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: [{ captured_at: "2026-08-10T15:00:00.000Z" }] }));
    const database = { execute, transaction: vi.fn(async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute })) };
    const hierarchy: CurrentMetaHierarchyConfig = { capturedAt: "2026-08-10T15:00:00.000Z", identity: {
      connectionRef: "connection_primary", accountRef: input.accountRef, campaignRef: input.entityRef, hierarchyRefs: [input.entityRef] },
      metaAnalysisConfigSnapshot: {} as never, sourceSnapshotEvidence: {} as never };
    const readCurrent = vi.fn(async () => hierarchy);
    const readCurrentInTransaction = vi.fn(async () => ({ decision: {
      evaluatedAt: "2026-08-10T15:00:00.000Z", actionAuthority: "none",
    } } as CurrentDecisionCadence));
    const readCurrentGuidance = vi.fn(async () => ({ capturedAt: "2026-08-10T15:00:00.000Z", registryHash: "a".repeat(64),
      reviewedSets: [] } as CurrentReviewedGuidanceManifest));
    const result = await new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never,
      { readCurrent }, { readCurrentInTransaction }, { readCurrentInTransaction: readCurrentGuidance }).loadCurrent(input);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never).sql.toLowerCase()).toContain("repeatable read, read only");
    expect(result).toEqual({ status: "not_ready", capturedAt: "2026-08-10T15:00:00.000Z",
      reason: "current_source_bundle_unavailable", capabilities: {
        canCompose: false, canAuthorizeAction: false, canExecute: false, canExecuteWrite: false, canWriteMeta: false, canApprove: false,
        canSchedule: false, canCallTool: false, canAccessNetwork: false, canQuerySql: false,
      } });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(readCurrent).toHaveBeenCalledWith(expect.anything(), input);
    expect(readCurrentInTransaction).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: input.workspaceId, accountRef: input.accountRef, campaignRef: input.entityRef,
    }, "2026-08-10T15:00:00.000Z");
    expect(readCurrentGuidance).toHaveBeenCalledWith(expect.anything(), input.workspaceId, "2026-08-10T15:00:00.000Z");
  });

  it("does not claim a source scope when the tenant/account read is missing or ambiguous", async () => {
    for (const rows of [[], [{ captured_at: "2026-08-10T15:00:00.000Z" }, { captured_at: "2026-08-10T15:00:00.000Z" }]]) {
      const execute = vi.fn(async (_query: unknown) => ({ rows }));
      const database = { execute, transaction: async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute }) };
      await expect(new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never).loadCurrent(input)).rejects.toThrow("scope_not_found");
    }
  });
});
