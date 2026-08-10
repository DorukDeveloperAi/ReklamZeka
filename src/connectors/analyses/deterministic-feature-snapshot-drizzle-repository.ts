import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { assertDeterministicFeatureSnapshot, type DeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import {
  assertRepositoryFeatureSourceRead,
  type FindingObservationFeatureSourceRead,
} from "@/connectors/analyses/finding-observation-drizzle-read-port";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export class DeterministicFeatureSnapshotRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "source_changed" | "corrupt_store") {
    super(`Deterministic feature snapshot reddedildi: ${code}`);
    this.name = "DeterministicFeatureSnapshotRepositoryError";
  }
}

export type CurrentDeterministicFeatureSnapshot =
  | Readonly<{ state: "ready"; feature: DeterministicFeatureSnapshot }>
  | Readonly<{ state: "stale"; feature: DeterministicFeatureSnapshot; invalidationEventHashes: readonly string[] }>;

function fail(code: DeterministicFeatureSnapshotRepositoryError["code"]): never {
  throw new DeterministicFeatureSnapshotRepositoryError(code);
}
function rows<T extends Row = Row>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function canonical(value: unknown): string { return JSON.stringify(stable(value)); }

/** Private L2 materializer. It writes only a source-attested, exact L1-bound immutable feature. */
export class DrizzleDeterministicFeatureSnapshotRepository {
  constructor(private readonly database: Database) {}

  /**
   * Private read path for frozen L2 evidence. It never silently substitutes a
   * newer L1 source: any persisted invalidation makes the historical feature
   * unavailable for current decision use while keeping it replayable.
   */
  async loadCurrent(input: Readonly<{ workspaceId: string; featureRef: string }>): Promise<CurrentDeterministicFeatureSnapshot> {
    if (!UUID.test(input.workspaceId) || typeof input.featureRef !== "string" || !input.featureRef.trim()) fail("invalid_input");
    const found = rows<{ feature_payload: unknown; invalidation_hashes: unknown }>(await this.database.execute(sql`
      select feature.feature_payload,
        coalesce(array_agg(invalidation.event_hash order by invalidation.event_hash)
          filter (where invalidation.id is not null), array[]::text[]) as invalidation_hashes
      from deterministic_feature_snapshots feature
      left join deterministic_feature_snapshot_invalidations invalidation
        on invalidation.workspace_id = feature.workspace_id and invalidation.feature_snapshot_id = feature.id
      where feature.workspace_id = ${input.workspaceId}::uuid and feature.feature_ref = ${input.featureRef}
      group by feature.id
      limit 2
    `));
    if (found.length === 0) fail("not_found");
    if (found.length !== 1 || !Array.isArray(found[0]!.invalidation_hashes)
      || found[0]!.invalidation_hashes.some((value) => typeof value !== "string" || !HASH.test(value))) fail("corrupt_store");
    try { assertDeterministicFeatureSnapshot(found[0]!.feature_payload); } catch { fail("corrupt_store"); }
    const feature = found[0]!.feature_payload;
    if (feature.scope.workspaceId !== input.workspaceId || feature.featureRef !== input.featureRef) fail("corrupt_store");
    const invalidationEventHashes = Object.freeze([...found[0]!.invalidation_hashes].sort());
    return invalidationEventHashes.length === 0
      ? Object.freeze({ state: "ready" as const, feature })
      : Object.freeze({ state: "stale" as const, feature, invalidationEventHashes });
  }

  async save(input: Readonly<{ feature: DeterministicFeatureSnapshot; source: FindingObservationFeatureSourceRead }>): Promise<Readonly<{ feature: DeterministicFeatureSnapshot; outcome: "inserted" | "unchanged" }>> {
    try { assertRepositoryFeatureSourceRead(input.source); assertDeterministicFeatureSnapshot(input.feature); } catch { fail("invalid_input"); }
    const { feature, source } = input;
    if (!feature || !Array.isArray(source.sourceManifest) || source.sourceManifest.length === 0) fail("invalid_input");
    if (source.read.rows.some((row) => row.workspaceId !== feature.scope.workspaceId || row.metaConnectionId !== feature.scope.metaConnectionId
      || row.adAccountId !== feature.scope.adAccountId || row.entityLevel !== feature.scope.entityLevel || row.externalEntityId !== feature.scope.externalEntityId)) fail("invalid_input");

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${feature.scope.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const scope = rows(await tx.execute(sql`
        select account.id from ad_accounts account join data_sources source
          on source.id = account.data_source_id and source.workspace_id = account.workspace_id
        where account.workspace_id = ${feature.scope.workspaceId}::uuid and account.id = ${feature.scope.adAccountId}::uuid
          and source.meta_connection_id = ${feature.scope.metaConnectionId}::uuid limit 2 for share
      `));
      if (scope.length !== 1) fail(scope.length === 0 ? "not_found" : "corrupt_store");
      const manifest = source.sourceManifest.map((item) => ({ id: item.dailyInsightId, sourcePayloadHash: item.sourcePayloadHash }));
      const current = rows<{ id: unknown; source_payload_hash: unknown }>(await tx.execute(sql`
        select insight.id::text as id, insight.source_payload_hash
        from meta_daily_insights insight
        join jsonb_to_recordset(${JSON.stringify(manifest)}::jsonb) as expected(id uuid, "sourcePayloadHash" text)
          on expected.id = insight.id and expected."sourcePayloadHash" = insight.source_payload_hash
        where insight.workspace_id = ${feature.scope.workspaceId}::uuid
        for share
      `));
      if (current.length !== manifest.length) fail("source_changed");

      const inserted = rows<{ id: unknown }>(await tx.execute(sql`
        insert into deterministic_feature_snapshots (
          workspace_id, meta_connection_id, ad_account_id, entity_level, external_entity_id, feature_ref, feature_hash,
          observation_ref, role, start_date, end_date, timezone, sample_size, settled, quality_status, quality_reason_codes,
          source_manifest_hash, formula_catalog_version, metric_result, feature_payload
        ) values (
          ${feature.scope.workspaceId}::uuid, ${feature.scope.metaConnectionId}::uuid, ${feature.scope.adAccountId}::uuid,
          ${feature.scope.entityLevel}::meta_insight_entity_level, ${feature.scope.externalEntityId}, ${feature.featureRef}, ${feature.featureHash},
          ${feature.observationRef}, ${feature.role}, ${feature.startDate}::date, ${feature.endDate}::date, ${feature.timezone},
          ${feature.sampleSize}, ${feature.settled}, ${feature.qualityStatus}, ${JSON.stringify(feature.qualityReasonCodes)}::jsonb,
          ${feature.sourceManifestHash}, ${feature.formulaCatalogVersion}, ${JSON.stringify(feature.metricResult)}::jsonb, ${JSON.stringify(feature)}::jsonb
        ) on conflict (workspace_id, feature_hash) do nothing returning id::text
      `));
      if (inserted.length === 0) {
        const existing = rows<{ feature_payload: unknown }>(await tx.execute(sql`
          select feature_payload from deterministic_feature_snapshots
          where workspace_id = ${feature.scope.workspaceId}::uuid and feature_hash = ${feature.featureHash} limit 2 for share
        `));
        if (existing.length !== 1 || canonical(existing[0]!.feature_payload) !== canonical(feature)) fail("corrupt_store");
        return Object.freeze({ feature, outcome: "unchanged" as const });
      }
      if (inserted.length !== 1 || typeof inserted[0]!.id !== "string") fail("corrupt_store");
      await tx.execute(sql`
        insert into deterministic_feature_snapshot_sources (workspace_id, feature_snapshot_id, daily_insight_id, snapshot_ref, content_hash)
        select ${feature.scope.workspaceId}::uuid, ${inserted[0]!.id}::uuid, source.id::uuid, source."snapshotRef", source."contentHash"
        from jsonb_to_recordset(${JSON.stringify(source.sourceManifest.map((item) => ({ id: item.dailyInsightId, snapshotRef: item.snapshotRef, contentHash: item.contentHash, sourcePayloadHash: item.sourcePayloadHash })))}::jsonb) as source(id text, "snapshotRef" text, "contentHash" text, "sourcePayloadHash" text)
      `);
      return Object.freeze({ feature, outcome: "inserted" as const });
    });
  }
}
