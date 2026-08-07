import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const EXISTING_POST_PROMOTION_CATALOG_VERSION = "existing-post-promotion-catalog/1.0.0" as const;

export type PromotionCatalogOption = Readonly<{ ref: string; label: string }>;
export type ExistingPostPromotionCatalog = Readonly<{
  accounts: readonly PromotionCatalogOption[];
  actors: readonly Readonly<PromotionCatalogOption & { accountRef: string; type: "page" | "instagram" }>[];
  posts: readonly Readonly<PromotionCatalogOption & { actorRef: string }>[];
  adSets: readonly Readonly<PromotionCatalogOption & { accountRef: string; campaignRef: string }>[];
  templates: readonly Readonly<PromotionCatalogOption & {
    accountRefs: readonly string[];
    actorRefs: readonly string[];
    internalCategoryRefs: readonly string[];
    objectiveRefs: readonly string[];
    requiredAudiencePresetRef: string;
  }>[];
  audiencePresets: readonly PromotionCatalogOption[];
  internalCategories: readonly PromotionCatalogOption[];
  objectives: readonly PromotionCatalogOption[];
  budgetPlans: readonly PromotionCatalogOption[];
  timeframes: readonly PromotionCatalogOption[];
}>;

export type ExistingPostPromotionCatalogResult = Readonly<{
  contractVersion: typeof EXISTING_POST_PROMOTION_CATALOG_VERSION;
  catalog: ExistingPostPromotionCatalog;
  authority: Readonly<{
    readOnly: true;
    canPersist: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canGenerateCreative: false;
  }>;
}>;

export type ExistingPostPromotionCatalogRepository = Readonly<{
  list(input: Readonly<{ workspaceId: string }>): Promise<ExistingPostPromotionCatalog>;
}>;

export class ExistingPostPromotionCatalogError extends Error {
  constructor(readonly code: "invalid_input" | "unsafe_source" | "source_unavailable") {
    super("Öne çıkarma seçim kataloğu güvenli biçimde okunamadı");
    this.name = "ExistingPostPromotionCatalogError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/;
const FULL_HASH = /\b[a-f0-9]{64}\b/i;
const META_ID = /\b(?:act_|campaign_|adset_|ad_)?\d{8,}\b/i;
const CREDENTIAL = /(?:Bearer\s+|rzs1\.|EA[A-Za-z0-9]{24,}|access[_-]?token|secret|prompt|raw[_-]?(?:payload|json))/i;
const AUTHORITY = Object.freeze({
  readOnly: true as const, canPersist: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canGenerateCreative: false as const,
});

function fail(code: ExistingPostPromotionCatalogError["code"]): never { throw new ExistingPostPromotionCatalogError(code); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("unsafe_source");
}
function safeRef(value: unknown): value is string {
  return typeof value === "string" && REF.test(value) && !CREDENTIAL.test(value);
}
function safeLabel(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160
    && !UUID.test(value) && !FULL_HASH.test(value) && !META_ID.test(value) && !CREDENTIAL.test(value);
}
function boundedArray(value: unknown): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > 100) fail("unsafe_source");
}
function relationRefs(value: unknown): asserts value is readonly string[] {
  boundedArray(value);
  if (new Set(value).size !== value.length || value.some((item) => !safeRef(item))) fail("unsafe_source");
}
function option(value: unknown): asserts value is PromotionCatalogOption {
  exact(value, ["ref", "label"]);
  if (!safeRef(value.ref) || !safeLabel(value.label)) fail("unsafe_source");
}
function uniqueRefs(values: readonly PromotionCatalogOption[]): void {
  if (new Set(values.map((item) => item.ref)).size !== values.length) fail("unsafe_source");
}
function freezeCatalog(catalog: ExistingPostPromotionCatalog): ExistingPostPromotionCatalog {
  const options = (values: readonly PromotionCatalogOption[]) => Object.freeze(values.map((item) => Object.freeze({ ...item })));
  return Object.freeze({
    accounts: options(catalog.accounts),
    actors: Object.freeze(catalog.actors.map((item) => Object.freeze({ ...item }))),
    posts: Object.freeze(catalog.posts.map((item) => Object.freeze({ ...item }))),
    adSets: Object.freeze(catalog.adSets.map((item) => Object.freeze({ ...item }))),
    templates: Object.freeze(catalog.templates.map((item) => Object.freeze({ ...item,
      accountRefs: Object.freeze([...item.accountRefs]), actorRefs: Object.freeze([...item.actorRefs]),
      internalCategoryRefs: Object.freeze([...item.internalCategoryRefs]), objectiveRefs: Object.freeze([...item.objectiveRefs]),
    }))),
    audiencePresets: options(catalog.audiencePresets), internalCategories: options(catalog.internalCategories),
    objectives: options(catalog.objectives), budgetPlans: options(catalog.budgetPlans), timeframes: options(catalog.timeframes),
  });
}

export function validateExistingPostPromotionCatalog(value: unknown): ExistingPostPromotionCatalog {
  exact(value, ["accounts", "actors", "posts", "adSets", "templates", "audiencePresets", "internalCategories", "objectives", "budgetPlans", "timeframes"]);
  const keys = ["accounts", "actors", "posts", "adSets", "templates", "audiencePresets", "internalCategories", "objectives", "budgetPlans", "timeframes"] as const;
  for (const key of keys) boundedArray(value[key]);
  const raw = value as Record<typeof keys[number], readonly unknown[]>;
  for (const item of raw.accounts) option(item);
  for (const item of raw.audiencePresets) option(item);
  for (const item of raw.internalCategories) option(item);
  for (const item of raw.objectives) option(item);
  for (const item of raw.budgetPlans) option(item);
  for (const item of raw.timeframes) option(item);
  for (const item of raw.actors) {
    exact(item, ["ref", "label", "accountRef", "type"]);
    if (!safeRef(item.ref) || !safeLabel(item.label) || !safeRef(item.accountRef) || !["page", "instagram"].includes(item.type as string)) fail("unsafe_source");
  }
  for (const item of raw.posts) {
    exact(item, ["ref", "label", "actorRef"]);
    if (!safeRef(item.ref) || !safeLabel(item.label) || !safeRef(item.actorRef)) fail("unsafe_source");
  }
  for (const item of raw.adSets) {
    exact(item, ["ref", "label", "accountRef", "campaignRef"]);
    if (!safeRef(item.ref) || !safeLabel(item.label) || !safeRef(item.accountRef) || !safeRef(item.campaignRef)) fail("unsafe_source");
  }
  for (const item of raw.templates) {
    exact(item, ["ref", "label", "accountRefs", "actorRefs", "internalCategoryRefs", "objectiveRefs", "requiredAudiencePresetRef"]);
    if (!safeRef(item.ref) || !safeLabel(item.label) || !safeRef(item.requiredAudiencePresetRef)) fail("unsafe_source");
    relationRefs(item.accountRefs); relationRefs(item.actorRefs); relationRefs(item.internalCategoryRefs); relationRefs(item.objectiveRefs);
    if (!item.accountRefs.length || !item.actorRefs.length || !item.internalCategoryRefs.length || !item.objectiveRefs.length) fail("unsafe_source");
  }
  const catalog = value as unknown as ExistingPostPromotionCatalog;
  for (const group of [catalog.accounts, catalog.actors, catalog.posts, catalog.adSets, catalog.templates, catalog.audiencePresets,
    catalog.internalCategories, catalog.objectives, catalog.budgetPlans, catalog.timeframes]) uniqueRefs(group);
  const refs = <T extends PromotionCatalogOption>(items: readonly T[]) => new Set(items.map((item) => item.ref));
  const accountRefs = refs(catalog.accounts); const actorRefs = refs(catalog.actors); const presetRefs = refs(catalog.audiencePresets);
  const categoryRefs = refs(catalog.internalCategories); const objectiveRefs = refs(catalog.objectives);
  if (catalog.actors.some((item) => !accountRefs.has(item.accountRef)) || catalog.posts.some((item) => !actorRefs.has(item.actorRef))
    || catalog.adSets.some((item) => !accountRefs.has(item.accountRef))
    || catalog.templates.some((item) => !presetRefs.has(item.requiredAudiencePresetRef)
      || item.accountRefs.some((ref) => !accountRefs.has(ref)) || item.actorRefs.some((ref) => !actorRefs.has(ref))
      || item.internalCategoryRefs.some((ref) => !categoryRefs.has(ref)) || item.objectiveRefs.some((ref) => !objectiveRefs.has(ref)))) fail("unsafe_source");
  return freezeCatalog(catalog);
}

export function parseExistingPostPromotionCatalogResult(value: unknown): ExistingPostPromotionCatalogResult {
  exact(value, ["contractVersion", "catalog", "authority"]);
  if (value.contractVersion !== EXISTING_POST_PROMOTION_CATALOG_VERSION) fail("unsafe_source");
  exact(value.authority, ["readOnly", "canPersist", "canApprove", "canExecute", "canWriteMeta", "canGenerateCreative"]);
  if (value.authority.readOnly !== true || value.authority.canPersist !== false || value.authority.canApprove !== false
    || value.authority.canExecute !== false || value.authority.canWriteMeta !== false || value.authority.canGenerateCreative !== false) fail("unsafe_source");
  return Object.freeze({ contractVersion: EXISTING_POST_PROMOTION_CATALOG_VERSION,
    catalog: validateExistingPostPromotionCatalog(value.catalog), authority: AUTHORITY });
}

export class ExistingPostPromotionCatalogService {
  constructor(
    private readonly repository: ExistingPostPromotionCatalogRepository,
    private readonly memberships: readonly WorkspaceMembership[],
  ) {}

  async list(principal: TrustedDecisionRoomPrincipal): Promise<ExistingPostPromotionCatalogResult> {
    if (!UUID.test(principal.workspaceId) || !safeRef(principal.workspaceRef)) fail("invalid_input");
    authorizeWorkspace(principal.actor, principal.workspaceId, "data:read", this.memberships);
    let source: ExistingPostPromotionCatalog;
    try { source = await this.repository.list({ workspaceId: principal.workspaceId }); }
    catch (reason) { if (reason instanceof ExistingPostPromotionCatalogError) throw reason; fail("source_unavailable"); }
    return Object.freeze({ contractVersion: EXISTING_POST_PROMOTION_CATALOG_VERSION,
      catalog: validateExistingPostPromotionCatalog(source), authority: AUTHORITY });
  }
}
