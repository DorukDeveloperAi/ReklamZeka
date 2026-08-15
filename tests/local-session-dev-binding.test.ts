import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local session development binding", () => {
  it("starts Next on the exact configured loopback origin instead of silently changing ports", () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    expect(manifest.scripts?.dev).toBe("next dev --hostname localhost --port 3000");
  });
});
