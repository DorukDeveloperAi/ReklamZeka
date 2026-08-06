#!/usr/bin/env node
/**
 * workflow şablon kütüphanesi kanıt harness'ı — SALT-OKUNUR (gerçek ~/.claude'a dokunmaz).
 *
 * Kanıtı "koda bakarak" değil ÜRÜNÜ SÜREREK alır: dogrula.mjs kapısı AYRI SÜREÇTE
 * (`spawnSync("node", [DOGRULA, fixture])`) çağrılır; hüküm exit kodu + stdout `IHLAL K<n>`
 * SÖZLEŞMESİNDEN okunur. Kasıtlı-bozuk fixture'lar kanon şablonun string-mutasyonuyla
 * sandbox'a (`mkdtempSync`) yazılır; kanon şablonlar ve kit kaydı hiç değiştirilmez.
 *
 * Koşum:  node .claude/skills/workflow/proof/proof.mjs   (kurulu kopyada da koşar)
 * Çıktı:  satır başı PASS/FAIL + `PROOF <geçen>/<toplam>`; herhangi FAIL → exit 1.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, "..");             // .../skills/workflow
const DOGRULA = join(SKILL, "scripts", "dogrula.mjs");
const SABLON = join(SKILL, "sablonlar");
const UD = join(SABLON, "uygula-dogrula.mjs");
const FO = join(SABLON, "fan-out-topla.mjs");

// Kanon → repo/kurulu (bu belge templates/ altında ya da .claude/ altında yaşayabilir).
// kit.json + sync.ts repo kökündedir; her iki konumdan kökü bul (git-dışı, salt readdir).
function repoKok(bas) {
  let d = bas;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "packages", "kit", "kit.json"))) return d;
    const ust = dirname(d);
    if (ust === d) break;
    d = ust;
  }
  return null;
}

let pass = 0, fail = 0;
const ok = (ad, kosul, detay = "") => {
  kosul ? pass++ : fail++;
  console.log(`${kosul ? "  PASS" : "  FAIL"}  ${ad}${detay && !kosul ? `\n        ${detay}` : ""}`);
};

const SB = mkdtempSync(join(tmpdir(), "workflow-proof-"));
let fno = 0;
function fixture(icerik) {
  const yol = join(SB, `f${fno++}.mjs`);
  writeFileSync(yol, icerik);
  return yol;
}
// dogrula.mjs'i ayrı süreçte koştur → {exit, out}
function kapi(...yollar) {
  const r = spawnSync("node", [DOGRULA, ...yollar], { encoding: "utf8" });
  return { exit: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const udSrc = readFileSync(UD, "utf8");
const foSrc = readFileSync(FO, "utf8");

console.log("workflow şablon kapısı — kanıt harness'ı\n");

// ── 1-2: kanon şablonlar temiz ──
{
  const r = kapi(UD);
  ok("1  kanon uygula-dogrula → exit 0 + OK", r.exit === 0 && /OK \(7 kural\)/.test(r.out), `exit=${r.exit} out=${r.out.trim()}`);
}
{
  const r = kapi(FO);
  ok("2  kanon fan-out-topla → exit 0 + OK", r.exit === 0 && /OK \(7 kural\)/.test(r.out), `exit=${r.exit} out=${r.out.trim()}`);
}

// ── 3-11: kasıtlı-bozuk fixture'lar (her biri doğru IHLAL K<n> + exit 1) ──
const mut = (src, a, b) => { if (!src.includes(a)) throw new Error(`mutasyon deseni yok: ${a}`); return src.replace(a, b); };
const bozuk = [
  ["3  maxParalel satırı silinmiş → K1", "K1",
    fixture(udSrc.split("\n").filter((l) => !/^\s*maxParalel:/.test(l)).join("\n"))],
  ["4  maxParalel: 8 → K1", "K1",
    fixture(mut(udSrc, "maxParalel: 2", "maxParalel: 8"))],
  ["5  bir agent'tan schema silinmiş → K2", "K2",
    fixture(mut(udSrc, `label: "uygula", phase: "uygula", schema: IS_SEMASI`, `label: "uygula", phase: "uygula"`))],
  ["6  verify çağrısında yazar araç adı → K3", "K3",
    fixture(mut(udSrc, `phase: "verify", schema: HUKUM_SEMASI`, `phase: "verify", agentType: "Write", schema: HUKUM_SEMASI`))],
  ["7  verify hüküm şeması soyulmuş → K3", "K3",
    fixture(mut(udSrc, `phase: "verify", schema: HUKUM_SEMASI`, `phase: "verify", schema: IS_SEMASI`))],
  ["8  bir prompt'tan SINIR çıkmış → K4", "K4",
    fixture(mut(udSrc, ` — KABUL: <KABUL>\\n${"$"}{SINIR}`, ` — KABUL: <KABUL>`))],
  ["9  gövdeye Date.now() eklenmiş → K5", "K5",
    fixture(mut(udSrc, `let sonuc = { sonuc: "EKSIK", is };`, `let sonuc = { sonuc: "EKSIK", is }; const _t = Date.now();`))],
  ["10 fan-out dilim sabit 3 (meta.maxParalel değil) → K6", "K6",
    fixture(foSrc.split("meta.maxParalel").join("3"))],
  ["11 export default eklenmiş → K7", "K7",
    fixture("export default async function run(){ return 1; }\n" + udSrc)],
];
for (const [ad, beklK, yol] of bozuk) {
  const r = kapi(yol);
  ok(ad, r.exit === 1 && r.out.includes(`IHLAL ${beklK} `), `exit=${r.exit} out=${r.out.trim().split("\n")[0]}`);
}

// ── 12: idempotens + salt-okunurluk ──
{
  const dirHash = (d) => {
    const h = createHash("sha256");
    for (const f of readdirSync(d).sort()) {
      if (statSync(join(d, f)).isFile()) h.update(f).update(readFileSync(join(d, f)));
    }
    return h.digest("hex");
  };
  const oncesi = dirHash(SB);
  const r1 = kapi(UD, FO);
  const r2 = kapi(UD, FO);
  const sonrasi = dirHash(SB);
  ok("12 idempotent + salt-okunur (bit-eş stdout, dizin hash sabit)",
    r1.out === r2.out && oncesi === sonrasi, `stdoutEq=${r1.out === r2.out} hashEq=${oncesi === sonrasi}`);
}

// ── 13-14: dağıtım zinciri (manifest + varsayılan set) ──
const kok = repoKok(SKILL);
{
  let bilgi = "";
  let iyi = false;
  if (kok) {
    try {
      const p = JSON.parse(readFileSync(join(kok, "packages", "kit", "kit.json"), "utf8")).packages["skill:workflow"];
      const dosyaVar = p && p.srcs && p.srcs.every((s) => existsSync(join(kok, "packages", "kit", s)));
      iyi = !!p && dosyaVar && p.files.length === p.srcs.length && p.files.length === 6; // 04: +wf-artefakt.mjs
      bilgi = p ? `files=${p.files.length} srcs=${p.srcs.length} dosyaVar=${dosyaVar}` : "kayıt yok";
    } catch (e) { bilgi = String(e); }
  } else { bilgi = "repo kökü bulunamadı (kurulu-kopya koşumu — muaf)"; iyi = true; }
  ok("13 kit.json skill:workflow kaydı (files↔srcs 6/6, dosyalar diskte)", iyi, bilgi);
}
{
  let iyi = false, bilgi = "";
  if (kok) {
    const sync = readFileSync(join(kok, "packages", "core", "src", "sync.ts"), "utf8");
    const m = sync.match(/DEFAULT_SYNC_FEATURES\s*=\s*\[([\s\S]*?)\]/);
    iyi = !!m && /["']skill:workflow["']/.test(m[1]);
    bilgi = m ? "DEFAULT_SYNC_FEATURES bloğu tarandı" : "DEFAULT_SYNC_FEATURES bulunamadı";
  } else { bilgi = "repo kökü yok — muaf"; iyi = true; }
  ok("14 sync.ts DEFAULT_SYNC_FEATURES 'skill:workflow' içeriyor", iyi, bilgi);
}

const toplam = pass + fail;
console.log(`\nPROOF ${pass}/${toplam}`);
process.exit(fail ? 1 : 0);
