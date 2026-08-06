#!/usr/bin/env node
// kurallar-test.mjs — kurallar.mjs tablo testi (G4 kilidi). Fixture: geçici KURALLAR varyantları.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { kurallarOku, karar, tipCoz } from "./kurallar.mjs";

const V2 = `# K\n\`\`\`json\n${JSON.stringify({
  surum: 2,
  tipler: { hedef: { otomatik: ["tek-proje", "kirmizi-degil"] }, "alt-proje": { otomatik: [] } },
  "insana-sor": { kosullar: ["capraz-proje", "belirsiz-kapsam"] },
  varsayilan: "insana-sor",
})}\n\`\`\`\n`;
const V1 = `# K\n\`\`\`json\n${JSON.stringify({
  surum: 1, otomatik: { kosullar: ["tek-proje"] },
  "insana-sor": { kosullar: ["capraz-proje"] }, varsayilan: "insana-sor",
})}\n\`\`\`\n`;

function fixture(icerik) {
  const d = mkdtempSync(join(tmpdir(), "kur-"));
  mkdirSync(join(d, "utopya"), { recursive: true });
  if (icerik !== null) writeFileSync(join(d, "utopya", "KURALLAR.md"), icerik);
  return d;
}

const k2 = kurallarOku(fixture(V2));
const k1 = kurallarOku(fixture(V1));
const kYok = kurallarOku(fixture(null));
const kBozuk = kurallarOku(fixture("# K\n```json\n{bozuk!!\n```\n"));

// [ad, girdi, kurallar, beklenenSonuc]
const TABLO = [
  ["v2 hedef tüm koşullar → otomatik", { ref: "uy:hedef/x", saglanan: ["tek-proje", "kirmizi-degil"] }, k2, "otomatik"],
  ["v2 hedef eksik koşul → sor", { ref: "uy:hedef/x", saglanan: ["tek-proje"] }, k2, "insana-sor"],
  ["v2 alt-proje boş otomatik → DAİMA sor", { ref: "uy:alt-proje/x", saglanan: ["tek-proje", "kirmizi-degil"] }, k2, "insana-sor"],
  ["v2 profili olmayan tip (nitelik) → sor", { ref: "uy:nitelik/x", saglanan: ["tek-proje", "kirmizi-degil"] }, k2, "insana-sor"],
  ["v2 vizyon (söz-slug tipe düşer) profili yok → sor", { ref: "uy:niyet-akar/yuz", saglanan: [] }, k2, "insana-sor"],
  ["v2 insana-sor koşulu tetiklendi → sor", { ref: "uy:hedef/x", saglanan: ["tek-proje", "kirmizi-degil"], tetiklenen: ["capraz-proje"] }, k2, "insana-sor"],
  ["kırmızı HER durumda → sor", { ref: "uy:hedef/x", saglanan: ["tek-proje", "kirmizi-degil"], kirmizi: true }, k2, "insana-sor"],
  ["ilke asla chunk değil → sor", { ref: "uy:ilke/x", saglanan: ["tek-proje", "kirmizi-degil"] }, k2, "insana-sor"],
  ["#alt-N tipi köke çözer → otomatik", { ref: "uy:hedef/x#alt-2", saglanan: ["tek-proje", "kirmizi-degil"] }, k2, "otomatik"],
  ["blok yok (fail-closed) → sor", { ref: "uy:hedef/x", saglanan: ["tek-proje", "kirmizi-degil"] }, kYok, "insana-sor"],
  ["bozuk JSON (fail-closed) → sor", { ref: "uy:hedef/x", saglanan: ["tek-proje", "kirmizi-degil"] }, kBozuk, "insana-sor"],
  ["surum:1 geriye-uyum → otomatik", { ref: "uy:hedef/x", saglanan: ["tek-proje"] }, k1, "otomatik"],
  ["surum:1 tetiklenen → sor", { ref: "uy:hedef/x", saglanan: ["tek-proje"], tetiklenen: ["capraz-proje"] }, k1, "insana-sor"],
];

let pas = 0, kal = 0;
for (const [ad, girdi, K, beklenen] of TABLO) {
  const r = karar(girdi, K);
  if (r.sonuc === beklenen) { pas++; console.log(`✓ ${ad}`); }
  else { kal++; console.log(`✗ ${ad} — beklenen ${beklenen}, gelen ${r.sonuc} (${r.gerekce})`); }
}
// tipCoz birim vakaları
const TIP = [["uy:hedef/x", "hedef"], ["uy:niyet-akar/y", "vizyon"], ["uy:alt-proje/z#alt-3", "alt-proje"], ["uy:ilke/i", "ilke"]];
for (const [ref, beklenen] of TIP) {
  if (tipCoz(ref) === beklenen) { pas++; console.log(`✓ tipCoz ${ref} → ${beklenen}`); }
  else { kal++; console.log(`✗ tipCoz ${ref} — beklenen ${beklenen}, gelen ${tipCoz(ref)}`); }
}
console.log(`\n${kal === 0 ? "PASS" : "FAIL"} — ${pas} geçti, ${kal} kaldı`);
process.exit(kal === 0 ? 0 : 1);
