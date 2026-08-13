import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Meta S1.4 recovery live verifier boundary", () => {
  it("uses the authoritative S1.4 read service with explicit server scope and GET-only transport", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/verify-meta-s14-recovery-live.ts"), "utf8");

    expect(source).toContain("MetaS14LiveAssetContentService");
    expect(source).toContain("discoverMetaAssetMirror");
    expect(source).toContain("META_S14_RECOVERY_CONNECTION_EXTERNAL_KEY");
    expect(source).toContain('method !== "GET"');
    expect(source).toContain("graphVerifiedOnly: true");
    expect(source).not.toMatch(/drizzle|new Pool|database\.insert|database\.update|database\.delete/i);
  });
});
