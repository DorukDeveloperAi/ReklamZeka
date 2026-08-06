#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { buildAttestedFieldPilotReport } from "../src/pilot/field-input";

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error("Kullanım: npm run pilot:field-report -- <input.json> <output.json>");
  process.exit(1);
}

const root = process.cwd();
const inputPath = resolve(root, inputArg);
const outputPath = resolve(root, outputArg);
const outputRelative = relative(root, outputPath);
if (outputRelative.startsWith("..") || outputRelative === "") {
  console.error("Çıktı proje dizini içinde açık bir dosya yolu olmalıdır.");
  process.exit(1);
}
if (!existsSync(inputPath)) {
  console.error(`Pilot girdi dosyası bulunamadı: ${inputPath}`);
  process.exit(1);
}
if (existsSync(outputPath)) {
  console.error(`Mevcut raporun üzerine yazılmadı: ${outputPath}`);
  process.exit(1);
}

try {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const result = buildAttestedFieldPilotReport(input);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`Field pilot raporu üretildi: ${outputRelative} · hüküm ${result.report.verdict.toUpperCase()}`);
  if (result.report.verdict !== "pass") process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Field pilot raporu üretilemedi");
  process.exit(1);
}
