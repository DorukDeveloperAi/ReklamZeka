import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("server-owned Meta insight bootstrap command", () => {
  it("derives a single active read-only scope and invokes no caller-selected Meta stream", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/run-meta-insight-bootstrap.ts"), "utf8");
    expect(source).toContain('eq(schema.metaConnections.status, "active")');
    expect(source).toContain('eq(schema.metaConnections.accessMode, "read_only")');
    expect(source).toContain("rows.length !== 1");
    expect(source).toContain("service.runInsightBootstrap({");
    expect(source).toContain("dateSliceDays: 7");
    expect(source).toContain("initialPageSize: 25");
    expect(source).toContain("maxRunDurationMs: 300_000");
    expect(source).toContain("META_TOKEN_SECURITY_STATUS");
    expect(source).not.toContain("process.argv");
    expect(source).not.toContain('method: "POST"');
    expect(source).not.toContain("accessToken");
  });
});
