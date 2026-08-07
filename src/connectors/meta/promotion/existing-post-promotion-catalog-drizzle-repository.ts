import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  ExistingPostPromotionCatalogError,
  type ExistingPostPromotionCatalog,
  type ExistingPostPromotionCatalogRepository,
  type PromotionCatalogOption,
} from "@/application/existing-post-promotion-catalog";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import * as schema from "@/db/schema";
import {
  assertPromotionRegistryLink,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
  type AudiencePresetRevision,
  type PromotionTemplateBinding,
  type PromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

type Database = NodePgDatabase<typeof schema>;
type CatalogDatabase = Pick<Database, "execute">;

type RegistryRow = Readonly<{
  account_id: string;
  account_name: string;
  actor_id: string;
  actor_type: "page" | "instagram";
  asset_type: "facebook_page" | "instagram_account";
  actor_name: string | null;
  actor_username: string | null;
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
  category_id: string;
  category_ref: string;
  category_label: string;
  objective_ref: string;
  budget_plan_ref: string;
  budget_kind: "daily" | "lifetime";
  budget_currency: string;
  budget_default: string;
  timeframe_ref: string;
  schedule_mode: "continuous" | "fixed_duration";
  duration_days: number | null;
}>;

type PostRow = Readonly<{
  post_id: string;
  actor_id: string;
  asset_type: "facebook_page" | "instagram_account";
  media_type: string | null;
  published_at: Date | string;
}>;
type AdSetRow = Readonly<{
  ad_set_id: string;
  ad_set_name: string;
  account_id: string;
  campaign_id: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/;
const HASH = /\b[a-f0-9]{64}\b/gi;
const META_ID = /\b(?:act_|campaign_|adset_|ad_)?\d{8,}\b/gi;
const CREDENTIAL = /(?:Bearer\s+|rzs1\.|EA[A-Za-z0-9]{24,}|access[_-]?token|secret|prompt|raw[_-]?(?:payload|json))/i;

function fail(code: "invalid_input" | "unsafe_source" | "source_unavailable"): never {
  throw new ExistingPostPromotionCatalogError(code);
}

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("source_unavailable");
  return result.rows as readonly T[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("unsafe_source");
  return value as Record<string, unknown>;
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || CREDENTIAL.test(value)) fail("unsafe_source");
  return value;
}

function label(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, " ") : "";
  const redacted = candidate.replace(HASH, "•••").replace(META_ID, "•••").replace(/\s+/g, " ").trim();
  const safe = !redacted || CREDENTIAL.test(redacted) ? fallback : redacted;
  return [...safe].slice(0, 120).join("");
}

function instant(value: unknown): Date {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(parsed.valueOf())) fail("unsafe_source");
  return parsed;
}

function publicDate(value: unknown): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(instant(value));
}

function relationPayload(row: RegistryRow, workspaceId: string): Readonly<{ accountRef: string; actorRef: string }> {
  if (!UUID.test(row.account_id) || !UUID.test(row.actor_id) || !UUID.test(row.category_id)) fail("unsafe_source");
  const expectedAccount = promotionRegistryPublicRef("account", workspaceId, row.account_id);
  const expectedActor = promotionRegistryPublicRef("actor", workspaceId, row.actor_id);
  const expectedCategory = promotionRegistryPublicRef("category", workspaceId, row.category_id);
  const binding = record(row.binding_payload);
  const actor = record(binding.actor);
  if (binding.accountRef !== expectedAccount || actor.actorRef !== expectedActor || actor.type !== row.actor_type
    || row.category_ref !== expectedCategory
    || row.actor_type === "page" && row.asset_type !== "facebook_page"
    || row.actor_type === "instagram" && row.asset_type !== "instagram_account") fail("unsafe_source");
  return Object.freeze({ accountRef: expectedAccount, actorRef: expectedActor });
}

export type CanonicalPromotionRegistryDocuments = Readonly<{
  preset: AudiencePresetRevision;
  template: PromotionTemplateRevision;
  binding: PromotionTemplateBinding;
}>;

export function canonicalPromotionRegistryDocuments(row: Readonly<{
  binding_payload: unknown; binding_hash: string;
  template_ref: string; template_revision: number; template_payload: unknown; template_hash: string;
  preset_ref: string; preset_revision: number; preset_payload: unknown; preset_hash: string;
  category_ref: string; objective_ref: string; budget_plan_ref: string;
  budget_kind: "daily" | "lifetime"; budget_currency: string; budget_default: string;
  timeframe_ref: string; schedule_mode: "continuous" | "fixed_duration"; duration_days: number | null;
}>): CanonicalPromotionRegistryDocuments {
  try {
    const presetCandidate = record(row.preset_payload) as unknown as AudiencePresetRevision;
    const { presetHash, ...presetInput } = presetCandidate;
    const preset = createAudiencePresetRevision(presetInput);
    const templateCandidate = record(row.template_payload) as unknown as PromotionTemplateRevision;
    const { templateHash, ...templateInput } = templateCandidate;
    const template = createPromotionTemplateRevision(templateInput);
    const bindingCandidate = record(row.binding_payload) as unknown as PromotionTemplateBinding;
    const { bindingHash, ...bindingInput } = bindingCandidate;
    const binding = createPromotionTemplateBinding(bindingInput, template);
    assertPromotionRegistryLink(preset, template, binding, binding.effectiveFrom);
    if (presetHash !== preset.presetHash || row.preset_hash !== preset.presetHash
      || templateHash !== template.templateHash || row.template_hash !== template.templateHash
      || bindingHash !== binding.bindingHash || row.binding_hash !== binding.bindingHash
      || row.preset_ref !== preset.presetRef || row.preset_revision !== preset.revision
      || row.template_ref !== template.templateRef || row.template_revision !== template.revision
      || template.audiencePreset.presetRef !== preset.presetRef
      || template.audiencePreset.revision !== preset.revision
      || template.audiencePreset.presetHash !== preset.presetHash
      || row.objective_ref !== template.objectiveRef
      || row.budget_plan_ref !== template.budget.budgetPlanVersionRef
      || row.budget_kind !== template.budget.kind || row.budget_currency !== template.budget.currency
      || displayDecimal(row.budget_default) !== template.budget.defaultDecimal
      || row.timeframe_ref !== template.timeframe.timeframeRef
      || row.schedule_mode !== template.timeframe.scheduleMode || row.duration_days !== template.timeframe.durationDays
      || !binding.internalCategoryRefs.includes(row.category_ref)) fail("unsafe_source");
    return Object.freeze({ preset, template, binding });
  } catch (reason) {
    if (reason instanceof ExistingPostPromotionCatalogError) throw reason;
    fail("unsafe_source");
  }
}

function titleFromRef(value: string): string {
  const suffix = value.includes("_") ? value.slice(value.indexOf("_") + 1) : value;
  return suffix.replace(/[_:.-]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("tr-TR"));
}

function displayDecimal(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,17})(?:\.\d{1,12})?$/.test(value)) fail("unsafe_source");
  const [integer, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${integer}.${normalizedFraction}` : integer!;
}

function sorted<T extends { ref: string }>(values: Iterable<T>): readonly T[] {
  return Object.freeze([...values].sort((left, right) => left.ref.localeCompare(right.ref, "en")));
}

/**
 * Server-private, read-only projection over the immutable promotion registry and
 * the verified Meta mirror. It deliberately never reads post copy/captions,
 * targeting payloads, external Meta identifiers, hashes, credentials or grants.
 */
export class DrizzleExistingPostPromotionCatalogRepository implements ExistingPostPromotionCatalogRepository {
  constructor(private readonly database: CatalogDatabase) {}

  async list(input: Readonly<{ workspaceId: string }>): Promise<ExistingPostPromotionCatalog> {
    if (!UUID.test(input.workspaceId)) fail("invalid_input");
    let registryRows: readonly RegistryRow[];
    let postRows: readonly PostRow[];
    let adSetRows: readonly AdSetRow[];
    try {
      registryRows = rows<RegistryRow>(await this.database.execute(sql`
        select account.id as account_id, account.name as account_name,
          actor.id as actor_id, binding.actor_type, actor.asset_type,
          actor.display_name as actor_name, actor.username as actor_username,
          binding.payload as binding_payload, binding.binding_hash,
          template.template_ref, template.revision as template_revision,
          template.payload as template_payload, template.template_hash,
          preset.preset_ref, preset.revision as preset_revision, preset.payload as preset_payload, preset.preset_hash,
          category.id as category_id, edge.category_ref, category.label as category_label,
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
        where binding.workspace_id = ${input.workspaceId}::uuid
          and template.state = 'published' and preset.state = 'published'
          and connection.status = 'active' and connection.revoked_at is null and connection.disconnected_at is null
          and account.disappeared_at is null and actor.disappeared_at is null and category.archived_at is null
          and binding.effective_from <= current_timestamp
          and (binding.expires_at is null or binding.expires_at > current_timestamp)
        order by template.template_ref, template.revision desc, binding.binding_ref, edge.category_ref
        limit 10001
      `));
      postRows = rows<PostRow>(await this.database.execute(sql`
        select post.id as post_id, post.actor_asset_id as actor_id, actor.asset_type,
          post.media_type, post.published_at
        from meta_posts post
        join meta_assets actor
          on actor.workspace_id = post.workspace_id and actor.id = post.actor_asset_id
        join meta_connections connection
          on connection.workspace_id = actor.workspace_id and connection.id = actor.meta_connection_id
        where post.workspace_id = ${input.workspaceId}::uuid
          and post.promotion_eligibility_status = 'eligible'
          and post.promotion_eligibility_evaluated_at is not null
          and post.published_at is not null and post.content_hash ~ '^[a-f0-9]{64}$'
          and post.disappeared_at is null and actor.disappeared_at is null
          and connection.status = 'active' and connection.revoked_at is null and connection.disconnected_at is null
          and coalesce(lower(post.configured_status), '') not in ('deleted', 'archived')
          and coalesce(lower(post.effective_status), '') not in ('deleted', 'archived')
          and exists (
            select 1 from promotion_template_bindings active_binding
            where active_binding.workspace_id = post.workspace_id
              and active_binding.actor_asset_id = post.actor_asset_id
              and active_binding.effective_from <= current_timestamp
              and (active_binding.expires_at is null or active_binding.expires_at > current_timestamp)
          )
        order by post.published_at desc, post.id
        limit 1001
      `));
      adSetRows = rows<AdSetRow>(await this.database.execute(sql`
        select ad_set.id as ad_set_id, ad_set.name as ad_set_name,
          account.id as account_id, campaign.id as campaign_id
        from meta_ad_sets ad_set
        join ad_accounts account
          on account.workspace_id = ad_set.workspace_id and account.id = ad_set.ad_account_id
        join ad_campaigns campaign
          on campaign.workspace_id = ad_set.workspace_id and campaign.id = ad_set.campaign_id
          and campaign.ad_account_id = ad_set.ad_account_id
        where ad_set.workspace_id = ${input.workspaceId}::uuid
          and ad_set.disappeared_at is null and campaign.disappeared_at is null and account.disappeared_at is null
          and ad_set.raw_payload_hash ~ '^[a-f0-9]{64}$'
          and coalesce(lower(ad_set.configured_status), '') not in ('deleted', 'archived')
          and coalesce(lower(ad_set.effective_status), '') not in ('deleted', 'archived')
          and exists (
            select 1 from promotion_template_bindings active_binding
            where active_binding.workspace_id = ad_set.workspace_id
              and active_binding.ad_account_id = ad_set.ad_account_id
              and active_binding.effective_from <= current_timestamp
              and (active_binding.expires_at is null or active_binding.expires_at > current_timestamp)
          )
        order by ad_set.name, ad_set.id
        limit 1001
      `));
    } catch (reason) {
      if (reason instanceof ExistingPostPromotionCatalogError) throw reason;
      fail("source_unavailable");
    }

    if (registryRows.length > 10000 || postRows.length > 1000 || adSetRows.length > 1000) fail("source_unavailable");

    const documents = new Map<RegistryRow, CanonicalPromotionRegistryDocuments>();
    for (const row of registryRows) documents.set(row, canonicalPromotionRegistryDocuments(row));

    const latestRevision = new Map<string, number>();
    for (const row of registryRows) {
      const templateRef = ref(row.template_ref);
      if (!Number.isSafeInteger(row.template_revision) || row.template_revision < 1) fail("unsafe_source");
      latestRevision.set(templateRef, Math.max(latestRevision.get(templateRef) ?? 0, row.template_revision));
    }
    const current = registryRows.filter((row) => latestRevision.get(row.template_ref) === row.template_revision);
    const actorAccount = new Map<string, string>(); const ambiguousActors = new Set<string>();
    for (const row of current) {
      const relation = relationPayload(row, input.workspaceId);
      const previous = actorAccount.get(relation.actorRef);
      if (previous && previous !== relation.accountRef) ambiguousActors.add(relation.actorRef);
      else actorAccount.set(relation.actorRef, relation.accountRef);
    }
    const byTemplate = new Map<string, RegistryRow[]>();
    for (const row of current) {
      const group = byTemplate.get(row.template_ref) ?? [];
      group.push(row); byTemplate.set(row.template_ref, group);
    }

    const accounts = new Map<string, PromotionCatalogOption>();
    const actors = new Map<string, ExistingPostPromotionCatalog["actors"][number]>();
    const presets = new Map<string, PromotionCatalogOption>();
    const categories = new Map<string, PromotionCatalogOption>();
    const objectives = new Map<string, PromotionCatalogOption>();
    const budgets = new Map<string, PromotionCatalogOption>();
    const timeframes = new Map<string, PromotionCatalogOption>();
    const templates: ExistingPostPromotionCatalog["templates"][number][] = [];

    for (const [templateRefValue, group] of [...byTemplate.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
      if (templates.length >= 100) fail("source_unavailable");
      const first = group[0]!;
      const templateRef = ref(templateRefValue); const presetRef = ref(first.preset_ref);
      const objectiveRef = ref(first.objective_ref); const budgetRef = ref(first.budget_plan_ref); const timeframeRef = ref(first.timeframe_ref);
      const accountRefs = new Set<string>(); const actorRefs = new Set<string>(); const categoryRefs = new Set<string>();
      for (const row of group) {
        if (row.preset_ref !== first.preset_ref || row.preset_revision !== first.preset_revision
          || row.objective_ref !== first.objective_ref || row.budget_plan_ref !== first.budget_plan_ref
          || row.timeframe_ref !== first.timeframe_ref) fail("unsafe_source");
        const relation = relationPayload(row, input.workspaceId);
        accountRefs.add(relation.accountRef); actorRefs.add(relation.actorRef); categoryRefs.add(ref(row.category_ref));
      }
      if (!accountRefs.size || !actorRefs.size || !categoryRefs.size) fail("unsafe_source");
      if ([...actorRefs].some((actorRef) => ambiguousActors.has(actorRef))) continue;
      if (new Set([...accounts.keys(), ...accountRefs]).size > 100
        || new Set([...actors.keys(), ...actorRefs]).size > 100
        || new Set([...categories.keys(), ...categoryRefs]).size > 100
        || new Set([...presets.keys(), presetRef]).size > 100
        || new Set([...objectives.keys(), objectiveRef]).size > 100
        || new Set([...budgets.keys(), budgetRef]).size > 100
        || new Set([...timeframes.keys(), timeframeRef]).size > 100) fail("source_unavailable");
      const firstDocuments = documents.get(first)!;
      const templateAlias = firstDocuments.template.aliases[0]!;
      const presetAlias = firstDocuments.preset.aliases[0]!;
      for (const row of group) {
        const relation = relationPayload(row, input.workspaceId);
        accounts.set(relation.accountRef, Object.freeze({ ref: relation.accountRef, label: label(row.account_name, "Meta reklam hesabı") }));
        const actorBase = row.actor_username ? `@${row.actor_username}` : row.actor_name;
        actors.set(relation.actorRef, Object.freeze({ ref: relation.actorRef,
          label: label(actorBase, row.actor_type === "page" ? "Facebook Sayfası" : "Instagram hesabı"),
          accountRef: relation.accountRef, type: row.actor_type }));
        categories.set(row.category_ref, Object.freeze({ ref: row.category_ref, label: label(row.category_label, "İç kategori") }));
      }
      presets.set(presetRef, Object.freeze({ ref: presetRef, label: label(`${presetAlias} · r${first.preset_revision}`, "Yayınlanmış hedef kitle preset'i") }));
      objectives.set(objectiveRef, Object.freeze({ ref: objectiveRef, label: label(titleFromRef(objectiveRef), "Meta amacı") }));
      budgets.set(budgetRef, Object.freeze({ ref: budgetRef,
        label: label(`${first.budget_currency} ${displayDecimal(first.budget_default)} / ${first.budget_kind === "daily" ? "gün" : "ömür"}`, "Yayınlanmış bütçe planı") }));
      timeframes.set(timeframeRef, Object.freeze({ ref: timeframeRef,
        label: label(first.schedule_mode === "fixed_duration" && first.duration_days
          ? `${first.duration_days} gün` : "Sürekli", "Yayınlanmış zaman planı") }));
      templates.push(Object.freeze({ ref: templateRef, label: label(`${templateAlias} · r${first.template_revision}`, "Yayınlanmış öne çıkarma şablonu"),
        accountRefs: Object.freeze([...accountRefs].sort()), actorRefs: Object.freeze([...actorRefs].sort()),
        internalCategoryRefs: Object.freeze([...categoryRefs].sort()), objectiveRefs: Object.freeze([objectiveRef]),
        requiredAudiencePresetRef: presetRef }));
    }

    const actorRefs = new Set(actors.keys());
    const posts = new Map<string, ExistingPostPromotionCatalog["posts"][number]>();
    for (const row of postRows) {
      if (!UUID.test(row.post_id) || !UUID.test(row.actor_id)
        || !["facebook_page", "instagram_account"].includes(row.asset_type)) fail("unsafe_source");
      const actorRef = promotionRegistryPublicRef("actor", input.workspaceId, row.actor_id);
      if (!actorRefs.has(actorRef)) continue;
      if (posts.size >= 100) fail("source_unavailable");
      const postRef = promotionRegistryPublicRef("post", input.workspaceId, row.post_id);
      const network = row.asset_type === "facebook_page" ? "Facebook" : "Instagram";
      posts.set(postRef, Object.freeze({ ref: postRef, actorRef,
        label: label(`${network} gönderisi · ${row.media_type ?? "medya"} · ${publicDate(row.published_at)}`, "Yayınlanmış mevcut gönderi") }));
    }

    const adSets = new Map<string, ExistingPostPromotionCatalog["adSets"][number]>();
    for (const row of adSetRows) {
      if (!UUID.test(row.ad_set_id) || !UUID.test(row.account_id) || !UUID.test(row.campaign_id)) fail("unsafe_source");
      const accountRef = promotionRegistryPublicRef("account", input.workspaceId, row.account_id);
      if (!accounts.has(accountRef)) continue;
      if (adSets.size >= 100) fail("source_unavailable");
      const adSetRef = promotionRegistryPublicRef("adset", input.workspaceId, row.ad_set_id);
      adSets.set(adSetRef, Object.freeze({ ref: adSetRef, label: label(row.ad_set_name, "Mevcut reklam seti"), accountRef,
        campaignRef: promotionRegistryPublicRef("campaign", input.workspaceId, row.campaign_id) }));
    }

    return Object.freeze({ accounts: sorted(accounts.values()), actors: sorted(actors.values()), posts: sorted(posts.values()), adSets: sorted(adSets.values()),
      templates: Object.freeze(templates), audiencePresets: sorted(presets.values()), internalCategories: sorted(categories.values()),
      objectives: sorted(objectives.values()), budgetPlans: sorted(budgets.values()), timeframes: sorted(timeframes.values()) });
  }
}
