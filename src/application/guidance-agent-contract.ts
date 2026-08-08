import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { GuidanceStudioRepository } from "@/application/guidance-studio-service";
import { buildEffectiveGuidancePack, type GuidanceEntityType } from "@/domain/guidance/registry";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const GUIDANCE_AGENT_CONTRACT_VERSION = "guidance-agent-tools/1.0.0" as const;

export type GuidanceAgentCall =
  | Readonly<{ name: "guidance_registry_list"; arguments: Readonly<{ status?: "draft" | "published" | "archived" }> }>
  | Readonly<{ name: "guidance_effective_preview"; arguments: GuidancePreviewRequest }>;

export type GuidancePreviewRequest = Readonly<{
  accountRef: string;
  objective: string | null;
  internalCategoryRefs: readonly string[];
  entity: Readonly<{ type: GuidanceEntityType; ref: string }> | null;
  topics: readonly string[];
  requiredTopics: readonly string[];
  evaluatedAt: string;
  timeframe: Readonly<{ ref: string; kind: "rolling" | "fixed" | "calendar" | "lifetime" | "learning" | "action_relative" }>;
  budget?: Readonly<{ maxCards: number; maxSources: number; maxCharacters: number }>;
}>;

const AUTHORITY = Object.freeze({ canDraft: false as const, canPublish: false as const, canArchive: false as const,
  canAuthorizeAction: false as const, canEnforcePolicy: false as const, canAlterApproval: false as const,
  canWriteMeta: false as const, persistence: false as const, actionExecution: false as const });
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const TOPIC = /^[a-z][a-z0-9_.:-]{0,79}$/;
const OBJECTIVE = /^[A-Z][A-Z0-9_]{1,79}$/;
const KINDS = new Set(["rolling", "fixed", "calendar", "lifetime", "learning", "action_relative"]);
const ENTITY_TYPES = new Set<GuidanceEntityType>(["campaign", "ad_set", "ad", "creative", "post"]);

export class GuidanceAgentError extends Error {
  constructor(readonly code: "invalid_input" | "unsafe_source") {
    super(`Guidance agent read rejected: ${code}`); this.name = "GuidanceAgentError";
  }
}
function fail(): never { throw new GuidanceAgentError("invalid_input"); }
function exact(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) fail();
}
function list(value: unknown, pattern: RegExp, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !pattern.test(item))
    || new Set(value).size !== value.length) fail();
  return Object.freeze([...value]);
}

function preview(value: GuidancePreviewRequest) {
  exact(value, ["accountRef", "objective", "internalCategoryRefs", "entity", "topics", "requiredTopics", "evaluatedAt", "timeframe", "budget"]);
  if (!REF.test(value.accountRef) || value.objective !== null && !OBJECTIVE.test(value.objective)
    || !Number.isFinite(Date.parse(value.evaluatedAt))) fail();
  const categories = list(value.internalCategoryRefs, /^category_[a-f0-9]{24}$/, 100);
  const topics = list(value.topics, TOPIC, 100); const requiredTopics = list(value.requiredTopics, TOPIC, 100);
  if (value.entity !== null) {
    exact(value.entity, ["type", "ref"]);
    if (!ENTITY_TYPES.has(value.entity.type) || !REF.test(value.entity.ref)) fail();
  }
  exact(value.timeframe, ["ref", "kind"]);
  if (!REF.test(value.timeframe.ref) || !KINDS.has(value.timeframe.kind)) fail();
  const budget = value.budget ?? { maxCards: 24, maxSources: 24, maxCharacters: 24_000 };
  exact(budget, ["maxCards", "maxSources", "maxCharacters"]);
  if (!Number.isSafeInteger(budget.maxCards) || budget.maxCards < 1 || budget.maxCards > 100
    || !Number.isSafeInteger(budget.maxSources) || budget.maxSources < 1 || budget.maxSources > 100
    || !Number.isSafeInteger(budget.maxCharacters) || budget.maxCharacters < 1 || budget.maxCharacters > 100_000) fail();
  return Object.freeze({ categories, topics: Object.freeze([...new Set([...topics, `timeframe:${value.timeframe.kind}`])]), requiredTopics,
    budget: Object.freeze({ ...budget }) });
}

export class GuidanceAgentContract {
  constructor(private readonly repository: Pick<GuidanceStudioRepository, "load">,
    private readonly memberships: readonly WorkspaceMembership[]) {}

  async execute(principal: TrustedDecisionRoomPrincipal, call: GuidanceAgentCall) {
    exact(principal, ["actor", "workspaceId", "workspaceRef", "readerRef"]); exact(principal.actor, ["userId"]);
    authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:read", this.memberships);
    exact(call, ["name", "arguments"]);
    const registry = await this.repository.load(principal.workspaceId);
    if (call.name === "guidance_registry_list") {
      exact(call.arguments, ["status"]);
      if (call.arguments.status !== undefined && !["draft", "published", "archived"].includes(call.arguments.status)) fail();
      const bindings = new Map<string, typeof registry.bindings>(registry.cards.map((card) => [card.id,
        Object.freeze(registry.bindings.filter((binding) => binding.cardId === card.id))]));
      const sources = new Map(registry.sources.map((source) => [source.id, source] as const));
      const items = registry.cards.filter((card) => call.arguments.status === undefined || card.status === call.arguments.status)
        .map((card) => Object.freeze({ cardRef: card.id, version: card.version, title: card.title, body: card.body,
          strength: card.strength, topic: card.topic, status: card.status, authority: card.authority,
          provenance: Object.freeze(card.sourceIds.map((sourceId) => { const source = sources.get(sourceId)!;
            return Object.freeze({ sourceType: source.sourceType, title: source.title, content: source.content,
              status: source.status, version: source.version }); })),
          scopes: Object.freeze((bindings.get(card.id) ?? []).map((binding) => Object.freeze({ facet: binding.facet,
            value: binding.value, entityType: binding.entityType, mode: binding.mode, priority: binding.priority,
            version: binding.version }))),
        })).sort((left, right) => left.cardRef.localeCompare(right.cardRef, "en"));
      return Object.freeze({ contractVersion: GUIDANCE_AGENT_CONTRACT_VERSION, result: Object.freeze({
        registryVersion: registry.registryHash, items: Object.freeze(items), count: items.length }), authority: AUTHORITY });
    }
    if (call.name !== "guidance_effective_preview") fail();
    const normalized = preview(call.arguments);
    const pack = buildEffectiveGuidancePack(registry, { workspaceId: principal.workspaceId,
      accountId: call.arguments.accountRef, objective: call.arguments.objective,
      internalCategoryIds: normalized.categories, entity: call.arguments.entity === null ? null
        : { type: call.arguments.entity.type, id: call.arguments.entity.ref }, topics: normalized.topics,
      requiredTopics: normalized.requiredTopics, evaluatedAt: new Date(call.arguments.evaluatedAt).toISOString(),
      budget: normalized.budget });
    return Object.freeze({ contractVersion: GUIDANCE_AGENT_CONTRACT_VERSION, result: Object.freeze({
      registryVersion: pack.registryHash, evaluatedAt: pack.evaluatedAt, timeframe: Object.freeze({ ...call.arguments.timeframe }),
      applied: pack.applied, suppressed: pack.suppressed, conflicting: pack.conflicting, missing: pack.missing,
      sources: pack.sources, budget: pack.budget, packVersion: pack.packHash }), authority: AUTHORITY });
  }
}

export const GUIDANCE_AGENT_TOOLS = Object.freeze([
  Object.freeze({ name: "guidance_registry_list", description: "List public-safe scoped guidance and preserved owner statements; grants no policy, persistence, approval, or Meta authority.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false,
      properties: Object.freeze({ status: Object.freeze({ type: "string", enum: Object.freeze(["draft", "published", "archived"]) }) }) }) }),
  Object.freeze({ name: "guidance_effective_preview", description: "Resolve the deterministic effective guidance pack for an explicit account/category/entity/topic/timeframe context without running a model or writing state.",
    inputSchema: Object.freeze({ type: "object", additionalProperties: false,
      required: Object.freeze(["accountRef", "objective", "internalCategoryRefs", "entity", "topics", "requiredTopics", "evaluatedAt", "timeframe"]),
      properties: Object.freeze({ accountRef: Object.freeze({ type: "string" }), objective: Object.freeze({ type: ["string", "null"] }),
        internalCategoryRefs: Object.freeze({ type: "array" }), entity: Object.freeze({ type: ["object", "null"] }),
        topics: Object.freeze({ type: "array" }), requiredTopics: Object.freeze({ type: "array" }),
        evaluatedAt: Object.freeze({ type: "string", format: "date-time" }), timeframe: Object.freeze({ type: "object" }),
        budget: Object.freeze({ type: "object" }) }) }) }),
]);
