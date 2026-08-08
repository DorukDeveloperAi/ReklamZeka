import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CategoryArchiveImpact, CategoryArchiveImpactRepository,
  CategoryArchiveTargetKind } from "@/application/category-archive-impact-service";
import * as schema from "@/db/schema";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;
type DimensionRow = Readonly<{ id: string; key: string; name: string; version: number }>;
type DefinitionRow = Readonly<{ id: string; dimension_id: string; dimension_key: string;
  key: string; label: string; version: number }>;
type ImpactRow = Readonly<Record<
  "active_definitions" | "active_assignments" | "manual_locks" | "guidance_drafts" |
  "guidance_published" | "archived_guidance" | "active_promotion_bindings" |
  "expired_promotion_bindings" | "autonomy_drafts" | "autonomy_published" |
  "guardrail_drafts" | "guardrail_published" | "effective_contexts" |
  "invalidated_contexts" | "budget_proposals" | "component_count" | "contexts_needing_invalidation", unknown>>;

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
function text(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new CategoryArchiveImpactRepositoryError("corrupt_store");
  }
  return value;
}

/** Read-only dependency preview. It never declares archive safe while dependency coverage is partial. */
export class DrizzleCategoryArchiveImpactRepository implements CategoryArchiveImpactRepository {
  constructor(private readonly database: Database) {}

  async preview(workspaceId: string, targetRef: string): Promise<CategoryArchiveImpact | null> {
    const active = rows(await this.database.execute(sql`
      select id from workspaces where id = ${workspaceId}::uuid and lifecycle_state = 'active' limit 2
    `));
    if (active.length !== 1) throw new CategoryArchiveImpactRepositoryError("workspace_scope_mismatch");
    const dimensions = rows<DimensionRow>(await this.database.execute(sql`
      select id::text, key, name, version from category_dimensions
      where workspace_id = ${workspaceId}::uuid and archived_at is null order by key
    `));
    const definitions = rows<DefinitionRow>(await this.database.execute(sql`
      select definition.id::text, definition.dimension_id::text, dimension.key as dimension_key,
        definition.key, definition.label, definition.version
      from category_definitions definition
      join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
        and dimension.id = definition.dimension_id and dimension.archived_at is null
      where definition.workspace_id = ${workspaceId}::uuid and definition.archived_at is null
      order by dimension.key, definition.key
    `));
    const dimension = dimensions.find((item) => categoryDimensionPublicRef(text(item.key, 128)) === targetRef);
    const definition = definitions.find((item) => categoryDefinitionPublicRef(text(item.dimension_key, 128), text(item.key, 128)) === targetRef);
    if (Boolean(dimension) === Boolean(definition)) return null;
    const kind: CategoryArchiveTargetKind = dimension ? "dimension" : "definition";
    const dimensionId = dimension?.id ?? definition!.dimension_id;
    const affectedDefinitions = definition ? [definition] : definitions.filter((item) => item.dimension_id === dimensionId);
    const definitionIds = affectedDefinitions.map((item) => item.id);
    const semanticRefs = affectedDefinitions.map((item) => categoryDefinitionPublicRef(
      text(item.dimension_key, 128), text(item.key, 128)));
    const definitionIdList = definitionIds.length
      ? sql`in (${sql.join(definitionIds.map((id) => sql`${id}`), sql`, `)})` : sql`in (null)`;
    const semanticRefList = semanticRefs.length
      ? sql`in (${sql.join(semanticRefs.map((ref) => sql`${ref}`), sql`, `)})` : sql`in (null)`;
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
          and component.component_ref = ${dimensionId}
          and (${kind} = 'dimension' or exists (
            select 1 from jsonb_array_elements(context.context_payload->'categories') category
            cross join lateral jsonb_array_elements(category->'definitionVersions') definition_version
            where definition_version->>'id' ${definitionIdList}
          ))
      )
      select
        (select count(*)::int from category_definitions definition where definition.workspace_id = ${workspaceId}::uuid
          and definition.dimension_id = ${dimensionId}::uuid and definition.archived_at is null) as active_definitions,
        (select count(*)::int from category_assignments assignment where assignment.workspace_id = ${workspaceId}::uuid
          and assignment.archived_at is null and ((${kind} = 'dimension' and assignment.dimension_id = ${dimensionId}::uuid)
            or (${kind} = 'definition' and assignment.definition_id ${definitionIdList}))) as active_assignments,
        (select count(*)::int from category_assignments assignment where assignment.workspace_id = ${workspaceId}::uuid
          and assignment.archived_at is null and assignment.manual_lock and ((${kind} = 'dimension' and assignment.dimension_id = ${dimensionId}::uuid)
            or (${kind} = 'definition' and assignment.definition_id ${definitionIdList}))) as manual_locks,
        (select count(*)::int from latest_binding binding join latest_card card
          on card.workspace_id = binding.workspace_id and card.card_key = binding.card_key
          where binding.facet = 'internal_category' and binding.value ${semanticRefList}
            and card.status = 'draft') as guidance_drafts,
        (select count(*)::int from latest_binding binding join latest_card card
          on card.workspace_id = binding.workspace_id and card.card_key = binding.card_key
          where binding.facet = 'internal_category' and binding.value ${semanticRefList}
            and card.status = 'published') as guidance_published,
        (select count(*)::int from latest_binding binding join latest_card card
          on card.workspace_id = binding.workspace_id and card.card_key = binding.card_key
          where binding.facet = 'internal_category' and binding.value ${semanticRefList}
            and card.status = 'archived') as archived_guidance,
        (select count(distinct binding.id)::int from promotion_template_binding_categories edge
          join promotion_template_bindings binding on binding.workspace_id = edge.workspace_id and binding.id = edge.binding_id
          where edge.workspace_id = ${workspaceId}::uuid and edge.category_definition_id ${definitionIdList}
            and binding.effective_from <= now() and (binding.expires_at is null or binding.expires_at > now())) as active_promotion_bindings,
        (select count(distinct binding.id)::int from promotion_template_binding_categories edge
          join promotion_template_bindings binding on binding.workspace_id = edge.workspace_id and binding.id = edge.binding_id
          where edge.workspace_id = ${workspaceId}::uuid and edge.category_definition_id ${definitionIdList}
            and binding.expires_at is not null and binding.expires_at <= now()) as expired_promotion_bindings,
        (select count(*)::int from latest_autonomy rule where rule.scope_level = 'internal_category'
          and rule.scope_ref ${semanticRefList} and rule.state = 'draft') as autonomy_drafts,
        (select count(*)::int from latest_autonomy rule where rule.scope_level = 'internal_category'
          and rule.scope_ref ${semanticRefList} and rule.state = 'published'
          and rule.effective_from <= now() and (rule.expires_at is null or rule.expires_at > now())) as autonomy_published,
        (select count(*)::int from latest_guardrail policy where policy.state = 'draft' and exists (
          select 1 from jsonb_array_elements_text(policy.internal_category_refs) ref(value) where value ${semanticRefList})) as guardrail_drafts,
        (select count(*)::int from latest_guardrail policy where policy.state = 'published'
          and policy.effective_from <= now() and (policy.expires_at is null or policy.expires_at > now()) and exists (
          select 1 from jsonb_array_elements_text(policy.internal_category_refs) ref(value) where value ${semanticRefList})) as guardrail_published,
        (select count(*)::int from affected_contexts) as effective_contexts,
        (select count(*)::int from affected_contexts where invalidated) as invalidated_contexts,
        (select count(*)::int from budget_proposal_versions proposal
          where proposal.workspace_id = ${workspaceId}::uuid and proposal.context_id in (select id from affected_contexts)) as budget_proposals,
        (select count(distinct (component_ref, component_version))::int from affected_contexts) as component_count,
        (select count(*)::int from affected_contexts where not invalidated) as contexts_needing_invalidation
    `));
    if (result.length !== 1) throw new CategoryArchiveImpactRepositoryError("corrupt_store");
    const row = result[0]!;
    const exactBlockers = Object.freeze({ activeDefinitions: kind === "dimension" ? count(row.active_definitions) : 0,
      activeAssignments: count(row.active_assignments), manualLocks: count(row.manual_locks),
      guidanceDrafts: count(row.guidance_drafts), guidancePublished: count(row.guidance_published),
      activePromotionBindings: count(row.active_promotion_bindings), autonomyDrafts: count(row.autonomy_drafts),
      autonomyPublished: count(row.autonomy_published), guardrailDrafts: count(row.guardrail_drafts),
      guardrailPublished: count(row.guardrail_published) });
    const blockerTotal = Object.values(exactBlockers).reduce((total, value) => total + value, 0);
    return Object.freeze({ target: Object.freeze({ kind, ref: targetRef,
      label: text(dimension?.name ?? definition!.label), version: dimension?.version ?? definition!.version }),
    exactBlockers, historicalImpact: Object.freeze({ archivedGuidance: count(row.archived_guidance),
      expiredPromotionBindings: count(row.expired_promotion_bindings), effectiveContexts: count(row.effective_contexts),
      alreadyInvalidatedContexts: count(row.invalidated_contexts), budgetProposals: count(row.budget_proposals) }),
    invalidationPlan: Object.freeze({ categoryResolutionComponents: count(row.component_count),
      contextsNeedingInvalidation: count(row.contexts_needing_invalidation) }),
    coverage: Object.freeze({ complete: false as const,
      exactRelational: Object.freeze(["category_assignments", "promotion_template_bindings", "effective_campaign_contexts"]),
      exactContractRef: Object.freeze(["guidance_bindings", "autonomy_rules", "action_guardrail_policies"]),
      partialOrUnknown: Object.freeze(["promotion_template_scopes", "advised_practices", "budget_json_artifacts",
        "action_proposal_payloads", "unclassified_json_artifacts", "legacy_category_ref_families"]) }),
    disposition: blockerTotal > 0 ? "blocked" as const : "review_required" as const,
    archiveAllowed: false as const, authority: Object.freeze({ canArchive: false as const,
      canAssign: false as const, canAuthorizeAction: false as const, canWriteMeta: false as const }) });
  }
}
