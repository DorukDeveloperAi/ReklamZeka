import type { EffectiveCampaignContext, EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
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

export type RepositoryVerifiedAuthority = Readonly<{
  compose(baseContext: EffectiveCampaignContextInput, lifecycle: InstructionPolicyLifecycleState): Readonly<{
    context: EffectiveCampaignContext;
    validationBoundary: Readonly<{ contractIntegrity: "self_hash_validated"; productionAuthoritySourceBound: true }>;
    authority: Readonly<Record<string, false>>;
  }>;
}>;

export type EffectiveAnalysisContextReadySource = Readonly<{
  status: "ready";
  capturedAt: string;
  facts: EffectiveAnalysisContextFacts;
  categories: Readonly<{ workspaceId: string; dimensions: readonly { frozenContext: EffectiveCampaignContextInput["categories"][number] }[] }>;
  lifecycle: InstructionPolicyLifecycleState;
  authority: RepositoryVerifiedAuthority;
}>;

/**
 * A source adapter must fail closed until every context component is read and
 * validated from the same repository snapshot. These flags are descriptive,
 * never a grant, and deliberately all false.
 */
export type EffectiveAnalysisContextNotReadySource = Readonly<{
  status: "not_ready";
  capturedAt: string;
  reason: "current_source_bundle_unavailable";
  capabilities: Readonly<{
    canCompose: false;
    canAuthorizeAction: false;
    canExecute: false;
    canExecuteWrite: false;
    canWriteMeta: false;
    canApprove: false;
    canSchedule: false;
    canCallTool: false;
    canAccessNetwork: false;
    canQuerySql: false;
  }>;
}>;

export type EffectiveAnalysisContextSource = EffectiveAnalysisContextReadySource | EffectiveAnalysisContextNotReadySource;

/** The composer receives one repository-owned source bundle, never partial readers. */
export type EffectiveAnalysisContextSourceReader = Readonly<{
  loadCurrent(input: EffectiveAnalysisContextRequest): Promise<EffectiveAnalysisContextSource>;
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
    || Object.keys(value).length !== 4
    || Object.keys(value).some((key) => !["workspaceId", "accountRef", "entityType", "entityRef"].includes(key))) {
    throw new EffectiveAnalysisContextComposerError("invalid_input");
  }
  if (!(["campaign", "ad_set", "ad", "creative"] as const).includes(value.entityType)) {
    throw new EffectiveAnalysisContextComposerError("invalid_input");
  }
  return Object.freeze({ workspaceId: required(value.workspaceId), accountRef: required(value.accountRef),
    entityType: value.entityType, entityRef: required(value.entityRef) });
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
 * Small, server-private orchestration seam. The source reader owns snapshot
 * consistency; this composer never stitches independently read components.
 */
export class EffectiveAnalysisContextComposer {
  constructor(private readonly sourceReader: EffectiveAnalysisContextSourceReader,
    private readonly writer: EvidenceBoundEffectiveContextWriter) {}

  async composeAndSave(candidate: EffectiveAnalysisContextRequest): Promise<Readonly<{
    context: EffectiveCampaignContext;
    outcome: "inserted" | "unchanged";
  }>> {
    const input = request(candidate);
    let source: EffectiveAnalysisContextSource;
    try { source = await this.sourceReader.loadCurrent(input); }
    catch { throw new EffectiveAnalysisContextComposerError("source_rejected"); }
    if (source.status !== "ready" || !Number.isFinite(Date.parse(source.capturedAt))
      || new Date(source.capturedAt).toISOString() !== source.capturedAt) {
      throw new EffectiveAnalysisContextComposerError("source_rejected");
    }
    const facts = source.facts;
    const target = categoryTarget(input, facts.identity);
    const categoryComposition = source.categories;
    const lifecycle = source.lifecycle;
    const authority = source.authority;
    if (categoryComposition.workspaceId !== input.workspaceId || categoryComposition.dimensions.length === 0
      || categoryComposition.dimensions.some((entry) => entry.frozenContext.path.at(-1)?.id !== target.id)) {
      throw new EffectiveAnalysisContextComposerError("source_rejected");
    }
    let base: EffectiveCampaignContextInput;
    try {
      const projection = projectMetaAnalysisConfig(facts.metaAnalysisConfigSnapshot, facts.identity.campaignRef);
      base = Object.freeze({ workspaceId: input.workspaceId, capturedAt: source.capturedAt,
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
