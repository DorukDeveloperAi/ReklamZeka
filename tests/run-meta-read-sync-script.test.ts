import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local Meta read-sync recovery command", () => {
  it("invokes exactly one server-owned, cursor-resumable recovery lane", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/run-meta-read-sync.ts"), "utf8");
    expect(source).toContain('inventoryTransactionMode: "idempotent_page"');
    expect(source).toContain('durableTransactionMode: "idempotent_checkpoint"');
    expect(source).toContain("recoveryAccountId");
    expect(source).toContain("REKLAMZEKA_META_RECOVERY_ACCOUNT_ID");
    expect(source).toContain("REKLAMZEKA_META_RECOVERY_LANE");
    expect(source).toContain("service.runRecoveryLane({");
    expect(source).not.toContain("service.run({");
    expect(source).toContain("deferAffectedGeoMaterialization: true");
    // Large GET-only Meta pages are allowed a bounded retry window; this is
    // recovery reliability, not a write-capability change.
    expect(source).toContain('recoveryLane === "creative_ad_v1" || recoveryLane === "creative_ad_v2"');
    expect(source).toContain("requestTimeoutMs,");
    expect(source).toContain("maxAttempts,");
    expect(source).toContain("const initialPageSize = creativeLane ? 20 : 100;");
    expect(source).toContain("initialPageSize,");
    expect(source).toContain("maxRunDurationMs: 90_000");
    expect(source).toContain('status: "failed"');
    expect(source).not.toContain("accessToken");
    expect(source).not.toContain("method: \"POST\"");
  });
});
