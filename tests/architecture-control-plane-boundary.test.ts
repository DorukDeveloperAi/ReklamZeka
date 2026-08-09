import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const checker = resolve("scripts/check-architecture.mjs");
const roots: string[] = [];
const required = [
  "src/app/page.tsx", "src/app/api/health/route.ts", "src/db/schema.ts", "tests/health.test.ts",
  "tests/schema.test.ts", "tests/data-platform.test.ts", "src/domain/ads/canonical.ts",
  "src/connectors/contract.ts", "src/connectors/csv.ts", "src/ingest/run-ingest.ts",
  ".github/workflows/ci.yml", "drizzle.config.ts",
];
const headings = ["## Bağlam", "## Karar", "## Gerekçe", "## Alternatifler", "## Sonuçlar"].join("\n");

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reklamzeka-architecture-boundary-")); roots.push(root);
  const files = [...required, "docs/ADR/0001-teknik-temel.md", "docs/ADR/0002-kanonik-reklam-verisi.md"];
  await Promise.all(files.map(async (relative) => {
    const path = join(root, relative); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, relative.startsWith("docs/ADR/") ? headings : "safe\n");
  }));
  await mkdir(join(root, "drizzle"), { recursive: true });
  await writeFile(join(root, "README.md"), ["plans/proje/v2/MASTER.md", "plans/proje/v2/STATE.md",
    "plans/proje/v2/CHECKLIST.md", "plans/proje/v2/REQUIREMENTS.md"].join("\n"));
  return root;
}

async function run(root: string) {
  try { const result = await execute(process.execPath, [checker, "--root", root], { encoding: "utf8" });
    return { status: 0, stdout: result.stdout, stderr: result.stderr }; }
  catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { status: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" }; }
}

describe("single active control-plane architecture boundary", () => {
  it("accepts the canonical TypeScript/PostgreSQL skeleton", async () => {
    const result = await run(await fixture());
    expect(result.status).toBe(0); expect(result.stdout).toContain("ARCHITECTURE PASS");
  });

  it.each([
    ["installable Python project", "pyproject.toml", "[project]\nname='legacy'\n", "legacy ikinci kontrol düzlemi yasak"],
    ["Python runtime", "scripts/legacy.py", "print('legacy')\n", "TypeScript runtime dışında Python kaynak yasak"],
    ["legacy package root", "src/reklamzeka/meta_gateway.py", "safe = True\n", "legacy ikinci kontrol düzlemi yasak"],
  ])("rejects %s", async (_name, relative, source, reason) => {
    const root = await fixture(); const path = join(root, relative); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source); const result = await run(root);
    expect(result.status).toBe(1); expect(result.stderr).toContain(reason);
  });

  it("rejects a README that re-declares the historical Python plan as canonical", async () => {
    const root = await fixture();
    await writeFile(join(root, "README.md"), "plans/reklamzeka-sistemi/v1/MASTER.md\n");
    const result = await run(root);
    expect(result.status).toBe(1); expect(result.stderr).toContain("README legacy aktif yol içeriyor");
  });
});
