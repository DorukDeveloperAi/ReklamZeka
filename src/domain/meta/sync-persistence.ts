import {
  type CanonicalMetaDailyInsight,
  type MetaDailyInsightInput,
  type MetaSyncRunStatus,
  type MetaSyncStream,
  normalizeMetaDailyInsight,
} from "./insights/contract";

export type MetaSyncScope = Readonly<{
  workspaceId: string;
  metaConnectionId: string;
  adAccountId: string;
  stream: MetaSyncStream;
}>;

export type MetaSyncCheckpoint = Readonly<{
  cursor: string | null;
  checkpoint: Readonly<Record<string, unknown>>;
  status: MetaSyncRunStatus;
  attemptCount: number;
  retryAt: string | null;
  errorClassification: string | null;
}>;

export type InsightUpsertOutcome = "inserted" | "updated" | "unchanged" | "stale";

type StoredInsight = Readonly<{ insight: CanonicalMetaDailyInsight; firstSeenAt: string; lastSeenAt: string }>;

function scopeKey(scope: MetaSyncScope): string {
  return [scope.workspaceId, scope.metaConnectionId, scope.adAccountId, scope.stream].join(":");
}

function compareRevisions(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right);
}

/**
 * Deterministic persistence semantics used by the future DB adapter. It has no
 * connector or Graph dependency; transaction-backed storage must preserve these
 * same isolation, resume and stale-revision outcomes.
 */
export class InMemoryMetaSyncPersistence {
  private readonly checkpoints = new Map<string, MetaSyncCheckpoint>();
  private readonly insights = new Map<string, StoredInsight>();

  checkpoint(scope: MetaSyncScope): MetaSyncCheckpoint | undefined {
    return this.checkpoints.get(scopeKey(scope));
  }

  saveCheckpoint(scope: MetaSyncScope, checkpoint: MetaSyncCheckpoint): void {
    this.checkpoints.set(scopeKey(scope), structuredClone(checkpoint));
  }

  resume(scope: MetaSyncScope): MetaSyncCheckpoint | undefined {
    const checkpoint = this.checkpoints.get(scopeKey(scope));
    return checkpoint ? structuredClone(checkpoint) : undefined;
  }

  upsertInsight(input: MetaDailyInsightInput, observedAt: string): InsightUpsertOutcome {
    const insight = normalizeMetaDailyInsight(input);
    const current = this.insights.get(insight.identity);
    if (!current) {
      this.insights.set(insight.identity, { insight, firstSeenAt: observedAt, lastSeenAt: observedAt });
      return "inserted";
    }
    if (compareRevisions(insight.sourceRevision, current.insight.sourceRevision) < 0) return "stale";
    if (insight.contentHash === current.insight.contentHash) {
      this.insights.set(insight.identity, { ...current, lastSeenAt: observedAt });
      return "unchanged";
    }
    this.insights.set(insight.identity, { insight, firstSeenAt: current.firstSeenAt, lastSeenAt: observedAt });
    return "updated";
  }

  values(): readonly StoredInsight[] {
    return [...this.insights.values()].sort((a, b) => a.insight.identity.localeCompare(b.insight.identity));
  }
}
