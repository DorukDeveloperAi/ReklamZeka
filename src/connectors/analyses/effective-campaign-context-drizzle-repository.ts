import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  buildEffectiveCampaignContext,
  EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF,
  EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF,
  EFFECTIVE_CONTEXT_PROMOTION_REGISTRY_COMPONENT_REF,
  EFFECTIVE_CAMPAIGN_CONTEXT_VERSION,
  type EffectiveCampaignContext,
  type EffectiveCampaignContextInput,
} from "@/analyses/effective-campaign-context";
import { assertDeterministicFeatureSnapshot, type DeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { buildDeterministicWindowSnapshot, type DeterministicWindowSnapshot } from "@/analyses/deterministic-window-snapshot";
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
  "policy_authority",
  "business_outcome_evidence",
  "cadence_profile",
  "guidance_selection",
  "deterministic_feature_snapshot",
  "deterministic_window_snapshot",
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
  /** Server-private IDs needed only to bind current L2/L3 evidence. */
  analysisDataScope?: Readonly<{ metaConnectionId: string; adAccountId: string; campaignId: string }>;
  sourceComponents: readonly ContextSourceComponentRef[];
  invalidated: boolean;
}>;

/** `evidence_bound` proves only the A10 config/cadence evidence closure; it grants no action authority. */
export type EffectiveCampaignContextPersistenceMode = "legacy_compatible" | "evidence_bound";

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
    ...context.data.featureRefs.map((featureRef) => ({
      componentType: "deterministic_feature_snapshot" as const,
      componentRef: featureRef,
      componentVersion: featureRef,
    })),
    ...context.data.windowRefs.map((windowRef) => ({
      componentType: "deterministic_window_snapshot" as const,
      componentRef: windowRef,
      componentVersion: windowRef,
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
    ...(context.versions.policyAuthority === undefined ? [] : [{
      componentType: "policy_authority" as const,
      componentRef: EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF,
      componentVersion: context.versions.policyAuthority,
    }]),
    ...(context.history.outcomeEvidence ?? []).map((evidence) => ({
      componentType: "business_outcome_evidence" as const,
      componentRef: evidence.entityRef,
      componentVersion: evidence.sourceHeadHash,
    })),
    ...(context.cadenceEvidence === undefined ? [] : [{
      componentType: "cadence_profile" as const,
      componentRef: context.cadence.profileRef,
      componentVersion: context.cadenceEvidence.profileHash,
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

/** Evidence can enter a frozen context only when the exact immutable L4 row exists in the same tenant. */
async function assertBusinessOutcomeEvidence(database: ContextDatabase, context: EffectiveCampaignContext): Promise<void> {
  for (const evidence of context.history.outcomeEvidence ?? []) {
    const matches = resultRows<{ evidence_payload: unknown }>(await database.execute(sql`
      select evidence_payload from business_outcome_evidence_snapshots
      where workspace_id = ${context.workspaceId}::uuid and evidence_ref = ${evidence.evidenceRef}
        and evidence_hash = ${evidence.evidenceHash} and entity_ref = ${evidence.entityRef}
        and source_head_hash = ${evidence.sourceHeadHash} and source_manifest_hash = ${evidence.sourceManifestHash}
        and window_start = ${evidence.windowStart}::timestamptz and window_end = ${evidence.windowEnd}::timestamptz
        and materialized_at = ${evidence.materializedAt}::timestamptz
      limit 2 for share
    `));
    if (matches.length !== 1 || JSON.stringify(stableValue(matches[0]!.evidence_payload)) !== JSON.stringify(stableValue(evidence))) {
      throw new EffectiveCampaignContextRepositoryError("corrupt_store");
    }
  }
}

/**
 * L2/L3 references are admissible in a frozen context only when their exact,
 * tenant-scoped immutable payloads still authenticate and no captured L1 input
 * has invalidated them. This is deliberately a save-time recheck: a caller may
 * never turn a free-form ref into ready analytical evidence.
 */
async function assertDeterministicAnalysisData(
  database: ContextDatabase,
  context: EffectiveCampaignContext,
  mirror: MirrorScope,
): Promise<void> {
  const { featureRefs, windowRefs } = context.data;
  if (featureRefs.length === 0 && windowRefs.length === 0) return;
  if (featureRefs.length === 0 || windowRefs.length === 0
    || context.data.trustStatus !== "ready" || context.data.blockers.length > 0) {
    throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  }
  const entityLevel = context.identity.entityType === "campaign" ? "campaign"
    : context.identity.entityType === "ad_set" ? "ad_set"
      : context.identity.entityType === "ad" ? "ad" : null;
  if (entityLevel === null) throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  const featureRows = resultRows<{ feature_ref: string; feature_hash: string; feature_payload: unknown }>(await database.execute(sql`
    select feature.feature_ref, feature.feature_hash, feature.feature_payload
    from deterministic_feature_snapshots feature
    where feature.workspace_id = ${context.workspaceId}::uuid
      and feature.meta_connection_id = ${mirror.metaConnectionId}::uuid
      and feature.ad_account_id = ${mirror.adAccountId}::uuid
      and feature.entity_level = ${entityLevel}::meta_insight_entity_level
      and feature.external_entity_id = ${context.identity.entityRef}
      and feature.feature_ref = any(${featureRefs}::text[])
      and not exists (
        select 1 from deterministic_feature_snapshot_invalidations invalidation
        where invalidation.workspace_id = feature.workspace_id
          and invalidation.feature_snapshot_id = feature.id
      )
    for share
  `));
  if (featureRows.length !== featureRefs.length
    || new Set(featureRows.map((row) => row.feature_ref)).size !== featureRefs.length) {
    throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  }
  try {
    for (const row of featureRows) {
      assertDeterministicFeatureSnapshot(row.feature_payload);
      const feature = row.feature_payload;
      if (feature.featureRef !== row.feature_ref || feature.featureHash !== row.feature_hash
        || feature.scope.workspaceId !== context.workspaceId
        || feature.scope.metaConnectionId !== mirror.metaConnectionId
        || feature.scope.adAccountId !== mirror.adAccountId
        || feature.scope.entityLevel !== entityLevel
        || feature.scope.externalEntityId !== context.identity.entityRef) throw new Error("scope");
    }
  } catch {
    throw new EffectiveCampaignContextRepositoryError("corrupt_store");
  }
  const windowRows = resultRows<{ window_ref: string; window_hash: string; window_payload: unknown; features: unknown }>(await database.execute(sql`
    select l3_window.window_ref, l3_window.window_hash, l3_window.window_payload,
      coalesce(jsonb_agg(feature.feature_payload order by feature.feature_ref), '[]'::jsonb) as features
    from deterministic_window_snapshots l3_window
    join deterministic_window_snapshot_features binding
      on binding.workspace_id = l3_window.workspace_id and binding.window_snapshot_id = l3_window.id
    join deterministic_feature_snapshots feature
      on feature.workspace_id = binding.workspace_id and feature.id = binding.feature_snapshot_id
    where l3_window.workspace_id = ${context.workspaceId}::uuid
      and l3_window.meta_connection_id = ${mirror.metaConnectionId}::uuid
      and l3_window.ad_account_id = ${mirror.adAccountId}::uuid
      and l3_window.entity_level = ${entityLevel}::meta_insight_entity_level
      and l3_window.external_entity_id = ${context.identity.entityRef}
      and l3_window.window_ref = any(${windowRefs}::text[])
      and not exists (
        select 1
        from deterministic_window_snapshot_features affected_binding
        join deterministic_feature_snapshot_invalidations invalidation
          on invalidation.workspace_id = affected_binding.workspace_id
         and invalidation.feature_snapshot_id = affected_binding.feature_snapshot_id
        where affected_binding.workspace_id = l3_window.workspace_id
          and affected_binding.window_snapshot_id = l3_window.id
      )
    group by l3_window.id
  `));
  if (windowRows.length !== windowRefs.length
    || new Set(windowRows.map((row) => row.window_ref)).size !== windowRefs.length) {
    throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  }
  const covered = new Set<string>();
  try {
    for (const row of windowRows) {
      if (!Array.isArray(row.features)) throw new Error("features");
      (row.features as unknown[]).forEach(assertDeterministicFeatureSnapshot);
      const window = buildDeterministicWindowSnapshot({
        timeframe: (row.window_payload as DeterministicWindowSnapshot).resolvedTimeframe,
        features: row.features as DeterministicFeatureSnapshot[],
      });
      if (window.windowRef !== row.window_ref || window.windowHash !== row.window_hash) throw new Error("hash");
      window.featureRefs.forEach((ref) => covered.add(ref));
    }
  } catch {
    throw new EffectiveCampaignContextRepositoryError("corrupt_store");
  }
  if (covered.size !== featureRefs.length || featureRefs.some((ref) => !covered.has(ref))) {
    throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  }
}

/** Evidence-bound contexts may name cadence only when the exact immutable tenant row exists. */
async function assertCadenceEvidence(
  database: ContextDatabase,
  context: EffectiveCampaignContext,
  mirror: MirrorScope,
): Promise<void> {
  if (context.cadenceEvidence === undefined) return;
  const matches = resultRows<{ id: string }>(await database.execute(sql`
    select id::text as id from decision_cadence_profile_revisions
    where workspace_id = ${context.workspaceId}::uuid
      and ad_account_id = ${mirror.adAccountId}::uuid and campaign_id = ${mirror.campaignId}::uuid
      and profile_ref = ${context.cadence.profileRef}
      and revision = ${context.cadenceEvidence.profileRevision}
      and profile_version = ${context.cadenceEvidence.profileVersion}
      and profile_hash = ${context.cadenceEvidence.profileHash}
    limit 2 for share
  `));
  if (matches.length !== 1) throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
}

type PolicyCompositionEvidence = Readonly<{
  instructionPolicyRegistryHash: string; authorityComponentVersion: string; authoritySnapshotRef: string;
  authoritySnapshotHash: string; authorityCatalogHash: string; authorityScopeHash: string; compositionHash: string;
  items: ReadonlyArray<Readonly<{ policyRevisionId: string; policyRef: string; policyVersion: number; policyHash: string; state: "applied" | "suppressed" | "parked_conflict"; reason: string; }> >;
}>;

/** Re-reads every authority proof and strict revision under the caller's save transaction. */
async function policyCompositionEvidence(database: ContextDatabase, context: EffectiveCampaignContext): Promise<PolicyCompositionEvidence | null> {
  const evidence = context.policyAuthorityEvidence;
  if (evidence === undefined) return null; // legacy payloads deliberately remain sidecar-less.
  if (context.versions.instructionPolicyRegistry === undefined || context.versions.policyAuthority === undefined) {
    throw new EffectiveCampaignContextRepositoryError("invalid_input");
  }
  const authority = resultRows<{ snapshot_ref: string }>(await database.execute(sql`
    select snapshot.snapshot_ref from tenant_authority_snapshots snapshot
    where snapshot.workspace_id = ${context.workspaceId}::uuid
      and snapshot.snapshot_ref = ${evidence.snapshotRef} and snapshot.snapshot_hash = ${evidence.snapshotHash}
      and snapshot.verified_at <= ${context.capturedAt}::timestamptz
      and snapshot.expires_at > ${context.capturedAt}::timestamptz
      and snapshot.snapshot_payload #>> '{policyAuthority,catalogHash}' = ${evidence.catalogHash}
      and snapshot.snapshot_payload #>> '{policyAuthority,scope,scopeHash}' = ${evidence.scopeHash}
      and exists (select 1 from policy_authority_catalog_revisions catalog
        where catalog.workspace_id = snapshot.workspace_id
          and catalog.revision_hash = ${evidence.catalogHash}
          and catalog.payload #>> '{instructionPolicyRegistryHash}' = ${context.versions.instructionPolicyRegistry})
    limit 2 for share
  `));
  if (authority.length !== 1) throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  const rows = resultRows<{ id: string; policy_ref: string; policy_version: number; canonical_hash: string }>(await database.execute(sql`
    select distinct policy.id::text as id, policy.policy_ref, policy.policy_version, policy.canonical_hash
    from policy_authority_bindings binding
    join strict_instruction_policy_revisions policy on policy.workspace_id = binding.workspace_id and policy.id = binding.policy_revision_id
    join tenant_authority_snapshots snapshot on snapshot.workspace_id = binding.workspace_id and snapshot.id = binding.authority_snapshot_id
    join policy_authority_catalog_revisions catalog on catalog.workspace_id = binding.workspace_id and catalog.id = binding.authority_catalog_revision_id
    where binding.workspace_id = ${context.workspaceId}::uuid and policy.policy_ref = any(${context.policies.map((policy) => policy.policyRef)}::text[])
      and snapshot.snapshot_ref = ${evidence.snapshotRef} and snapshot.snapshot_hash = ${evidence.snapshotHash}
      and catalog.revision_hash = ${evidence.catalogHash}
      and catalog.payload #>> '{instructionPolicyRegistryHash}' = ${context.versions.instructionPolicyRegistry}
  `));
  const current = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (current.has(row.policy_ref)) throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
    current.set(row.policy_ref, row);
  }
  if (current.size !== context.policies.length) throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
  const items = context.policies.map((policy) => {
    const row = current.get(policy.policyRef); if (!row) throw new EffectiveCampaignContextRepositoryError("workspace_scope_mismatch");
    return Object.freeze({ policyRevisionId: row.id, policyRef: row.policy_ref, policyVersion: row.policy_version,
      policyHash: row.canonical_hash, state: policy.state, reason: policy.reason });
  });
  const core = { instructionPolicyRegistryHash: context.versions.instructionPolicyRegistry,
    authorityComponentVersion: context.versions.policyAuthority, authoritySnapshotRef: evidence.snapshotRef,
    authoritySnapshotHash: evidence.snapshotHash, authorityCatalogHash: evidence.catalogHash, authorityScopeHash: evidence.scopeHash,
    items: items.map(({ policyRevisionId: _id, ...item }) => item) };
  return Object.freeze({ ...core, compositionHash: digest(core), items: Object.freeze(items) });
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
    analysisDataScope: Object.freeze({
      metaConnectionId: row.metaConnectionId,
      adAccountId: row.adAccountId,
      campaignId: row.campaignId,
    }),
    sourceComponents: Object.freeze(components.map((component) => Object.freeze(component))),
    invalidated: await isInvalidated(database, row),
  });
}

/** Append-only repository for authentic EffectiveCampaignContext snapshots. */
export class DrizzleEffectiveCampaignContextRepository {
  constructor(private readonly database: ContextDatabase) {}

  async save(candidate: EffectiveCampaignContext, options: Readonly<{
    mode?: EffectiveCampaignContextPersistenceMode;
  }> = {}): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    record: StoredEffectiveCampaignContext;
  }>> {
    const context = authenticContext(candidate);
    const mode = options.mode ?? "legacy_compatible";
    if (mode !== "legacy_compatible" && mode !== "evidence_bound") {
      throw new EffectiveCampaignContextRepositoryError("invalid_input");
    }
    if (mode === "evidence_bound" && (context.metaAnalysisConfigEvidence === undefined || context.cadenceEvidence === undefined)) {
      throw new EffectiveCampaignContextRepositoryError("invalid_input");
    }
    const expectedIdentityHash = identityHash(context);
    const components = sourceComponentsOf(context);
    return this.database.transaction(async (transaction) => {
      await assertWorkspace(transaction, context.workspaceId, true);
      const mirror = await assertMirrorScope(transaction, context);
      await assertDeterministicAnalysisData(transaction, context, mirror);
      await assertBusinessOutcomeEvidence(transaction, context);
      await assertCadenceEvidence(transaction, context, mirror);
      const policyComposition = await policyCompositionEvidence(transaction, context);
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
      if (policyComposition !== null) {
        const composition = await transaction.insert(schema.effectiveCampaignPolicyCompositions).values({
          workspaceId: context.workspaceId, contextId: inserted[0]!.id,
          instructionPolicyRegistryHash: policyComposition.instructionPolicyRegistryHash,
          authorityComponentVersion: policyComposition.authorityComponentVersion,
          authoritySnapshotRef: policyComposition.authoritySnapshotRef, authoritySnapshotHash: policyComposition.authoritySnapshotHash,
          authorityCatalogHash: policyComposition.authorityCatalogHash, authorityScopeHash: policyComposition.authorityScopeHash,
          compositionHash: policyComposition.compositionHash,
        }).returning({ id: schema.effectiveCampaignPolicyCompositions.id });
        if (!composition[0]) throw new EffectiveCampaignContextRepositoryError("corrupt_store");
        if (policyComposition.items.length) await transaction.insert(schema.effectiveCampaignPolicyCompositionItems).values(policyComposition.items.map((item) => ({
          workspaceId: context.workspaceId, compositionId: composition[0]!.id, ...item,
        })));
      }
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

  /**
   * Resolves the stable UI-safe campaign alias inside the tenant query. The
   * caller never submits or receives the underlying Meta campaign reference.
   */
  async loadLatestValidCampaignPublic(input: Readonly<{
    workspaceId: string;
    campaignRef: string;
  }>): Promise<StoredEffectiveCampaignContext | null> {
    required(input.workspaceId);
    if (!/^ref_[a-f0-9]{12}$/.test(input.campaignRef)) {
      throw new EffectiveCampaignContextRepositoryError("invalid_input");
    }
    await assertWorkspace(this.database, input.workspaceId, false);
    const candidates = await this.database.select().from(schema.effectiveCampaignContexts).where(and(
      eq(schema.effectiveCampaignContexts.workspaceId, input.workspaceId),
      eq(schema.effectiveCampaignContexts.entityType, "campaign"),
      sql`concat('ref_', substring(encode(digest(${schema.effectiveCampaignContexts.campaignRef}, 'sha256'), 'hex') from 1 for 12)) = ${input.campaignRef}`,
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
