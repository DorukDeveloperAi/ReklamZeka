import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { EffectiveAnalysisContextRequest } from "@/application/effective-analysis-context-composer";
import {
  META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
  normalizeMetaAnalysisConfigSnapshotV2,
  projectLegacyMetaChangeSnapshotConfig,
  type CanonicalMetaAnalysisConfigSnapshotV2,
} from "@/domain/meta/analysis-config-projection";
import { META_CHANGE_FIELD_CATALOG_VERSION, META_CHANGE_SNAPSHOT_SCHEMA_VERSION,
  type CanonicalMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;

export class CurrentMetaHierarchyConfigReaderError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "ambiguous" | "future" | "corrupt_store") {
    super(`Current Meta hierarchy config rejected: ${code}`);
    this.name = "CurrentMetaHierarchyConfigReaderError";
  }
}

function fail(code: CurrentMetaHierarchyConfigReaderError["code"]): never {
  throw new CurrentMetaHierarchyConfigReaderError(code);
}

function resultRows(value: unknown): readonly Row[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly Row[];
}

function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("corrupt_store");
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) fail("corrupt_store");
  return value;
}

function exactRequest(input: EffectiveAnalysisContextRequest): boolean {
  return !!input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 4
    && Object.keys(input).every((key) => ["workspaceId", "accountRef", "entityType", "entityRef"].includes(key))
    && UUID.test(input.workspaceId) && ID.test(input.accountRef) && ID.test(input.entityRef)
    && ["campaign", "ad_set", "ad", "creative"].includes(input.entityType);
}

function sourceObservation(value: unknown): Readonly<{ state: "known"; value: string | null }> {
  if (value !== null && typeof value !== "string") fail("corrupt_store");
  return Object.freeze({ state: "known", value });
}

function adSetRows(value: unknown): readonly Readonly<{ externalAdSetId: string; optimizationGoal: Readonly<{ state: "known"; value: string | null }> }>[] {
  if (!Array.isArray(value)) fail("corrupt_store");
  const parsed = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("corrupt_store");
    const candidate = entry as Row;
    if (Object.keys(candidate).length !== 2 || !("external_ad_set_id" in candidate) || !("optimization_goal" in candidate)) fail("corrupt_store");
    return Object.freeze({ externalAdSetId: text(candidate.external_ad_set_id), optimizationGoal: sourceObservation(candidate.optimization_goal) });
  });
  if (new Set(parsed.map((entry) => entry.externalAdSetId)).size !== parsed.length) fail("ambiguous");
  return Object.freeze(parsed.sort((left, right) => left.externalAdSetId.localeCompare(right.externalAdSetId)));
}

function validateSnapshot(snapshot: unknown, row: Row, workspaceId: string, accountRef: string, campaignRef: string,
  configAdSets: readonly Readonly<{ externalAdSetId: string }>[], capturedAt: string): CanonicalMetaChangeSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || typeof row.source_snapshot_hash !== "string" || !HASH.test(row.source_snapshot_hash)
    || typeof row.source_snapshot_schema_version !== "number" || !Number.isSafeInteger(row.source_snapshot_schema_version)
    || typeof row.source_snapshot_field_catalog_version !== "string") fail("corrupt_store");
  const canonical = snapshot as CanonicalMetaChangeSnapshot;
  try { projectLegacyMetaChangeSnapshotConfig(canonical, campaignRef); }
  catch { fail("corrupt_store"); }
  if (canonical.workspaceId !== workspaceId || canonical.externalAccountId !== accountRef
    || canonical.snapshotHash !== row.source_snapshot_hash || canonical.schemaVersion !== row.source_snapshot_schema_version
    || canonical.fieldCatalogVersion !== row.source_snapshot_field_catalog_version || canonical.capturedAt !== capturedAt
    || canonical.schemaVersion !== META_CHANGE_SNAPSHOT_SCHEMA_VERSION
    || canonical.fieldCatalogVersion !== META_CHANGE_FIELD_CATALOG_VERSION) {
    fail("corrupt_store");
  }
  const campaign = canonical.entities.find((entry) => entry.entityType === "campaign" && entry.externalId === campaignRef);
  if (!campaign) fail("corrupt_store");
  const snapshotAdSets = canonical.entities.filter((entry) => entry.entityType === "ad_set" && entry.parentExternalIds.length === 1
    && entry.parentExternalIds[0] === campaignRef).map((entry) => entry.externalId).sort();
  const currentAdSets = configAdSets.map((entry) => entry.externalAdSetId).sort();
  if (snapshotAdSets.length !== currentAdSets.length || snapshotAdSets.some((entry, index) => entry !== currentAdSets[index])) {
    fail("corrupt_store");
  }
  return canonical;
}

export type CurrentMetaHierarchyConfig = Readonly<{
  capturedAt: string;
  identity: Readonly<{ connectionRef: string; accountRef: string; campaignRef: string; hierarchyRefs: readonly string[] }>;
  metaAnalysisConfigSnapshot: CanonicalMetaAnalysisConfigSnapshotV2;
  sourceSnapshotEvidence: Readonly<{ snapshotId: string; publicRef: string; snapshotHash: string; capturedAt: string }>;
}>;

/**
 * Reads only from a transaction provided by the caller. The source seam owns
 * transaction creation; this reader neither starts nor changes a transaction.
 */
export class CurrentMetaHierarchyConfigReader {
  async readCurrent(transaction: Database, input: EffectiveAnalysisContextRequest): Promise<CurrentMetaHierarchyConfig> {
    if (!exactRequest(input)) fail("invalid_input");
    const candidates = resultRows(await transaction.execute(sql`
      select workspace.id::text as workspace_id, connection.external_connection_key as connection_ref,
        account.external_account_id as account_ref, campaign.external_campaign_id as campaign_ref,
        case ${input.entityType}
          when 'campaign' then array[campaign.external_campaign_id]
          when 'ad_set' then array[campaign.external_campaign_id, target_ad_set.external_ad_set_id]
          when 'ad' then array[campaign.external_campaign_id, target_ad_set.external_ad_set_id, target_ad.external_ad_id]
          when 'creative' then array[campaign.external_campaign_id, target_ad_set.external_ad_set_id, target_ad.external_ad_id, target_creative.external_creative_id]
        end as hierarchy_refs,
        campaign.objective_source as campaign_objective,
        coalesce(jsonb_agg(jsonb_build_object('external_ad_set_id', config_ad_set.external_ad_set_id,
          'optimization_goal', config_ad_set.optimization_goal) order by config_ad_set.external_ad_set_id)
          filter (where config_ad_set.id is not null), '[]'::jsonb) as ad_sets,
        snapshot.id::text as source_snapshot_id, snapshot.public_ref as source_snapshot_public_ref,
        snapshot.snapshot_hash as source_snapshot_hash, snapshot.schema_version as source_snapshot_schema_version,
        snapshot.field_catalog_version as source_snapshot_field_catalog_version,
        to_char(snapshot.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_snapshot_captured_at,
        snapshot.canonical_payload as source_snapshot_payload,
        to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as database_now
      from workspaces workspace
      join ad_accounts account on account.workspace_id = workspace.id
        and account.external_account_id = ${input.accountRef} and account.disappeared_at is null
      join data_sources data_source on data_source.id = account.data_source_id and data_source.workspace_id = workspace.id
      join meta_connections connection on connection.id = data_source.meta_connection_id and connection.workspace_id = workspace.id
        and connection.status = 'active' and connection.disconnected_at is null and connection.revoked_at is null
      join ad_campaigns campaign on campaign.workspace_id = workspace.id and campaign.ad_account_id = account.id
        and campaign.external_campaign_id = ${input.entityType === "campaign" ? input.entityRef : sql`campaign.external_campaign_id`}
        and campaign.disappeared_at is null
      left join meta_ad_sets target_ad_set on target_ad_set.workspace_id = workspace.id and target_ad_set.ad_account_id = account.id
        and target_ad_set.campaign_id = campaign.id and target_ad_set.external_ad_set_id = ${input.entityType === "ad_set" ? input.entityRef : sql`target_ad_set.external_ad_set_id`}
        and target_ad_set.disappeared_at is null
      left join meta_ads target_ad on target_ad.workspace_id = workspace.id and target_ad.ad_account_id = account.id
        and target_ad.campaign_id = campaign.id and target_ad.ad_set_id = target_ad_set.id
        and target_ad.external_ad_id = ${input.entityType === "ad" ? input.entityRef : sql`target_ad.external_ad_id`}
        and target_ad.disappeared_at is null
      left join meta_creatives target_creative on target_creative.workspace_id = workspace.id and target_creative.ad_account_id = account.id
        and target_creative.id = target_ad.creative_id and target_creative.external_creative_id = ${input.entityType === "creative" ? input.entityRef : sql`target_creative.external_creative_id`}
        and target_creative.disappeared_at is null
      left join meta_ad_sets config_ad_set on config_ad_set.workspace_id = workspace.id and config_ad_set.ad_account_id = account.id
        and config_ad_set.campaign_id = campaign.id and config_ad_set.disappeared_at is null
      join lateral (
        select candidate.* from meta_change_snapshots candidate
        where candidate.workspace_id = workspace.id and candidate.meta_connection_id = connection.id
          and candidate.ad_account_id = account.id and candidate.captured_at <= transaction_timestamp()
        order by candidate.captured_at desc, candidate.persisted_at desc, candidate.id desc
        limit 1
      ) snapshot on true
      where workspace.id = ${input.workspaceId}::uuid and workspace.lifecycle_state = 'active'
        and (${input.entityType} = 'campaign' or target_ad_set.id is not null)
        and (${input.entityType} in ('campaign', 'ad_set') or target_ad.id is not null)
        and (${input.entityType} <> 'creative' or target_creative.id is not null)
      group by workspace.id, connection.external_connection_key, account.external_account_id, campaign.external_campaign_id,
        target_ad_set.external_ad_set_id, target_ad.external_ad_id, target_creative.external_creative_id,
        campaign.objective_source, snapshot.id, snapshot.public_ref, snapshot.snapshot_hash, snapshot.schema_version,
        snapshot.field_catalog_version, snapshot.captured_at, snapshot.canonical_payload
      limit 2
    `));
    if (candidates.length === 0) fail("not_found");
    if (candidates.length !== 1) fail("ambiguous");
    const row = candidates[0]!;
    const capturedAt = iso(row.database_now);
    const sourceCapturedAt = iso(row.source_snapshot_captured_at);
    if (Date.parse(sourceCapturedAt) > Date.parse(capturedAt)) fail("future");
    const workspaceId = typeof row.workspace_id === "string" && UUID.test(row.workspace_id) ? row.workspace_id : fail("corrupt_store");
    const accountRef = text(row.account_ref);
    const campaignRef = text(row.campaign_ref);
    const connectionRef = text(row.connection_ref);
    if (workspaceId !== input.workspaceId || accountRef !== input.accountRef) fail("corrupt_store");
    const hierarchyRefs = Array.isArray(row.hierarchy_refs) && row.hierarchy_refs.every((entry) => typeof entry === "string" && ID.test(entry))
      ? Object.freeze([...row.hierarchy_refs] as string[]) : fail("corrupt_store");
    const expectedDepth = { campaign: 1, ad_set: 2, ad: 3, creative: 4 }[input.entityType];
    if (hierarchyRefs.length !== expectedDepth || hierarchyRefs[0] !== campaignRef || hierarchyRefs.at(-1) !== input.entityRef) fail("corrupt_store");
    const adSets = adSetRows(row.ad_sets);
    validateSnapshot(row.source_snapshot_payload, row, workspaceId, accountRef, campaignRef, adSets, sourceCapturedAt);
    let metaAnalysisConfigSnapshot: CanonicalMetaAnalysisConfigSnapshotV2;
    try {
      metaAnalysisConfigSnapshot = normalizeMetaAnalysisConfigSnapshotV2({ version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION,
        workspaceId, externalAccountId: accountRef, capturedAt,
        campaigns: [{ externalCampaignId: campaignRef, objective: sourceObservation(row.campaign_objective) }],
        adSets: adSets.map((adSet) => ({ externalAdSetId: adSet.externalAdSetId, externalCampaignId: campaignRef,
          optimizationGoal: adSet.optimizationGoal })),
      });
    } catch { fail("corrupt_store"); }
    if (typeof row.source_snapshot_id !== "string" || !UUID.test(row.source_snapshot_id)
      || typeof row.source_snapshot_public_ref !== "string" || !/^snapshot_[a-f0-9]{20}$/.test(row.source_snapshot_public_ref)
      || typeof row.source_snapshot_hash !== "string" || !HASH.test(row.source_snapshot_hash)) fail("corrupt_store");
    return Object.freeze({ capturedAt, identity: Object.freeze({ connectionRef, accountRef, campaignRef, hierarchyRefs }),
      metaAnalysisConfigSnapshot,
      sourceSnapshotEvidence: Object.freeze({ snapshotId: row.source_snapshot_id, publicRef: row.source_snapshot_public_ref,
        snapshotHash: row.source_snapshot_hash, capturedAt: sourceCapturedAt }),
    });
  }
}
