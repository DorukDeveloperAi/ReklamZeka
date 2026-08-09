import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  buildEffectiveCampaignContext,
  EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF,
  EFFECTIVE_CONTEXT_PROMOTION_REGISTRY_COMPONENT_REF,
  EFFECTIVE_CAMPAIGN_CONTEXT_VERSION,
  type EffectiveCampaignContext,
  type EffectiveCampaignContextInput,
} from "@/analyses/effective-campaign-context";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type ContextDatabase = Pick<Database, "select" | "insert" | "execute" | "transaction">;

export const CONTEXT_SOURCE_COMPONENT_TYPES = Object.freeze([
  "source_snapshot",
  "category_resolution",
  "category_profile",
  "guidance_pack",
  "meta_catalog",
  "category_resolver",
  "guidance_registry",
  "metric_catalog",
  "formula_catalog",
  "timeframe_resolver",
  "instruction_policy",
  "promotion_registry",
] as const);

export type ContextSourceComponentType = typeof CONTEXT_SOURCE_COMPONENT_TYPES[number];
export type ContextSourceComponentRef = Readonly<{
  componentType: ContextSourceComponentType;
  componentRef: string;
  componentVersion: string;
}>;

export type ContextInvalidationInput = Readonly<ContextSourceComponentRef & {
  workspaceId: string;
  scope:
    | Readonly<{ kind: "workspace_component" }>
    | Readonly<{
      kind: "exact_entity_component";
      entityType: EffectiveCampaignContext["identity"]["entityType"];
      entityRef: string;
    }>;
  reasonCode: "source_changed" | "source_removed" | "manual_rebuild";
  observedAt: string;
}>;

export type StoredEffectiveCampaignContext = Readonly<{
  context: EffectiveCampaignContext;
  sourceComponents: readonly ContextSourceComponentRef[];
  invalidated: boolean;
}>;

export class EffectiveCampaignContextRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "identity_conflict"
    | "not_found"
    | "corrupt_store") {
    super(`Effective campaign context persistence reddedildi: ${code}`);
    this.name = "EffectiveCampaignContextRepositoryError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function required(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) {
    throw new EffectiveCampaignContextRepositoryError("invalid_input");
  }
  return normalized;
}

function iso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new EffectiveCampaignContextRepositoryError("invalid_input");
  return new Date(parsed).toISOString();
}

function contextInput(context: EffectiveCampaignContext): EffectiveCampaignContextInput {
  const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...input } = context;
  return input;
}

function authenticContext(context: EffectiveCampaignContext): EffectiveCampaignContext {
  let rebuilt: EffectiveCampaignContext;
  try {
    rebuilt = buildEffectiveCampaignContext(contextInput(context));
  } catch {
    throw new EffectiveCampaignContextRepositoryError("invalid_input");
  }
  if (context.schemaVersion !== EFFECTIVE_CAMPAIGN_CONTEXT_VERSION
    || rebuilt.contextHash !== context.contextHash
    || context.capabilities.containsRawL0 !== false
    || context.capabilities.canAuthorizeAction !== false
    || context.capabilities.canExecuteWrite !== false) {
    throw new EffectiveCampaignContextRepositoryError("invalid_input");
  }
  return rebuilt;
}

function identityHash(context: EffectiveCampaignContext): string {
  return digest({
    workspaceId: context.workspaceId,
    connectionRef: context.identity.connectionRef,
    accountRef: context.identity.accountRef,
    campaignRef: context.identity.campaignRef,
    entityType: context.identity.entityType,
    entityRef: context.identity.entityRef,
    capturedAt: context.capturedAt,
    snapshotRefs: context.data.snapshotRefs,
  });
}

/** Deterministic invalidation surface; it contains references and versions only. */
export function sourceComponentsOf(context: EffectiveCampaignContext): readonly ContextSourceComponentRef[] {
  const components: ContextSourceComponentRef[] = [
    ...context.data.snapshotRefs.map((snapshotRef) => ({
      componentType: "source_snapshot" as const,
      componentRef: snapshotRef,
      componentVersion: snapshotRef,
    })),
    ...context.categories.map((category) => ({
      componentType: "category_resolution" as const,
      componentRef: category.dimension.id,
      componentVersion: category.resolutionHash,
    })),
    ...context.categories.flatMap((category) => (category.profileBindings ?? []).map((profile) => ({
      componentType: "category_profile" as const,
      componentRef: profile.profileRef,
      componentVersion: profile.profileHash,
    }))),
    {
      componentType: "guidance_pack",
      componentRef: "effective-guidance-pack",
      componentVersion: context.guidance.packHash,
    },
    { componentType: "meta_catalog", componentRef: "meta-catalog", componentVersion: context.versions.metaCatalog },
    { componentType: "category_resolver", componentRef: "category-resolver", componentVersion: context.versions.categoryResolver },
    { componentType: "guidance_registry", componentRef: "guidance-registry", componentVersion: context.versions.guidanceRegistry },
    { componentType: "metric_catalog", componentRef: "metric-catalog", componentVersion: context.versions.metricCatalog },
    { componentType: "formula_catalog", componentRef: "formula-catalog", componentVersion: context.versions.formulaCatalog },
    { componentType: "timeframe_resolver", componentRef: "timeframe-resolver", componentVersion: context.versions.timeframeResolver },
    ...(context.versions.instructionPolicyRegistry === undefined ? [] : [{
      componentType: "instruction_policy" as const,
      componentRef: EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF,
      componentVersion: context.versions.instructionPolicyRegistry,
    }]),
    ...(context.versions.promotionRegistry === undefined ? [] : [{
      componentType: "promotion_registry" as const,
      componentRef: EFFECTIVE_CONTEXT_PROMOTION_REGISTRY_COMPONENT_REF,
      componentVersion: context.versions.promotionRegistry,
    }]),
  ];
  const normalized = components.map((component) => Object.freeze({
    componentType: component.componentType,
    componentRef: required(component.componentRef),
    componentVersion: required(component.componentVersion),
  })).sort((left, right) => compareText(left.componentType, right.componentType)
    || compareText(left.componentRef, right.componentRef)
    || compareText(left.componentVersion, right.componentVersion));
  if (new Set(normalized.map((entry) => `${entry.componentType}\u0000${entry.componentRef}\u0000${entry.componentVersion}`)).size
    !== normalized.length) throw new EffectiveCampaignContextRepositoryError("invalid_input");
  return Object.freeze(normalized);
}

function resultRows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new EffectiveCampaignContextRepositoryError("corrupt_store");
  }
  return result.rows as readonly T[];
}

async function assertWorkspace(database: ContextDatabase, workspaceId: string, lock: boolean): Promise<void> {
  const suffix = lock ? sql` for update` : sql``;
  const result = await database.execute(sql`
    select id from workspaces
    where id = ${workspaceId}::uuid and lifecycle_state = 'active'
    limit 1${suffix}
  `);
  if (resultRows(result).length !== 1) {
    throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  }
}

type ContextRow = typeof schema.effectiveCampaignContexts.$inferSelect;

type MirrorScope = Readonly<{
  metaConnectionId: string;
  adAccountId: string;
  campaignId: string;
}>;

async function assertMirrorScope(
  database: ContextDatabase,
  context: EffectiveCampaignContext,
): Promise<MirrorScope> {
  const path = context.identity.hierarchyRefs;
  const result = await database.execute(sql`
    select connection.id::text as "metaConnectionId",
      account.id::text as "adAccountId", campaign.id::text as "campaignId"
    from meta_connections connection
    join data_sources source
      on source.workspace_id = connection.workspace_id
     and source.meta_connection_id = connection.id
     and source.platform = 'meta_ads'
    join ad_accounts account
      on account.workspace_id = source.workspace_id
     and account.data_source_id = source.id
     and account.external_account_id = ${context.identity.accountRef}
    join ad_campaigns campaign
      on campaign.workspace_id = account.workspace_id
     and campaign.ad_account_id = account.id
     and campaign.external_campaign_id = ${context.identity.campaignRef}
    where connection.workspace_id = ${context.workspaceId}::uuid
      and connection.external_connection_key = ${context.identity.connectionRef}
      and connection.status = 'active'
      and (
        (${context.identity.entityType} = 'campaign'
          and ${context.identity.entityRef} = campaign.external_campaign_id
          and ${path[0]} = campaign.external_campaign_id)
        or (${context.identity.entityType} = 'ad_set' and exists (
          select 1 from meta_ad_sets ad_set
          where ad_set.workspace_id = account.workspace_id
            and ad_set.ad_account_id = account.id and ad_set.campaign_id = campaign.id
            and ad_set.external_ad_set_id = ${context.identity.entityRef}
            and ad_set.external_ad_set_id = ${path[1] ?? null}
        ))
        or (${context.identity.entityType} = 'ad' and exists (
          select 1 from meta_ad_sets ad_set
          join meta_ads ad on ad.workspace_id = ad_set.workspace_id
            and ad.ad_account_id = ad_set.ad_account_id and ad.campaign_id = ad_set.campaign_id
            and ad.ad_set_id = ad_set.id
          where ad_set.workspace_id = account.workspace_id
            and ad_set.ad_account_id = account.id and ad_set.campaign_id = campaign.id
            and ad_set.external_ad_set_id = ${path[1] ?? null}
            and ad.external_ad_id = ${context.identity.entityRef}
            and ad.external_ad_id = ${path[2] ?? null}
        ))
        or (${context.identity.entityType} = 'creative' and exists (
          select 1 from meta_ad_sets ad_set
          join meta_ads ad on ad.workspace_id = ad_set.workspace_id
            and ad.ad_account_id = ad_set.ad_account_id and ad.campaign_id = ad_set.campaign_id
            and ad.ad_set_id = ad_set.id
          join meta_creatives creative on creative.workspace_id = ad.workspace_id
            and creative.ad_account_id = ad.ad_account_id and creative.id = ad.creative_id
          where ad_set.workspace_id = account.workspace_id
            and ad_set.ad_account_id = account.id and ad_set.campaign_id = campaign.id
            and ad_set.external_ad_set_id = ${path[1] ?? null}
            and ad.external_ad_id = ${path[2] ?? null}
            and creative.external_creative_id = ${context.identity.entityRef}
            and creative.external_creative_id = ${path[3] ?? null}
        ))
      )
    limit 2
  `);
  const rows = resultRows<MirrorScope>(result);
  if (rows.length !== 1) throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  const snapshots = await database.select({
    publicRef: schema.metaChangeSnapshots.publicRef,
    capturedAt: schema.metaChangeSnapshots.capturedAt,
  })
    .from(schema.metaChangeSnapshots).where(and(
      eq(schema.metaChangeSnapshots.workspaceId, context.workspaceId),
      eq(schema.metaChangeSnapshots.metaConnectionId, rows[0]!.metaConnectionId),
      eq(schema.metaChangeSnapshots.adAccountId, rows[0]!.adAccountId),
      inArray(schema.metaChangeSnapshots.publicRef, [...context.data.snapshotRefs]),
    ));
  if (snapshots.length !== context.data.snapshotRefs.length
    || new Set(snapshots.map((snapshot) => snapshot.publicRef)).size !== context.data.snapshotRefs.length
    || snapshots.some((snapshot) => snapshot.capturedAt.getTime() > Date.parse(context.capturedAt))) {
    throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  }
  return Object.freeze(rows[0]!);
}

function restoreContext(row: ContextRow): EffectiveCampaignContext {
  const payload = row.contextPayload as unknown as EffectiveCampaignContext;
  let context: EffectiveCampaignContext;
  try {
    context = authenticContext(payload);
  } catch {
    throw new EffectiveCampaignContextRepositoryError("corrupt_store");
  }
  const expectedIdentity = identityHash(context);
  if (context.workspaceId !== row.workspaceId
    || context.contextHash !== row.contextHash
    || expectedIdentity !== row.identityHash
    || context.schemaVersion !== row.schemaVersion
    || context.identity.connectionRef !== row.connectionRef
    || context.identity.accountRef !== row.accountRef
    || context.identity.campaignRef !== row.campaignRef
    || context.identity.entityType !== row.entityType
    || context.identity.entityRef !== row.entityRef
    || context.capturedAt !== row.capturedAt.toISOString()
    || JSON.stringify(context.data.snapshotRefs) !== JSON.stringify(row.snapshotRefs)) {
    throw new EffectiveCampaignContextRepositoryError("corrupt_store");
  }
  return context;
}

async function isInvalidated(database: ContextDatabase, row: ContextRow): Promise<boolean> {
  const result = await database.execute(sql`
    select exists (
      select 1
      from effective_campaign_context_components component
      join effective_campaign_context_invalidations invalidation
        on invalidation.workspace_id = component.workspace_id
       and invalidation.component_type = component.component_type
       and invalidation.component_ref = component.component_ref
       and invalidation.component_version = component.component_version
      where component.workspace_id = ${row.workspaceId}::uuid
        and component.context_id = ${row.id}::uuid
        and (
          invalidation.entity_type is null
          or (invalidation.entity_type = ${row.entityType} and invalidation.entity_ref = ${row.entityRef})
        )
    ) as invalidated
  `);
  return resultRows<{ invalidated: boolean }>(result)[0]?.invalidated === true;
}

async function loadRecord(database: ContextDatabase, row: ContextRow): Promise<StoredEffectiveCampaignContext> {
  const context = restoreContext(row);
  const componentRows = await database.select().from(schema.effectiveCampaignContextComponents)
    .where(and(
      eq(schema.effectiveCampaignContextComponents.workspaceId, row.workspaceId),
      eq(schema.effectiveCampaignContextComponents.contextId, row.id),
    ));
  const components = componentRows.map((component) => ({
    componentType: component.componentType as ContextSourceComponentType,
    componentRef: component.componentRef,
    componentVersion: component.componentVersion,
  })).sort((left, right) => compareText(left.componentType, right.componentType)
    || compareText(left.componentRef, right.componentRef)
    || compareText(left.componentVersion, right.componentVersion));
  if (digest(components) !== digest(sourceComponentsOf(context))) {
    throw new EffectiveCampaignContextRepositoryError("corrupt_store");
  }
  return Object.freeze({
    context,
    sourceComponents: Object.freeze(components.map((component) => Object.freeze(component))),
    invalidated: await isInvalidated(database, row),
  });
}

/** Append-only repository for authentic EffectiveCampaignContext snapshots. */
export class DrizzleEffectiveCampaignContextRepository {
  constructor(private readonly database: ContextDatabase) {}

  async save(candidate: EffectiveCampaignContext): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    record: StoredEffectiveCampaignContext;
  }>> {
    const context = authenticContext(candidate);
    const expectedIdentityHash = identityHash(context);
    const components = sourceComponentsOf(context);
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction, context.workspaceId, true);
      const mirror = await assertMirrorScope(transaction, context);
      const sameHash = await transaction.select().from(schema.effectiveCampaignContexts).where(and(
        eq(schema.effectiveCampaignContexts.workspaceId, context.workspaceId),
        eq(schema.effectiveCampaignContexts.contextHash, context.contextHash),
      )).limit(1);
      if (sameHash[0]) {
        const record = await loadRecord(transaction, sameHash[0]);
        if (sameHash[0].identityHash !== expectedIdentityHash) {
          throw new EffectiveCampaignContextRepositoryError("corrupt_store");
        }
        return Object.freeze({ outcome: "unchanged" as const, record });
      }
      // Missing only on immutable pre-A09 payloads. New persistence must bind the
      // exact policy registry hash so future lifecycle invalidations can match.
      if (context.versions.instructionPolicyRegistry === undefined) {
        throw new EffectiveCampaignContextRepositoryError("invalid_input");
      }
      if (context.versions.promotionRegistry === undefined) {
        throw new EffectiveCampaignContextRepositoryError("invalid_input");
      }
      const sameIdentity = await transaction.select().from(schema.effectiveCampaignContexts).where(and(
        eq(schema.effectiveCampaignContexts.workspaceId, context.workspaceId),
        eq(schema.effectiveCampaignContexts.identityHash, expectedIdentityHash),
      )).limit(1);
      if (sameIdentity[0]) throw new EffectiveCampaignContextRepositoryError("identity_conflict");

      const inserted = await transaction.insert(schema.effectiveCampaignContexts).values({
        workspaceId: context.workspaceId,
        identityHash: expectedIdentityHash,
        contextHash: context.contextHash,
        schemaVersion: context.schemaVersion,
        metaConnectionId: mirror.metaConnectionId,
        adAccountId: mirror.adAccountId,
        campaignId: mirror.campaignId,
        connectionRef: context.identity.connectionRef,
        accountRef: context.identity.accountRef,
        campaignRef: context.identity.campaignRef,
        entityType: context.identity.entityType,
        entityRef: context.identity.entityRef,
        capturedAt: new Date(context.capturedAt),
        snapshotRefs: context.data.snapshotRefs,
        contextPayload: context as unknown as Record<string, unknown>,
      }).returning();
      if (!inserted[0]) throw new EffectiveCampaignContextRepositoryError("identity_conflict");
      await transaction.insert(schema.effectiveCampaignContextComponents).values(components.map((component) => ({
        workspaceId: context.workspaceId,
        contextId: inserted[0]!.id,
        ...component,
      })));
      return Object.freeze({
        outcome: "inserted" as const,
        record: await loadRecord(transaction, inserted[0]),
      });
    });
  }

  async loadHistorical(workspaceId: string, contextHash: string): Promise<StoredEffectiveCampaignContext> {
    required(workspaceId);
    if (!/^[a-f0-9]{64}$/.test(contextHash)) throw new EffectiveCampaignContextRepositoryError("invalid_input");
    await assertWorkspace(this.database, workspaceId, false);
    const rows = await this.database.select().from(schema.effectiveCampaignContexts).where(and(
      eq(schema.effectiveCampaignContexts.workspaceId, workspaceId),
      eq(schema.effectiveCampaignContexts.contextHash, contextHash),
    )).limit(1);
    if (!rows[0]) throw new EffectiveCampaignContextRepositoryError("not_found");
    return loadRecord(this.database, rows[0]);
  }

  async loadLatestValid(input: Readonly<{
    workspaceId: string;
    entityType: EffectiveCampaignContext["identity"]["entityType"];
    entityRef: string;
  }>): Promise<StoredEffectiveCampaignContext | null> {
    required(input.workspaceId);
    required(input.entityRef);
    if (!["campaign", "ad_set", "ad", "creative"].includes(input.entityType)) {
      throw new EffectiveCampaignContextRepositoryError("invalid_input");
    }
    await assertWorkspace(this.database, input.workspaceId, false);
    const candidates = await this.database.select().from(schema.effectiveCampaignContexts).where(and(
      eq(schema.effectiveCampaignContexts.workspaceId, input.workspaceId),
      eq(schema.effectiveCampaignContexts.entityType, input.entityType),
      eq(schema.effectiveCampaignContexts.entityRef, input.entityRef),
    )).orderBy(desc(schema.effectiveCampaignContexts.capturedAt), desc(schema.effectiveCampaignContexts.createdAt));
    for (const candidate of candidates) {
      const record = await loadRecord(this.database, candidate);
      if (!record.invalidated) return record;
    }
    return null;
  }

  async invalidate(input: ContextInvalidationInput): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    affectedContextCount: number;
  }>> {
    const normalized = {
      workspaceId: required(input.workspaceId),
      componentType: input.componentType,
      componentRef: required(input.componentRef),
      componentVersion: required(input.componentVersion),
      scope: input.scope.kind === "workspace_component"
        ? { kind: "workspace_component" as const }
        : {
          kind: "exact_entity_component" as const,
          entityType: input.scope.entityType,
          entityRef: required(input.scope.entityRef),
        },
      reasonCode: input.reasonCode,
      observedAt: iso(input.observedAt),
    } as const;
    if (!(CONTEXT_SOURCE_COMPONENT_TYPES as readonly string[]).includes(normalized.componentType)
      || !["source_changed", "source_removed", "manual_rebuild"].includes(normalized.reasonCode)
      || normalized.scope.kind === "exact_entity_component"
        && !["campaign", "ad_set", "ad", "creative"].includes(normalized.scope.entityType)) {
      throw new EffectiveCampaignContextRepositoryError("invalid_input");
    }
    const eventHash = digest(normalized);
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction, normalized.workspaceId, true);
      const inserted = await transaction.insert(schema.effectiveCampaignContextInvalidations).values({
        workspaceId: normalized.workspaceId,
        eventHash,
        componentType: normalized.componentType,
        componentRef: normalized.componentRef,
        componentVersion: normalized.componentVersion,
        scopeKind: normalized.scope.kind,
        entityType: normalized.scope.kind === "exact_entity_component" ? normalized.scope.entityType : null,
        entityRef: normalized.scope.kind === "exact_entity_component" ? normalized.scope.entityRef : null,
        reasonCode: normalized.reasonCode,
        observedAt: new Date(normalized.observedAt),
      }).onConflictDoNothing().returning({ id: schema.effectiveCampaignContextInvalidations.id });
      const countResult = await transaction.execute(sql`
        select count(distinct context.id)::int as count
        from effective_campaign_contexts context
        join effective_campaign_context_components component
          on component.workspace_id = context.workspace_id and component.context_id = context.id
        where context.workspace_id = ${normalized.workspaceId}::uuid
          and component.component_type = ${normalized.componentType}
          and component.component_ref = ${normalized.componentRef}
          and component.component_version = ${normalized.componentVersion}
          and (${normalized.scope.kind === "workspace_component" ? null : normalized.scope.entityType}::text is null or (
            context.entity_type = ${normalized.scope.kind === "exact_entity_component" ? normalized.scope.entityType : null}
            and context.entity_ref = ${normalized.scope.kind === "exact_entity_component" ? normalized.scope.entityRef : null}
          ))
      `);
      const count = Number(resultRows<{ count: number | string }>(countResult)[0]?.count ?? -1);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new EffectiveCampaignContextRepositoryError("corrupt_store");
      }
      return Object.freeze({
        outcome: inserted[0] ? "inserted" as const : "unchanged" as const,
        affectedContextCount: count,
      });
    });
  }
}
