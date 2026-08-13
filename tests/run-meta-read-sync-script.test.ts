import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local Meta read-sync recovery command", () => {
  it("opts into only the server-composed idempotent page recovery mode", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/run-meta-read-sync.ts"), "utf8");
    expect(source).toContain('inventoryTransactionMode:"idempotent_page"');
    expect(source).toContain('durableTransactionMode:"idempotent_checkpoint"');
    expect(source).toContain("deferAffectedGeoMaterialization:true");
    // Large GET-only Meta pages are allowed a bounded retry window; this is
    // recovery reliability, not a write-capability change.
    expect(source).toContain("requestTimeoutMs:20_000");
    expect(source).toContain("maxAttempts:3");
    expect(source).not.toContain("accessToken");
  });
});
