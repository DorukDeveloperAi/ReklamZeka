#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const required = [
  "src/app/pilot/page.tsx",
  "src/app/pilot/journey.ts",
  "src/app/reports/demo/page.tsx",
  "src/app/reports/report-view.tsx",
  "src/app/reports/shared/[token]/page.tsx",
  "src/app/reports/shared/[token]/not-found.tsx",
  "src/app/api/reports/demo-share/route.ts",
  "src/app/api/reports/shared/[token]/csv/route.ts",
  "src/app/pilot/demo-share-controls.tsx",
  "tests/pilot-web-journey.test.ts",
  "docs/qa/A07-PILOT-BROWSER-QA.md",
  "docs/qa/a07-pilot-browser-evidence.json",
];

for (const path of required) {
  if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);
}

if (failures.length === 0) {
  const journey = readFileSync(resolve(root, "src/app/pilot/journey.ts"), "utf8");
  const report = readFileSync(resolve(root, "src/app/reports/demo/page.tsx"), "utf8");
  const reportView = readFileSync(resolve(root, "src/app/reports/report-view.tsx"), "utf8");
  const shareControls = readFileSync(resolve(root, "src/app/pilot/demo-share-controls.tsx"), "utf8");
  const nextConfig = readFileSync(resolve(root, "next.config.ts"), "utf8");
  for (const step of ["session", "workspace", "source", "sync", "dashboard", "insights", "share"]) {
    if (!journey.includes(`\"${step}\"`)) failures.push(`pilot adımı eksik: ${step}`);
  }
  if (!reportView.includes("read_only")) failures.push("rapor salt-okunur işaretini taşımıyor");
  if (!report.includes("index: false")) failures.push("demo rapor arama motorlarına kapalı değil");
  if (!shareControls.includes("Bağlantıyı iptal et") || !shareControls.includes("İmzalı raporu aç")) {
    failures.push("imzalı paylaşım oluşturma/iptal kontrolü eksik");
  }
  for (const header of ["private, no-store", "no-referrer", "X-Robots-Tag", "X-Frame-Options"]) {
    if (!nextConfig.includes(header)) failures.push(`paylaşılan rapor güvenlik başlığı eksik: ${header}`);
  }
  const evidence = JSON.parse(readFileSync(resolve(root, "docs/qa/a07-pilot-browser-evidence.json"), "utf8"));
  if (evidence.mode !== "fixture_guided_journey" || evidence.fieldPilotEvidence !== false) {
    failures.push("tarayıcı kanıtı saha pilotu olarak yanlış etiketlenmiş");
  }
  if (evidence.journey?.length !== 7 || !evidence.journey.every((item) => item.result === "pass")) {
    failures.push("yedi adımlı tarayıcı yolculuğu PASS değil");
  }
  if (evidence.signedShare?.render?.status !== 200 || evidence.signedShare?.revokedPage?.status !== 404
    || evidence.signedShare?.csv?.revokedStatus !== 410 || evidence.signedShare?.htmlSecurityHeaders?.result !== "pass") {
    failures.push("imzalı paylaşım yaşam döngüsü PASS değil");
  }
  if (evidence.consoleErrors !== 0) failures.push("tarayıcı konsol hatası var");
}

if (failures.length > 0) {
  console.error(`PILOT WEB FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("PILOT WEB PASS — 7 adımlı fixture yolculuğu ve imzalı salt-okunur rapor yaşam döngüsü hazır");
