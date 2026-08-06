#!/usr/bin/env node
// gelen.mjs — PM gelen kutusu notunun (~/.claude/pm/gelen/*.md) TEK KOD-YOLU.
//
//   gelen.mjs add --text "<metin>" [--tip hedef|vizyon|direktif|soru]
//                 [--proje <cwd>] [--oncelik yuksek|orta|dusuk]
//                 [--kaynak pano|cli|tui|session|telegram|happy|elle] [--json]
//
// TEK KOD-YOLU SÖZLEŞMESİ: gelen-notu ŞEMASINI yalnız bu script bilir. Giriş kanallarının
// HEPSİ (pano formu `POST /api/pm/gelen` · `aide pm feed` · aide TUI `F` formu · session içi
// /pm · telegram/happy) bu script'i çağırır → şema tek yerde yaşar (ayar.mjs'in kadran için
// yaptığının aynısı).
// Okur: PM SKILL Faz P0.75 (notu işler, `islenen/`e taşır) · pano (rozet/özet için toleranslı parse).
//
// Dosya adını SUNUCU/script üretir (istemci path VEREMEZ) → path traversal imkânsız:
//   ~/.claude/pm/gelen/<YYYY-MM-DD-HHmm>-<rand4>.md
// Gövde = kullanıcının HAM metni; PM dahil hiçbir yazar ona dokunmaz (SKILL sert kuralı).
// Yazım atomik (tmp + rename). Geçersiz enum → exit 1 + net hata.

import { writeFileSync, renameSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const GELEN_DIR = join(HOME, ".claude", "pm", "gelen");
const PM_DIR = join(HOME, ".claude", "pm");

/** PM TAZELİĞİ — "bir sonraki PM koşumu işler" cümlesi ancak PM KOŞUYORSA doğrudur.
 *
 *  Kanıtlı olay (2026-07-27): metronom 2026-07-26 12:57'de kilitlendi ve PM rutini
 *  (`v0274088z`) çoktan parked'dı — son PM koşumu 07-22 07:41. Buna rağmen session'lar bu
 *  script'i çağırmaya devam etti: kilitten 8 saat SONRA 78 not, ertesi gün 4 not daha; kutu
 *  104'e çıktı. Her çağrı "bir sonraki PM koşumu işler" diyordu — kimse bir sonrakinin
 *  gelmediğini söylemiyordu. Sessiz ölüm yasağının aynadaki hâli: **sessiz DOLUŞ**.
 *
 *  Ölçüm PM'in KENDİ defterinden yapılır (`pm/log.jsonl` + `pm/ayar.json`) — maestro/sistem
 *  şalterine bağımlılık YOK. Bu daha dar ama daha dürüst bir yüklem: sistem açık olsa bile PM
 *  ölmüşse uyarır; asıl mesele "şalter" değil "bu notu okuyacak biri var mı".
 *  Eşik doctor'ın `PM brifing tazeliği` ekseniyle aynı: 2 × kadans.frekans (varsayılan 2h → 4h).
 *
 *  @returns {{bekliyor:boolean, sonKosum:string|null, saat:number|null, esikSaat:number, kuyruk:number}}
 */
export function pmDurumu() {
  const oku = (p, fb) => { try { return readFileSync(p, "utf8"); } catch { return fb; } };
  // kadans → eşik
  let frekansSaat = 2;
  try {
    const ayar = JSON.parse(oku(join(PM_DIR, "ayar.json"), "{}"));
    const f = String(ayar?.kadans?.frekans ?? "2h").trim();
    const m = /^(\d+(?:\.\d+)?)\s*([hmd])$/i.exec(f);
    if (m) frekansSaat = +m[1] * ({ h: 1, m: 1 / 60, d: 24 }[m[2].toLowerCase()] ?? 1);
  } catch { /* ayar yoksa varsayılan */ }
  const esikSaat = Math.max(1, frekansSaat * 2);

  // PM son koşumu: log.jsonl'ın SON satırındaki ts (yoksa dosya mtime'ı, o da yoksa null)
  let sonKosum = null;
  const logP = join(PM_DIR, "log.jsonl");
  if (existsSync(logP)) {
    const satirlar = oku(logP, "").trim().split("\n").filter(Boolean);
    for (let i = satirlar.length - 1; i >= 0 && !sonKosum; i--) {
      try { sonKosum = JSON.parse(satirlar[i])?.ts ?? null; } catch { /* bozuk satır atla */ }
    }
    if (!sonKosum) { try { sonKosum = statSync(logP).mtime.toISOString(); } catch { /* yok */ } }
  }
  const saat = sonKosum ? (Date.now() - Date.parse(sonKosum)) / 3_600_000 : null;

  let kuyruk = 0;
  try { kuyruk = readdirSync(GELEN_DIR).filter((f) => f.endsWith(".md")).length; } catch { /* dizin yok */ }

  // PM hiç koşmamışsa (log yok) HÜKÜM VERİLMEZ: yeni kurulum "PM ölü" demek değildir.
  const bekliyor = saat != null && saat > esikSaat;
  return { bekliyor, sonKosum, saat: saat == null ? null : Math.round(saat * 10) / 10, esikSaat, kuyruk };
}

// Enum'lar — PM SKILL "Gelen kutusu notu" şemasıyla RULE-SYMMETRIC ayna (biri değişirse ikisi de).
export const TIPLER = ["hedef", "vizyon", "direktif", "soru"];
export const ONCELIKLER = ["yuksek", "orta", "dusuk"];
// `tui` (SP7/G4): aide TUI Otomasyon paneli `F` formu — kadranın `K` formuyla simetrik.
export const KAYNAKLAR = ["pano", "cli", "tui", "vscode", "session", "telegram", "happy", "elle"];
export const VARSAYILAN_TIP = "direktif";
export const VARSAYILAN_KAYNAK = "elle";

function hata(msg) {
  console.error(`gelen: ${msg}`);
  process.exit(1);
}

/** <YYYY-MM-DD-HHmm>-<rand4>.md — yerel saat (kullanıcı bu adı gözle okur). */
function dosyaAdi(now) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}.md`;
}

/**
 * Gelen kutusuna not yaz. Şemanın TEK üreticisi.
 * @returns {{file:string, path:string, tip:string, kaynak:string}}
 * @throws {Error} geçersiz alan (çağıran kütüphane olarak import ettiyse yakalar)
 */
export function gelenYaz({ text, tip, proje, oncelik, kaynak } = {}) {
  if (typeof text !== "string" || !text.trim()) throw new Error("text gerekli");
  const t = tip == null || tip === "" ? VARSAYILAN_TIP : String(tip);
  if (!TIPLER.includes(t)) throw new Error(`geçersiz tip: ${t} (geçerli: ${TIPLER.join(" | ")})`);
  const k = kaynak == null || kaynak === "" ? VARSAYILAN_KAYNAK : String(kaynak);
  if (!KAYNAKLAR.includes(k)) throw new Error(`geçersiz kaynak: ${k} (geçerli: ${KAYNAKLAR.join(" | ")})`);
  let o = null;
  if (oncelik != null && oncelik !== "") {
    o = String(oncelik);
    if (!ONCELIKLER.includes(o)) throw new Error(`geçersiz oncelik: ${o} (geçerli: ${ONCELIKLER.join(" | ")})`);
  }
  // proje: serbest cwd; yalnız tek-satıra indirilir (frontmatter satır-tabanlı).
  const pj = typeof proje === "string" && proje.trim() ? proje.trim().split("\n")[0] : null;

  const now = new Date();
  const file = dosyaAdi(now);
  // PM ölüyken yazılan not FRONTMATTER'DA DAMGALANIR: sonra kutuyu okuyan (insan ya da PM)
  // "bu not hangi koşulda düştü" sorusunu dosyanın kendisinden yanıtlar. Damga yalnız
  // gerçekten bekleyen notta bulunur — temiz durumda frontmatter değişmez (şema additive).
  const pm = pmDurumu();
  const md = [
    "---",
    `tip: ${t}`,
    ...(pj ? [`proje: ${pj}`] : []),
    ...(o ? [`oncelik: ${o}`] : []),
    `kaynak: ${k}`,
    `ts: ${now.toISOString()}`,
    ...(pm.bekliyor ? [`pm_bekliyor: true`, `pm_son_kosum: ${pm.sonKosum}`] : []),
    "---",
    "",
    text.trim(),
    "",
  ].join("\n");

  mkdirSync(GELEN_DIR, { recursive: true });
  const target = join(GELEN_DIR, file);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, md);
  renameSync(tmp, target);            // atomik: yarım not PM koşumuna görünmez
  // Kuyruk sayısı BU notu da içerir: yazana "kaçıncı sıradasın" söylenir. `pmDurumu()` yazımdan
  // önce ölçüldüğü için (damga kararı ona bağlı) burada +1 ile tazelenir.
  return { file, path: target, tip: t, kaynak: k, pm: { ...pm, kuyruk: pm.kuyruk + 1 } };
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const isMain = (() => {
  try { return !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]); }
  catch { return false; }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opt = (n, fb = null) => {
    const i = argv.indexOf(`--${n}`);
    return i > -1 ? argv[i + 1] ?? fb : fb;
  };

  if (cmd === "add") {
    let r;
    try {
      r = gelenYaz({
        text: opt("text"),
        tip: opt("tip"),
        proje: opt("proje"),
        oncelik: opt("oncelik"),
        kaynak: opt("kaynak", VARSAYILAN_KAYNAK),
      });
    } catch (e) {
      hata(String(e?.message || e));
    }
    if (argv.includes("--json")) console.log(JSON.stringify({ ok: true, ...r }));
    else {
      console.log(`gelen kutusuna bırakıldı: ${r.file}  (tip: ${r.tip} · kaynak: ${r.kaynak})`);
      // "bir sonraki PM koşumu işler" ancak PM KOŞUYORSA doğrudur — yoksa bu cümle notu
      // yazanı yanıltır ve kutu sessizce dolar (2026-07-27: 104 not, PM 5 gündür ölü).
      if (r.pm.bekliyor) {
        console.error(
          `⚠ PM ${r.pm.saat} SAATTİR KOŞMADI (eşik ${r.pm.esikSaat}sa) — bu not İŞLENMEYECEK, kuyrukta bekleyecek.\n` +
          `  kuyruk: ${r.pm.kuyruk} işlenmemiş not · son PM koşumu: ${r.pm.sonKosum}\n` +
          `  onar: rutini kontrol et (aide zamanla list → pm-rutin) · sistem kapalıysa: aide sistem durum`,
        );
      } else {
        console.log("bir sonraki PM koşumu işler (P0.75).");
      }
    }
  } else {
    console.error(
      'komut: add --text "<metin>" [--tip ' + TIPLER.join("|") + "] [--proje <cwd>] " +
      "[--oncelik " + ONCELIKLER.join("|") + "] [--kaynak " + KAYNAKLAR.join("|") + "] [--json]",
    );
    process.exit(1);
  }
}
