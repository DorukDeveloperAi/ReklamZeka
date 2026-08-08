import { describe, expect, it } from "vitest";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";

describe("category public references", () => {
  it("is deterministic, semantic and keeps dimension/definition namespaces separate", () => {
    expect(categoryDimensionPublicRef("campaign_type")).toBe(categoryDimensionPublicRef("campaign_type"));
    expect(categoryDefinitionPublicRef("campaign_type", "evergreen"))
      .toBe(categoryDefinitionPublicRef("campaign_type", "evergreen"));
    expect(categoryDimensionPublicRef("campaign_type")).toMatch(/^dimension_[a-f0-9]{24}$/);
    expect(categoryDefinitionPublicRef("campaign_type", "evergreen")).toMatch(/^category_[a-f0-9]{24}$/);
  });

  it("rejects unsafe keys", () => {
    expect(() => categoryDimensionPublicRef("bad\nkey")).toThrow("invalid_category_key");
  });
});
