import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { settledThroughDate, type CreativeDiagnosticSettlementPolicy } from "@/analyses/creative-diagnostic-settlement-policy";
import { DrizzleCreativeDiagnosticSettlementPolicyRepository } from "@/connectors/analyses/creative-diagnostic-settlement-policy-drizzle-repository";
import { CreativeWindowAllDaysSourceError, type CreativeWindowAllDaysSource } from "@/connectors/meta/creative-window-all-days-source";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreativeDiagnosticWindowInsightSnapshotRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "insufficient_evidence" | "corrupt_store") {
    super(`Creative diagnostic window snapshot rejected: ${code}`);
    this.name = "CreativeDiagnosticWindowInsightSnapshotRepositoryError";
  }
}
function fail(code: CreativeDiagnosticWindowInsightSnapshotRepositoryError["code"]): never { throw new CreativeDiagnosticWindowInsightSnapshotRepositoryError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function day(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) fail("invalid_input");
  return value;
}
function calendarDays(startDate: string, endDate: string): readonly string[] {
  const values: string[] = []; const cursor = new Date(`${startDate}T00:00:00.000Z`); const end = new Date(`${endDate}T00:00:00.000Z`);
  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) values.push(cursor.toISOString().slice(0, 10));
  return Object.freeze(values);
}
function decimal(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) fail("corrupt_store");
  const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) fail("corrupt_store"); return parsed;
}
function integer(value: unknown): number {
  const parsed = decimal(value); if (!Number.isSafeInteger(parsed)) fail("corrupt_store"); return parsed;
}
type SettlementPolicyReader = Pick<DrizzleCreativeDiagnosticSettlementPolicyRepository, "loadCurrentPublishedInTransaction">;

/**
 * Materializes exactly one source-grain day. It deliberately refuses an
 * aggregate period because Meta frequency is non-additive and daily source
 * observations cannot prove a multi-day frequency value.
 */
export class DrizzleCreativeDiagnosticWindowInsightSnapshotRepository {
  constructor(private readonly database: Database,
    private readonly policies: SettlementPolicyReader = new DrizzleCreativeDiagnosticSettlementPolicyRepository(database),
    private readonly allDaysSource?: CreativeWindowAllDaysSource) {}

  async materializeDaily(input: Readonly<{
    workspaceId: string; configSnapshotId: string; windowKind: "baseline" | "recent";
    date: string; settlementPolicyRef: string; observedAt: string;
  }>): Promise<Readonly<{
    id: string; snapshotHash: string; sourceRef: string; settlementPolicy: CreativeDiagnosticSettlementPolicy; inserted: boolean;
  }>> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.configSnapshotId) || !["baseline", "recent"].includes(input.windowKind)
      || !/^creative_settlement_[a-f0-9]{24}$/.test(input.settlementPolicyRef)) fail("invalid_input");
    const date = day(input.date); const observedAt = iso(input.observedAt);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      let policy: CreativeDiagnosticSettlementPolicy;
      try { policy = await this.policies.loadCurrentPublishedInTransaction(tx, { workspaceId: input.workspaceId, policyRef: input.settlementPolicyRef }); }
      catch { fail("insufficient_evidence"); }
      const found = rows<Readonly<{
        insight_id: unknown; source_payload_hash: unknown; attribution_label: unknown; timezone: unknown;
        frequency_count: unknown; clicks_count: unknown; impressions_count: unknown;
        frequency: unknown; clicks: unknown; impressions: unknown;
        frequency_source_hash: unknown; clicks_source_hash: unknown; impressions_source_hash: unknown;
      }>>(await tx.execute(sql`
        with source_row as (
          select insight.*
          from meta_creative_config_snapshots config
          join frozen_diagnostic_evidence evidence on evidence.workspace_id = config.workspace_id and evidence.id = config.target_evidence_id
          join effective_campaign_contexts context on context.workspace_id = evidence.workspace_id and context.id = evidence.context_id
          join meta_ads ad on ad.workspace_id = config.workspace_id and ad.id = config.ad_id and ad.disappeared_at is null
          join workspaces workspace on workspace.id = config.workspace_id and workspace.lifecycle_state = 'active'
          join meta_daily_insights insight on insight.workspace_id = config.workspace_id and insight.ad_account_id = ad.ad_account_id
            and insight.entity_level = 'ad' and insight.external_entity_id = ad.external_ad_id
            and insight.date_start = ${date}::date and insight.date_stop = ${date}::date
          where config.workspace_id = ${input.workspaceId}::uuid and config.id = ${input.configSnapshotId}::uuid
            and evidence.entity_type = 'ad' and context.entity_type = 'ad'
          order by insight.id asc limit 2 for share
        )
        select source_row.id::text as insight_id, source_row.source_payload_hash, source_row.attribution_label, source_row.timezone,
          count(metric.id) filter (where metric.metric_key = 'frequency' and metric.action_type = '')::int as frequency_count,
          count(metric.id) filter (where metric.metric_key = 'clicks' and metric.action_type = '')::int as clicks_count,
          count(metric.id) filter (where metric.metric_key = 'impressions' and metric.action_type = '')::int as impressions_count,
          max(metric.value_decimal) filter (where metric.metric_key = 'frequency' and metric.action_type = '')::text as frequency,
          max(metric.value_decimal) filter (where metric.metric_key = 'clicks' and metric.action_type = '')::text as clicks,
          max(metric.value_decimal) filter (where metric.metric_key = 'impressions' and metric.action_type = '')::text as impressions,
          max(metric.source_payload_hash) filter (where metric.metric_key = 'frequency' and metric.action_type = '') as frequency_source_hash,
          max(metric.source_payload_hash) filter (where metric.metric_key = 'clicks' and metric.action_type = '') as clicks_source_hash,
          max(metric.source_payload_hash) filter (where metric.metric_key = 'impressions' and metric.action_type = '') as impressions_source_hash
        from source_row left join meta_daily_insight_metrics metric on metric.daily_insight_id = source_row.id
        group by source_row.id, source_row.source_payload_hash, source_row.attribution_label, source_row.timezone
        order by source_row.id asc
      `));
      if (found.length === 0) fail("not_found");
      if (found.length !== 1) fail("insufficient_evidence");
      const source = found[0]!;
      if (typeof source.insight_id !== "string" || !UUID.test(source.insight_id) || typeof source.source_payload_hash !== "string" || !HASH.test(source.source_payload_hash)
        || typeof source.attribution_label !== "string" || !source.attribution_label.trim() || typeof source.timezone !== "string" || !source.timezone.trim()
        || source.frequency_count !== 1 || source.clicks_count !== 1 || source.impressions_count !== 1
        || ![source.frequency_source_hash, source.clicks_source_hash, source.impressions_source_hash].every((value) => typeof value === "string" && HASH.test(value))) fail("insufficient_evidence");
      let settled: string;
      try { settled = settledThroughDate(policy, observedAt, source.timezone); } catch { fail("corrupt_store"); }
      if (date > settled) fail("insufficient_evidence");
      const frequency = decimal(source.frequency); const clicks = integer(source.clicks); const impressions = integer(source.impressions);
      const sourceHash = digest(Object.freeze({ insightId: source.insight_id, payloadHash: source.source_payload_hash,
        frequencySourceHash: source.frequency_source_hash, clicksSourceHash: source.clicks_source_hash, impressionsSourceHash: source.impressions_source_hash }));
      const sourceRef = `creative_window_${digest(`${source.insight_id}:${sourceHash}`).slice(0, 24)}`;
      const sourceSnapshotRef = `snapshot_${digest(`${source.insight_id}:${sourceHash}`).slice(0, 32)}`;
      const dailyCoverage = Object.freeze([Object.freeze({ date, settled: true, sourceSnapshotRef })]);
      const snapshotHash = digest(Object.freeze({ contractVersion: "creative-diagnostic-window-snapshot/1.0.0", configSnapshotId: input.configSnapshotId,
        windowKind: input.windowKind, date, frequency, clicks, impressions, attributionLabel: source.attribution_label, timezone: source.timezone,
        sourceRef, sourceHash, dailyCoverage, settlementPolicyRef: policy.policyRef, settlementPolicyHash: policy.policyHash }));
      const inserted = rows<{ id: unknown }>(await tx.execute(sql`
        insert into meta_creative_window_insight_snapshots (id, workspace_id, config_snapshot_id, window_kind, start_date, end_date,
          frequency, clicks, impressions, attribution_label, timezone, daily_coverage, source_ref, source_hash, settlement_policy_ref, settlement_policy_hash, snapshot_hash, observed_at)
        values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${input.configSnapshotId}::uuid, ${input.windowKind}, ${date}::date, ${date}::date,
          ${String(frequency)}::numeric, ${clicks}, ${impressions}, ${source.attribution_label}, ${source.timezone}, ${JSON.stringify(dailyCoverage)}::jsonb,
          ${sourceRef}, ${sourceHash}, ${policy.policyRef}, ${policy.policyHash}, ${snapshotHash}, ${observedAt}::timestamptz)
        on conflict (workspace_id, snapshot_hash) do nothing returning id::text
      `));
      if (inserted.length === 1 && typeof inserted[0]!.id === "string" && UUID.test(inserted[0]!.id)) return Object.freeze({ id: inserted[0]!.id, snapshotHash, sourceRef, settlementPolicy: policy, inserted: true });
      if (inserted.length !== 0) fail("corrupt_store");
      const existing = rows<{ id: unknown; settlement_policy_ref: unknown; settlement_policy_hash: unknown; source_hash: unknown }>(await tx.execute(sql`
        select id::text, settlement_policy_ref, settlement_policy_hash, source_hash from meta_creative_window_insight_snapshots
        where workspace_id = ${input.workspaceId}::uuid and snapshot_hash = ${snapshotHash} limit 2 for share
      `));
      if (existing.length !== 1 || typeof existing[0]!.id !== "string" || !UUID.test(existing[0]!.id)
        || existing[0]!.settlement_policy_ref !== policy.policyRef || existing[0]!.settlement_policy_hash !== policy.policyHash || existing[0]!.source_hash !== sourceHash) fail("corrupt_store");
      return Object.freeze({ id: existing[0]!.id, snapshotHash, sourceRef, settlementPolicy: policy, inserted: false });
    });
  }

  /**
   * Captures a direct `time_increment=all_days` frequency value plus complete
   * canonical daily coverage. It never derives the period frequency from rows.
   */
  async materializeAllDays(input: Readonly<{
    workspaceId: string; configSnapshotId: string; windowKind: "baseline" | "recent";
    startDate: string; endDate: string; settlementPolicyRef: string; observedAt: string;
  }>): Promise<Readonly<{
    id: string; snapshotHash: string; sourceRef: string; settlementPolicy: CreativeDiagnosticSettlementPolicy; inserted: boolean;
  }>> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.configSnapshotId) || !["baseline", "recent"].includes(input.windowKind)
      || !/^creative_settlement_[a-f0-9]{24}$/.test(input.settlementPolicyRef)) fail("invalid_input");
    const startDate = day(input.startDate); const endDate = day(input.endDate); if (startDate > endDate) fail("invalid_input");
    const observedAt = iso(input.observedAt); if (!this.allDaysSource) fail("insufficient_evidence");
    const scope = rows<{ account_ref: unknown; ad_ref: unknown }>(await this.database.execute(sql`
      select account.external_account_id as account_ref, ad.external_ad_id as ad_ref
      from meta_creative_config_snapshots config
      join meta_ads ad on ad.workspace_id = config.workspace_id and ad.id = config.ad_id and ad.disappeared_at is null
      join ad_accounts account on account.workspace_id = config.workspace_id and account.id = ad.ad_account_id and account.disappeared_at is null
      join workspaces workspace on workspace.id = config.workspace_id and workspace.lifecycle_state = 'active'
      where config.workspace_id = ${input.workspaceId}::uuid and config.id = ${input.configSnapshotId}::uuid
      limit 2
    `));
    if (scope.length === 0) fail("not_found");
    if (scope.length !== 1 || typeof scope[0]!.account_ref !== "string" || typeof scope[0]!.ad_ref !== "string") fail("corrupt_store");
    let direct: Awaited<ReturnType<CreativeWindowAllDaysSource["read"]>>;
    try { direct = await this.allDaysSource.read({ accountRef: scope[0]!.account_ref, adRef: scope[0]!.ad_ref, startDate, endDate }); }
    catch (error) {
      if (error instanceof CreativeWindowAllDaysSourceError && ["not_found", "ambiguous", "malformed"].includes(error.code)) fail("insufficient_evidence");
      fail("corrupt_store");
    }
    if (direct.startDate !== startDate || direct.endDate !== endDate || !/^creative_window_[a-f0-9]{24}$/.test(direct.sourceRef) || !HASH.test(direct.sourceHash)) fail("corrupt_store");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      let policy: CreativeDiagnosticSettlementPolicy;
      try { policy = await this.policies.loadCurrentPublishedInTransaction(tx, { workspaceId: input.workspaceId, policyRef: input.settlementPolicyRef }); }
      catch { fail("insufficient_evidence"); }
      const daily = rows<{ insight_id: unknown; insight_date: unknown; source_payload_hash: unknown; timezone: unknown }>(await tx.execute(sql`
        select insight.id::text as insight_id, insight.date_start::text as insight_date, insight.source_payload_hash, insight.timezone
        from meta_creative_config_snapshots config
        join meta_ads ad on ad.workspace_id = config.workspace_id and ad.id = config.ad_id and ad.disappeared_at is null
        join meta_daily_insights insight on insight.workspace_id = config.workspace_id and insight.ad_account_id = ad.ad_account_id
          and insight.entity_level = 'ad' and insight.external_entity_id = ad.external_ad_id
          and insight.date_start = insight.date_stop and insight.date_start >= ${startDate}::date and insight.date_stop <= ${endDate}::date
          and insight.attribution_label = 'account_default'
        join workspaces workspace on workspace.id = config.workspace_id and workspace.lifecycle_state = 'active'
        where config.workspace_id = ${input.workspaceId}::uuid and config.id = ${input.configSnapshotId}::uuid
        order by insight.date_start asc, insight.id asc limit 92 for share
      `));
      const expected = calendarDays(startDate, endDate);
      if (daily.length !== expected.length || new Set(daily.map((entry) => entry.insight_date)).size !== expected.length
        || daily.some((entry, index) => entry.insight_date !== expected[index] || typeof entry.insight_id !== "string" || !UUID.test(entry.insight_id)
          || typeof entry.source_payload_hash !== "string" || !HASH.test(entry.source_payload_hash) || typeof entry.timezone !== "string" || !entry.timezone.trim())) fail("insufficient_evidence");
      const timezone = daily[0]!.timezone as string; if (daily.some((entry) => entry.timezone !== timezone)) fail("insufficient_evidence");
      let settled: string; try { settled = settledThroughDate(policy, observedAt, timezone); } catch { fail("corrupt_store"); }
      if (endDate > settled) fail("insufficient_evidence");
      const frequency = decimal(direct.frequency); const clicks = integer(direct.clicks); const impressions = integer(direct.impressions);
      const dailyCoverage = Object.freeze(daily.map((entry) => Object.freeze({ date: entry.insight_date as string, settled: true,
        sourceSnapshotRef: `snapshot_${digest(`${entry.insight_id}:${entry.source_payload_hash}`).slice(0, 32)}` })));
      const snapshotHash = digest(Object.freeze({ contractVersion: "creative-diagnostic-window-snapshot/1.0.0", configSnapshotId: input.configSnapshotId,
        windowKind: input.windowKind, startDate, endDate, frequency, clicks, impressions, attributionLabel: "account_default", timezone,
        sourceRef: direct.sourceRef, sourceHash: direct.sourceHash, dailyCoverage, settlementPolicyRef: policy.policyRef, settlementPolicyHash: policy.policyHash }));
      const inserted = rows<{ id: unknown }>(await tx.execute(sql`
        insert into meta_creative_window_insight_snapshots (id, workspace_id, config_snapshot_id, window_kind, start_date, end_date,
          frequency, clicks, impressions, attribution_label, timezone, daily_coverage, source_ref, source_hash, settlement_policy_ref, settlement_policy_hash, snapshot_hash, observed_at)
        values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${input.configSnapshotId}::uuid, ${input.windowKind}, ${startDate}::date, ${endDate}::date,
          ${String(frequency)}::numeric, ${clicks}, ${impressions}, 'account_default', ${timezone}, ${JSON.stringify(dailyCoverage)}::jsonb,
          ${direct.sourceRef}, ${direct.sourceHash}, ${policy.policyRef}, ${policy.policyHash}, ${snapshotHash}, ${observedAt}::timestamptz)
        on conflict (workspace_id, snapshot_hash) do nothing returning id::text
      `));
      if (inserted.length === 1 && typeof inserted[0]!.id === "string" && UUID.test(inserted[0]!.id)) return Object.freeze({ id: inserted[0]!.id, snapshotHash, sourceRef: direct.sourceRef, settlementPolicy: policy, inserted: true });
      if (inserted.length !== 0) fail("corrupt_store");
      const existing = rows<{ id: unknown; settlement_policy_ref: unknown; settlement_policy_hash: unknown; source_hash: unknown }>(await tx.execute(sql`
        select id::text, settlement_policy_ref, settlement_policy_hash, source_hash from meta_creative_window_insight_snapshots
        where workspace_id = ${input.workspaceId}::uuid and snapshot_hash = ${snapshotHash} limit 2 for share
      `));
      if (existing.length !== 1 || typeof existing[0]!.id !== "string" || !UUID.test(existing[0]!.id)
        || existing[0]!.settlement_policy_ref !== policy.policyRef || existing[0]!.settlement_policy_hash !== policy.policyHash || existing[0]!.source_hash !== direct.sourceHash) fail("corrupt_store");
      return Object.freeze({ id: existing[0]!.id, snapshotHash, sourceRef: direct.sourceRef, settlementPolicy: policy, inserted: false });
    });
  }
}
