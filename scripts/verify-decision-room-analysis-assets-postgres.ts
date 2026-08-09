import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import {
  ANALYSIS_TEMPLATE_DEFINITION_VERSION,
  ANALYSIS_TIMEFRAME_DEFINITION_VERSION,
  analysisAssetDefinitionHash,
  type AnalysisTemplateDefinition,
  type AnalysisTimeframeDefinition,
} from "@/application/decision-room-analysis-registry";
import {
  DrizzleDecisionRoomAnalysisAssetRegistry,
  DrizzleDecisionRoomAnalysisRuntimeAssetLoader,
} from "@/connectors/analyses/decision-room-analysis-registry-drizzle";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleGuidanceRegistryRepository } from "@/connectors/guidance/guidance-drizzle-repository";
import {
  DrizzleDecisionRoomRunStore,
  DrizzleDecisionRoomScheduleRegistry,
} from "@/connectors/decisions/decision-room-drizzle-adapters";
import * as schema from "@/db/schema";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";
import { DECISION_ROOM_SCHEDULE_VERSION, type DecisionRoomSchedule } from "@/domain/decisions/schedule";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DATABASE_URL"], continuation: "npm run verify:decision-room-analysis-assets-db" }));
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");
const now = "2026-08-07T12:00:00.000Z";
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const connectionId = randomUUID();
const sourceId = randomUUID();
const accountId = randomUUID();
const campaignId = randomUUID();
const snapshotRef = `snapshot_${"a".repeat(20)}`;

let tablesApplied = false;
let versionedRegistry = false;
let scheduleRevisionFrozen = false;
let manualCurrentFrozen = false;
let retryFrozen = false;
let guidanceRevisionFrozen = false;
let guidanceBindingImmutable = false;
let exactGuidanceRefGuard = false;
let guidanceRefCapsEnforced = false;
let guidanceRefUniqueness = false;
let guidanceScalarTypes = false;
let officialGuidanceUrlParity = false;
let guidanceConstraintsValidated = false;
let crossTenantBlocked = false;
let immutableRows = false;
let rlsAndGrants = false;
let temporaryRowsCommitted = true;

function resultRows(result: unknown): readonly Record<string, unknown>[] {
  return result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
    ? result.rows as readonly Record<string, unknown>[] : [];
}

function timeframe(revision: number, days: number): AnalysisTimeframeDefinition {
  return {
    version: ANALYSIS_TIMEFRAME_DEFINITION_VERSION,
    timeframeRef: "timeframe_daily",
    revision,
    timeframe: { kind: "rolling", days, timezone: "Europe/Istanbul" },
    comparison: "none",
    anchors: {},
  };
}

function template(revision: number, timeframeDefinitionHash: string, contextHash: string, threshold: string): AnalysisTemplateDefinition {
  return {
    version: ANALYSIS_TEMPLATE_DEFINITION_VERSION,
    templateRef: "template_daily",
    revision,
    timeframeRef: "timeframe_daily",
    timeframeDefinitionHash,
    contextHash,
    requestedPasses: ["campaign"],
    hierarchy: [{ entityRef: "campaign_safe", entityType: "campaign", parentEntityRef: null }],
    checks: [{
      checkKey: "spend_guard", passKey: "campaign", entityRef: "campaign_safe", entityType: "campaign",
      parentEntityRef: null, hierarchyPathRefs: ["campaign_safe"], driverEvidenceRefs: [],
      externalEntityId: "campaign_safe", metaConnectionId: connectionId, adAccountId: accountId,
      attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY",
      spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: threshold, minimumSample: 1 },
      maxRowsPerQuery: 10, expectedSnapshotRefs: [snapshotRef],
    }],
    cadence: {
      profile: {
        version: DECISION_CADENCE_VERSION, settleHours: 0, minimumObservationHours: 0,
        minimumLearningHours: 0, cooldownHours: 24, repeatSuppressionHours: 24,
        frequencyWindowHours: 24, maxDecisionsPerWindow: 5, maxActionsPerWindow: 2,
        maximumHistoryEntries: 20, minimumEvidenceCount: 1, minimumEvidenceScore: 0.5,
      },
      observationStartedAt: "2026-08-01T00:00:00.000Z", lastMaterialChangeAt: null,
      learning: { state: "not_applicable", startedAt: null }, lastDecision: null, recentDecisions: [],
      requestedDisposition: "act", emergencyGuardrail: { breached: false, evidenceRef: null },
    },
  };
}

try {
  await database.transaction(async (transaction) => {
    const applied = resultRows(await transaction.execute(sql`
      select to_regclass('public.analysis_timeframe_definitions')::text as timeframe,
        to_regclass('public.analysis_template_definitions')::text as template,
        to_regclass('public.decision_room_schedule_analysis_bindings')::text as schedule_binding,
        to_regclass('public.decision_room_run_analysis_assets')::text as run_asset,
        to_regclass('public.guidance_analysis_run_bindings')::text as guidance_binding
    `))[0];
    tablesApplied = Boolean(applied?.timeframe && applied?.template && applied?.schedule_binding
      && applied?.run_asset && applied?.guidance_binding);
    if (!tablesApplied) throw new Error("Analiz asset migration uygulanmadı");

    await transaction.insert(schema.workspaces).values([
      { id: workspaceId, name: "Analysis asset verifier" },
      { id: foreignWorkspaceId, name: "Foreign analysis asset verifier" },
    ]);
    await transaction.insert(schema.metaConnections).values({
      id: connectionId, workspaceId, externalConnectionKey: "analysis-assets", displayName: "Analysis assets",
      graphApiVersion: "v1", fieldCatalogVersion: "fields-v1", status: "active",
    });
    await transaction.insert(schema.dataSources).values({
      id: sourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads",
      externalAccountId: "account_safe", displayName: "Analysis assets",
    });
    await transaction.insert(schema.adAccounts).values({
      id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: "account_safe",
      name: "Analysis assets", currency: "TRY", timezone: "Europe/Istanbul",
    });
    await transaction.insert(schema.adCampaigns).values({
      id: campaignId, workspaceId, adAccountId: accountId,
      externalCampaignId: "campaign_safe", name: "Analysis assets campaign",
    });
    await transaction.insert(schema.metaChangeSnapshots).values({
      workspaceId, metaConnectionId: connectionId, adAccountId: accountId,
      publicRef: snapshotRef, snapshotHash: "b".repeat(64), schemaVersion: 1,
      fieldCatalogVersion: "fields-v1", capturedAt: new Date(now), canonicalPayload: { entities: [] },
      safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 1, unknownFieldCount: 0 },
    });
    const guidanceRegistry = createGuidanceRegistry({ workspaceId, sources: [{ id: "source_verify", workspaceId,
      sourceType: "observed_result", title: "Observed verifier", sourceRef: "evidence_verify",
      sourceUrl: null, content: "Verified deterministic observation", author: "actor_verify",
      capturedAt: now, reviewedAt: now, reviewBy: null, status: "published", version: 1 }],
    cards: [{ id: "guidance_verify", workspaceId, sourceType: "observed_result", sourceIds: ["source_verify"],
      title: "Observed verifier", body: "Verified deterministic observation", rationale: null,
      strength: "consider", topic: "verification", decisionKey: null, positionKey: null,
      authority: "guidance_only", status: "published", effectiveFrom: now, effectiveTo: null,
      ownerRef: "actor_verify", version: 1 }], bindings: [{ id: "binding_verify", workspaceId,
      cardId: "guidance_verify", facet: "account_group", value: "account_group_verify", entityType: null,
      mode: "default", priority: 50, version: 1 }], sets: [{ id: "guidance_set_verify", workspaceId,
      name: "Verifier set", orderedCardIds: ["guidance_verify"], reviewStatus: "reviewed", version: 1 }] });
    await new DrizzleGuidanceRegistryRepository(transaction as never).save(guidanceRegistry,
      { expectedRegistryHash: null });
    const guidance = buildEffectiveGuidancePack(guidanceRegistry, {
      workspaceId, accountId: "account_safe", accountGroupIds: ["account_group_verify"], objective: "sales",
      internalCategoryIds: [], entity: { type: "campaign", id: "campaign_safe" }, topics: ["verification"],
      requiredTopics: ["verification"], guidanceSetIds: ["guidance_set_verify"], evaluatedAt: now,
      budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
    });
    const context = buildEffectiveCampaignContext({
      workspaceId, capturedAt: now,
      identity: {
        connectionRef: "analysis-assets", accountRef: "account_safe", campaignRef: "campaign_safe",
        entityRef: "campaign_safe", entityType: "campaign", hierarchyRefs: ["campaign_safe"],
      },
      meta: {
        objective: { state: "known", value: "sales" }, optimizationEvent: { state: "known", value: "purchase" },
        configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
        budgetOwnerRef: { state: "known", value: "campaign_safe" }, targetingSignature: { state: "unknown", reason: "not_loaded" },
        actorRef: { state: "known", value: "actor_safe" }, destinationRef: { state: "known", value: null },
      },
      categories: [], guidance, policies: [],
      cadence: { profileRef: "cadence_safe", decision: "eligible", reason: "window_open", cooldownUntil: null },
      data: { trustStatus: "ready", snapshotRefs: [snapshotRef], featureRefs: [snapshotRef], windowRefs: ["window_safe"], blockers: [] },
      history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
      versions: {
        metaCatalog: "meta_v1", categoryResolver: "category_v1", guidanceRegistry: "guidance_v1",
        metricCatalog: "metric_v1", formulaCatalog: "formula_v1", timeframeResolver: "timeframe_v1",
        instructionPolicyRegistry: "9".repeat(64),
      },
    });
    await new DrizzleEffectiveCampaignContextRepository(transaction as never).save(context);

    const registry = new DrizzleDecisionRoomAnalysisAssetRegistry(transaction as never, workspaceId);
    const timeframeV1 = timeframe(1, 7);
    const timeframeV1Result = await registry.publishTimeframe(timeframeV1, now);
    const templateV1 = template(1, timeframeV1Result.definitionHash, context.contextHash, "1000");
    const templateV1Result = await registry.publishTemplate({ accountRef: "account_safe", campaignRef: "campaign_safe", definition: templateV1, publishedAt: now });
    versionedRegistry = timeframeV1Result.outcome === "inserted" && templateV1Result.outcome === "inserted";

    const schedule: DecisionRoomSchedule = {
      version: DECISION_ROOM_SCHEDULE_VERSION, scheduleRef: "schedule_daily", workspaceRef: "workspace_safe",
      accountRef: "account_safe", campaignRef: "campaign_safe", timeframeRef: "timeframe_daily",
      templateRef: "template_daily", timezone: "Europe/Istanbul", localTime: "15:00", frequency: "daily",
      enabled: true, catchUpPolicy: "run_once", tickGraceMinutes: 5,
      dstPolicy: { gap: "next_valid", overlap: "first_occurrence" }, notificationChannel: "in_app_inbox",
    };
    const schedules = new DrizzleDecisionRoomScheduleRegistry(transaction as never, workspaceId);
    await schedules.save(schedule, now);
    const storedSchedule = await schedules.get(schedule.scheduleRef);
    await registry.bindSchedule({
      scheduleRef: schedule.scheduleRef,
      scheduleDefinitionHash: storedSchedule!.definitionHash,
      templateDefinitionHash: templateV1Result.definitionHash,
      timeframeDefinitionHash: timeframeV1Result.definitionHash,
    });

    const timeframeV2 = timeframe(2, 3);
    const timeframeV2Result = await registry.publishTimeframe(timeframeV2, "2026-08-07T12:01:00Z");
    const templateV2 = template(2, timeframeV2Result.definitionHash, context.contextHash, "2000");
    await registry.publishTemplate({ accountRef: "account_safe", campaignRef: "campaign_safe", definition: templateV2, publishedAt: "2026-08-07T12:01:00Z" });

    const store = new DrizzleDecisionRoomRunStore(transaction as never, workspaceId);
    const scheduled = await store.claim({
      idempotencyKey: `idempotency_${"1".repeat(32)}`, scopeKey: "2".repeat(64), triggerKind: "scheduled",
      scheduleRef: schedule.scheduleRef, scheduleDefinitionHash: storedSchedule!.definitionHash,
      triggerRef: schedule.scheduleRef, accountRef: "account_safe", campaignRef: "campaign_safe",
      timeframeRef: "timeframe_daily", templateRef: "template_daily",
      now: "2026-08-07T12:02:00Z", leaseUntil: "2026-08-07T12:07:00Z",
    });
    if (scheduled.status !== "claimed") throw new Error("scheduled claim failed");
    const loader = new DrizzleDecisionRoomAnalysisRuntimeAssetLoader(transaction as never, workspaceId);
    const scheduledAssets = await loader.loadExact({
      runRef: scheduled.runRef, workspaceRef: "workspace_safe", accountRef: "account_safe", campaignRef: "campaign_safe",
      timeframeRef: "timeframe_daily", templateRef: "template_daily", triggerKind: "scheduled",
    });
    scheduleRevisionFrozen = scheduledAssets.resolvedTimeframe.inclusiveDayCount === 7
      && scheduledAssets.checks[0]?.spec.kind === "threshold" && scheduledAssets.checks[0].spec.thresholdDecimal === "1000";

    const manual = await store.claim({
      idempotencyKey: `idempotency_${"3".repeat(32)}`, scopeKey: "4".repeat(64), triggerKind: "manual",
      scheduleRef: null, scheduleDefinitionHash: null, triggerRef: "manual_asset_check",
      accountRef: "account_safe", campaignRef: "campaign_safe", timeframeRef: "timeframe_daily", templateRef: "template_daily",
      now: "2026-08-07T12:03:00Z", leaseUntil: "2026-08-07T12:08:00Z",
    });
    if (manual.status !== "claimed") throw new Error("manual claim failed");
    const manualInput = {
      runRef: manual.runRef, workspaceRef: "workspace_safe", accountRef: "account_safe", campaignRef: "campaign_safe",
      timeframeRef: "timeframe_daily", templateRef: "template_daily", triggerKind: "manual" as const,
    };
    const manualAssets = await loader.loadExact(manualInput);
    manualCurrentFrozen = manualAssets.resolvedTimeframe.inclusiveDayCount === 3;

    const timeframeV3 = timeframe(3, 1);
    const timeframeV3Result = await registry.publishTimeframe(timeframeV3, "2026-08-07T12:04:00Z");
    await registry.publishTemplate({
      accountRef: "account_safe", campaignRef: "campaign_safe",
      definition: template(3, timeframeV3Result.definitionHash, context.contextHash, "3000"),
      publishedAt: "2026-08-07T12:04:00Z",
    });
    retryFrozen = (await loader.loadExact(manualInput)).resolvedTimeframe.inclusiveDayCount === 3;
    const guidanceBindings = resultRows(await transaction.execute(sql`
      select registry_hash, pack_hash, binding_hash, selected_set_refs, card_refs, source_refs, authority
      from guidance_analysis_run_bindings where workspace_id = ${workspaceId}::uuid
      order by occurred_at, id
    `));
    guidanceRevisionFrozen = guidanceBindings.length === 2
      && guidanceBindings.every((row) => row.registry_hash === guidanceRegistry.registryHash
        && row.pack_hash === guidance.packHash && row.authority === "guidance_only"
        && Array.isArray(row.selected_set_refs) && row.selected_set_refs.length === 1
        && Array.isArray(row.card_refs) && row.card_refs.length === 1
        && Array.isArray(row.source_refs) && row.source_refs.length === 1);
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`update guidance_analysis_run_bindings set authority = 'guidance_only'
          where workspace_id = ${workspaceId}::uuid`);
      });
    } catch (reason) {
      guidanceBindingImmutable = reason instanceof Error
        && reason.message.includes("guidance_analysis_run_binding_immutable");
    }
    const manualRun = resultRows(await transaction.execute(sql`select id::text from decision_room_runs
      where workspace_id = ${workspaceId}::uuid and run_ref = ${manual.runRef} limit 1`))[0];
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`
          insert into guidance_analysis_run_bindings (
            workspace_id, run_id, registry_hash, pack_hash, selected_set_refs, card_refs,
            source_refs, authority, binding_hash, occurred_at
          ) values (
            ${workspaceId}::uuid, ${String(manualRun?.id)}::uuid, ${guidance.registryHash}, ${guidance.packHash},
            '[]'::jsonb, '[{"cardRef":"guidance_verify","version":0,"recordHash":"bad"}]'::jsonb,
            '[]'::jsonb, 'guidance_only', ${"8".repeat(64)}, ${now}::timestamptz
          )
        `);
      });
    } catch (reason) {
      exactGuidanceRefGuard = Boolean(reason && typeof reason === "object" && "constraint" in reason
        && reason.constraint === "guidance_analysis_run_bindings_exact_refs");
    }
    const exactRef = { cardRef: "guidance_duplicate", version: 1, recordHash: "a".repeat(64) };
    const duplicateCardRefs = JSON.stringify([exactRef, exactRef]);
    const validCardRefs = JSON.stringify([exactRef]);
    const refNotString = JSON.stringify([{ ...exactRef, cardRef: 123 }]);
    const refNull = JSON.stringify([{ ...exactRef, cardRef: null }]);
    const hashNotString = JSON.stringify([{ ...exactRef, recordHash: 123 }]);
    const hashNull = JSON.stringify([{ ...exactRef, recordHash: null }]);
    const versionNotNumber = JSON.stringify([{ ...exactRef, version: "1" }]);
    const versionNull = JSON.stringify([{ ...exactRef, version: null }]);
    const versionNotInteger = JSON.stringify([{ ...exactRef, version: 1.5 }]);
    const versionDecimalZero = validCardRefs.replace('"version":1', '"version":1.0');
    const versionOverflow = JSON.stringify([{ ...exactRef, version: 2_147_483_648 }]);
    const guidanceGuard = resultRows(await transaction.execute(sql`
      select
        guidance_revision_refs_exact(${validCardRefs}::jsonb, 'cardRef') as valid_allowed,
        guidance_revision_refs_exact(${duplicateCardRefs}::jsonb, 'cardRef') as duplicate_allowed,
        guidance_revision_refs_exact(${refNotString}::jsonb, 'cardRef') as ref_scalar_allowed,
        guidance_revision_refs_exact(${refNull}::jsonb, 'cardRef') as ref_null_allowed,
        guidance_revision_refs_exact(${hashNotString}::jsonb, 'cardRef') as hash_scalar_allowed,
        guidance_revision_refs_exact(${hashNull}::jsonb, 'cardRef') as hash_null_allowed,
        guidance_revision_refs_exact(${versionNotNumber}::jsonb, 'cardRef') as version_string_allowed,
        guidance_revision_refs_exact(${versionNull}::jsonb, 'cardRef') as version_null_allowed,
        guidance_revision_refs_exact(${versionNotInteger}::jsonb, 'cardRef') as version_decimal_allowed,
        guidance_revision_refs_exact(${versionDecimalZero}::jsonb, 'cardRef') as version_decimal_zero_allowed,
        guidance_revision_refs_exact(${versionOverflow}::jsonb, 'cardRef') as version_overflow_allowed,
        (select count(*)::int from pg_constraint where conname in (
          'guidance_analysis_run_bindings_arrays', 'guidance_analysis_run_bindings_exact_refs',
          'guidance_sources_official_publish_evidence') and convalidated) as validated_constraint_count
    `))[0];
    guidanceRefUniqueness = guidanceGuard?.valid_allowed === true && guidanceGuard.duplicate_allowed === false;
    guidanceScalarTypes = guidanceGuard?.ref_scalar_allowed === false && guidanceGuard.ref_null_allowed === false
      && guidanceGuard.hash_scalar_allowed === false && guidanceGuard.hash_null_allowed === false
      && guidanceGuard.version_string_allowed === false && guidanceGuard.version_null_allowed === false
      && guidanceGuard.version_decimal_allowed === false
      && guidanceGuard.version_decimal_zero_allowed === false && guidanceGuard.version_overflow_allowed === false;
    guidanceConstraintsValidated = Number(guidanceGuard?.validated_constraint_count) === 3;
    const officialUrlGuard = resultRows(await transaction.execute(sql`select
      guidance_official_source_url_allowed('HTTPS://WWW.FACEBOOK.COM:443/business/help/1?locale=tr_TR') as valid_default_port,
      guidance_official_source_url_allowed('https://www.facebook.com:444/business/help/1') as nondefault_port,
      guidance_official_source_url_allowed('https://www.facebook.com:0443/business/help/1') as padded_default_port,
      guidance_official_source_url_allowed('https://www.facebook.com/BUSINESS/HELP/1') as uppercase_path,
      guidance_official_source_url_allowed('https://www.facebook.com/business/other/../help/1') as literal_dot,
      guidance_official_source_url_allowed('https://www.facebook.com/business/%2e%2e/help/1') as encoded_dot,
      guidance_official_source_url_allowed(${"https://www.facebook.com/business/help/1?x=\\foo"}) as query_backslash,
      guidance_official_source_url_allowed(${"https://www.facebook.com/business/help/1 "}) as trailing_whitespace,
      guidance_official_source_url_allowed(${"https://www.facebook.com/business/help/1?x=\tvalue"}) as query_tab,
      guidance_official_source_url_allowed('https://www.instagram.com/p/ordinary') as ordinary_content
    `))[0];
    officialGuidanceUrlParity = officialUrlGuard?.valid_default_port === true
      && [officialUrlGuard.nondefault_port, officialUrlGuard.padded_default_port,
        officialUrlGuard.uppercase_path, officialUrlGuard.literal_dot,
        officialUrlGuard.encoded_dot, officialUrlGuard.query_backslash,
        officialUrlGuard.trailing_whitespace, officialUrlGuard.query_tab,
        officialUrlGuard.ordinary_content].every((value) => value === false);

    await transaction.execute(sql.raw(`create temporary table guidance_binding_guard_probe
      (like guidance_analysis_run_bindings including all) on commit drop`));
    const revisionRefs = (kind: "set" | "card" | "source", count: number) => JSON.stringify(
      Array.from({ length: count }, (_, index) => ({ [`${kind}Ref`]: `${kind}_${index.toString(16).padStart(24, "0")}`,
        version: 1, recordHash: "b".repeat(64) })),
    );
    const rejectsCap = async (setCount: number, cardCount: number, sourceCount: number): Promise<boolean> => {
      try {
        await transaction.transaction(async (savepoint) => {
          await savepoint.execute(sql`insert into guidance_binding_guard_probe (
            workspace_id, run_id, registry_hash, pack_hash, selected_set_refs, card_refs,
            source_refs, authority, binding_hash, occurred_at
          ) values (${randomUUID()}::uuid, ${randomUUID()}::uuid, ${"c".repeat(64)}, ${"d".repeat(64)},
            ${revisionRefs("set", setCount)}::jsonb, ${revisionRefs("card", cardCount)}::jsonb,
            ${revisionRefs("source", sourceCount)}::jsonb, 'guidance_only', ${"e".repeat(64)}, ${now}::timestamptz)`);
        });
        return false;
      } catch (reason) {
        return Boolean(reason && typeof reason === "object" && "constraint" in reason
          && reason.constraint === "guidance_analysis_run_bindings_arrays");
      }
    };
    guidanceRefCapsEnforced = (await rejectsCap(51, 0, 0))
      && (await rejectsCap(0, 501, 0)) && (await rejectsCap(0, 0, 1_001));
    try {
      await new DrizzleDecisionRoomAnalysisRuntimeAssetLoader(transaction as never, foreignWorkspaceId).loadExact(manualInput);
    } catch {
      crossTenantBlocked = true;
    }
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`update decision_room_run_analysis_assets set asset_hash = ${"f".repeat(64)} where workspace_id = ${workspaceId}::uuid`);
      });
    } catch {
      immutableRows = true;
    }
    const security = resultRows(await transaction.execute(sql`
      select count(*) filter (where c.relrowsecurity)::int as rls_count,
        count(*) filter (where c.relname = 'guidance_analysis_run_bindings'
          and c.relrowsecurity and c.relforcerowsecurity)::int as guidance_force_rls,
        (select count(*)::int from information_schema.role_table_grants
          where table_schema = 'public' and table_name in (
            'analysis_timeframe_definitions', 'analysis_template_definitions',
            'decision_room_schedule_analysis_bindings', 'decision_room_run_analysis_assets',
            'guidance_analysis_run_bindings'
          ) and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) as api_grants,
        (select count(*)::int from information_schema.routine_privileges
          where routine_schema = 'public'
            and routine_name in ('guidance_revision_refs_exact', 'guidance_analysis_run_binding_immutable',
              'guidance_registry_revision_immutable', 'guidance_official_source_url_allowed')
            and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) as routine_grants
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in (
        'analysis_timeframe_definitions', 'analysis_template_definitions',
        'decision_room_schedule_analysis_bindings', 'decision_room_run_analysis_assets',
        'guidance_analysis_run_bindings'
      )
    `))[0];
    rlsAndGrants = Number(security?.rls_count) === 5 && Number(security?.guidance_force_rls) === 1
      && Number(security?.api_grants) === 0
      && Number(security?.routine_grants) === 0;
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

const residue = await database.execute(sql`select count(*)::int as count from workspaces where id in (${workspaceId}::uuid, ${foreignWorkspaceId}::uuid)`);
temporaryRowsCommitted = Number(resultRows(residue)[0]?.count ?? -1) !== 0;
await pool.end();

const result = {
  tablesApplied, versionedRegistry, scheduleRevisionFrozen, manualCurrentFrozen, retryFrozen, guidanceRevisionFrozen,
  guidanceBindingImmutable, exactGuidanceRefGuard, guidanceRefCapsEnforced, guidanceRefUniqueness,
  guidanceScalarTypes, officialGuidanceUrlParity, guidanceConstraintsValidated,
  crossTenantBlocked, immutableRows, rlsAndGrants, temporaryRowsCommitted,
  metaCalls: 0, externalCalls: 0, actionAuthority: "none",
};
console.log(JSON.stringify(result));
if (Object.entries(result).some(([key, value]) => key !== "actionAuthority" && key !== "metaCalls" && key !== "externalCalls"
  && key !== "temporaryRowsCommitted" && value !== true)
  || result.temporaryRowsCommitted || result.metaCalls !== 0 || result.externalCalls !== 0 || result.actionAuthority !== "none") {
  process.exitCode = 1;
}
