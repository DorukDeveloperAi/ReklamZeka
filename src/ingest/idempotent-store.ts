import { createHash } from "node:crypto";
import { metricIdentity, type CanonicalDailyMetric } from "@/domain/ads/canonical";

export type UpsertOutcome = "inserted" | "updated" | "unchanged";

export type StoredMetric = Readonly<{
  metric: CanonicalDailyMetric;
  contentHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
}>;

function contentHash(metric: CanonicalDailyMetric): string {
  return createHash("sha256").update(JSON.stringify(metric)).digest("hex");
}

export class InMemoryMetricStore {
  private readonly records = new Map<string, StoredMetric>();

  upsert(metric: CanonicalDailyMetric, observedAt: string): UpsertOutcome {
    const key = metricIdentity(metric);
    const hash = contentHash(metric);
    const current = this.records.get(key);
    if (!current) {
      this.records.set(key, { metric, contentHash: hash, firstSeenAt: observedAt, lastSeenAt: observedAt });
      return "inserted";
    }
    if (current.contentHash === hash) {
      this.records.set(key, { ...current, lastSeenAt: observedAt });
      return "unchanged";
    }
    this.records.set(key, { metric, contentHash: hash, firstSeenAt: current.firstSeenAt, lastSeenAt: observedAt });
    return "updated";
  }

  values(): readonly StoredMetric[] {
    return [...this.records.values()].sort((left, right) => metricIdentity(left.metric).localeCompare(metricIdentity(right.metric)));
  }

  get size(): number {
    return this.records.size;
  }
}
