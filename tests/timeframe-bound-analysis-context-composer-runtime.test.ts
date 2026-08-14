import { describe, expect, it } from "vitest";
import { createDrizzleTimeframeBoundAnalysisContextComposer } from "@/server/timeframe-bound-analysis-context-composer-runtime";

describe("timeframe-bound analysis context composer runtime", () => {
  it("exposes only the private composer over one shared Drizzle boundary", () => {
    const composer = createDrizzleTimeframeBoundAnalysisContextComposer({ database: {} as never, now: () => new Date("2026-08-02T00:00:01.000Z") });
    expect(composer).toHaveProperty("composeAndSave");
  });
});
