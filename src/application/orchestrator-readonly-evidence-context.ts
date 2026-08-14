import { createHash } from "node:crypto";
import { CanonicalPerformanceReadService, type CanonicalPerformanceReadRepository } from "@/application/canonical-performance-read-service";
import type { OperationalTimelineEvent, OperationalTimelineRepository } from "@/application/operational-timeline-read-service";

export const ORCHESTRATOR_READONLY_EVIDENCE_CONTEXT_VERSION = "orchestrator-readonly-evidence-context/1.0.0" as const;
export type OrchestratorReadOnlyEvidenceContext = Readonly<{
  version: typeof ORCHESTRATOR_READONLY_EVIDENCE_CONTEXT_VERSION;
  performance: Readonly<{ state: "ready" | "partial" | "unavailable"; accountCount: number; campaignCount: number;
    windows: readonly Readonly<{ days: 7 | 30; readyCount: number; partialCount: number; unavailableCount: number; latestFreshnessAt: string | null }>[] }>;
  timeline: Readonly<{ state: "ready" | "unavailable"; eventCount: number; latestOccurredAt: string | null;
    kinds: readonly Readonly<{ kind: OperationalTimelineEvent["kind"]; count: number }>[] }>;
}>;
export type OrchestratorReadOnlyEvidenceContextSnapshot = OrchestratorReadOnlyEvidenceContext;
export type UnavailableOrchestratorReadOnlyEvidenceContextSnapshot = Readonly<{ version: "unavailable_not_bound" }>;

export class OrchestratorReadOnlyEvidenceContextError extends Error {
  constructor() { super("orchestrator_readonly_evidence_context_unavailable"); this.name = "OrchestratorReadOnlyEvidenceContextError"; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS: readonly OperationalTimelineEvent["kind"][] = ["slice_rule_draft", "budget_proposal", "budget_selection", "action_preparation", "delivery_alert", "approval_proposed", "approval_decision", "temporal_evaluation"];

function fail(): never { throw new OrchestratorReadOnlyEvidenceContextError(); }
function iso(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value); if (!Number.isFinite(date.valueOf())) fail();
  return date.toISOString();
}

/** Builds a bounded aggregate. It never carries account/campaign identifiers, names, metrics, event titles, details, actions or SQL. */
export function createOrchestratorReadOnlyEvidenceContext(input: Readonly<{
  performance: Awaited<ReturnType<CanonicalPerformanceReadService["read"]>>;
  timeline: readonly OperationalTimelineEvent[];
}>): OrchestratorReadOnlyEvidenceContext {
  const performance = input.performance;
  if (!performance || performance.version !== "canonical-performance-read/1.0.0"
    || !["ready", "partial", "unavailable"].includes(performance.state) || !Array.isArray(performance.accounts)
    || performance.accounts.length > 100 || !Array.isArray(input.timeline) || input.timeline.length > 12) fail();
  const windows = ([7, 30] as const).map((days) => {
    let readyCount = 0; let partialCount = 0; let unavailableCount = 0; const freshness: string[] = [];
    for (const account of performance.accounts) {
      if (!Array.isArray(account.campaigns) || account.campaigns.length > 2_000) fail();
      const window = account.windows.find((candidate) => candidate.days === days);
      if (!window || !["ready", "partial", "unavailable"].includes(window.state)) fail();
      if (window.state === "ready") readyCount += 1; else if (window.state === "partial") partialCount += 1; else unavailableCount += 1;
      const at = iso(window.freshnessAt); if (at) freshness.push(at);
    }
    return Object.freeze({ days, readyCount, partialCount, unavailableCount, latestFreshnessAt: freshness.sort().at(-1) ?? null });
  });
  const counts = new Map<OperationalTimelineEvent["kind"], number>(); let latestOccurredAt: string | null = null;
  for (const event of input.timeline) {
    if (!event || !KINDS.includes(event.kind) || typeof event.title !== "string" || typeof event.detail !== "string") fail();
    const at = iso(event.occurredAt); if (!at) fail();
    const previousLatest: string | null = latestOccurredAt;
    latestOccurredAt = previousLatest === null || at.localeCompare(previousLatest) > 0 ? at : previousLatest;
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  const campaignCount = performance.accounts.reduce((total, account) => total + account.campaigns.length, 0);
  return Object.freeze({ version: ORCHESTRATOR_READONLY_EVIDENCE_CONTEXT_VERSION,
    performance: Object.freeze({ state: performance.state, accountCount: performance.accounts.length, campaignCount,
      windows: Object.freeze(windows) }), timeline: Object.freeze({ state: "ready", eventCount: input.timeline.length,
      latestOccurredAt, kinds: Object.freeze([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => Object.freeze({ kind, count }))) }) });
}

export function orchestratorReadOnlyEvidenceContextHash(snapshot: OrchestratorReadOnlyEvidenceContextSnapshot | UnavailableOrchestratorReadOnlyEvidenceContextSnapshot): string {
  if (snapshot.version === "unavailable_not_bound") return "UNAVAILABLE_NOT_BOUND";
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
export function unavailableOrchestratorReadOnlyEvidenceContext(): UnavailableOrchestratorReadOnlyEvidenceContextSnapshot {
  return Object.freeze({ version: "unavailable_not_bound" });
}
export type OrchestratorReadOnlyEvidenceContextLoader = Readonly<{ load(scope: Readonly<{ workspaceId: string }>): Promise<OrchestratorReadOnlyEvidenceContext> }>;

/** Server-private bridge over existing public-safe read models. It does not create, alter, approve or execute any record. */
export class ReadOnlyEvidenceContextService implements OrchestratorReadOnlyEvidenceContextLoader {
  constructor(private readonly performance: CanonicalPerformanceReadRepository, private readonly timeline: OperationalTimelineRepository) {}
  async load(scope: Readonly<{ workspaceId: string }>): Promise<OrchestratorReadOnlyEvidenceContext> {
    if (!UUID.test(scope.workspaceId)) fail();
    try {
      const [performance, timeline] = await Promise.all([
        new CanonicalPerformanceReadService(this.performance).read(scope.workspaceId),
        this.timeline.list({ workspaceId: scope.workspaceId, limit: 12 }),
      ]);
      return createOrchestratorReadOnlyEvidenceContext({ performance, timeline });
    } catch (reason) { if (reason instanceof OrchestratorReadOnlyEvidenceContextError) throw reason; fail(); }
  }
}
