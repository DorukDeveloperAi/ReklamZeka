#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const required = [
  "src/app/pilot/page.tsx",
  "src/app/reports/demo/page.tsx",
  "src/app/reports/shared/[token]/page.tsx",
  "src/app/api/dashboard/route.ts",
  "src/app/api/insights/route.ts",
  "src/app/api/reports/demo-share/route.ts",
  "src/app/api/reports/shared/[token]/csv/route.ts",
  "tests/pilot-web-journey.test.ts",
];

for (const path of required) if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);

if (failures.length === 0) {
  const sources = required.slice(0, 7).map((path) => readFileSync(resolve(root, path), "utf8"));
  for (const [path, source] of required.slice(0, 3).map((path, index) => [path, sources[index]])) {
    if (!source.includes('redirect("/dashboard")')) failures.push(`${path} legacy yüzeyi dashboard'a yönlendirmiyor`);
  }
  for (const [path, source] of required.slice(3, 7).map((path, index) => [path, sources[index + 3]])) {
    if (!source.includes("legacy_demo_retired") || !source.includes("status: 410")) failures.push(`${path} legacy demo sınırını 410 ile kapatmıyor`);
  }
}

if (failures.length > 0) {
  console.error(`PILOT WEB RETIREMENT FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("PILOT WEB RETIREMENT PASS — fixture pilot/report public yüzeyleri kapalı; dashboard gerçek kaynak sınırıdır");
