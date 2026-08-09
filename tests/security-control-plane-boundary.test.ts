import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile); const checker = resolve("scripts/check-security-boundaries.mjs");
const roots: string[] = [];
const required = ["src/security/authorization.ts", "src/security/secrets.ts", "src/security/audit.ts",
  "src/server/workspace-data-service.ts", "tests/security-boundaries.test.ts",
  "docs/ADR/0003-kiraci-ve-sir-guvenligi.md"];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(source = "export const graph = 'https://graph.facebook.com';\n", relative = "src/runtime.ts") {
  const root = await mkdtemp(join(tmpdir(), "reklamzeka-security-boundary-")); roots.push(root);
  await Promise.all(required.map(async (relative) => { const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, "safe\n"); }));
  const migration = join(root, "drizzle/20260806155332_vengeful_chimera.sql");
  await mkdir(dirname(migration), { recursive: true });
  await writeFile(migration, "audit_events_append_only\nconnection_secrets\n");
  await writeFile(join(root, ".env.example"), "SECRET_ENCRYPTION_KEY=\n");
  const sourcePath = join(root, relative);
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, source);
  return root;
}

async function run(root: string) {
  try { const result = await execute(process.execPath, [checker, "--root", root], { encoding: "utf8" });
    return { status: 0, stdout: result.stdout, stderr: result.stderr }; }
  catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { status: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" }; }
}

describe("single Meta transport security boundary", () => {
  it("allows the canonical fixed Meta Graph origin", async () => {
    const result = await run(await fixture());
    expect(result.status).toBe(0); expect(result.stdout).toContain("SECURITY BOUNDARY PASS");
  });

  it.each([
    ["direct Meta MCP", "endpoint = 'https://mcp.facebook.com/ads'\n", "doğrudan Meta MCP endpoint'i"],
    ["legacy bearer", "token = META_MCP_ACCESS_TOKEN\n", "legacy doğrudan Meta MCP secret'ı"],
    ["SQLite", "import sqlite3\n", "SQLite ikinci veri düzlemi"],
    ["Sheets", "import gspread\n", "Google Sheets ikinci veri düzlemi"],
  ])("rejects %s runtime source", async (_name, source, reason) => {
    const result = await run(await fixture(source));
    expect(result.status).toBe(1); expect(result.stderr).toContain(reason);
  });

  it.each([
    ["direct Meta secret", "export const token = process.env.META_ACCESS_TOKEN;\n", "API route doğrudan Meta secret okuyamaz"],
    ["live inventory connector", "import { discoverMetaInventory } from '@/connectors/meta/inventory';\n", "API route canlı Meta inventory connector'ını çağıramaz"],
    ["direct Graph client", "import { MetaGraphClient } from '@/connectors/meta/graph-client';\n", "API route doğrudan Meta Graph client import edemez"],
    ["direct Graph origin", "export const origin = 'https://graph.facebook.com';\n", "API route doğrudan Meta Graph origin'ine erişemez"],
  ])("rejects API route %s access", async (_name, source, reason) => {
    const result = await run(await fixture(source, "src/app/api/meta/inventory/route.ts"));
    expect(result.status).toBe(1); expect(result.stderr).toContain(reason);
  });
});
