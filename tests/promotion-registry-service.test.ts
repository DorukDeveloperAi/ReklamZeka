import { describe, expect, it, vi } from "vitest";

import {
  PromotionRegistryService,
  publicPromotionRegistryReferences,
  type PromotionRegistryRepository,
} from "@/application/promotion-registry-service";
import {
  DrizzlePromotionRegistryRepository,
  promotionRegistryPublicRef,
} from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import * as schema from "@/db/schema";
import {
  AUDIENCE_PRESET_VERSION,
  PROMOTION_TEMPLATE_BINDING_VERSION,
  PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

const hash = "a".repeat(64);
const workspaceRef = "workspace_registry";

function registry(refs: Readonly<{
  accountRef: string;
  actorRef: string;
  categoryRef: string;
  campaignRef: string | null;
}> = { accountRef: "account_123", actorRef: "actor_123", categoryRef: "category_123", campaignRef: null }) {
  const preset = createAudiencePresetRevision({
    version: AUDIENCE_PRESET_VERSION, workspaceRef, presetRef: "audience_preset_hair", revision: 1,
    aliases: ["Saç ekimi"], state: "published",
    source: { kind: "frozen_targeting_spec", sourceRef: "source_hair", targetingHash: hash, provenanceHash: "b".repeat(64) },
    targeting: { geoRefs: ["geo_istanbul"], languages: ["language_tr"], ageMin: 25, ageMax: 55,
      inclusionRefs: ["interest_hair"], exclusionRefs: [] },
    publishedAt: "2026-08-07T12:00:00.000Z",
  });
  const template = createPromotionTemplateRevision({
    version: PROMOTION_TEMPLATE_VERSION, workspaceRef, templateRef: "template_existing_post", revision: 1,
    aliases: ["Gönderi öne çıkar"], state: "published", accountRefs: [refs.accountRef], actorTypes: ["instagram"],
    internalCategoryRefs: [refs.categoryRef], postTypes: ["image"], objectiveRef: "objective_messages",
    optimizationGoalRef: "optimization_conversations", destinationRef: "destination_instagram",
    placementRefs: ["placement_feed"], namingRuleRef: "naming_default", trackingRuleRef: "tracking_default",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision, presetHash: preset.presetHash },
    budget: { ownerLevel: "adset", currency: "TRY", kind: "daily", defaultDecimal: "1000",
      minimumDecimal: "100", maximumDecimal: "5000", budgetPlanVersionRef: "budget_plan_1" },
    timeframe: { timeframeRef: "timeframe_week", scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-07T12:01:00.000Z",
  });
  const binding = createPromotionTemplateBinding({
    version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef, bindingRef: "binding_hair_instagram",
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    accountRef: refs.accountRef, actor: { type: "instagram", actorRef: refs.actorRef },
    internalCategoryRefs: [refs.categoryRef], campaignRef: refs.campaignRef,
    effectiveFrom: "2026-08-07T12:02:00.000Z", expiresAt: null,
  }, template);
  return { preset, template, binding };
}

describe("PromotionRegistryService", () => {
  it("publishes canonical immutable documents and returns only opaque refs", async () => {
    const value = registry();
    const refs = publicPromotionRegistryReferences(value);
    const repository: PromotionRegistryRepository = {
      publish: vi.fn(async () => ({ outcome: "inserted" as const, refs })),
      readRefs: vi.fn(async () => refs),
    };
    const service = new PromotionRegistryService(repository, workspaceRef);
    await expect(service.publish({ workspaceRef, ...value })).resolves.toEqual({ outcome: "inserted", refs });
    await expect(service.read({ workspaceRef, bindingRef: value.binding.bindingRef })).resolves.toEqual(refs);
    expect(JSON.stringify(refs)).not.toContain(value.preset.presetHash);
    expect(JSON.stringify(refs)).not.toContain(value.template.templateHash);
    expect(refs).not.toHaveProperty("capabilities");
  });

  it("rejects a forged hash before the repository is called", async () => {
    const value = registry();
    const repository: PromotionRegistryRepository = { publish: vi.fn(), readRefs: vi.fn() };
    const service = new PromotionRegistryService(repository, workspaceRef);
    await expect(service.publish({ workspaceRef, ...value,
      preset: { ...value.preset, presetHash: "f".repeat(64) } })).rejects.toMatchObject({
      code: "integrity_rejected",
    });
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it("fails closed across workspace scope and malformed reads", async () => {
    const value = registry();
    const repository: PromotionRegistryRepository = { publish: vi.fn(), readRefs: vi.fn() };
    const service = new PromotionRegistryService(repository, workspaceRef);
    await expect(service.publish({ workspaceRef: "workspace_other", ...value })).rejects.toMatchObject({
      code: "workspace_scope_mismatch",
    });
    await expect(service.read({ workspaceRef, bindingRef: "bad" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

type Row = Record<string, unknown>;

class AtomicRegistryDatabase {
  private store = new Map<unknown, Row[]>();
  private transactionStore: Map<unknown, Row[]> | null = null;
  private sequence = 10;
  workspaceActive = true;
  failTable: unknown = null;

  constructor(seed: Readonly<{ accountId: string; actorId: string; categoryId: string; campaignId: string }>) {
    this.store.set(schema.adAccounts, [{ id: seed.accountId, workspaceId }]);
    this.store.set(schema.metaAssets, [{ id: seed.actorId, workspaceId, assetType: "instagram_account" }]);
    this.store.set(schema.categoryDefinitions, [{ id: seed.categoryId, workspaceId, archivedAt: null }]);
    this.store.set(schema.adCampaigns, [{ id: seed.campaignId, workspaceId, adAccountId: seed.accountId }]);
  }

  private active() { return this.transactionStore ?? this.store; }
  table(table: unknown): Row[] { return this.active().get(table) ?? []; }
  setTable(table: unknown, rows: Row[]) { this.active().set(table, rows); }
  execute = async () => ({ rows: this.workspaceActive ? [{ id: workspaceId }] : [] });
  select = () => ({
    from: (table: unknown) => {
      const read = () => Promise.resolve(this.table(table));
      const chain = {
        where: () => chain,
        limit: (limit: number) => Promise.resolve(this.table(table).slice(0, limit)),
        then: <T>(resolve: (value: Row[]) => T, reject?: (reason: unknown) => T) => read().then(resolve, reject),
      };
      return chain;
    },
  });
  insert = (table: unknown) => ({
    values: (input: Row | Row[]) => {
      let inserted: Row[] | null = null;
      const perform = async () => {
        if (inserted) return inserted;
        if (table === this.failTable) throw new Error("injected_failure");
        inserted = (Array.isArray(input) ? input : [input]).map((value) => ({
          ...value,
          id: value.id ?? `90000000-0000-4000-8000-${String(this.sequence++).padStart(12, "0")}`,
          createdAt: value.createdAt ?? new Date("2026-08-07T12:03:00.000Z"),
        }));
        this.setTable(table, [...this.table(table), ...inserted]);
        return inserted;
      };
      return {
        returning: () => perform(),
        then: <T>(resolve: (value: Row[]) => T, reject?: (reason: unknown) => T) => perform().then(resolve, reject),
      };
    },
  });
  transaction = async <T>(work: (transaction: AtomicRegistryDatabase) => Promise<T>): Promise<T> => {
    if (this.transactionStore) throw new Error("nested_transaction");
    this.transactionStore = new Map([...this.store].map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
    try {
      const result = await work(this);
      this.store = this.transactionStore;
      return result;
    } finally {
      this.transactionStore = null;
    }
  };
}

const workspaceId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000002";
const actorId = "30000000-0000-4000-8000-000000000003";
const categoryId = "40000000-0000-4000-8000-000000000004";
const campaignId = "50000000-0000-4000-8000-000000000005";

function persistedFixture() {
  const refs = {
    accountRef: promotionRegistryPublicRef("account", workspaceId, accountId),
    actorRef: promotionRegistryPublicRef("actor", workspaceId, actorId),
    categoryRef: promotionRegistryPublicRef("category", workspaceId, categoryId),
    campaignRef: promotionRegistryPublicRef("campaign", workspaceId, campaignId),
  };
  return { refs, value: registry(refs) };
}

describe("DrizzlePromotionRegistryRepository", () => {
  it("atomically inserts the full graph, replays unchanged, and reads refs only", async () => {
    const database = new AtomicRegistryDatabase({ accountId, actorId, categoryId, campaignId });
    const repository = new DrizzlePromotionRegistryRepository(database as never, workspaceId, workspaceRef);
    const { value } = persistedFixture();
    await expect(repository.publish(value)).resolves.toMatchObject({ outcome: "inserted" });
    expect(database.table(schema.audiencePresetRevisions)).toHaveLength(1);
    expect(database.table(schema.promotionTemplateRevisions)).toHaveLength(1);
    expect(database.table(schema.promotionTemplateBindings)).toHaveLength(1);
    expect(database.table(schema.promotionTemplateBindingCategories)).toHaveLength(1);
    await expect(repository.publish(value)).resolves.toMatchObject({ outcome: "unchanged" });
    expect(database.table(schema.promotionTemplateBindings)).toHaveLength(1);
    const read = await repository.readRefs(value.binding.bindingRef);
    expect(read).toEqual(publicPromotionRegistryReferences(value));
    expect(JSON.stringify(read)).not.toContain(value.template.templateHash);
  });

  it("rolls back every row on a late category-edge failure", async () => {
    const database = new AtomicRegistryDatabase({ accountId, actorId, categoryId, campaignId });
    database.failTable = schema.promotionTemplateBindingCategories;
    const repository = new DrizzlePromotionRegistryRepository(database as never, workspaceId, workspaceRef);
    await expect(repository.publish(persistedFixture().value)).rejects.toMatchObject({ code: "record_conflict" });
    expect(database.table(schema.audiencePresetRevisions)).toHaveLength(0);
    expect(database.table(schema.promotionTemplateBindings)).toHaveLength(0);
  });

  it("rejects inactive tenants and missing foreign refs without writes", async () => {
    const database = new AtomicRegistryDatabase({ accountId, actorId, categoryId, campaignId });
    database.workspaceActive = false;
    const repository = new DrizzlePromotionRegistryRepository(database as never, workspaceId, workspaceRef);
    await expect(repository.publish(persistedFixture().value)).rejects.toMatchObject({ code: "workspace_scope_mismatch" });
    database.workspaceActive = true;
    database.setTable(schema.metaAssets, []);
    await expect(repository.publish(persistedFixture().value)).rejects.toMatchObject({ code: "foreign_reference_missing" });
    expect(database.table(schema.audiencePresetRevisions)).toHaveLength(0);
  });

  it("rejects replay conflicts and public-read payload corruption", async () => {
    const database = new AtomicRegistryDatabase({ accountId, actorId, categoryId, campaignId });
    const repository = new DrizzlePromotionRegistryRepository(database as never, workspaceId, workspaceRef);
    const { value } = persistedFixture();
    await repository.publish(value);
    const { presetHash: _presetHash, ...presetInput } = value.preset;
    const conflictingPreset = createAudiencePresetRevision({
      ...presetInput, targeting: { ...presetInput.targeting, ageMin: 26 },
    });
    const { templateHash: _templateHash, ...templateInput } = value.template;
    const conflictingTemplate = createPromotionTemplateRevision({
      ...templateInput,
      audiencePreset: { presetRef: conflictingPreset.presetRef, revision: conflictingPreset.revision,
        presetHash: conflictingPreset.presetHash },
    });
    const { bindingHash: _bindingHash, ...bindingInput } = value.binding;
    const conflictingBinding = createPromotionTemplateBinding({
      ...bindingInput,
      template: { templateRef: conflictingTemplate.templateRef, revision: conflictingTemplate.revision,
        templateHash: conflictingTemplate.templateHash },
    }, conflictingTemplate);
    await expect(repository.publish({ preset: conflictingPreset, template: conflictingTemplate,
      binding: conflictingBinding })).rejects.toMatchObject({ code: "record_conflict" });
    const presetRow = database.table(schema.audiencePresetRevisions)[0]!;
    presetRow.payload = { ...(presetRow.payload as Row), presetHash: "f".repeat(64) };
    await expect(repository.readRefs(value.binding.bindingRef)).rejects.toMatchObject({ code: "corrupt_store" });
  });
});
