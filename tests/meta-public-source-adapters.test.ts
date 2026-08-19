import { describe, expect, it } from "vitest";
import {
  canonicalPerformancePublicSource,
  derivedTrustPublicSource,
  graphCapabilityPreflightPublicSource,
  metaReadMirrorPublicSource,
} from "@/application/meta-public-source-adapters";

describe("Meta public source adapters", () => {
  it("preserves canonical, partial, stale, empty, and unavailable mirror states", () => {
    const mirror = (sourceState: string) => metaReadMirrorPublicSource({ version: "meta-read-mirror-projection/1.0.0",
      sourceState, observedAt: "2026-08-14T12:00:00.000Z", latestCanonicalObservationAt: "2026-08-14T11:00:00.000Z",
      freshnessAgeMinutes: 60, freshnessThresholdMinutes: 1440, reasonCodes: [], summary: {}, authority: {}, connections: [] } as never);
    expect(mirror("ready").state).toBe("ready");
    expect(mirror("partial")).toMatchObject({ state: "partial", reasonCodes: ["canonical_meta_mirror_partial"] });
    expect(mirror("stale")).toMatchObject({ state: "stale", reasonCodes: ["freshness_stale"] });
    expect(mirror("empty").state).toBe("empty");
    expect(mirror("unavailable").state).toBe("unavailable");
  });

  it("keeps performance and trust source identities distinct", () => {
    const performance = canonicalPerformancePublicSource({ version: "canonical-performance-read/1.0.0", state: "partial",
      accounts: [{ windows: [{ freshnessAt: "2026-08-14T10:00:00.000Z", reasonCodes: ["coverage_incomplete"] }] }], authority: {} } as never);
    const trust = derivedTrustPublicSource({ version: "meta-trust-readiness-read/1.0.0", reports: [{ report: {
      evaluatedAt: "2026-08-14T11:00:00.000Z", status: "degraded", reasonCodes: ["STREAM_STALE"],
    } }], authority: {} } as never);
    expect(performance).toMatchObject({ kind: "canonical_performance", state: "partial", reasonCodes: ["coverage_incomplete"] });
    expect(trust).toMatchObject({ kind: "derived_trust", state: "partial", reasonCodes: ["STREAM_STALE"] });
  });

  it("labels bootstrap as a non-canonical Graph capability diagnostic", () => {
    expect(graphCapabilityPreflightPublicSource({ readiness: "configured" } as never))
      .toMatchObject({ kind: "graph_capability", state: "partial", reasonCodes: ["graph_capability_preflight_only"] });
    expect(graphCapabilityPreflightPublicSource({ readiness: "blocked", blocker: "rotation_required" } as never))
      .toMatchObject({ kind: "graph_capability", state: "unavailable", reasonCodes: ["graph_capability_rotation_required"] });
  });
});
