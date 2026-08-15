import { describe, expect, it } from "vitest";

import { normalizeClassificationReviewTimestamp } from "@/connectors/campaigns/campaign-classification-review-drizzle-repository";

describe("campaign classification review mirror timestamp", () => {
  it("accepts canonical timestamptz values returned as Date or PostgreSQL text", () => {
    expect(normalizeClassificationReviewTimestamp(new Date("2026-08-15T09:42:09.622Z")))
      .toBe("2026-08-15T09:42:09.622Z");
    expect(normalizeClassificationReviewTimestamp("2026-08-15 09:42:09.622+00"))
      .toBe("2026-08-15T09:42:09.622Z");
    expect(normalizeClassificationReviewTimestamp("2026-08-15 12:42:09.622+03:00"))
      .toBe("2026-08-15T09:42:09.622Z");
  });

  it("fails closed for untyped or malformed storage values", () => {
    expect(() => normalizeClassificationReviewTimestamp("2026-08-15T09:42:09Z")).toThrow("corrupt_store");
    expect(() => normalizeClassificationReviewTimestamp(null)).toThrow("corrupt_store");
  });
});
