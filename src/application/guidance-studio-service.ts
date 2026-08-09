import { randomBytes } from "node:crypto";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  createGuidanceRegistry,
  canonicalGuidanceObjective,
  isOfficialGuidanceSourceUrl,
  type GuidanceBinding,
  type GuidanceCard,
  type GuidanceRegistry,
  type GuidanceScopeFacet,
  type GuidanceSet,
  type GuidanceSourceType,
  type GuidanceStrength,
} from "@/domain/guidance/registry";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const GUIDANCE_STUDIO_VERSION = "guidance-studio/1.3.0" as const;

export type GuidanceStudioScope = Readonly<{
  facet: GuidanceScopeFacet;
  value: string | null;
  entityType: GuidanceBinding["entityType"];
  mode: GuidanceBinding["mode"];
  priority: number;
}>;

export type GuidanceStudioCategory = Readonly<{ ref: string; label: string; dimension: string }>;
export type GuidanceStudioItem = Readonly<{
  cardRef: string;
  version: number;
  title: string;
  body: string;
  strength: GuidanceStrength;
  topic: string;
  status: GuidanceCard["status"];
  sources: readonly Readonly<{
    type: GuidanceSourceType;
    ref: string;
    url: string | null;
    capturedAt: string | null;
    reviewedAt: string | null;
    reviewBy: string | null;
  }>[];
  scopes: readonly GuidanceStudioScope[];
  updatedAt: null;
}>;
export type GuidanceStudioSetItem = Readonly<{
  setRef: string;
  version: number;
  name: string;
  reviewStatus: GuidanceSet["reviewStatus"];
  orderedCards: readonly Readonly<{
    cardRef: string;
    title: string;
    version: number;
    status: GuidanceCard["status"];
  }>[];
}>;

const AUTHORITY_NONE = Object.freeze({
  canDraft: false, canPublish: false, canReview: false, canArchive: false, canWriteMeta: false as const,
  canAuthorizeAction: false as const, canEnforcePolicy: false as const,
});
export type GuidanceStudioAuthority = Readonly<{
  canDraft: boolean; canPublish: boolean; canReview: boolean; canArchive: boolean; canWriteMeta: false;
  canAuthorizeAction: false; canEnforcePolicy: false;
}>;

export type GuidanceStudioResult = Readonly<{
  contractVersion: typeof GUIDANCE_STUDIO_VERSION;
  items: readonly GuidanceStudioItem[];
  sets: readonly GuidanceStudioSetItem[];
  categories: readonly GuidanceStudioCategory[];
  registryHash: string;
  authority: GuidanceStudioAuthority;
}>;

export type GuidanceStudioRepository = Readonly<{
  load(workspaceId: string): Promise<GuidanceRegistry>;
  listActiveCategories(workspaceId: string): Promise<readonly GuidanceStudioCategory[]>;
  saveAudited(registry: GuidanceRegistry, input: Readonly<{
    expectedRegistryHash: string | null;
    actorId: string;
    action: "guidance.draft_created" | "guidance.draft_revised" | "guidance.published" | "guidance.archived"
      | "guidance_set.draft_created" | "guidance_set.draft_revised" | "guidance_set.reviewed" | "guidance_set.archived";
    resourceId: string;
    occurredAt: string;
    metadata: Readonly<Record<string, string | number | boolean | null>>;
  }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; registryHash: string; auditAppended: boolean;
    contextInvalidationAppended: boolean }>>;
}>;

export class GuidanceStudioError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict" | "invalid_transition") {
    super(`Guidance Studio işlemi reddedildi: ${code}`);
    this.name = "GuidanceStudioError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const STRENGTHS = new Set<GuidanceStrength>(["must", "should", "consider", "avoid", "question"]);
const FACETS = new Set<GuidanceScopeFacet>([
  "global", "account_group", "account", "objective", "funnel", "optimization",
  "internal_category", "lifecycle", "entity", "promotion_template", "topic",
]);
const ENTITIES = new Set(["campaign", "ad_set", "ad", "creative", "post"]);
const SOURCE_TYPES = new Set<GuidanceSourceType>([
  "owner_statement", "official_meta_guidance", "business_strategy", "observed_result",
  "experiment_outcome", "operating_note",
]);

function text(value: unknown, max: number): string {
  if (typeof value !== "string") throw new GuidanceStudioError("invalid_input");
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) {
    throw new GuidanceStudioError("invalid_input");
  }
  return clean;
}

function scope(value: GuidanceStudioScope, categories: readonly GuidanceStudioCategory[]): GuidanceStudioScope {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 5
    || Object.keys(value).some((key) => !["facet", "value", "entityType", "mode", "priority"].includes(key))
    || !FACETS.has(value.facet) || !["default", "exception"].includes(value.mode)
    || !Number.isSafeInteger(value.priority) || value.priority < 0 || value.priority > 100) {
    throw new GuidanceStudioError("invalid_input");
  }
  if (value.facet === "global") {
    if (value.value !== null || value.entityType !== null) throw new GuidanceStudioError("invalid_input");
  } else {
    if (typeof value.value !== "string") throw new GuidanceStudioError("invalid_input");
    const canonicalObjective = value.facet === "objective" ? canonicalGuidanceObjective(value.value) : null;
    const validValue = value.facet === "objective" ? canonicalObjective !== null
      : value.facet === "optimization" ? /^[A-Z][A-Z0-9_]{1,79}$/.test(value.value)
        : ["topic", "funnel", "lifecycle"].includes(value.facet) ? /^[a-z][a-z0-9_.:-]{0,79}$/.test(value.value)
          : REF.test(value.value);
    if (!validValue) throw new GuidanceStudioError("invalid_input");
    if (value.facet === "entity") {
      if (value.entityType === null || !ENTITIES.has(value.entityType)) throw new GuidanceStudioError("invalid_input");
    } else if (value.entityType !== null) throw new GuidanceStudioError("invalid_input");
  }
  if (value.facet === "internal_category" && !categories.some((item) => item.ref === value.value)) {
    throw new GuidanceStudioError("not_found");
  }
  return Object.freeze({ facet: value.facet,
    value: value.facet === "objective" ? canonicalGuidanceObjective(value.value) : value.value,
    entityType: value.entityType,
    mode: value.mode, priority: value.priority });
}

function scopes(values: readonly GuidanceStudioScope[], categories: readonly GuidanceStudioCategory[]): readonly GuidanceStudioScope[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 12) throw new GuidanceStudioError("invalid_input");
  const validated = values.map((value) => scope(value, categories));
  const identities = validated.map((value) => `${value.facet}\u0000${value.value ?? ""}\u0000${value.entityType ?? ""}`);
  if (new Set(identities).size !== identities.length
    || validated.length > 1 && validated.some((value) => value.facet === "global")) {
    throw new GuidanceStudioError("invalid_input");
  }
  return Object.freeze(validated);
}

function identity(prefix: "guidance" | "source" | "binding" | "guidance_set"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function authority(role: WorkspaceMembership["role"]) {
  return Object.freeze({
    ...AUTHORITY_NONE,
    canDraft: role !== "viewer",
    canPublish: role === "owner" || role === "admin",
    canReview: role === "owner" || role === "admin",
    canArchive: role === "owner" || role === "admin",
  });
}

function projectSets(registry: GuidanceRegistry): readonly GuidanceStudioSetItem[] {
  const cards = new Map(registry.cards.map((card) => [card.id, card] as const));
  return Object.freeze(registry.sets.map((set) => Object.freeze({
    setRef: set.id,
    version: set.version,
    name: set.name,
    reviewStatus: set.reviewStatus,
    orderedCards: Object.freeze(set.orderedCardIds.map((cardRef) => {
      const card = cards.get(cardRef);
      if (!card) throw new GuidanceStudioError("not_found");
      return Object.freeze({ cardRef: card.id, title: card.title, version: card.version, status: card.status });
    })),
  })).sort((left, right) => left.reviewStatus.localeCompare(right.reviewStatus)
    || left.name.localeCompare(right.name, "tr")));
}

function publishedCardRefs(values: readonly string[], registry: GuidanceRegistry): readonly string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50
    || values.some((value) => typeof value !== "string" || !REF.test(value))
    || new Set(values).size !== values.length) throw new GuidanceStudioError("invalid_input");
  const cards = new Map(registry.cards.map((card) => [card.id, card] as const));
  if (values.some((value) => cards.get(value)?.status !== "published")) {
    throw new GuidanceStudioError("invalid_transition");
  }
  return Object.freeze([...values]);
}

function project(registry: GuidanceRegistry): readonly GuidanceStudioItem[] {
  const bindings = new Map<string, GuidanceBinding[]>();
  for (const binding of registry.bindings) bindings.set(binding.cardId, [...(bindings.get(binding.cardId) ?? []), binding]);
  return Object.freeze(registry.cards.map((card) => {
    const cardBindings = [...(bindings.get(card.id) ?? [])].sort((left, right) => left.id.localeCompare(right.id, "en"));
    if (!cardBindings.length) throw new GuidanceStudioError("not_found");
    const cardSources = card.sourceIds.map((sourceId) => registry.sources.find((candidate) => candidate.id === sourceId));
    if (cardSources.some((source) => !source)) throw new GuidanceStudioError("not_found");
    return Object.freeze({
      cardRef: card.id, version: card.version, title: card.title, body: card.body,
      strength: card.strength, topic: card.topic, status: card.status,
      sources: Object.freeze(cardSources.map((source) => Object.freeze({ type: source!.sourceType,
        ref: source!.sourceRef, url: source!.sourceUrl, capturedAt: source!.capturedAt,
        reviewedAt: source!.reviewedAt, reviewBy: source!.reviewBy }))),
      scopes: Object.freeze(cardBindings.map((binding) => Object.freeze({ facet: binding.facet, value: binding.value,
        entityType: binding.entityType, mode: binding.mode, priority: binding.priority }))), updatedAt: null,
    });
  }).sort((left, right) => left.status.localeCompare(right.status) || left.title.localeCompare(right.title, "tr")));
}

type SourceDraft = Readonly<{ type: GuidanceSourceType; ref: string; url: string | null;
  capturedAt: string | null; reviewBy: string | null }>;
type DraftBody = Readonly<{ title: string; body: string; strength: GuidanceStrength; topic: string;
  scopes: readonly GuidanceStudioScope[]; source?: SourceDraft }>;

function sourceDraft(value: SourceDraft | undefined, fallbackRef: string): SourceDraft {
  if (value === undefined) return Object.freeze({ type: "owner_statement", ref: fallbackRef,
    url: null, capturedAt: new Date().toISOString(), reviewBy: null });
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 5
    || Object.keys(value).some((key) => !["type", "ref", "url", "capturedAt", "reviewBy"].includes(key))
    || !SOURCE_TYPES.has(value.type) || !REF.test(value.ref)
    || value.url !== null && (typeof value.url !== "string" || !/^https:\/\//i.test(value.url) || value.url.length > 2_048)
    || value.capturedAt !== null && !Number.isFinite(Date.parse(value.capturedAt))
    || value.reviewBy !== null && !Number.isFinite(Date.parse(value.reviewBy))) {
    throw new GuidanceStudioError("invalid_input");
  }
  if (value.type === "official_meta_guidance"
    && (value.url === null || value.capturedAt === null || value.reviewBy === null
      || !isOfficialGuidanceSourceUrl(value.url))) {
    throw new GuidanceStudioError("invalid_input");
  }
  return Object.freeze({ ...value, capturedAt: value.capturedAt === null ? null : new Date(value.capturedAt).toISOString(),
    reviewBy: value.reviewBy === null ? null : new Date(value.reviewBy).toISOString() });
}

export class GuidanceStudioService {
  constructor(private readonly repository: GuidanceStudioRepository, private readonly memberships: readonly WorkspaceMembership[]) {}

  async list(principal: TrustedDecisionRoomPrincipal): Promise<GuidanceStudioResult> {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:read", this.memberships);
    const [registry, categories] = await Promise.all([
      this.repository.load(principal.workspaceId), this.repository.listActiveCategories(principal.workspaceId),
    ]);
    return Object.freeze({ contractVersion: GUIDANCE_STUDIO_VERSION, items: project(registry),
      sets: projectSets(registry),
      categories: Object.freeze([...categories]), registryHash: registry.registryHash, authority: authority(membership.role) });
  }

  async createSetDraft(principal: TrustedDecisionRoomPrincipal, request: Readonly<{
    name: string; orderedCardRefs: readonly string[]; expectedRegistryHash: string | null;
  }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships);
    const current = await this.repository.load(principal.workspaceId);
    const name = text(request.name, 160);
    const orderedCardIds = publishedCardRefs(request.orderedCardRefs, current);
    const setRef = identity("guidance_set");
    const next = createGuidanceRegistry({ workspaceId: current.workspaceId, sources: current.sources,
      cards: current.cards, bindings: current.bindings, sets: [...current.sets, {
        id: setRef, workspaceId: current.workspaceId, name, orderedCardIds, reviewStatus: "draft", version: 1,
      }] });
    const saved = await this.repository.saveAudited(next, { expectedRegistryHash: request.expectedRegistryHash,
      actorId: principal.actor.userId, action: "guidance_set.draft_created", resourceId: setRef,
      occurredAt: new Date().toISOString(), metadata: { version: 1, role: membership.role,
        cardCount: orderedCardIds.length } });
    return Object.freeze({ contractVersion: GUIDANCE_STUDIO_VERSION,
      set: projectSets(next).find((item) => item.setRef === setRef)!, registryHash: saved.registryHash,
      contextInvalidated: saved.contextInvalidationAppended, authority: authority(membership.role) });
  }

  async mutateSet(principal: TrustedDecisionRoomPrincipal, request: Readonly<{
    setRef: string; expectedVersion: number; expectedRegistryHash: string;
    operation: "revise" | "review" | "archive"; name?: string; orderedCardRefs?: readonly string[];
  }>) {
    const action = request.operation === "revise" ? "guidance:draft" : "guidance:publish";
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, action, this.memberships);
    if (!/^guidance_set_[a-f0-9]{24}$/.test(request.setRef)
      || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1
      || !/^[a-f0-9]{64}$/.test(request.expectedRegistryHash)) throw new GuidanceStudioError("invalid_input");
    const current = await this.repository.load(principal.workspaceId);
    const set = current.sets.find((item) => item.id === request.setRef);
    if (!set) throw new GuidanceStudioError("not_found");
    if (set.version !== request.expectedVersion) throw new GuidanceStudioError("conflict");
    if (request.operation === "revise" && set.reviewStatus !== "draft"
      || request.operation === "review" && set.reviewStatus !== "draft"
      || request.operation === "archive" && set.reviewStatus === "archived") {
      throw new GuidanceStudioError("invalid_transition");
    }
    const nextName = request.operation === "revise" ? text(request.name, 160) : set.name;
    const nextCardIds = request.operation === "revise"
      ? publishedCardRefs(request.orderedCardRefs!, current)
      : request.operation === "review" ? publishedCardRefs(set.orderedCardIds, current)
        : Object.freeze([...set.orderedCardIds]);
    const reviewStatus = request.operation === "review" ? "reviewed"
      : request.operation === "archive" ? "archived" : "draft";
    const version = set.version + 1;
    const next = createGuidanceRegistry({ workspaceId: current.workspaceId, sources: current.sources,
      cards: current.cards, bindings: current.bindings, sets: current.sets.map((item) => item.id === set.id
        ? { ...item, name: nextName, orderedCardIds: nextCardIds, reviewStatus, version } : item) });
    const auditAction = request.operation === "revise" ? "guidance_set.draft_revised"
      : request.operation === "review" ? "guidance_set.reviewed" : "guidance_set.archived";
    const saved = await this.repository.saveAudited(next, { expectedRegistryHash: request.expectedRegistryHash,
      actorId: principal.actor.userId, action: auditAction, resourceId: set.id,
      occurredAt: new Date().toISOString(), metadata: { version, role: membership.role,
        cardCount: nextCardIds.length } });
    return Object.freeze({ contractVersion: GUIDANCE_STUDIO_VERSION,
      set: projectSets(next).find((item) => item.setRef === set.id)!, registryHash: saved.registryHash,
      contextInvalidated: saved.contextInvalidationAppended, authority: authority(membership.role) });
  }

  async createDraft(principal: TrustedDecisionRoomPrincipal, request: DraftBody & Readonly<{ expectedRegistryHash: string | null }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships);
    const [current, categories] = await Promise.all([
      this.repository.load(principal.workspaceId), this.repository.listActiveCategories(principal.workspaceId),
    ]);
    const title = text(request.title, 160); const body = text(request.body, 12_000); const topic = text(request.topic, 80);
    if (!STRENGTHS.has(request.strength)) throw new GuidanceStudioError("invalid_input");
    const bindingScopes = scopes(request.scopes, categories);
    const cardRef = identity("guidance"); const sourceRef = identity("source");
    const provenance = sourceDraft(request.source, cardRef);
    const next = createGuidanceRegistry({ workspaceId: principal.workspaceId,
      sources: [...current.sources, { id: sourceRef, workspaceId: principal.workspaceId, sourceType: provenance.type,
        title, sourceRef: provenance.ref, sourceUrl: provenance.url, content: body, author: principal.readerRef,
        capturedAt: provenance.capturedAt, reviewedAt: null, reviewBy: provenance.reviewBy, status: "draft", version: 1 }],
      cards: [...current.cards, { id: cardRef, workspaceId: principal.workspaceId, sourceType: provenance.type,
        sourceIds: [sourceRef], title, body, rationale: null, strength: request.strength, topic,
        decisionKey: null, positionKey: null, authority: "guidance_only", status: "draft",
        effectiveFrom: null, effectiveTo: null, ownerRef: principal.readerRef, version: 1 }],
      bindings: [...current.bindings, ...bindingScopes.map((bindingScope) => ({ id: identity("binding"),
        workspaceId: principal.workspaceId, cardId: cardRef, ...bindingScope, version: 1 }))], sets: current.sets });
    const saved = await this.repository.saveAudited(next, { expectedRegistryHash: request.expectedRegistryHash,
      actorId: principal.actor.userId, action: "guidance.draft_created", resourceId: cardRef,
      occurredAt: new Date().toISOString(), metadata: { version: 1, role: membership.role,
        bindingCount: bindingScopes.length, sourceType: provenance.type } });
    return Object.freeze({ contractVersion: GUIDANCE_STUDIO_VERSION, item: project(next).find((item) => item.cardRef === cardRef)!,
      registryHash: saved.registryHash, contextInvalidated: saved.contextInvalidationAppended,
      authority: authority(membership.role) });
  }

  async mutate(principal: TrustedDecisionRoomPrincipal, request: Readonly<{
    cardRef: string; expectedVersion: number; expectedRegistryHash: string;
    operation: "revise" | "publish" | "archive";
    title?: string; body?: string; strength?: GuidanceStrength; topic?: string; scopes?: readonly GuidanceStudioScope[];
  }>) {
    const action = request.operation === "revise" ? "guidance:draft" : "guidance:publish";
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, action, this.memberships);
    if (!REF.test(request.cardRef) || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1
      || !/^[a-f0-9]{64}$/.test(request.expectedRegistryHash)) throw new GuidanceStudioError("invalid_input");
    const [current, categories] = await Promise.all([
      this.repository.load(principal.workspaceId), this.repository.listActiveCategories(principal.workspaceId),
    ]);
    const card = current.cards.find((item) => item.id === request.cardRef);
    const bindings = current.bindings.filter((item) => item.cardId === request.cardRef)
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
    const source = card && current.sources.find((item) => card.sourceIds.includes(item.id));
    if (!card || !bindings.length || !source) throw new GuidanceStudioError("not_found");
    if (card.version !== request.expectedVersion) throw new GuidanceStudioError("conflict");
    if (request.operation === "revise" && card.status !== "draft"
      || request.operation === "publish" && card.status !== "draft"
      || request.operation === "archive" && card.status === "archived") throw new GuidanceStudioError("invalid_transition");
    const nextStatus = request.operation === "publish" ? "published" : request.operation === "archive" ? "archived" : "draft";
    const nextTitle = request.operation === "revise" ? text(request.title, 160) : card.title;
    const nextBody = request.operation === "revise" ? text(request.body, 12_000) : card.body;
    const nextTopic = request.operation === "revise" ? text(request.topic, 80) : card.topic;
    const nextStrength = request.operation === "revise" ? request.strength : card.strength;
    if (!nextStrength || !STRENGTHS.has(nextStrength)) throw new GuidanceStudioError("invalid_input");
    const nextScopes = request.operation === "revise" ? scopes(request.scopes!, categories)
      : bindings.map((binding) => ({ facet: binding.facet, value: binding.value, entityType: binding.entityType,
        mode: binding.mode, priority: binding.priority }));
    if (request.operation === "revise" && nextScopes.length !== bindings.length) {
      throw new GuidanceStudioError("invalid_transition");
    }
    const version = card.version + 1;
    const replace = <T extends { id: string }>(rows: readonly T[], id: string, value: T) => rows.map((row) => row.id === id ? value : row);
    const next = createGuidanceRegistry({ workspaceId: current.workspaceId,
      sources: replace(current.sources, source.id, { ...source, title: nextTitle, content: nextBody,
        reviewedAt: request.operation === "publish" && source.sourceType === "official_meta_guidance"
          ? new Date().toISOString() : source.reviewedAt,
        status: nextStatus, version: source.version + 1 }),
      cards: replace(current.cards, card.id, { ...card, title: nextTitle, body: nextBody, topic: nextTopic,
        strength: nextStrength, status: nextStatus, effectiveFrom: nextStatus === "published" ? new Date().toISOString() : card.effectiveFrom,
        version }),
      bindings: request.operation === "revise" ? bindings.reduce((rows, binding, index) => replace(rows, binding.id,
        { id: binding.id, workspaceId: binding.workspaceId, cardId: binding.cardId,
          ...nextScopes[index]!, version: binding.version + 1 }), current.bindings) : current.bindings,
      sets: current.sets });
    const auditAction = request.operation === "revise" ? "guidance.draft_revised"
      : request.operation === "publish" ? "guidance.published" : "guidance.archived";
    const saved = await this.repository.saveAudited(next, { expectedRegistryHash: request.expectedRegistryHash,
      actorId: principal.actor.userId, action: auditAction, resourceId: card.id, occurredAt: new Date().toISOString(),
      metadata: { version, role: membership.role, bindingCount: nextScopes.length,
        sourceType: source.sourceType } });
    return Object.freeze({ contractVersion: GUIDANCE_STUDIO_VERSION, item: project(next).find((item) => item.cardRef === card.id)!,
      registryHash: saved.registryHash, contextInvalidated: saved.contextInvalidationAppended,
      authority: authority(membership.role) });
  }
}
