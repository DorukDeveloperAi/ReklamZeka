import { describe, expect, it } from "vitest";
import {
  MetaTrustReadinessEvidenceAdapter,
  MetaTrustReadinessScopeError,
  metaTrustInputFromStoredEvidence,
  type MetaTrustReadinessScope,
  type MetaTrustReadStore,
  type MetaTrustStoredAccountEvidence,
} from "@/connectors/meta/sync/trust-readiness-drizzle-adapter";
import { MetaTrustReadinessValidationError, type TrustStreamEvidence } from "@/domain/meta/trust-readiness";

const scope: MetaTrustReadinessScope = {
  workspaceId: "11111111-1111-4111-a111-111111111111",
  connectionId: "22222222-2222-4222-a222-222222222222",
  selectedExternalAccountIds: ["act_1000000001", "act_2000000002"],
  evaluatedAt: "2026-08-07T12:00:00.000Z",
};

function stream(kind: TrustStreamEvidence["stream"], identities: readonly string[] = []): TrustStreamEvidence {
  return {
    stream: kind,
    required: kind === "hierarchy" || kind === "insights",
    permission: { status: "verified", reason: "none" },
    lastSuccessfulAt: "2026-08-07T11:00:00.000Z",
    coverage: {
      entity: { expected: 1, observed: 1 },
      metric: { expected: 0, observed: 0 },
      content: { expected: 0, observed: 0 },
    },
    orphanCount: 0,
    duplicateCount: 0,
    replayCount: 0,
    entityIdentityKeys: identities,
  };
}

function account(
  externalAccountId: string,
  identities: readonly string[],
  overrides: Partial<MetaTrustStoredAccountEvidence> = {},
): MetaTrustStoredAccountEvidence {
  return {
    workspaceId: scope.workspaceId,
    connectionId: scope.connectionId,
    internalAccountId: `internal:${externalAccountId}`,
    externalAccountId,
    currency: "TRY",
    timezone: "Europe/Istanbul",
    attributionWindows: ["7d_click_1d_view"],
    streams: [
      stream("hierarchy", identities),
      stream("insights", identities.map((identity) => `insight:${identity}`)),
      stream("content"),
      stream("assets"),
    ],
    ...overrides,
  };
}

class FixtureStore implements MetaTrustReadStore {
  constructor(private readonly rows: readonly MetaTrustStoredAccountEvidence[]) {}
  readScopedAccounts(): Promise<readonly MetaTrustStoredAccountEvidence[]> {
    return Promise.resolve(this.rows);
  }
}

describe("Meta trust/readiness Drizzle evidence adapter boundary", () => {
  it("keeps two selected accounts isolated and returns only masked public references", async () => {
    const rows = [
      account("act_1000000001", ["campaign:global-1"]),
      account("act_2000000002", ["campaign:global-2"]),
    ];
    const report = await new MetaTrustReadinessEvidenceAdapter(new FixtureStore(rows)).buildReport(scope);

    expect(report.accounts).toHaveLength(2);
    expect(new Set(report.accounts.map((entry) => entry.accountRef)).size).toBe(2);
    expect(report.accounts.every((entry) => /^acct_[a-f0-9]{12}$/.test(entry.accountRef))).toBe(true);
    const publicJson = JSON.stringify(report);
    for (const privateValue of [scope.workspaceId, scope.connectionId, "act_1000000001", "act_2000000002", "global-1", "global-2"]) {
      expect(publicJson).not.toContain(privateValue);
    }
  });

  it("fails closed when the same global Meta entity identity appears under two accounts", async () => {
    const collision = "campaign:shared-global-meta-id";
    const adapter = new MetaTrustReadinessEvidenceAdapter(new FixtureStore([
      account("act_1000000001", [collision]),
      account("act_2000000002", [collision]),
    ]));

    await expect(adapter.buildReport(scope)).rejects.toMatchObject({
      code: "cross_account_duplicate_identity",
    } satisfies Partial<MetaTrustReadinessValidationError>);
  });

  it("rejects a store row from another workspace, connection or unselected account", () => {
    const valid = account("act_1000000001", ["campaign:one"]);
    const otherWorkspace = account("act_2000000002", ["campaign:two"], { workspaceId: "other-workspace" });

    expect(() => metaTrustInputFromStoredEvidence(scope, [valid, otherWorkspace]))
      .toThrowError(expect.objectContaining<Partial<MetaTrustReadinessScopeError>>({ code: "account_scope_mismatch" }));
  });

  it("does not convert absent attribution or stream evidence into zero/verified", async () => {
    const unknownStream: TrustStreamEvidence = {
      ...stream("insights"),
      permission: { status: "unknown", reason: "not_checked" },
      lastSuccessfulAt: null,
      coverage: {
        entity: { expected: null, observed: null },
        metric: { expected: null, observed: null },
        content: { expected: 0, observed: 0 },
      },
      orphanCount: null,
      duplicateCount: 0,
      replayCount: null,
    };
    const evidence = account("act_1000000001", ["campaign:one"], {
      attributionWindows: null,
      streams: [stream("hierarchy", ["campaign:one"]), unknownStream, stream("content"), stream("assets")],
    });
    const oneAccountScope = { ...scope, selectedExternalAccountIds: ["act_1000000001"] };
    const report = await new MetaTrustReadinessEvidenceAdapter(new FixtureStore([evidence])).buildReport(oneAccountScope);

    expect(report.status).toBe("not_ready");
    expect(report.reasonCodes).toContain("ACCOUNT_ATTRIBUTION_UNKNOWN");
    const insight = report.accounts[0]!.streams.find((entry) => entry.stream === "insights")!;
    expect(insight.coverageRatios.entity).toBeNull();
    expect(insight.freshnessAgeHours).toBeNull();
    expect(insight.replayCount).toBeNull();
    expect(insight.reasonCodes).toContain("STREAM_PERMISSION_UNKNOWN");
  });

  it("requires an exact selected-account set and rejects duplicate selections", () => {
    expect(() => metaTrustInputFromStoredEvidence(scope, [account("act_1000000001", ["campaign:one"])]))
      .toThrowError(expect.objectContaining<Partial<MetaTrustReadinessScopeError>>({ code: "account_scope_mismatch" }));
    expect(() => metaTrustInputFromStoredEvidence(
      { ...scope, selectedExternalAccountIds: ["act_1000000001", "act_1000000001"] },
      [account("act_1000000001", ["campaign:one"])],
    )).toThrowError(expect.objectContaining<Partial<MetaTrustReadinessScopeError>>({ code: "duplicate_selection" }));
  });
});
