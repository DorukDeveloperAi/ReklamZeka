import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildEffectiveCampaignContext, type EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import {
  DrizzleEffectiveCampaignContextRepository,
  EffectiveCampaignContextRepositoryError,
  sourceComponentsOf,
} from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension } from "@/domain/categories/registry";
import {
  buildEffectiveGuidancePack,
  createGuidanceRegistry,
  type GuidanceCard,
  type GuidanceSource,
} from "@/domain/guidance/registry";

const workspaceId = "00000000-0000-0000-0000-000000000101";
const snapshotRef = "snapshot_aaaaaaaaaaaaaaaaaaaa";

function guidance() {
  const source: GuidanceSource = {
    id: "source-1", workspaceId, sourceType: "owner_statement", title: "Owner",
    sourceRef: "owner:1", sourceUrl: null, content: "Protect budget", author: "owner",
    capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z",
    reviewBy: null, status: "published", version: 1,
  };
  const card: GuidanceCard = {
    id: "card-1", workspaceId, sourceType: "owner_statement", sourceIds: [source.id],
    title: "Protection", body: "Do not reallocate protected budget", rationale: null,
    strength: "must", topic: "budget", decisionKey: null, positionKey: null,
    authority: "guidance_only", status: "published", effectiveFrom: null, effectiveTo: null,
    ownerRef: "owner-1", version: 1,
  };
  const registry = createGuidanceRegistry({
    workspaceId, sources: [source], cards: [card], sets: [],
    bindings: [{
      id: "binding-1", workspaceId, cardId: card.id, facet: "global", value: null,
      entityType: null, mode: "default", priority: 10, version: 1,
    }],
  });
  return buildEffectiveGuidancePack(registry, {
    workspaceId, accountId: "account-1", objective: "lead_generation", internalCategoryIds: ["category-1"],
    entity: { type: "campaign", id: "campaign-1" }, topics: ["budget"], requiredTopics: ["budget"],
    evaluatedAt: "2026-08-07T12:00:00.000Z",
    budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
  });
}

function category() {
  const dimension: CategoryDimension = {
    id: "dimension-1", workspaceId, key: "protection", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null,
  };
  const definition: CategoryDefinition = {
    id: "category-1", workspaceId, dimensionId: dimension.id, key: "protected",
    label: "Protected", version: 1, archivedAt: null,
  };
  return resolveEffectiveCategory({
    dimension, definitions: [definition], path: { workspaceId, nodes: [{ level: "campaign", id: "campaign-1" }] },
    assignments: [{
      id: "assignment-1", workspaceId, dimensionId: dimension.id, definitionId: definition.id,
      entity: { level: "campaign", id: "campaign-1" }, operation: "add", source: "manual",
      manualLock: true, evidence: [{ kind: "owner", ref: "statement-1" }], confidence: 1,
      version: 1, archivedAt: null,
    }],
  }).frozenContext;
}

function context() {
  const input: EffectiveCampaignContextInput = {
    workspaceId, capturedAt: "2026-08-07T12:00:00.000Z",
    identity: {
      connectionRef: "connection-1", accountRef: "account-1", campaignRef: "campaign-1",
      entityRef: "campaign-1", entityType: "campaign", hierarchyRefs: ["campaign-1"],
    },
    meta: {
      objective: { state: "known", value: "lead_generation" },
      optimizationEvent: { state: "known", value: "lead" },
      configuredStatus: { state: "known", value: "ACTIVE" },
      effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: "campaign-1" },
      targetingSignature: { state: "unknown", reason: "not_observed" },
      actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null },
    },
    categories: [category()], guidance: guidance(), policies: [],
    cadence: { profileRef: "cadence-1", decision: "observe", reason: "stable_window", cooldownUntil: null },
    data: {
      trustStatus: "ready", snapshotRefs: [snapshotRef], featureRefs: [], windowRefs: [], blockers: [],
    },
    history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: {
      metaCatalog: "meta-v1", categoryResolver: "category-v1", guidanceRegistry: "guidance-v1",
      metricCatalog: "metric-v1", formulaCatalog: "formula-v1", timeframeResolver: "timeframe-v1",
    },
  };
  return buildEffectiveCampaignContext(input);
}

describe("effective campaign context persistence contract", () => {
  it("derives deterministic exact source component/version references", () => {
    const components = sourceComponentsOf(context());
    expect(components).toContainEqual({
      componentType: "source_snapshot", componentRef: snapshotRef, componentVersion: snapshotRef,
    });
    expect(components).toContainEqual({
      componentType: "category_resolution", componentRef: "dimension-1",
      componentVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(components).toContainEqual({
      componentType: "metric_catalog", componentRef: "metric-catalog", componentVersion: "metric-v1",
    });
    expect(sourceComponentsOf(context())).toEqual(components);
  });

  it("rejects an inauthentic context before opening a database transaction", async () => {
    const database = { transaction: vi.fn() };
    const repository = new DrizzleEffectiveCampaignContextRepository(database as never);
    await expect(repository.save({ ...context(), contextHash: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "invalid_input" } satisfies Partial<EffectiveCampaignContextRepositoryError>);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("keeps the generated migration create-only, private and source-scope indexed", () => {
    const migration = readFileSync("drizzle/20260807134751_handy_nekra.sql", "utf8");
    for (const table of [
      "effective_campaign_contexts",
      "effective_campaign_context_components",
      "effective_campaign_context_invalidations",
    ]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM PUBLIC, anon, authenticated`);
    }
    expect(migration).toContain("effective_campaign_context_components_lookup_idx");
    expect(migration).toContain("effective_campaign_context_components_context_scope_fk");
    expect(migration.indexOf("effective_campaign_contexts_workspace_id_unique"))
      .toBeLessThan(migration.indexOf("effective_campaign_context_components_context_scope_fk"));
    for (const [indexName, foreignKeyName] of [
      ["meta_connections_workspace_id_unique", "effective_campaign_contexts_connection_scope_fk"],
      ["ad_accounts_workspace_id_unique", "effective_campaign_contexts_account_scope_fk"],
      ["ad_campaigns_workspace_id_unique", "effective_campaign_contexts_campaign_scope_fk"],
    ]) {
      expect(migration.indexOf(indexName!)).toBeLessThan(migration.indexOf(foreignKeyName!));
    }
    expect(migration).toContain("effective_campaign_contexts_payload_scope_exact");
    expect(migration).toContain("effective_campaign_contexts_no_authority");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
    expect(migration).not.toContain("DROP CONSTRAINT");
  });
});
