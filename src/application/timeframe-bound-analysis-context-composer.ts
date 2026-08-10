import { buildEffectiveCampaignContext, type EffectiveCampaignContext, type EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import { validateResolvedAnalysisTimeframe, type ResolvedAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import type { DeterministicWindowSnapshot } from "@/analyses/deterministic-window-snapshot";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";

type CurrentContextReader = Readonly<{
  loadLatestValid(input: Readonly<{
    workspaceId: string;
    entityType: EffectiveCampaignContext["identity"]["entityType"];
    entityRef: string;
  }>): Promise<StoredEffectiveCampaignContext | null>;
}>;

type TimeframeWindowMaterializer = Readonly<{
  materializeForTimeframe(input: Readonly<{
    workspaceId: string;
    metaConnectionId: string;
    adAccountId: string;
    entityLevel: "campaign" | "ad_set" | "ad";
    externalEntityId: string;
    timeframe: ResolvedAnalysisTimeframe;
  }>): Promise<Readonly<{ window: DeterministicWindowSnapshot; outcome: "inserted" | "unchanged" }>>;
}>;

type EvidenceBoundContextWriter = Readonly<{
  save(context: EffectiveCampaignContext, options: Readonly<{ mode: "evidence_bound" }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    record: StoredEffectiveCampaignContext;
  }>>;
}>;

export class TimeframeBoundAnalysisContextComposerError extends Error {
  constructor(readonly code: "invalid_input" | "source_rejected" | "stale_source" | "persistence_rejected") {
    super(`Timeframe-bound analysis context rejected: ${code}`);
    this.name = "TimeframeBoundAnalysisContextComposerError";
  }
}

function required(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 256) {
    throw new TimeframeBoundAnalysisContextComposerError("invalid_input");
  }
  return value.trim();
}

function request(value: unknown): Readonly<{
  workspaceId: string;
  entityType: "campaign" | "ad_set" | "ad";
  entityRef: string;
  timeframe: ResolvedAnalysisTimeframe;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 4
    || Object.keys(value).some((key) => !["workspaceId", "entityType", "entityRef", "timeframe"].includes(key))) {
    throw new TimeframeBoundAnalysisContextComposerError("invalid_input");
  }
  const candidate = value as Record<string, unknown>;
  if (!(["campaign", "ad_set", "ad"] as const).includes(candidate.entityType as "campaign" | "ad_set" | "ad")) {
    throw new TimeframeBoundAnalysisContextComposerError("invalid_input");
  }
  try { validateResolvedAnalysisTimeframe(candidate.timeframe as ResolvedAnalysisTimeframe); }
  catch { throw new TimeframeBoundAnalysisContextComposerError("invalid_input"); }
  return Object.freeze({ workspaceId: required(candidate.workspaceId), entityType: candidate.entityType as "campaign" | "ad_set" | "ad",
    entityRef: required(candidate.entityRef), timeframe: candidate.timeframe as ResolvedAnalysisTimeframe });
}

function inputOf(context: EffectiveCampaignContext): EffectiveCampaignContextInput {
  const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...input } = context;
  return input;
}

/**
 * Private bridge from an already repository-verified current context to a
 * timeframe-bound L3 context. The caller cannot inject context facts, L2
 * features, window refs, source IDs, or capture time.
 */
export class TimeframeBoundAnalysisContextComposer {
  constructor(
    private readonly contexts: CurrentContextReader,
    private readonly windows: TimeframeWindowMaterializer,
    private readonly writer: EvidenceBoundContextWriter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async composeAndSave(candidate: unknown): Promise<Readonly<{
    context: EffectiveCampaignContext;
    window: DeterministicWindowSnapshot;
    outcome: "inserted" | "unchanged";
  }>> {
    const input = request(candidate);
    const source = await this.contexts.loadLatestValid({ workspaceId: input.workspaceId, entityType: input.entityType, entityRef: input.entityRef });
    if (!source || source.invalidated || source.analysisDataScope === undefined || source.context.workspaceId !== input.workspaceId
      || source.context.identity.entityType !== input.entityType || source.context.identity.entityRef !== input.entityRef) {
      throw new TimeframeBoundAnalysisContextComposerError("source_rejected");
    }
    const capturedAt = this.now().toISOString();
    if (!Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) <= Date.parse(source.context.capturedAt)) {
      throw new TimeframeBoundAnalysisContextComposerError("stale_source");
    }
    let materialized: Awaited<ReturnType<TimeframeWindowMaterializer["materializeForTimeframe"]>>;
    try {
      materialized = await this.windows.materializeForTimeframe({ workspaceId: input.workspaceId,
        metaConnectionId: source.analysisDataScope.metaConnectionId, adAccountId: source.analysisDataScope.adAccountId,
        entityLevel: input.entityType, externalEntityId: input.entityRef, timeframe: input.timeframe });
    } catch { throw new TimeframeBoundAnalysisContextComposerError("source_rejected"); }
    let context: EffectiveCampaignContext;
    try {
      const base = inputOf(source.context);
      context = buildEffectiveCampaignContext({ ...base, capturedAt, data: {
        trustStatus: "ready", snapshotRefs: base.data.snapshotRefs,
        featureRefs: materialized.window.featureRefs, windowRefs: [materialized.window.windowRef], blockers: [],
      } });
    } catch { throw new TimeframeBoundAnalysisContextComposerError("source_rejected"); }
    let persisted: Awaited<ReturnType<EvidenceBoundContextWriter["save"]>>;
    try { persisted = await this.writer.save(context, { mode: "evidence_bound" }); }
    catch { throw new TimeframeBoundAnalysisContextComposerError("persistence_rejected"); }
    if (persisted.record.invalidated || persisted.record.context.contextHash !== context.contextHash) {
      throw new TimeframeBoundAnalysisContextComposerError("persistence_rejected");
    }
    return Object.freeze({ context, window: materialized.window, outcome: persisted.outcome });
  }
}
