import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { buildMetaDataHealthReport, META_DATA_HEALTH_MAX_ACCOUNTS, type MetaDataHealthReport } from "@/domain/meta/data-health";
import { metaPublicReference } from "@/domain/meta/public-reference";
import { publicSource, type PublicSource, type PublicSourceState } from "@/domain/source/public-source";

export const META_DATA_HEALTH_ADAPTER_VERSION = "meta-data-health-adapter/1.0.0" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGE_MINUTES = 24 * 60;
const MAX_ACCOUNTS = META_DATA_HEALTH_MAX_ACCOUNTS;
const REQUIRED_FIELDS = Object.freeze(["account", "campaign", "ad_set", "targeting", "creative_content"]);
const REQUIRED_STREAMS = Object.freeze(["creative", "insights", "inventory"]);

type Row = Readonly<Record<string, unknown>>;
export type MetaDataHealthQueryDatabase = Readonly<{ execute(query: unknown): Promise<unknown> }>;

export class MetaDataHealthAdapterError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "source_missing" | "source_ambiguous" | "corrupt_store") {
    super(`Meta data health adapter rejected: ${code}`); this.name = "MetaDataHealthAdapterError";
  }
}
function fail(code: MetaDataHealthAdapterError["code"]): never { throw new MetaDataHealthAdapterError(code); }
function rows(value: unknown): readonly Row[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly Row[];
}
function iso(value: unknown): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) fail("corrupt_store");
  const candidate = parsed.toISOString();
  return candidate;
}
function integer(value: unknown): number {
  const candidate = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(candidate) || candidate < 0) fail("corrupt_store"); return candidate;
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 366 || value.some((item) => typeof item !== "string")) fail("corrupt_store");
  return Object.freeze([...new Set(value)].sort());
}
function date(value: Date): string { return value.toISOString().slice(0, 10); }
function completedDates(evaluatedAt: string): readonly string[] {
  const end = new Date(`${date(new Date(evaluatedAt))}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() - 1);
  return Object.freeze(Array.from({ length: 7 }, (_, index) => { const day = new Date(end); day.setUTCDate(end.getUTCDate() - (6 - index)); return date(day); }));
}
function source(kind: PublicSource["kind"], observedAt: string, freshnessAt: string | null,
  base: Exclude<PublicSourceState, "stale">, reasons: readonly string[]): PublicSource {
  const stale = freshnessAt !== null && Date.parse(observedAt) - Date.parse(freshnessAt) > MAX_AGE_MINUTES * 60_000;
  return publicSource({ kind, state: stale ? "stale" : base, observedAt, freshnessAt,
    freshnessThresholdMinutes: MAX_AGE_MINUTES, reasonCodes: stale ? [...reasons, `${kind}_stale`] : reasons });
}

/** Server-only canonical mirror/performance/trust projection. It accepts no browser-shaped health evidence. */
export class DrizzleMetaDataHealthAdapter {
  constructor(private readonly database: MetaDataHealthQueryDatabase) {}

  async evaluate(input: Readonly<{ workspaceId: string; targetAdAccountId: string; evaluatedAt: string }>): Promise<Readonly<{
    version: typeof META_DATA_HEALTH_ADAPTER_VERSION; targetAccountRef: string; report: MetaDataHealthReport;
  }>> {
    if (!input || typeof input !== "object" || Object.keys(input).length !== 3 || !UUID.test(input.workspaceId)
      || !UUID.test(input.targetAdAccountId) || typeof input.evaluatedAt !== "string"
      || !Number.isFinite(Date.parse(input.evaluatedAt)) || new Date(input.evaluatedAt).toISOString() !== input.evaluatedAt) fail("invalid_input");
    const requiredDates = completedDates(input.evaluatedAt); const startDate = requiredDates[0]!; const endDate = requiredDates.at(-1)!;
    const result = rows(await this.database.execute(sql`
      select account.id::text as account_id, account.currency,
        greatest(account.fetched_at, facts.mirror_at) as mirror_at,
        facts.campaign_count::text, facts.ad_set_count::text, facts.targeting_count::text,
        facts.creative_count::text, facts.creative_content_count::text,
        performance.observed_dates, performance.performance_at,
        trust.completed_streams, trust.stream_count::text, trust.trust_at
      from ad_accounts account
      left join lateral (
        select max(observed_at) as mirror_at, count(distinct campaign_id) as campaign_count,
          count(distinct ad_set_id) as ad_set_count, count(distinct ad_set_id) filter (where targeting_present) as targeting_count,
          count(distinct creative_id) as creative_count,
          count(distinct creative_id) filter (where creative_content_present) as creative_content_count
        from (
          select campaign.id campaign_id, ad_set.id ad_set_id, creative.id creative_id,
            ad_set.targeting_summary is not null and ad_set.targeting_signature is not null targeting_present,
            num_nonnulls(creative.primary_text, creative.headline, creative.call_to_action_type, creative.destination_url) > 0 creative_content_present,
            greatest(campaign.fetched_at, ad_set.fetched_at, ad.fetched_at, creative.fetched_at) observed_at
          from ad_campaigns campaign
          left join meta_ad_sets ad_set on ad_set.workspace_id=campaign.workspace_id and ad_set.ad_account_id=campaign.ad_account_id and ad_set.campaign_id=campaign.id and ad_set.disappeared_at is null
          left join meta_ads ad on ad.workspace_id=campaign.workspace_id and ad.ad_account_id=campaign.ad_account_id and ad.campaign_id=campaign.id and ad.ad_set_id=ad_set.id and ad.disappeared_at is null
          left join meta_creatives creative on creative.workspace_id=campaign.workspace_id and creative.ad_account_id=campaign.ad_account_id and creative.id=ad.creative_id and creative.disappeared_at is null
          where campaign.workspace_id=account.workspace_id and campaign.ad_account_id=account.id and campaign.disappeared_at is null
        ) canonical
      ) facts on true
      left join lateral (
        select coalesce(array_agg(distinct insight.date_start::text order by insight.date_start::text), array[]::text[]) observed_dates,
          max(coalesce(insight.source_updated_at, insight.created_at)) performance_at
        from meta_daily_insights insight where insight.workspace_id=account.workspace_id and insight.ad_account_id=account.id
          and insight.date_start between ${startDate}::date and ${endDate}::date
      ) performance on true
      left join lateral (
        select coalesce(array_agg(distinct stream.stream_type::text order by stream.stream_type::text)
          filter (where stream.status='completed'), array[]::text[]) completed_streams,
          count(distinct stream.stream_type) as stream_count, max(stream.updated_at) trust_at
        from meta_sync_streams stream where stream.workspace_id=account.workspace_id and stream.ad_account_id=account.id
          and stream.stream_type in ('inventory','creative','insights')
      ) trust on true
      where account.workspace_id=${input.workspaceId}::uuid and account.disappeared_at is null
      order by account.id limit ${MAX_ACCOUNTS + 1}
    `));
    if (result.length === 0) fail("source_missing"); if (result.length > MAX_ACCOUNTS) fail("source_ambiguous");
    if (!result.some((row) => row.account_id === input.targetAdAccountId)) fail("workspace_scope_mismatch");
    const currencies = [...new Set(result.map((row) => typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) && row.currency !== "UNK" ? row.currency : null)
      .filter((value): value is string => value !== null))].sort();
    const workspaceCurrency = currencies.length === 1 ? currencies[0]! : null;
    const accounts = result.map((row) => {
      if (typeof row.account_id !== "string" || !UUID.test(row.account_id)) fail("corrupt_store");
      const observedDates = strings(row.observed_dates); const completedStreams = strings(row.completed_streams);
      const campaignCount = integer(row.campaign_count); const adSetCount = integer(row.ad_set_count);
      const targetingCount = integer(row.targeting_count); const creativeCount = integer(row.creative_count);
      const creativeContentCount = integer(row.creative_content_count);
      const observedFields = ["account", ...(campaignCount > 0 ? ["campaign"] : []),
        ...(adSetCount > 0 ? ["ad_set"] : []), ...(adSetCount > 0 && targetingCount === adSetCount ? ["targeting"] : []),
        ...(creativeCount > 0 && creativeContentCount === creativeCount ? ["creative_content"] : [])].sort();
      const missingFields = REQUIRED_FIELDS.filter((field) => !observedFields.includes(field));
      const missingDates = requiredDates.filter((day) => !observedDates.includes(day));
      const mirrorAt = iso(row.mirror_at); const performanceAt = iso(row.performance_at); const trustAt = iso(row.trust_at);
      const streamCount = integer(row.stream_count);
      return Object.freeze({ accountRef: metaPublicReference("account", input.workspaceId, row.account_id),
        currency: typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) && row.currency !== "UNK" ? row.currency : null,
        sources: Object.freeze({
          mirror: source("canonical_meta_mirror", input.evaluatedAt, mirrorAt, campaignCount === 0 ? "empty" : missingFields.length ? "partial" : "ready", missingFields.length ? ["canonical_field_coverage_incomplete"] : []),
          performance: source("canonical_performance", input.evaluatedAt, performanceAt, observedDates.length === 0 ? "empty" : missingDates.length ? "partial" : "ready", missingDates.length ? ["canonical_dates_missing"] : []),
          trust: source("derived_trust", input.evaluatedAt, trustAt, streamCount === 0 ? "empty" : REQUIRED_STREAMS.every((item) => completedStreams.includes(item)) ? "ready" : "partial", streamCount > 0 && !REQUIRED_STREAMS.every((item) => completedStreams.includes(item)) ? ["required_streams_incomplete"] : []),
        }), requiredDates, observedDates, requiredFields: REQUIRED_FIELDS, observedFields });
    });
    const workspaceRef = `workspace_${createHash("sha256").update(input.workspaceId).digest("hex").slice(0, 24)}`;
    const report = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency, evaluatedAt: input.evaluatedAt, accounts });
    return Object.freeze({ version: META_DATA_HEALTH_ADAPTER_VERSION,
      targetAccountRef: metaPublicReference("account", input.workspaceId, input.targetAdAccountId), report });
  }
}
