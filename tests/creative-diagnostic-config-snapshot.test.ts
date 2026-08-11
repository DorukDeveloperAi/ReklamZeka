import { describe, expect, it } from "vitest";
import { CreativeDiagnosticConfigSnapshotError, createCreativeDiagnosticConfigSnapshot } from "@/domain/meta/creative-diagnostic-config-snapshot";

const hash = "a".repeat(64);
const known = Object.freeze({ state: "known" as const, ref: "field_lead", sourceRef: "mirror_campaign", sourceHash: hash });
function input() { return { bindingRef: "binding_primary", bindingHash: hash, creativeContentHash: "b".repeat(64), objective: known, optimization: known, billing: known, destination: { state: "unknown" as const, reason: "not_observed" as const } }; }

describe("creative diagnostic config snapshot", () => {
  it("freezes only direct source evidence and explicit unknowns", () => {
    const snapshot = createCreativeDiagnosticConfigSnapshot(input());
    expect(snapshot).toMatchObject({ contractVersion: "creative-diagnostic-config-snapshot/1.0.0", destination: { state: "unknown", reason: "not_observed" } });
    expect(createCreativeDiagnosticConfigSnapshot(input())).toEqual(snapshot);
  });
  it("rejects derived/fallback-shaped, malformed and ambiguous source claims", () => {
    expect(() => createCreativeDiagnosticConfigSnapshot({ ...input(), destination: { state: "known", ref: "destination_x", sourceRef: "promoted_object", sourceHash: hash } })).toThrow(CreativeDiagnosticConfigSnapshotError);
    expect(() => createCreativeDiagnosticConfigSnapshot({ ...input(), objective: { state: "known", ref: "bad ref", sourceRef: "mirror_campaign", sourceHash: hash } })).toThrow("opaque ref");
    expect(() => createCreativeDiagnosticConfigSnapshot({ ...input(), billing: { state: "unknown", reason: "inferred" } as never })).toThrow("unknown alanı");
  });
});
