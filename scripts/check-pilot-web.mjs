#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const required = [
  "src/app/pilot/page.tsx",
  "src/app/pilot/journey.ts",
  "src/app/reports/demo/page.tsx",
  "tests/pilot-web-journey.test.ts",
];

for (const path of required) {
  if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);
}

if (failures.length === 0) {
  const journey = readFileSync(resolve(root, "src/app/pilot/journey.ts"), "utf8");
  const report = readFileSync(resolve(root, "src/app/reports/demo/page.tsx"), "utf8");
  for (const step of ["session", "workspace", "source", "sync", "dashboard", "insights", "share"]) {
    if (!journey.includes(`\"${step}\"`)) failures.push(`pilot adımı eksik: ${step}`);
  }
  if (!report.includes("read_only")) failures.push("rapor salt-okunur işaretini taşımıyor");
  if (!report.includes("index: false")) failures.push("demo rapor arama motorlarına kapalı değil");
}

if (failures.length > 0) {
  console.error(`PILOT WEB FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("PILOT WEB PASS — 7 adımlı fixture yolculuğu ve salt-okunur demo rapor yüzeyi hazır");
