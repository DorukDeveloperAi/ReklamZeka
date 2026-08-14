import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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
import {
  DrizzleDecisionRoomRunStore,
  DrizzleDecisionRoomScheduleRegistry,
} from "@/connectors/decisions/decision-room-drizzle-adapters";
import * as schema from "@/db/schema";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";
import { DECISION_ROOM_SCHEDULE_VERSION, type DecisionRoomSchedule } from "@/domain/decisions/schedule";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";
import { materializeCurrentEffectiveAnalysisContextSourceFixture } from "./support/current-effective-analysis-context-source-fixture";

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

let tablesApplied = false;
let versionedRegistry = false;
let scheduleRevisionFrozen = false;
let manualCurrentFrozen = false;
let retryFrozen = false;
let agendaFrozen = false;
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
let verifierWorkspaceId: string | null = null;
let verifierForeignWorkspaceId: string | null = null;

function resultRows(result: unknown): readonly Record<string, unknown>[] {
  return result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
    ? result.rows as readonly Record<string, unknown>[] : [];
}

/** Drizzle wraps PostgreSQL constraint/trigger errors; inspect the causal chain, not wrapper wording. */
function causedByConstraint(error: unknown, constraint: string): boolean {
  const visited = new Set<unknown>(); let current: unknown = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as Record<string, unknown>;
    if (candidate.constraint === constraint || (typeof candidate.message === "string" && candidate.message.includes(constraint))) return true;
    current = candidate.cause;
  }
  return false;
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

function template(revision: number, timeframeDefinitionHash: string, contextHash: string, threshold: string, scope: Readonly<{
  connectionId: string; accountId: string; accountRef: string; campaignRef: string; snapshotRef: string;
}>): AnalysisTemplateDefinition {
  return {
    version: ANALYSIS_TEMPLATE_DEFINITION_VERSION,
    templateRef: "template_daily",
    revision,
    timeframeRef: "timeframe_daily",
    timeframeDefinitionHash,
    contextHash,
    requestedPasses: ["entity"],
    hierarchy: [{ entityRef: scope.campaignRef, entityType: "campaign", parentEntityRef: null }],
    checks: [{
      checkKey: "spend_guard", passKey: "entity", entityRef: scope.campaignRef, entityType: "campaign",
      parentEntityRef: null, hierarchyPathRefs: [scope.campaignRef], driverEvidenceRefs: [],
      externalEntityId: scope.campaignRef, metaConnectionId: scope.connectionId, adAccountId: scope.accountId,
      attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY",
      spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: threshold, minimumSample: 1 },
      maxRowsPerQuery: 10, expectedSnapshotRefs: [scope.snapshotRef],
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

    // The verifier must exercise the same L1/L2/L3 provenance chain as runtime
    // composition.  In particular, do not persist a hand-built context: the
    // repository rejects those because their evidence components are untrusted.
    const fixture = await materializeCurrentEffectiveAnalysisContextSourceFixture(transaction as never, new Date(now));
    const { workspaceId, foreignWorkspaceId, accountRef, campaignRef, snapshotRef } = fixture;
    verifierWorkspaceId = workspaceId;
    verifierForeignWorkspaceId = foreignWorkspaceId;
    const context = (await createDrizzleEffectiveAnalysisContextComposer({ database: transaction as never })
      .composeAndSave(fixture.request)).context;
    const guidance = context.guidance;
    const sourceScope = {
      connectionId: (await transaction.execute(sql`select id::text from meta_connections
        where workspace_id = ${workspaceId}::uuid limit 1`)).rows[0]?.id as string,
      accountId: fixture.adAccountId, accountRef, campaignRef, snapshotRef,
    };
    if (!sourceScope.connectionId) throw new Error("authentic_source_connection_missing");

    const registry = new DrizzleDecisionRoomAnalysisAssetRegistry(transaction as never, workspaceId);
    const timeframeV1 = timeframe(1, 7);
    const timeframeV1Result = await registry.publishTimeframe(timeframeV1, now);
    const templateV1 = template(1, timeframeV1Result.definitionHash, context.contextHash, "1000", sourceScope);
    const templateV1Result = await registry.publishTemplate({ accountRef, campaignRef, definition: templateV1, publishedAt: now });
    versionedRegistry = timeframeV1Result.outcome === "inserted" && templateV1Result.outcome === "inserted";

    const schedule: DecisionRoomSchedule = {
      version: DECISION_ROOM_SCHEDULE_VERSION, scheduleRef: "schedule_daily", workspaceRef: fixture.workspaceRef,
      accountRef, campaignRef, timeframeRef: "timeframe_daily",
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
    const templateV2 = template(2, timeframeV2Result.definitionHash, context.contextHash, "2000", sourceScope);
    await registry.publishTemplate({ accountRef, campaignRef, definition: templateV2, publishedAt: "2026-08-07T12:01:00Z" });

    const store = new DrizzleDecisionRoomRunStore(transaction as never, workspaceId);
    const scheduled = await store.claim({
      idempotencyKey: `idempotency_${"1".repeat(32)}`, scopeKey: "2".repeat(64), triggerKind: "scheduled",
      scheduleRef: schedule.scheduleRef, scheduleDefinitionHash: storedSchedule!.definitionHash,
      triggerRef: schedule.scheduleRef, accountRef, campaignRef,
      timeframeRef: "timeframe_daily", templateRef: "template_daily",
      now: "2026-08-07T12:02:00Z", leaseUntil: "2026-08-07T12:07:00Z",
    });
    if (scheduled.status !== "claimed") throw new Error("scheduled claim failed");
    const loader = new DrizzleDecisionRoomAnalysisRuntimeAssetLoader(transaction as never, workspaceId);
    const scheduledAssets = await loader.loadExact({
      runRef: scheduled.runRef, workspaceRef: fixture.workspaceRef, accountRef, campaignRef,
      timeframeRef: "timeframe_daily", templateRef: "template_daily", triggerKind: "scheduled",
    });
    scheduleRevisionFrozen = scheduledAssets.resolvedTimeframe.inclusiveDayCount === 7
      && scheduledAssets.checks[0]?.spec.kind === "threshold" && scheduledAssets.checks[0].spec.thresholdDecimal === "1000";

    const manual = await store.claim({
      idempotencyKey: `idempotency_${"3".repeat(32)}`, scopeKey: "4".repeat(64), triggerKind: "manual",
      scheduleRef: null, scheduleDefinitionHash: null, triggerRef: "manual_asset_check",
      accountRef, campaignRef, timeframeRef: "timeframe_daily", templateRef: "template_daily",
      now: "2026-08-07T12:03:00Z", leaseUntil: "2026-08-07T12:08:00Z",
    });
    if (manual.status !== "claimed") throw new Error("manual claim failed");
    const manualInput = {
      runRef: manual.runRef, workspaceRef: fixture.workspaceRef, accountRef, campaignRef,
      timeframeRef: "timeframe_daily", templateRef: "template_daily", triggerKind: "manual" as const,
    };
    const manualAssets = await loader.loadExact(manualInput);
    manualCurrentFrozen = manualAssets.resolvedTimeframe.inclusiveDayCount === 3;
    const frozenAgenda = resultRows(await transaction.execute(sql`
      select agenda_hash, agenda_payload from decision_room_run_analysis_assets
      where workspace_id = ${workspaceId}::uuid and run_id = (
        select id from decision_room_runs
        where workspace_id = ${workspaceId}::uuid and run_ref = ${manual.runRef}
        limit 1
      )
      limit 1
    `))[0];
    agendaFrozen = frozenAgenda?.agenda_hash === manualAssets.agenda.agendaHash
      && (frozenAgenda?.agenda_payload as { agendaHash?: unknown } | undefined)?.agendaHash === manualAssets.agenda.agendaHash;

    const timeframeV3 = timeframe(3, 1);
    const timeframeV3Result = await registry.publishTimeframe(timeframeV3, "2026-08-07T12:04:00Z");
    await registry.publishTemplate({
      accountRef, campaignRef,
      definition: template(3, timeframeV3Result.definitionHash, context.contextHash, "3000", sourceScope),
      publishedAt: "2026-08-07T12:04:00Z",
    });
    retryFrozen = (await loader.loadExact(manualInput)).resolvedTimeframe.inclusiveDayCount === 3;
    const guidanceBindings = resultRows(await transaction.execute(sql`
      select registry_hash, pack_hash, binding_hash, selected_set_refs, card_refs, source_refs, authority
      from guidance_analysis_run_bindings where workspace_id = ${workspaceId}::uuid
      order by occurred_at, id
    `));
    guidanceRevisionFrozen = guidanceBindings.length === 2
      && guidanceBindings.every((row) => row.registry_hash === guidance.registryHash
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
      guidanceBindingImmutable = causedByConstraint(reason, "guidance_analysis_run_binding_immutable");
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
      exactGuidanceRefGuard = causedByConstraint(reason, "guidance_analysis_run_bindings_exact_refs");
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
        return causedByConstraint(reason, "guidance_analysis_run_bindings_arrays");
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

if (verifierWorkspaceId && verifierForeignWorkspaceId) {
  const residue = await database.execute(sql`select count(*)::int as count from workspaces
    where id in (${verifierWorkspaceId}::uuid, ${verifierForeignWorkspaceId}::uuid)`);
  temporaryRowsCommitted = Number(resultRows(residue)[0]?.count ?? -1) !== 0;
}
await pool.end();

const result = {
  tablesApplied, versionedRegistry, scheduleRevisionFrozen, manualCurrentFrozen, retryFrozen, agendaFrozen, guidanceRevisionFrozen,
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
