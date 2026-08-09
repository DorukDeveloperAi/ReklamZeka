import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF } from "@/analyses/effective-campaign-context";
import { type InstructionPolicyImpact, type InstructionPolicyImpactOperation,
  type InstructionPolicyImpactRepository, InstructionPolicyImpactRepositoryError } from
  "@/application/instruction-policy-impact-service";
import { assessInstructionPolicyJsonbCatalog, INSTRUCTION_POLICY_DEPENDENCY_MANIFEST_VERSION } from
  "@/domain/policies/instruction-policy-dependency-manifest";
import { assertStrictInstructionPolicyArtifact, type StrictInstructionPolicy } from
  "@/domain/policies/instruction-policy-dsl";
import * as schema from "@/db/schema";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;
type PolicyRow = Readonly<{ policy_ref: unknown; policy_version: unknown; previous_version_hash: unknown;
  status: unknown; canonical_hash: unknown; policy_payload: unknown; recorded_at: unknown }>;
type CountRow = Readonly<Record<"registry_components" | "contexts_needing_invalidation" |
  "already_invalidated_contexts" | "direct_applied_contexts" | "direct_suppressed_contexts" |
  "direct_parked_contexts" | "budget_proposals" | "current_analysis_templates" |
  "superseded_analysis_templates" | "enabled_schedules" | "run_assets" | "decision_ledger_records" |
  "nonterminal_action_units" | "terminal_action_units" | "malformed_context_policies" |
  "unresolved_context_policy_refs" | "inconsistent_context_components" | "corrupt_action_lifecycle_rows" |
  "affected_contexts", unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLICY_REF = /^policy_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROW_CAP = 20_000;

function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function fail(code: InstructionPolicyImpactRepositoryError["code"]): never {
  throw new InstructionPolicyImpactRepositoryError(code);
}
function count(value: unknown): number {
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) fail("corrupt_store"); return parsed;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function project(row: PolicyRow): Readonly<{ policy: StrictInstructionPolicy; recordedAt: string }> {
  let policy: StrictInstructionPolicy;
  try { policy = assertStrictInstructionPolicyArtifact(row.policy_payload); } catch { return fail("corrupt_store"); }
  const recordedAt = String(row.recorded_at); const canonicalHash = String(row.canonical_hash);
  if (policy.policyRef !== row.policy_ref || policy.policyVersion !== Number(row.policy_version)
    || policy.previousVersionHash !== row.previous_version_hash || policy.status !== row.status
    || policy.canonicalHash !== canonicalHash || !HASH.test(canonicalHash)
    || !Number.isFinite(Date.parse(recordedAt))) fail("corrupt_store");
  return Object.freeze({ policy, recordedAt: new Date(recordedAt).toISOString() });
}

export class DrizzleInstructionPolicyImpactRepository implements InstructionPolicyImpactRepository {
  constructor(private readonly database: Database) {}

  async preview(workspaceId: string, policyRef: string,
    operation: InstructionPolicyImpactOperation): Promise<InstructionPolicyImpact | null> {
    if (!UUID.test(workspaceId) || !POLICY_REF.test(policyRef)
      || !(["publish", "pause", "archive"] as const).includes(operation)) fail("invalid_input");
    const active = rows(await this.database.execute(sql`select id from workspaces where id = ${workspaceId}::uuid
      and lifecycle_state = 'active' limit 2`));
    if (active.length !== 1) fail("workspace_scope_mismatch");
    const catalog = assessInstructionPolicyJsonbCatalog(rows(await this.database.execute(sql`
      select class.relname::text as table, attribute.attname::text as column
      from pg_catalog.pg_attribute attribute join pg_catalog.pg_class class on class.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      join pg_catalog.pg_type type on type.oid = attribute.atttypid
      where namespace.nspname = 'public' and class.relkind in ('r', 'p') and attribute.attnum > 0
        and not attribute.attisdropped and type.typname = 'jsonb' order by class.relname, attribute.attname
    `)));
    const history = rows<PolicyRow>(await this.database.execute(sql`
      select policy_ref, policy_version, previous_version_hash, status, canonical_hash, policy_payload, recorded_at
      from strict_instruction_policy_revisions where workspace_id = ${workspaceId}::uuid
      order by policy_ref, policy_version
    `)).map(project);
    if (history.length > ROW_CAP) fail("corrupt_store");
    const latest = new Map<string, typeof history[number]>(); let brokenPolicyRevisionChains = 0;
    for (const revision of history) {
      const previous = latest.get(revision.policy.policyRef);
      if (previous === undefined ? revision.policy.policyVersion !== 1 || revision.policy.previousVersionHash !== null
        : revision.policy.policyVersion !== previous.policy.policyVersion + 1
          || revision.policy.previousVersionHash !== previous.policy.canonicalHash
          || revision.recordedAt < previous.recordedAt) brokenPolicyRevisionChains += 1;
      latest.set(revision.policy.policyRef, revision);
    }
    const current = [...latest.values()].sort((left, right) => left.policy.policyRef.localeCompare(right.policy.policyRef));
    const target = latest.get(policyRef); if (!target) return null;
    const registryHash = digest(current.map((entry) => ({ policyRef: entry.policy.policyRef,
      policyVersion: entry.policy.policyVersion, canonicalHash: entry.policy.canonicalHash, status: entry.policy.status })));
    const knownPolicyRefs = new Set(latest.keys()); let unresolvedExceptionRefs = 0; let currentInboundExceptions = 0;
    let totalInboundExceptions = 0;
    for (const revision of history) {
      if (revision.policy.clause.kind !== "exception") continue;
      for (const ref of revision.policy.clause.policyRefs) if (!knownPolicyRefs.has(ref)) unresolvedExceptionRefs += 1;
      if (!revision.policy.clause.policyRefs.includes(policyRef)) continue;
      totalInboundExceptions += 1;
      if (latest.get(revision.policy.policyRef) === revision
        && (revision.policy.status === "draft" || revision.policy.status === "published")) currentInboundExceptions += 1;
    }
    const dependency = rows<CountRow>(await this.database.execute(sql`
      with policy_contexts as (
        select distinct context.id, context.context_hash, context.context_payload,
          component.component_version = ${registryHash} as current_registry,
          exists (select 1 from jsonb_array_elements(case when jsonb_typeof(context.context_payload->'policies') = 'array'
            then context.context_payload->'policies' else '[]'::jsonb end) item
            where item->>'policyRef' = ${policyRef}) as uses_target,
          exists (select 1 from effective_campaign_context_invalidations invalidation
            where invalidation.workspace_id = component.workspace_id
              and invalidation.component_type = component.component_type
              and invalidation.component_ref = component.component_ref
              and invalidation.component_version = component.component_version
              and (invalidation.entity_type is null or (invalidation.entity_type = context.entity_type
                and invalidation.entity_ref = context.entity_ref))) as invalidated
        from effective_campaign_context_components component
        join effective_campaign_contexts context on context.workspace_id = component.workspace_id
          and context.id = component.context_id
        where component.workspace_id = ${workspaceId}::uuid and component.component_type = 'instruction_policy'
          and component.component_ref = ${EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF}
      ), affected_contexts as (
        select * from policy_contexts where current_registry or uses_target
      ), context_policy_rows as (
        select context.id, context.invalidated, policy.value
        from affected_contexts context
        cross join lateral jsonb_array_elements(case when jsonb_typeof(context.context_payload->'policies') = 'array'
          then context.context_payload->'policies' else '[]'::jsonb end) policy(value)
      ), action_states as (
        select unit.id, unit.context_hash, coalesce(current_event.event_type, 'awaiting_approval') as event_type
        from action_proposal_units unit left join lateral (
          select event.value->>'eventType' as event_type from action_approval_decision_events decision
          cross join lateral jsonb_array_elements(case when jsonb_typeof(decision.event_payloads) = 'array'
            then decision.event_payloads else '[]'::jsonb end) event(value)
          where decision.workspace_id = unit.workspace_id and decision.bundle_id = unit.bundle_id
            and event.value->>'unitRef' = unit.unit_ref order by decision.ordinal desc limit 1
        ) current_event on true where unit.workspace_id = ${workspaceId}::uuid
          and unit.context_hash in (select context_hash from affected_contexts)
      ) select
        (select count(*)::int from effective_campaign_context_components component
          where component.workspace_id = ${workspaceId}::uuid and component.component_type = 'instruction_policy'
            and component.component_ref = ${EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF}
            and component.component_version = ${registryHash}) as registry_components,
        (select count(*)::int from affected_contexts where current_registry and not invalidated) as contexts_needing_invalidation,
        (select count(*)::int from affected_contexts where invalidated) as already_invalidated_contexts,
        (select count(distinct id)::int from context_policy_rows where value->>'policyRef' = ${policyRef}
          and value->>'state' = 'applied') as direct_applied_contexts,
        (select count(distinct id)::int from context_policy_rows where value->>'policyRef' = ${policyRef}
          and value->>'state' = 'suppressed') as direct_suppressed_contexts,
        (select count(distinct id)::int from context_policy_rows where value->>'policyRef' = ${policyRef}
          and value->>'state' = 'parked_conflict') as direct_parked_contexts,
        (select count(*)::int from budget_proposal_versions proposal
          where proposal.workspace_id = ${workspaceId}::uuid and proposal.context_id in (select id from affected_contexts)) as budget_proposals,
        (select count(*)::int from analysis_template_definitions template where template.workspace_id = ${workspaceId}::uuid
          and template.context_id in (select id from affected_contexts) and template.superseded_at is null) as current_analysis_templates,
        (select count(*)::int from analysis_template_definitions template where template.workspace_id = ${workspaceId}::uuid
          and template.context_id in (select id from affected_contexts) and template.superseded_at is not null) as superseded_analysis_templates,
        (select count(distinct schedule.id)::int from decision_room_schedules schedule
          join decision_room_schedule_analysis_bindings binding on binding.workspace_id = schedule.workspace_id
            and binding.schedule_id = schedule.id join analysis_template_definitions template
            on template.workspace_id = binding.workspace_id and template.id = binding.template_definition_id
          where schedule.workspace_id = ${workspaceId}::uuid and schedule.enabled and schedule.superseded_at is null
            and template.context_id in (select id from affected_contexts)) as enabled_schedules,
        (select count(*)::int from decision_room_run_analysis_assets asset where asset.workspace_id = ${workspaceId}::uuid
          and asset.context_id in (select id from affected_contexts)) as run_assets,
        (select count(*)::int from decision_ledger_records ledger where ledger.workspace_id = ${workspaceId}::uuid
          and ledger.effective_context_id in (select id from affected_contexts)) as decision_ledger_records,
        (select count(*)::int from action_states where event_type in ('awaiting_approval', 'unit_approved')) as nonterminal_action_units,
        (select count(*)::int from action_states where event_type in ('unit_rejected', 'unit_changes_requested',
          'unit_expired', 'unit_stale', 'unit_superseded', 'unit_dependency_failed')) as terminal_action_units,
        (select count(*)::int from policy_contexts where jsonb_typeof(context_payload->'policies') is distinct from 'array'
          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(context_payload->'policies') = 'array'
            then context_payload->'policies' else '[]'::jsonb end) item where jsonb_typeof(item) <> 'object'
              or item->>'state' not in ('applied', 'suppressed', 'parked_conflict') or nullif(item->>'policyRef', '') is null
              or nullif(item->>'reason', '') is null)) as malformed_context_policies,
        (select count(*)::int from policy_contexts context cross join lateral jsonb_array_elements(case
          when jsonb_typeof(context.context_payload->'policies') = 'array' then context.context_payload->'policies'
          else '[]'::jsonb end) item(value) where not exists (select 1 from strict_instruction_policy_revisions known
            where known.workspace_id = ${workspaceId}::uuid and known.policy_ref = value->>'policyRef'))
          as unresolved_context_policy_refs,
        (select count(*)::int from effective_campaign_context_components component
          join effective_campaign_contexts context on context.workspace_id = component.workspace_id and context.id = component.context_id
          where component.workspace_id = ${workspaceId}::uuid and component.component_type = 'instruction_policy'
            and (component.component_ref <> ${EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF}
              or context.context_payload #>> '{versions,instructionPolicyRegistry}' is distinct from component.component_version))
          as inconsistent_context_components,
        (select count(*)::int from action_states where event_type not in ('awaiting_approval', 'unit_approved',
          'unit_rejected', 'unit_changes_requested', 'unit_expired', 'unit_stale', 'unit_superseded',
          'unit_dependency_failed')) as corrupt_action_lifecycle_rows,
        (select count(*)::int from affected_contexts) as affected_contexts
    `));
    if (dependency.length !== 1) fail("corrupt_store"); const row = dependency[0]!;
    const exactBlockers = Object.freeze({ currentInboundExceptions,
      enabledSchedules: count(row.enabled_schedules), nonTerminalActionUnits: count(row.nonterminal_action_units) });
    const historicalImpact = Object.freeze({ historicalInboundExceptions: totalInboundExceptions - currentInboundExceptions,
      directAppliedContexts: count(row.direct_applied_contexts), directSuppressedContexts: count(row.direct_suppressed_contexts),
      directParkedContexts: count(row.direct_parked_contexts), alreadyInvalidatedContexts: count(row.already_invalidated_contexts),
      budgetProposals: count(row.budget_proposals), currentAnalysisTemplates: count(row.current_analysis_templates),
      supersededAnalysisTemplates: count(row.superseded_analysis_templates), runAssets: count(row.run_assets),
      decisionLedgerRecords: count(row.decision_ledger_records), terminalActionUnits: count(row.terminal_action_units) });
    const invalidationPlan = Object.freeze({ registryComponents: count(row.registry_components),
      contextsNeedingInvalidation: count(row.contexts_needing_invalidation) });
    const affectedContexts = count(row.affected_contexts);
    const cappedCounts = { ...exactBlockers, ...historicalImpact, ...invalidationPlan };
    const integrity = Object.freeze({ unclassifiedJsonbColumns: catalog.unclassifiedColumns,
      missingManifestJsonbColumns: catalog.missingManifestColumns, brokenPolicyRevisionChains,
      unresolvedExceptionRefs, malformedContextPolicies: count(row.malformed_context_policies)
        + count(row.unresolved_context_policy_refs), inconsistentContextComponents: count(row.inconsistent_context_components),
      corruptActionLifecycleRows: count(row.corrupt_action_lifecycle_rows),
      rowCapExceeded: affectedContexts > ROW_CAP || Object.values(cappedCounts).some((value) => value > ROW_CAP) ? 1 : 0 });
    const coverage = Object.freeze({ complete: false as const,
      manifestVersion: INSTRUCTION_POLICY_DEPENDENCY_MANIFEST_VERSION,
      exactRelational: Object.freeze(["effective_context_components", "budget_proposals", "analysis_templates",
        "decision_room_schedules", "run_analysis_assets", "decision_ledger", "action_proposal_units"]),
      exactContractRef: Object.freeze(["strict_policy_exception_refs", "effective_context_policy_trace"]),
      partialOrUnknown: Object.freeze(["trusted_authority_catalog", "manual_policy_locks",
        "account_group_scope", "topic_scope", "opaque_action_policy_context"]),
      nonAuthoritativeNotes: Object.freeze(["action_context_hash_index_explain_not_verified"]), integrity });
    const targetSummary = Object.freeze({ policyRef: target.policy.policyRef, policyVersion: target.policy.policyVersion,
      policyHash: target.policy.canonicalHash, status: target.policy.status });
    const core = Object.freeze({ operation, registryHash, target: targetSummary, exactBlockers,
      historicalImpact, invalidationPlan, coverage });
    return Object.freeze({ ...core, impactHash: digest(core), disposition: "blocked" as const,
      mutationAllowed: false as const, authority: Object.freeze({ canPublish: false as const, canPause: false as const,
        canArchive: false as const, canApprove: false as const, canExecute: false as const,
        canSchedule: false as const, canCallTool: false as const, canWriteMeta: false as const }) });
  }
}
