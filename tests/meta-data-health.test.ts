import { describe, expect, it } from "vitest";

import { buildMetaDataHealthReport, MetaDataHealthError, type MetaDataHealthAccountEvidence } from "@/domain/meta/data-health";
import { publicSource, type PublicSource } from "@/domain/source/public-source";

const workspaceRef = `workspace_${"a".repeat(24)}`;
const accountRef = `account_${"b".repeat(24)}`;
const now = "2026-08-17T12:00:00.000Z";
const dates = ["2026-08-15", "2026-08-16", "2026-08-17"] as const;

function source(kind: PublicSource["kind"], state: PublicSource["state"] = "ready"): PublicSource {
  return publicSource({ kind, state, observedAt: now, freshnessAt: now, freshnessThresholdMinutes: 360,
    reasonCodes: state === "ready" ? [] : [`${kind}_${state}`] });
}
function account(overrides: Partial<MetaDataHealthAccountEvidence> = {}): MetaDataHealthAccountEvidence {
  return { accountRef, currency: "TRY", sources: {
    mirror: source("canonical_meta_mirror"), performance: source("canonical_performance"), trust: source("derived_trust"),
  }, requiredDates: dates, observedDates: dates, requiredFields: ["campaign", "targeting"],
  observedFields: ["campaign", "targeting"], ...overrides };
}

describe("canonical Meta data health", () => {
  it("allows data-health staging only for complete same-currency canonical evidence", () => {
    const report = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account()] });
    expect(report).toMatchObject({ state: "ready", monetaryAggregationAccountRefs: [accountRef],
      excludedMonetaryAccountRefs: [], observations: [], gate: { analysisMayRecord: true,
        actionStagingAllowed: true, actionDispatchDataHealthReady: true, reasonCodes: [] } });
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not turn missing days or fields into zero and proposes stable finding/log observations", () => {
    const first = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account({ observedDates: [dates[0]], observedFields: ["campaign"] })] });
    const replay = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account({ observedDates: [dates[0]], observedFields: ["campaign"] })] });
    expect(first).toMatchObject({ state: "partial", accounts: [{ missingDates: [dates[1], dates[2]],
      missingFields: ["targeting"], monetaryAggregationIncluded: false }], gate: {
      analysisMayRecord: true, actionStagingAllowed: false, actionDispatchDataHealthReady: false,
    } });
    expect(first.observations.map((item) => item.code)).toEqual(expect.arrayContaining([
      "required_dates_missing", "required_fields_missing",
    ]));
    expect(first.observations.every((item) => item.finding.kind === "data_quality"
      && item.developmentLog.state === "proposed")).toBe(true);
    expect(first.observations.map((item) => item.fingerprint)).toEqual(replay.observations.map((item) => item.fingerprint));
  });

  it("maps stale/empty/demo/unavailable sources into the v3 health states without suppressing analysis", () => {
    const stale = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account({ sources: { mirror: source("canonical_meta_mirror", "stale"),
        performance: source("canonical_performance"), trust: source("derived_trust") } })] });
    expect(stale).toMatchObject({ state: "partial", gate: { analysisMayRecord: true, actionStagingAllowed: false } });
    expect(stale.observations[0]).toMatchObject({ code: "source_stale", sourceKind: "canonical_meta_mirror" });

    for (const state of ["empty", "demo", "unavailable"] as const) {
      const report = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
        accounts: [account({ sources: { mirror: source("canonical_meta_mirror", state),
          performance: source("canonical_performance"), trust: source("derived_trust") } })] });
      expect(report.gate).toMatchObject({ analysisMayRecord: true, actionStagingAllowed: false,
        actionDispatchDataHealthReady: false });
      expect(report.state).toBe(state === "empty" ? "empty" : "unavailable");
    }
    const healthyRef = `account_${"c".repeat(24)}`;
    const mixed = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account({ accountRef: healthyRef }), account({ sources: {
        mirror: source("canonical_meta_mirror", "empty"), performance: source("canonical_performance"),
        trust: source("derived_trust"),
      } })] });
    expect(mixed.state).toBe("partial");
    expect(mixed.monetaryAggregationAccountRefs).toEqual([healthyRef]);
  });

  it("excludes unknown or mismatched currencies from all monetary aggregation and actions", () => {
    const mismatchRef = `account_${"c".repeat(24)}`;
    const report = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account(), account({ accountRef: mismatchRef, currency: "USD" })] });
    expect(report.monetaryAggregationAccountRefs).toEqual([accountRef]);
    expect(report.excludedMonetaryAccountRefs).toEqual([mismatchRef]);
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountRef: mismatchRef, code: "account_currency_mismatch" }),
    ]));
    expect(report.gate.actionStagingAllowed).toBe(false);

    const unknownAnchor = buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: null, evaluatedAt: now,
      accounts: [account()] });
    expect(unknownAnchor).toMatchObject({ state: "partial", monetaryAggregationAccountRefs: [],
      excludedMonetaryAccountRefs: [accountRef] });
  });

  it("rejects duplicate accounts, wrong source kinds and out-of-window observations", () => {
    expect(() => buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account(), account()] })).toThrowError(expect.objectContaining<Partial<MetaDataHealthError>>({ code: "duplicate_account" }));
    expect(() => buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account({ sources: { mirror: source("canonical_performance"),
        performance: source("canonical_performance"), trust: source("derived_trust") } })] }))
      .toThrowError(expect.objectContaining<Partial<MetaDataHealthError>>({ code: "source_mismatch" }));
    expect(() => buildMetaDataHealthReport({ workspaceRef, workspaceCurrency: "TRY", evaluatedAt: now,
      accounts: [account({ observedDates: ["2026-08-14"] })] })).toThrowError(MetaDataHealthError);
  });
});
