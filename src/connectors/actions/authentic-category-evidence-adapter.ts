import { createHash } from "node:crypto";
import type {
  AuthenticCategoryEvidenceCandidate,
  AuthenticCategoryEvidencePort,
  ProtectionEvidenceScope,
} from "@/application/existing-post-promotion-protection-evidence-materializer";
import { DrizzleEffectiveCampaignContextRepository } from
  "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import type { EffectiveCategoryResolution } from "@/domain/categories/registry";
import type { CategoryHierarchyTarget } from "@/domain/categories/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_CATEGORIES = 100;
const MAX_REVISIONS = 500;

export type EffectiveCategoryContextEvidenceReader = Readonly<{
  loadLatestValid(input: Readonly<{
    workspaceId: string;
    entityType: "campaign" | "ad_set" | "ad";
    entityRef: string;
  }>): Promise<StoredEffectiveCampaignContext | null>;
}>;

export type FrozenCategoryEvidenceReader = Readonly<{
  replayFrozen(
    context: StoredEffectiveCampaignContext["context"]["categories"][number],
    target: CategoryHierarchyTarget,
  ): Promise<EffectiveCategoryResolution>;
  resolveCurrent(
    workspaceId: string,
    dimensionId: string,
    target: CategoryHierarchyTarget,
  ): Promise<EffectiveCategoryResolution>;
}>;

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compare(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function validInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function sameFrozen(left: EffectiveCategoryResolution["frozenContext"], right: EffectiveCategoryResolution["frozenContext"]): boolean {
  return digest(left) === digest(right) && left.resolutionHash === right.resolutionHash;
}

function targetOf(
  contexts: StoredEffectiveCampaignContext["context"]["categories"],
  level: ProtectionEvidenceScope["entity"]["level"],
): CategoryHierarchyTarget | null {
  const expectedLevel = level === "adset" ? "ad_set" : level;
  const firstPath = contexts[0]?.path;
  if (!firstPath || firstPath.length !== ({ campaign: 1, ad_set: 2, ad: 3 } as const)[expectedLevel]) return null;
  if (firstPath.some((node, index) => node.level !== (["campaign", "ad_set", "ad"] as const)[index])) return null;
  if (contexts.some((context) => digest(context.path) !== digest(firstPath))) return null;
  const id = firstPath.at(-1)?.id;
  if (!id || !UUID.test(id)) return null;
  return Object.freeze({ level: expectedLevel, id }) as CategoryHierarchyTarget;
}

/**
 * Read-only production composition adapter. The constructor binding must come
 * from the authenticated tenant principal; category refs are derived only from
 * hash-verified, versioned category definitions returned by frozen replay.
 */
export class AuthenticCategoryEvidenceAdapter implements AuthenticCategoryEvidencePort {
  constructor(
    private readonly contexts: EffectiveCategoryContextEvidenceReader,
    private readonly categories: FrozenCategoryEvidenceReader,
    private readonly workspaceId: string,
    private readonly workspaceRef: string,
  ) {
    if (!UUID.test(workspaceId) || !REF.test(workspaceRef)) throw new Error("invalid_category_evidence_binding");
  }

  async resolveCandidates(scope: ProtectionEvidenceScope): Promise<readonly AuthenticCategoryEvidenceCandidate[]> {
    if (scope.workspaceId !== this.workspaceId || scope.workspaceRef !== this.workspaceRef
      || !validInstant(scope.evaluatedAt) || !validInstant(scope.notBefore) || scope.notBefore > scope.evaluatedAt
      || !REF.test(scope.accountRef) || !REF.test(scope.campaignRef) || !REF.test(scope.entity.ref)) return [];
    const entityType = scope.entity.level === "adset" ? "ad_set" : scope.entity.level;
    if (!(entityType === "campaign" || entityType === "ad_set" || entityType === "ad")) return [];

    try {
      const record = await this.contexts.loadLatestValid({
        workspaceId: this.workspaceId, entityType, entityRef: scope.entity.ref,
      });
      if (!record || record.invalidated) return [];
      const context = record.context;
      if (context.workspaceId !== this.workspaceId || context.identity.accountRef !== scope.accountRef
        || context.identity.campaignRef !== scope.campaignRef || context.identity.entityType !== entityType
        || context.identity.entityRef !== scope.entity.ref || context.capturedAt < scope.notBefore
        || context.capturedAt > scope.evaluatedAt || !validInstant(context.capturedAt)
        || !HASH.test(context.contextHash) || context.data.trustStatus !== "ready"
        || context.data.blockers.length !== 0 || context.categories.length === 0
        || context.categories.length > MAX_CATEGORIES) return [];

      const target = targetOf(context.categories, scope.entity.level);
      if (!target) return [];
      const categoryRefs: string[] = [];
      const resolutionRevisions: Array<Readonly<{ sourceRef: string; revision: number; sourceHash: string }>> = [];
      for (const frozen of context.categories) {
        if (frozen.workspaceId !== this.workspaceId || !HASH.test(frozen.resolutionHash)) return [];
        const replayed = await this.categories.replayFrozen(frozen, target);
        const current = await this.categories.resolveCurrent(this.workspaceId, frozen.dimension.id, target);
        if (!sameFrozen(replayed.frozenContext, frozen)
          || !sameFrozen(current.frozenContext, frozen)) return [];
        for (const definition of replayed.values) {
          if (definition.workspaceId !== this.workspaceId || definition.dimensionId !== frozen.dimension.id
            || !definition.key.trim() || !frozen.dimension.key.trim()) return [];
          categoryRefs.push(`category_${digest({ dimensionKey: frozen.dimension.key, definitionKey: definition.key }).slice(0, 24)}`);
        }
        resolutionRevisions.push(Object.freeze({
          sourceRef: `category_resolution_${digest(frozen.dimension.id).slice(0, 20)}`,
          revision: frozen.dimension.version,
          sourceHash: frozen.resolutionHash,
        }));
      }

      categoryRefs.sort(compare);
      if (categoryRefs.length === 0 || categoryRefs.length > MAX_CATEGORIES
        || new Set(categoryRefs).size !== categoryRefs.length || record.sourceComponents.length > MAX_REVISIONS) return [];
      const componentRevisions = record.sourceComponents.map((component) => {
        const sourceHash = digest(component);
        return Object.freeze({ sourceRef: `context_component_${sourceHash.slice(0, 20)}`, revision: 1, sourceHash });
      });
      const sourceRevisions = [
        Object.freeze({ sourceRef: `effective_context_${context.contextHash.slice(0, 20)}`, revision: 1, sourceHash: context.contextHash }),
        ...resolutionRevisions,
        ...componentRevisions,
      ].sort((left, right) => compare(left.sourceRef, right.sourceRef));
      if (sourceRevisions.length > MAX_REVISIONS
        || new Set(sourceRevisions.map((revision) => revision.sourceRef)).size !== sourceRevisions.length) return [];

      return Object.freeze([Object.freeze({
        sourceKind: "effective_category_context" as const,
        workspaceId: this.workspaceId,
        workspaceRef: this.workspaceRef,
        accountRef: scope.accountRef,
        campaignRef: scope.campaignRef,
        entity: Object.freeze({ ...scope.entity }),
        capturedAt: context.capturedAt,
        contextHash: context.contextHash,
        categoryRefs: Object.freeze(categoryRefs),
        sourceRevisions: Object.freeze(sourceRevisions),
      })]);
    } catch {
      return [];
    }
  }
}

/** Production composition; construction performs no query and exposes no category mutation method. */
export function createDrizzleAuthenticCategoryEvidenceAdapter(input: Readonly<{
  database: NodePgDatabase<typeof schema>;
  workspaceId: string;
  workspaceRef: string;
}>): AuthenticCategoryEvidencePort {
  return new AuthenticCategoryEvidenceAdapter(
    new DrizzleEffectiveCampaignContextRepository(input.database),
    new DrizzleCategoryRegistryRepository(input.database),
    input.workspaceId,
    input.workspaceRef,
  );
}
