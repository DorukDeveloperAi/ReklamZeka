#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED = Object.freeze([
  "src/security/authorization.ts", "src/security/secrets.ts", "src/security/audit.ts",
  "src/server/workspace-data-service.ts", "tests/security-boundaries.test.ts",
  "docs/ADR/0003-kiraci-ve-sir-guvenligi.md", "drizzle/20260806155332_vengeful_chimera.sql",
]);
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".py", ".ts", ".tsx"]);
const EXCLUDED = new Set(["scripts/check-security-boundaries.mjs", "scripts/check-secret-artifacts.mjs"]);
const FORBIDDEN_RUNTIME_MARKERS = Object.freeze([
  ["mcp.facebook.com", "doğrudan Meta MCP endpoint'i"],
  ["META_MCP_ACCESS_TOKEN", "legacy doğrudan Meta MCP secret'ı"],
  ["streamablehttp_client", "doğrudan Python MCP transport'u"],
  ["import sqlite3", "SQLite ikinci veri düzlemi"],
  ["import gspread", "Google Sheets ikinci veri düzlemi"],
  ["Google Sheets kanon", "Google Sheets kanon iddiası"],
]);
const FORBIDDEN_API_META_MARKERS = Object.freeze([
  ["META_ACCESS_TOKEN", "API route doğrudan Meta secret okuyamaz"],
  ["discoverMetaInventory", "API route canlı Meta inventory connector'ını çağıramaz"],
  ["@/connectors/meta/inventory", "API route canlı Meta inventory connector'ını import edemez"],
  ["@/connectors/meta/graph-client", "API route doğrudan Meta Graph client import edemez"],
  ["MetaGraphClient", "API route doğrudan Meta Graph client kullanamaz"],
  ["graph.facebook.com", "API route doğrudan Meta Graph origin'ine erişemez"],
]);

function sourceFiles(root, relative) {
  const absolute = resolve(root, relative);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(root, child);
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) ? [child] : [];
  });
}

export function checkSecurityBoundaries(rootInput = DEFAULT_ROOT) {
  const root = resolve(rootInput);
  const failures = REQUIRED.filter((path) => !existsSync(resolve(root, path))).map((path) => `eksik: ${path}`);
  const migrationPath = resolve(root, "drizzle/20260806155332_vengeful_chimera.sql");
  if (existsSync(migrationPath)) {
    const migration = readFileSync(migrationPath, "utf8");
    if (!migration.includes("audit_events_append_only")) failures.push("audit append-only trigger eksik");
    if (!migration.includes("connection_secrets")) failures.push("şifreli bağlantı sırrı tablosu eksik");
  }
  const envPath = resolve(root, ".env.example");
  if (!existsSync(envPath)) failures.push("örnek env eksik");
  else {
    const env = readFileSync(envPath, "utf8");
    const keyLine = env.split("\n").find((line) => line.startsWith("SECRET_ENCRYPTION_KEY="));
    if (keyLine !== "SECRET_ENCRYPTION_KEY=") failures.push("örnek env gerçek/örnek bir şifreleme anahtarı taşımamalı");
  }
  for (const relative of ["src", "scripts"].flatMap((directory) => sourceFiles(root, directory))) {
    if (EXCLUDED.has(relative)) continue;
    const source = readFileSync(resolve(root, relative), "utf8");
    for (const [marker, reason] of FORBIDDEN_RUNTIME_MARKERS) {
      if (source.includes(marker)) failures.push(`${relative}: ${reason}`);
    }
    if (relative.startsWith("src/app/api/")) {
      for (const [marker, reason] of FORBIDDEN_API_META_MARKERS) {
        if (source.includes(marker)) failures.push(`${relative}: ${reason}`);
      }
    }
  }
  return Object.freeze({ ok: failures.length === 0, root, failures: Object.freeze(failures) });
}

function rootArgument(argv) {
  if (argv.length === 0) return DEFAULT_ROOT;
  if (argv.length === 2 && argv[0] === "--root" && argv[1]?.trim()) return resolve(argv[1]);
  throw new Error("Kullanım: node scripts/check-security-boundaries.mjs [--root <repo-root>]");
}

function main() {
  let result;
  try { result = checkSecurityBoundaries(rootArgument(process.argv.slice(2))); }
  catch { console.error("SECURITY BOUNDARY FAIL — kontrol başlatılamadı"); process.exitCode = 2; return; }
  if (!result.ok) {
    console.error(`SECURITY BOUNDARY FAIL (${result.failures.length})`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log("SECURITY BOUNDARY PASS — tenant, secret, scope, append-only audit ve tek Meta transport sınırı bağlı");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
