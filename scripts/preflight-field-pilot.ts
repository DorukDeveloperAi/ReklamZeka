#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAttestedFieldPilotReport } from "../src/pilot/field-input";

const [inputArg] = process.argv.slice(2);
if (!inputArg) {
  console.error("Kullanım: npm run pilot:field-preflight -- <input.json>");
  process.exit(1);
}

const inputPath = resolve(process.cwd(), inputArg);
if (!existsSync(inputPath)) {
  console.error(`Pilot girdi dosyası bulunamadı: ${inputPath}`);
  process.exit(1);
}

try {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const result = buildAttestedFieldPilotReport(input);
  console.log(JSON.stringify({
    verdict: result.report.verdict,
    asOf: result.report.asOf,
    workspaceCount: result.report.workspaceCount,
    accountCount: result.report.accountCount,
    freshWithin60MinutesRate: result.report.freshWithin60MinutesRate,
    medianActivationMinutes: result.report.medianActivationMinutes,
    usefulOrActedRate: result.report.usefulOrActedRate,
    openCriticalSecurityIncidents: result.report.openCriticalSecurityIncidents,
    thresholds: result.report.thresholds,
    inputSha256: result.provenance.inputSha256,
  }, null, 2));
  if (result.report.verdict !== "pass") process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Field pilot preflight çalıştırılamadı");
  process.exit(1);
}
