import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { buildDeterministicWindowSnapshot, type DeterministicWindowSnapshot } from "@/analyses/deterministic-window-snapshot";
import { assertDeterministicFeatureSnapshot, type DeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { validateResolvedAnalysisTimeframe, type ResolvedAnalysisTimeframe } from "@/analyses/timeframe-resolver";

type Database = NodePgDatabase<any>;
type Row = Readonly<Record<string, unknown>>;
export class DeterministicWindowSnapshotRepositoryError extends Error { constructor(readonly code: "invalid_input" | "not_found" | "source_changed" | "corrupt_store") { super(`Deterministic window snapshot reddedildi: ${code}`); } }
const fail = (code: DeterministicWindowSnapshotRepositoryError["code"]): never => { throw new DeterministicWindowSnapshotRepositoryError(code); };
const rows = <T extends Row = Row>(value: unknown): readonly T[] => { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray((value as { rows?: unknown }).rows)) fail("corrupt_store"); return (value as { rows: readonly T[] }).rows; };

/** Server-private L3 materializer. Current L2 invalidation is a hard rejection, never a fallback. */
export class DrizzleDeterministicWindowSnapshotRepository {
  constructor(private readonly database: Database) {}
  async loadCurrent(input: Readonly<{ workspaceId: string; windowRef: string }>): Promise<Readonly<{ state: "ready" | "stale"; window: DeterministicWindowSnapshot }>> {
    const found = rows<{ window_payload: unknown; features: unknown; invalidations: unknown }>(await this.database.execute(sql`
      select window.window_payload,
        coalesce(jsonb_agg(feature.feature_payload order by feature.feature_ref), '[]'::jsonb) as features,
        count(invalidation.id)::int as invalidations
      from deterministic_window_snapshots window
      join deterministic_window_snapshot_features binding on binding.workspace_id = window.workspace_id and binding.window_snapshot_id = window.id
      join deterministic_feature_snapshots feature on feature.workspace_id = binding.workspace_id and feature.id = binding.feature_snapshot_id
      left join deterministic_feature_snapshot_invalidations invalidation on invalidation.workspace_id = feature.workspace_id and invalidation.feature_snapshot_id = feature.id
      where window.workspace_id = ${input.workspaceId}::uuid and window.window_ref = ${input.windowRef}
      group by window.id limit 2
    `));
    if (found.length === 0) fail("not_found"); if (found.length !== 1 || !Array.isArray(found[0]!.features) || !Number.isInteger(found[0]!.invalidations)) fail("corrupt_store");
    const window = (() => { try { (found[0]!.features as unknown[]).forEach(assertDeterministicFeatureSnapshot); const payload = found[0]!.window_payload as DeterministicWindowSnapshot; return buildDeterministicWindowSnapshot({ timeframe: payload.resolvedTimeframe, features: found[0]!.features as DeterministicFeatureSnapshot[] }); } catch { return fail("corrupt_store"); } })();
    if (window.windowRef !== input.windowRef || window.scope.workspaceId !== input.workspaceId) fail("corrupt_store");
    return Object.freeze({ state: found[0]!.invalidations === 0 ? "ready" : "stale", window });
  }
  private expected(input: Readonly<{ window: DeterministicWindowSnapshot; features: readonly DeterministicFeatureSnapshot[] }>): DeterministicWindowSnapshot {
    const expected = (() => {
      try { input.features.forEach(assertDeterministicFeatureSnapshot); return buildDeterministicWindowSnapshot({ timeframe: input.window.resolvedTimeframe, features: input.features }); }
      catch { return fail("invalid_input"); }
    })();
    if (expected.windowHash !== input.window.windowHash || expected.windowRef !== input.window.windowRef) fail("invalid_input");
    return expected;
  }

  private async persist(tx: Database, expected: DeterministicWindowSnapshot, featureCount: number): Promise<Readonly<{ window: DeterministicWindowSnapshot; outcome: "inserted" | "unchanged" }>> {
      const scope = expected.scope;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${scope.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const current = rows<{ id: unknown; feature_payload: unknown }>(await tx.execute(sql`
        select feature.id::text as id, feature.feature_payload from deterministic_feature_snapshots feature
        where feature.workspace_id = ${scope.workspaceId}::uuid
          and feature.feature_hash in (
            select value from jsonb_array_elements_text(${JSON.stringify(expected.featureHashes)}::jsonb)
          )
          and not exists (
            select 1 from deterministic_feature_snapshot_invalidations invalidation
            where invalidation.workspace_id = feature.workspace_id
              and invalidation.feature_snapshot_id = feature.id
          )
        for share
      `));
      if (current.length !== featureCount) fail("source_changed");
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
        where feature.workspace_id = ${scope.workspaceId}::uuid
          and feature.feature_hash in (
            select value from jsonb_array_elements_text(${JSON.stringify(expected.featureHashes)}::jsonb)
          )`);
      return Object.freeze({ window: expected, outcome: "inserted" as const });
  }

  async save(input: Readonly<{ window: DeterministicWindowSnapshot; features: readonly DeterministicFeatureSnapshot[] }>): Promise<Readonly<{ window: DeterministicWindowSnapshot; outcome: "inserted" | "unchanged" }>> {
    const expected = this.expected(input);
    return this.database.transaction(async (transaction) => this.persist(transaction as Database, expected, input.features.length));
  }

  /** Resolves all current, valid L2 features for one exact scope/timeframe under a workspace lock. */
  async materializeForTimeframe(input: Readonly<{
    workspaceId: string; metaConnectionId: string; adAccountId: string;
    entityLevel: "campaign" | "ad_set" | "ad"; externalEntityId: string;
    timeframe: ResolvedAnalysisTimeframe;
  }>): Promise<Readonly<{ window: DeterministicWindowSnapshot; outcome: "inserted" | "unchanged" }>> {
    try { validateResolvedAnalysisTimeframe(input.timeframe); } catch { return fail("invalid_input"); }
    if (!input.workspaceId || !input.metaConnectionId || !input.adAccountId || !input.externalEntityId
      || !["campaign", "ad_set", "ad"].includes(input.entityLevel)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const selected = rows<{ feature_payload: unknown }>(await tx.execute(sql`
        select feature.feature_payload from deterministic_feature_snapshots feature
        where feature.workspace_id = ${input.workspaceId}::uuid
          and feature.meta_connection_id = ${input.metaConnectionId}::uuid
          and feature.ad_account_id = ${input.adAccountId}::uuid
          and feature.entity_level = ${input.entityLevel}::meta_insight_entity_level
          and feature.external_entity_id = ${input.externalEntityId}
          and feature.start_date >= ${input.timeframe.startDate}::date
          and feature.end_date <= ${input.timeframe.endDate}::date
          and not exists (select 1 from deterministic_feature_snapshot_invalidations invalidation
            where invalidation.workspace_id = feature.workspace_id and invalidation.feature_snapshot_id = feature.id)
        order by feature.feature_ref for share
      `));
      if (selected.length === 0) fail("not_found");
      const features: DeterministicFeatureSnapshot[] = [];
      try { for (const row of selected) { assertDeterministicFeatureSnapshot(row.feature_payload); features.push(row.feature_payload); } }
      catch { return fail("corrupt_store"); }
      const window = buildDeterministicWindowSnapshot({ timeframe: input.timeframe, features });
      return this.persist(tx, window, features.length);
    });
  }
}
