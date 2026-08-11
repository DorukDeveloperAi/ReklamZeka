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
  compose(baseContext: EffectiveCampaignContextInput, lifecycle: InstructionPolicyLifecycleState,
    categoryTarget?: CategoryHierarchyTarget): Readonly<{
    context: EffectiveCampaignContext;
    validationBoundary: Readonly<{ contractIntegrity: "self_hash_validated"; productionAuthoritySourceBound: true }>;
    authority: Readonly<Record<string, false>>;
  }>;
}>;

export type EffectiveAnalysisContextReadySource = Readonly<{
  status: "ready";
  capturedAt: string;
  facts: EffectiveAnalysisContextFacts;
  /**
   * Category paths use repository-internal hierarchy UUIDs.  The source reader
   * resolves this target from the requested external Meta ref inside its same
   * repeatable-read snapshot, so the composer can validate the frozen category
   * evidence without conflating the two identifier namespaces.
   */
  categories: Readonly<{ workspaceId: string; target: CategoryHierarchyTarget;
    dimensions: readonly { frozenContext: EffectiveCampaignContextInput["categories"][number] }[] }>;
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
  constructor(readonly code: "invalid_input" | "source_rejected" | "authority_rejected" | "invalidated_save",
    /** Server-side diagnostic only; it never grants authority or replaces the stable public rejection code. */
    readonly diagnosticCode?: string) {
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
 * Keep the public result fail-closed while retaining the repository's stable
 * classification for server-side verification.  Never expose arbitrary driver
 * messages: they may contain SQL or tenant details and are not a contract.
 */
function diagnosticCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return undefined;
  const detail = "diagnosticCode" in error && typeof error.diagnosticCode === "string" ? `:${error.diagnosticCode}` : "";
  return `${error.code}${detail}`;
}

/**
 * Small, server-private orchestration seam. The source reader owns snapshot
 * consistency; this composer never stitches independently read components.
 */
export class EffectiveAnalysisContextComposer {
  constructor(private readonly sourceReader: EffectiveAnalysisContextSourceReader,
    private readonly writer: EvidenceBoundEffectiveContextWriter) {}

  /** Server-private composition seam for a derived immutable evidence context. */
  async compose(candidate: EffectiveAnalysisContextRequest): Promise<Readonly<{ context: EffectiveCampaignContext }>> {
    const input = request(candidate);
    let source: EffectiveAnalysisContextSource;
    try { source = await this.sourceReader.loadCurrent(input); }
    catch { throw new EffectiveAnalysisContextComposerError("source_rejected"); }
    if (source.status !== "ready" || !Number.isFinite(Date.parse(source.capturedAt))
      || new Date(source.capturedAt).toISOString() !== source.capturedAt) {
      throw new EffectiveAnalysisContextComposerError("source_rejected");
    }
    const facts = source.facts;
    // Validate the caller's external hierarchy against repository-owned Meta
    // identity.  Category evidence itself is keyed by the separately verified
    // internal target supplied by the same source snapshot.
    categoryTarget(input, facts.identity);
    const categoryComposition = source.categories;
    const lifecycle = source.lifecycle;
    const authority = source.authority;
    const resolvedCategoryTarget = categoryComposition.target;
    if (categoryComposition.workspaceId !== input.workspaceId || categoryComposition.dimensions.length === 0
      || resolvedCategoryTarget.level !== input.entityType || !resolvedCategoryTarget.id.trim()
      || (resolvedCategoryTarget.level === "creative" && !resolvedCategoryTarget.viaAdId.trim())
      || categoryComposition.dimensions.some((entry) => entry.frozenContext.path.at(-1)?.id !== resolvedCategoryTarget.id)) {
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
    try { composed = authority.compose(base, lifecycle, resolvedCategoryTarget); }
    catch (error) { throw new EffectiveAnalysisContextComposerError("authority_rejected", diagnosticCodeOf(error)); }
    if (composed.validationBoundary.productionAuthoritySourceBound !== true
      || composed.context.policyAuthorityEvidence === undefined || composed.context.versions.policyAuthority === undefined
      || !allFalse(composed.context.capabilities) || !allFalse(composed.authority, POLICY_AUTHORITY_CAPABILITIES)) {
      throw new EffectiveAnalysisContextComposerError("authority_rejected");
    }
    return Object.freeze({ context: composed.context });
  }

  async composeAndSave(candidate: EffectiveAnalysisContextRequest): Promise<Readonly<{
    context: EffectiveCampaignContext;
    outcome: "inserted" | "unchanged";
  }>> {
    const composed = await this.compose(candidate);
    let persisted: Awaited<ReturnType<EvidenceBoundEffectiveContextWriter["save"]>>;
    try { persisted = await this.writer.save(composed.context, { mode: "evidence_bound" }); }
    catch (error) { throw new EffectiveAnalysisContextComposerError("source_rejected", diagnosticCodeOf(error)); }
    if (persisted.record.invalidated || persisted.record.context.contextHash !== composed.context.contextHash) {
      throw new EffectiveAnalysisContextComposerError("invalidated_save");
    }
    return Object.freeze({ context: composed.context, outcome: persisted.outcome });
  }
}
