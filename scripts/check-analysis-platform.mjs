#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const required = [
  "src/analyses/schema.ts",
  "src/analyses/objective-playbooks.ts",
  "src/analyses/prompt-envelope.ts",
  "tests/analysis-definition.test.ts",
  "tests/objective-playbooks.test.ts",
  "tests/prompt-envelope.test.ts",
  "docs/ADR/0006-kullanici-tanimli-analiz-ve-prompt.md",
  "docs/ADR/0007-kampanya-amacina-duyarli-analiz.md",
  "plans/proje/v2/MASTER.md",
  "plans/proje/v2/REQUIREMENTS.md",
];

for (const path of required) if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);

if (failures.length === 0) {
  const playbooks = readFileSync(resolve(root, "src/analyses/objective-playbooks.ts"), "utf8");
  for (const objective of ["awareness", "traffic", "engagement", "lead_generation", "app_growth", "sales"]) {
    if (!playbooks.includes(`${objective}: {`)) failures.push(`objective playbook eksik: ${objective}`);
  }
  const schema = readFileSync(resolve(root, "src/analyses/schema.ts"), "utf8");
  for (const boundary of ["classificationSource", "minimumSample", "misfirePolicy", "narrative_only", "isValidIanaTimezone"]) {
    if (!schema.includes(boundary)) failures.push(`analiz sözleşmesi sınırı eksik: ${boundary}`);
  }
  const prompt = readFileSync(resolve(root, "src/analyses/prompt-envelope.ts"), "utf8");
  for (const boundary of ["untrusted_data", "allowedFindingIds", "prohibitions", "validateNarrativeOutput"]) {
    if (!prompt.includes(boundary)) failures.push(`prompt sınırı eksik: ${boundary}`);
  }
}

if (failures.length > 0) {
  console.error(`ANALYSIS PLATFORM FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("ANALYSIS PLATFORM PASS — kampanya amaç playbook'ları, güvenli tanım DSL'i ve kanıt bağlı anlatım zarfı mevcut");
