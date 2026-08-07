import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ExistingPostPromotionCanonicalMaterial, ExistingPostPromotionMaterialResolver } from "@/application/existing-post-promotion-canonical-submitter";
import { EXISTING_POST_SOURCE_BINDING_VERSION, type ExistingPostSourceBinding } from "@/domain/actions/autonomy-valve";
import { canonicalPromotionRegistryDocuments } from "@/connectors/meta/promotion/existing-post-promotion-catalog-drizzle-repository";
import { DrizzleExistingPostPromotionPreflightRepository } from "@/connectors/meta/promotion/existing-post-promotion-preflight-drizzle-repository";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>; type ReadDatabase = Pick<Database, "execute">;
type Row = Readonly<Record<string, unknown> & { account_id: string; actor_id: string; post_id: string; ad_set_id: string;
  campaign_id: string; category_id: string; category_ref: string; binding_payload: unknown; binding_hash: string;
  template_ref: string; template_revision: number; template_payload: unknown; template_hash: string;
  preset_ref: string; preset_revision: number; preset_payload: unknown; preset_hash: string;
  objective_ref: string; budget_plan_ref: string; budget_kind: "daily" | "lifetime"; budget_currency: string;
  budget_default: string; timeframe_ref: string; schedule_mode: "continuous" | "fixed_duration"; duration_days: number | null;
  ad_set_raw_payload_hash: string; campaign_raw_payload_hash: string;
  post_content_hash: string; post_raw_payload_hash: string; post_provenance: unknown; post_media_type: string | null;
  creative_binding_hash: string | null }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/; const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
function rows(result: unknown): readonly Row[] { if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) throw new Error("unsafe_store"); return result.rows as readonly Row[]; }
function organic(value: unknown): ExistingPostSourceBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const binding = (value as Record<string, unknown>).existingPostSourceBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return null;
  const item = binding as Record<string, unknown>; const keys = Object.keys(item).sort();
  if (keys.join("|") !== "kind|objectStorySpecHash|postIdentityHash|sourceHash|sourceRef|version"
    || item.version !== EXISTING_POST_SOURCE_BINDING_VERSION || item.kind !== "organic_post_binding"
    || typeof item.sourceRef !== "string" || !REF.test(item.sourceRef)
    || [item.sourceHash, item.postIdentityHash, item.objectStorySpecHash].some((hash) => typeof hash !== "string" || !HASH.test(hash))) return null;
  return Object.freeze({ version: EXISTING_POST_SOURCE_BINDING_VERSION, kind: "organic_post_binding",
    sourceRef: item.sourceRef, sourceHash: item.sourceHash as string, postIdentityHash: item.postIdentityHash as string,
    objectStorySpecHash: item.objectStorySpecHash as string });
}
function postType(media: string | null): "image" | "video" | "carousel" | "reel" | null {
  const value = media?.toLowerCase(); if (value === "image" || value === "photo") return "image";
  if (value === "video") return "video"; if (value === "carousel" || value === "album") return "carousel";
  if (value === "reel" || value === "reels") return "reel"; return null;
}

/** Reads only persisted immutable material; missing source hashes fail closed instead of being synthesized. */
export class DrizzleExistingPostPromotionCanonicalMaterialResolver implements ExistingPostPromotionMaterialResolver {
  private readonly preflight: DrizzleExistingPostPromotionPreflightRepository;
  constructor(private readonly database: ReadDatabase) { this.preflight = new DrizzleExistingPostPromotionPreflightRepository(database); }
  async resolve(input: Parameters<ExistingPostPromotionMaterialResolver["resolve"]>[0]): Promise<ExistingPostPromotionCanonicalMaterial | null> {
    if (!UUID.test(input.principal.workspaceId) || !REF.test(input.principal.workspaceRef) || !HASH.test(input.selectionHash)) return null;
    const context = await this.preflight.resolve({ workspaceId: input.principal.workspaceId, workspaceRef: input.principal.workspaceRef, request: input.selection });
    if (!context) return null;
    const result = rows(await this.database.execute(sql`
      select account.id as account_id, actor.id as actor_id, post.id as post_id, ad_set.id as ad_set_id,
        campaign.id as campaign_id, category.id as category_id, edge.category_ref,
        binding.payload as binding_payload, binding.binding_hash,
        template.template_ref, template.revision as template_revision, template.payload as template_payload, template.template_hash,
        preset.preset_ref, preset.revision as preset_revision, preset.payload as preset_payload, preset.preset_hash,
        template.objective_ref, template.budget_plan_version_ref as budget_plan_ref, template.budget_kind,
        template.currency as budget_currency, template.budget_default::text as budget_default,
        template.timeframe_ref, template.schedule_mode, template.duration_days,
        ad_set.raw_payload_hash as ad_set_raw_payload_hash, campaign.raw_payload_hash as campaign_raw_payload_hash,
        post.content_hash as post_content_hash, post.raw_payload_hash as post_raw_payload_hash,
        post.provenance as post_provenance, post.media_type as post_media_type,
        creative_binding.binding_payload_hash as creative_binding_hash
      from promotion_template_bindings binding
      join promotion_template_revisions template on template.workspace_id = binding.workspace_id and template.id = binding.template_revision_id
      join audience_preset_revisions preset on preset.workspace_id = template.workspace_id and preset.id = template.audience_preset_revision_id
      join promotion_template_binding_categories edge on edge.workspace_id = binding.workspace_id and edge.binding_id = binding.id
      join category_definitions category on category.workspace_id = edge.workspace_id and category.id = edge.category_definition_id
      join ad_accounts account on account.workspace_id = binding.workspace_id and account.id = binding.ad_account_id
      join meta_assets actor on actor.workspace_id = binding.workspace_id and actor.id = binding.actor_asset_id
      join meta_posts post on post.workspace_id = binding.workspace_id and post.actor_asset_id = actor.id
      join meta_ad_sets ad_set on ad_set.workspace_id = binding.workspace_id and ad_set.ad_account_id = account.id
      join ad_campaigns campaign on campaign.workspace_id = binding.workspace_id and campaign.id = ad_set.campaign_id
      left join meta_ad_creative_bindings creative_binding on creative_binding.workspace_id = binding.workspace_id
        and creative_binding.post_id = post.id and creative_binding.disappeared_at is null
      where binding.workspace_id = ${input.principal.workspaceId}::uuid and template.template_ref = ${input.selection.promotionTemplateRef}
        and preset.preset_ref = ${input.selection.audiencePresetRef} and edge.category_ref = ${input.selection.internalCategoryRef}
        and template.objective_ref = ${input.selection.objectiveRef} and template.budget_plan_version_ref = ${input.selection.budgetPlanRef}
        and template.timeframe_ref = ${input.selection.timeframeRef} and template.state = 'published' and preset.state = 'published'
        and binding.effective_from <= ${input.evaluatedAt}::timestamptz and (binding.expires_at is null or binding.expires_at > ${input.evaluatedAt}::timestamptz)
        and account.disappeared_at is null and actor.disappeared_at is null and post.disappeared_at is null
        and ad_set.disappeared_at is null and campaign.disappeared_at is null
      order by binding.binding_ref, creative_binding.id nulls first limit 101
    `));
    if (result.length > 100) return null;
    const matches = result.filter((row) => UUID.test(row.account_id) && UUID.test(row.actor_id) && UUID.test(row.post_id)
      && UUID.test(row.ad_set_id) && UUID.test(row.campaign_id) && UUID.test(row.category_id)
      && promotionRegistryPublicRef("account", input.principal.workspaceId, row.account_id) === input.selection.accountRef
      && promotionRegistryPublicRef("actor", input.principal.workspaceId, row.actor_id) === input.selection.actorRef
      && promotionRegistryPublicRef("post", input.principal.workspaceId, row.post_id) === input.selection.postRef
      && promotionRegistryPublicRef("adset", input.principal.workspaceId, row.ad_set_id) === input.selection.adSetRef
      && promotionRegistryPublicRef("category", input.principal.workspaceId, row.category_id) === input.selection.internalCategoryRef);
    if (matches.length === 0) return null;
    const canonicalKey = (row: Row) => `${row.binding_hash}:${row.template_hash}:${row.preset_hash}:${row.post_id}:${row.ad_set_id}`;
    if (new Set(matches.map(canonicalKey)).size !== 1) return null;
    const row = matches[0]!; const documents = canonicalPromotionRegistryDocuments(row as never);
    if (documents.preset.workspaceRef !== input.principal.workspaceRef
      || documents.template.workspaceRef !== input.principal.workspaceRef
      || documents.binding.workspaceRef !== input.principal.workspaceRef
      || promotionRegistryPublicRef("campaign", input.principal.workspaceId, row.campaign_id) !== context.adSet.campaignRef
      || documents.binding.campaignRef !== null && documents.binding.campaignRef !== context.adSet.campaignRef) return null;
    const creativeHashes = [...new Set(matches.map((item) => item.creative_binding_hash).filter((hash): hash is string => typeof hash === "string"))];
    const creativeCandidates = matches.filter((item) => item.creative_binding_hash !== null);
    if (creativeCandidates.length > 1 || creativeHashes.some((hash) => !HASH.test(hash)) || creativeHashes.length > 1) return null;
    const sourceBinding: ExistingPostSourceBinding | null = creativeHashes[0]
      ? Object.freeze({ version: EXISTING_POST_SOURCE_BINDING_VERSION, kind: "existing_ad_binding", bindingRef: null, bindingHash: creativeHashes[0] })
      : organic(row.post_provenance);
    const type = postType(row.post_media_type); if (!sourceBinding || !type || !HASH.test(row.post_content_hash)
      || !HASH.test(row.post_raw_payload_hash)
      || !HASH.test(row.ad_set_raw_payload_hash) || !HASH.test(row.campaign_raw_payload_hash)) return null;
    return Object.freeze({ template: documents.template, preset: documents.preset, binding: documents.binding,
      eligibility: Object.freeze({ workspaceId: input.principal.workspaceId, adAccountExternalId: context.account.externalId,
        requestedActor: Object.freeze({ type: context.actor.type, externalId: context.actor.externalId }),
        post: Object.freeze({ identity: context.post.identity, externalPostId: context.post.externalPostId,
          actorExternalId: context.post.actorExternalId, lifecycle: context.post.lifecycle, contentHash: row.post_content_hash }),
        ownership: Object.freeze({ adAccount: context.account.ownership, actor: context.actor.ownership }), permission: context.actor.permission,
        capabilities: Object.freeze({ actorAdvertising: context.actor.advertisingCapability, postPromotion: context.post.promotionCapability }) }),
      postBinding: Object.freeze({ verification: "verified", sourceType: "existing_post", postRef: context.post.ref,
        actorRef: context.actor.ref, actorType: context.actor.type as "page" | "instagram", postType: type, sourceBinding }),
      adSetRef: context.adSet.ref, destinationRef: documents.template.destinationRef,
      budgetPlanVersionRef: documents.template.budget.budgetPlanVersionRef,
      internalCategoryRefs: Object.freeze([...documents.binding.internalCategoryRefs]), accountRef: context.account.ref,
      campaignRef: context.adSet.campaignRef, adSetSnapshotHash: row.ad_set_raw_payload_hash,
      campaignSnapshotHash: row.campaign_raw_payload_hash });
  }
}
