import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local Meta read-sync recovery command", () => {
  it("opts into only the server-composed idempotent page recovery mode", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/run-meta-read-sync.ts"), "utf8");
    expect(source).toContain('inventoryTransactionMode:"idempotent_page"');
    expect(source).toContain('durableTransactionMode:"idempotent_checkpoint"');
    expect(source).toContain("deferAffectedGeoMaterialization:true");
    expect(source).toContain("requestTimeoutMs:5_000");
    expect(source).not.toContain("accessToken");
  });
});
