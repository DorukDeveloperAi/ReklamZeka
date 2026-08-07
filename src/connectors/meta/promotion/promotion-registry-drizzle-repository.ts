import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  publicPromotionRegistryReferences,
  type PromotionRegistryReferences,
  type PromotionRegistryRepository,
} from "@/application/promotion-registry-service";
import * as schema from "@/db/schema";
import {
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
  type AudiencePresetRevision,
  type PromotionTemplateBinding,
  type PromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

type Database = NodePgDatabase<typeof schema>;
type RegistryDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;

export class PromotionRegistryRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "foreign_reference_missing"
    | "reference_ambiguous"
    | "record_conflict"
    | "corrupt_store") {
    super(`Promotion registry persistence reddedildi: ${code}`);
    this.name = "PromotionRegistryRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, stable(child)]));
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

/** Stable opaque reference shared by server-side catalogs and this resolver. */
export function promotionRegistryPublicRef(
  kind: "account" | "actor" | "campaign" | "category" | "post" | "adset",
  workspaceId: string,
  internalId: string,
): string {
  if (!UUID.test(workspaceId) || !UUID.test(internalId)) {
    throw new PromotionRegistryRepositoryError("invalid_input");
  }
  return `${kind}_${createHash("sha256").update(`${kind}\0${workspaceId}\0${internalId}`).digest("hex").slice(0, 24)}`;
}

function resultRows(result: unknown): readonly Record<string, unknown>[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new PromotionRegistryRepositoryError("corrupt_store");
  }
  return result.rows as readonly Record<string, unknown>[];
}

async function lockActiveWorkspace(database: RegistryDatabase, workspaceId: string): Promise<void> {
  const rows = resultRows(await database.execute(
    // Locking one tenant row serializes exact-ref publication and makes replay
    // behavior deterministic without widening the lock to another workspace.
    // Drizzle sql is used because SELECT ... FOR UPDATE has no builder form.
    sql`
      select id from workspaces
      where id = ${workspaceId}::uuid and lifecycle_state = 'active'
      limit 1 for update
    `,
  ));
  if (rows.length !== 1) throw new PromotionRegistryRepositoryError("workspace_scope_mismatch");
}

function canonicalPreset(value: unknown): AudiencePresetRevision {
  try {
    if (!value || typeof value !== "object" || !("presetHash" in value)) throw new Error("invalid");
    const candidate = value as AudiencePresetRevision;
    const { presetHash, ...input } = candidate;
    const rebuilt = createAudiencePresetRevision(input);
    if (rebuilt.presetHash !== presetHash) throw new Error("hash");
    return rebuilt;
  } catch {
    throw new PromotionRegistryRepositoryError("corrupt_store");
  }
}

function canonicalTemplate(value: unknown): PromotionTemplateRevision {
  try {
    if (!value || typeof value !== "object" || !("templateHash" in value)) throw new Error("invalid");
    const candidate = value as PromotionTemplateRevision;
    const { templateHash, ...input } = candidate;
    const rebuilt = createPromotionTemplateRevision(input);
    if (rebuilt.templateHash !== templateHash) throw new Error("hash");
    return rebuilt;
  } catch {
    throw new PromotionRegistryRepositoryError("corrupt_store");
  }
}

function canonicalBinding(value: unknown, template: PromotionTemplateRevision): PromotionTemplateBinding {
  try {
    if (!value || typeof value !== "object" || !("bindingHash" in value)) throw new Error("invalid");
    const candidate = value as PromotionTemplateBinding;
    const { bindingHash, ...input } = candidate;
    const rebuilt = createPromotionTemplateBinding(input, template);
    if (rebuilt.bindingHash !== bindingHash) throw new Error("hash");
    return rebuilt;
  } catch {
    throw new PromotionRegistryRepositoryError("corrupt_store");
  }
}

function presetFromRow(row: typeof schema.audiencePresetRevisions.$inferSelect): AudiencePresetRevision {
  const preset = canonicalPreset(row.payload);
  if (preset.presetRef !== row.presetRef || preset.revision !== row.revision || preset.version !== row.schemaVersion
    || preset.state !== row.state || preset.source.kind !== row.audienceKind || preset.source.sourceRef !== row.sourceRef
    || preset.source.targetingHash !== row.targetingHash || preset.source.provenanceHash !== row.provenanceHash
    || preset.presetHash !== row.presetHash || preset.publishedAt !== row.publishedAt.toISOString()) {
    throw new PromotionRegistryRepositoryError("corrupt_store");
  }
  return preset;
}

function templateFromRow(row: typeof schema.promotionTemplateRevisions.$inferSelect): PromotionTemplateRevision {
  const template = canonicalTemplate(row.payload);
  if (template.templateRef !== row.templateRef || template.revision !== row.revision || template.version !== row.schemaVersion
    || template.state !== row.state || template.templateHash !== row.templateHash
    || template.audiencePreset.presetHash !== row.audiencePresetHash || !same(template.actorTypes, row.actorTypeScope)
    || template.objectiveRef !== row.objectiveRef || template.optimizationGoalRef !== row.optimizationGoalRef
    || template.destinationRef !== row.destinationRef || template.adSetPolicy !== row.adSetPolicy
    || template.budget.ownerLevel !== row.budgetOwnerLevel || template.budget.kind !== row.budgetKind
    || template.budget.currency !== row.currency || template.budget.defaultDecimal !== row.budgetDefault
    || template.budget.minimumDecimal !== row.budgetMinimum || template.budget.maximumDecimal !== row.budgetMaximum
    || template.budget.budgetPlanVersionRef !== row.budgetPlanVersionRef
    || template.timeframe.timeframeRef !== row.timeframeRef || template.timeframe.scheduleMode !== row.scheduleMode
    || template.timeframe.durationDays !== row.durationDays || template.publishedAt !== row.publishedAt.toISOString()) {
    throw new PromotionRegistryRepositoryError("corrupt_store");
  }
  return template;
}

function bindingFromRow(
  row: typeof schema.promotionTemplateBindings.$inferSelect,
  template: PromotionTemplateRevision,
): PromotionTemplateBinding {
  const binding = canonicalBinding(row.payload, template);
  if (binding.bindingRef !== row.bindingRef || binding.bindingHash !== row.bindingHash
    || binding.actor.type !== row.actorType || binding.effectiveFrom !== row.effectiveFrom.toISOString()
    || binding.expiresAt !== row.expiresAt?.toISOString() && !(binding.expiresAt === null && row.expiresAt === null)) {
    throw new PromotionRegistryRepositoryError("corrupt_store");
  }
  return binding;
}

function one<T>(rows: readonly T[], missing: PromotionRegistryRepositoryError["code"]): T {
  if (rows.length === 0) throw new PromotionRegistryRepositoryError(missing);
  if (rows.length !== 1) throw new PromotionRegistryRepositoryError("reference_ambiguous");
  return rows[0]!;
}

type AuthenticScope = Readonly<{
  accountId: string;
  actorId: string;
  campaignId: string | null;
  categories: readonly Readonly<{ id: string; ref: string }>[];
}>;

async function authenticScope(
  database: RegistryDatabase,
  workspaceId: string,
  binding: PromotionTemplateBinding,
): Promise<AuthenticScope> {
  const accounts = (await database.select().from(schema.adAccounts)
    .where(eq(schema.adAccounts.workspaceId, workspaceId)))
    .filter((row) => promotionRegistryPublicRef("account", workspaceId, row.id) === binding.accountRef);
  const account = one(accounts, "foreign_reference_missing");
  const expectedAssetType = binding.actor.type === "page" ? "facebook_page" : "instagram_account";
  const actors = (await database.select().from(schema.metaAssets).where(and(
    eq(schema.metaAssets.workspaceId, workspaceId), eq(schema.metaAssets.assetType, expectedAssetType),
  ))).filter((row) => promotionRegistryPublicRef("actor", workspaceId, row.id) === binding.actor.actorRef);
  const actor = one(actors, "foreign_reference_missing");
  let campaignId: string | null = null;
  if (binding.campaignRef !== null) {
    const campaigns = (await database.select().from(schema.adCampaigns).where(and(
      eq(schema.adCampaigns.workspaceId, workspaceId), eq(schema.adCampaigns.adAccountId, account.id),
    ))).filter((row) => promotionRegistryPublicRef("campaign", workspaceId, row.id) === binding.campaignRef);
    campaignId = one(campaigns, "foreign_reference_missing").id;
  }
  const definitions = await database.select().from(schema.categoryDefinitions)
    .where(eq(schema.categoryDefinitions.workspaceId, workspaceId));
  const categories = binding.internalCategoryRefs.map((categoryRef) => {
    const matches = definitions.filter((row) => row.archivedAt === null
      && promotionRegistryPublicRef("category", workspaceId, row.id) === categoryRef);
    return Object.freeze({ id: one(matches, "foreign_reference_missing").id, ref: categoryRef });
  });
  return Object.freeze({ accountId: account.id, actorId: actor.id, campaignId, categories: Object.freeze(categories) });
}

function assertPresetRow(
  row: typeof schema.audiencePresetRevisions.$inferSelect,
  expected: AudiencePresetRevision,
): void {
  const persisted = presetFromRow(row);
  if (!same(persisted, expected)) throw new PromotionRegistryRepositoryError("record_conflict");
}

function assertTemplateRow(
  row: typeof schema.promotionTemplateRevisions.$inferSelect,
  expected: PromotionTemplateRevision,
  presetRowId: string,
): void {
  const persisted = templateFromRow(row);
  if (row.audiencePresetRevisionId !== presetRowId || !same(persisted, expected)) {
    throw new PromotionRegistryRepositoryError("record_conflict");
  }
}

function assertBindingRow(
  row: typeof schema.promotionTemplateBindings.$inferSelect,
  expected: PromotionTemplateBinding,
  template: PromotionTemplateRevision,
  templateRowId: string,
  scope: AuthenticScope,
): void {
  const persisted = bindingFromRow(row, template);
  if (row.templateRevisionId !== templateRowId || row.adAccountId !== scope.accountId
    || row.actorAssetId !== scope.actorId || row.campaignId !== scope.campaignId || !same(persisted, expected)) {
    throw new PromotionRegistryRepositoryError("record_conflict");
  }
}

/** Append-only, server-private immutable registry. No Meta transport is accepted. */
export class DrizzlePromotionRegistryRepository implements PromotionRegistryRepository {
  constructor(
    private readonly database: RegistryDatabase,
    private readonly workspaceId: string,
    private readonly workspaceRef: string,
  ) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) {
      throw new PromotionRegistryRepositoryError("invalid_input");
    }
  }

  async publish(input: Readonly<{
    preset: AudiencePresetRevision;
    template: PromotionTemplateRevision;
    binding: PromotionTemplateBinding;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; refs: PromotionRegistryReferences }>> {
    if (input.preset.workspaceRef !== this.workspaceRef || input.template.workspaceRef !== this.workspaceRef
      || input.binding.workspaceRef !== this.workspaceRef) {
      throw new PromotionRegistryRepositoryError("workspace_scope_mismatch");
    }
    // Reconstruct before entering the transaction; supplied hashes are never trusted.
    const preset = canonicalPreset(input.preset);
    const template = canonicalTemplate(input.template);
    const binding = canonicalBinding(input.binding, template);
    if (template.audiencePreset.presetRef !== preset.presetRef
      || template.audiencePreset.revision !== preset.revision
      || template.audiencePreset.presetHash !== preset.presetHash) {
      throw new PromotionRegistryRepositoryError("record_conflict");
    }
    const refs = publicPromotionRegistryReferences({ preset, template, binding });
    try {
      return await this.database.transaction(async (transaction) => {
        await lockActiveWorkspace(transaction, this.workspaceId);
        const scope = await authenticScope(transaction, this.workspaceId, binding);

        const presetMatches = await transaction.select().from(schema.audiencePresetRevisions).where(and(
          eq(schema.audiencePresetRevisions.workspaceId, this.workspaceId),
          eq(schema.audiencePresetRevisions.presetRef, preset.presetRef),
          eq(schema.audiencePresetRevisions.revision, preset.revision),
        )).limit(2);
        let presetRow: typeof schema.audiencePresetRevisions.$inferSelect;
        if (presetMatches[0]) {
          if (presetMatches.length !== 1) throw new PromotionRegistryRepositoryError("corrupt_store");
          assertPresetRow(presetMatches[0], preset);
          presetRow = presetMatches[0];
        } else {
          const inserted = await transaction.insert(schema.audiencePresetRevisions).values({
            workspaceId: this.workspaceId, presetRef: preset.presetRef, revision: preset.revision,
            schemaVersion: preset.version, state: preset.state, audienceKind: preset.source.kind,
            sourceRef: preset.source.sourceRef, targetingHash: preset.source.targetingHash,
            provenanceHash: preset.source.provenanceHash, presetHash: preset.presetHash,
            payload: preset as unknown as Record<string, unknown>, publishedAt: new Date(preset.publishedAt),
          }).returning();
          presetRow = one(inserted, "corrupt_store");
        }

        const templateMatches = await transaction.select().from(schema.promotionTemplateRevisions).where(and(
          eq(schema.promotionTemplateRevisions.workspaceId, this.workspaceId),
          eq(schema.promotionTemplateRevisions.templateRef, template.templateRef),
          eq(schema.promotionTemplateRevisions.revision, template.revision),
        )).limit(2);
        let templateRow: typeof schema.promotionTemplateRevisions.$inferSelect;
        if (templateMatches[0]) {
          if (templateMatches.length !== 1) throw new PromotionRegistryRepositoryError("corrupt_store");
          assertTemplateRow(templateMatches[0], template, presetRow.id);
          templateRow = templateMatches[0];
        } else {
          const inserted = await transaction.insert(schema.promotionTemplateRevisions).values({
            workspaceId: this.workspaceId, audiencePresetRevisionId: presetRow.id,
            templateRef: template.templateRef, revision: template.revision, schemaVersion: template.version,
            state: template.state, templateHash: template.templateHash, audiencePresetHash: template.audiencePreset.presetHash,
            actorTypeScope: template.actorTypes, objectiveRef: template.objectiveRef,
            optimizationGoalRef: template.optimizationGoalRef, destinationRef: template.destinationRef,
            adSetPolicy: template.adSetPolicy, budgetOwnerLevel: template.budget.ownerLevel,
            budgetKind: template.budget.kind, currency: template.budget.currency,
            budgetDefault: template.budget.defaultDecimal, budgetMinimum: template.budget.minimumDecimal,
            budgetMaximum: template.budget.maximumDecimal, budgetPlanVersionRef: template.budget.budgetPlanVersionRef,
            timeframeRef: template.timeframe.timeframeRef, scheduleMode: template.timeframe.scheduleMode,
            durationDays: template.timeframe.durationDays, payload: template as unknown as Record<string, unknown>,
            publishedAt: new Date(template.publishedAt),
          }).returning();
          templateRow = one(inserted, "corrupt_store");
        }

        const bindingMatches = await transaction.select().from(schema.promotionTemplateBindings).where(and(
          eq(schema.promotionTemplateBindings.workspaceId, this.workspaceId),
          eq(schema.promotionTemplateBindings.bindingRef, binding.bindingRef),
        )).limit(2);
        if (bindingMatches[0]) {
          if (bindingMatches.length !== 1) throw new PromotionRegistryRepositoryError("corrupt_store");
          assertBindingRow(bindingMatches[0], binding, template, templateRow.id, scope);
          const edges = await transaction.select().from(schema.promotionTemplateBindingCategories).where(and(
            eq(schema.promotionTemplateBindingCategories.workspaceId, this.workspaceId),
            eq(schema.promotionTemplateBindingCategories.bindingId, bindingMatches[0].id),
          ));
          const expectedEdges = scope.categories.map((item) => `${item.id}:${item.ref}`).sort();
          const actualEdges = edges.map((item) => `${item.categoryDefinitionId}:${item.categoryRef}`).sort();
          if (!same(actualEdges, expectedEdges)) throw new PromotionRegistryRepositoryError("record_conflict");
          return Object.freeze({ outcome: "unchanged" as const, refs });
        }

        const insertedBindings = await transaction.insert(schema.promotionTemplateBindings).values({
          workspaceId: this.workspaceId, templateRevisionId: templateRow.id, adAccountId: scope.accountId,
          actorAssetId: scope.actorId, campaignId: scope.campaignId, bindingRef: binding.bindingRef,
          bindingHash: binding.bindingHash, actorType: binding.actor.type,
          payload: binding as unknown as Record<string, unknown>, effectiveFrom: new Date(binding.effectiveFrom),
          expiresAt: binding.expiresAt === null ? null : new Date(binding.expiresAt),
        }).returning();
        const bindingRow = one(insertedBindings, "corrupt_store");
        if (scope.categories.length > 0) {
          await transaction.insert(schema.promotionTemplateBindingCategories).values(scope.categories.map((item) => ({
            workspaceId: this.workspaceId, bindingId: bindingRow.id,
            categoryDefinitionId: item.id, categoryRef: item.ref,
          })));
        }
        return Object.freeze({ outcome: "inserted" as const, refs });
      });
    } catch (error) {
      if (error instanceof PromotionRegistryRepositoryError) throw error;
      throw new PromotionRegistryRepositoryError("record_conflict");
    }
  }

  async readRefs(bindingRef: string): Promise<PromotionRegistryReferences | null> {
    if (!REF.test(bindingRef)) throw new PromotionRegistryRepositoryError("invalid_input");
    return this.database.transaction(async (transaction) => {
      await lockActiveWorkspace(transaction, this.workspaceId);
      const bindingRows = await transaction.select().from(schema.promotionTemplateBindings).where(and(
        eq(schema.promotionTemplateBindings.workspaceId, this.workspaceId),
        eq(schema.promotionTemplateBindings.bindingRef, bindingRef),
      )).limit(2);
      if (bindingRows.length === 0) return null;
      const bindingRow = one(bindingRows, "corrupt_store");
      const templateRow = one(await transaction.select().from(schema.promotionTemplateRevisions).where(and(
        eq(schema.promotionTemplateRevisions.workspaceId, this.workspaceId),
        eq(schema.promotionTemplateRevisions.id, bindingRow.templateRevisionId),
      )).limit(2), "corrupt_store");
      const presetRow = one(await transaction.select().from(schema.audiencePresetRevisions).where(and(
        eq(schema.audiencePresetRevisions.workspaceId, this.workspaceId),
        eq(schema.audiencePresetRevisions.id, templateRow.audiencePresetRevisionId),
      )).limit(2), "corrupt_store");
      const preset = presetFromRow(presetRow);
      const template = templateFromRow(templateRow);
      const binding = bindingFromRow(bindingRow, template);
      const scope = await authenticScope(transaction, this.workspaceId, binding);
      assertTemplateRow(templateRow, template, presetRow.id);
      assertBindingRow(bindingRow, binding, template, templateRow.id, scope);
      if (template.audiencePreset.presetHash !== preset.presetHash) {
        throw new PromotionRegistryRepositoryError("corrupt_store");
      }
      const edges = await transaction.select().from(schema.promotionTemplateBindingCategories).where(and(
        eq(schema.promotionTemplateBindingCategories.workspaceId, this.workspaceId),
        eq(schema.promotionTemplateBindingCategories.bindingId, bindingRow.id),
      ));
      if (!same(edges.map((edge) => `${edge.categoryDefinitionId}:${edge.categoryRef}`).sort(),
        scope.categories.map((edge) => `${edge.id}:${edge.ref}`).sort())) {
        throw new PromotionRegistryRepositoryError("corrupt_store");
      }
      return publicPromotionRegistryReferences({ preset, template, binding });
    });
  }
}
