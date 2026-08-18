import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local scheduled Meta read-sync runner", () => {
  it("is explicitly enabled, security-gated, server-scoped and read-only", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/run-meta-read-sync-schedule-tick.ts"), "utf8");
    expect(source).toContain('REKLAMZEKA_META_SCHEDULE_RUNNER_ENABLED === "true"');
    expect(source).toContain('META_READ_ENABLED === "true"');
    expect(source).toContain('META_TOKEN_SECURITY_STATUS === "rotated"');
    expect(source).toContain("runDrizzleMetaReadSyncScheduleTick({ now:");
    expect(source).toContain('actionAuthority: "none"');
    expect(source).toContain("writeNetworkCalls: 0");
    expect(source).toContain("metaWriteCalls: 0");
    expect(source).not.toContain("workspaceId:");
    expect(source).not.toContain("connectionId:");
    expect(source).not.toContain("accountId:");
    expect(source).not.toContain("accessToken");
    expect(source).not.toContain('method: "POST"');
  });
});
