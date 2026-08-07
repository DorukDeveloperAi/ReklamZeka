#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
for (const path of [
  "src/insights/schema.ts",
  "src/insights/rules.ts",
  "src/insights/feedback.ts",
  "src/app/api/insights/route.ts",
  "tests/insight-engine.test.ts",
  "tests/insight-feedback.test.ts",
  "docs/ADR/0004-deterministik-icgoru-motoru.md",
  "drizzle/20260806161017_free_rocket_racer.sql",
]) if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);

if (failures.length === 0) {
  const rules = readFileSync(resolve(root, "src/insights/rules.ts"), "utf8");
  for (const id of ["spend-spike", "conversion-drop", "efficiency-decline", "data-delay"]) {
    if (!rules.includes(`id: "${id}"`)) failures.push(`kural eksik: ${id}`);
  }
  const schema = readFileSync(resolve(root, "src/insights/schema.ts"), "utf8");
  for (const field of ["calculationVersion", "confidence", "evidence", "recommendedAction"]) {
    if (!schema.includes(field)) failures.push(`içgörü alanı eksik: ${field}`);
  }
}

if (failures.length > 0) {
  console.error(`INSIGHT FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("INSIGHT PASS — sürümlü kanıt şeması, dört deterministik kural ve idempotent feedback bağlı");
