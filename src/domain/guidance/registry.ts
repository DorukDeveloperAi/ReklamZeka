import { createHash } from "node:crypto";

export const GUIDANCE_REGISTRY_VERSION = "guidance-registry/1.0.0" as const;
export const EFFECTIVE_GUIDANCE_PACK_VERSION = "effective-guidance-pack/1.1.0" as const;
export const GUIDANCE_REGISTRY_LIMITS = Object.freeze({
  sources: 1_000, cards: 500, bindings: 6_000, sets: 250,
  sourcesPerCard: 12, bindingsPerCard: 12, cardsPerSet: 50,
  evaluatedCards: 500, evaluatedSources: 1_000,
  accountGroups: 25, internalCategories: 100, promotionTemplates: 50,
  topics: 100, requiredTopics: 100, guidanceSets: 50,
});

export type GuidanceSourceType =
  | "owner_statement"
  | "official_meta_guidance"
  | "business_strategy"
  | "observed_result"
  | "experiment_outcome"
  | "operating_note";

export type GuidanceSource = Readonly<{
  id: string;
  workspaceId: string;
  sourceType: GuidanceSourceType;
  title: string;
  sourceRef: string;
  sourceUrl: string | null;
  content: string;
  author: string | null;
  capturedAt: string | null;
  reviewedAt: string | null;
  reviewBy: string | null;
  status: "draft" | "published" | "archived";
  version: number;
}>;

export type GuidanceStrength = "must" | "should" | "consider" | "avoid" | "question";
export type GuidanceScopeFacet =
  | "global"
  | "account_group"
  | "account"
  | "objective"
  | "funnel"
  | "optimization"
  | "internal_category"
  | "lifecycle"
  | "entity"
  | "promotion_template"
  | "topic";
export type GuidanceEntityType = "campaign" | "ad_set" | "ad" | "creative" | "post";

export type GuidanceCard = Readonly<{
  id: string;
  workspaceId: string;
  sourceType: GuidanceSourceType;
  sourceIds: readonly string[];
  title: string;
  body: string;
  rationale: string | null;
  strength: GuidanceStrength;
  topic: string;
  decisionKey: string | null;
  positionKey: string | null;
  authority: "guidance_only";
  status: "draft" | "published" | "archived";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  ownerRef: string;
  version: number;
}>;

export type GuidanceBinding = Readonly<{
  id: string;
  workspaceId: string;
  cardId: string;
  facet: GuidanceScopeFacet;
  value: string | null;
  entityType: GuidanceEntityType | null;
  mode: "default" | "exception";
  priority: number;
  version: number;
}>;

export type GuidanceSet = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
  orderedCardIds: readonly string[];
  reviewStatus: "draft" | "reviewed" | "archived";
  version: number;
}>;

export type GuidanceRegistry = Readonly<{
  schemaVersion: typeof GUIDANCE_REGISTRY_VERSION;
  workspaceId: string;
  sources: readonly GuidanceSource[];
  cards: readonly GuidanceCard[];
  bindings: readonly GuidanceBinding[];
  sets: readonly GuidanceSet[];
  registryHash: string;
}>;

export type GuidanceContext = Readonly<{
  workspaceId: string;
  accountId: string;
  accountGroupIds?: readonly string[];
  objective: string | null;
  funnel?: string | null;
  optimization?: string | null;
  internalCategoryIds: readonly string[];
  lifecycle?: string | null;
  entity: Readonly<{ type: GuidanceEntityType; id: string }> | null;
  promotionTemplateIds?: readonly string[];
  topics: readonly string[];
  requiredTopics: readonly string[];
  guidanceSetIds?: readonly string[];
  evaluatedAt: string;
  budget: Readonly<{
    maxCards: number;
    maxSources: number;
    maxCharacters: number;
  }>;
}>;

export type GuidancePackReason =
  | "applied"
  | "scope_not_matched"
  | "outside_effective_interval"
  | "source_unpublished"
  | "source_review_due"
  | "set_not_selected"
  | "overridden_by_higher_precedence"
  | "unresolved_conflict"
  | "card_budget_exhausted"
  | "source_budget_exhausted"
  | "character_budget_exhausted";

export type AppliedGuidanceCard = Readonly<{
  cardId: string;
  cardVersion: number;
  cardHash: string;
  title: string;
  body: string;
  strength: GuidanceStrength;
  topic: string;
  sourceIds: readonly string[];
  sourceType: GuidanceSourceType;
  scopeReason: readonly string[];
  mode: "default" | "exception";
  priority: number;
  authority: "guidance_only";
  trustLevel: "untrusted_guidance";
  reason: "applied";
}>;

export type EffectiveGuidancePack = Readonly<{
  schemaVersion: typeof EFFECTIVE_GUIDANCE_PACK_VERSION;
  /** Internal tenant scope; public projections must redact it. */
  workspaceId: string;
  registryHash: string;
  selectedSets: readonly Readonly<{ setId: string; setVersion: number; setHash: string }>[];
  evaluatedCards: readonly Readonly<{ cardId: string; cardVersion: number; cardHash: string }>[];
  evaluatedSources: readonly Readonly<{ sourceId: string; sourceVersion: number; sourceHash: string }>[];
  evaluatedAt: string;
  applied: readonly AppliedGuidanceCard[];
  suppressed: readonly Readonly<{ cardId: string; reason: Exclude<GuidancePackReason, "applied"> }>[];
  conflicting: readonly Readonly<{
    decisionKey: string;
    cardIds: readonly string[];
    reason: "unresolved_conflict";
  }>[];
  missing: readonly Readonly<{
    topic: string;
    reason: "no_applicable_guidance" | "all_candidates_suppressed" | "conflict_unresolved" | "context_budget_exhausted";
  }>[];
  sources: readonly Readonly<{
    sourceId: string;
    sourceVersion: number;
    sourceHash: string;
    sourceType: GuidanceSourceType;
    sourceRef: string;
    sourceUrl: string | null;
    capturedAt: string | null;
    reviewedAt: string | null;
    reviewBy: string | null;
    freshness: "current" | "not_scheduled";
  }>[];
  budget: Readonly<{
    limits: GuidanceContext["budget"];
    usedCards: number;
    usedSources: number;
    usedCharacters: number;
    truncated: boolean;
    moreAvailable: boolean;
  }>;
  capabilities: Readonly<{
    canAuthorizeAction: false;
    canEnforcePolicy: false;
    canAlterApproval: false;
  }>;
  packHash: string;
}>;

export class GuidanceRegistryValidationError extends Error {
  constructor(
    readonly code:
      | "invalid_registry"
      | "duplicate_identity"
      | "invalid_reference"
      | "mixed_source_types"
      | "official_source_incomplete"
      | "invalid_binding"
      | "authority_escalation",
    message: string,
  ) {
    super(message);
    this.name = "GuidanceRegistryValidationError";
  }
}

export class GuidanceContextValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidanceContextValidationError";
  }
}

const SOURCE_TYPES = new Set<GuidanceSourceType>([
  "owner_statement", "official_meta_guidance", "business_strategy",
  "observed_result", "experiment_outcome", "operating_note",
]);
const SOURCE_STATUSES = new Set(["draft", "published", "archived"]);
const CARD_STATUSES = new Set(["draft", "published", "archived"]);
const STRENGTHS = new Set<GuidanceStrength>(["must", "should", "consider", "avoid", "question"]);
const FACETS = new Set<GuidanceScopeFacet>([
  "global", "account_group", "account", "objective", "funnel", "optimization",
  "internal_category", "lifecycle", "entity", "promotion_template", "topic",
]);
const ENTITY_TYPES = new Set<GuidanceEntityType>(["campaign", "ad_set", "ad", "creative", "post"]);
const BINDING_MODES = new Set(["default", "exception"]);
const SET_REVIEW_STATUSES = new Set(["draft", "reviewed", "archived"]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GuidanceRegistryValidationError("invalid_registry", `${label} zorunludur`);
  }
}

function requireBoundedText(value: unknown, label: string, max: number): asserts value is string {
  requireText(value, label);
  if (value.length > max) {
    throw new GuidanceRegistryValidationError("invalid_registry", `${label} en fazla ${max} karakter olabilir`);
  }
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function canonicalIso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new GuidanceRegistryValidationError("duplicate_identity", `${label} kimliği tekrarlı olamaz`);
  }
}

export function isOfficialGuidanceSourceUrl(value: string): boolean {
  try {
    if (value !== value.trim() || /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
    // WHATWG URL normalizes dot segments before exposing pathname. Reject them
    // from the raw path so the application and PostgreSQL validator make the
    // same fail-closed decision instead of approving a rewritten URL.
    const schemeEnd = value.indexOf("//");
    const relativeAuthorityEnd = schemeEnd === -1 ? -1 : value.slice(schemeEnd + 2).search(/[/?#]/);
    const rawAuthority = relativeAuthorityEnd === -1 ? value.slice(schemeEnd + 2)
      : value.slice(schemeEnd + 2, schemeEnd + 2 + relativeAuthorityEnd);
    const rawPathAndQuery = relativeAuthorityEnd === -1 ? "" : value.slice(schemeEnd + 2 + relativeAuthorityEnd);
    const rawPath = rawPathAndQuery.split(/[?#]/, 1)[0]!;
    if ((rawAuthority.includes(":") && !rawAuthority.endsWith(":443"))
      || value.includes("\\") || /(^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(rawPath)) return false;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    if ((host === "facebook.com" || host === "www.facebook.com")
      && ["/business/help", "/business/ads-guide"].some((root) => path === root || path.startsWith(`${root}/`))) return true;
    if (host === "developers.facebook.com" && (path === "/docs" || path.startsWith("/docs/"))) return true;
    if ((host === "meta.com" || host === "www.meta.com")
      && ["/help", "/business", "/policies", "/technologies"].some((root) => path === root || path.startsWith(`${root}/`))) return true;
    if (host === "developers.meta.com") return path === "/" || path === "/docs" || path.startsWith("/docs/");
    if (host === "transparency.meta.com") return path === "/policies" || path.startsWith("/policies/");
    if (host === "developers.instagram.com") return path === "/" || path === "/docs" || path.startsWith("/docs/");
    if (host === "help.instagram.com") return path === "/" || /^\/[0-9]+(?:\/.*)?$/.test(path);
    if (host === "business.instagram.com") return path === "/blog" || path.startsWith("/blog/");
    return false;
  } catch {
    return false;
  }
}

function assertOfficialSource(source: GuidanceSource): void {
  if (source.sourceType !== "official_meta_guidance" || source.status !== "published") return;
  if (
    typeof source.sourceRef !== "string"
    || !source.sourceRef.trim()
    || typeof source.sourceUrl !== "string"
    || !isOfficialGuidanceSourceUrl(source.sourceUrl)
    || !validIso(source.capturedAt)
    || !validIso(source.reviewedAt)
    || !validIso(source.reviewBy)
    || Date.parse(source.reviewedAt!) < Date.parse(source.capturedAt!)
    || Date.parse(source.reviewBy!) <= Date.parse(source.reviewedAt!)
  ) {
    throw new GuidanceRegistryValidationError(
      "official_source_incomplete",
      "Official Meta guidance publish için HTTPS kaynak, ref, captured/reviewed/review-by zorunludur",
    );
  }
}

function assertBinding(binding: GuidanceBinding): void {
  if (!FACETS.has(binding.facet) || !BINDING_MODES.has(binding.mode)
    || binding.entityType !== null && !ENTITY_TYPES.has(binding.entityType)) {
    throw new GuidanceRegistryValidationError("invalid_binding", "Guidance binding facet/mode/entityType allowlist dışında");
  }
  if (!Number.isSafeInteger(binding.priority) || binding.priority < 0 || binding.priority > 100) {
    throw new GuidanceRegistryValidationError("invalid_binding", "Guidance binding priority 0–100 olmalıdır");
  }
  if (!Number.isSafeInteger(binding.version) || binding.version < 1) {
    throw new GuidanceRegistryValidationError("invalid_binding", "Guidance binding version pozitif olmalıdır");
  }
  if (binding.facet === "global") {
    if (binding.value !== null || binding.entityType !== null) {
      throw new GuidanceRegistryValidationError("invalid_binding", "Global binding value/entity taşıyamaz");
    }
    return;
  }
  if (!binding.value?.trim()) {
    throw new GuidanceRegistryValidationError("invalid_binding", "Scoped binding değeri zorunludur");
  }
  if (binding.value.length > 128) {
    throw new GuidanceRegistryValidationError("invalid_binding", "Scoped binding değeri çok uzundur");
  }
  if ((binding.facet === "entity") !== (binding.entityType !== null)) {
    throw new GuidanceRegistryValidationError("invalid_binding", "Entity binding entityType ve value birlikte taşımalıdır");
  }
}

/** Validates and freezes a replay-stable, model-free guidance registry. */
export function createGuidanceRegistry(input: Readonly<{
  workspaceId: string;
  sources: readonly GuidanceSource[];
  cards: readonly GuidanceCard[];
  bindings: readonly GuidanceBinding[];
  sets: readonly GuidanceSet[];
}>): GuidanceRegistry {
  requireBoundedText(input.workspaceId, "Workspace ID", 128);
  if (input.sources.length > GUIDANCE_REGISTRY_LIMITS.sources
    || input.cards.length > GUIDANCE_REGISTRY_LIMITS.cards
    || input.bindings.length > GUIDANCE_REGISTRY_LIMITS.bindings
    || input.sets.length > GUIDANCE_REGISTRY_LIMITS.sets) {
    throw new GuidanceRegistryValidationError("invalid_registry", "Guidance registry güvenli cardinality sınırını aşıyor");
  }
  assertUnique(input.sources.map((row) => row.id), "Source");
  assertUnique(input.cards.map((row) => row.id), "Card");
  assertUnique(input.bindings.map((row) => row.id), "Binding");
  assertUnique(input.sets.map((row) => row.id), "Set");
  const sources = new Map(input.sources.map((row) => [row.id, row] as const));
  const cards = new Map(input.cards.map((row) => [row.id, row] as const));

  for (const source of input.sources) {
    requireBoundedText(source.id, "Source ID", 128);
    requireBoundedText(source.title, "Source title", 160);
    requireBoundedText(source.content, "Source content", 12_000);
    if (!SOURCE_TYPES.has(source.sourceType) || !SOURCE_STATUSES.has(source.status)) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Source type/status allowlist dışında");
    }
    assertOfficialSource(source);
    requireBoundedText(source.sourceRef, "Source ref", 2_048);
    if (source.author !== null && source.author.length > 128) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Source author çok uzun");
    }
    if (source.sourceUrl !== null && source.sourceUrl.length > 2_048) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Source URL çok uzun");
    }
    if (source.workspaceId !== input.workspaceId || !Number.isSafeInteger(source.version) || source.version < 1) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Source workspace/version geçersizdir");
    }
    for (const date of [source.capturedAt, source.reviewedAt, source.reviewBy]) {
      if (date !== null && !validIso(date)) throw new GuidanceRegistryValidationError("invalid_registry", "Source tarihi geçersizdir");
    }
  }
  for (const card of input.cards) {
    requireBoundedText(card.id, "Card ID", 128);
    requireBoundedText(card.title, "Card title", 160);
    requireBoundedText(card.body, "Card body", 12_000);
    requireBoundedText(card.topic, "Card topic", 80);
    requireBoundedText(card.ownerRef, "Card owner ref", 128);
    if (card.rationale !== null && card.rationale.length > 4_000) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Card rationale çok uzun");
    }
    if (card.decisionKey !== null && card.decisionKey.length > 128
      || card.positionKey !== null && card.positionKey.length > 128) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Decision/position key çok uzun");
    }
    if (!SOURCE_TYPES.has(card.sourceType) || !CARD_STATUSES.has(card.status) || !STRENGTHS.has(card.strength)) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Card sourceType/status/strength allowlist dışında");
    }
    if (
      card.workspaceId !== input.workspaceId
      || card.authority !== "guidance_only"
      || !Number.isSafeInteger(card.version)
      || card.version < 1
    ) {
      throw new GuidanceRegistryValidationError(
        card.authority !== "guidance_only" ? "authority_escalation" : "invalid_registry",
        "Card workspace/version/authority geçersizdir",
      );
    }
    if (card.sourceIds.length === 0 || card.sourceIds.length > GUIDANCE_REGISTRY_LIMITS.sourcesPerCard
      || new Set(card.sourceIds).size !== card.sourceIds.length) {
      throw new GuidanceRegistryValidationError("invalid_reference", "Card en az bir benzersiz source ref taşımalıdır");
    }
    const referenced = card.sourceIds.map((id) => sources.get(id));
    if (referenced.some((source) => !source)) {
      throw new GuidanceRegistryValidationError("invalid_reference", "Card bilinmeyen source ref taşıyor");
    }
    if (referenced.some((source) => source!.sourceType !== card.sourceType)) {
      throw new GuidanceRegistryValidationError("mixed_source_types", "Tek GuidanceCard farklı provenance türlerini eritemez");
    }
    if (card.status === "published" && referenced.some((source) => source!.status !== "published")) {
      throw new GuidanceRegistryValidationError("invalid_reference", "Published card yalnız published source kullanabilir");
    }
    if ((card.decisionKey === null) !== (card.positionKey === null)) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Decision/position key birlikte tanımlanmalıdır");
    }
    if (card.effectiveFrom !== null && !validIso(card.effectiveFrom)
      || card.effectiveTo !== null && !validIso(card.effectiveTo)
      || card.effectiveFrom !== null && card.effectiveTo !== null
        && Date.parse(card.effectiveFrom) >= Date.parse(card.effectiveTo)) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Card effective interval geçersizdir");
    }
  }
  const bindingCards = new Set<string>();
  const bindingCounts = new Map<string, number>();
  for (const binding of input.bindings) {
    requireBoundedText(binding.id, "Binding ID", 128);
    if (binding.workspaceId !== input.workspaceId || !cards.has(binding.cardId)) {
      throw new GuidanceRegistryValidationError("invalid_reference", "Binding workspace/card ref geçersizdir");
    }
    assertBinding(binding);
    const count = (bindingCounts.get(binding.cardId) ?? 0) + 1;
    if (count > GUIDANCE_REGISTRY_LIMITS.bindingsPerCard) {
      throw new GuidanceRegistryValidationError("invalid_binding", "Tek card binding sınırını aşıyor");
    }
    bindingCounts.set(binding.cardId, count);
    bindingCards.add(binding.cardId);
  }
  if (input.cards.some((card) => card.status === "published" && !bindingCards.has(card.id))) {
    throw new GuidanceRegistryValidationError("invalid_binding", "Published card en az bir scope binding taşımalıdır");
  }
  for (const set of input.sets) {
    requireBoundedText(set.id, "Set ID", 128);
    requireBoundedText(set.name, "Set name", 160);
    if (!SET_REVIEW_STATUSES.has(set.reviewStatus)) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Set review status allowlist dışında");
    }
    if (set.workspaceId !== input.workspaceId || !Number.isSafeInteger(set.version) || set.version < 1) {
      throw new GuidanceRegistryValidationError("invalid_registry", "Set workspace/version geçersizdir");
    }
    if (set.orderedCardIds.length > GUIDANCE_REGISTRY_LIMITS.cardsPerSet
      || new Set(set.orderedCardIds).size !== set.orderedCardIds.length
      || set.orderedCardIds.some((id) => !cards.has(id))) {
      throw new GuidanceRegistryValidationError("invalid_reference", "Set card sırası tekrarlı veya bilinmeyen ref taşıyor");
    }
  }
  const canonical = stableValue({
    schemaVersion: GUIDANCE_REGISTRY_VERSION,
    workspaceId: input.workspaceId,
    sources: [...input.sources].map((source) => ({
      ...source,
      capturedAt: canonicalIso(source.capturedAt),
      reviewedAt: canonicalIso(source.reviewedAt),
      reviewBy: canonicalIso(source.reviewBy),
    })).sort((a, b) => compareText(a.id, b.id)),
    cards: [...input.cards].map((card) => ({
      ...card,
      effectiveFrom: canonicalIso(card.effectiveFrom),
      effectiveTo: canonicalIso(card.effectiveTo),
    })).sort((a, b) => compareText(a.id, b.id)),
    bindings: [...input.bindings].sort((a, b) => compareText(a.id, b.id)),
    sets: [...input.sets].sort((a, b) => compareText(a.id, b.id)),
  }) as Omit<GuidanceRegistry, "registryHash">;
  return Object.freeze({ ...canonical, registryHash: digest(canonical) });
}

type Candidate = Readonly<{
  card: GuidanceCard;
  sources: readonly GuidanceSource[];
  scopeReason: readonly string[];
  mode: "default" | "exception";
  priority: number;
  specificity: number;
  freshnessAt: number;
}>;

const FACET_ORDER: Readonly<Record<GuidanceScopeFacet, number>> = {
  global: 0,
  account_group: 1,
  account: 2,
  objective: 3,
  funnel: 4,
  optimization: 5,
  internal_category: 6,
  lifecycle: 7,
  entity: 8,
  promotion_template: 9,
  topic: 10,
};
const SCOPE_WEIGHT: Readonly<Record<GuidanceScopeFacet, number>> = {
  global: 0,
  account_group: 5,
  account: 10,
  objective: 20,
  funnel: 22,
  optimization: 24,
  internal_category: 30,
  lifecycle: 32,
  entity: 40,
  promotion_template: 35,
  topic: 1,
};
const STRENGTH_RANK: Readonly<Record<GuidanceStrength, number>> = {
  must: 4,
  avoid: 4,
  should: 3,
  consider: 2,
  question: 1,
};

function bindingMatches(binding: GuidanceBinding, context: GuidanceContext): boolean {
  switch (binding.facet) {
    case "global": return true;
    case "account_group": return (context.accountGroupIds ?? []).includes(binding.value!);
    case "account": return binding.value === context.accountId;
    case "objective": return binding.value === context.objective;
    case "funnel": return binding.value === (context.funnel ?? null);
    case "optimization": return binding.value === (context.optimization ?? null);
    case "internal_category": return context.internalCategoryIds.includes(binding.value!);
    case "lifecycle": return binding.value === (context.lifecycle ?? null);
    case "entity": return binding.entityType === context.entity?.type && binding.value === context.entity.id;
    case "promotion_template": return (context.promotionTemplateIds ?? []).includes(binding.value!);
    case "topic": return context.topics.includes(binding.value!);
  }
}

function matchingBindings(
  cardBindings: readonly GuidanceBinding[],
  context: GuidanceContext,
): readonly GuidanceBinding[] | null {
  const grouped = new Map<GuidanceScopeFacet, GuidanceBinding[]>();
  for (const binding of cardBindings) grouped.set(binding.facet, [...(grouped.get(binding.facet) ?? []), binding]);
  const matched: GuidanceBinding[] = [];
  for (const bindings of grouped.values()) {
    const facetMatches = bindings.filter((binding) => bindingMatches(binding, context));
    if (facetMatches.length === 0) return null;
    matched.push(...facetMatches);
  }
  return matched.sort((a, b) => FACET_ORDER[a.facet] - FACET_ORDER[b.facet] || compareText(a.id, b.id));
}

function precedence(candidate: Candidate): readonly number[] {
  return [candidate.mode === "exception" ? 1 : 0, candidate.specificity, candidate.priority, STRENGTH_RANK[candidate.card.strength]];
}

function comparePrecedence(left: Candidate, right: Candidate): number {
  const a = precedence(left);
  const b = precedence(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index]! - a[index]!;
  }
  return 0;
}

function candidateOrder(left: Candidate, right: Candidate): number {
  return comparePrecedence(left, right)
    || right.freshnessAt - left.freshnessAt
    || compareText(left.card.id, right.card.id);
}

function validateContext(registry: GuidanceRegistry, context: GuidanceContext): void {
  const accountGroups = context.accountGroupIds ?? [];
  const promotionTemplates = context.promotionTemplateIds ?? [];
  const requestedSets = context.guidanceSetIds ?? [];
  if (
    context.workspaceId !== registry.workspaceId
    || !context.accountId.trim() || context.accountId.length > 128
    || !Number.isFinite(Date.parse(context.evaluatedAt))
    || context.internalCategoryIds.length > GUIDANCE_REGISTRY_LIMITS.internalCategories
    || context.topics.length > GUIDANCE_REGISTRY_LIMITS.topics
    || context.requiredTopics.length > GUIDANCE_REGISTRY_LIMITS.requiredTopics
    || accountGroups.length > GUIDANCE_REGISTRY_LIMITS.accountGroups
    || promotionTemplates.length > GUIDANCE_REGISTRY_LIMITS.promotionTemplates
    || requestedSets.length > GUIDANCE_REGISTRY_LIMITS.guidanceSets
    || context.internalCategoryIds.some((ref) => !ref.trim() || ref.length > 128)
    || new Set(context.internalCategoryIds).size !== context.internalCategoryIds.length
    || context.topics.some((topic) => !topic.trim() || topic.length > 80)
    || new Set(context.topics).size !== context.topics.length
    || context.requiredTopics.some((topic) => !topic.trim() || topic.length > 80)
    || new Set(context.requiredTopics).size !== context.requiredTopics.length
    || accountGroups.some((ref) => !ref.trim() || ref.length > 128)
    || new Set(accountGroups).size !== accountGroups.length
    || promotionTemplates.some((ref) => !ref.trim() || ref.length > 128)
    || new Set(promotionTemplates).size !== promotionTemplates.length
    || [context.funnel, context.optimization, context.lifecycle]
      .some((value) => value !== undefined && value !== null && (!value.trim() || value.length > 80))
    || context.objective !== null && (!context.objective.trim() || context.objective.length > 80)
    || context.entity !== null && (!context.entity.id.trim() || context.entity.id.length > 128)
    || !Number.isSafeInteger(context.budget.maxCards) || context.budget.maxCards < 1 || context.budget.maxCards > 100
    || !Number.isSafeInteger(context.budget.maxSources) || context.budget.maxSources < 1 || context.budget.maxSources > 100
    || !Number.isSafeInteger(context.budget.maxCharacters) || context.budget.maxCharacters < 1 || context.budget.maxCharacters > 100_000
  ) throw new GuidanceContextValidationError("Effective guidance context kapsamı veya bütçesi geçersizdir");
  if (new Set(requestedSets).size !== requestedSets.length
    || requestedSets.some((id) => id.length > 128 || !registry.sets.some((set) => set.id === id))) {
    throw new GuidanceContextValidationError("Guidance set seçimi geçersizdir");
  }
}

function missingReason(
  topic: string,
  applied: readonly AppliedGuidanceCard[],
  suppressed: readonly { cardId: string; reason: Exclude<GuidancePackReason, "applied"> }[],
  conflicts: readonly { cardIds: readonly string[] }[],
  cards: ReadonlyMap<string, GuidanceCard>,
): "no_applicable_guidance" | "all_candidates_suppressed" | "conflict_unresolved" | "context_budget_exhausted" | null {
  if (applied.some((entry) => entry.topic === topic)) return null;
  if (conflicts.some((entry) => entry.cardIds.some((id) => cards.get(id)?.topic === topic))) return "conflict_unresolved";
  const topicSuppressed = suppressed.filter((entry) => cards.get(entry.cardId)?.topic === topic);
  if (topicSuppressed.some((entry) => entry.reason.endsWith("budget_exhausted"))) return "context_budget_exhausted";
  if (topicSuppressed.length > 0) return "all_candidates_suppressed";
  return "no_applicable_guidance";
}

/**
 * Scope filtering, conflict handling and context budgeting are deterministic.
 * This pack is advisory data; it cannot mint policy, approval or action rights.
 */
export function buildEffectiveGuidancePack(
  registry: GuidanceRegistry,
  context: GuidanceContext,
): EffectiveGuidancePack {
  validateContext(registry, context);
  const evaluatedAt = new Date(context.evaluatedAt).toISOString();
  const at = Date.parse(evaluatedAt);
  const sources = new Map(registry.sources.map((row) => [row.id, row] as const));
  const cards = new Map(registry.cards.map((row) => [row.id, row] as const));
  const bindingMap = new Map<string, GuidanceBinding[]>();
  for (const binding of registry.bindings) {
    bindingMap.set(binding.cardId, [...(bindingMap.get(binding.cardId) ?? []), binding]);
  }
  const requestedSets = context.guidanceSetIds;
  const selectedSets = registry.sets
    .filter((set) => requestedSets?.includes(set.id) && set.reviewStatus === "reviewed")
    .map((set) => ({ setId: set.id, setVersion: set.version, setHash: digest(set) }))
    .sort((left, right) => compareText(left.setId, right.setId));
  const selectedCardIds = requestedSets
    ? new Set(registry.sets.filter((set) => requestedSets.includes(set.id) && set.reviewStatus === "reviewed")
      .flatMap((set) => set.orderedCardIds))
    : null;
  const suppressed: { cardId: string; reason: Exclude<GuidancePackReason, "applied"> }[] = [];
  const candidates: Candidate[] = [];

  for (const card of registry.cards.filter((row) => row.status === "published")) {
    if (selectedCardIds && !selectedCardIds.has(card.id)) {
      suppressed.push({ cardId: card.id, reason: "set_not_selected" });
      continue;
    }
    if (card.effectiveFrom !== null && at < Date.parse(card.effectiveFrom)
      || card.effectiveTo !== null && at >= Date.parse(card.effectiveTo)) {
      suppressed.push({ cardId: card.id, reason: "outside_effective_interval" });
      continue;
    }
    const cardSources = card.sourceIds.map((id) => sources.get(id)!);
    if (cardSources.some((source) => source.status !== "published")) {
      suppressed.push({ cardId: card.id, reason: "source_unpublished" });
      continue;
    }
    if (cardSources.some((source) => source.reviewBy !== null && at >= Date.parse(source.reviewBy))) {
      suppressed.push({ cardId: card.id, reason: "source_review_due" });
      continue;
    }
    const matched = matchingBindings(bindingMap.get(card.id) ?? [], context);
    if (!matched) {
      suppressed.push({ cardId: card.id, reason: "scope_not_matched" });
      continue;
    }
    const facets = [...new Set(matched.map((binding) => binding.facet))];
    candidates.push({
      card,
      sources: cardSources,
      scopeReason: facets.sort((a, b) => FACET_ORDER[a] - FACET_ORDER[b]).map((facet) => `matched:${facet}`),
      mode: matched.some((binding) => binding.mode === "exception") ? "exception" : "default",
      priority: Math.max(...matched.map((binding) => binding.priority)),
      specificity: facets.reduce((total, facet) => total + SCOPE_WEIGHT[facet], 0),
      freshnessAt: Math.max(...cardSources.map((source) => Date.parse(source.reviewedAt ?? source.capturedAt ?? "1970-01-01T00:00:00.000Z"))),
    });
  }

  const conflicting: { decisionKey: string; cardIds: readonly string[]; reason: "unresolved_conflict" }[] = [];
  const eligible = new Set(candidates.map((candidate) => candidate.card.id));
  const decisionGroups = new Map<string, Candidate[]>();
  for (const candidate of candidates.filter((row) => row.card.decisionKey !== null)) {
    decisionGroups.set(candidate.card.decisionKey!, [...(decisionGroups.get(candidate.card.decisionKey!) ?? []), candidate]);
  }
  for (const [decisionKey, group] of decisionGroups) {
    const positions = new Set(group.map((candidate) => candidate.card.positionKey));
    if (positions.size < 2) continue;
    const ordered = [...group].sort(candidateOrder);
    const top = ordered[0]!;
    const tied = ordered.filter((candidate) => comparePrecedence(top, candidate) === 0);
    if (new Set(tied.map((candidate) => candidate.card.positionKey)).size > 1) {
      const cardIds = tied.map((candidate) => candidate.card.id).sort(compareText);
      conflicting.push({ decisionKey, cardIds, reason: "unresolved_conflict" });
      // No lower-precedence row may become an accidental winner while the top
      // positions are unresolved. The whole decision group stays advisory-only.
      for (const candidate of group) {
        eligible.delete(candidate.card.id);
        suppressed.push({ cardId: candidate.card.id, reason: "unresolved_conflict" });
      }
      continue;
    }
    for (const candidate of ordered) {
      if (candidate.card.positionKey !== top.card.positionKey && comparePrecedence(top, candidate) < 0) {
        eligible.delete(candidate.card.id);
        suppressed.push({ cardId: candidate.card.id, reason: "overridden_by_higher_precedence" });
      }
    }
  }

  const applied: AppliedGuidanceCard[] = [];
  const includedSourceIds = new Set<string>();
  let usedCharacters = 0;
  for (const candidate of candidates.filter((row) => eligible.has(row.card.id)).sort(candidateOrder)) {
    const introducedSources = candidate.card.sourceIds.filter((id) => !includedSourceIds.has(id));
    const characters = candidate.card.title.length + candidate.card.body.length;
    if (applied.length >= context.budget.maxCards) {
      suppressed.push({ cardId: candidate.card.id, reason: "card_budget_exhausted" });
      continue;
    }
    if (includedSourceIds.size + introducedSources.length > context.budget.maxSources) {
      suppressed.push({ cardId: candidate.card.id, reason: "source_budget_exhausted" });
      continue;
    }
    if (usedCharacters + characters > context.budget.maxCharacters) {
      suppressed.push({ cardId: candidate.card.id, reason: "character_budget_exhausted" });
      continue;
    }
    introducedSources.forEach((id) => includedSourceIds.add(id));
    usedCharacters += characters;
    applied.push({
      cardId: candidate.card.id,
      cardVersion: candidate.card.version,
      cardHash: digest(candidate.card),
      title: candidate.card.title,
      body: candidate.card.body,
      strength: candidate.card.strength,
      topic: candidate.card.topic,
      sourceIds: [...candidate.card.sourceIds].sort(compareText),
      sourceType: candidate.card.sourceType,
      scopeReason: candidate.scopeReason,
      mode: candidate.mode,
      priority: candidate.priority,
      authority: "guidance_only",
      trustLevel: "untrusted_guidance",
      reason: "applied",
    });
  }
  const budgetReasons = new Set(["card_budget_exhausted", "source_budget_exhausted", "character_budget_exhausted"]);
  const budgetSuppressed = suppressed.some((entry) => budgetReasons.has(entry.reason));
  const sourceProjection = [...includedSourceIds].sort(compareText).map((id) => {
    const source = sources.get(id)!;
    return {
      sourceId: source.id,
      sourceVersion: source.version,
      sourceHash: digest(source),
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
      sourceUrl: source.sourceUrl,
      capturedAt: source.capturedAt,
      reviewedAt: source.reviewedAt,
      reviewBy: source.reviewBy,
      freshness: source.reviewBy === null ? "not_scheduled" as const : "current" as const,
    };
  });
  const missing = [...new Set(context.requiredTopics)].sort(compareText).flatMap((topic) => {
    const reason = missingReason(topic, applied, suppressed, conflicting, cards);
    return reason ? [{ topic, reason }] : [];
  });
  const evaluatedCardIds = [...new Set([
    ...applied.map((entry) => entry.cardId), ...suppressed.map((entry) => entry.cardId),
    ...conflicting.flatMap((entry) => entry.cardIds),
  ])].sort(compareText);
  const evaluatedCards = evaluatedCardIds.map((cardId) => {
    const card = cards.get(cardId)!;
    return { cardId, cardVersion: card.version, cardHash: digest(card) };
  });
  const evaluatedSourceIds = [...new Set(evaluatedCardIds.flatMap((cardId) => cards.get(cardId)!.sourceIds))]
    .sort(compareText);
  if (evaluatedCardIds.length > GUIDANCE_REGISTRY_LIMITS.evaluatedCards
    || evaluatedSourceIds.length > GUIDANCE_REGISTRY_LIMITS.evaluatedSources) {
    throw new GuidanceContextValidationError("Evaluated guidance revision manifest güvenli sınırı aşıyor");
  }
  const evaluatedSources = evaluatedSourceIds.map((sourceId) => {
    const source = sources.get(sourceId)!;
    return { sourceId, sourceVersion: source.version, sourceHash: digest(source) };
  });
  const core = stableValue({
    schemaVersion: EFFECTIVE_GUIDANCE_PACK_VERSION,
    workspaceId: context.workspaceId,
    registryHash: registry.registryHash,
    selectedSets,
    evaluatedCards,
    evaluatedSources,
    evaluatedAt,
    applied,
    suppressed: suppressed.sort((a, b) => compareText(a.cardId, b.cardId) || compareText(a.reason, b.reason)),
    conflicting: conflicting.sort((a, b) => compareText(a.decisionKey, b.decisionKey)),
    missing,
    sources: sourceProjection,
    budget: {
      limits: context.budget,
      usedCards: applied.length,
      usedSources: includedSourceIds.size,
      usedCharacters,
      truncated: budgetSuppressed,
      moreAvailable: budgetSuppressed,
    },
    capabilities: { canAuthorizeAction: false, canEnforcePolicy: false, canAlterApproval: false },
  }) as Omit<EffectiveGuidancePack, "packHash">;
  return Object.freeze({ ...core, packHash: digest(core) });
}
