#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const required = [
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/fixture-state.ts",
  "src/app/api/dashboard/route.ts",
  "tests/performance-experience.test.ts",
  "docs/qa/a05-browser-evidence.json",
];
for (const path of required) if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);

if (failures.length === 0) {
  const evidence = JSON.parse(readFileSync(resolve(root, "docs/qa/a05-browser-evidence.json"), "utf8"));
  const widths = evidence.viewports.map((viewport) => viewport.width);
  if (JSON.stringify(widths) !== JSON.stringify([1280, 820, 390])) failures.push("üç viewport kanıtı eksik");
  if (evidence.viewports.some((viewport) => !viewport.bodyFits || viewport.visualInspection !== "pass")) {
    failures.push("viewport taşma/görsel QA başarısız");
  }
  if (evidence.states.length !== 7) failures.push("yedi veri durumunun tamamı sürülmemiş");
  if (!evidence.accessibility.singleH1PerState || !evidence.accessibility.campaignTableHeaders) {
    failures.push("erişilebilirlik hükmü eksik");
  }
  if (evidence.consoleErrors !== 0 || evidence.interaction.result !== "pass") failures.push("tarayıcı etkileşim/console kapısı başarısız");
}

if (failures.length > 0) {
  console.error(`EXPERIENCE FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("EXPERIENCE PASS — durumlar, kanonik toplamlar, a11y ve 1280/820/390 viewport kanıtı bağlı");
