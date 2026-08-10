import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { buildDeterministicWindowSnapshot, type DeterministicWindowSnapshot } from "@/analyses/deterministic-window-snapshot";
import { assertDeterministicFeatureSnapshot, type DeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";

type Database = NodePgDatabase<any>;
type Row = Readonly<Record<string, unknown>>;
export class DeterministicWindowSnapshotRepositoryError extends Error { constructor(readonly code: "invalid_input" | "not_found" | "source_changed" | "corrupt_store") { super(`Deterministic window snapshot reddedildi: ${code}`); } }
const fail = (code: DeterministicWindowSnapshotRepositoryError["code"]): never => { throw new DeterministicWindowSnapshotRepositoryError(code); };
const rows = <T extends Row = Row>(value: unknown): readonly T[] => { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray((value as { rows?: unknown }).rows)) fail("corrupt_store"); return (value as { rows: readonly T[] }).rows; };

/** Server-private L3 materializer. Current L2 invalidation is a hard rejection, never a fallback. */
export class DrizzleDeterministicWindowSnapshotRepository {
  constructor(private readonly database: Database) {}
  async save(input: Readonly<{ window: DeterministicWindowSnapshot; features: readonly DeterministicFeatureSnapshot[] }>): Promise<Readonly<{ window: DeterministicWindowSnapshot; outcome: "inserted" | "unchanged" }>> {
    const expected = (() => {
      try { input.features.forEach(assertDeterministicFeatureSnapshot); return buildDeterministicWindowSnapshot({ timeframe: input.window.resolvedTimeframe, features: input.features }); }
      catch { return fail("invalid_input"); }
    })();
    if (expected.windowHash !== input.window.windowHash || expected.windowRef !== input.window.windowRef) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as Database; const scope = expected.scope;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${scope.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const current = rows<{ id: unknown; feature_payload: unknown }>(await tx.execute(sql`
        select feature.id::text as id, feature.feature_payload from deterministic_feature_snapshots feature
        left join deterministic_feature_snapshot_invalidations invalidation on invalidation.workspace_id = feature.workspace_id and invalidation.feature_snapshot_id = feature.id
        where feature.workspace_id = ${scope.workspaceId}::uuid and feature.feature_hash = any(${expected.featureHashes}::text[])
        group by feature.id having count(invalidation.id) = 0 for share
      `));
      if (current.length !== input.features.length) fail("source_changed");
      for (const row of current) try { assertDeterministicFeatureSnapshot(row.feature_payload); } catch { fail("corrupt_store"); }
      const inserted = rows<{ id: unknown }>(await tx.execute(sql`
        insert into deterministic_window_snapshots (workspace_id, meta_connection_id, ad_account_id, entity_level, external_entity_id, window_ref, window_hash, start_date, end_date, window_payload)
        values (${scope.workspaceId}::uuid, ${scope.metaConnectionId}::uuid, ${scope.adAccountId}::uuid, ${scope.entityLevel}::meta_insight_entity_level, ${scope.externalEntityId}, ${expected.windowRef}, ${expected.windowHash}, ${expected.resolvedTimeframe.startDate}::date, ${expected.resolvedTimeframe.endDate}::date, ${JSON.stringify(expected)}::jsonb)
        on conflict (workspace_id, window_hash) do nothing returning id::text
      `));
      if (inserted.length === 0) return Object.freeze({ window: expected, outcome: "unchanged" as const });
      if (inserted.length !== 1 || typeof inserted[0]!.id !== "string") fail("corrupt_store");
      await tx.execute(sql`insert into deterministic_window_snapshot_features (workspace_id, window_snapshot_id, feature_snapshot_id, feature_ref, feature_hash)
        select ${scope.workspaceId}::uuid, ${inserted[0]!.id}::uuid, feature.id, feature.feature_ref, feature.feature_hash from deterministic_feature_snapshots feature
        where feature.workspace_id = ${scope.workspaceId}::uuid and feature.feature_hash = any(${expected.featureHashes}::text[])`);
      return Object.freeze({ window: expected, outcome: "inserted" as const });
    });
  }
}
