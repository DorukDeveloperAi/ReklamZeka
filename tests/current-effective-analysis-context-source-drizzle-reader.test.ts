import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleCurrentEffectiveAnalysisContextSourceReader } from "@/connectors/analyses/current-effective-analysis-context-source-drizzle-reader";
import type { CurrentDecisionCadence } from "@/connectors/decisions/current-decision-cadence-reader";
import type { CurrentReviewedGuidanceManifest } from "@/connectors/guidance/current-reviewed-guidance-reader";
import type { GuidanceCampaignSelection } from "@/connectors/guidance/guidance-campaign-selection-drizzle-repository";
import type { CurrentMetaHierarchyConfig } from "@/connectors/meta/current-meta-hierarchy-config-reader";
import { createGuidanceRegistry } from "@/domain/guidance/registry";
import { normalizeMetaAnalysisConfigSnapshotV2, META_ANALYSIS_CONFIG_SNAPSHOT_VERSION } from "@/domain/meta/analysis-config-projection";

const input = Object.freeze({ workspaceId: "61b10d7d-132c-4c6d-b49f-cddc9b10d025", accountRef: "account_primary",
  entityType: "campaign" as const, entityRef: "campaign_primary" });

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

describe("DrizzleCurrentEffectiveAnalysisContextSourceReader", () => {
  it("uses one repeatable read-only scope snapshot and explicitly remains not ready", async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: execute.mock.calls.length === 2
      ? [{ captured_at: "2026-08-10T15:00:00.000Z" }]
      : execute.mock.calls.length === 3 ? [{ workspace_ref: "workspace_primary" }]
        : [] }));
    const database = { execute, transaction: vi.fn(async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute })) };
    const metaAnalysisConfigSnapshot = normalizeMetaAnalysisConfigSnapshotV2({ version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
      workspaceId: input.workspaceId, externalAccountId: input.accountRef, capturedAt: "2026-08-10T15:00:00.000Z",
      campaigns: [{ externalCampaignId: input.entityRef, objective: { state: "known", value: "OUTCOME_LEADS" } }], adSets: [] });
    const hierarchy: CurrentMetaHierarchyConfig = { capturedAt: "2026-08-10T15:00:00.000Z", identity: {
      connectionRef: "connection_primary", accountRef: input.accountRef, campaignRef: input.entityRef, hierarchyRefs: [input.entityRef] },
      metaAnalysisConfigSnapshot, sourceSnapshotEvidence: {} as never };
    const readCurrent = vi.fn(async () => hierarchy);
    const readCurrentInTransaction = vi.fn(async () => ({ decision: {
      evaluatedAt: "2026-08-10T15:00:00.000Z", actionAuthority: "none",
    } } as CurrentDecisionCadence));
    const registry = createGuidanceRegistry({ workspaceId: input.workspaceId, sources: [{ id: "source_primary", workspaceId: input.workspaceId,
      sourceType: "owner_statement", title: "Source", sourceRef: "source:primary", sourceUrl: null, content: "Reviewed source",
      author: null, capturedAt: null, reviewedAt: null, reviewBy: null, status: "published", version: 1 }], cards: [{ id: "card_primary",
      workspaceId: input.workspaceId, sourceType: "owner_statement", sourceIds: ["source_primary"], title: "Quality", body: "Protect quality",
      rationale: null, strength: "should", topic: "quality", decisionKey: null, positionKey: null, authority: "guidance_only", status: "published",
      effectiveFrom: null, effectiveTo: null, ownerRef: "owner_primary", version: 1 }], bindings: [{ id: "binding_primary", workspaceId: input.workspaceId,
      cardId: "card_primary", facet: "global", value: null, entityType: null, mode: "default", priority: 1, version: 1 }], sets: [{ id: "set_primary",
      workspaceId: input.workspaceId, name: "Primary", orderedCardIds: ["card_primary"], reviewStatus: "reviewed", version: 1 }] });
    const setHash = digest(registry.sets[0]);
    const readCurrentGuidance = vi.fn(async () => ({ capturedAt: "2026-08-10T15:00:00.000Z", registryHash: registry.registryHash, registry,
      reviewedSets: [{ setRef: "set_primary", setVersion: 1, setHash, cards: [] }] } as CurrentReviewedGuidanceManifest));
    const readCurrentSelection = vi.fn(async () => ({ selectionRef: "guidance_selection_primary", revision: 1,
      selectedSetRef: "set_primary", selectedSetVersion: 1, selectedSetHash: setHash, topics: ["quality"],
      requiredTopics: [], budget: { maxCards: 10, maxSources: 20, maxCharacters: 1000 }, sourceSelectionHash: "b".repeat(64),
      effectiveAt: "2026-08-10T15:00:00.000Z", previousSelectionHash: "GENESIS", selectionHash: "c".repeat(64) } as GuidanceCampaignSelection));
    const resolveInTransaction = vi.fn(async () => ({ workspaceId: input.workspaceId,
      dimensions: [{ values: [{ key: "lead" }], frozenContext: { dimension: { key: "service" }, path: [{ id: input.entityRef }] } }] }));
    const result = await new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never,
      { readCurrent }, { readCurrentInTransaction }, { readCurrentInTransaction: readCurrentGuidance },
      { readCurrentInTransaction: readCurrentSelection }, { resolveInTransaction } as never).loadCurrent(input);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never).sql.toLowerCase()).toContain("repeatable read, read only");
    expect(result).toEqual({ status: "not_ready", capturedAt: "2026-08-10T15:00:00.000Z",
      reason: "current_source_bundle_unavailable", capabilities: {
        canCompose: false, canAuthorizeAction: false, canExecute: false, canExecuteWrite: false, canWriteMeta: false, canApprove: false,
        canSchedule: false, canCallTool: false, canAccessNetwork: false, canQuerySql: false,
      } });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(readCurrent).toHaveBeenCalledWith(expect.anything(), input);
    expect(readCurrentInTransaction).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: input.workspaceId, accountRef: input.accountRef, campaignRef: input.entityRef,
    }, "2026-08-10T15:00:00.000Z");
    expect(readCurrentGuidance).toHaveBeenCalledWith(expect.anything(), input.workspaceId, "2026-08-10T15:00:00.000Z");
    expect(readCurrentSelection).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: input.workspaceId, accountRef: input.accountRef, campaignRef: input.entityRef,
    }, "2026-08-10T15:00:00.000Z");
    expect(resolveInTransaction).toHaveBeenCalledWith(expect.anything(), "workspace_primary", input.workspaceId,
      { level: "campaign", id: input.entityRef });
  });

  it("does not claim a source scope when the tenant/account read is missing or ambiguous", async () => {
    for (const rows of [[], [{ captured_at: "2026-08-10T15:00:00.000Z" }, { captured_at: "2026-08-10T15:00:00.000Z" }]]) {
      const execute = vi.fn(async (_query: unknown) => ({ rows }));
      const database = { execute, transaction: async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute }) };
      await expect(new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never).loadCurrent(input)).rejects.toThrow("scope_not_found");
    }
  });
});
