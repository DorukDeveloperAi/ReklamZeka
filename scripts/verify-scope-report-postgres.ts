import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import { ScopeReportReadService } from "@/application/scope-report-read-service";
import { buildScopeReport } from "@/domain/slices/scope-report";
import { createSliceRevision } from "@/domain/slices/slice-definition";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("postgres_connection_not_configured");

const client = new pg.Client({ connectionString });
const rollback = new Error("scope_report_outer_rollback");
const q = (text: string, values: readonly unknown[] = []) => client.query(text, [...values]);
const expectedDays = ["2026-08-01", "2026-08-02"] as const;
const publicOnly = (value: unknown) => !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(JSON.stringify(value));

await client.connect();
try {
  await q("begin");
  const ws = randomUUID(), user = randomUUID(), connection = randomUUID(), source = randomUUID(), account = randomUUID();
  const campaign = randomUUID(), conflictingCampaign = randomUUID(), missingCampaign = randomUUID(), adSet = randomUUID();
  const marketDimension = randomUUID(), segmentDimension = randomUUID(), yerli = randomUUID(), yabanci = randomUUID(), segment = randomUUID();
  const slice = randomUUID(), revisionId = randomUUID(), predicate = randomUUID();
  const campaignExternal = `scope_campaign_${campaign.slice(0, 12)}`, adSetExternal = `scope_adset_${adSet.slice(0, 12)}`;
  const revision = createSliceRevision({
    sliceRef: "slice_scope_report_live",
    revisionRef: "slice_revision_scope_report_live_1",
    revisionNumber: 1,
    market: { dimensionId: categoryDimensionPublicRef("market"), valueId: categoryDefinitionPublicRef("market", "yerli"), key: "yerli" },
    predicates: [{ dimensionId: categoryDimensionPublicRef("segment"), key: "segment", values: [{ valueId: categoryDefinitionPublicRef("segment", "a"), key: "a" }] }],
  });
  await q("insert into users(id,email) values($1,$2)", [user, `${user}@invalid.local`]);
  await q("insert into workspaces(id,name) values($1,'scope report verifier')", [ws]);
  await q("insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')", [ws, user]);
  await q("insert into meta_connections(id,workspace_id,external_connection_key,display_name,graph_api_version,field_catalog_version) values($1,$2,$3,'fixture','v23.0','fixture')", [connection, ws, `fixture_${connection}`]);
  await q("insert into data_sources(id,workspace_id,meta_connection_id,platform,external_account_id,display_name) values($1,$2,$3,'meta_ads',$4,'fixture')", [source, ws, connection, `act_${account}`]);
  await q("insert into ad_accounts(id,workspace_id,data_source_id,external_account_id,name,currency,timezone) values($1,$2,$3,$4,'fixture','TRY','Europe/Istanbul')", [account, ws, source, `act_${account}`]);
  await q("insert into ad_campaigns(id,workspace_id,ad_account_id,external_campaign_id,name) values($1,$2,$3,$4,'included'),($5,$2,$3,$6,'conflicting market'),($7,$2,$3,$8,'missing market')", [campaign, ws, account, campaignExternal, conflictingCampaign, `scope_conflict_${conflictingCampaign.slice(0, 12)}`, missingCampaign, `scope_missing_${missingCampaign.slice(0, 12)}`]);
  await q("insert into meta_ad_sets(id,workspace_id,ad_account_id,campaign_id,external_ad_set_id,name,raw_payload_hash,source_graph_version,field_catalog_version,provenance) values($1,$2,$3,$4,$5,'included ad set','a','v','v','{}')", [adSet, ws, account, campaign, adSetExternal]);
  await q("insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values($1,$2,'market','Market','single',array['campaign','ad_set']::category_entity_level[]),($3,$2,'segment','Segment','single',array['campaign','ad_set']::category_entity_level[])", [marketDimension, ws, segmentDimension]);
  await q("insert into category_definitions(id,workspace_id,dimension_id,key,label) values($1,$2,$3,'yerli','Yerli'),($4,$2,$3,'yabanci','Yabancı'),($5,$2,$6,'a','A')", [yerli, ws, marketDimension, yabanci, segment, segmentDimension]);
  const evidence = JSON.stringify([{ kind: "fixture", ref: "scope-report" }]);
  await q("insert into category_assignments(workspace_id,dimension_id,definition_id,entity_level,campaign_id,operation,source,evidence,confidence) values($1,$2,$3,'campaign',$4,'add','manual',$5::jsonb,1),($1,$6,$7,'campaign',$4,'add','manual',$5::jsonb,1),($1,$2,$3,'campaign',$8,'add','manual',$5::jsonb,1),($1,$2,$9,'campaign',$8,'add','manual',$5::jsonb,1),($1,$6,$7,'campaign',$8,'add','manual',$5::jsonb,1)", [ws, marketDimension, yerli, campaign, evidence, segmentDimension, segment, conflictingCampaign, yabanci]);
  await q("insert into category_assignments(workspace_id,dimension_id,definition_id,entity_level,ad_set_id,operation,source,evidence,confidence) values($1,$2,$3,'ad_set',$4,'add','manual',$5::jsonb,1),($1,$6,$7,'ad_set',$4,'add','manual',$5::jsonb,1)", [ws, marketDimension, yerli, adSet, evidence, segmentDimension, segment]);
  await q("insert into slices(id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values($1,$2,$3,'Scope report',$4,$5)", [slice, ws, revision.sliceRef, yerli, user]);
  await q("insert into slice_revisions(id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values($1,$2,$3,$4,1,$5,$6,$7,'published',$8)", [revisionId, ws, slice, revision.sliceRef, revision.revisionRef, revision.definitionHash, yerli, user]);
  await q("update slices set current_published_revision_id=$1 where id=$2", [revisionId, slice]);
  await q("insert into slice_revision_predicates(id,workspace_id,slice_revision_id,dimension_id,position) values($1,$2,$3,$4,1)", [predicate, ws, revisionId, segmentDimension]);
  await q("insert into slice_revision_predicate_values(workspace_id,predicate_id,definition_id,position) values($1,$2,$3,1)", [ws, predicate, segment]);

  const insight = async (level: "campaign" | "ad_set", externalId: string, date: string, attribution: string, metrics: readonly Readonly<{ key: string; action?: string; decimal?: string; minor?: string; currency?: string; availability?: "available" | "unavailable" }>[]) => {
    const insightId = randomUUID();
    await q("insert into meta_daily_insights(id,workspace_id,meta_connection_id,ad_account_id,entity_level,external_entity_id,date_start,date_stop,attribution_label,currency,timezone,source_revision,source_payload_hash,first_seen_at,last_seen_at) values($1,$2,$3,$4,$5,$6,$7,$7,$8,'TRY','Europe/Istanbul','fixture',repeat('a',64),now(),now())", [insightId, ws, connection, account, level, externalId, date, attribution]);
    for (const metric of metrics) await q("insert into meta_daily_insight_metrics(daily_insight_id,metric_key,action_type,aggregation,value_decimal,value_minor,currency,provenance,availability,source_revision,source_payload_hash,first_seen_at,last_seen_at) values($1,$2,$3,'additive',$4::numeric,$5::bigint,$6,'{}',$7::jsonb,'fixture',repeat('b',64),now(),now())", [insightId, metric.key, metric.action ?? "", metric.decimal ?? null, metric.minor ?? null, metric.currency ?? "TRY", JSON.stringify({ state: metric.availability ?? "available" })]);
  };
  await insight("campaign", campaignExternal, "2026-08-01", "7d_click", [{ key: "spend", minor: "9223372036854775807" }, { key: "actions", action: "lead", decimal: "0.0000000001" }, { key: "actions", action: "purchase", decimal: "4" }]);
  await insight("campaign", campaignExternal, "2026-08-02", "7d_click", [{ key: "spend", minor: "3" }, { key: "actions", action: "lead", decimal: "0", availability: "unavailable" }]);
  await insight("ad_set", adSetExternal, "2026-08-01", "7d_click", [{ key: "spend", minor: "40" }, { key: "actions", action: "lead", decimal: "2" }]);

  const base = drizzle(client);
  const observed = { repeatableRead: 0, readOnly: 0 };
  const tx = new Proxy(base, { get(target, key) { if (key !== "execute") return Reflect.get(target, key); return async (statement: { queryChunks?: readonly { value?: readonly string[] }[] }) => { const text = statement.queryChunks?.flatMap((part) => part.value ?? []).join("").toLowerCase() ?? ""; if (text.includes("transaction isolation level repeatable read")) { observed.repeatableRead++; return { rows: [] }; } if (text.includes("transaction read only")) { observed.readOnly++; return { rows: [] }; } return target.execute(statement as never); }; } });
  const database = { transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => { await q("savepoint scope_report_read"); try { const result = await work(tx); await q("release savepoint scope_report_read"); return result; } catch (error) { await q("rollback to savepoint scope_report_read"); await q("release savepoint scope_report_read"); throw error; } } };
  const repository = new DrizzleOperationReadRepository(database as never);
  const service = new ScopeReportReadService(repository);
  const baseInput = { slice: revision.sliceRef, start: "2026-08-01", end: "2026-08-02" };
  const loaded = await repository.currentScopeReport(ws, revision.sliceRef, { startDate: baseInput.start, endDate: baseInput.end }, null);
  const project = (options: Parameters<typeof buildScopeReport>[2]) => buildScopeReport(loaded.evidence, loaded.metrics, options);
  const day = project({ granularity: "day", startDate: baseInput.start, endDate: baseInput.end, actionType: "lead" });
  const week = project({ granularity: "week", startDate: baseInput.start, endDate: baseInput.end, actionType: "lead" });
  const month = project({ granularity: "month", startDate: baseInput.start, endDate: baseInput.end, actionType: "lead" });
  const purchase = project({ granularity: "day", startDate: baseInput.start, endDate: baseInput.end, actionType: "purchase" });
  const filtered = project({ granularity: "day", startDate: baseInput.start, endDate: baseInput.end, entityLevel: "campaign", metricKey: "actions", actionType: "lead", sort: "metric", direction: "desc" });
  const deterministicA = project({ granularity: "day", startDate: baseInput.start, endDate: baseInput.end, actionType: "lead", sort: "entity", direction: "desc" });
  const deterministicB = project({ granularity: "day", startDate: baseInput.start, endDate: baseInput.end, actionType: "lead", sort: "entity", direction: "desc" });

  const campaignRef = day.rows.find((row) => row.entityLevel === "campaign" && row.membership === "included")?.entityRef;
  const campaignPivot = day.pivot.find((row) => row.entityRef === campaignRef && row.bucket === "2026-08-01");
  const leadCoverage = day.coverage.find((coverage) => coverage.entityRef === campaignRef && coverage.actionType === "lead");
  const purchaseCoverage = purchase.coverage.find((coverage) => coverage.entityRef === campaignRef && coverage.actionType === "purchase");
  const flags = {
    dayWeekMonthBuckets: day.pivot.some((row) => row.bucket === "2026-08-01") && week.pivot.some((row) => row.bucket === "2026-07-27") && month.pivot.some((row) => row.bucket === "2026-08-01"),
    leadAndPurchaseSelector: day.rawMetrics.every((metric) => metric.metricKey !== "actions" || metric.actionType === "lead") && purchase.rawMetrics.every((metric) => metric.metricKey !== "actions" || metric.actionType === "purchase"),
    zeroRowUnavailableCoverage: purchaseCoverage?.sourceState === "partial" && purchaseCoverage.missingDays.includes("2026-08-02"),
    missingDayAvailability: leadCoverage?.sourceState === "unavailable" && leadCoverage.missingDays.includes("2026-08-02") && leadCoverage.reasonCodes.includes("action_unavailable"),
    exactLargeDecimalRational: campaignPivot?.ratios.spendPerAction?.numeratorMinor === "9223372036854775807" && campaignPivot.ratios.spendPerAction.denominatorAction === "0.0000000001",
    excludedMarketConflicting: day.rows.some((row) => row.reason === "excluded_market_conflicting"),
    levelMetricActionFilters: filtered.rawMetrics.length > 0 && filtered.rawMetrics.every((metric) => metric.entityLevel === "campaign" && metric.metricKey === "actions" && metric.actionType === "lead"),
    requestedSortDirection: filtered.appliedFilters.sort === "metric" && filtered.appliedFilters.direction === "desc" && deterministicA.appliedFilters.sort === "entity" && deterministicA.appliedFilters.direction === "desc",
    subtotalRatioDrill: campaignPivot?.subtotal.metricCount === 3 && campaignPivot.drill.entityRef === campaignRef && campaignPivot.ratios.spendPerAction !== null,
    deterministicOrder: JSON.stringify(deterministicA.rawMetrics) === JSON.stringify(deterministicB.rawMetrics) && deterministicA.rawMetrics.every((row, index, values) => index === 0 || values[index - 1]!.entityRef >= row.entityRef),
    publicRefsNoUuid: publicOnly(day) && day.rows.every((row) => /^(campaign|ad_set|organization_campaign)_[a-f0-9]{24}$/.test(row.entityRef)),
    rrReadOnly: observed.repeatableRead >= 8 && observed.readOnly >= 8,
    writeOperations: 0 as const,
  };
  await q("savepoint scope_report_mixed");
  await insight("campaign", campaignExternal, "2026-08-01", "1d_view", [{ key: "actions", action: "lead", decimal: "1" }]);
  const attributionLoaded = await repository.currentScopeReport(ws, revision.sliceRef, { startDate: baseInput.start, endDate: baseInput.end }, null);
  const attributionMixed = buildScopeReport(attributionLoaded.evidence, attributionLoaded.metrics, { granularity: "day", startDate: baseInput.start, endDate: baseInput.end, actionType: "lead" });
  await q("rollback to savepoint scope_report_mixed"); await q("release savepoint scope_report_mixed");
  await q("savepoint scope_report_currency");
  await insight("campaign", campaignExternal, "2026-08-01", "7d_click", [{ key: "spend_extra", minor: "1", currency: "USD" }]);
  const currencyLoaded = await repository.currentScopeReport(ws, revision.sliceRef, { startDate: baseInput.start, endDate: baseInput.end }, null);
  const currencyMixed = buildScopeReport(currencyLoaded.evidence, currencyLoaded.metrics, { granularity: "day", startDate: baseInput.start, endDate: baseInput.end, actionType: "lead" });
  await q("rollback to savepoint scope_report_currency"); await q("release savepoint scope_report_currency");
  const capDatabase = {
    transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => {
      const capTx = new Proxy(tx, {
        get(target, key) {
          if (key !== "execute") return Reflect.get(target, key);
          return async (statement: { queryChunks?: readonly { value?: readonly string[] }[] }) => {
            const text = statement.queryChunks?.flatMap((part) => part.value ?? []).join(" ").toLowerCase() ?? "";
            if (text.includes("from jsonb_to_recordset")) return { rows: Array.from({ length: 50_001 }, () => ({})) };
            return target.execute(statement as never);
          };
        },
      });
      return work(capTx);
    },
  };
  let capRejected = false;
  try { await new DrizzleOperationReadRepository(capDatabase as never).currentScopeReport(ws, revision.sliceRef, { startDate: "2026-08-01", endDate: "2026-08-02" }, null); } catch (error) { capRejected = error instanceof Error && error.message === "scope report rejected: metric_cap"; }
  const limitPlusOneSql = readFileSync("src/connectors/operations/operation-read-drizzle-repository.ts", "utf8").includes("limit ${MAX_SCOPE_REPORT_METRICS + 1}");
  const ratioNull = (report: typeof day) => report.pivot.find((row) => row.entityRef === campaignRef && row.bucket === "2026-08-01")?.ratios.spendPerAction === null;
  const mixedCurrencyAndAttributionNull = ratioNull(attributionMixed) && ratioNull(currencyMixed);
  if (!Object.values(flags).every(Boolean) || !mixedCurrencyAndAttributionNull || !capRejected || !limitPlusOneSql) throw new Error(JSON.stringify({ flags, mixedCurrencyAndAttributionNull, capRejected, limitPlusOneSql, day, week, month, purchase, filtered }));
  throw rollback;
} catch (error) {
  await q("rollback");
  if (error !== rollback) throw error;
  const residue = await q("select count(*)::int n from workspaces where name='scope report verifier'");
  if (Number(residue.rows[0]?.n) !== 0) throw new Error("fixture_residue");
  console.log(JSON.stringify({ ok: true, mode: "outer_rollback", dayWeekMonthBuckets: true, leadAndPurchaseSelector: true, zeroRowUnavailableCoverage: true, missingDayAvailability: true, exactLargeDecimalRational: true, mixedCurrencyAndAttributionNull: true, excludedMarketConflicting: true, levelMetricActionFilters: true, requestedSortDirection: true, subtotalRatioDrill: true, deterministicOrder: true, limitPlusOneCapRejected: true, publicRefsNoUuid: true, repeatableRead: true, readOnly: true, writeOperations: 0, fixtureWritesRolledBack: true }));
} finally { await client.end(); }
