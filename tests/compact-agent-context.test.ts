import { describe, expect, it } from "vitest";
import { buildAnalysisAgenda } from "@/analyses/agenda";
import { buildCompactAgentContext, CompactAgentContextError } from "@/analyses/compact-agent-context";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { buildDeterministicFindings } from "@/analyses/finding-engine";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";
import { analyze } from "@/analyses/deterministic-analysis";

function fixture() {
  const workspaceId = "workspace-internal";
  const source = { id: "source-internal", workspaceId, sourceType: "owner_statement" as const, title: "Source", sourceRef: "owner:budget", sourceUrl: null, content: "Protect budget", author: "owner", capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: null, reviewBy: null, status: "published" as const, version: 1 };
  const cards = ["budget", "testing", "creative"].map((topic, index) => ({ id: `card-internal-${index}`, workspaceId, sourceType: "owner_statement" as const, sourceIds: [source.id], title: `${topic} title`, body: `${topic} body`, rationale: null, strength: "should" as const, topic, decisionKey: null, positionKey: null, authority: "guidance_only" as const, status: "published" as const, effectiveFrom: null, effectiveTo: null, ownerRef: "owner", version: 1 }));
  const guidance = buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId, sources: [source], cards, sets: [], bindings: cards.map((card, index) => ({ id: `binding-${index}`, workspaceId, cardId: card.id, facet: "global" as const, value: null, entityType: null, mode: "default" as const, priority: 10 - index, version: 1 })) }), { workspaceId, accountId: "account-internal", objective: "sales", internalCategoryIds: [], entity: { type: "campaign", id: "campaign-internal" }, topics: cards.map((card) => card.topic), requiredTopics: [], evaluatedAt: "2026-08-07T00:00:00.000Z", budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 } });
  const context = buildEffectiveCampaignContext({ workspaceId, capturedAt: "2026-08-07T00:00:00.000Z", identity: { connectionRef: "connection-internal", accountRef: "account-internal", campaignRef: "campaign-internal", entityRef: "campaign-internal", entityType: "campaign", hierarchyRefs: ["campaign-internal"] }, meta: { objective: { state: "known", value: "sales" }, optimizationEvent: { state: "known", value: "purchase" }, configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" }, budgetOwnerRef: { state: "known", value: "campaign-internal" }, targetingSignature: { state: "unknown", reason: "not_observed" }, actorRef: { state: "known", value: "actor-internal" }, destinationRef: { state: "known", value: null } }, categories: [], guidance, policies: [], cadence: { profileRef: "cadence-internal", decision: "eligible", reason: "window", cooldownUntil: null }, data: { trustStatus: "ready", snapshotRefs: ["snapshot-internal"], featureRefs: [], windowRefs: [], blockers: [] }, history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] }, versions: { metaCatalog: "1", categoryResolver: "1", guidanceRegistry: "1", metricCatalog: "1", formulaCatalog: "1", timeframeResolver: "1" } });
  const timeframe = resolveAnalysisTimeframe({ timeframe: { kind: "rolling", days: 7, timezone: "Europe/Istanbul" }, comparison: "previous_period", asOf: context.capturedAt });
  const agenda = buildAnalysisAgenda({ context, resolvedTimeframe: timeframe, requestedPasses: ["entity"] });
  const analysis = analyze({ definitionRef: "definition-internal", contextRef: context.contextHash, resolvedTimeframe: timeframe, snapshotRefs: ["snapshot-internal"], candidates: ["spendMinor", "purchases", "revenueMinor"].map((metricKey, index) => ({ entityRef: "campaign-internal", metricKey, checkKey: `check-${index}`, status: "finding" as const, sourceSnapshotRefs: ["snapshot-internal"] })) });
  const findingRun = buildDeterministicFindings({ agenda, context, analysis, hierarchy: [{ entityRef: "campaign-internal", entityType: "campaign", parentEntityRef: null }], metricBundles: [] });
  return { context, agenda, findingRun };
}

describe("compact agent context", () => {
  it("is deterministic, public-safe, bounded, and explicit about omitted material", () => {
    const input = fixture();
    const first = buildCompactAgentContext({ ...input, budget: { maxEntities: 1, maxFindings: 1, maxGuidanceCards: 1, maxSources: 1, maxTimeSeriesPoints: 1, maxDrillDowns: 1 } });
    const replay = buildCompactAgentContext({ ...input, budget: { maxEntities: 1, maxFindings: 1, maxGuidanceCards: 1, maxSources: 1, maxTimeSeriesPoints: 1, maxDrillDowns: 1 } });
    expect(replay).toEqual(first);
    expect(first.budget).toMatchObject({ used: { findings: 1, guidanceCards: 1 }, omitted: { findings: 2, guidanceCards: 2 }, truncated: true, moreAvailable: true });
    expect(first.budget.reasons).toEqual(expect.arrayContaining(["finding_limit", "guidance_card_limit"]));
    expect(first.capabilities).toEqual({ containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false });
    const serialized = JSON.stringify(first);
    for (const secret of ["workspace-internal", "account-internal", "campaign-internal", "snapshot-internal", "connection-internal", "card-internal", "source-internal"]) expect(serialized).not.toContain(secret);
  });

  it("rejects mismatched or tampered frozen components", () => {
    const input = fixture();
    expect(() => buildCompactAgentContext({ ...input, findingRun: { ...input.findingRun, contextHash: "0".repeat(64) } })).toThrowError(CompactAgentContextError);
    expect(() => buildCompactAgentContext({ ...input, agenda: { ...input.agenda, passes: [] } })).toThrowError(CompactAgentContextError);
    expect(() => buildCompactAgentContext({ ...input, rawPayload: { accessToken: "forbidden" } } as never)).toThrowError(CompactAgentContextError);
  });
});
