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
if (artifact.report?.mode !== "field_pilot") failures.push("rapor mode=field_pilot değil");
if (artifact.report?.verdict !== "pass") failures.push("field pilot eşikleri geçmedi");
if (artifact.report?.workspaceCount < 3 || artifact.report?.accountCount < 10) failures.push("gerçek pilot kapsamı 3/10 altında");
if (!artifact.provenance?.preparedBy || artifact.provenance?.confirmsRealAccounts !== true) failures.push("attestation eksik");
if (!/^[a-f0-9]{64}$/.test(artifact.provenance?.inputSha256 ?? "")) failures.push("girdi hash'i eksik");
if (failures.length > 0) {
  console.error(`FIELD PILOT FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("FIELD PILOT PASS — attested 3/10 gerçek saha raporu eşikleri geçti");
