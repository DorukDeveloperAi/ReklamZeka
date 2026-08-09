import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type {
  ExistingPostPromotionPreflightContext,
  ExistingPostPromotionPreflightRepository,
} from "@/application/existing-post-promotion-preflight-service";
import {
  canonicalPromotionRegistryDocuments,
} from "@/connectors/meta/promotion/existing-post-promotion-catalog-drizzle-repository";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import { currentPromotionTemplateAuthoringHeadSql } from "@/connectors/meta/promotion/promotion-template-authoring-active-sql";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type ReadDatabase = Pick<Database, "execute">;

type Row = Readonly<Record<string, unknown> & {
  account_id: string; account_external_id: string; account_currency: string; account_timezone: string;
  account_permissions: unknown; account_capabilities: unknown;
  actor_id: string; actor_external_id: string; actor_type: "page" | "instagram"; asset_type: "facebook_page" | "instagram_account";
  actor_ownership: string; actor_permissions: unknown; actor_capabilities: unknown;
  post_id: string; post_external_id: string; post_content_hash: string; post_published_at: Date | string;
  post_eligibility: string; post_eligibility_at: Date | string;
  ad_set_id: string; ad_set_status: string | null; ad_set_effective_status: string | null;
  campaign_id: string;
  binding_payload: unknown; binding_hash: string;
  template_ref: string; template_revision: number; template_payload: unknown; template_hash: string;
  preset_ref: string; preset_revision: number; preset_payload: unknown; preset_hash: string;
  category_id: string; category_ref: string; objective_ref: string; budget_plan_ref: string;
  budget_kind: "daily" | "lifetime"; budget_currency: string; budget_default: string;
  timeframe_ref: string; schedule_mode: "continuous" | "fixed_duration"; duration_days: number | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/;
const TWO_DECIMAL = new Set(["TRY", "USD", "EUR", "GBP", "AED", "SAR", "CAD", "AUD", "CHF"]);

function rows(result: unknown): readonly Row[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) throw new Error("unsafe_store");
  return result.rows as readonly Row[];
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) throw new Error("unsafe_ref");
  return value;
}

function exactMinor(value: string, currency: string): number | null {
  if (!TWO_DECIMAL.has(currency) || !/^(0|[1-9]\d{0,17})(?:\.\d{1,12})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  if (fraction.slice(2).replace(/0/g, "")) return null;
  const minor = BigInt(integer!) * 100n + BigInt((fraction + "00").slice(0, 2));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function capability(value: unknown, operation: "advertise" | "promote_existing_post"):
"supported" | "denied" | "unsupported" | "unknown" {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const list = (value as Record<string, unknown>).capabilities;
  if (!Array.isArray(list)) return "unknown";
  const item = list.find((candidate) => candidate && typeof candidate === "object"
    && (candidate as Record<string, unknown>).operation === operation) as Record<string, unknown> | undefined;
  if (item?.status === "verified") return "supported";
  if (item?.status === "permission_missing") return "denied";
  if (item?.status === "unsupported") return "unsupported";
  return "unknown";
}

function permission(value: unknown, capabilities: unknown): "confirmed" | "rejected" | "unknown" {
  if (Array.isArray(value) && value.some((item) => typeof item === "string" && item.toUpperCase() === "ADVERTISE")) return "confirmed";
  const status = capability(capabilities, "advertise");
  return status === "supported" ? "confirmed" : status === "denied" ? "rejected" : "unknown";
}

function deliveryState(configured: string | null, effective: string | null): "active" | "inactive" | "unknown" {
  const states = [configured, effective].filter((value): value is string => Boolean(value)).map((value) => value.toUpperCase());
  if (states.length === 0) return "unknown";
  return states.every((value) => value === "ACTIVE") ? "active" : "inactive";
}

function timezone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0)); return value.includes("/"); } catch { return false; }
}

/** Exact, tenant-bound, read-only resolver. No Meta transport or write repository is accepted. */
export class DrizzleExistingPostPromotionPreflightRepository implements ExistingPostPromotionPreflightRepository {
  constructor(private readonly database: ReadDatabase, private readonly clock: () => Date = () => new Date()) {}

  async resolve(input: Parameters<ExistingPostPromotionPreflightRepository["resolve"]>[0]): Promise<ExistingPostPromotionPreflightContext | null> {
    if (!UUID.test(input.workspaceId) || !REF.test(input.workspaceRef)) throw new Error("invalid_scope");
    for (const value of Object.values(input.request)) ref(value);
    const now = this.clock();
    if (!Number.isFinite(now.valueOf())) throw new Error("invalid_clock");
    const evaluatedAt = now.toISOString();
    const result = rows(await this.database.execute(sql`
      select account.id as account_id, account.external_account_id as account_external_id,
        account.currency as account_currency, account.timezone as account_timezone,
        account.permission_snapshot as account_permissions, account.capability_snapshot as account_capabilities,
        actor.id as actor_id, actor.external_asset_id as actor_external_id, binding.actor_type,
        actor.asset_type, actor.ownership_kind as actor_ownership,
        actor.permission_snapshot as actor_permissions, actor.capability_snapshot as actor_capabilities,
        post.id as post_id, post.external_post_id as post_external_id, post.content_hash as post_content_hash,
        post.published_at as post_published_at, post.promotion_eligibility_status as post_eligibility,
        post.promotion_eligibility_evaluated_at as post_eligibility_at,
        ad_set.id as ad_set_id, ad_set.configured_status as ad_set_status,
        ad_set.effective_status as ad_set_effective_status, campaign.id as campaign_id,
        binding.payload as binding_payload, binding.binding_hash,
        template.template_ref, template.revision as template_revision, template.payload as template_payload, template.template_hash,
        preset.preset_ref, preset.revision as preset_revision, preset.payload as preset_payload, preset.preset_hash,
        category.id as category_id, edge.category_ref, template.objective_ref,
        template.budget_plan_version_ref as budget_plan_ref, template.budget_kind,
        template.currency as budget_currency, template.budget_default::text as budget_default,
        template.timeframe_ref, template.schedule_mode, template.duration_days
      from promotion_template_bindings binding
      join promotion_template_revisions template on template.workspace_id = binding.workspace_id and template.id = binding.template_revision_id
      join audience_preset_revisions preset on preset.workspace_id = template.workspace_id and preset.id = template.audience_preset_revision_id
      join promotion_template_binding_categories edge on edge.workspace_id = binding.workspace_id and edge.binding_id = binding.id
      join category_definitions category on category.workspace_id = edge.workspace_id and category.id = edge.category_definition_id
      join ad_accounts account on account.workspace_id = binding.workspace_id and account.id = binding.ad_account_id
      join data_sources source on source.workspace_id = binding.workspace_id and source.id = account.data_source_id
      join meta_connections connection on connection.workspace_id = binding.workspace_id
        and connection.id = source.meta_connection_id and connection.status = 'active'
        and connection.revoked_at is null and connection.disconnected_at is null
      join meta_assets actor on actor.workspace_id = binding.workspace_id and actor.id = binding.actor_asset_id
        and actor.meta_connection_id = source.meta_connection_id
      join meta_posts post on post.workspace_id = binding.workspace_id and post.actor_asset_id = actor.id
        and post.meta_connection_id = actor.meta_connection_id
      join meta_ad_sets ad_set on ad_set.workspace_id = binding.workspace_id and ad_set.ad_account_id = account.id
      join ad_campaigns campaign on campaign.workspace_id = binding.workspace_id and campaign.id = ad_set.campaign_id
        and campaign.ad_account_id = account.id
      where binding.workspace_id = ${input.workspaceId}::uuid
        and template.template_ref = ${input.request.promotionTemplateRef}
        and preset.preset_ref = ${input.request.audiencePresetRef}
        and template.objective_ref = ${input.request.objectiveRef}
        and template.budget_plan_version_ref = ${input.request.budgetPlanRef}
        and template.timeframe_ref = ${input.request.timeframeRef}
        and template.state = 'published' and preset.state = 'published' and category.archived_at is null
        and binding.effective_from <= ${evaluatedAt}::timestamptz
        and (binding.expires_at is null or binding.expires_at > ${evaluatedAt}::timestamptz)
        and account.disappeared_at is null and actor.disappeared_at is null and post.disappeared_at is null
        and ad_set.disappeared_at is null and campaign.disappeared_at is null
        and ${currentPromotionTemplateAuthoringHeadSql}
      order by binding.binding_ref, post.id, ad_set.id
      limit 1001
    `));
    if (result.length > 1000) throw new Error("candidate_overflow");
    const matches = result.filter((row) => UUID.test(row.account_id) && UUID.test(row.actor_id) && UUID.test(row.post_id)
      && UUID.test(row.ad_set_id) && UUID.test(row.campaign_id) && UUID.test(row.category_id)
      && promotionRegistryPublicRef("account", input.workspaceId, row.account_id) === input.request.accountRef
      && promotionRegistryPublicRef("actor", input.workspaceId, row.actor_id) === input.request.actorRef
      && promotionRegistryPublicRef("post", input.workspaceId, row.post_id) === input.request.postRef
      && promotionRegistryPublicRef("adset", input.workspaceId, row.ad_set_id) === input.request.adSetRef
      && promotionRegistryPublicRef("category", input.workspaceId, row.category_id) === input.request.internalCategoryRef
      && row.category_ref === input.request.internalCategoryRef);
    if (matches.length === 0) return null;
    if (matches.length !== 1) throw new Error("ambiguous_selection");
    const row = matches[0]!;
    const documents = canonicalPromotionRegistryDocuments(row as never);
    if (documents.preset.workspaceRef !== input.workspaceRef || documents.template.workspaceRef !== input.workspaceRef
      || documents.binding.workspaceRef !== input.workspaceRef) throw new Error("workspace_mismatch");
    const selectedCampaignRef = promotionRegistryPublicRef("campaign", input.workspaceId, row.campaign_id);
    if (documents.binding.campaignRef !== null && documents.binding.campaignRef !== selectedCampaignRef) {
      throw new Error("campaign_binding_mismatch");
    }
    const amountMinor = exactMinor(documents.template.budget.defaultDecimal, documents.template.budget.currency);
    const minimumMinor = documents.template.budget.minimumDecimal === null ? null
      : exactMinor(documents.template.budget.minimumDecimal, documents.template.budget.currency);
    const maximumMinor = documents.template.budget.maximumDecimal === null ? null
      : exactMinor(documents.template.budget.maximumDecimal, documents.template.budget.currency);
    const budgetKnown = amountMinor !== null && (documents.template.budget.minimumDecimal === null || minimumMinor !== null)
      && (documents.template.budget.maximumDecimal === null || maximumMinor !== null)
      && row.account_currency === documents.template.budget.currency;
    const startAt = now.toISOString();
    const duration = documents.template.timeframe.durationDays;
    const endAt = duration === null ? null : new Date(now.valueOf() + duration * 86_400_000).toISOString();
    const actorCapability = capability(row.actor_capabilities, "advertise");
    const actorType = row.actor_type;
    if (actorType === "page" && row.asset_type !== "facebook_page"
      || actorType === "instagram" && row.asset_type !== "instagram_account"
      || !HASH.test(row.post_content_hash)) throw new Error("corrupt_binding");
    const accountRef = promotionRegistryPublicRef("account", input.workspaceId, row.account_id);
    const actorRef = promotionRegistryPublicRef("actor", input.workspaceId, row.actor_id);
    return Object.freeze({
      workspaceId: input.workspaceId, workspaceRef: input.workspaceRef,
      account: Object.freeze({ ref: accountRef, externalId: row.account_external_id,
        ownership: permission(row.account_permissions, row.account_capabilities) }),
      adSet: Object.freeze({ ref: input.request.adSetRef, accountRef,
        campaignRef: selectedCampaignRef,
        state: deliveryState(row.ad_set_status, row.ad_set_effective_status) }),
      actor: Object.freeze({ ref: actorRef, type: actorType, externalId: row.actor_external_id,
        ownership: row.actor_ownership === "owned" ? "confirmed" as const : "unknown" as const,
        permission: permission(row.actor_permissions, row.actor_capabilities), advertisingCapability: actorCapability }),
      post: Object.freeze({ ref: input.request.postRef, actorRef, identity: "known" as const,
        externalPostId: row.post_external_id, actorExternalId: row.actor_external_id,
        lifecycle: row.post_published_at ? "published" as const : "unknown" as const, contentHash: row.post_content_hash,
        promotionCapability: row.post_eligibility === "eligible" && row.post_eligibility_at
          ? capability(row.actor_capabilities, "promote_existing_post") : "unknown" as const }),
      template: Object.freeze({ ref: documents.template.templateRef, state: "active" as const,
        requiredAudiencePresetRef: documents.preset.presetRef, accountRefs: Object.freeze([accountRef]), actorRefs: Object.freeze([actorRef]),
        internalCategoryRefs: Object.freeze([row.category_ref]), objectiveRefs: Object.freeze([documents.template.objectiveRef]),
        actorTypes: documents.template.actorTypes, budgetKinds: Object.freeze([documents.template.budget.kind]),
        currencies: Object.freeze([documents.template.budget.currency]), minimumBudgetMinor: minimumMinor, maximumBudgetMinor: maximumMinor,
        minimumDurationDays: duration ?? 1, maximumDurationDays: duration ?? 365,
        compatibility: Object.freeze({ destination: "unknown" as const, optimization: "unknown" as const,
          placement: "unknown" as const, specialCategory: "unknown" as const, tracking: "unknown" as const }) }),
      audiencePreset: Object.freeze({ ref: documents.preset.presetRef, state: "active" as const,
        accountRefs: Object.freeze([accountRef]), actorTypes: documents.template.actorTypes,
        internalCategoryRefs: Object.freeze([row.category_ref]) }),
      budgetPlan: Object.freeze({ ref: documents.template.budget.budgetPlanVersionRef,
        state: budgetKnown ? "active" as const : "unknown" as const, kind: documents.template.budget.kind,
        currency: documents.template.budget.currency, amountMinor: amountMinor ?? 0 }),
      timeframe: Object.freeze({ ref: documents.template.timeframe.timeframeRef,
        state: timezone(row.account_timezone) ? "active" as const : "unknown" as const,
        scheduleMode: documents.template.timeframe.scheduleMode, startAt, endAt,
        timezone: timezone(row.account_timezone) ? row.account_timezone : "Etc/UTC", durationDays: duration }),
      objective: Object.freeze({ ref: documents.template.objectiveRef, state: "active" as const }),
      internalCategory: Object.freeze({ ref: row.category_ref, state: "active" as const }),
      guidance: Object.freeze([]),
    });
  }
}
