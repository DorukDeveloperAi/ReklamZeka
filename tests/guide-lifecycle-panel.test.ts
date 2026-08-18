import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/dashboard/guide-lifecycle-panel.tsx", "utf8");
describe("Guide lifecycle panel", () => {
  it("exposes the exact human-gated lifecycle without Meta authority", () => {
    expect(source).toContain("guide-lifecycle-create"); expect(source).toContain("guide-lifecycle-accept");
    expect(source).toContain("guide-lifecycle-activate"); expect(source).toContain("guide-lifecycle-pause");
    expect(source).toContain("Meta write kapalı"); expect(source).toContain("canWriteMeta !== false");
    expect(source).toContain('credentials: "same-origin"'); expect(source).not.toContain("x-workspace-id");
  });
  it("fails closed on public references and isolates its local-session form ids", () => {
    expect(source).toContain("unsafe_response"); expect(source).toContain("guide-lifecycle-session");
    expect(source).toContain("REF.test(item.guideRef)"); expect(source).toContain("REF.test(item.sliceRef)");
  });
});
