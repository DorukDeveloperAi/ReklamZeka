import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile); const checker = resolve("scripts/check-secret-artifacts.mjs");
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(artifact: string) {
  const root = await mkdtemp(join(tmpdir(), "reklamzeka-secret-boundary-")); roots.push(root);
  const legacySecret = "legacy-meta-mcp-secret-fixture-123456789";
  await execute("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, ".gitignore"), ".env.local\n");
  await writeFile(join(root, ".env.local"), `META_MCP_ACCESS_TOKEN=${legacySecret}\n`);
  await writeFile(join(root, "artifact.txt"), artifact.replace("$SECRET", legacySecret));
  await execute("git", ["add", ".gitignore", "artifact.txt"], { cwd: root });
  return { root, legacySecret };
}

async function run(root: string) {
  try { const result = await execute(process.execPath, [checker, "--root", root], { encoding: "utf8" });
    return { status: 0, stdout: result.stdout, stderr: result.stderr }; }
  catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { status: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" }; }
}

describe("legacy Meta MCP secret artifact boundary", () => {
  it("scans the legacy variable value without printing it", async () => {
    const { root, legacySecret } = await fixture("embedded=$SECRET\n"); const result = await run(root);
    expect(result.status).toBe(1); expect(result.stderr).toContain("SECRET ARTIFACT CHECK FAIL");
    expect(`${result.stdout}${result.stderr}`).not.toContain(legacySecret);
  });

  it("passes when the configured legacy value is absent from tracked artifacts", async () => {
    const { root } = await fixture("safe\n"); const result = await run(root);
    expect(result.status).toBe(0); expect(result.stdout).toContain("SECRET ARTIFACT CHECK PASS");
  });

  it("treats Next development cache as cache rather than production build output", async () => {
    const { root, legacySecret } = await fixture("safe\n");
    await mkdir(join(root, ".next", "dev", "cache"), { recursive: true });
    await writeFile(join(root, ".next", "dev", "cache", "turbopack.sst"), legacySecret);
    const result = await run(root);
    expect(result.status).toBe(0); expect(result.stdout).toContain("SECRET ARTIFACT CHECK PASS");
    expect(`${result.stdout}${result.stderr}`).not.toContain(legacySecret);
  });
});
