import { describe, expect, it } from "vitest";
import {
  nextPilotStep,
  parsePilotFeedback,
  parsePilotStep,
  PILOT_STEPS,
  pilotProgress,
} from "../src/app/pilot/journey";

describe("guided pilot web journey", () => {
  it("covers the complete session-to-share sequence", () => {
    expect(PILOT_STEPS).toEqual([
      "session", "workspace", "source", "sync", "dashboard", "insights", "share",
    ]);
    expect(PILOT_STEPS.map(nextPilotStep)).toEqual([
      "workspace", "source", "sync", "dashboard", "insights", "share", null,
    ]);
  });

  it("fails safe for unknown query state", () => {
    expect(parsePilotStep("unknown")).toBe("session");
    expect(parsePilotStep(undefined)).toBe("session");
    expect(parsePilotFeedback("helpful")).toBe("helpful");
    expect(parsePilotFeedback("<script>")).toBeNull();
  });

  it("reports monotonic progress ending at one", () => {
    const progress = PILOT_STEPS.map(pilotProgress);
    expect(progress[0]).toBeCloseTo(1 / 7);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value > progress[index - 1]!)).toBe(true);
  });
});
