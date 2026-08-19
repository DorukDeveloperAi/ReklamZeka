import { describe, expect, it } from "vitest";

import { publicSourceFromPayload, SOURCE_AUTHORITY_COPY, sourceStatePresentation } from "@/app/dashboard/source-state";

const publicSource = {
  contractVersion: "public-source/1.0.0",
  kind: "canonical_meta_mirror",
  state: "ready",
  observedAt: "2026-08-14T08:00:00.000Z",
  freshnessAt: "2026-08-14T08:00:00.000Z",
  freshnessThresholdMinutes: 60,
  reasonCodes: [],
} as const;

describe("dashboard source-state presentation", () => {
  it("consumes only the existing public source envelope", () => {
    expect(publicSourceFromPayload({ source: publicSource })).toEqual(publicSource);
    expect(publicSourceFromPayload({ source: { ...publicSource, kind: "private_internal" } })).toBeNull();
  });

  it("labels a closed Graph capability as expected instead of a connection failure", () => {
    const presentation = sourceStatePresentation({ ...publicSource, kind: "graph_capability", state: "unavailable" });
    expect(presentation).toMatchObject({ label: "Canlı Graph envanteri kapalı", retryable: false, tone: "neutral" });
    expect(presentation.detail).toContain("bu sürümde kapalıdır");
  });

  it("keeps source authority and session requirements in presentation", () => {
    expect(sourceStatePresentation(null, true).label).toBe("Yerel oturum gerekli");
    expect(sourceStatePresentation({ ...publicSource, state: "partial" }).detail).toContain("eksik veri gösterilmez");
    expect(SOURCE_AUTHORITY_COPY).toBe("Salt-okunur. Meta’da hiçbir değişiklik yapılamaz.");
  });
});
