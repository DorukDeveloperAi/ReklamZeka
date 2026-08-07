import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  analysisAssetDefinitionHash,
  ANALYSIS_TEMPLATE_DEFINITION_VERSION,
  ANALYSIS_TIMEFRAME_DEFINITION_VERSION,
  DecisionRoomAnalysisRegistryError,
  validateAnalysisTemplateDefinition,
  validateAnalysisTimeframeDefinition,
  type AnalysisTemplateDefinition,
  type AnalysisTimeframeDefinition,
} from "@/application/decision-room-analysis-registry";
import {
  DECISION_ROOM_ANALYSIS_RUNTIME_VERSION,
  DecisionRoomDeterministicAnalysisRuntime,
  DecisionRoomAnalysisRuntimeError,
  validateDecisionRoomAnalysisRuntimeAssets,
  type DecisionRoomAnalysisRuntimeAssetPort,
  type DecisionRoomAnalysisRuntimeAssets,
} from "@/application/decision-room-analysis-runtime";
import type { DecisionRoomDraftPort } from "@/application/decision-room";
import type { FindingObservationReadPort } from "@/analyses/finding-observation-builder";
import { buildEffectiveCampaignContext, type EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { resolveAnalysisTimeframe, validateResolvedAnalysisTimeframe, type ResolvedAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import * as schema from "@/db/schema";
import { DrizzleDecisionRoomInbox, DrizzleDecisionRoomRunStore } from "@/connectors/decisions/decision-room-drizzle-adapters";
import { DecisionRoomExecutor } from "@/domain/decisions/executor";

type Database = NodePgDatabase<typeof schema>;
type PersistenceDatabase = Pick<Database, "execute" | "transaction">;

export class DecisionRoomAnalysisAssetPersistenceError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "definition_conflict"
    | "asset_scope_mismatch"
    | "schedule_binding_missing"
    | "run_binding_mismatch"
    | "corrupt_store") {
    super(`Decision Room analiz varlığı persistence reddedildi: ${code}`);
    this.name = "DecisionRoomAnalysisAssetPersistenceError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
  }
  return result.rows as readonly T[];
}

function workspace(value: string): string {
  if (!UUID.test(value)) throw new DecisionRoomAnalysisAssetPersistenceError("invalid_input");
  return value;
}

function ref(value: string): string {
  if (!REF.test(value) || /(token|secret|prompt|raw[_-]?(payload|request|response|json))/i.test(value)) {
    throw new DecisionRoomAnalysisAssetPersistenceError("invalid_input");
  }
  return value;
}

function hash(value: string): string {
  if (!HASH.test(value)) throw new DecisionRoomAnalysisAssetPersistenceError("invalid_input");
  return value;
}

function instant(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new DecisionRoomAnalysisAssetPersistenceError("invalid_input");
  return new Date(value).toISOString();
}

async function active(database: Pick<Database, "execute">, workspaceId: string): Promise<void> {
  const result = await database.execute(sql`
    select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 1
  `);
  if (rows(result).length !== 1) throw new DecisionRoomAnalysisAssetPersistenceError("workspace_scope_mismatch");
}

function restoreContext(payload: unknown): EffectiveCampaignContext {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
  }
  const candidate = payload as EffectiveCampaignContext;
  const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...input } = candidate;
  try {
    const rebuilt = buildEffectiveCampaignContext(input);
    if (rebuilt.contextHash !== candidate.contextHash) throw new Error("hash mismatch");
    return rebuilt;
  } catch {
    throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
  }
}

type AssetSelection = Readonly<{
  template_id: string; timeframe_id: string; context_id: string;
  template_hash: string; timeframe_hash: string; context_hash: string;
  template_payload: unknown; timeframe_payload: unknown; context_payload: unknown;
}>;

function runtimeAssets(
  input: Parameters<DecisionRoomAnalysisRuntimeAssetPort["loadExact"]>[0],
  occurredAt: string,
  selection: AssetSelection,
  persistedResolved?: unknown,
): DecisionRoomAnalysisRuntimeAssets {
  let template: AnalysisTemplateDefinition;
  let timeframe: AnalysisTimeframeDefinition;
  try {
    template = validateAnalysisTemplateDefinition(selection.template_payload as AnalysisTemplateDefinition);
    timeframe = validateAnalysisTimeframeDefinition(selection.timeframe_payload as AnalysisTimeframeDefinition, occurredAt);
  } catch (error) {
    if (error instanceof DecisionRoomAnalysisRegistryError) {
      throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
    }
    throw error;
  }
  if (analysisAssetDefinitionHash(template) !== selection.template_hash
    || analysisAssetDefinitionHash(timeframe) !== selection.timeframe_hash
    || template.contextHash !== selection.context_hash
    || template.timeframeDefinitionHash !== selection.timeframe_hash
    || template.timeframeRef !== timeframe.timeframeRef) {
    throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
  }
  const context = restoreContext(selection.context_payload);
  if (context.contextHash !== selection.context_hash) {
    throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
  }
  let resolved: ResolvedAnalysisTimeframe;
  try {
    resolved = persistedResolved
      ? validateResolvedAnalysisTimeframe(persistedResolved as ResolvedAnalysisTimeframe)
      : resolveAnalysisTimeframe({
        timeframe: timeframe.timeframe,
        comparison: timeframe.comparison,
        asOf: occurredAt,
        anchors: timeframe.anchors,
      });
  } catch {
    throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
  }
  const assets: DecisionRoomAnalysisRuntimeAssets = Object.freeze({
    version: DECISION_ROOM_ANALYSIS_RUNTIME_VERSION,
    workspaceRef: input.workspaceRef,
    accountRef: input.accountRef,
    campaignRef: input.campaignRef,
    timeframeRef: input.timeframeRef,
    templateRef: input.templateRef,
    occurredAt,
    context,
    resolvedTimeframe: resolved,
    requestedPasses: template.requestedPasses,
    hierarchy: template.hierarchy,
    checks: template.checks,
    cadence: template.cadence,
  });
  try {
    validateDecisionRoomAnalysisRuntimeAssets({ ...input, actionAuthority: "none" }, assets);
  } catch (error) {
    if (error instanceof DecisionRoomAnalysisRuntimeError) {
      throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
    }
    throw error;
  }
  return assets;
}

/** Append-only publisher and schedule-revision binder. */
export class DrizzleDecisionRoomAnalysisAssetRegistry {
  private readonly workspaceId: string;

  constructor(private readonly database: PersistenceDatabase, workspaceId: string) {
    this.workspaceId = workspace(workspaceId);
  }

  async publishTimeframe(definitionInput: AnalysisTimeframeDefinition, publishedAt: string): Promise<Readonly<{
    outcome: "inserted" | "unchanged"; definitionHash: string;
  }>> {
    const at = instant(publishedAt);
    const definition = validateAnalysisTimeframeDefinition(definitionInput, at);
    const definitionHash = analysisAssetDefinitionHash(definition);
    return this.database.transaction(async (transaction) => {
      await active(transaction, this.workspaceId);
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${this.workspaceId}:analysis-timeframe:${definition.timeframeRef}`}, 0))`);
      const current = rows<{ revision: number; definition_hash: string }>(await transaction.execute(sql`
        select revision, definition_hash from analysis_timeframe_definitions
        where workspace_id = ${this.workspaceId}::uuid and timeframe_ref = ${definition.timeframeRef}
          and superseded_at is null limit 1 for update
      `))[0];
      if (current?.definition_hash === definitionHash) return Object.freeze({ outcome: "unchanged" as const, definitionHash });
      if (definition.revision !== (current?.revision ?? 0) + 1) {
        throw new DecisionRoomAnalysisAssetPersistenceError("definition_conflict");
      }
      await transaction.execute(sql`
        update analysis_timeframe_definitions set superseded_at = ${at}::timestamptz
        where workspace_id = ${this.workspaceId}::uuid and timeframe_ref = ${definition.timeframeRef} and superseded_at is null
      `);
      await transaction.execute(sql`
        insert into analysis_timeframe_definitions (
          workspace_id, timeframe_ref, revision, definition_version, definition_hash, definition_payload
        ) values (
          ${this.workspaceId}::uuid, ${definition.timeframeRef}, ${definition.revision},
          ${ANALYSIS_TIMEFRAME_DEFINITION_VERSION}, ${definitionHash}, ${JSON.stringify(definition)}::jsonb
        )
      `);
      return Object.freeze({ outcome: "inserted" as const, definitionHash });
    });
  }

  async publishTemplate(input: Readonly<{
    accountRef: string;
    campaignRef: string;
    definition: AnalysisTemplateDefinition;
    publishedAt: string;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; definitionHash: string }>> {
    const accountRef = input.accountRef.trim();
    const campaignRef = input.campaignRef.trim();
    if (!accountRef || !campaignRef || accountRef.length > 256 || campaignRef.length > 256) {
      throw new DecisionRoomAnalysisAssetPersistenceError("invalid_input");
    }
    const at = instant(input.publishedAt);
    const definition = validateAnalysisTemplateDefinition(input.definition);
    const definitionHash = analysisAssetDefinitionHash(definition);
    return this.database.transaction(async (transaction) => {
      await active(transaction, this.workspaceId);
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${this.workspaceId}:analysis-template:${definition.templateRef}`}, 0))`);
      const scope = rows<{
        connection_id: string; account_id: string; campaign_id: string; context_id: string; context_payload: unknown;
        timeframe_id: string; timeframe_payload: unknown;
      }>(await transaction.execute(sql`
        select context.meta_connection_id::text as connection_id,
          account.id::text as account_id, campaign.id::text as campaign_id,
          context.id::text as context_id, context.context_payload,
          timeframe.id::text as timeframe_id, timeframe.definition_payload as timeframe_payload
        from ad_accounts account
        join ad_campaigns campaign on campaign.workspace_id = account.workspace_id and campaign.ad_account_id = account.id
        join effective_campaign_contexts context on context.workspace_id = campaign.workspace_id
          and context.ad_account_id = account.id and context.campaign_id = campaign.id
          and context.context_hash = ${definition.contextHash} and context.entity_type = 'campaign'
        join analysis_timeframe_definitions timeframe on timeframe.workspace_id = campaign.workspace_id
          and timeframe.timeframe_ref = ${definition.timeframeRef}
          and timeframe.definition_hash = ${definition.timeframeDefinitionHash}
        where account.workspace_id = ${this.workspaceId}::uuid
          and account.external_account_id = ${accountRef}
          and campaign.external_campaign_id = ${campaignRef}
          and not exists (
            select 1 from effective_campaign_context_components component
            join effective_campaign_context_invalidations invalidation
              on invalidation.workspace_id = component.workspace_id
             and invalidation.component_type = component.component_type
             and invalidation.component_ref = component.component_ref
             and invalidation.component_version = component.component_version
            where component.workspace_id = context.workspace_id and component.context_id = context.id
              and (invalidation.entity_type is null
                or (invalidation.entity_type = context.entity_type and invalidation.entity_ref = context.entity_ref))
          )
        limit 2
      `));
      if (scope.length !== 1) throw new DecisionRoomAnalysisAssetPersistenceError("asset_scope_mismatch");
      for (const check of definition.checks) {
        if (check.metaConnectionId !== scope[0]!.connection_id || check.adAccountId !== scope[0]!.account_id) {
          throw new DecisionRoomAnalysisAssetPersistenceError("asset_scope_mismatch");
        }
        const matched = rows(await transaction.execute(check.entityType === "campaign" ? sql`
          select id from ad_campaigns where workspace_id = ${this.workspaceId}::uuid
            and id = ${scope[0]!.campaign_id}::uuid and external_campaign_id = ${check.externalEntityId} limit 1
        ` : check.entityType === "ad_set" ? sql`
          select id from meta_ad_sets where workspace_id = ${this.workspaceId}::uuid
            and ad_account_id = ${scope[0]!.account_id}::uuid and campaign_id = ${scope[0]!.campaign_id}::uuid
            and external_ad_set_id = ${check.externalEntityId} limit 1
        ` : sql`
          select id from meta_ads where workspace_id = ${this.workspaceId}::uuid
            and ad_account_id = ${scope[0]!.account_id}::uuid and campaign_id = ${scope[0]!.campaign_id}::uuid
            and external_ad_id = ${check.externalEntityId} limit 1
        `));
        if (matched.length !== 1) throw new DecisionRoomAnalysisAssetPersistenceError("asset_scope_mismatch");
      }
      runtimeAssets({
        runRef: "run_publication_validation", workspaceRef: "workspace_publication_validation",
        accountRef, campaignRef, timeframeRef: definition.timeframeRef,
        templateRef: definition.templateRef, triggerKind: "manual",
      }, at, {
        template_id: "publication", timeframe_id: scope[0]!.timeframe_id, context_id: scope[0]!.context_id,
        template_hash: definitionHash, timeframe_hash: definition.timeframeDefinitionHash,
        context_hash: definition.contextHash, template_payload: definition,
        timeframe_payload: scope[0]!.timeframe_payload, context_payload: scope[0]!.context_payload,
      });
      const current = rows<{ revision: number; definition_hash: string }>(await transaction.execute(sql`
        select revision, definition_hash from analysis_template_definitions
        where workspace_id = ${this.workspaceId}::uuid and template_ref = ${definition.templateRef}
          and superseded_at is null limit 1 for update
      `))[0];
      if (current?.definition_hash === definitionHash) return Object.freeze({ outcome: "unchanged" as const, definitionHash });
      if (definition.revision !== (current?.revision ?? 0) + 1) {
        throw new DecisionRoomAnalysisAssetPersistenceError("definition_conflict");
      }
      await transaction.execute(sql`
        update analysis_template_definitions set superseded_at = ${at}::timestamptz
        where workspace_id = ${this.workspaceId}::uuid and template_ref = ${definition.templateRef} and superseded_at is null
      `);
      await transaction.execute(sql`
        insert into analysis_template_definitions (
          workspace_id, ad_account_id, campaign_id, context_id, timeframe_definition_id,
          account_ref, campaign_ref, template_ref, revision, definition_version, definition_hash,
          timeframe_ref, timeframe_definition_hash, context_hash, definition_payload
        ) values (
          ${this.workspaceId}::uuid, ${scope[0]!.account_id}::uuid, ${scope[0]!.campaign_id}::uuid,
          ${scope[0]!.context_id}::uuid, ${scope[0]!.timeframe_id}::uuid,
          ${accountRef}, ${campaignRef}, ${definition.templateRef}, ${definition.revision},
          ${ANALYSIS_TEMPLATE_DEFINITION_VERSION}, ${definitionHash}, ${definition.timeframeRef},
          ${definition.timeframeDefinitionHash}, ${definition.contextHash}, ${JSON.stringify(definition)}::jsonb
        )
      `);
      return Object.freeze({ outcome: "inserted" as const, definitionHash });
    });
  }

  async bindSchedule(input: Readonly<{
    scheduleRef: string;
    scheduleDefinitionHash: string;
    templateDefinitionHash: string;
    timeframeDefinitionHash: string;
  }>): Promise<string> {
    const scheduleRef = ref(input.scheduleRef);
    const scheduleHash = hash(input.scheduleDefinitionHash);
    const templateHash = hash(input.templateDefinitionHash);
    const timeframeHash = hash(input.timeframeDefinitionHash);
    return this.database.transaction(async (transaction) => {
      await active(transaction, this.workspaceId);
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${this.workspaceId}:analysis-schedule:${scheduleRef}:${scheduleHash}`}, 0))`);
      const candidate = rows<{
        schedule_id: string; template_id: string; timeframe_id: string;
        template_hash: string; timeframe_hash: string;
      }>(await transaction.execute(sql`
        select schedule.id::text as schedule_id, template.id::text as template_id,
          timeframe.id::text as timeframe_id, template.definition_hash as template_hash,
          timeframe.definition_hash as timeframe_hash
        from decision_room_schedules schedule
        join analysis_template_definitions template on template.workspace_id = schedule.workspace_id
          and template.ad_account_id = schedule.ad_account_id and template.campaign_id = schedule.campaign_id
          and template.account_ref = schedule.account_ref and template.campaign_ref = schedule.campaign_ref
          and template.template_ref = schedule.template_ref and template.definition_hash = ${templateHash}
        join analysis_timeframe_definitions timeframe on timeframe.workspace_id = template.workspace_id
          and timeframe.id = template.timeframe_definition_id and timeframe.timeframe_ref = schedule.timeframe_ref
          and timeframe.definition_hash = ${timeframeHash}
        where schedule.workspace_id = ${this.workspaceId}::uuid and schedule.schedule_ref = ${scheduleRef}
          and schedule.definition_hash = ${scheduleHash}
        limit 2
      `));
      if (candidate.length !== 1) throw new DecisionRoomAnalysisAssetPersistenceError("asset_scope_mismatch");
      const bindingHash = analysisAssetDefinitionHash({
        workspaceId: this.workspaceId, scheduleRef, scheduleDefinitionHash: scheduleHash,
        templateDefinitionHash: candidate[0]!.template_hash,
        timeframeDefinitionHash: candidate[0]!.timeframe_hash,
      });
      const inserted = rows<{ binding_hash: string }>(await transaction.execute(sql`
        insert into decision_room_schedule_analysis_bindings (
          workspace_id, schedule_id, template_definition_id, timeframe_definition_id, binding_hash
        ) values (
          ${this.workspaceId}::uuid, ${candidate[0]!.schedule_id}::uuid,
          ${candidate[0]!.template_id}::uuid, ${candidate[0]!.timeframe_id}::uuid, ${bindingHash}
        ) on conflict (workspace_id, schedule_id) do nothing returning binding_hash
      `));
      if (inserted[0]?.binding_hash === bindingHash) return bindingHash;
      const existing = rows<{ binding_hash: string }>(await transaction.execute(sql`
        select binding_hash from decision_room_schedule_analysis_bindings
        where workspace_id = ${this.workspaceId}::uuid and schedule_id = ${candidate[0]!.schedule_id}::uuid limit 1
      `))[0];
      if (existing?.binding_hash !== bindingHash) throw new DecisionRoomAnalysisAssetPersistenceError("definition_conflict");
      return bindingHash;
    });
  }
}

/** Production loader: freezes exact definition/context refs on the first claimed-run read. */
export class DrizzleDecisionRoomAnalysisRuntimeAssetLoader implements DecisionRoomAnalysisRuntimeAssetPort {
  private readonly workspaceId: string;

  constructor(private readonly database: PersistenceDatabase, workspaceId: string) {
    this.workspaceId = workspace(workspaceId);
  }

  async loadExact(input: Parameters<DecisionRoomAnalysisRuntimeAssetPort["loadExact"]>[0]): Promise<DecisionRoomAnalysisRuntimeAssets> {
    ref(input.runRef); ref(input.workspaceRef); ref(input.timeframeRef); ref(input.templateRef);
    if (!input.accountRef.trim() || !input.campaignRef.trim() || !["manual", "scheduled"].includes(input.triggerKind)) {
      throw new DecisionRoomAnalysisAssetPersistenceError("invalid_input");
    }
    return this.database.transaction(async (transaction) => {
      await active(transaction, this.workspaceId);
      const run = rows<{
        id: string; trigger_kind: "manual" | "scheduled"; schedule_id: string | null;
        started_at: Date | string | null; account_ref: string; campaign_ref: string;
        timeframe_ref: string; template_ref: string;
      }>(await transaction.execute(sql`
        select id::text, trigger_kind, schedule_id::text, started_at,
          account_ref, campaign_ref, timeframe_ref, template_ref
        from decision_room_runs
        where workspace_id = ${this.workspaceId}::uuid and run_ref = ${input.runRef}
        limit 1 for update
      `))[0];
      if (!run || run.trigger_kind !== input.triggerKind || run.account_ref !== input.accountRef
        || run.campaign_ref !== input.campaignRef || run.timeframe_ref !== input.timeframeRef
        || run.template_ref !== input.templateRef || run.started_at === null) {
        throw new DecisionRoomAnalysisAssetPersistenceError("run_binding_mismatch");
      }
      const occurredAt = instant(run.started_at instanceof Date ? run.started_at.toISOString() : run.started_at);
      const existing = rows<AssetSelection & { asset_hash: string; occurred_at: Date | string; resolved_timeframe: unknown }>(await transaction.execute(sql`
        select asset.template_definition_id::text as template_id,
          asset.timeframe_definition_id::text as timeframe_id, asset.context_id::text,
          template.definition_hash as template_hash, timeframe.definition_hash as timeframe_hash,
          context.context_hash, template.definition_payload as template_payload,
          timeframe.definition_payload as timeframe_payload, context.context_payload,
          asset.asset_hash, asset.occurred_at, asset.resolved_timeframe
        from decision_room_run_analysis_assets asset
        join analysis_template_definitions template on template.workspace_id = asset.workspace_id and template.id = asset.template_definition_id
        join analysis_timeframe_definitions timeframe on timeframe.workspace_id = asset.workspace_id and timeframe.id = asset.timeframe_definition_id
        join effective_campaign_contexts context on context.workspace_id = asset.workspace_id and context.id = asset.context_id
        where asset.workspace_id = ${this.workspaceId}::uuid and asset.run_id = ${run.id}::uuid limit 1
      `))[0];
      if (existing) {
        const frozenAt = instant(existing.occurred_at instanceof Date ? existing.occurred_at.toISOString() : existing.occurred_at);
        const expectedHash = analysisAssetDefinitionHash({
          runRef: input.runRef, templateHash: existing.template_hash,
          timeframeHash: existing.timeframe_hash, contextHash: existing.context_hash,
          occurredAt: frozenAt, resolvedTimeframe: existing.resolved_timeframe,
        });
        if (existing.asset_hash !== expectedHash) throw new DecisionRoomAnalysisAssetPersistenceError("corrupt_store");
        return runtimeAssets(input, frozenAt, existing, existing.resolved_timeframe);
      }
      const selectionSql = run.trigger_kind === "scheduled" ? sql`
        select template.id::text as template_id, timeframe.id::text as timeframe_id,
          context.id::text as context_id, template.definition_hash as template_hash,
          timeframe.definition_hash as timeframe_hash, context.context_hash,
          template.definition_payload as template_payload, timeframe.definition_payload as timeframe_payload,
          context.context_payload
        from decision_room_schedule_analysis_bindings binding
        join analysis_template_definitions template on template.workspace_id = binding.workspace_id
          and template.id = binding.template_definition_id
        join analysis_timeframe_definitions timeframe on timeframe.workspace_id = binding.workspace_id
          and timeframe.id = binding.timeframe_definition_id
        join effective_campaign_contexts context on context.workspace_id = template.workspace_id and context.id = template.context_id
        where binding.workspace_id = ${this.workspaceId}::uuid and binding.schedule_id = ${run.schedule_id}::uuid
          and template.account_ref = ${input.accountRef} and template.campaign_ref = ${input.campaignRef}
          and template.template_ref = ${input.templateRef} and timeframe.timeframe_ref = ${input.timeframeRef}
          and not exists (
            select 1 from effective_campaign_context_components component
            join effective_campaign_context_invalidations invalidation
              on invalidation.workspace_id = component.workspace_id
             and invalidation.component_type = component.component_type
             and invalidation.component_ref = component.component_ref
             and invalidation.component_version = component.component_version
            where component.workspace_id = context.workspace_id and component.context_id = context.id
              and (invalidation.entity_type is null
                or (invalidation.entity_type = context.entity_type and invalidation.entity_ref = context.entity_ref))
          )
        limit 2
      ` : sql`
        select template.id::text as template_id, timeframe.id::text as timeframe_id,
          context.id::text as context_id, template.definition_hash as template_hash,
          timeframe.definition_hash as timeframe_hash, context.context_hash,
          template.definition_payload as template_payload, timeframe.definition_payload as timeframe_payload,
          context.context_payload
        from analysis_template_definitions template
        join analysis_timeframe_definitions timeframe on timeframe.workspace_id = template.workspace_id
          and timeframe.id = template.timeframe_definition_id
        join effective_campaign_contexts context on context.workspace_id = template.workspace_id and context.id = template.context_id
        join decision_room_runs candidate on candidate.workspace_id = template.workspace_id
          and candidate.id = ${run.id}::uuid and candidate.ad_account_id = template.ad_account_id
          and candidate.campaign_id = template.campaign_id
        where template.workspace_id = ${this.workspaceId}::uuid
          and template.account_ref = ${input.accountRef} and template.campaign_ref = ${input.campaignRef}
          and template.template_ref = ${input.templateRef} and template.superseded_at is null
          and timeframe.timeframe_ref = ${input.timeframeRef}
          and not exists (
            select 1 from effective_campaign_context_components component
            join effective_campaign_context_invalidations invalidation
              on invalidation.workspace_id = component.workspace_id
             and invalidation.component_type = component.component_type
             and invalidation.component_ref = component.component_ref
             and invalidation.component_version = component.component_version
            where component.workspace_id = context.workspace_id and component.context_id = context.id
              and (invalidation.entity_type is null
                or (invalidation.entity_type = context.entity_type and invalidation.entity_ref = context.entity_ref))
          )
        limit 2
      `;
      const candidates = rows<AssetSelection>(await transaction.execute(selectionSql));
      if (candidates.length !== 1) {
        throw new DecisionRoomAnalysisAssetPersistenceError(
          run.trigger_kind === "scheduled" ? "schedule_binding_missing" : "asset_scope_mismatch",
        );
      }
      const assets = runtimeAssets(input, occurredAt, candidates[0]!);
      const assetHash = analysisAssetDefinitionHash({
        runRef: input.runRef, templateHash: candidates[0]!.template_hash,
        timeframeHash: candidates[0]!.timeframe_hash, contextHash: candidates[0]!.context_hash,
        occurredAt, resolvedTimeframe: assets.resolvedTimeframe,
      });
      await transaction.execute(sql`
        insert into decision_room_run_analysis_assets (
          workspace_id, run_id, template_definition_id, timeframe_definition_id,
          context_id, asset_hash, occurred_at, resolved_timeframe
        ) values (
          ${this.workspaceId}::uuid, ${run.id}::uuid, ${candidates[0]!.template_id}::uuid,
          ${candidates[0]!.timeframe_id}::uuid, ${candidates[0]!.context_id}::uuid,
          ${assetHash}, ${occurredAt}::timestamptz, ${JSON.stringify(assets.resolvedTimeframe)}::jsonb
        )
      `);
      return assets;
    });
  }
}

/**
 * Shared production composition for both manual requests and schedule-worker
 * requests. The executor remains advisory-only (`actionAuthority: none`) and
 * has no model, Meta transport, advertising writer or external notifier port.
 */
export function createDrizzleDecisionRoomAnalysisExecutor(input: Readonly<{
  database: PersistenceDatabase;
  workspaceId: string;
  observations: FindingObservationReadPort;
  drafts: DecisionRoomDraftPort;
  now?: () => Date;
}>): DecisionRoomExecutor {
  const workspaceId = workspace(input.workspaceId);
  return new DecisionRoomExecutor(
    new DrizzleDecisionRoomRunStore(input.database, workspaceId),
    new DecisionRoomDeterministicAnalysisRuntime(
      new DrizzleDecisionRoomAnalysisRuntimeAssetLoader(input.database, workspaceId),
      input.observations,
      input.drafts,
    ),
    new DrizzleDecisionRoomInbox(input.database, workspaceId),
    input.now ?? (() => new Date()),
  );
}
