#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "docs/qa/field-pilot.json");
if (!existsSync(reportPath)) {
  console.error("FIELD PILOT MISSING — docs/qa/field-pilot.json henüz üretilmedi");
  process.exit(2);
}
const artifact = JSON.parse(readFileSync(reportPath, "utf8"));
const failures = [];
const validTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const validRate = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const forbiddenRawKeys = new Set(["events", "workspaces", "accounts", "email", "token", "secret", "customername"]);
function findForbiddenKeys(value, path = "artifact") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeys(item, `${path}[${index}]`));
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(forbiddenRawKeys.has(key.toLowerCase()) ? [`${path}.${key}`] : []),
    ...findForbiddenKeys(nested, `${path}.${key}`),
  ]);
}
if (artifact.report?.mode !== "field_pilot") failures.push("rapor mode=field_pilot değil");
if (artifact.report?.verdict !== "pass") failures.push("field pilot eşikleri geçmedi");
if (artifact.report?.workspaceCount < 3 || artifact.report?.accountCount < 10) failures.push("gerçek pilot kapsamı 3/10 altında");
if (!validTimestamp(artifact.report?.asOf)) failures.push("rapor asOf geçersiz");
if (!validRate(artifact.report?.freshWithin60MinutesRate) || artifact.report?.freshWithin60MinutesRate < 0.95) failures.push("tazelik eşiği geçersiz");
if (typeof artifact.report?.medianActivationMinutes !== "number" || artifact.report.medianActivationMinutes > 15) failures.push("aktivasyon eşiği geçersiz");
if (!validRate(artifact.report?.usefulOrActedRate) || artifact.report?.usefulOrActedRate < 0.6) failures.push("feedback eşiği geçersiz");
if (artifact.report?.openCriticalSecurityIncidents !== 0) failures.push("açık kritik güvenlik olayı var");
if (!artifact.report?.thresholds || !Object.values(artifact.report.thresholds).every((value) => value === true)) failures.push("eşik bayraklarının tamamı true değil");
if (!artifact.provenance?.preparedBy || !artifact.provenance?.sourceDescription
  || !validTimestamp(artifact.provenance?.preparedAt) || artifact.provenance?.confirmsRealAccounts !== true) failures.push("attestation eksik");
if (!/^[a-f0-9]{64}$/.test(artifact.provenance?.inputSha256 ?? "")) failures.push("girdi hash'i eksik");
const forbidden = findForbiddenKeys(artifact);
if (forbidden.length > 0) failures.push(`özet artefakta ham/hassas alan sızdı: ${forbidden.join(", ")}`);
if (failures.length > 0) {
  console.error(`FIELD PILOT FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("FIELD PILOT PASS — attested 3/10 gerçek saha raporu eşikleri geçti");
