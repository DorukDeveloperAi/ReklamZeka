#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "README.md",
  "docs/URUN-BRIFI.md",
  "utopya/KUZEY.md",
  "utopya/KURALLAR.md",
  "utopya/vizyon/1-urun-ve-mvp.md",
  "plans/proje/v1/MASTER.md",
  "plans/proje/v1/CHECKLIST.md",
  "plans/proje/v1/REQUIREMENTS.md",
  "plans/proje/v1/STATE.md",
  ".claude/kanit.json",
];

const failures = [];
const text = (rel) => readFileSync(resolve(root, rel), "utf8");

for (const rel of required) {
  if (!existsSync(resolve(root, rel))) failures.push(`eksik dosya: ${rel}`);
}

if (failures.length === 0) {
  const allUtopya = [
    "utopya/KUZEY.md",
    "utopya/vizyon/1-urun-ve-mvp.md",
    "utopya/istek/hedefler.md",
    "utopya/istek/yetenekler.md",
    "utopya/istek/nitelikler.md",
    "utopya/istek/ilkeler.md",
    "utopya/istek/alt-projeler.md",
  ].map(text).join("\n");
  const anchors = [...allUtopya.matchAll(/<!--\s*(uy:[a-z0-9-]+\/[a-z0-9-]+)\s*-->/g)].map((m) => m[1]);
  const unique = new Set(anchors);
  if (anchors.length < 12) failures.push(`yetersiz şartname çıpası: ${anchors.length}`);
  if (unique.size !== anchors.length) failures.push("yinelenen uy: çıpası var");
  for (const type of ["hedef", "yetenek", "nitelik", "ilke", "alt-proje"]) {
    if (!anchors.some((a) => a.startsWith(`uy:${type}/`))) failures.push(`istek tipi boş: ${type}`);
  }
  if (/\*\(İlk vizyon koşusunda doldurulur/.test(text("utopya/KUZEY.md"))) failures.push("KUZEY amaç alanı hâlâ placeholder");

  const state = text("plans/proje/v1/STATE.md");
  if (!/\| 01 \| ürün temeli \| KAPALI \|/.test(state)) failures.push("roadmap aşama 01 kapanmamış");
  if (!/\| 02 \| teknik temel \| KAPALI \|/.test(state)) failures.push("roadmap aşama 02 kapanmamış");
  if (!/\| 03 \| veri platformu \| AÇIK \|/.test(state)) failures.push("roadmap sıradaki aşama 03 değil");

  const evidence = JSON.parse(text(".claude/kanit.json"));
  if (!Array.isArray(evidence.girisler) || !evidence.girisler.some((x) => x.ad === "urun-temeli")) {
    failures.push("kanıt sözleşmesinde urun-temeli yok");
  }
}

if (failures.length) {
  console.error(`FOUNDATION FAIL (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("FOUNDATION PASS — ürün şartnamesi, roadmap ve kanıt zinciri bağlı");
