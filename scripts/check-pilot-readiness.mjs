#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
for (const path of [
  "src/reports/share.ts", "src/operations/monitor.ts", "src/pilot/report.ts",
  "src/reports/demo-share.ts", "tests/report-runtime.test.ts", "tests/report-http.test.ts",
  "tests/report-pilot.test.ts", "tests/mvp-journey.test.ts", "tests/field-pilot-input.test.ts", "tests/fixtures/pilot.json", "docs/RUNBOOKS.md",
  "src/pilot/field-input.ts", "scripts/preflight-field-pilot.ts", "scripts/generate-field-pilot-report.ts", "scripts/check-field-pilot.mjs",
  "src/pilot/telemetry.ts", "tests/pilot-telemetry.test.ts", "docs/pilot/field-pilot.telemetry.template.json",
  "docs/PILOT-READINESS.md", "docs/qa/pilot-readiness.json",
  "src/app/pilot/page.tsx", "src/app/pilot/journey.ts", "src/app/reports/demo/page.tsx",
  "scripts/check-pilot-web.mjs", "tests/pilot-web-journey.test.ts",
  "drizzle/20260806161408_boring_cable.sql",
]) if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);

if (failures.length === 0) {
  const report = JSON.parse(readFileSync(resolve(root, "docs/qa/pilot-readiness.json"), "utf8"));
  if (report.mode !== "fixture_readiness") failures.push("sentetik rapor field pilot olarak yanlış etiketlenmiş");
  if (report.workspaceCount !== 3 || report.accountCount !== 10) failures.push("pilot fixture kapsamı 3/10 değil");
  if (report.verdict !== "pass" || !Object.values(report.thresholds).every(Boolean)) failures.push("readiness eşikleri geçmedi");
  const plan = readFileSync(resolve(root, "plans/proje/v1/STATE.md"), "utf8");
  if (/\| 07 \| rapor ve pilot \| KAPALI \|/.test(plan)) failures.push("gerçek field pilot olmadan A07 kapatılamaz");
}

if (failures.length > 0) {
  console.error(`PILOT READINESS FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("PILOT READINESS PASS — paylaşım, alarm ve 3/10 sentetik ölçüm hattı hazır; saha pilotu açık");
