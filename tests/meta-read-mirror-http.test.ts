import { describe, expect, it, vi } from "vitest";
import { createMetaReadMirrorHttpHandler } from "@/server/meta-read-mirror-http";

const projection = {
  version: "meta-read-mirror-projection/1.0.0", sourceState: "stale", observedAt: "2026-08-14T12:00:00.000Z",
  latestCanonicalObservationAt: "2026-08-13T12:00:00.000Z", freshnessAgeMinutes: 1440, freshnessThresholdMinutes: 60,
  reasonCodes: ["freshness_stale"], summary: { connections: 0, accounts: 0, campaigns: 0, adSets: 0, ads: 0, creatives: 0, posts: 0 },
  authority: { actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false }, connections: [],
} as const;

describe("Meta read mirror HTTP source contract", () => {
  it("adds a distinct stale canonical-mirror source marker", async () => {
    const handler = createMetaReadMirrorHttpHandler({ load: vi.fn().mockResolvedValue(projection), workspaceId: vi.fn().mockResolvedValue("workspace") });
    const response = await handler(new Request("http://localhost/api/meta/read-mirror"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...projection, source: {
      contractVersion: "public-source/1.0.0", kind: "canonical_meta_mirror", state: "stale",
      freshnessAt: projection.latestCanonicalObservationAt, freshnessThresholdMinutes: 60,
    } });
  });

  it("returns source-unavailable rather than a partial projection when loading fails", async () => {
    const handler = createMetaReadMirrorHttpHandler({ load: vi.fn().mockRejectedValue(new Error("db unavailable")), workspaceId: vi.fn().mockResolvedValue("workspace") });
    const response = await handler(new Request("http://localhost/api/meta/read-mirror"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "source_unavailable" }, source: {
      kind: "canonical_meta_mirror", state: "unavailable", reasonCodes: ["canonical_meta_mirror_unavailable"],
    } });
  });
});
