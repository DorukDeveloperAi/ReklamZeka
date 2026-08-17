import { describe, expect, it } from "vitest";

import { metaAdSetTargetingPersistence } from "@/connectors/meta/sync/inventory-drizzle-repository";
import {
  MetaTargetingEvidenceError,
  normalizeMetaTargetingEvidence,
} from "@/connectors/meta/sync/targeting-evidence";

describe("canonical Meta targeting evidence", () => {
  const scope = Object.freeze({ workspaceId: "workspace_test", externalAccountId: "act_100" });
  it("normalizes supported evidence, hashes private audience identities and remains order-stable", () => {
    const first = normalizeMetaTargetingEvidence({ fieldPresent: true, scope, targeting: {
      geo_locations: { countries: ["TR", "DE"], location_types: ["recent", "home"],
        regions: [{ key: "region_2", name: "Private name" }, { key: "region_1" }] },
      age_min: 25, age_max: 54, genders: [2, 1], publisher_platforms: ["instagram", "facebook"],
      device_platforms: ["mobile", "desktop"], facebook_positions: ["feed"], instagram_positions: ["story", "stream"],
      custom_audiences: [{ id: "audience_2", name: "Patients" }, { id: "audience_1" }],
      excluded_custom_audiences: [{ id: "audience_3", name: "Employees" }], locales: [6],
    } });
    const replay = normalizeMetaTargetingEvidence({ fieldPresent: true, scope, targeting: {
      geo_locations: { countries: ["DE", "TR"], location_types: ["home", "recent"],
        regions: [{ key: "region_1" }, { key: "region_2", name: "Changed display label" }] },
      age_min: 25, age_max: 54, genders: [1, 2], publisher_platforms: ["facebook", "instagram"],
      device_platforms: ["desktop", "mobile"], facebook_positions: ["feed"], instagram_positions: ["stream", "story"],
      custom_audiences: [{ id: "audience_1" }, { id: "audience_2", name: "Changed" }],
      excluded_custom_audiences: [{ id: "audience_3" }], locales: [99],
    } });
    expect(first.summary).toMatchObject({ state: "partial",
      source: { fieldState: "present", unsupportedFields: ["locales"] },
      geo: { includedCountries: ["DE", "TR"], locationTypes: ["home", "recent"], includedRegionCount: 2 },
      age: { state: "known", minimum: 25, maximum: 54 }, gender: { values: ["female", "male"] },
      platform: { publisherPlatforms: ["facebook", "instagram"], devicePlatforms: ["desktop", "mobile"] },
      customAudience: { includedCount: 2, excludedCount: 1 },
    });
    expect(first.signature).toBe(replay.signature);
    expect(JSON.stringify(first)).not.toMatch(/audience_[123]|Patients|Employees|Private name|Changed/);
  });

  it("marks unsupported-only input without guessing an audience", () => {
    const result = normalizeMetaTargetingEvidence({ fieldPresent: true, scope, targeting: { locales: [6] } });
    expect(result.summary).toMatchObject({ state: "unsupported", source: { unsupportedFields: ["locales"] },
      geo: { state: "missing", includedCountries: null }, platform: { state: "missing" } });
  });

  it("rejects malformed known fields and oversized or foreign object shapes", () => {
    for (const targeting of [
      { geo_locations: { countries: ["turkey"] } },
      { genders: [3] },
      { custom_audiences: [{ id: "safe", account_id: "foreign" }] },
      { geo_locations: { regions: [{ name: "identity missing" }] } },
      { device_platforms: ["x".repeat(513)] },
    ]) expect(() => normalizeMetaTargetingEvidence({ fieldPresent: true, scope, targeting })).toThrow(MetaTargetingEvidenceError);
  });

  it("repository boundary accepts canonical evidence and rejects forged payloads/signatures", () => {
    const canonical = normalizeMetaTargetingEvidence({ fieldPresent: true, scope, targeting: { age_min: 18, age_max: 44 } });
    expect(metaAdSetTargetingPersistence({ targetingSummary: canonical.summary, targetingSignature: canonical.signature }))
      .toEqual({ targetingSummary: canonical.summary, targetingSignature: canonical.signature });
    expect(() => metaAdSetTargetingPersistence({ targetingSummary: { ...canonical.summary,
      rawTargeting: { secret: true } } as never, targetingSignature: canonical.signature }))
      .toThrow(MetaTargetingEvidenceError);
    expect(() => metaAdSetTargetingPersistence({ targetingSummary: canonical.summary, targetingSignature: "0".repeat(64) }))
      .toThrow(MetaTargetingEvidenceError);
  });
});
