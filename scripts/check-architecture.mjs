#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const adrPaths = [
  resolve(root, "docs/ADR/0001-teknik-temel.md"),
  resolve(root, "docs/ADR/0002-kanonik-reklam-verisi.md"),
];
const migrationDir = resolve(root, "drizzle");
const failures = [];

for (const adrPath of adrPaths) {
  if (!existsSync(adrPath)) failures.push(`ADR yok: ${adrPath}`);
  else {
    const adr = readFileSync(adrPath, "utf8");
    for (const heading of ["## Bağlam", "## Karar", "## Gerekçe", "## Alternatifler", "## Sonuçlar"]) {
      if (!adr.includes(heading)) failures.push(`ADR bölümü eksik (${adrPath}): ${heading}`);
    }
  }
}

for (const rel of [
  "src/app/page.tsx",
  "src/app/api/health/route.ts",
  "src/db/schema.ts",
  "tests/health.test.ts",
  "tests/schema.test.ts",
  "tests/data-platform.test.ts",
  "src/domain/ads/canonical.ts",
  "src/connectors/contract.ts",
  "src/connectors/csv.ts",
  "src/ingest/run-ingest.ts",
  ".github/workflows/ci.yml",
  "drizzle.config.ts",
]) {
  if (!existsSync(resolve(root, rel))) failures.push(`teknik temel dosyası eksik: ${rel}`);
}

if (!existsSync(migrationDir)) failures.push("drizzle migration dizini yok");

if (failures.length) {
  console.error(`ARCHITECTURE FAIL (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ARCHITECTURE PASS — ADR, web/API, veri şeması, migration ve CI bağlı");
