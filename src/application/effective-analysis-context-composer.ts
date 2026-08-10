import type { EffectiveCampaignContext, EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import type { CurrentCategoryCompositionResolver } from "@/application/current-category-composition-resolver";
import type { InstructionPolicyLifecycleState } from "@/application/instruction-policy-lifecycle-service";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import type { CanonicalMetaAnalysisConfigSnapshotV2 } from "@/domain/meta/analysis-config-projection";
import { projectMetaAnalysisConfig } from "@/domain/meta/analysis-config-projection";
import type { CategoryHierarchyTarget } from "@/domain/categories/service";

/**
 * The only public input for this server-private composition boundary.  Context
 * components intentionally cannot be supplied by a route, agent, or caller.
 */
export type EffectiveAnalysisContextRequest = Readonly<{
  workspaceId: string;
  accountRef: string;
  entityType: "campaign" | "ad_set" | "ad" | "creative";
  entityRef: string;
  capturedAt: string;
}>;

export type EffectiveAnalysisContextFacts = Readonly<{
  identity: Readonly<{
    connectionRef: string;
    campaignRef: string;
    hierarchyRefs: readonly string[];
  }>;
  /** All non-funnel observations are repository-owned; objective/event come only from config v2. */
  meta: Omit<EffectiveCampaignContextInput["meta"], "objective" | "optimizationEvent">;
  metaAnalysisConfigSnapshot: CanonicalMetaAnalysisConfigSnapshotV2;
  guidance: EffectiveCampaignContextInput["guidance"];
  cadence: EffectiveCampaignContextInput["cadence"];
  cadenceEvidence: NonNullable<EffectiveCampaignContextInput["cadenceEvidence"]>;
  data: EffectiveCampaignContextInput["data"];
  history: EffectiveCampaignContextInput["history"];
  /** The policy registry and policy-authority versions are established only by the authority closure. */
  versions: Omit<EffectiveCampaignContextInput["versions"], "instructionPolicyRegistry" | "policyAuthority">;
}>;

export type EffectiveAnalysisContextFactsReader = Readonly<{
  loadCurrent(input: EffectiveAnalysisContextRequest): Promise<EffectiveAnalysisContextFacts>;
}>;

export type RepositoryVerifiedAuthority = Readonly<{
  compose(baseContext: EffectiveCampaignContextInput, lifecycle: InstructionPolicyLifecycleState): Readonly<{
    context: EffectiveCampaignContext;
    validationBoundary: Readonly<{ contractIntegrity: "self_hash_validated"; productionAuthoritySourceBound: true }>;
    authority: Readonly<Record<string, false>>;
  }>;
}>;

export type EffectiveAnalysisContextAuthorityLoader = Readonly<{
  loadAuthority(input: Readonly<{ workspaceId: string; accountRef: string; evaluatedAt: string }>): Promise<RepositoryVerifiedAuthority>;
}>;

export type EffectiveAnalysisContextLifecycleReader = Readonly<{
  inspect(workspaceId: string): Promise<InstructionPolicyLifecycleState>;
}>;

export type EvidenceBoundEffectiveContextWriter = Readonly<{
  save(context: EffectiveCampaignContext, options: Readonly<{ mode: "evidence_bound" }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    record: StoredEffectiveCampaignContext;
  }>>;
}>;

export class EffectiveAnalysisContextComposerError extends Error {
  constructor(readonly code: "invalid_input" | "source_rejected" | "authority_rejected" | "invalidated_save") {
    super(`Effective analysis context rejected: ${code}`);
    this.name = "EffectiveAnalysisContextComposerError";
  }
}

function required(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) {
    throw new EffectiveAnalysisContextComposerError("invalid_input");
  }
  return value.trim();
}

function request(value: EffectiveAnalysisContextRequest): EffectiveAnalysisContextRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 5
    || Object.keys(value).some((key) => !["workspaceId", "accountRef", "entityType", "entityRef", "capturedAt"].includes(key))) {
    throw new EffectiveAnalysisContextComposerError("invalid_input");
  }
  const capturedAt = required(value.capturedAt);
  if (!Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt) {
    throw new EffectiveAnalysisContextComposerError("invalid_input");
  }
  if (!(["campaign", "ad_set", "ad", "creative"] as const).includes(value.entityType)) {
    throw new EffectiveAnalysisContextComposerError("invalid_input");
  }
  return Object.freeze({ workspaceId: required(value.workspaceId), accountRef: required(value.accountRef),
    entityType: value.entityType, entityRef: required(value.entityRef), capturedAt });
}

function categoryTarget(input: EffectiveAnalysisContextRequest, identity: EffectiveAnalysisContextFacts["identity"]): CategoryHierarchyTarget {
  const path = identity.hierarchyRefs;
  const expected = { campaign: 1, ad_set: 2, ad: 3, creative: 4 }[input.entityType];
  if (path.length !== expected || path[0] !== identity.campaignRef || path.at(-1) !== input.entityRef) {
    throw new EffectiveAnalysisContextComposerError("source_rejected");
  }
  if (input.entityType === "creative") {
    const viaAdId = path[2];
    if (!viaAdId) throw new EffectiveAnalysisContextComposerError("source_rejected");
    return Object.freeze({ level: "creative", id: input.entityRef, viaAdId });
  }
  return Object.freeze({ level: input.entityType, id: input.entityRef });
}

const POLICY_AUTHORITY_CAPABILITIES = Object.freeze([
  "canExecute", "canWriteMeta", "canApprove", "canSchedule", "canCallTool", "canAccessNetwork", "canQuerySql",
] as const);

function allFalse(value: Record<string, unknown>, expected?: readonly string[]): boolean {
  if (expected && (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value)))) return false;
  return Object.values(value).every((entry) => entry === false);
}

/**
 * Small, server-private orchestration seam. Production Drizzle adapters are
 * deliberately not implied: current config-v2/cadence/guidance/evidence reads
 * still need one consistent repository snapshot adapter.
 */
export class EffectiveAnalysisContextComposer {
  constructor(private readonly facts: EffectiveAnalysisContextFactsReader,
    private readonly categories: Pick<CurrentCategoryCompositionResolver, "resolve">,
    private readonly authority: EffectiveAnalysisContextAuthorityLoader,
    private readonly lifecycle: EffectiveAnalysisContextLifecycleReader,
    private readonly writer: EvidenceBoundEffectiveContextWriter) {}

  async composeAndSave(candidate: EffectiveAnalysisContextRequest): Promise<Readonly<{
    context: EffectiveCampaignContext;
    outcome: "inserted" | "unchanged";
  }>> {
    const input = request(candidate);
    let facts: EffectiveAnalysisContextFacts;
    try { facts = await this.facts.loadCurrent(input); }
    catch { throw new EffectiveAnalysisContextComposerError("source_rejected"); }
    const target = categoryTarget(input, facts.identity);
    let categoryComposition;
    let lifecycle: InstructionPolicyLifecycleState;
    let authority: RepositoryVerifiedAuthority;
    try {
      [categoryComposition, lifecycle, authority] = await Promise.all([
        this.categories.resolve(input.workspaceId, target),
        this.lifecycle.inspect(input.workspaceId),
        this.authority.loadAuthority({ workspaceId: input.workspaceId, accountRef: input.accountRef, evaluatedAt: input.capturedAt }),
      ]);
    } catch { throw new EffectiveAnalysisContextComposerError("source_rejected"); }
    let base: EffectiveCampaignContextInput;
    try {
      const projection = projectMetaAnalysisConfig(facts.metaAnalysisConfigSnapshot, facts.identity.campaignRef);
      base = Object.freeze({ workspaceId: input.workspaceId, capturedAt: input.capturedAt,
        identity: { connectionRef: facts.identity.connectionRef, accountRef: input.accountRef, campaignRef: facts.identity.campaignRef,
          entityRef: input.entityRef, entityType: input.entityType, hierarchyRefs: facts.identity.hierarchyRefs },
        meta: { ...facts.meta, objective: projection.objective, optimizationEvent: projection.optimizationEvent },
        metaAnalysisConfigEvidence: { snapshot: facts.metaAnalysisConfigSnapshot },
        categories: categoryComposition.dimensions.map((entry) => entry.frozenContext), guidance: facts.guidance,
        policies: [], cadence: facts.cadence, cadenceEvidence: facts.cadenceEvidence, data: facts.data, history: facts.history,
        versions: facts.versions,
      });
      // The build catches source scope/hash mismatches before policy composition.
      buildEffectiveCampaignContext(base);
    } catch { throw new EffectiveAnalysisContextComposerError("source_rejected"); }
    let composed: ReturnType<RepositoryVerifiedAuthority["compose"]>;
    try { composed = authority.compose(base, lifecycle); }
    catch { throw new EffectiveAnalysisContextComposerError("authority_rejected"); }
    if (composed.validationBoundary.productionAuthoritySourceBound !== true
      || composed.context.policyAuthorityEvidence === undefined || composed.context.versions.policyAuthority === undefined
      || !allFalse(composed.context.capabilities) || !allFalse(composed.authority, POLICY_AUTHORITY_CAPABILITIES)) {
      throw new EffectiveAnalysisContextComposerError("authority_rejected");
    }
    let persisted: Awaited<ReturnType<EvidenceBoundEffectiveContextWriter["save"]>>;
    try { persisted = await this.writer.save(composed.context, { mode: "evidence_bound" }); }
    catch { throw new EffectiveAnalysisContextComposerError("source_rejected"); }
    if (persisted.record.invalidated || persisted.record.context.contextHash !== composed.context.contextHash) {
      throw new EffectiveAnalysisContextComposerError("invalidated_save");
    }
    return Object.freeze({ context: composed.context, outcome: persisted.outcome });
  }
}
