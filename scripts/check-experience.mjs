#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const required = [
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/operating-dashboard.tsx",
  "src/app/dashboard/operating-dashboard.module.css",
  "src/app/dashboard/dashboard-location.ts",
  "src/app/dashboard/canonical-performance-panel.tsx",
  "src/app/dashboard/canonical-campaign-portfolio-panel.tsx",
  "src/app/dashboard/local-session-connector.tsx",
  "tests/today-inventory-summary-dashboard.test.ts",
  "tests/portfolio-dashboard.test.ts",
  "tests/local-session-connector.test.ts",
  "tests/dashboard-information-architecture.test.ts",
  "tests/dashboard-approved-information-architecture.test.ts",
  "tests/dashboard-location.test.ts",
  "tests/source-state.test.ts",
  "tests/dashboard-user-language.test.ts",
  "tests/dashboard-responsive-contract.test.ts",
  "tests/local-autonomy-rule-studio-runtime.test.ts",
  "tests/local-operational-timeline-runtime.test.ts",
  "docs/qa/2026-08-14-dashboard-first-increment-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-session-ux-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-analysis-decisions-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-budget-approval-autonomy-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-rules-categories-practice-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-meta-orchestrator-operations-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-approved-ia-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-shell-routing-browser-evidence.json",
  "docs/qa/2026-08-14-dashboard-persisted-campaign-operator-acceptance.md",
];
for (const path of required) if (!existsSync(resolve(root, path))) failures.push(`eksik: ${path}`);

if (failures.length === 0) {
  const operatingDashboard = readFileSync(resolve(root, "src/app/dashboard/operating-dashboard.tsx"), "utf8");
  const dashboardPage = readFileSync(resolve(root, "src/app/dashboard/page.tsx"), "utf8");
  const dashboardLocation = readFileSync(resolve(root, "src/app/dashboard/dashboard-location.ts"), "utf8");
  const sessionConnector = readFileSync(resolve(root, "src/app/dashboard/local-session-connector.tsx"), "utf8");
  const budgetLab = readFileSync(resolve(root, "src/app/dashboard/budget-lab-panel.tsx"), "utf8");
  const approvalQueue = readFileSync(resolve(root, "src/app/dashboard/approval-queue-panel.tsx"), "utf8");
  const autonomyStudio = readFileSync(resolve(root, "src/app/dashboard/autonomy-studio-panel.tsx"), "utf8");
  const budgetPools = readFileSync(resolve(root, "src/app/dashboard/budget-pool-hierarchy-panel.tsx"), "utf8");
  const deliveryAlerts = readFileSync(resolve(root, "src/app/dashboard/delivery-health-alert-panel.tsx"), "utf8");
  const promotionPreflight = readFileSync(resolve(root, "src/app/dashboard/promotion-preflight-panel.tsx"), "utf8");
  const operationalTimeline = readFileSync(resolve(root, "src/app/dashboard/operational-timeline-panel.tsx"), "utf8");
  const navigationSource = operatingDashboard.slice(operatingDashboard.indexOf("const navGroups"), operatingDashboard.indexOf("export type PortfolioFilters"));
  for (const boundary of ["GÜNLÜK OPERASYON · KANONİK KAYNAK", "KAMPANYA ÇALIŞMA ALANI · KANONİK BAĞLAM", "Eksik veri sıfır veya örnek değer olarak gösterilmez", "ekran örnek içerikle doldurulmaz"]) {
    if (!operatingDashboard.includes(boundary)) failures.push(`operating dashboard sınırı eksik: ${boundary}`);
  }
  for (const forbidden of ["Demo Marka", "PORTFÖY · DEMO", "KARAR MASASI · DEMO", "OFFLINE ÇALIŞMA KİTABI SNAPSHOT", "7 AĞUSTOS CUMA"]) {
    if (operatingDashboard.includes(forbidden)) failures.push(`Today/Campaigns hardcoded fallback kaldı: ${forbidden}`);
  }
  for (const fakeAnalysis of ["4 hesap · 32 kampanya", "Dry-run çalıştır →", "Takvimi yönet", "Günlük portföy kontrolü"]) {
    if (operatingDashboard.includes(fakeAnalysis)) failures.push(`statik Analizler operasyon içeriği kaldı: ${fakeAnalysis}`);
  }
  if (operatingDashboard.includes('{ id: "analysis", label: "Analizler"')) failures.push("statik Analizler görünümü navigasyonda kaldı");
  for (const target of ['{ id: "monitor", label: "İzle"', '{ id: "manage", label: "Yönet"', '{ id: "agent", label: "Agent"']) {
    if (!navigationSource.includes(target)) failures.push(`onaylı primary IA hedefi eksik: ${target}`);
  }
  for (const legacyTarget of ['{ id: "strict-policies", label:', '{ id: "categories", label:',
    '{ id: "autonomy", label:', '{ id: "practice-lab", label:', '{ id: "meta", label:',
    '{ id: "alerts", label:', '{ id: "promotions", label:', '{ id: "timeline", label:']) {
    if (navigationSource.includes(legacyTarget)) failures.push(`legacy teknik hedef primary nav'da kaldı: ${legacyTarget}`);
  }
  for (const boundary of ["Kararlar", "Onay kuyruğu", "Canlı Graph envanteri bu sürümde kapalıdır.", "kural/policy metni üretmez, alanlara kopyalamaz veya kayıt oluşturmaz"]) {
    if (!operatingDashboard.includes(boundary)) failures.push(`üç alanlı dashboard sınırı eksik: ${boundary}`);
  }
  if (operatingDashboard.includes('fetch("/api/meta/inventory"')) failures.push("kapalı Graph capability için canlı envanter çağrısı kaldı");
  for (const legacyDependency of ["dashboardResponse", "fixture-state", "DEMO_METRICS"]) {
    if (dashboardPage.includes(legacyDependency)) failures.push(`dashboard runtime legacy fixture'a bağlı: ${legacyDependency}`);
  }
  for (const routingBoundary of ["dashboardLocationFromSearch", "dashboardLocationHref", "pushState", "replaceState", "popstate"]) {
    if (!operatingDashboard.includes(routingBoundary) && !dashboardLocation.includes(routingBoundary)) failures.push(`dashboard URL/history sınırı eksik: ${routingBoundary}`);
  }
  if (!dashboardPage.includes("dashboardLocationFromSearch(params)")) failures.push("dashboard server deep-link başlangıcı eksik");
  for (const connectorBoundary of ["npm run local-session:mint", 'type="password"', 'credentials: "same-origin"', '"X-ReklamZeka-Intent": "bootstrap-local-session"']) {
    if (!sessionConnector.includes(connectorBoundary)) failures.push(`local session UX sınırı eksik: ${connectorBoundary}`);
  }
  for (const unsafeClientStorage of ["localStorage", "sessionStorage", "document.cookie", "console.log", "console.error"]) {
    if (sessionConnector.includes(unsafeClientStorage)) failures.push(`local session proof istemcide güvensiz işleniyor: ${unsafeClientStorage}`);
  }
  for (const [surface, source] of [["budget", budgetLab], ["approval", approvalQueue], ["autonomy", autonomyStudio]]) {
    if (!source.includes("LocalSessionConnector") || source.includes("Decision Room’da oturumu bağla")) failures.push(`${surface} session recovery bağlam dışı`);
  }
  if (budgetPools.includes('hardCapDecimal: "500000"') || budgetPools.includes('poolRef: "budget_pool_domestic"')) failures.push("frontend seeded bütçe havuzu fallback'i kaldı");
  if (approvalQueue.includes("approvalSafetyStrip") || approvalQueue.includes("executionSafetyPanel")) failures.push("Onay kuyruğunda tekrarlı statik safety vitrini kaldı");
  for (const [surface, source] of [["delivery alerts", deliveryAlerts], ["promotion preflight", promotionPreflight], ["operational timeline", operationalTimeline]]) {
    if (!source.includes("LocalSessionConnector")) failures.push(`${surface} bağlamsal session recovery eksik`);
  }
  for (const removedAgentFallback of ["agentSkills", "6 active", "agentMessages"]) {
    if (operatingDashboard.includes(removedAgentFallback)) failures.push(`Orchestrator statik fallback'i kaldı: ${removedAgentFallback}`);
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
    || analysisEvidence.informationArchitecture.fakeOperationalClaimsFound.length > 0) failures.push("Analiz & Kararlar bilgi mimarisi kanıtı başarısız");
  if (analysisEvidence.viewports.some((viewport) => !viewport.bodyFits || !viewport.singleH1 || viewport.visualInspection !== "pass")
    || !analysisEvidence.interaction.tabsSwitch || !analysisEvidence.interaction.honestUnavailableState
    || analysisEvidence.console.productErrors !== 0 || analysisEvidence.console.productWarnings !== 0) failures.push("Analiz & Kararlar browser/etkileşim kanıtı başarısız");
  const operationsEvidence = JSON.parse(readFileSync(resolve(root, "docs/qa/2026-08-14-dashboard-budget-approval-autonomy-browser-evidence.json"), "utf8"));
  if (operationsEvidence.views.length !== 3 || operationsEvidence.views.some((view) => !view.contextualSessionConnector
    || view.decisionRoomRedirectCopy || view.frontendSeededOperationalDataFound || view.demoOrFixtureWordVisible)) failures.push("Bütçe/Onay/Autonomy kaynak ve session kanıtı başarısız");
  if (operationsEvidence.viewports.some((viewport) => !viewport.bodyFits || !viewport.singleH1)
    || !operationsEvidence.approvalSimplification.staticSafetyPanelsRemoved
    || operationsEvidence.rapidNavigation.productErrors !== 0 || operationsEvidence.rapidNavigation.productWarnings !== 0) failures.push("Bütçe/Onay/Autonomy responsive veya yarış koşulu kanıtı başarısız");
  const rulesEvidence = JSON.parse(readFileSync(resolve(root, "docs/qa/2026-08-14-dashboard-rules-categories-practice-browser-evidence.json"), "utf8"));
  if (rulesEvidence.views.length !== 4 || rulesEvidence.views.some((view) => !view.contextualSessionConnector
    || !view.singleH1 || view.demoOrFixtureWordVisible)
    || rulesEvidence.viewports.some((viewport) => !viewport.bodyFits || !viewport.singleH1AllViews || !viewport.oneContextualSessionFormAllViews)
    || rulesEvidence.rapidNavigation.productErrors !== 0 || rulesEvidence.rapidNavigation.productWarnings !== 0) failures.push("Rules/Categories/Practice browser kanıtı başarısız");
  const metaOperationsEvidence = JSON.parse(readFileSync(resolve(root, "docs/qa/2026-08-14-dashboard-meta-orchestrator-operations-browser-evidence.json"), "utf8"));
  if (metaOperationsEvidence.views.length !== 5 || metaOperationsEvidence.views.some((view) => !view.contextualSessionConnector
    || !view.singleH1 || view.demoOrFixtureWordVisible)
    || metaOperationsEvidence.viewports.some((viewport) => !viewport.bodyFits || !viewport.singleH1AllViews || !viewport.oneContextualSessionFormAllViews)
    || metaOperationsEvidence.rapidNavigation.productErrors !== 0 || metaOperationsEvidence.rapidNavigation.productWarnings !== 0
    || metaOperationsEvidence.securityBoundary.agentOrBrowserMintedProof || metaOperationsEvidence.securityBoundary.proofOrStorageInspected) failures.push("Meta/Orchestrator/operasyon browser veya güvenlik kanıtı başarısız");
  const operatorAcceptance = readFileSync(resolve(root, "docs/qa/2026-08-14-dashboard-persisted-campaign-operator-acceptance.md"), "utf8");
  for (const expected of ["Status: `PENDING_OPERATOR_PROOF`", "Kararlarda incele", "Tüm çalışma alanına dön", "PASS_OPERATOR_PROOF", "Meta write veya execute çalıştırılmadığı"]) {
    if (!operatorAcceptance.includes(expected)) failures.push(`operator campaign kabul paketi eksik: ${expected}`);
  }
}

if (failures.length > 0) {
  console.error(`EXPERIENCE FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("EXPERIENCE PASS — üç alanlı IA, kaynak sınırları ve mevcut session/campaign güvenlik kanıtları bağlı");
