import { describe, expect, it } from "vitest";
import {
  buildMetaTrustReadinessReport,
  MetaTrustReadinessValidationError,
  type MetaTrustReadinessInput,
  type TrustAccountEvidence,
  type TrustStreamEvidence,
} from "@/domain/meta/trust-readiness";

function stream(overrides: Partial<TrustStreamEvidence> = {}): TrustStreamEvidence {
  return {
    stream: "hierarchy",
    required: true,
    permission: { status: "verified", reason: "none" },
    lastSuccessfulAt: "2026-08-07T09:00:00.000Z",
    coverage: {
      entity: { expected: 100, observed: 100 },
      metric: { expected: 10, observed: 10 },
      content: { expected: 20, observed: 20 },
    },
    orphanCount: 0,
    duplicateCount: 0,
    replayCount: 0,
    entityIdentityKeys: ["campaign:c-1"],
    ...overrides,
  };
}

function account(externalAccountId: string, overrides: Partial<TrustAccountEvidence> = {}): TrustAccountEvidence {
  return {
    externalAccountId,
    streams: [stream({ entityIdentityKeys: [`campaign:${externalAccountId}`] })],
    currencies: ["TRY"],
    timezones: ["Europe/Istanbul"],
    attributionWindows: ["7d_click_1d_view"],
    ...overrides,
  };
}

function input(accounts: readonly TrustAccountEvidence[]): MetaTrustReadinessInput {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-08-07T10:00:00.000Z",
    accounts,
  };
}

describe("Meta Trust/Readiness Report", () => {
  it("returns ready for fresh, complete and internally consistent evidence", () => {
    const report = buildMetaTrustReadinessReport(input([account("act_1234567890")]));

    expect(report.status).toBe("ready");
    expect(report.reasonCodes).toEqual([]);
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.accounts[0]).toMatchObject({ status: "ready", streams: [{ status: "ready" }] });
  });

  it("keeps missing evidence unknown instead of converting it to zero", () => {
    const evidence = account("act_1234567890", {
      streams: [stream({
        permission: { status: "unknown", reason: "not_checked" },
        lastSuccessfulAt: null,
        coverage: {
          entity: { expected: null, observed: null },
          metric: { expected: null, observed: null },
          content: { expected: null, observed: null },
        },
        orphanCount: null,
        duplicateCount: null,
        replayCount: null,
      })],
    });

    const report = buildMetaTrustReadinessReport(input([evidence]));
    const summary = report.accounts[0]!.streams[0]!;
    expect(report.status).toBe("not_ready");
    expect(summary.freshnessAgeHours).toBeNull();
    expect(summary.coverageRatios).toEqual({ entity: null, metric: null, content: null });
    expect(summary.orphanCount).toBeNull();
    expect(summary.reasonCodes).toEqual(expect.arrayContaining([
      "STREAM_PERMISSION_UNKNOWN",
      "STREAM_FRESHNESS_UNKNOWN",
      "ENTITY_COVERAGE_UNKNOWN",
      "DUPLICATE_COUNT_UNKNOWN",
    ]));
  });

  it("blocks mixed currency and requires explicit timezone/attribution segmentation", () => {
    const report = buildMetaTrustReadinessReport(input([
      account("act_1111111111", { currencies: ["TRY"], timezones: ["Europe/Istanbul"], attributionWindows: ["7d_click"] }),
      account("act_2222222222", { currencies: ["USD"], timezones: ["America/New_York"], attributionWindows: ["1d_click"] }),
    ]));

    expect(report.status).toBe("not_ready");
    expect(report.reasonCodes).toEqual(expect.arrayContaining([
      "PORTFOLIO_CURRENCY_MIXED",
      "PORTFOLIO_TIMEZONE_SEGMENT_REQUIRED",
      "PORTFOLIO_ATTRIBUTION_SEGMENT_REQUIRED",
    ]));

    const segmented = buildMetaTrustReadinessReport({
      ...input([
        account("act_1111111111", { currencies: ["TRY"], timezones: ["Europe/Istanbul"], attributionWindows: ["7d_click"] }),
        account("act_2222222222", { currencies: ["USD"], timezones: ["America/New_York"], attributionWindows: ["1d_click"] }),
      ]),
      portfolioSegmentation: { timezone: true, attribution: true },
    });
    expect(segmented.reasonCodes).toContain("PORTFOLIO_CURRENCY_MIXED");
    expect(segmented.reasonCodes).not.toContain("PORTFOLIO_TIMEZONE_SEGMENT_REQUIRED");
    expect(segmented.reasonCodes).not.toContain("PORTFOLIO_ATTRIBUTION_SEGMENT_REQUIRED");
  });

  it("is order-independent and retains both account summaries", () => {
    const left = account("act_1111111111", {
      streams: [
        stream({ stream: "insights", entityIdentityKeys: ["insight:i-2", "insight:i-1"] }),
        stream({ stream: "hierarchy", entityIdentityKeys: ["campaign:c-1"] }),
      ],
    });
    const right = account("act_2222222222", {
      streams: [stream({ entityIdentityKeys: ["campaign:c-2"] })],
    });
    const first = buildMetaTrustReadinessReport(input([left, right]));
    const reordered = buildMetaTrustReadinessReport(input([
      right,
      { ...left, streams: [...left.streams].reverse().map((item) => ({
        ...item,
        entityIdentityKeys: [...item.entityIdentityKeys].reverse(),
      })) },
    ]));

    expect(first.reportHash).toBe(reordered.reportHash);
    expect(first.accounts).toHaveLength(2);
    expect(new Set(first.accounts.map((item) => item.accountRef)).size).toBe(2);
  });

  it("fails closed on a cross-account entity identity collision", () => {
    const collision = "campaign:shared-raw-id";
    expect(() => buildMetaTrustReadinessReport(input([
      account("act_1111111111", { streams: [stream({ entityIdentityKeys: [collision] })] }),
      account("act_2222222222", { streams: [stream({ entityIdentityKeys: [collision] })] }),
    ]))).toThrowError(expect.objectContaining<Partial<MetaTrustReadinessValidationError>>({
      code: "cross_account_duplicate_identity",
    }));
  });

  it("supports caller thresholds without leaking IDs, tokens, raw payloads or ad text", () => {
    const externalAccountId = "act_1234567890";
    const token = "EAAB-sensitive-token";
    const rawPayload = "raw-payload-secret";
    const adText = "sensitive live ad copy";
    const evidence = {
      ...account(externalAccountId, {
        streams: [stream({
          lastSuccessfulAt: "2026-08-05T10:00:00.000Z",
          entityIdentityKeys: ["campaign:sensitive-entity-id"],
        })],
      }),
      token,
      rawPayload,
      adText,
    } as TrustAccountEvidence & { token: string; rawPayload: string; adText: string };

    const defaultReport = buildMetaTrustReadinessReport(input([evidence]));
    expect(defaultReport.status).toBe("degraded");
    const overrideReport = buildMetaTrustReadinessReport(input([evidence]), {
      freshness: { degradedAfterHours: 12, notReadyAfterHours: 24 },
    });
    expect(overrideReport.status).toBe("not_ready");
    expect(overrideReport.thresholdVersion).toMatch(/^trust-readiness\/v1\+custom_[a-f0-9]{8}$/);

    const serialized = JSON.stringify(overrideReport);
    for (const secret of [externalAccountId, token, rawPayload, adText, "sensitive-entity-id"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(overrideReport.accounts[0]!.accountRef).toMatch(/^acct_[a-f0-9]{12}$/);
  });

  it("does not call an empty portfolio or an account without streams ready", () => {
    const empty = buildMetaTrustReadinessReport(input([]));
    expect(empty.status).toBe("not_ready");
    expect(empty.reasonCodes).toContain("PORTFOLIO_ACCOUNTS_MISSING");

    const noStreams = buildMetaTrustReadinessReport(input([account("act_1234567890", { streams: [] })]));
    expect(noStreams.status).toBe("not_ready");
    expect(noStreams.accounts[0]!.reasonCodes).toContain("ACCOUNT_STREAMS_MISSING");
  });
});
