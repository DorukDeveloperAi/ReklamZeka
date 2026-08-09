#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_PATHS = Object.freeze([
  "src/app/page.tsx", "src/app/api/health/route.ts", "src/db/schema.ts", "tests/health.test.ts",
  "tests/schema.test.ts", "tests/data-platform.test.ts", "src/domain/ads/canonical.ts",
  "src/connectors/contract.ts", "src/connectors/csv.ts", "src/ingest/run-ingest.ts",
  ".github/workflows/ci.yml", "drizzle.config.ts",
]);
const LEGACY_ACTIVE_PATHS = Object.freeze([
  "pyproject.toml", "src/reklamzeka", "scripts/lint_terminology.py", "tests/conftest.py",
  "tests/test_guardrails.py", "tests/test_mcp_contract.py", "tests/test_taxonomy.py",
  "tests/test_terminology_lint.py", "config/settings.example.yaml", "config/rubrics",
  "docs/api-gercekleri.md", "docs/mcp-envanter.md", "docs/terminoloji.md",
]);

function filesBelow(root, relative) {
  const absolute = resolve(root, relative);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) return filesBelow(root, child);
    return entry.isFile() ? [child] : [];
  });
}

function activePathExists(root, relative) {
  const absolute = resolve(root, relative);
  if (!existsSync(absolute)) return false;
  return statSync(absolute).isDirectory() ? filesBelow(root, relative).length > 0 : true;
}

export function checkArchitecture(rootInput = DEFAULT_ROOT) {
  const root = resolve(rootInput);
  const failures = [];
  for (const relative of ["docs/ADR/0001-teknik-temel.md", "docs/ADR/0002-kanonik-reklam-verisi.md"]) {
    const path = resolve(root, relative);
    if (!existsSync(path)) failures.push(`ADR yok: ${relative}`);
    else {
      const adr = readFileSync(path, "utf8");
      for (const heading of ["## Bağlam", "## Karar", "## Gerekçe", "## Alternatifler", "## Sonuçlar"]) {
        if (!adr.includes(heading)) failures.push(`ADR bölümü eksik (${relative}): ${heading}`);
      }
    }
  }
  for (const relative of REQUIRED_PATHS) {
    if (!existsSync(resolve(root, relative))) failures.push(`teknik temel dosyası eksik: ${relative}`);
  }
  if (!existsSync(resolve(root, "drizzle"))) failures.push("drizzle migration dizini yok");
  for (const relative of LEGACY_ACTIVE_PATHS) {
    if (activePathExists(root, relative)) failures.push(`legacy ikinci kontrol düzlemi yasak: ${relative}`);
  }
  for (const relative of ["src", "scripts"].flatMap((directory) => filesBelow(root, directory))) {
    if (relative.endsWith(".py")) failures.push(`TypeScript runtime dışında Python kaynak yasak: ${relative}`);
  }
  const readmePath = resolve(root, "README.md");
  if (!existsSync(readmePath)) failures.push("README.md yok");
  else {
    const readme = readFileSync(readmePath, "utf8");
    for (const authority of ["plans/proje/v2/MASTER.md", "plans/proje/v2/STATE.md",
      "plans/proje/v2/CHECKLIST.md", "plans/proje/v2/REQUIREMENTS.md"]) {
      if (!readme.includes(authority)) failures.push(`README kanonik otorite eksik: ${authority}`);
    }
    for (const stale of ["plans/reklamzeka-sistemi/v1/MASTER.md", "src/reklamzeka/", "pip install -e"]) {
      if (readme.includes(stale)) failures.push(`README legacy aktif yol içeriyor: ${stale}`);
    }
  }
  return Object.freeze({ ok: failures.length === 0, root, failures: Object.freeze(failures) });
}

function rootArgument(argv) {
  if (argv.length === 0) return DEFAULT_ROOT;
  if (argv.length === 2 && argv[0] === "--root" && argv[1]?.trim()) return resolve(argv[1]);
  throw new Error("Kullanım: node scripts/check-architecture.mjs [--root <repo-root>]");
}

function main() {
  let result;
  try { result = checkArchitecture(rootArgument(process.argv.slice(2))); }
  catch { console.error("ARCHITECTURE FAIL — kontrol başlatılamadı"); process.exitCode = 2; return; }
  if (!result.ok) {
    console.error(`ARCHITECTURE FAIL (${result.failures.length})`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log("ARCHITECTURE PASS — tek TypeScript/PostgreSQL runtime, ADR, web/API, migration ve CI bağlı");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
