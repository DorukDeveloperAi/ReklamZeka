import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CategoryArchiveImpact, CategoryArchiveImpactRepository,
  CategoryArchiveTargetKind } from "@/application/category-archive-impact-service";
import * as schema from "@/db/schema";
import { assessCategoryJsonbCatalog, CATEGORY_DEPENDENCY_MANIFEST_VERSION } from
  "@/domain/categories/category-dependency-manifest";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;
type DimensionRow = Readonly<{ id: unknown; key: unknown; name: unknown; version: unknown; is_active: unknown }>;
type DefinitionRow = Readonly<{ id: unknown; dimension_id: unknown; dimension_key: unknown;
  key: unknown; label: unknown; version: unknown; is_active: unknown; dimension_active: unknown }>;
type CatalogRow = Readonly<{ table: unknown; column: unknown }>;
type ImpactRow = Readonly<Record<
  "active_assignments" | "manual_locks" | "guidance_drafts" | "guidance_published" |
  "archived_guidance" | "active_promotion_bindings" | "expired_promotion_bindings" |
  "active_promotion_template_scopes" | "superseded_promotion_template_scopes" |
  "active_advised_practices" | "retired_advised_practices" | "superseded_advised_practices" |
  "autonomy_drafts" | "autonomy_published" | "guardrail_drafts" | "guardrail_published" |
  "effective_contexts" | "invalidated_contexts" | "budget_proposals" | "component_count" |
  "contexts_needing_invalidation" | "nonterminal_action_units" | "terminal_action_units" |
  "unresolved_category_refs" | "inconsistent_promotion_edges" | "malformed_category_contracts" |
  "corrupt_lifecycle_rows", unknown>>;

export class CategoryArchiveImpactRepositoryError extends Error {
  constructor(readonly code: "workspace_scope_mismatch" | "corrupt_store") {
    super(`Category archive impact rejected: ${code}`); this.name = "CategoryArchiveImpactRepositoryError";
  }
}
function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new CategoryArchiveImpactRepositoryError("corrupt_store");
  }
  return value.rows as readonly T[];
}
function count(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new CategoryArchiveImpactRepositoryError("corrupt_store");
  return parsed;
}
function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new CategoryArchiveImpactRepositoryError("corrupt_store");
  return parsed;
}
function text(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new CategoryArchiveImpactRepositoryError("corrupt_store");
  }
  return value;
}
function bool(value: unknown): boolean {
  if (value !== true && value !== false) throw new CategoryArchiveImpactRepositoryError("corrupt_store");
  return value;
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
function list(values: readonly string[]) {
  return values.length ? sql`in (${sql.join(values.map((value) => sql`${value}`), sql`, `)})`
    : sql`in (select null::text where false)`;
}

/** Read-only dependency preview. Archive authority remains closed even when coverage is complete. */
export class DrizzleCategoryArchiveImpactRepository implements CategoryArchiveImpactRepository {
  constructor(private readonly database: Database) {}

  async preview(workspaceId: string, targetRef: string): Promise<CategoryArchiveImpact | null> {
    const active = rows(await this.database.execute(sql`
      select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 2
    `));
    if (active.length !== 1) throw new CategoryArchiveImpactRepositoryError("workspace_scope_mismatch");

    const catalog = assessCategoryJsonbCatalog(rows<CatalogRow>(await this.database.execute(sql`
      select class.relname::text as table, attribute.attname::text as column
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class class on class.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      join pg_catalog.pg_type type on type.oid = attribute.atttypid
      where namespace.nspname = 'public' and class.relkind in ('r', 'p')
        and attribute.attnum > 0 and not attribute.attisdropped and type.typname = 'jsonb'
      order by class.relname, attribute.attname
    `)));

    const dimensions = rows<DimensionRow>(await this.database.execute(sql`
      select id::text, key, name, version, archived_at is null as is_active
      from category_dimensions where workspace_id = ${workspaceId}::uuid order by key, version
    `)).map((row) => Object.freeze({ id: text(row.id), key: text(row.key, 128), name: text(row.name),
      version: integer(row.version), active: bool(row.is_active) }));
    const definitions = rows<DefinitionRow>(await this.database.execute(sql`
      select definition.id::text, definition.dimension_id::text, dimension.key as dimension_key,
        definition.key, definition.label, definition.version, definition.archived_at is null as is_active,
        dimension.archived_at is null as dimension_active
      from category_definitions definition
      join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
        and dimension.id = definition.dimension_id
      where definition.workspace_id = ${workspaceId}::uuid
      order by dimension.key, definition.key, definition.version
    `)).map((row) => Object.freeze({ id: text(row.id), dimensionId: text(row.dimension_id),
      dimensionKey: text(row.dimension_key, 128), key: text(row.key, 128), label: text(row.label),
      version: integer(row.version), active: bool(row.is_active), dimensionActive: bool(row.dimension_active) }));

    const matchingDimensions = dimensions.filter((item) => item.active && categoryDimensionPublicRef(item.key) === targetRef);
    const matchingDefinitions = definitions.filter((item) => item.active && item.dimensionActive
      && categoryDefinitionPublicRef(item.dimensionKey, item.key) === targetRef);
    if (matchingDimensions.length > 1 || matchingDefinitions.length > 1
      || matchingDimensions.length + matchingDefinitions.length > 1) {
      throw new CategoryArchiveImpactRepositoryError("corrupt_store");
    }
    const dimension = matchingDimensions[0];
    const definition = matchingDefinitions[0];
    if (!dimension && !definition) return null;
    const kind: CategoryArchiveTargetKind = dimension ? "dimension" : "definition";
    const dimensionKey = dimension?.key ?? definition!.dimensionKey;
    const dimensionLineage = dimensions.filter((item) => item.key === dimensionKey);
    const affectedDefinitions = definitions.filter((item) => item.dimensionKey === dimensionKey
      && (kind === "dimension" || item.key === definition!.key));
    const ambiguousLineage = new Set(dimensionLineage.map((item) => item.version)).size !== dimensionLineage.length
      || new Set(affectedDefinitions.map((item) => `${item.key}:${item.version}`)).size !== affectedDefinitions.length ? 1 : 0;
    const definitionIds = affectedDefinitions.map((item) => item.id);
    const dimensionIds = dimensionLineage.map((item) => item.id);
    const semanticRefs = [...new Set(affectedDefinitions.map((item) => categoryDefinitionPublicRef(item.dimensionKey, item.key)))];
    const legacyRefs = affectedDefinitions.map((item) => promotionRegistryPublicRef("category", workspaceId, item.id));
    const dependencyRefs = [...new Set([...semanticRefs, ...legacyRefs])];
    const allKnownRefs = [...new Set(definitions.flatMap((item) => [
      categoryDefinitionPublicRef(item.dimensionKey, item.key), promotionRegistryPublicRef("category", workspaceId, item.id),
    ]))];
    const definitionIdList = list(definitionIds);
    const dimensionIdList = list(dimensionIds);
    const dependencyRefList = list(dependencyRefs);
    const allKnownRefList = list(allKnownRefs);
    const validPromotionEdge = definitions.length === 0 ? sql`false` : sql.join(definitions.map((item) => sql`(
      edge.category_definition_id = ${item.id}::uuid and edge.category_ref in (
        ${categoryDefinitionPublicRef(item.dimensionKey, item.key)},
        ${promotionRegistryPublicRef("category", workspaceId, item.id)}
      )
    )`), sql` or `);

    const result = rows<ImpactRow>(await this.database.execute(sql`
      with latest_binding as (
        select distinct on (binding_key) workspace_id, binding_key, card_key, facet, value
        from guidance_bindings where workspace_id = ${workspaceId}::uuid
        order by binding_key, version desc
      ), latest_card as (
        select distinct on (card_key) workspace_id, card_key, status
        from guidance_cards where workspace_id = ${workspaceId}::uuid
        order by card_key, version desc
      ), latest_autonomy as (
        select distinct on (rule_ref) scope_level, scope_ref, state, effective_from, expires_at
        from autonomy_rule_revisions where workspace_id = ${workspaceId}::uuid
        order by rule_ref, revision desc
      ), latest_guardrail as (
        select distinct on (policy_ref) state, effective_from, expires_at, internal_category_refs
        from action_guardrail_policy_revisions where workspace_id = ${workspaceId}::uuid
        order by policy_ref, revision desc
      ), ranked_templates as (
        select id, template_ref, revision, payload,
          row_number() over (partition by template_ref order by revision desc) as rank
        from promotion_template_revisions where workspace_id = ${workspaceId}::uuid
      ), ranked_practices as (
        select id, practice_ref, version, payload,
          row_number() over (partition by practice_ref order by version desc) as rank
        from advised_practice_definitions where workspace_id = ${workspaceId}::uuid
      ), latest_practice_events as (
        select distinct on (definition_id) definition_id, event_type, sequence
        from advised_practice_events where workspace_id = ${workspaceId}::uuid
        order by definition_id, sequence desc
      ), action_states as (
        select unit.id, coalesce(current_event.event_type, 'awaiting_approval') as event_type
        from action_proposal_units unit
        left join lateral (
          select event.value ->> 'eventType' as event_type
          from action_approval_decision_events decision
          cross join lateral jsonb_array_elements(case when jsonb_typeof(decision.event_payloads) = 'array'
            then decision.event_payloads else '[]'::jsonb end) event(value)
          where decision.workspace_id = unit.workspace_id and decision.bundle_id = unit.bundle_id
            and event.value ->> 'unitRef' = unit.unit_ref
          order by decision.ordinal desc limit 1
        ) current_event on true
        where unit.workspace_id = ${workspaceId}::uuid
      ), affected_contexts as (
        select distinct context.id, context.context_hash, component.component_ref, component.component_version,
          exists (select 1 from effective_campaign_context_invalidations invalidation
            where invalidation.workspace_id = component.workspace_id
              and invalidation.component_type = component.component_type
              and invalidation.component_ref = component.component_ref
              and invalidation.component_version = component.component_version) as invalidated
        from effective_campaign_context_components component
        join effective_campaign_contexts context on context.workspace_id = component.workspace_id
          and context.id = component.context_id
        where component.workspace_id = ${workspaceId}::uuid and component.component_type = 'category_resolution'
          and component.component_ref ${dimensionIdList}
          and (${kind} = 'dimension' or exists (
            select 1 from jsonb_array_elements(case when jsonb_typeof(context.context_payload->'categories') = 'array'
              then context.context_payload->'categories' else '[]'::jsonb end) category
            cross join lateral jsonb_array_elements(case when jsonb_typeof(category->'definitionVersions') = 'array'
              then category->'definitionVersions' else '[]'::jsonb end) definition_version
            where definition_version->>'id' ${definitionIdList}
          ))
      ), direct_budget_proposals as (
        select distinct proposal.id
        from budget_proposal_versions proposal
        left join budget_proposal_alternatives alternative on alternative.workspace_id = proposal.workspace_id
          and alternative.proposal_id = proposal.id
        where proposal.workspace_id = ${workspaceId}::uuid and (
          proposal.context_id in (select id from affected_contexts)
          or exists (select 1 from jsonb_path_query(proposal.proposal_payload, 'lax $.**') value
            where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList})
          or exists (select 1 from jsonb_path_query(alternative.alternative_payload, 'lax $.**') value
            where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList})
        )
      ), contract_refs as (
        select 'guidance'::text as source, value::text from latest_binding where facet = 'internal_category'
        union all select 'autonomy', scope_ref from latest_autonomy where scope_level = 'internal_category'
        union all select 'guardrail', value #>> '{}' from latest_guardrail,
          lateral jsonb_path_query(internal_category_refs, 'lax $[*]') value where jsonb_typeof(value) = 'string'
        union all select 'promotion_template', value #>> '{}' from ranked_templates,
          lateral jsonb_path_query(payload->'internalCategoryRefs', 'lax $[*]') value where jsonb_typeof(value) = 'string'
        union all select 'promotion_binding', value #>> '{}' from promotion_template_bindings binding,
          lateral jsonb_path_query(binding.payload->'internalCategoryRefs', 'lax $[*]') value
          where binding.workspace_id = ${workspaceId}::uuid and jsonb_typeof(value) = 'string'
        union all select 'advised_practice', value #>> '{}' from ranked_practices,
          lateral jsonb_path_query(payload #> '{scope,internalCategoryRefs}', 'lax $[*]') value
          where jsonb_typeof(value) = 'string'
        union all select 'budget', value #>> '{}' from budget_proposal_versions proposal,
          lateral jsonb_path_query(proposal.proposal_payload, 'lax $.**.categoryRef') value
          where proposal.workspace_id = ${workspaceId}::uuid and jsonb_typeof(value) = 'string'
        union all select 'budget', value #>> '{}' from budget_proposal_versions proposal,
          lateral jsonb_path_query(proposal.proposal_payload, 'lax $.**.categoryRefs[*]') value
          where proposal.workspace_id = ${workspaceId}::uuid and jsonb_typeof(value) = 'string'
        union all select 'budget_alternative', value #>> '{}' from budget_proposal_alternatives alternative,
          lateral jsonb_path_query(alternative.alternative_payload, 'lax $.**.categoryRef') value
          where alternative.workspace_id = ${workspaceId}::uuid and jsonb_typeof(value) = 'string'
        union all select 'budget_alternative', value #>> '{}' from budget_proposal_alternatives alternative,
          lateral jsonb_path_query(alternative.alternative_payload, 'lax $.**.categoryRefs[*]') value
          where alternative.workspace_id = ${workspaceId}::uuid and jsonb_typeof(value) = 'string'
      )
      select
        (select count(*)::int from category_assignments assignment where assignment.workspace_id = ${workspaceId}::uuid
          and assignment.archived_at is null and ((${kind} = 'dimension' and assignment.dimension_id ${dimensionIdList})
            or (${kind} = 'definition' and assignment.definition_id ${definitionIdList}))) as active_assignments,
        (select count(*)::int from category_assignments assignment where assignment.workspace_id = ${workspaceId}::uuid
          and assignment.archived_at is null and assignment.manual_lock and ((${kind} = 'dimension' and assignment.dimension_id ${dimensionIdList})
            or (${kind} = 'definition' and assignment.definition_id ${definitionIdList}))) as manual_locks,
        (select count(*)::int from latest_binding binding join latest_card card
          on card.workspace_id = binding.workspace_id and card.card_key = binding.card_key
          where binding.facet = 'internal_category' and binding.value ${dependencyRefList}
            and card.status = 'draft') as guidance_drafts,
        (select count(*)::int from latest_binding binding join latest_card card
          on card.workspace_id = binding.workspace_id and card.card_key = binding.card_key
          where binding.facet = 'internal_category' and binding.value ${dependencyRefList}
            and card.status = 'published') as guidance_published,
        (select count(*)::int from latest_binding binding join latest_card card
          on card.workspace_id = binding.workspace_id and card.card_key = binding.card_key
          where binding.facet = 'internal_category' and binding.value ${dependencyRefList}
            and card.status = 'archived') as archived_guidance,
        (select count(distinct binding.id)::int from promotion_template_binding_categories edge
          join promotion_template_bindings binding on binding.workspace_id = edge.workspace_id and binding.id = edge.binding_id
          where edge.workspace_id = ${workspaceId}::uuid and edge.category_definition_id ${definitionIdList}
            and binding.effective_from <= now() and (binding.expires_at is null or binding.expires_at > now())) as active_promotion_bindings,
        (select count(distinct binding.id)::int from promotion_template_binding_categories edge
          join promotion_template_bindings binding on binding.workspace_id = edge.workspace_id and binding.id = edge.binding_id
          where edge.workspace_id = ${workspaceId}::uuid and edge.category_definition_id ${definitionIdList}
            and binding.expires_at is not null and binding.expires_at <= now()) as expired_promotion_bindings,
        (select count(*)::int from ranked_templates template where rank = 1 and exists (
          select 1 from jsonb_path_query(template.payload->'internalCategoryRefs', 'lax $[*]') value
          where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList}
        )) as active_promotion_template_scopes,
        (select count(*)::int from ranked_templates template where rank > 1 and exists (
          select 1 from jsonb_path_query(template.payload->'internalCategoryRefs', 'lax $[*]') value
          where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList}
        )) as superseded_promotion_template_scopes,
        (select count(*)::int from ranked_practices practice left join latest_practice_events event on event.definition_id = practice.id
          where practice.rank = 1 and coalesce(event.event_type, 'candidate_created') <> 'retired' and exists (
            select 1 from jsonb_path_query(practice.payload #> '{scope,internalCategoryRefs}', 'lax $[*]') value
            where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList}
          )) as active_advised_practices,
        (select count(*)::int from ranked_practices practice join latest_practice_events event on event.definition_id = practice.id
          where practice.rank = 1 and event.event_type = 'retired' and exists (
            select 1 from jsonb_path_query(practice.payload #> '{scope,internalCategoryRefs}', 'lax $[*]') value
            where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList}
          )) as retired_advised_practices,
        (select count(*)::int from ranked_practices practice where practice.rank > 1 and exists (
          select 1 from jsonb_path_query(practice.payload #> '{scope,internalCategoryRefs}', 'lax $[*]') value
          where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList}
        )) as superseded_advised_practices,
        (select count(*)::int from latest_autonomy rule where rule.scope_level = 'internal_category'
          and rule.scope_ref ${dependencyRefList} and rule.state = 'draft') as autonomy_drafts,
        (select count(*)::int from latest_autonomy rule where rule.scope_level = 'internal_category'
          and rule.scope_ref ${dependencyRefList} and rule.state = 'published'
          and rule.effective_from <= now() and (rule.expires_at is null or rule.expires_at > now())) as autonomy_published,
        (select count(*)::int from latest_guardrail policy where policy.state = 'draft' and exists (
          select 1 from jsonb_path_query(policy.internal_category_refs, 'lax $[*]') value
          where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList})) as guardrail_drafts,
        (select count(*)::int from latest_guardrail policy where policy.state = 'published'
          and policy.effective_from <= now() and (policy.expires_at is null or policy.expires_at > now()) and exists (
          select 1 from jsonb_path_query(policy.internal_category_refs, 'lax $[*]') value
          where jsonb_typeof(value) = 'string' and value #>> '{}' ${dependencyRefList})) as guardrail_published,
        (select count(*)::int from affected_contexts) as effective_contexts,
        (select count(*)::int from affected_contexts where invalidated) as invalidated_contexts,
        (select count(*)::int from direct_budget_proposals) as budget_proposals,
        (select count(distinct (component_ref, component_version))::int from affected_contexts) as component_count,
        (select count(*)::int from affected_contexts where not invalidated) as contexts_needing_invalidation,
        (select count(*)::int from action_states where event_type in ('awaiting_approval', 'unit_approved')) as nonterminal_action_units,
        (select count(*)::int from action_states where event_type in (
          'unit_rejected', 'unit_changes_requested', 'unit_expired', 'unit_stale', 'unit_superseded', 'unit_dependency_failed'
        )) as terminal_action_units,
        (select count(*)::int from contract_refs where value is null or not (value ${allKnownRefList})) as unresolved_category_refs,
        ((select count(*)::int from promotion_template_binding_categories edge
          where edge.workspace_id = ${workspaceId}::uuid and not (${validPromotionEdge}))
          + (select count(*)::int from promotion_template_bindings binding where binding.workspace_id = ${workspaceId}::uuid
            and (jsonb_typeof(binding.payload->'internalCategoryRefs') <> 'array'
              or exists (select 1 from jsonb_path_query(binding.payload->'internalCategoryRefs', 'lax $[*]') value
                where jsonb_typeof(value) <> 'string')
              or exists (select 1 from promotion_template_binding_categories edge
                where edge.workspace_id = binding.workspace_id and edge.binding_id = binding.id
                  and not (binding.payload->'internalCategoryRefs' @> jsonb_build_array(edge.category_ref)))
              or exists (select 1 from jsonb_path_query(binding.payload->'internalCategoryRefs', 'lax $[*]') value
                where jsonb_typeof(value) = 'string' and not exists (
                  select 1 from promotion_template_binding_categories edge
                  where edge.workspace_id = binding.workspace_id and edge.binding_id = binding.id
                    and edge.category_ref = value #>> '{}'))))) as inconsistent_promotion_edges,
        ((select count(*)::int from ranked_templates template
            where jsonb_typeof(template.payload->'internalCategoryRefs') is distinct from 'array'
              or exists (select 1 from jsonb_path_query(template.payload->'internalCategoryRefs', 'lax $[*]') value
                where jsonb_typeof(value) <> 'string'))
          + (select count(*)::int from ranked_practices practice
            where jsonb_typeof(practice.payload #> '{scope,internalCategoryRefs}') is distinct from 'array'
              or exists (select 1 from jsonb_path_query(practice.payload #> '{scope,internalCategoryRefs}', 'lax $[*]') value
                where jsonb_typeof(value) <> 'string'))) as malformed_category_contracts,
        ((select count(*)::int from ranked_practices practice left join latest_practice_events event
            on event.definition_id = practice.id where practice.rank = 1 and event.definition_id is null)
          + (select count(*)::int from (select definition_id from advised_practice_events
              where workspace_id = ${workspaceId}::uuid group by definition_id
              having min(sequence) <> 1 or max(sequence) <> count(*)) broken_practice_chain)
          + (select count(*)::int from advised_practice_events event where event.workspace_id = ${workspaceId}::uuid
            and (event.sequence < 1 or event.payload->>'eventType' is distinct from event.event_type
              or event.payload->>'practiceRef' is distinct from event.practice_ref))
          + (select count(*)::int from action_states where event_type not in (
              'awaiting_approval', 'unit_approved', 'unit_rejected', 'unit_changes_requested', 'unit_expired',
              'unit_stale', 'unit_superseded', 'unit_dependency_failed'))) as corrupt_lifecycle_rows
    `));
    if (result.length !== 1) throw new CategoryArchiveImpactRepositoryError("corrupt_store");
    const row = result[0]!;
    const exactBlockers = Object.freeze({
      activeDefinitions: kind === "dimension" ? definitions.filter((item) => item.active && item.dimensionActive
        && item.dimensionKey === dimensionKey).length : 0,
      activeAssignments: count(row.active_assignments), manualLocks: count(row.manual_locks),
      guidanceDrafts: count(row.guidance_drafts), guidancePublished: count(row.guidance_published),
      activePromotionBindings: count(row.active_promotion_bindings),
      activePromotionTemplateScopes: count(row.active_promotion_template_scopes),
      activeAdvisedPractices: count(row.active_advised_practices), autonomyDrafts: count(row.autonomy_drafts),
      autonomyPublished: count(row.autonomy_published), guardrailDrafts: count(row.guardrail_drafts),
      guardrailPublished: count(row.guardrail_published),
    });
    const conservativeBlockers = Object.freeze({ nonTerminalActionProposalUnits: count(row.nonterminal_action_units) });
    const historicalImpact = Object.freeze({ archivedGuidance: count(row.archived_guidance),
      expiredPromotionBindings: count(row.expired_promotion_bindings),
      supersededPromotionTemplateScopes: count(row.superseded_promotion_template_scopes),
      retiredAdvisedPractices: count(row.retired_advised_practices),
      supersededAdvisedPractices: count(row.superseded_advised_practices),
      effectiveContexts: count(row.effective_contexts), alreadyInvalidatedContexts: count(row.invalidated_contexts),
      budgetProposals: count(row.budget_proposals), terminalActionProposalUnits: count(row.terminal_action_units) });
    const invalidationPlan = Object.freeze({ categoryResolutionComponents: count(row.component_count),
      contextsNeedingInvalidation: count(row.contexts_needing_invalidation) });
    const integrity = Object.freeze({ unclassifiedJsonbColumns: catalog.unclassifiedColumns,
      missingManifestJsonbColumns: catalog.missingManifestColumns,
      unresolvedCategoryRefs: count(row.unresolved_category_refs),
      inconsistentPromotionEdges: count(row.inconsistent_promotion_edges),
      malformedCategoryContracts: count(row.malformed_category_contracts),
      corruptLifecycleRows: count(row.corrupt_lifecycle_rows), ambiguousLineage });
    const coverage = Object.freeze({ complete: Object.values(integrity).every((value) => value === 0),
      precision: "exact_with_conservative_action_queue" as const,
      manifestVersion: CATEGORY_DEPENDENCY_MANIFEST_VERSION,
      exactRelational: Object.freeze(["category_assignments", "promotion_template_bindings", "effective_campaign_contexts"]),
      exactContractRef: Object.freeze(["guidance_bindings", "autonomy_rules", "action_guardrail_policies",
        "promotion_template_scopes", "advised_practices", "budget_json_artifacts", "legacy_category_ref_families"]),
      conservative: Object.freeze(["action_proposal_payloads"]), partialOrUnknown: Object.freeze([]), integrity });
    const target = Object.freeze({ kind, ref: targetRef, label: dimension?.name ?? definition!.label,
      version: dimension?.version ?? definition!.version });
    const impactCore = Object.freeze({ target, exactBlockers, conservativeBlockers, historicalImpact,
      invalidationPlan, coverage });
    const impactHash = digest(impactCore);
    const blockerTotal = [...Object.values(exactBlockers), ...Object.values(conservativeBlockers)]
      .reduce((total, value) => total + value, 0);
    return Object.freeze({ ...impactCore, impactHash,
      disposition: blockerTotal > 0 || !coverage.complete ? "blocked" as const : "review_required" as const,
      archiveAllowed: false as const, authority: Object.freeze({ canArchive: false as const,
        canAssign: false as const, canAuthorizeAction: false as const, canWriteMeta: false as const }) });
  }
}
