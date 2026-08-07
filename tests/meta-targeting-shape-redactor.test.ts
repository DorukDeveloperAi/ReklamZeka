import { describe, expect, it } from "vitest";
import { redactMetaAdSetTargetingShape } from "@/connectors/meta/targeting-shape-redactor";

describe("Meta targeting shape redactor", () => {
  it("reports only fixed structural counts and stable-key presence", () => {
    const sensitiveValues = ["SENSITIVE_COUNTRY", "SENSITIVE_REGION_KEY", "SENSITIVE_CITY_KEY",
      "SENSITIVE_CUSTOM_KEY", "SENSITIVE_NAME", "SENSITIVE_COORDINATE"];
    const result = redactMetaAdSetTargetingShape([
      {
        id: "SENSITIVE_AD_SET_ID",
        targeting: {
          age_min: 18,
          geo_locations: {
            countries: [sensitiveValues[0]],
            regions: [{ key: sensitiveValues[1], name: sensitiveValues[4] }],
            cities: [{ key: sensitiveValues[2], name: sensitiveValues[4] }],
            custom_locations: [{ custom_location_id: sensitiveValues[3], latitude: sensitiveValues[5] }],
            location_types: ["home", "recent", "travel_in", "SENSITIVE_LOCATION_TYPE", 7],
          },
          excluded_geo_locations: { countries: ["SENSITIVE_EXCLUDED_COUNTRY"] },
          flexible_spec: [{ interests: [{ id: "SENSITIVE_INTEREST" }] }],
        },
      },
    ]);

    expect(result).toMatchObject({
      sampledAdSets: 1,
      targeting: { object: 1 },
      includedGeo: {
        collection: { object: 1 },
        locationTypeCompatibility: { home: 1, recent: 1, travelIn: 1, unrecognized: 1, invalid: 1 },
        countries: { itemCount: 1, itemTypes: { string: 1 } },
        regions: { itemCount: 1, itemTypes: { object: 1 } },
        regionIdentity: { objectsWithStableKey: 1, key: { string: 1 } },
        cities: { itemCount: 1, itemTypes: { object: 1 } },
        cityIdentity: { objectsWithStableKey: 1, key: { string: 1 } },
        customLocationIdentity: { objectsWithStableKey: 1, customLocationId: { string: 1 } },
      },
      excludedGeo: { collection: { object: 1 }, countries: { itemCount: 1 } },
    });
    const serialized = JSON.stringify(result);
    for (const value of [...sensitiveValues, "SENSITIVE_AD_SET_ID", "SENSITIVE_LOCATION_TYPE",
      "SENSITIVE_EXCLUDED_COUNTRY", "SENSITIVE_INTEREST", "age_min", "flexible_spec", "latitude", "name"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("distinguishes absent, invalid and mixed structural values without copying them", () => {
    const result = redactMetaAdSetTargetingShape([
      {},
      { targeting: null },
      { targeting: { geo_locations: "SENSITIVE_FREE_TEXT" } },
      { targeting: { geo_locations: { countries: ["SENSITIVE_CODE", 7], regions: ["SENSITIVE_NAME"] } } },
    ]);

    expect(result.sampledAdSets).toBe(4);
    expect(result.targeting).toMatchObject({ absent: 1, null: 1, object: 2 });
    expect(result.includedGeo.collection).toMatchObject({ absent: 0, string: 1, object: 1 });
    expect(result.includedGeo.countries).toMatchObject({ itemCount: 2, itemTypes: { string: 1, number: 1 } });
    expect(result.includedGeo.regions).toMatchObject({ itemCount: 1, itemTypes: { string: 1 } });
    expect(result.includedGeo.regionIdentity.objectsWithStableKey).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|FREE_TEXT/);
  });
});
