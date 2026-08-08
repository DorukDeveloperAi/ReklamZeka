import { randomBytes } from "node:crypto";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  createGuidanceRegistry,
  type GuidanceBinding,
  type GuidanceCard,
  type GuidanceRegistry,
  type GuidanceScopeFacet,
  type GuidanceStrength,
} from "@/domain/guidance/registry";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const GUIDANCE_STUDIO_VERSION = "guidance-studio/1.0.0" as const;

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
  scope: GuidanceStudioScope;
  updatedAt: null;
}>;

const AUTHORITY_NONE = Object.freeze({
  canDraft: false, canPublish: false, canArchive: false, canWriteMeta: false as const,
  canAuthorizeAction: false as const, canEnforcePolicy: false as const,
});
export type GuidanceStudioAuthority = Readonly<{
  canDraft: boolean; canPublish: boolean; canArchive: boolean; canWriteMeta: false;
  canAuthorizeAction: false; canEnforcePolicy: false;
}>;

export type GuidanceStudioResult = Readonly<{
  contractVersion: typeof GUIDANCE_STUDIO_VERSION;
  items: readonly GuidanceStudioItem[];
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
    action: "guidance.draft_created" | "guidance.draft_revised" | "guidance.published" | "guidance.archived";
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
const FACETS = new Set<GuidanceScopeFacet>(["global", "account", "objective", "internal_category", "entity", "topic"]);
const ENTITIES = new Set(["campaign", "ad_set", "ad", "creative", "post"]);

function text(value: unknown, max: number): string {
  if (typeof value !== "string") throw new GuidanceStudioError("invalid_input");
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) {
    throw new GuidanceStudioError("invalid_input");
  }
  return clean;
}

function scope(value: GuidanceStudioScope, categories: readonly GuidanceStudioCategory[]): GuidanceStudioScope {
  if (!value || !FACETS.has(value.facet) || !["default", "exception"].includes(value.mode)
    || !Number.isSafeInteger(value.priority) || value.priority < 0 || value.priority > 100) {
    throw new GuidanceStudioError("invalid_input");
  }
  if (value.facet === "global") {
    if (value.value !== null || value.entityType !== null) throw new GuidanceStudioError("invalid_input");
  } else {
    if (typeof value.value !== "string") throw new GuidanceStudioError("invalid_input");
    const validValue = value.facet === "objective" ? /^[A-Z][A-Z0-9_]{1,79}$/.test(value.value)
      : value.facet === "topic" ? /^[a-z][a-z0-9_.:-]{0,79}$/.test(value.value)
        : REF.test(value.value);
    if (!validValue) throw new GuidanceStudioError("invalid_input");
    if (value.facet === "entity") {
      if (value.entityType === null || !ENTITIES.has(value.entityType)) throw new GuidanceStudioError("invalid_input");
    } else if (value.entityType !== null) throw new GuidanceStudioError("invalid_input");
  }
  if (value.facet === "internal_category" && !categories.some((item) => item.ref === value.value)) {
    throw new GuidanceStudioError("not_found");
  }
  return Object.freeze({ ...value });
}

function identity(prefix: "guidance" | "source" | "binding"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function authority(role: WorkspaceMembership["role"]) {
  return Object.freeze({
    ...AUTHORITY_NONE,
    canDraft: role !== "viewer",
    canPublish: role === "owner" || role === "admin",
    canArchive: role === "owner" || role === "admin",
  });
}

function project(registry: GuidanceRegistry): readonly GuidanceStudioItem[] {
  const bindings = new Map(registry.bindings.map((item) => [item.cardId, item] as const));
  return Object.freeze(registry.cards.map((card) => {
    const binding = bindings.get(card.id);
    if (!binding) throw new GuidanceStudioError("not_found");
    return Object.freeze({
      cardRef: card.id, version: card.version, title: card.title, body: card.body,
      strength: card.strength, topic: card.topic, status: card.status,
      scope: Object.freeze({ facet: binding.facet, value: binding.value, entityType: binding.entityType,
        mode: binding.mode, priority: binding.priority }), updatedAt: null,
    });
  }).sort((left, right) => left.status.localeCompare(right.status) || left.title.localeCompare(right.title, "tr")));
}

type DraftBody = Readonly<{ title: string; body: string; strength: GuidanceStrength; topic: string; scope: GuidanceStudioScope }>;

export class GuidanceStudioService {
  constructor(private readonly repository: GuidanceStudioRepository, private readonly memberships: readonly WorkspaceMembership[]) {}

  async list(principal: TrustedDecisionRoomPrincipal): Promise<GuidanceStudioResult> {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:read", this.memberships);
    const [registry, categories] = await Promise.all([
      this.repository.load(principal.workspaceId), this.repository.listActiveCategories(principal.workspaceId),
    ]);
    return Object.freeze({ contractVersion: GUIDANCE_STUDIO_VERSION, items: project(registry),
      categories: Object.freeze([...categories]), registryHash: registry.registryHash, authority: authority(membership.role) });
  }

  async createDraft(principal: TrustedDecisionRoomPrincipal, request: DraftBody & Readonly<{ expectedRegistryHash: string | null }>) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships);
    const [current, categories] = await Promise.all([
      this.repository.load(principal.workspaceId), this.repository.listActiveCategories(principal.workspaceId),
    ]);
    const title = text(request.title, 160); const body = text(request.body, 12_000); const topic = text(request.topic, 80);
    if (!STRENGTHS.has(request.strength)) throw new GuidanceStudioError("invalid_input");
    const bindingScope = scope(request.scope, categories);
    const cardRef = identity("guidance"); const sourceRef = identity("source"); const bindingRef = identity("binding");
    const next = createGuidanceRegistry({ workspaceId: principal.workspaceId,
      sources: [...current.sources, { id: sourceRef, workspaceId: principal.workspaceId, sourceType: "owner_statement",
        title, sourceRef: cardRef, sourceUrl: null, content: body, author: principal.readerRef, capturedAt: new Date().toISOString(),
        reviewedAt: null, reviewBy: null, status: "draft", version: 1 }],
      cards: [...current.cards, { id: cardRef, workspaceId: principal.workspaceId, sourceType: "owner_statement",
        sourceIds: [sourceRef], title, body, rationale: null, strength: request.strength, topic,
        decisionKey: null, positionKey: null, authority: "guidance_only", status: "draft",
        effectiveFrom: null, effectiveTo: null, ownerRef: principal.readerRef, version: 1 }],
      bindings: [...current.bindings, { id: bindingRef, workspaceId: principal.workspaceId, cardId: cardRef,
        ...bindingScope, version: 1 }], sets: current.sets });
    const saved = await this.repository.saveAudited(next, { expectedRegistryHash: request.expectedRegistryHash,
      actorId: principal.actor.userId, action: "guidance.draft_created", resourceId: cardRef,
      occurredAt: new Date().toISOString(), metadata: { version: 1, role: membership.role, facet: bindingScope.facet } });
    return Object.freeze({ contractVersion: GUIDANCE_STUDIO_VERSION, item: project(next).find((item) => item.cardRef === cardRef)!,
      registryHash: saved.registryHash, contextInvalidated: saved.contextInvalidationAppended,
      authority: authority(membership.role) });
  }

  async mutate(principal: TrustedDecisionRoomPrincipal, request: Readonly<{
    cardRef: string; expectedVersion: number; expectedRegistryHash: string;
    operation: "revise" | "publish" | "archive";
    title?: string; body?: string; strength?: GuidanceStrength; topic?: string; scope?: GuidanceStudioScope;
  }>) {
    const action = request.operation === "revise" ? "guidance:draft" : "guidance:publish";
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, action, this.memberships);
    if (!REF.test(request.cardRef) || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1
      || !/^[a-f0-9]{64}$/.test(request.expectedRegistryHash)) throw new GuidanceStudioError("invalid_input");
    const [current, categories] = await Promise.all([
      this.repository.load(principal.workspaceId), this.repository.listActiveCategories(principal.workspaceId),
    ]);
    const card = current.cards.find((item) => item.id === request.cardRef);
    const binding = current.bindings.find((item) => item.cardId === request.cardRef);
    const source = card && current.sources.find((item) => card.sourceIds.includes(item.id));
    if (!card || !binding || !source) throw new GuidanceStudioError("not_found");
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
    const nextScope = request.operation === "revise" ? scope(request.scope!, categories) : binding;
    const version = card.version + 1;
    const replace = <T extends { id: string }>(rows: readonly T[], id: string, value: T) => rows.map((row) => row.id === id ? value : row);
    const next = createGuidanceRegistry({ workspaceId: current.workspaceId,
      sources: replace(current.sources, source.id, { ...source, title: nextTitle, content: nextBody, status: nextStatus, version: source.version + 1 }),
      cards: replace(current.cards, card.id, { ...card, title: nextTitle, body: nextBody, topic: nextTopic,
        strength: nextStrength, status: nextStatus, effectiveFrom: nextStatus === "published" ? new Date().toISOString() : card.effectiveFrom,
        version }),
      bindings: request.operation === "revise" ? replace(current.bindings, binding.id,
        { id: binding.id, workspaceId: binding.workspaceId, cardId: binding.cardId, ...nextScope, version: binding.version + 1 }) : current.bindings,
      sets: current.sets });
    const auditAction = request.operation === "revise" ? "guidance.draft_revised"
      : request.operation === "publish" ? "guidance.published" : "guidance.archived";
    const saved = await this.repository.saveAudited(next, { expectedRegistryHash: request.expectedRegistryHash,
      actorId: principal.actor.userId, action: auditAction, resourceId: card.id, occurredAt: new Date().toISOString(),
      metadata: { version, role: membership.role, facet: nextScope.facet } });
    return Object.freeze({ contractVersion: GUIDANCE_STUDIO_VERSION, item: project(next).find((item) => item.cardRef === card.id)!,
      registryHash: saved.registryHash, contextInvalidated: saved.contextInvalidationAppended,
      authority: authority(membership.role) });
  }
}
