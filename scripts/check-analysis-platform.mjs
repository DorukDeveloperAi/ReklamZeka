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
  "docs/ADR/0008-meta-dijital-ikiz-ve-ic-kategori.md",
  "docs/ADR/0009-kullanici-talimatlari-ve-policy-onceligi.md",
  "docs/ADR/0010-meta-write-valfi-ve-agentic-sinir.md",
  "docs/ADR/0011-model-agnostic-agent-ve-mcp.md",
  "docs/ADR/0012-creative-post-promotion-ve-atomik-onay.md",
  "docs/ADR/0013-guidance-ve-kademeli-katilastirma.md",
  "docs/ADR/0014-deterministik-on-isleme-ve-context.md",
  "docs/discovery/2026-08-06-meta-operating-system.md",
  "docs/discovery/2026-08-06-end-to-end-gap-review.md",
  "docs/product/internal-category-model.md",
  "docs/product/reklamzeka-product-distillation.md",
  "docs/architecture/model-agnostic-agent-interface.md",
  "docs/architecture/creative-and-approval-operations.md",
  "docs/architecture/local-cli-agent-bridge.md",
  "docs/architecture/guidance-deliberation-and-progressive-formalization.md",
  "docs/architecture/analysis-processing-pipeline.md",
  "plans/proje/v2/MASTER.md",
  "plans/proje/v2/slice-01-meta-read-mirror.md",
  "plans/proje/v2/REQUIREMENTS.md",
  "plans/proje/v2/asama-08-meta-dijital-ikizi.md",
  "plans/proje/v2/asama-09-kategori-talimat.md",
  "plans/proje/v2/asama-10-zamansal-analiz.md",
  "plans/proje/v2/asama-11-butce-planlama.md",
  "plans/proje/v2/asama-12-prompt-advisor.md",
  "plans/proje/v2/asama-13-eylem-otomasyon.md",
  "plans/proje/v2/asama-14-kontrol-merkezi.md",
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
  const internalCategory = readFileSync(resolve(root, "docs/product/internal-category-model.md"), "utf8");
  for (const boundary of ["CategoryDimension", "CategoryProfile", "guidanceSetRefs", "advisedPracticeRefs", "manual_locked", "PARKED_CONFLICT", "effective-context snapshot"]) {
    if (!internalCategory.includes(boundary)) failures.push(`iç kategori sözleşmesi eksik: ${boundary}`);
  }
  const agentInterface = readFileSync(resolve(root, "docs/architecture/model-agnostic-agent-interface.md"), "utf8");
  for (const boundary of ["OrchestratorProfile", "AgentSkillManifest", "RuleCoach", "EffectiveAutonomyDecision", "existing_post_promotion"]) {
    if (!agentInterface.includes(boundary)) failures.push(`orchestrator sözleşmesi eksik: ${boundary}`);
  }
  const guidance = readFileSync(resolve(root, "docs/architecture/guidance-deliberation-and-progressive-formalization.md"), "utf8");
  for (const boundary of ["GuidanceSource", "EffectiveGuidancePack", "AnalysisAgendaVersion", "DecisionCadenceProfile", "AdvisedPractice", "StandardizationReview", "no-change", "G0", "G4"]) {
    if (!guidance.includes(boundary)) failures.push(`guidance sözleşmesi eksik: ${boundary}`);
  }
  const pipeline = readFileSync(resolve(root, "docs/architecture/analysis-processing-pipeline.md"), "utf8");
  for (const boundary of ["L0", "L5", "EffectiveCampaignContext", "BusinessOutcomeSignal", "moreAvailable", "PostgreSQL"]) {
    if (!pipeline.includes(boundary)) failures.push(`analysis pipeline sözleşmesi eksik: ${boundary}`);
  }
  const distillation = readFileSync(resolve(root, "docs/product/reklamzeka-product-distillation.md"), "utf8");
  for (const boundary of ["Meta Read Mirror", "Business Context", "AdvisedPractice", "EffectiveCampaignContext", "approval_only", "Existing-post Promotion", "S6 — Selective Standardization"]) {
    if (!distillation.includes(boundary)) failures.push(`ürün distilasyonu sınırı eksik: ${boundary}`);
  }
  const requirements = readFileSync(resolve(root, "plans/proje/v2/REQUIREMENTS.md"), "utf8");
  for (const boundary of ["R-G23", "R-G24", "R-G25", "R-G26", "R-09.20", "R-09.21", "R-10.13", "R-10.14", "R-10.16", "R-12.18", "R-12.19", "R-12.20", "R-12.21", "R-13.20", "R-14.20", "R-14.21", "R-14.22", "R-14.23"]) {
    if (!requirements.includes(boundary)) failures.push(`guidance requirement eksik: ${boundary}`);
  }
}

if (failures.length > 0) {
  console.error(`ANALYSIS PLATFORM FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("ANALYSIS PLATFORM PASS — amaç playbook'ları, L0–L5 context, AdvisedPractice yaşam döngüsü, guidance→policy sınırı ve karar temposu mevcut");
