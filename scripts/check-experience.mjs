#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const required = [
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/operating-dashboard.tsx",
  "src/app/dashboard/operating-dashboard.module.css",
  "src/app/dashboard/canonical-performance-panel.tsx",
  "src/app/dashboard/canonical-campaign-portfolio-panel.tsx",
  "src/app/dashboard/local-session-connector.tsx",
  "tests/today-inventory-summary-dashboard.test.ts",
  "tests/portfolio-dashboard.test.ts",
  "tests/local-session-connector.test.ts",
  "tests/dashboard-information-architecture.test.ts",
  "docs/qa/2026-08-14-dashboard-first-increment-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-session-ux-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-analysis-decisions-browser-evidence.json",
];
for (const path of required) if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);

if (failures.length === 0) {
  const operatingDashboard = readFileSync(resolve(root, "src/app/dashboard/operating-dashboard.tsx"), "utf8");
  const dashboardPage = readFileSync(resolve(root, "src/app/dashboard/page.tsx"), "utf8");
  const sessionConnector = readFileSync(resolve(root, "src/app/dashboard/local-session-connector.tsx"), "utf8");
  for (const boundary of ["OPERATING REVIEW · KANONİK KAYNAK", "META PORTFÖYÜ · KANONİK AYNA", "Eksik veri sıfır veya örnek değer olarak gösterilmez", "ekran örnek içerikle doldurulmaz"]) {
    if (!operatingDashboard.includes(boundary)) failures.push(`operating dashboard sınırı eksik: ${boundary}`);
  }
  for (const forbidden of ["Demo Marka", "PORTFÖY · DEMO", "KARAR MASASI · DEMO", "OFFLINE ÇALIŞMA KİTABI SNAPSHOT", "7 AĞUSTOS CUMA"]) {
    if (operatingDashboard.includes(forbidden)) failures.push(`Today/Campaigns hardcoded fallback kaldı: ${forbidden}`);
  }
  for (const fakeAnalysis of ["4 hesap · 32 kampanya", "Dry-run çalıştır →", "Takvimi yönet", "Günlük portföy kontrolü"]) {
    if (operatingDashboard.includes(fakeAnalysis)) failures.push(`statik Analizler operasyon içeriği kaldı: ${fakeAnalysis}`);
  }
  if (operatingDashboard.includes('{ id: "analysis", label: "Analizler"')) failures.push("statik Analizler görünümü navigasyonda kaldı");
  if (!operatingDashboard.includes('{ id: "decision-room", label: "Analiz & Kararlar"')) failures.push("birleşik Analiz & Kararlar görünümü eksik");
  for (const legacyDependency of ["dashboardResponse", "fixture-state", "DEMO_METRICS"]) {
    if (dashboardPage.includes(legacyDependency)) failures.push(`dashboard runtime legacy fixture'a bağlı: ${legacyDependency}`);
  }
  for (const connectorBoundary of ["npm run local-session:mint", 'type="password"', 'credentials: "same-origin"', '"X-ReklamZeka-Intent": "bootstrap-local-session"']) {
    if (!sessionConnector.includes(connectorBoundary)) failures.push(`local session UX sınırı eksik: ${connectorBoundary}`);
  }
  for (const unsafeClientStorage of ["localStorage", "sessionStorage", "document.cookie", "console.log", "console.error"]) {
    if (sessionConnector.includes(unsafeClientStorage)) failures.push(`local session proof istemcide güvensiz işleniyor: ${unsafeClientStorage}`);
  }
  const evidence = JSON.parse(readFileSync(resolve(root, "docs/qa/2026-08-14-dashboard-first-increment-browser-evidence.json"), "utf8"));
  const widths = evidence.viewports.map((viewport) => viewport.width);
  if (JSON.stringify(widths) !== JSON.stringify([1280, 390])) failures.push("desktop/mobile viewport kanıtı eksik");
  if (evidence.viewports.some((viewport) => !viewport.bodyFits || viewport.visualInspection !== "pass")) {
    failures.push("viewport taşma/görsel QA başarısız");
  }
  if (evidence.views.length !== 2 || evidence.views.some((view) => !view.singleH1 || !view.honestSourceState || view.hardcodedDemoContentFound)) failures.push("Today/Campaigns veri durumu veya heading kanıtı başarısız");
  if (evidence.sourceBoundary.fallbackRendered || evidence.forbiddenTermsFound.length > 0) failures.push("kaynak sınırında demo fallback görüldü");
  if (evidence.consoleErrors !== 0 || evidence.consoleWarnings !== 0) failures.push("tarayıcı console kapısı başarısız");
  const sessionEvidence = JSON.parse(readFileSync(resolve(root, "docs/qa/2026-08-14-dashboard-session-ux-browser-evidence.json"), "utf8"));
  if (sessionEvidence.views.length !== 2 || sessionEvidence.views.some((view) => !view.connectorVisibleInContext || view.decisionRoomNavigationRequired)) failures.push("bağlamsal local session connector kanıtı başarısız");
  if (!sessionEvidence.securityBoundary.operatorMintCommandVisible || sessionEvidence.securityBoundary.agentOrBrowserMintedProof
    || sessionEvidence.securityBoundary.proofInputType !== "password" || !sessionEvidence.securityBoundary.proofClearedAfterSubmit
    || sessionEvidence.securityBoundary.proofPersistedByClient) failures.push("local session proof güvenlik kanıtı başarısız");
  if (sessionEvidence.states.sessionRequired !== "pass" || sessionEvidence.states.invalidProofRejected !== "pass"
    || sessionEvidence.states.happyPath !== "operator_proof_required") failures.push("local session state kanıtı başarısız");
  if (sessionEvidence.viewports.some((viewport) => !viewport.bodyFits || viewport.visualInspection !== "pass")
    || sessionEvidence.consoleErrors !== 0 || sessionEvidence.consoleWarnings !== 0) failures.push("local session responsive/console kanıtı başarısız");
  const analysisEvidence = JSON.parse(readFileSync(resolve(root, "docs/qa/2026-08-14-dashboard-analysis-decisions-browser-evidence.json"), "utf8"));
  if (!analysisEvidence.informationArchitecture.staticAnalysisViewRemoved
    || analysisEvidence.informationArchitecture.navigationTargetsAfter !== 15
    || analysisEvidence.informationArchitecture.fakeOperationalClaimsFound.length > 0) failures.push("Analiz & Kararlar bilgi mimarisi kanıtı başarısız");
  if (analysisEvidence.viewports.some((viewport) => !viewport.bodyFits || !viewport.singleH1 || viewport.visualInspection !== "pass")
    || !analysisEvidence.interaction.tabsSwitch || !analysisEvidence.interaction.honestUnavailableState
    || analysisEvidence.console.productErrors !== 0 || analysisEvidence.console.productWarnings !== 0) failures.push("Analiz & Kararlar browser/etkileşim kanıtı başarısız");
}

if (failures.length > 0) {
  console.error(`EXPERIENCE FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("EXPERIENCE PASS — Today/Campaigns kanonik-only; Analiz & Kararlar tek gerçek read-model yüzeyi; dürüst kaynak sınırı ve 1280/390 kanıtı bağlı");
