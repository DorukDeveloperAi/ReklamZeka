import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { PublishedPromotionTemplateCatalog } from "@/application/promotion-template-selector-service";
import {
  canonicalPromotionRegistryDocuments,
} from "@/connectors/meta/promotion/existing-post-promotion-catalog-drizzle-repository";
import {
  promotionRegistryPublicRef,
} from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import { currentPromotionTemplateAuthoringHeadSql } from "@/connectors/meta/promotion/promotion-template-authoring-active-sql";
import * as schema from "@/db/schema";
import {
  PROMOTION_TEMPLATE_SELECTOR_VERSION,
  PromotionTemplateSelectorError,
  dryRunPromotionTemplateSelection,
  type PromotionTemplateSelectorCandidate,
} from "@/domain/meta/promotion/promotion-template-selector";

type Database = NodePgDatabase<typeof schema>;
type CatalogDatabase = Pick<Database, "execute">;

type PublishedRow = Readonly<{
  account_id: string;
  actor_id: string;
  actor_type: "page" | "instagram";
  asset_type: "facebook_page" | "instagram_account";
  category_id: string;
  category_ref: string;
  binding_payload: unknown;
  binding_hash: string;
  template_ref: string;
  template_revision: number;
  template_payload: unknown;
  template_hash: string;
  preset_ref: string;
  preset_revision: number;
  preset_payload: unknown;
  preset_hash: string;
  objective_ref: string;
  budget_plan_ref: string;
  budget_kind: "daily" | "lifetime";
  budget_currency: string;
  budget_default: string;
  timeframe_ref: string;
  schedule_mode: "continuous" | "fixed_duration";
  duration_days: number | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

function fail(): never {
  throw new PromotionTemplateSelectorError("catalog_integrity_rejected");
}

function resultRows(value: unknown): readonly PublishedRow[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail();
  return value.rows as readonly PublishedRow[];
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return value;
}

function sameCandidate(left: PromotionTemplateSelectorCandidate, right: PromotionTemplateSelectorCandidate): boolean {
  return left.preset.presetHash === right.preset.presetHash
    && left.template.templateHash === right.template.templateHash
    && left.binding.bindingHash === right.binding.bindingHash;
}

/**
 * Tenant-bound read adapter for active immutable registry documents. It checks
 * every public ref against its private relational row and never returns UUIDs,
 * Meta IDs, labels, targeting material or credentials beyond this server port.
 */
export class DrizzlePublishedPromotionTemplateCatalog implements PublishedPromotionTemplateCatalog {
  constructor(
    private readonly database: CatalogDatabase,
    private readonly workspaceId: string,
    private readonly workspaceRef: string,
  ) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) fail();
  }

  async listPublished(input: Readonly<{
    workspaceRef: string;
    evaluatedAt: string;
  }>): Promise<readonly PromotionTemplateSelectorCandidate[]> {
    if (!input || Object.keys(input).length !== 2 || input.workspaceRef !== this.workspaceRef) fail();
    const evaluatedAt = instant(input.evaluatedAt);
    let source: readonly PublishedRow[];
    try {
      source = resultRows(await this.database.execute(sql`
        select account.id as account_id, actor.id as actor_id, binding.actor_type, actor.asset_type,
          category.id as category_id, edge.category_ref,
          binding.payload as binding_payload, binding.binding_hash,
          template.template_ref, template.revision as template_revision,
          template.payload as template_payload, template.template_hash,
          preset.preset_ref, preset.revision as preset_revision,
          preset.payload as preset_payload, preset.preset_hash,
          template.objective_ref, template.budget_plan_version_ref as budget_plan_ref,
          template.budget_kind, template.currency as budget_currency,
          template.budget_default::text as budget_default,
          template.timeframe_ref, template.schedule_mode, template.duration_days
        from promotion_template_bindings binding
        join promotion_template_revisions template
          on template.workspace_id = binding.workspace_id and template.id = binding.template_revision_id
        join audience_preset_revisions preset
          on preset.workspace_id = template.workspace_id and preset.id = template.audience_preset_revision_id
        join ad_accounts account
          on account.workspace_id = binding.workspace_id and account.id = binding.ad_account_id
        join data_sources source on source.id = account.data_source_id and source.workspace_id = binding.workspace_id
        join meta_assets actor
          on actor.workspace_id = binding.workspace_id and actor.id = binding.actor_asset_id
          and actor.meta_connection_id = source.meta_connection_id
        join meta_connections connection
          on connection.workspace_id = binding.workspace_id and connection.id = actor.meta_connection_id
        join promotion_template_binding_categories edge
          on edge.workspace_id = binding.workspace_id and edge.binding_id = binding.id
        join category_definitions category
          on category.workspace_id = edge.workspace_id and category.id = edge.category_definition_id
        where binding.workspace_id = ${this.workspaceId}::uuid
          and template.state = 'published' and preset.state = 'published'
          and template.published_at <= ${evaluatedAt}::timestamptz
          and preset.published_at <= ${evaluatedAt}::timestamptz
          and binding.effective_from <= ${evaluatedAt}::timestamptz
          and (binding.expires_at is null or binding.expires_at > ${evaluatedAt}::timestamptz)
          and connection.status = 'active' and connection.revoked_at is null and connection.disconnected_at is null
          and account.disappeared_at is null and actor.disappeared_at is null and category.archived_at is null
          and ${currentPromotionTemplateAuthoringHeadSql}
        order by binding.binding_ref, edge.category_ref
        limit 10001
      `));
    } catch (reason) {
      if (reason instanceof PromotionTemplateSelectorError) throw reason;
      fail();
    }
    if (source.length > 10_000) fail();

    const grouped = new Map<string, Readonly<{
      candidate: PromotionTemplateSelectorCandidate;
      categoryRefs: Set<string>;
    }>>();
    for (const row of source) {
      try {
        if (!UUID.test(row.account_id) || !UUID.test(row.actor_id) || !UUID.test(row.category_id)) fail();
        const candidate = canonicalPromotionRegistryDocuments(row);
        if (candidate.preset.workspaceRef !== this.workspaceRef || candidate.template.workspaceRef !== this.workspaceRef
          || candidate.binding.workspaceRef !== this.workspaceRef
          || candidate.binding.accountRef !== promotionRegistryPublicRef("account", this.workspaceId, row.account_id)
          || candidate.binding.actor.actorRef !== promotionRegistryPublicRef("actor", this.workspaceId, row.actor_id)
          || candidate.binding.actor.type !== row.actor_type
          || row.category_ref !== promotionRegistryPublicRef("category", this.workspaceId, row.category_id)
          || row.actor_type === "page" && row.asset_type !== "facebook_page"
          || row.actor_type === "instagram" && row.asset_type !== "instagram_account") fail();
        const prior = grouped.get(candidate.binding.bindingRef);
        if (prior) {
          if (!sameCandidate(prior.candidate, candidate) || prior.categoryRefs.has(row.category_ref)) fail();
          prior.categoryRefs.add(row.category_ref);
        } else {
          grouped.set(candidate.binding.bindingRef, Object.freeze({ candidate, categoryRefs: new Set([row.category_ref]) }));
        }
      } catch (reason) {
        if (reason instanceof PromotionTemplateSelectorError) throw reason;
        fail();
      }
    }
    if (grouped.size > 100) fail();
    const output = [...grouped.values()].map(({ candidate, categoryRefs }) => {
      const expected = [...candidate.binding.internalCategoryRefs].sort();
      const actual = [...categoryRefs].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) fail();
      return candidate;
    }).sort((left, right) => left.binding.bindingRef.localeCompare(right.binding.bindingRef));
    // Validate publication timestamps and binding effectiveness against the
    // caller's exact read instant, even when a test/fake database ignores SQL predicates.
    dryRunPromotionTemplateSelection({ version: PROMOTION_TEMPLATE_SELECTOR_VERSION, workspaceRef: this.workspaceRef,
      evaluatedAt, accountRef: null, actor: null, internalCategoryRefs: null, postType: null, instruction: null }, output);
    return Object.freeze(output);
  }
}
