import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { OperationReadRepository } from "@/application/operation-read-service";
import type { OperationRowFact } from "@/domain/operations/operation-read-model";
import type { ScopeReportMetricInput } from "@/domain/slices/scope-report";
import { organizationCampaignPublicRef } from "@/domain/campaigns/organization-campaign";
import { metaPublicReference } from "@/domain/meta/public-reference";
import {
  categoryAssignmentPublicRef,
  categoryDefinitionPublicRef,
  categoryDimensionPublicRef,
} from "@/domain/categories/public-reference";
import { resolveCurrentOperationSliceResolution } from "@/connectors/operations/current-slice-resolution";
import type { SliceEntityCandidate } from "@/domain/slices/slice-resolver";
import type { SliceResolution } from "@/domain/slices/slice-resolver";
import type {
  SliceDimensionPredicate,
  SliceRevision,
} from "@/domain/slices/slice-definition";
import {
  inspectEffectiveCategory,
  type CategoryAssignment,
  type CategoryDefinition,
  type CategoryDimension,
} from "@/domain/categories/registry";
import {
  isPrimaryResultBindingRevision,
  resolvePrimaryResultBinding,
  type PrimaryResultBindingRevision,
} from "@/domain/operations/primary-result";
import { DrizzlePrimaryResultActionCatalogAdapter } from "@/connectors/operations/primary-result-action-catalog-drizzle-adapter";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
export type OperationReadTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type Transaction = OperationReadTransaction;
type Row = Record<string, unknown>;
type Cursor = Readonly<{ v: 3; c: string; k: 0 | 1; a: string; q: string }>;
export type CurrentSliceEvidence = Readonly<{
  sliceId: string | null;
  /** Public-only immutable resolution evidence. Null is the global table scope. */
  resolution: SliceResolution | null;
  sliceRef: string | null;
  revisionRef: string | null;
  revisionNumber: number | null;
  definitionHash: string | null;
  market: Readonly<{
    dimensionRef: string;
    valueRef: string;
    key: "yerli" | "yabanci";
  }> | null;
  organizationCampaignIds: readonly string[];
  campaignIds: readonly string[];
  adSetIds: readonly string[];
  campaignMarkets: ReadonlyMap<string, "yerli" | "yabanci">;
  adSetMarkets: ReadonlyMap<string, "yerli" | "yabanci">;
}>;
type ResolvedScope = CurrentSliceEvidence;
const UUID = /^[0-9a-f-]{36}$/i;
const PREFIX = "operation_cursor_";
const MAX_SLICE_CANDIDATES = 20_000;
const MAX_SCOPE_REPORT_METRICS = 50_000;
const rows = (result: unknown): readonly Row[] => {
  if (
    !result ||
    typeof result !== "object" ||
    !("rows" in result) ||
    !Array.isArray(result.rows)
  )
    throw new Error("operation read rejected: corrupt_store");
  return result.rows as readonly Row[];
};
const string = (row: Row, key: string): string => {
  const value = row[key];
  if (typeof value !== "string" || !value)
    throw new Error("operation read rejected: slice");
  return value;
};
const textArray = (value: unknown): readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : typeof value === "string" && /^\{[a-z_,]*\}$/.test(value)
      ? value.slice(1, -1).split(",").filter(Boolean)
      : [];
const compare = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
const unique = (values: readonly string[]) =>
  Object.freeze([...new Set(values)].sort(compare));
const canonicalDecimal = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  const normalizedInteger = integer!.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  const output = normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
  const parts = output.split(".");
  return parts[0]!.length + (parts[1]?.length ?? 0) <= 38 &&
    (parts[1]?.length ?? 0) <= 18
    ? output
    : null;
};
const uuidSet = (values: readonly string[]) =>
  sql`(select item::uuid from jsonb_array_elements_text(${JSON.stringify(values)}::jsonb) as entries(item))`;
const days = (start: string, end: string) =>
  Array.from(
    {
      length:
        Math.floor(
          (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
            86_400_000,
        ) + 1,
    },
    (_, index) =>
      new Date(Date.parse(`${start}T00:00:00Z`) + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
  );
const cursorContext = (input: Parameters<OperationReadRepository["load"]>[0]) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        period: input.period,
        sliceRef: input.sliceRef,
      }),
    )
    .digest("hex");
function decode(token: string | null, context: string): Cursor | null {
  if (!token) return null;
  try {
    const value = JSON.parse(
      Buffer.from(token.slice(PREFIX.length), "base64url").toString(),
    ) as Cursor;
    if (
      value?.v !== 3 ||
      !/^campaign_[A-Za-z0-9_-]{1,64}$/.test(value.c) ||
      (value.k !== 0 && value.k !== 1) ||
      typeof value.a !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.q) ||
      value.q !== context ||
      (value.k === 0 && value.a !== "") ||
      (value.k === 1 && !/^ad_set_[A-Za-z0-9_-]{1,64}$/.test(value.a))
    )
      throw new Error();
    return value;
  } catch {
    throw new Error("operation read rejected: cursor");
  }
}
const encode = (value: Cursor) =>
  `${PREFIX}${Buffer.from(JSON.stringify(value)).toString("base64url")}`;

/** Canonical mirror only. One campaign summary precedes its ad-set facts. */
export class DrizzleOperationReadRepository implements OperationReadRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}
  async workspaceTimeZone(workspaceId: string): Promise<string | null> {
    if (!UUID.test(workspaceId))
      throw new Error("operation read rejected: scope");
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`set local transaction isolation level repeatable read`,
      );
      await tx.execute(sql`set local transaction read only`);
      const result = rows(
        await tx.execute(
          sql`select array_agg(distinct timezone order by timezone) zones from ad_accounts where workspace_id=${workspaceId}::uuid and disappeared_at is null`,
        ),
      );
      const zones = textArray(result[0]?.zones);
      return zones.length === 1 && zones[0]!.trim() ? zones[0]! : null;
    });
  }
  /** Server-only, bounded evidence for consumers that need current published
   * slice membership without reimplementing resolver or market isolation. */
  async currentSliceEvidence(
    workspaceId: string,
    sliceRef: string | null,
  ): Promise<CurrentSliceEvidence> {
    if (
      !UUID.test(workspaceId) ||
      (sliceRef !== null &&
        !/^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/.test(sliceRef))
    )
      throw new Error("operation read rejected: scope");
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`set local transaction isolation level repeatable read`,
      );
      await tx.execute(sql`set local transaction read only`);
      return this.resolveCurrentScope(tx, workspaceId, sliceRef);
    });
  }

  /**
   * Same-snapshot variant for read models which already own their repeatable-
   * read transaction.  Callers must establish read-only RR before invoking it.
   */
  async currentSliceEvidenceInTransaction(
    tx: OperationReadTransaction,
    workspaceId: string,
    sliceRef: string | null,
  ): Promise<CurrentSliceEvidence> {
    if (
      !UUID.test(workspaceId) ||
      (sliceRef !== null &&
        !/^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/.test(sliceRef))
    )
      throw new Error("operation read rejected: scope");
    return this.resolveCurrentScope(tx, workspaceId, sliceRef);
  }

  /** Bounded long-form metric evidence for Kapsam Raporu. Aggregation and
   * ratios remain in the domain projection so raw actions are never lost. */
  async currentScopeReport(
    workspaceId: string,
    sliceRef: string,
    period: Readonly<{ startDate: string; endDate: string }>,
    actionType: string | null = null,
  ): Promise<Readonly<{ evidence: CurrentSliceEvidence; metrics: readonly ScopeReportMetricInput[] }>> {
    if (!UUID.test(workspaceId) || !/^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/.test(sliceRef)
      || !/^\d{4}-\d{2}-\d{2}$/.test(period.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(period.endDate)
      || period.startDate > period.endDate) throw new Error("scope report rejected: input");
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`set local transaction isolation level repeatable read`);
      await tx.execute(sql`set local transaction read only`);
      const evidence = await this.resolveCurrentScope(tx, workspaceId, sliceRef);
      const catalog = actionType === null ? null : await new DrizzlePrimaryResultActionCatalogAdapter({ transaction: async (callback: (transaction: Transaction) => Promise<unknown>) => callback(tx) } as never).load(workspaceId);
      if (actionType !== null && (!catalog || !catalog.catalog.actionTypes.includes(actionType))) throw new Error("scope report rejected: selector");
      const entities = [
        ...evidence.campaignIds.map((id) => ({ id, level: "campaign", ref: metaPublicReference("campaign", workspaceId, id) })),
        ...evidence.adSetIds.map((id) => ({ id, level: "ad_set", ref: metaPublicReference("ad_set", workspaceId, id) })),
      ];
      const reportEvidence = Object.freeze({ ...evidence, ...(catalog ? { catalogActionTypes: Object.freeze([...catalog.catalog.actionTypes]) } : {}) });
      if (!entities.length) return Object.freeze({ evidence: reportEvidence, metrics: Object.freeze([]) });
      const metricRows = rows(await tx.execute(sql`
        select w.ref entity_ref,w.level entity_level,i.date_start::text date,i.attribution_label attribution,
          m.metric_key,m.action_type,m.value_decimal::text value_decimal,m.value_minor::text value_minor,m.currency,
          case when m.availability->>'state'='available' then 'available' else 'unavailable' end availability
        from jsonb_to_recordset(${JSON.stringify(entities)}::jsonb) as w(id uuid,level text,ref text)
        join meta_daily_insights i on i.workspace_id=${workspaceId}::uuid
          and i.entity_level=w.level::meta_insight_entity_level
          and i.date_start>=${period.startDate}::date and i.date_stop<=${period.endDate}::date
          and ((w.level='campaign' and i.external_entity_id=(select c.external_campaign_id from ad_campaigns c where c.workspace_id=${workspaceId}::uuid and c.id=w.id))
            or (w.level='ad_set' and i.external_entity_id=(select a.external_ad_set_id from meta_ad_sets a where a.workspace_id=${workspaceId}::uuid and a.id=w.id)))
        join meta_daily_insight_metrics m on m.daily_insight_id=i.id
        order by w.ref,i.date_start,i.attribution_label,m.metric_key,m.action_type,m.id
        limit ${MAX_SCOPE_REPORT_METRICS + 1}`));
      if (metricRows.length > MAX_SCOPE_REPORT_METRICS) throw new Error("scope report rejected: metric_cap");
      const metrics = metricRows.map((row): ScopeReportMetricInput => {
        const level = string(row, "entity_level");
        if ((level !== "campaign" && level !== "ad_set") || (row.availability !== "available" && row.availability !== "unavailable")) throw new Error("scope report rejected: metric");
        return Object.freeze({ entityRef: string(row, "entity_ref"), entityLevel: level, date: string(row, "date"), attribution: string(row, "attribution"),
          metricKey: string(row, "metric_key"), actionType: typeof row.action_type === "string" && row.action_type ? row.action_type : null,
          valueDecimal: canonicalDecimal(row.value_decimal), valueMinor: canonicalDecimal(row.value_minor), currency: typeof row.currency === "string" && row.currency ? row.currency : null,
          availability: row.availability });
      });
      return Object.freeze({ evidence: reportEvidence, metrics: Object.freeze(metrics) });
    });
  }

  async load(input: Parameters<OperationReadRepository["load"]>[0]) {
    if (!UUID.test(input.workspaceId))
      throw new Error("operation read rejected: scope");
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`set local transaction isolation level repeatable read`,
      );
      await tx.execute(sql`set local transaction read only`);
      const cursor = decode(input.cursor, cursorContext(input));
      const scope = await this.resolveCurrentScope(
        tx,
        input.workspaceId,
        input.sliceRef,
      );
      // Parent membership never implicitly admits a child row: each projected
      // campaign/ad-set must itself survive the current resolver's hard market
      // and explicit-exclude checks.
      const scopeFilter =
        input.sliceRef === null
          ? sql`true`
          : sql`(kind=0 and campaign_id::uuid in ${uuidSet(scope.campaignIds)}) or (kind=1 and adset_id::uuid in ${uuidSet(scope.adSetIds)})`;
      const result = (await tx.execute(
        sql`with ci as (select i.workspace_id,i.ad_account_id,i.external_entity_id,array_agg(distinct i.date_start order by i.date_start)::text[] days,sum(m.value_minor) filter(where m.metric_key='spend' and m.currency is not distinct from i.currency)::bigint spend,count(m.id) filter(where m.metric_key='spend') spend_count,count(distinct coalesce(m.currency,i.currency)) filter(where m.metric_key='spend') currencies from meta_daily_insights i left join meta_daily_insight_metrics m on m.daily_insight_id=i.id where i.workspace_id=${input.workspaceId}::uuid and i.entity_level='campaign' and i.date_start>=${input.period.startDate}::date and i.date_stop<=${input.period.endDate}::date group by i.workspace_id,i.ad_account_id,i.external_entity_id), ai as (select i.workspace_id,i.ad_account_id,i.external_entity_id,array_agg(distinct i.date_start order by i.date_start)::text[] days,sum(m.value_minor) filter(where m.metric_key='spend' and m.currency is not distinct from i.currency)::bigint spend,count(m.id) filter(where m.metric_key='spend') spend_count,count(distinct coalesce(m.currency,i.currency)) filter(where m.metric_key='spend') currencies from meta_daily_insights i left join meta_daily_insight_metrics m on m.daily_insight_id=i.id where i.workspace_id=${input.workspaceId}::uuid and i.entity_level='ad_set' and i.date_start>=${input.period.startDate}::date and i.date_stop<=${input.period.endDate}::date group by i.workspace_id,i.ad_account_id,i.external_entity_id), base as (select c.id::text campaign_id,c.external_campaign_id,c.name campaign_name,('campaign_'||substr(encode(digest(convert_to(c.workspace_id::text,'UTF8')||decode('00','hex')||convert_to('campaign','UTF8')||decode('00','hex')||convert_to(c.id::text,'UTF8'),'sha256'),'hex'),1,24)) campaign_ref,a.id::text account_id,a.name account_name,s.id::text adset_id,s.external_ad_set_id,s.name adset_name,('ad_set_'||substr(encode(digest(convert_to(c.workspace_id::text,'UTF8')||decode('00','hex')||convert_to('ad_set','UTF8')||decode('00','hex')||convert_to(s.id::text,'UTF8'),'sha256'),'hex'),1,24)) adset_ref,c.campaign_budget_optimization cbo,c.daily_budget_minor campaign_budget,s.daily_budget_minor adset_budget,o.id::text org_id,o.label org_name,market.key market,ci.days cdays,ci.spend cspend,ci.spend_count ccount,ci.currencies ccurrencies,ai.days adays,ai.spend aspend,ai.spend_count acount,ai.currencies acurrencies from ad_campaigns c join ad_accounts a on a.id=c.ad_account_id and a.workspace_id=c.workspace_id left join meta_ad_sets s on s.workspace_id=c.workspace_id and s.campaign_id=c.id and s.disappeared_at is null left join organization_campaign_meta_memberships member on member.workspace_id=c.workspace_id and member.campaign_id=c.id and member.effective_to is null left join organization_campaigns o on o.id=member.organization_campaign_id and o.workspace_id=c.workspace_id left join category_definitions market on market.id=o.market_definition_id and market.workspace_id=o.workspace_id left join ci on ci.workspace_id=c.workspace_id and ci.ad_account_id=c.ad_account_id and ci.external_entity_id=c.external_campaign_id left join ai on ai.workspace_id=c.workspace_id and ai.ad_account_id=c.ad_account_id and ai.external_entity_id=s.external_ad_set_id where c.workspace_id=${input.workspaceId}::uuid and c.disappeared_at is null), facts as (select distinct on(campaign_id) *,0 kind,''::text aref,cdays days,cspend spend,ccount spend_count,ccurrencies currencies,case when cbo then campaign_budget else null end campaign_budget_out,null::bigint adset_budget_out from base union all select *,1 kind,adset_ref aref,adays days,aspend spend,acount spend_count,acurrencies currencies,null::bigint campaign_budget_out,case when cbo then null else adset_budget end adset_budget_out from base where adset_id is not null) select * from facts where (${scopeFilter}) and (${cursor?.c ?? null}::text is null or (campaign_ref,kind,aref)>(${cursor?.c ?? null}::text,${cursor?.k ?? null}::int,${cursor?.a ?? null}::text)) order by campaign_ref,kind,aref limit ${input.limit + 1}`,
      )) as { rows: Row[] };
      const expected = days(input.period.startDate, input.period.endDate),
        visible = result.rows.slice(0, input.limit);
      const spendInputs = visible.map((row, position) => ({
        position,
        entity_level: Number(row.kind) === 1 ? "ad_set" : "campaign",
        external_entity_id:
          Number(row.kind) === 1
            ? row.external_ad_set_id
            : row.external_campaign_id,
        account_id: row.account_id,
      }));
      const spendEvidence = rows(
        await tx.execute(
          sql`select w.position,sum(m.value_minor)::bigint spend,count(m.id) metric_count,count(distinct i.date_start) filter(where m.id is not null) day_count,count(distinct i.attribution_label) filter(where m.id is not null) attribution_count,count(distinct m.currency) currency_count from jsonb_to_recordset(${JSON.stringify(spendInputs)}::jsonb) as w(position int,entity_level text,external_entity_id text,account_id uuid) left join meta_daily_insights i on i.workspace_id=${input.workspaceId}::uuid and i.ad_account_id=w.account_id and i.entity_level=w.entity_level::meta_insight_entity_level and i.external_entity_id=w.external_entity_id and i.date_start>=${input.period.startDate}::date and i.date_stop<=${input.period.endDate}::date left join meta_daily_insight_metrics m on m.daily_insight_id=i.id and m.metric_key='spend' and m.value_minor is not null and m.currency=i.currency and coalesce(m.availability->>'state','available')='available' group by w.position`,
        ),
      );
      const spendByPosition = new Map(
        spendEvidence.map((row) => [Number(row.position), row]),
      );
      const bareFacts: OperationRowFact[] = visible.map((row, position) => {
        const observed = unique(textArray(row.days)),
          missing = expected.filter((day) => !observed.includes(day)),
          spend = spendByPosition.get(position),
          unavailable =
            Number(spend?.metric_count) !== expected.length ||
            Number(spend?.day_count) !== expected.length ||
            Number(spend?.attribution_count) !== 1,
          currencyMismatch = Number(spend?.currency_count) !== 1,
          kind = Number(row.kind),
          campaignId = string(row, "campaign_id"),
          adSetId = kind === 1 ? string(row, "adset_id") : null,
          effectiveMarket = scope
            ? kind === 1 && adSetId
              ? (scope.adSetMarkets.get(adSetId) ?? null)
              : (scope.campaignMarkets.get(campaignId) ?? null)
            : row.market === "yerli" || row.market === "yabanci"
              ? row.market
              : null;
        return {
          workspaceId: input.workspaceId,
          market: effectiveMarket,
          accountId: string(row, "account_id"),
          accountName: string(row, "account_name"),
          campaignId,
          campaignName: string(row, "campaign_name"),
          organizationCampaignId:
            typeof row.org_id === "string" ? row.org_id : null,
          organizationCampaignName:
            typeof row.org_name === "string" ? row.org_name : null,
          adSetId,
          adSetName: kind === 1 ? string(row, "adset_name") : null,
          insightExternalEntityId:
            kind === 1
              ? string(row, "external_ad_set_id")
              : string(row, "external_campaign_id"),
          cbo: row.cbo === true ? true : row.cbo === false ? false : null,
          campaignBudgetMinor:
            row.campaign_budget_out === null
              ? null
              : Number(row.campaign_budget_out),
          adSetBudgetMinor:
            row.adset_budget_out === null ? null : Number(row.adset_budget_out),
          spendMinor:
            unavailable || currencyMismatch || spend?.spend === null
              ? null
              : Number(spend?.spend),
          observedDays: observed,
          missingDays: missing,
          reasonCodes: [
            ...(missing.length ? ["coverage_incomplete"] : []),
            ...(unavailable ? ["spend_unavailable"] : []),
            ...(currencyMismatch ? ["currency_inconsistent"] : []),
          ],
          primaryResultBinding: { state: "unbound" },
          primaryResult: null,
          primaryResultCostMinor: null,
        };
      });
      const facts = await this.bindPrimaryResults(
        tx,
        input,
        scope.sliceId,
        bareFacts,
      );
      const last = visible.at(-1);
      const kind = last ? (Number(last.kind) as 0 | 1) : null;
      return Object.freeze({
        facts: Object.freeze(facts),
        unavailable: false,
        nextCursor:
          result.rows.length > input.limit && last && kind !== null
            ? encode({
                v: 3,
                c: string(last, "campaign_ref"),
                k: kind,
                a: kind === 0 ? "" : string(last, "aref"),
                q: cursorContext(input),
              })
            : null,
      });
    });
  }

  /** Second, bounded phase: bindings and metrics are queried only for the visible page.
   * Action and spend aggregates are independent laterals, preventing metric-row fanout. */
  private async bindPrimaryResults(
    tx: Transaction,
    input: Parameters<OperationReadRepository["load"]>[0],
    sliceId: string | null,
    facts: readonly OperationRowFact[],
  ): Promise<readonly OperationRowFact[]> {
    if (!facts.length) return facts;
    const wanted = facts.map((fact, position) => ({
      position,
      entity_level: fact.adSetId ? "ad_set" : "campaign",
      external_entity_id:
        fact.insightExternalEntityId ?? fact.adSetId ?? fact.campaignId,
      account_id: fact.accountId,
      organization_campaign_id: fact.organizationCampaignId,
    }));
    const catalog = await new DrizzlePrimaryResultActionCatalogAdapter({
      transaction: async (
        callback: (transaction: Transaction) => Promise<unknown>,
      ) => callback(tx),
    } as never).load(input.workspaceId);
    const orgIds = unique(
      facts.flatMap((fact) =>
        fact.organizationCampaignId ? [fact.organizationCampaignId] : [],
      ),
    );
    const envelopes = rows(
      await tx.execute(
        sql`select h.binding_id::text head_binding_id,h.subject_kind head_subject_kind,h.organization_campaign_id::text head_org_id,h.slice_id::text head_slice_id,h.market_definition_id::text head_market_id,h.version head_version,r.binding_id::text revision_binding_id,r.subject_kind revision_subject_kind,r.organization_campaign_id::text revision_org_id,r.slice_id::text revision_slice_id,r.market_definition_id::text revision_market_id,r.revision_number from primary_result_binding_heads h join primary_result_binding_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id where h.workspace_id=${input.workspaceId}::uuid and ((h.subject_kind='slice' and h.slice_id is not distinct from ${sliceId}::uuid) or (r.subject_kind='slice' and r.slice_id is not distinct from ${sliceId}::uuid) or (h.subject_kind='organization_campaign' and h.organization_campaign_id in ${uuidSet(orgIds)}) or (r.subject_kind='organization_campaign' and r.organization_campaign_id in ${uuidSet(orgIds)}))`,
      ),
    );
    for (const envelope of envelopes) {
      if (
        envelope.head_binding_id !== envelope.revision_binding_id ||
        envelope.head_subject_kind !== envelope.revision_subject_kind ||
        envelope.head_org_id !== envelope.revision_org_id ||
        envelope.head_slice_id !== envelope.revision_slice_id ||
        envelope.head_market_id !== envelope.revision_market_id ||
        Number(envelope.head_version) !== Number(envelope.revision_number)
      )
        throw new Error("operation read rejected: primary_result_binding");
    }
    const maxRevisionSubjects = orgIds.length + (sliceId ? 1 : 0);
    const revisionSubjects = rows(
      await tx.execute(
        sql`select distinct on(subject_kind,organization_campaign_id,slice_id,market_definition_id) subject_kind,organization_campaign_id::text org_id,slice_id::text slice_id,market_definition_id::text market_id,binding_id::text binding_id from primary_result_binding_revisions where workspace_id=${input.workspaceId}::uuid and ((subject_kind='slice' and slice_id is not distinct from ${sliceId}::uuid) or (subject_kind='organization_campaign' and organization_campaign_id in ${uuidSet(orgIds)})) order by subject_kind,organization_campaign_id,slice_id,market_definition_id,revision_number desc limit ${maxRevisionSubjects + 1}`,
      ),
    );
    if (revisionSubjects.length > maxRevisionSubjects)
      throw new Error("operation read rejected: primary_result_binding");
    for (const subject of revisionSubjects) {
      const matches = envelopes.filter(
        (envelope) =>
          envelope.revision_subject_kind === subject.subject_kind &&
          envelope.revision_org_id === subject.org_id &&
          envelope.revision_slice_id === subject.slice_id &&
          envelope.revision_market_id === subject.market_id &&
          envelope.revision_binding_id === subject.binding_id,
      );
      if (matches.length !== 1)
        throw new Error("operation read rejected: primary_result_binding");
    }
    const result = rows(
      await tx.execute(
        sql`with wanted as (select * from jsonb_to_recordset(${JSON.stringify(wanted)}::jsonb) as w(position int,entity_level text,external_entity_id text,account_id uuid,organization_campaign_id uuid)), resolved as (select w.*,slice_revision.binding_id slice_binding_id,slice_revision.state slice_state,slice_revision.selector slice_selector,slice_revision.action_catalog_hash slice_catalog_hash,slice_revision.previous_revision_hash slice_previous_hash,slice_revision.created_at slice_created_at,slice_revision.revision_hash slice_hash,org_revision.binding_id org_binding_id,org_revision.state org_state,org_revision.selector org_selector,org_revision.action_catalog_hash org_catalog_hash,org_revision.previous_revision_hash org_previous_hash,org_revision.created_at org_created_at,org_revision.revision_hash org_hash from wanted w left join lateral (select r.* from primary_result_binding_heads h join primary_result_binding_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id and h.version=r.revision_number where h.workspace_id=${input.workspaceId}::uuid and h.subject_kind='slice' and h.slice_id=${sliceId}::uuid limit 1) slice_revision on true left join lateral (select r.* from primary_result_binding_heads h join primary_result_binding_revisions r on r.workspace_id=h.workspace_id and r.id=h.latest_revision_id and h.version=r.revision_number where h.workspace_id=${input.workspaceId}::uuid and h.subject_kind='organization_campaign' and h.organization_campaign_id=w.organization_campaign_id limit 1) org_revision on true) select r.*,coalesce(case when r.slice_state='bound' then r.slice_selector end,case when r.org_state='bound' then r.org_selector end) selector,case when r.slice_state='bound' then 'slice_binding' when r.org_state='bound' then 'organization_campaign_fallback' else 'unbound' end binding_source,actions.result_decimal,spend.spend_decimal,case when actions.result_decimal::numeric > 0 then (spend.spend_decimal::numeric / actions.result_decimal::numeric)::text else null end result_cost_minor_decimal,spend.currency,coalesce(actions.attribution_count,0) action_attributions,coalesce(spend.attribution_count,0) spend_attributions,coalesce(spend.currency_count,0) currency_count,coalesce(actions.day_count,0) action_days,coalesce(spend.day_count,0) spend_days from resolved r left join lateral (select sum(m.value_decimal)::text result_decimal,count(distinct i.attribution_label) attribution_count,count(distinct i.date_start) day_count,count(m.id) metric_count from meta_daily_insights i join meta_daily_insight_metrics m on m.daily_insight_id=i.id and m.metric_key='actions' and m.action_type=substring(coalesce(case when r.slice_state='bound' then r.slice_selector end,case when r.org_state='bound' then r.org_selector end) from 9) and m.value_decimal is not null and coalesce(m.availability->>'state','available')='available' where coalesce(case when r.slice_state='bound' then r.slice_selector end,case when r.org_state='bound' then r.org_selector end) is not null and i.workspace_id=${input.workspaceId}::uuid and i.ad_account_id=r.account_id and i.entity_level=r.entity_level::meta_insight_entity_level and i.external_entity_id=r.external_entity_id and i.date_start>=${input.period.startDate}::date and i.date_stop<=${input.period.endDate}::date) actions on true left join lateral (select sum(m.value_minor)::text spend_decimal,min(m.currency) currency,count(distinct m.currency) currency_count,count(distinct i.attribution_label) attribution_count,count(distinct i.date_start) day_count,count(m.id) metric_count from meta_daily_insights i join meta_daily_insight_metrics m on m.daily_insight_id=i.id and m.metric_key='spend' and m.value_minor is not null and m.currency=i.currency and coalesce(m.availability->>'state','available')='available' where coalesce(case when r.slice_state='bound' then r.slice_selector end,case when r.org_state='bound' then r.org_selector end) is not null and i.workspace_id=${input.workspaceId}::uuid and i.ad_account_id=r.account_id and i.entity_level=r.entity_level::meta_insight_entity_level and i.external_entity_id=r.external_entity_id and i.date_start>=${input.period.startDate}::date and i.date_stop<=${input.period.endDate}::date) spend on true`,
      ),
    );
    // A primary binding read is optional evidence, never a reason to invent a
    // result. Empty is therefore a fail-closed unbound page; a partial result
    // is corrupt because it could silently shift identities.
    if (result.length === 0) return facts;
    if (result.length !== facts.length)
      throw new Error("operation read rejected: primary_result");
    const byPosition = new Map(
      result.map((row) => [Number(row.position), row]),
    );
    const primaryInputs = result.map((row) => ({
      position: row.position,
      selector: row.selector,
      entity_level: row.entity_level,
      external_entity_id: row.external_entity_id,
      account_id: row.account_id,
    }));
    const primaryCoverage = rows(
      await tx.execute(
        sql`select w.position,
          count(distinct ai.attribution_label) filter(where am.id is not null) action_labels,
          count(distinct ai.attribution_label) filter(where sm.id is not null) spend_labels,
          min(ai.attribution_label) filter(where am.id is not null) action_label,
          min(ai.attribution_label) filter(where sm.id is not null) spend_label
          from jsonb_to_recordset(${JSON.stringify(primaryInputs)}::jsonb) as w(position int,selector text,entity_level text,external_entity_id text,account_id uuid)
          left join meta_daily_insights ai on ai.workspace_id=${input.workspaceId}::uuid and ai.ad_account_id=w.account_id and ai.entity_level=w.entity_level::meta_insight_entity_level and ai.external_entity_id=w.external_entity_id and ai.date_start>=${input.period.startDate}::date and ai.date_stop<=${input.period.endDate}::date
          left join meta_daily_insight_metrics am on am.daily_insight_id=ai.id and am.metric_key='actions' and am.action_type=substring(w.selector from 9) and am.value_decimal is not null and coalesce(am.availability->>'state','available')='available'
          left join meta_daily_insight_metrics sm on sm.daily_insight_id=ai.id and sm.metric_key='spend' and sm.value_minor is not null and sm.currency=ai.currency and coalesce(sm.availability->>'state','available')='available'
          group by w.position`,
      ),
    );
    const primaryCoverageByPosition = new Map(
      primaryCoverage.map((row) => [Number(row.position), row]),
    );
    const revision = (
      row: Row,
      prefix: "slice" | "org",
      target: PrimaryResultBindingRevision["target"],
    ): PrimaryResultBindingRevision | null => {
      const state = row[`${prefix}_state`],
        bindingId = row[`${prefix}_binding_id`];
      if (state === null || bindingId === null) return null;
      const created = row[`${prefix}_created_at`];
      const candidate = {
        version: "primary-result-binding/1.0.0" as const,
        bindingId,
        workspaceId: input.workspaceId,
        target,
        state,
        selector: row[`${prefix}_selector`],
        actionCatalogHash: row[`${prefix}_catalog_hash`],
        previousRevisionHash: row[`${prefix}_previous_hash`],
        createdAt: new Date(String(created)).toISOString(),
        revisionHash: row[`${prefix}_hash`],
      };
      if (!isPrimaryResultBindingRevision(candidate))
        throw new Error("operation read rejected: primary_result_binding");
      return candidate;
    };
    const resolveBinding = (
      bindingInput: Parameters<typeof resolvePrimaryResultBinding>[0],
    ) => {
      try {
        return resolvePrimaryResultBinding(bindingInput);
      } catch (reason) {
        if (
          reason instanceof Error &&
          reason.message.startsWith("primary result rejected:")
        ) {
          const rejected = new Error(
            "operation read rejected: primary_result_binding",
          );
          (rejected as Error & { cause?: unknown }).cause = reason;
          throw rejected;
        }
        throw reason;
      }
    };
    return facts.map((fact, position) => {
      const row = byPosition.get(position),
        coverage = primaryCoverageByPosition.get(position);
      if (!row) throw new Error("operation read rejected: primary_result");
      const org = fact.organizationCampaignId
        ? revision(row, "org", {
            kind: "organization_campaign",
            organizationCampaignId: fact.organizationCampaignId,
          })
        : null;
      const slice = sliceId
        ? revision(row, "slice", { kind: "slice", sliceId })
        : null;
      const resolution = resolveBinding({
        expectedWorkspaceId: input.workspaceId,
        organizationCampaignBinding: org,
        sliceBinding: slice,
        currentSlice: sliceId
          ? { kind: "scoped", sliceId }
          : { kind: "none", sliceId: null },
        assignedOrganizationCampaignId: fact.organizationCampaignId,
        actionCatalog: catalog?.catalog ?? null,
        canonicalCatalogEvidence: catalog?.canonicalEvidence ?? null,
      });
      const source =
        resolution.reason === "slice_binding"
          ? "slice_binding"
          : resolution.reason === "organization_campaign_fallback"
            ? "organization_campaign_fallback"
            : "unbound";
      if (resolution.state !== "bound" || !resolution.binding?.selector)
        return { ...fact, primaryResultSource: "unbound" };
      const resultDecimal = canonicalDecimal(row.result_decimal),
        costDecimal = canonicalDecimal(row.result_cost_minor_decimal),
        coherent =
          Number(row.action_attributions) === 1 &&
          Number(row.spend_attributions) === 1 &&
          Number(row.currency_count) === 1 &&
          Number(row.action_days) === fact.observedDays.length &&
          Number(row.spend_days) === fact.observedDays.length &&
          Number(coverage?.action_labels) === 1 &&
          Number(coverage?.spend_labels) === 1 &&
          coverage?.action_label === coverage?.spend_label &&
          resultDecimal !== null &&
          canonicalDecimal(row.spend_decimal) !== null &&
          typeof row.currency === "string" &&
          fact.missingDays.length === 0 &&
          (resultDecimal === "0" ? costDecimal === null : costDecimal !== null);
      return {
        ...fact,
        primaryResultBinding: {
          state: "bound",
          actionType: resolution.binding.selector.slice(8),
          bindingRef: `primary_result_${source}`,
        },
        primaryResult: coherent ? resultDecimal : null,
        primaryResultCostMinor: coherent ? costDecimal : null,
        primaryResultSource: coherent ? source : "unavailable",
        reasonCodes: [
          ...fact.reasonCodes,
          ...(coherent ? [] : ["primary_result_unavailable"]),
        ],
      };
    });
  }

  private async resolveCurrentScope(
    tx: Transaction,
    workspaceId: string,
    sliceRef: string | null,
  ): Promise<ResolvedScope> {
    const isSlice = sliceRef !== null;
    const head = rows(
      await tx.execute(
        isSlice
          ? sql`select s.id::text slice_id,r.id::text revision_id,r.slice_ref,r.revision_ref,r.revision_number,r.definition_hash,market.dimension_id::text market_dimension_id,market_dimension.key market_dimension_key,market.id::text market_value_id,market.key market_key from slices s join slice_revisions r on r.workspace_id=s.workspace_id and r.id=s.current_published_revision_id and r.lifecycle='published' join category_definitions market on market.workspace_id=r.workspace_id and market.id=r.market_definition_id join category_dimensions market_dimension on market_dimension.workspace_id=market.workspace_id and market_dimension.id=market.dimension_id and market_dimension.archived_at is null where s.workspace_id=${workspaceId}::uuid and s.slice_ref=${sliceRef} and s.tombstoned_at is null and market.archived_at is null limit 1`
          : sql`select null::text slice_id,'00000000-0000-4000-8000-000000000000' revision_id,'slice_global' slice_ref,'slice_revision_global' revision_ref,1 revision_number,repeat('0',64) definition_hash,market.dimension_id::text market_dimension_id,market_dimension.key market_dimension_key,market.id::text market_value_id,market.key market_key from category_definitions market join category_dimensions market_dimension on market_dimension.workspace_id=market.workspace_id and market_dimension.id=market.dimension_id and market_dimension.archived_at is null where market.workspace_id=${workspaceId}::uuid and market.archived_at is null and market_dimension.key='market' and market.key='yerli' limit 1`,
      ),
    );
    if (!isSlice && head.length === 0)
      return Object.freeze({
        sliceId: null,
        resolution: null,
        sliceRef: null,
        revisionRef: null,
        revisionNumber: null,
        definitionHash: null,
        market: null,
        organizationCampaignIds: [],
        campaignIds: [],
        adSetIds: [],
        campaignMarkets: new Map(),
        adSetMarkets: new Map(),
      });
    if (
      head.length !== 1 ||
      (head[0]!.market_key !== "yerli" && head[0]!.market_key !== "yabanci")
    )
      throw new Error("operation read rejected: slice");
    const revisionId = string(head[0]!, "revision_id");
    const predicateRows = isSlice
      ? rows(
          await tx.execute(
            sql`select p.dimension_id::text dimension_id,d.key dimension_key,v.id::text value_id,v.key value_key from slice_revision_predicates p join category_dimensions d on d.workspace_id=p.workspace_id and d.id=p.dimension_id and d.archived_at is null join slice_revision_predicate_values pv on pv.workspace_id=p.workspace_id and pv.predicate_id=p.id join category_definitions v on v.workspace_id=p.workspace_id and v.id=pv.definition_id and v.archived_at is null where p.workspace_id=${workspaceId}::uuid and p.slice_revision_id=${revisionId}::uuid order by p.position,pv.position`,
          ),
        )
      : [];
    const grouped = new Map<
      string,
      {
        dimensionId: string;
        key: string;
        values: { valueId: string; key: string }[];
      }
    >();
    for (const row of predicateRows) {
      const dimensionKey = string(row, "dimension_key"),
        dimensionId = categoryDimensionPublicRef(dimensionKey),
        current = grouped.get(dimensionId) ?? {
          dimensionId,
          key: dimensionKey,
          values: [],
        };
      current.values.push({
        valueId: categoryDefinitionPublicRef(
          dimensionKey,
          string(row, "value_key"),
        ),
        key: string(row, "value_key"),
      });
      grouped.set(dimensionId, current);
    }
    const overrideRows = isSlice
      ? rows(
          await tx.execute(
            sql`select operation,entity_level,organization_campaign_id::text,campaign_id::text,ad_set_id::text from slice_revision_overrides where workspace_id=${workspaceId}::uuid and slice_revision_id=${revisionId}::uuid`,
          ),
        )
      : [];
    const include: string[] = [],
      exclude: string[] = [],
      orgById = new Map<string, string>(),
      campaignById = new Map<string, string>(),
      adsetById = new Map<string, string>();
    for (const row of overrideRows) {
      const level = string(row, "entity_level"),
        id =
          level === "organization_campaign"
            ? row.organization_campaign_id
            : level === "campaign"
              ? row.campaign_id
              : row.ad_set_id;
      if (typeof id !== "string" || !UUID.test(id))
        throw new Error("operation read rejected: slice");
      const ref =
        level === "organization_campaign"
          ? organizationCampaignPublicRef(workspaceId, id)
          : level === "campaign"
            ? metaPublicReference("campaign", workspaceId, id)
            : level === "ad_set"
              ? metaPublicReference("ad_set", workspaceId, id)
              : (() => {
                  throw new Error("operation read rejected: slice");
                })();
      (row.operation === "include"
        ? include
        : row.operation === "exclude"
          ? exclude
          : (() => {
              throw new Error("operation read rejected: slice");
            })()
      ).push(ref);
      (level === "organization_campaign"
        ? orgById
        : level === "campaign"
          ? campaignById
          : adsetById
      ).set(id, ref);
    }
    const marketDimensionKey = string(head[0]!, "market_dimension_key"),
      marketKey = string(head[0]!, "market_key");
    const revision: SliceRevision = {
      version: "slice-definition/1.0.0",
      sliceRef: string(head[0]!, "slice_ref"),
      revisionRef: string(head[0]!, "revision_ref"),
      revisionNumber: Number(head[0]!.revision_number),
      market: {
        dimensionId: categoryDimensionPublicRef(marketDimensionKey),
        valueId: categoryDefinitionPublicRef(marketDimensionKey, marketKey),
        key: marketKey as "yerli" | "yabanci",
      },
      predicates: [...grouped.values()] as SliceDimensionPredicate[],
      explicitIncludeEntityRefs: unique(include),
      explicitExcludeEntityRefs: unique(exclude),
      definitionHash: string(head[0]!, "definition_hash"),
    };
    const candidateRows = rows(
      await tx.execute(
        sql`select 'organization_campaign' entity_level,o.id::text entity_id,null::text campaign_id,o.market_definition_id::text market_value_id,market.dimension_id::text market_dimension_id,market.key market_key from organization_campaigns o join category_definitions market on market.workspace_id=o.workspace_id and market.id=o.market_definition_id and market.archived_at is null where o.workspace_id=${workspaceId}::uuid and o.tombstoned_at is null union all select 'campaign',c.id::text,c.id::text,null,null,null from ad_campaigns c where c.workspace_id=${workspaceId}::uuid and c.disappeared_at is null union all select 'ad_set',a.id::text,a.campaign_id::text,null,null,null from meta_ad_sets a where a.workspace_id=${workspaceId}::uuid and a.disappeared_at is null limit ${MAX_SLICE_CANDIDATES + 1}`,
      ),
    );
    if (candidateRows.length > MAX_SLICE_CANDIDATES)
      throw new Error("operation read rejected: slice_cap");
    const candidateCampaignIds = candidateRows
      .filter((row) => row.entity_level === "campaign")
      .map((row) => string(row, "entity_id"));
    const candidateAdSetIds = candidateRows
      .filter((row) => row.entity_level === "ad_set")
      .map((row) => string(row, "entity_id"));
    // Scope assignment evidence to bounded candidates. Deny rows are retained
    // so an explicitly withdrawn own-level value cannot leak back into a slice.
    const assignments = rows(
      await tx.execute(
        sql`select a.entity_level,a.operation,a.source,a.manual_lock,a.confidence,a.version,a.evidence,a.campaign_id::text,a.ad_set_id::text,a.dimension_id::text,a.definition_id::text,a.id::text assignment_id from category_assignments a where a.workspace_id=${workspaceId}::uuid and a.archived_at is null and ((a.entity_level='campaign' and a.campaign_id in ${uuidSet(candidateCampaignIds)}) or (a.entity_level='ad_set' and a.ad_set_id in ${uuidSet(candidateAdSetIds)}))`,
      ),
    );
    const dimensionIds = unique(
      assignments.map((row) => string(row, "dimension_id")),
    );
    const dimensionRows = rows(
      await tx.execute(
        sql`select id::text,key,version,cardinality,allowed_entity_levels from category_dimensions where workspace_id=${workspaceId}::uuid and archived_at is null and id in ${uuidSet(dimensionIds)}`,
      ),
    );
    const definitionRows = rows(
      await tx.execute(
        sql`select id::text,dimension_id::text,key,label,version from category_definitions where workspace_id=${workspaceId}::uuid and archived_at is null and dimension_id in ${uuidSet(dimensionIds)}`,
      ),
    );
    const dimensionById = new Map<string, CategoryDimension>();
    for (const row of dimensionRows) {
      const levels = textArray(row.allowed_entity_levels);
      if (
        !levels.every(
          (level) =>
            level === "campaign" ||
            level === "ad_set" ||
            level === "ad" ||
            level === "creative",
        ) ||
        (row.cardinality !== "single" && row.cardinality !== "multi")
      )
        throw new Error("operation read rejected: assignment");
      dimensionById.set(string(row, "id"), {
        id: string(row, "id"),
        workspaceId,
        key: string(row, "key"),
        version: Number(row.version),
        cardinality: row.cardinality,
        allowedEntityLevels: levels as CategoryDimension["allowedEntityLevels"],
        archivedAt: null,
      });
    }
    const definitionsByDimension = new Map<string, CategoryDefinition[]>();
    for (const row of definitionRows) {
      const dimensionId = string(row, "dimension_id"),
        values = definitionsByDimension.get(dimensionId) ?? [];
      values.push({
        id: string(row, "id"),
        workspaceId,
        dimensionId,
        key: string(row, "key"),
        label: string(row, "label"),
        version: Number(row.version),
        archivedAt: null,
      });
      definitionsByDimension.set(dimensionId, values);
    }
    const assignmentsByEntityDimension = new Map<
      string,
      CategoryAssignment[]
    >();
    for (const row of assignments) {
      const level = string(row, "entity_level");
      const id =
        level === "campaign"
          ? row.campaign_id
          : level === "ad_set"
            ? row.ad_set_id
            : null;
      if (
        typeof id !== "string" ||
        (level !== "campaign" && level !== "ad_set") ||
        !dimensionById.has(string(row, "dimension_id")) ||
        !["add", "override", "deny"].includes(String(row.operation)) ||
        !["manual", "agent", "deterministic"].includes(String(row.source)) ||
        !Array.isArray(row.evidence)
      )
        throw new Error("operation read rejected: assignment");
      const assignment: CategoryAssignment = {
        id: string(row, "assignment_id"),
        workspaceId,
        dimensionId: string(row, "dimension_id"),
        definitionId: string(row, "definition_id"),
        entity: { level, id },
        operation: row.operation as CategoryAssignment["operation"],
        source: row.source as CategoryAssignment["source"],
        manualLock: row.manual_lock === true,
        evidence: row.evidence as CategoryAssignment["evidence"],
        confidence: Number(row.confidence),
        version: Number(row.version),
        archivedAt: null,
      };
      const key = `${level}\u0000${id}\u0000${assignment.dimensionId}`,
        values = assignmentsByEntityDimension.get(key) ?? [];
      values.push(assignment);
      assignmentsByEntityDimension.set(key, values);
    }
    const dimensions = new Map<
      string,
      {
        dimensionId: string;
        valueIds: string[];
        valueKeys: string[];
        evidenceRefs: string[];
      }[]
    >();
    /** Parked single-cardinality market conflicts cannot become a normal
     * dimension value, but their public assignment evidence is still part of
     * the canonical resolver explanation. */
    const parkedMarketConflicts = new Map<string, readonly string[]>();
    const adSetCampaign = new Map(
      candidateRows
        .filter((row) => row.entity_level === "ad_set")
        .map((row) => [string(row, "entity_id"), string(row, "campaign_id")]),
    );
    const evaluationKeys = new Set(assignmentsByEntityDimension.keys());
    for (const [adSetId, campaignId] of adSetCampaign)
      for (const dimensionId of dimensionById.keys())
        if (
          assignmentsByEntityDimension.has(
            `campaign\u0000${campaignId}\u0000${dimensionId}`,
          )
        )
          evaluationKeys.add(`ad_set\u0000${adSetId}\u0000${dimensionId}`);
    for (const entityDimension of evaluationKeys) {
      const [level, id, dimensionId] = entityDimension.split("\u0000"),
        directAssignments =
          assignmentsByEntityDimension.get(entityDimension) ?? [];
      const dimension = dimensionById.get(dimensionId!);
      if (!dimension || (level !== "campaign" && level !== "ad_set")) continue;
      const campaignId = level === "ad_set" ? adSetCampaign.get(id!) : id!,
        currentAssignments =
          level === "ad_set"
            ? [
                ...(assignmentsByEntityDimension.get(
                  `campaign\u0000${campaignId}\u0000${dimensionId}`,
                ) ?? []),
                ...directAssignments,
              ]
            : directAssignments,
        path =
          level === "ad_set"
            ? [
                { level: "campaign" as const, id: campaignId! },
                { level: "ad_set" as const, id: id! },
              ]
            : [{ level: "campaign" as const, id: id! }];
      const inspected = inspectEffectiveCategory({
        dimension,
        definitions: definitionsByDimension.get(dimensionId!) ?? [],
        assignments: currentAssignments,
        path: { workspaceId, nodes: path },
      });
      if (inspected.state === "parked_conflict") {
        if (dimension.key === marketDimensionKey)
          parkedMarketConflicts.set(
            `${level}\u0000${id}`,
            unique(
              currentAssignments.map((assignment) =>
                categoryAssignmentPublicRef(workspaceId, assignment.id),
              ),
            ),
          );
        continue;
      }
      if (inspected.state !== "applied") continue;
      const values = inspected.resolution.values;
      if (!values.length) continue;
      const evidenceRefs = [
        ...unique(
          currentAssignments.map((assignment) =>
            categoryAssignmentPublicRef(workspaceId, assignment.id),
          ),
        ),
      ];
      const entityKey = `${level}\u0000${id}`,
        list = dimensions.get(entityKey) ?? [];
      list.push({
        dimensionId: categoryDimensionPublicRef(dimension.key),
        valueIds: values.map((value) =>
          categoryDefinitionPublicRef(dimension.key, value.key),
        ),
        valueKeys: values.map((value) => value.key),
        evidenceRefs,
      });
      dimensions.set(entityKey, list);
    }
    const candidates: SliceEntityCandidate[] = candidateRows.map((row) => {
      const level = string(
          row,
          "entity_level",
        ) as SliceEntityCandidate["entityLevel"],
        id = string(row, "entity_id"),
        ref =
          level === "organization_campaign"
            ? organizationCampaignPublicRef(workspaceId, id)
            : level === "campaign"
              ? metaPublicReference("campaign", workspaceId, id)
              : metaPublicReference("ad_set", workspaceId, id);
      (level === "organization_campaign"
        ? orgById
        : level === "campaign"
          ? campaignById
          : adsetById
      ).set(id, ref);
      const ownDimensions = (
          dimensions.get(`${level}\u0000${id}`) ?? []
        ).filter((item) => item.valueIds.length > 0),
        marketAssignments = ownDimensions.filter(
          (item) => item.dimensionId === revision.market.dimensionId,
        );
      const market =
        level === "organization_campaign"
          ? {
              state: "resolved" as const,
              dimensionId: revision.market.dimensionId,
              valueId: categoryDefinitionPublicRef(
                marketDimensionKey,
                string(row, "market_key"),
              ),
              key: row.market_key as "yerli" | "yabanci",
              evidenceRefs: [organizationCampaignPublicRef(workspaceId, id)],
            }
          : parkedMarketConflicts.has(`${level}\u0000${id}`)
            ? { state: "conflicting" as const, evidenceRefs: parkedMarketConflicts.get(`${level}\u0000${id}`)! }
          : marketAssignments.length === 0
            ? { state: "missing" as const, evidenceRefs: [] }
            : marketAssignments.length !== 1 ||
                marketAssignments[0]!.valueIds.length !== 1
              ? {
                  state: "ambiguous" as const,
                  evidenceRefs: unique(
                    marketAssignments.flatMap((item) => item.evidenceRefs),
                  ),
                }
              : {
                  state: "resolved" as const,
                  dimensionId: revision.market.dimensionId,
                  valueId: marketAssignments[0]!.valueIds[0]!,
                  key:
                    marketAssignments[0]!.valueKeys[0] === "yerli"
                      ? ("yerli" as const)
                      : marketAssignments[0]!.valueKeys[0] === "yabanci"
                        ? ("yabanci" as const)
                        : (() => {
                            throw new Error("operation read rejected: market");
                          })(),
                  evidenceRefs: unique(marketAssignments[0]!.evidenceRefs),
                };
      return {
        entityRef: ref,
        entityLevel: level,
        market,
        dimensions: ownDimensions
          .filter((item) => item.dimensionId !== revision.market.dimensionId)
          .map((item) => ({
            dimensionId: item.dimensionId,
            valueIds: unique(item.valueIds),
            valueKeys: unique(item.valueKeys),
            evidenceRefs: unique(item.evidenceRefs),
          })),
      };
    });
    const candidateByRef = new Map(
      candidates.map((candidate) => [candidate.entityRef, candidate]),
    );
    const resolution = isSlice
      ? resolveCurrentOperationSliceResolution({
          revision,
          candidates,
          resolvedAt: new Date().toISOString(),
        })
      : null;
    const included = new Set(resolution?.included.map((member) => member.entityRef));
    const campaignMarkets = new Map<string, "yerli" | "yabanci">(),
      adSetMarkets = new Map<string, "yerli" | "yabanci">();
    for (const [id, ref] of campaignById) {
      const market = candidateByRef.get(ref)?.market;
      if (
        market?.state === "resolved" &&
        (market.key === "yerli" || market.key === "yabanci")
      )
        campaignMarkets.set(id, market.key);
    }
    for (const [id, ref] of adsetById) {
      const market = candidateByRef.get(ref)?.market;
      if (
        market?.state === "resolved" &&
        (market.key === "yerli" || market.key === "yabanci")
      )
        adSetMarkets.set(id, market.key);
    }
    return Object.freeze({
      sliceId: isSlice ? string(head[0]!, "slice_id") : null,
      resolution,
      sliceRef: isSlice ? revision.sliceRef : null,
      revisionRef: isSlice ? revision.revisionRef : null,
      revisionNumber: isSlice ? revision.revisionNumber : null,
      definitionHash: isSlice ? revision.definitionHash : null,
      market: isSlice
        ? Object.freeze({
            dimensionRef: revision.market.dimensionId,
            valueRef: revision.market.valueId,
            key: revision.market.key,
          })
        : null,
      organizationCampaignIds: unique(
        [...orgById].filter(([, ref]) => included.has(ref)).map(([id]) => id),
      ),
      campaignIds: unique(
        [...campaignById]
          .filter(([, ref]) => included.has(ref))
          .map(([id]) => id),
      ),
      adSetIds: unique(
        [...adsetById].filter(([, ref]) => included.has(ref)).map(([id]) => id),
      ),
      campaignMarkets,
      adSetMarkets,
    });
  }
}
