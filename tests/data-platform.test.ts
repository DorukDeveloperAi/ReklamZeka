import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConnectorError, type ReadOnlyAdConnector } from "@/connectors/contract";
import { CsvAdConnector } from "@/connectors/csv";
import {
  GoogleAdsFixtureConnector,
  MetaAdsFixtureConnector,
  type GoogleAdsFixture,
  type MetaAdsFixture,
} from "@/connectors/fixtures";
import { withConnectorRetry } from "@/connectors/retry";
import { comparableMetrics } from "@/domain/ads/canonical";
import { InMemoryMetricStore } from "@/ingest/idempotent-store";
import { runIngest } from "@/ingest/run-ingest";

const metaPages = JSON.parse(readFileSync(new URL("./fixtures/meta-ads.json", import.meta.url), "utf8"));
const googlePages = JSON.parse(readFileSync(new URL("./fixtures/google-ads.json", import.meta.url), "utf8"));
const csv = readFileSync(new URL("./fixtures/ads.csv", import.meta.url), "utf8");
const workspaceId = "workspace-test";

async function firstMetric(connector: ReadOnlyAdConnector) {
  const page = await connector.fetchPage();
  const record = page.records[0];
  if (!record) throw new Error("Fixture boş");
  return connector.toCanonical(record, workspaceId);
}

describe("connector contract and canonical model", () => {
  it("keeps all connector capabilities read-only and cursor-aware", async () => {
    const connectors: ReadOnlyAdConnector[] = [
      new MetaAdsFixtureConnector(metaPages),
      new GoogleAdsFixtureConnector(googlePages),
      new CsvAdConnector(csv),
    ];
    for (const connector of connectors) {
      expect(connector.access).toBe("read_only");
      expect(connector.rateLimit.maxRequests).toBeGreaterThan(0);
      expect((await connector.fetchPage()).records).toHaveLength(1);
    }
    expect((await connectors[0]!.fetchPage()).nextCursor).toBe("1");
  });

  it("normalizes Meta, Google and CSV fixtures to the same common metrics", async () => {
    const metrics = await Promise.all([
      firstMetric(new MetaAdsFixtureConnector(metaPages)),
      firstMetric(new GoogleAdsFixtureConnector(googlePages)),
      firstMetric(new CsvAdConnector(csv)),
    ]);
    const common = metrics.map((metric) => {
      const { attribution: _attribution, ...rest } = comparableMetrics(metric);
      return rest;
    });
    expect(common[1]).toEqual(common[0]);
    expect(common[2]).toEqual(common[0]);
    expect(metrics.map((metric) => metric.attribution.model)).toEqual([
      "platform_default",
      "data_driven",
      "last_click",
    ]);
    expect(metrics[2]!.accountName).toBe("Ana, Hesap");
  });

  it("retries only retryable connector failures and respects retry-after", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await withConnectorRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw new ConnectorError("rate_limited", "Yavaşla", true, 42);
      return "ok";
    }, { sleep: async (delay) => { delays.push(delay); } });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(delays).toEqual([42]);
  });
});

describe("idempotent ingest", () => {
  it("resumes from a cursor and does not duplicate a replayed fixture", async () => {
    const store = new InMemoryMetricStore();
    const connector = new MetaAdsFixtureConnector(metaPages);
    const partial = await runIngest(connector, store, workspaceId, { maxPages: 1 });
    expect(partial).toMatchObject({ completed: false, inserted: 1, resumeCursor: "1" });

    const resumed = await runIngest(connector, store, workspaceId, { cursor: partial.resumeCursor });
    expect(resumed).toMatchObject({ completed: true, inserted: 1 });
    expect(store.size).toBe(2);

    const replayed = await runIngest(new MetaAdsFixtureConnector(metaPages), store, workspaceId);
    expect(replayed).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(store.size).toBe(2);
  });

  it("updates late source data in place while preserving the canonical row", async () => {
    const store = new InMemoryMetricStore();
    await runIngest(new MetaAdsFixtureConnector(metaPages), store, workspaceId, { maxPages: 1 });
    const latePages = structuredClone(metaPages) as Array<Array<{ id: string; updatedAt: string; payload: MetaAdsFixture }>>;
    latePages[0]![0]!.updatedAt = "2026-08-04T03:00:00.000Z";
    latePages[0]![0]!.payload = { ...latePages[0]![0]!.payload, spend: "130.00" };

    const result = await runIngest(new MetaAdsFixtureConnector(latePages.slice(0, 1)), store, workspaceId);
    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
    expect(store.size).toBe(1);
    expect(store.values()[0]!.metric.spendMinor).toBe(13_000);
    expect(store.values()[0]!.firstSeenAt).toBe("2026-08-06T12:00:00.000Z");
  });
});
