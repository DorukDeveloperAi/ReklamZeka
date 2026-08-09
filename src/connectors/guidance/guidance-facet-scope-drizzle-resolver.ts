import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  GUIDANCE_FACET_SCOPE_CATALOG_VERSION,
  GuidanceFacetScopeError,
  type GuidanceFacetCatalog,
  type GuidanceFacetCatalogEntry,
  type GuidanceFacetCatalogOption,
  type GuidanceFacetName,
  type GuidanceFacetScopeResolver,
  type GuidanceFacetScopeSelection,
  type ResolvedGuidanceFacetScope,
} from "@/application/guidance-facet-scope-resolver";
import { categoryDefinitionPublicRef, categoryEntityPublicRef } from "@/domain/categories/public-reference";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import { currentPromotionTemplateAuthoringHeadSql } from
  "@/connectors/meta/promotion/promotion-template-authoring-active-sql";
import * as schema from "@/db/schema";
import { META_OBJECTIVE_MAPPING_VERSION } from "@/domain/meta/objective-mapping";
import type { GuidanceEntityType } from "@/domain/guidance/registry";

type Database = NodePgDatabase<typeof schema>;
type ScopeDatabase = Pick<Database, "execute">;

type CandidateRow = Readonly<{
  captured_at: Date | string;
  facet: Exclude<GuidanceFacetName, "global" | "account_group"> | "_capture";
  internal_id: string;
  canonical_value: string;
  label: string;
  account_id: string | null;
  entity_type: GuidanceEntityType | null;
  dimension_key: string | null;
  definition_key: string | null;
}>;

type Candidate = Readonly<{
  facet: Exclude<CandidateRow["facet"], "_capture">;
  authorityKey: string;
  ref: string;
  value: string;
  label: string;
  accountRef: string | null;
  entityType: GuidanceEntityType | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_CAPTURE_ROWS = 5_000;
const FACETS = Object.freeze([
  "global", "account_group", "account", "objective", "funnel", "optimization", "internal_category",
  "lifecycle", "entity", "promotion_template", "topic",
] as const satisfies readonly GuidanceFacetName[]);

function fail(code: GuidanceFacetScopeError["code"]): never { throw new GuidanceFacetScopeError(code); }

function rows(result: unknown): readonly CandidateRow[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("unsafe_source");
  return result.rows as readonly CandidateRow[];
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Opaque alias for authoritative tenant values which do not already own a public ref. */
export function guidanceFacetPublicRef(
  facet: "objective" | "optimization" | "topic",
  workspaceId: string,
  value: string,
): string {
  if (!UUID.test(workspaceId) || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("invalid_input");
  }
  return `${facet}_${createHash("sha256").update(`${facet}\0${workspaceId.toLowerCase()}\0${value}`)
    .digest("hex").slice(0, 24)}`;
}

function safeLabel(value: unknown): string {
  if (typeof value !== "string") fail("unsafe_source");
  const label = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  if (!label || label.length > 160 || /(?:access[_-]?token|secret|authorization|bearer\s|rzs1\.)/i.test(label)) {
    fail("unsafe_source");
  }
  return [...label].slice(0, 120).join("");
}

function candidate(row: CandidateRow, workspaceId: string): Candidate {
  if (row.facet === "_capture") fail("unsafe_source");
  if (!UUID.test(row.internal_id) || row.account_id !== null && !UUID.test(row.account_id)
    || !REF.test(row.canonical_value) && ["account", "entity", "promotion_template"]
      .includes(row.facet)) fail("unsafe_source");
  const accountRef = row.account_id === null ? null : promotionRegistryPublicRef("account", workspaceId, row.account_id);
  let ref: string;
  let value = row.canonical_value;
  if (row.facet === "account") {
    ref = promotionRegistryPublicRef("account", workspaceId, row.internal_id); value = ref;
  } else if (row.facet === "objective" || row.facet === "optimization" || row.facet === "topic") {
    ref = guidanceFacetPublicRef(row.facet, workspaceId, row.canonical_value);
  } else if (row.facet === "internal_category" || row.facet === "funnel" || row.facet === "lifecycle") {
    if (!row.dimension_key || !row.definition_key) fail("unsafe_source");
    ref = categoryDefinitionPublicRef(row.dimension_key, row.definition_key);
    if (row.facet === "internal_category") value = ref;
  } else if (row.facet === "promotion_template") {
    ref = row.canonical_value;
  } else if (row.facet === "entity") {
    if (!row.entity_type) fail("unsafe_source");
    ref = row.entity_type === "campaign" ? promotionRegistryPublicRef("campaign", workspaceId, row.internal_id)
      : row.entity_type === "ad_set" ? promotionRegistryPublicRef("adset", workspaceId, row.internal_id)
        : row.entity_type === "post" ? promotionRegistryPublicRef("post", workspaceId, row.internal_id)
          : categoryEntityPublicRef(workspaceId, row.entity_type, row.internal_id);
    value = ref;
  } else fail("unsafe_source");
  if (!REF.test(ref) || !value.trim() || value.length > 128) fail("unsafe_source");
  const authorityKey = row.facet === "objective" || row.facet === "optimization"
    ? `${row.account_id}\0${row.canonical_value}` : row.facet === "topic" ? row.canonical_value : row.internal_id;
  return Object.freeze({ facet: row.facet, authorityKey, ref, value, label: safeLabel(row.label), accountRef,
    entityType: row.entity_type });
}

function uniqueCandidates(values: readonly Candidate[]): readonly Candidate[] {
  const keyed = new Map<string, Candidate>();
  for (const value of values) {
    const key = `${value.facet}\0${value.authorityKey}\0${value.ref}\0${value.value}\0${value.accountRef ?? ""}\0${value.entityType ?? ""}`;
    keyed.set(key, value);
  }
  return Object.freeze([...keyed.values()].sort((left, right) => left.facet.localeCompare(right.facet, "en")
    || left.ref.localeCompare(right.ref, "en") || (left.accountRef ?? "").localeCompare(right.accountRef ?? "", "en")));
}

function exactOne(values: readonly Candidate[], facet: Candidate["facet"], ref: string,
  accountRef: string | null = null, entityType: GuidanceEntityType | null = null): Candidate {
  const matches = values.filter((value) => value.facet === facet && value.ref === ref
    && (accountRef === null || value.accountRef === null || value.accountRef === accountRef)
    && (entityType === null || value.entityType === entityType));
  if (matches.length === 0) fail("unknown_scope_ref");
  const identities = new Set(matches.map((value) => `${value.authorityKey}\0${value.value}\0${value.entityType ?? ""}`));
  if (identities.size !== 1) fail("ambiguous_scope_ref");
  return matches[0]!;
}

function exactMany(values: readonly Candidate[], facet: Candidate["facet"], refs: readonly string[],
  accountRef: string | null = null): readonly Candidate[] {
  return Object.freeze(refs.map((ref) => exactOne(values, facet, ref, accountRef)));
}

function catalog(capturedAt: string, candidates: readonly Candidate[]): GuidanceFacetCatalog {
  const facets = FACETS.map((facet): GuidanceFacetCatalogEntry => {
    if (facet === "account_group") return Object.freeze({ facet, status: "partial" as const,
      reasonCode: "account_group_catalog_unavailable" as const, options: Object.freeze([]) });
    const options = facet === "global" ? [] : candidates.filter((candidate) => candidate.facet === facet)
      .map((candidate): GuidanceFacetCatalogOption => Object.freeze({ ref: candidate.ref, label: candidate.label,
        accountRefs: Object.freeze(candidate.accountRef === null ? [] : [candidate.accountRef]),
        entityType: candidate.entityType }));
    const merged = new Map<string, GuidanceFacetCatalogOption>();
    for (const option of options) {
      const key = `${option.ref}\0${option.entityType ?? ""}`; const prior = merged.get(key);
      merged.set(key, Object.freeze({ ...option, accountRefs: Object.freeze([...new Set([
        ...(prior?.accountRefs ?? []), ...option.accountRefs,
      ])].sort()) }));
    }
    return Object.freeze({ facet, status: "available" as const, reasonCode: "authoritative_catalog" as const,
      options: Object.freeze([...merged.values()].sort((left, right) => left.ref.localeCompare(right.ref, "en"))) });
  });
  const content = Object.freeze({ version: GUIDANCE_FACET_SCOPE_CATALOG_VERSION,
    evidence: Object.freeze({ objectiveMappingVersion: META_OBJECTIVE_MAPPING_VERSION }),
    facets: Object.freeze(facets) });
  return Object.freeze({ ...content, capturedAt, catalogHash: digest(content) });
}

export class DrizzleGuidanceFacetScopeResolver implements GuidanceFacetScopeResolver {
  constructor(private readonly database: ScopeDatabase) {}

  private async capture(workspaceId: string): Promise<Readonly<{
    capturedAt: string; candidates: readonly Candidate[]; catalog: GuidanceFacetCatalog;
  }>> {
    if (!UUID.test(workspaceId)) fail("invalid_input");
    let result: unknown;
    try {
      result = await this.database.execute(sql`
        with capture as (select transaction_timestamp() as captured_at),
        candidates as (
          select 'account'::text as facet, account.id::text as internal_id,
            ('account_' || account.id::text) as canonical_value, account.name as label,
            account.id::text as account_id, null::text as entity_type,
            null::text as dimension_key, null::text as definition_key
          from ad_accounts account
          join data_sources source on source.workspace_id = account.workspace_id and source.id = account.data_source_id
          join meta_connections connection on connection.workspace_id = source.workspace_id
            and connection.id = source.meta_connection_id
          where account.workspace_id = ${workspaceId}::uuid and account.disappeared_at is null
            and connection.status = 'active' and connection.revoked_at is null and connection.disconnected_at is null
          union all
          select 'objective', campaign.id::text, campaign.canonical_objective, campaign.objective_source,
            campaign.ad_account_id::text, null, null, null
          from ad_campaigns campaign
          where campaign.workspace_id = ${workspaceId}::uuid and campaign.disappeared_at is null
            and campaign.objective_source is not null and campaign.canonical_objective is not null
            and campaign.objective_mapping_version = ${META_OBJECTIVE_MAPPING_VERSION}
          union all
          select 'optimization', ad_set.id::text, ad_set.optimization_goal, ad_set.optimization_goal,
            ad_set.ad_account_id::text, null, null, null
          from meta_ad_sets ad_set
          where ad_set.workspace_id = ${workspaceId}::uuid and ad_set.disappeared_at is null
            and ad_set.optimization_goal is not null
          union all
          select 'internal_category',
            definition.id::text, definition.key, definition.label, null, null,
            dimension.key, definition.key
          from category_definitions definition
          join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
            and dimension.id = definition.dimension_id
          where definition.workspace_id = ${workspaceId}::uuid
            and definition.archived_at is null and dimension.archived_at is null
          union all
          select case when dimension.key = 'funnel_intent' then 'funnel' else 'lifecycle' end,
            definition.id::text, definition.key, definition.label, null, null,
            dimension.key, definition.key
          from category_definitions definition
          join category_dimensions dimension on dimension.workspace_id = definition.workspace_id
            and dimension.id = definition.dimension_id
          where definition.workspace_id = ${workspaceId}::uuid
            and definition.archived_at is null and dimension.archived_at is null
            and dimension.key in ('funnel_intent', 'lifecycle')
          union all
          select 'entity', campaign.id::text, ('campaign_' || campaign.id::text), campaign.name,
            campaign.ad_account_id::text, 'campaign', null, null
          from ad_campaigns campaign
          where campaign.workspace_id = ${workspaceId}::uuid and campaign.disappeared_at is null
          union all
          select 'entity', ad_set.id::text, ('adset_' || ad_set.id::text), ad_set.name,
            ad_set.ad_account_id::text, 'ad_set', null, null
          from meta_ad_sets ad_set
          where ad_set.workspace_id = ${workspaceId}::uuid and ad_set.disappeared_at is null
          union all
          select 'entity', ad.id::text, ('ad_' || ad.id::text), ad.name,
            ad.ad_account_id::text, 'ad', null, null
          from meta_ads ad
          where ad.workspace_id = ${workspaceId}::uuid and ad.disappeared_at is null
          union all
          select 'entity', creative.id::text, ('creative_' || creative.id::text),
            coalesce(creative.name, 'Creative'), creative.ad_account_id::text, 'creative', null, null
          from meta_creatives creative
          where creative.workspace_id = ${workspaceId}::uuid and creative.disappeared_at is null
          union all
          select 'entity', post.id::text, ('post_' || post.id::text), coalesce(actor.display_name, actor.username, 'Post'),
            creative.ad_account_id::text, 'post', null, null
          from meta_posts post
          join meta_creatives creative on creative.workspace_id = post.workspace_id and creative.post_id = post.id
            and creative.disappeared_at is null
          join meta_assets actor on actor.workspace_id = post.workspace_id and actor.id = post.actor_asset_id
          where post.workspace_id = ${workspaceId}::uuid and post.disappeared_at is null
          union all
          select 'promotion_template', template.id::text, template.template_ref, template.template_ref,
            binding.ad_account_id::text, null, null, null
          from promotion_template_revisions template
          join promotion_template_bindings binding on binding.workspace_id = template.workspace_id
            and binding.template_revision_id = template.id
          where template.workspace_id = ${workspaceId}::uuid and template.state = 'published'
            and binding.effective_from <= current_timestamp
            and (binding.expires_at is null or binding.expires_at > current_timestamp)
            and ${currentPromotionTemplateAuthoringHeadSql}
          union all
          select 'topic', card.id::text, card.topic, card.topic, null, null, null, null
          from guidance_cards card
          where card.workspace_id = ${workspaceId}::uuid and card.status = 'published'
            and not exists (select 1 from guidance_cards newer where newer.workspace_id = card.workspace_id
              and newer.card_key = card.card_key and newer.version > card.version)
          union all
          select 'topic', binding.id::text, binding.value, binding.value, null, null, null, null
          from guidance_bindings binding
          join guidance_cards card on card.workspace_id = binding.workspace_id and card.card_key = binding.card_key
          where binding.workspace_id = ${workspaceId}::uuid and binding.facet = 'topic' and binding.value is not null
            and card.status = 'published'
            and not exists (select 1 from guidance_cards newer_card where newer_card.workspace_id = card.workspace_id
              and newer_card.card_key = card.card_key and newer_card.version > card.version)
            and not exists (select 1 from guidance_bindings newer_binding
              where newer_binding.workspace_id = binding.workspace_id
                and newer_binding.binding_key = binding.binding_key and newer_binding.version > binding.version)
        )
        select captured_at, '_capture' as facet,
          '00000000-0000-4000-8000-000000000000' as internal_id,
          'capture_ref' as canonical_value, 'capture' as label,
          null::text as account_id, null::text as entity_type,
          null::text as dimension_key, null::text as definition_key
        from capture
        union all
        select capture.captured_at, candidate.facet, candidate.internal_id, candidate.canonical_value,
          candidate.label, candidate.account_id, candidate.entity_type, candidate.dimension_key, candidate.definition_key
        from capture
        cross join lateral (
          select * from candidates order by facet, internal_id limit ${MAX_CAPTURE_ROWS + 1}
        ) candidate
      `);
    } catch { fail("unsafe_source"); }
    const capturedRows = rows(result);
    const dataRows = capturedRows.filter((row) => row.facet !== "_capture");
    if (dataRows.length > MAX_CAPTURE_ROWS) fail("catalog_overflow");
    const captureRow = capturedRows.find((row) => row.facet === "_capture");
    const capturedAt = captureRow?.captured_at instanceof Date
      ? captureRow.captured_at.toISOString() : typeof captureRow?.captured_at === "string"
        ? new Date(captureRow.captured_at).toISOString() : new Date(0).toISOString();
    if (!Number.isFinite(Date.parse(capturedAt))) fail("unsafe_source");
    const candidates = uniqueCandidates(dataRows.map((row) => candidate(row, workspaceId)));
    return Object.freeze({ capturedAt, candidates, catalog: catalog(capturedAt, candidates) });
  }

  async listCatalog(workspaceId: string): Promise<GuidanceFacetCatalog> {
    return (await this.capture(workspaceId)).catalog;
  }

  async resolve(workspaceId: string, selection: GuidanceFacetScopeSelection): Promise<ResolvedGuidanceFacetScope> {
    if (selection.accountGroupRefs.length > 0) fail("catalog_unavailable");
    if (!HASH.test(selection.expectedCatalogHash)) fail("invalid_input");
    const captured = await this.capture(workspaceId);
    if (captured.catalog.catalogHash !== selection.expectedCatalogHash) fail("stale_catalog");
    const account = exactOne(captured.candidates, "account", selection.accountRef);
    const objective = selection.objective === null ? null
      : exactOne(captured.candidates, "objective", selection.objective, account.ref).value;
    const funnel = selection.funnel === null ? null
      : exactOne(captured.candidates, "funnel", selection.funnel).value;
    const optimization = selection.optimization === null ? null
      : exactOne(captured.candidates, "optimization", selection.optimization, account.ref).value;
    const categories = exactMany(captured.candidates, "internal_category", selection.internalCategoryRefs)
      .map((value) => value.value);
    const lifecycle = selection.lifecycle === null ? null
      : exactOne(captured.candidates, "lifecycle", selection.lifecycle).value;
    const entity = selection.entity === null ? null : exactOne(captured.candidates, "entity",
      selection.entity.ref, account.ref, selection.entity.type);
    const templates = exactMany(captured.candidates, "promotion_template", selection.promotionTemplateRefs, account.ref)
      .map((value) => value.value);
    const topics = exactMany(captured.candidates, "topic", selection.topics).map((value) => value.value);
    const requiredTopics = exactMany(captured.candidates, "topic", selection.requiredTopics).map((value) => value.value);
    return Object.freeze({ accountRef: account.value, accountGroupRefs: Object.freeze([]), objective, funnel,
      optimization, internalCategoryRefs: Object.freeze(categories), lifecycle,
      entity: entity === null ? null : Object.freeze({ type: entity.entityType!, ref: entity.value }),
      promotionTemplateRefs: Object.freeze(templates), topics: Object.freeze(topics),
      requiredTopics: Object.freeze(requiredTopics), capture: Object.freeze({
        version: GUIDANCE_FACET_SCOPE_CATALOG_VERSION, capturedAt: captured.capturedAt,
        catalogHash: captured.catalog.catalogHash,
      }) });
  }
}
