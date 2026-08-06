#!/usr/bin/env node
/**
 * kaptan GÖREV PANOSU — minimal web dashboard (model.mjs üzerine katman).
 *
 * GÖREV/NABIZ/EPİK MODELİ SALT-OKUNUR türetilir (o tarafa yazma YOK — değişmedi):
 * /api/state → buildModel(), model.json cache'ini ATLAR → görünüm her zaman taze.
 *
 * PM SEKMESİ üç DAR kullanıcı-kalemi yazma yüzeyi ekler (pano yazar DEĞİL,
 * kullanıcının kalemidir; emsal: writeOpenRequest → csm-open-requests):
 *   · POST /api/pm/gelen  → ~/.claude/pm/gelen/ (kullanıcı sesi; PM işler)
 *   · POST /api/pm/doc    → yalnız ~/.claude/pm/** ve ~/.claude/docs/** altındaki .md
 *     (safeDocPath beyaz-listesi + mtime iyimser eşzamanlılık; sessiz ezme yasak)
 *   · POST /api/pm/vizyon → vizyon.md §Varılmak istenen nokta'ya damgalı APPEND
 *     (üst-hedefe gelen kutusundan nasıl ekleniyorsa vizyona da buradan; PM koşumu
 *      BEKLENMEZ. Yalnız kullanıcı bölgesine yazar → PM'in §Rota'sıyla çakışmaz.)
 *   · POST /api/pm/ayar   → PM kadranı (mod/frekans/paralel/günlük tavan). Pano ayar.json'a
 *     DOĞRUDAN YAZMAZ: ayar.mjs'i ÇAĞIRIR → tek-yazar ilkesi kod-yolu düzeyinde korunur
 *     (aynı tek yazara `aide pm ayar` ve session içi /pm de iner).
 *   · POST /api/pm/onay   → 🔴 ONAY (SP7/F3). Pano job'a dokunmaz; TEK KAPIYI çağırır:
 *     `aide zamanla run-now <id>`. --force YOK. UI iki adımlı (silahlan → ateşle) ki yanlışlıkla
 *     geri alınamaz iş ateşlenmesin. Onay yalnız İNSAN tıklamasıyla; PM kendi kırmızı işini
 *     onaylayamaz (SKILL yasağı + kodda ikinci kapı bilinçli yok).
 *   · POST /api/pm/reddet → ⊘ İNSAN REDDİ + GERİ BİLDİRİM. Pano deftere yazmaz; TEK YAZARI
 *     çağırır: `dispatch.mjs reddet <fp> --geri-bildirim "…"`. Defteri `reddedildi` ile
 *     kapatır VE geri bildirimi PM'in gelen kutusuna yazar → PM DÜZELTİLMİŞ işi dağıtır
 *     (kör tekrar değil). Gerekçesiz red yoktur (boş geri bildirim reddedilir).
 *
 * PM ekranının AKSİYON KATMANI (salt-okur, kadansın altı / gelen kutusunun üstü) iki
 * TEK SEÇİCİDEN türetilir — pano kendi sınıflandırıcısını yazmaz, ikinci kopya tutmaz:
 *   · 🔴 onay bekleyen + ⚠ takılan ← `aide zamanla onay-list --json` (maestro/lib/approval.mjs)
 *   · 🟡 doğrulanmadı (dağıtıldı, kanıtı gelmedi) ← `dispatch.mjs durum --dry-run`
 *     (--dry-run ZORUNLU: dry-run olmadan bu komut PM defterini mutasyona uğratır)
 *   · 🔎 sonuç incelemesi (makine kanıtı geldi, İNSAN yargısı gelmedi) ← defterin son N
 *     dağıtımının `dogrulandi` olanları (SALT-OKUR dosya okuması — türetilecek bir şey yok)
 * 🟡 ONAY DEĞİLDİR: düğmesi yoktur, işi kanıt kapatır. ⚠ takılan da onay değildir: onarım ister.
 * 🔎 de onay değildir: iş ZATEN bitti — kabul EYLEMSİZLİKTİR, tek düğme REDdir.
 * Şema sözleşmesi: gelen-notu frontmatter'ı + vizyon iskeleti PM SKILL ("Gelen kutusu
 * notu" / "Vizyon dokümanı") ile rule-symmetric aynadır — değişirse İKİ YERİ güncelle.
 *
 * Kapsam SERVER-side (`?project=<cwd>` → cwd-prefix; alt-dizinler ana projeye katlanır).
 * Görünüm ayarları (sekme / sıralama / tamamlananlar / son X gün) CLIENT-side + localStorage.
 * TEK-EKRAN: `?only=pm` / `?only=gorev` sekme çubuğunu gizler ve o yüzeye kilitler —
 * VSCode eklentisi Görevler ile PM'i AYRI view olarak iframe'leyebilsin diye.
 *
 *   node dashboard.mjs [--port 4180] [--pm]   ·   env KAPTAN_DASH_PORT
 * /api/state[?project=<cwd>] → JSON · /?host=vscode&project=<cwd>[&tab=pm|&only=pm] → HTML
 *
 * Tıkla-git: VSCode iframe'inde `window.parent.postMessage` ile session açılır;
 * düz tarayıcıda `claude --resume <id>` panoya kopyalanır.
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { basename, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, unlinkSync,
  statSync, renameSync, realpathSync,
} from "node:fs";
import {
  buildModel, listProjects, slugOf, SCHEMA_VERSION,
  STATUS_META, KATEGORI_META, KIND_META, EPIC_KATEGORILER,
} from "./model.mjs";
// Plan Ağı haritası — TEK kaynak plan-organizatoru (agac --graf + kosucu durum); pano yalnız sunar (Ders 2).
import { grafVerisi, haritaHtml } from "../../plan-organizatoru/scripts/harita.mjs";

const TASK_CAP = 60; // epic başına client'a giden task sayısı

const CLAUDE = join(homedir(), ".claude");
const SESSIONS_DIR = join(CLAUDE, "sessions");           // canlı registry (entrypoint + pid)
const TRANSCRIPTS = join(CLAUDE, "projects");            // <slug>/<sid>.jsonl
const GOALS_DIR = join(CLAUDE, "kaptan", "goals");
const OPEN_REQ_DIR = join(CLAUDE, "csm-open-requests");  // VSCode eklentisi izler
const PM_GOALS = join(CLAUDE, "pm", "hedefler.json");    // PM üst-hedefleri (epic'lerin ÜSTÜNDE)
const PM_DIR = join(CLAUDE, "pm");
const GELEN_DIR = join(PM_DIR, "gelen");                 // kullanıcı → PM gelen kutusu
const DOCS_DIR = join(CLAUDE, "docs");
const HEDEFLER_DIR = join(CLAUDE, "kaptan", "hedefler"); // proje hedefleri (model.mjs roll-up)
const AIDE_BIN = [join(homedir(), ".bun", "bin", "aide"), "/usr/local/bin/aide", "aide"]
  .find((p) => p === "aide" || existsSync(p));
// "şimdi işle" düğmesi için zamanla CLI keşfi — bulunamazsa düğme hiç görünmez (maestroVar:false)
const ZAMANLA = [join(homedir(), "dev", "agent-ide", "packages", "maestro", "bin", "zamanla.mjs")]
  .find((p) => existsSync(p)) || null;
const BUN_BIN = [join(homedir(), ".bun", "bin", "bun"), "/usr/local/bin/bun", "/opt/homebrew/bin/bun"]
  .find((p) => existsSync(p)) || "bun";
// Yük göstergesinin çekirdeğine TEK çıkış: `aide yuk --json` (core/src/yuk.ts).
// Pano kendi hesabını YAPMAZ — salt-okur doktrini; hesap tek yerde (Ders 2).
// Bulunamazsa Yük sekmesi hiç basılmaz (yukVar:false) — ölü buton bırakma.
const AIDE_CLI = [join(homedir(), "dev", "agent-ide", "packages", "tui-v3", "src", "cli.ts")]
  .find((p) => existsSync(p)) || null;
// tmux mutlak yoldan çözülür: pano launchd/daemon altında koşabilir, PATH minimal olur.
const TMUX_BIN = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"]
  .find((p) => existsSync(p)) || "tmux";
const TMUX_SESSION = "aide"; // core/model.ts ile aynı sabit (soket -L aide, oturum aide)
// PM kadranının TEK YAZARI. Pano ayar.json'a asla doğrudan yazmaz — bu script'i çağırır.
const AYAR_MJS = join(CLAUDE, "skills", "pm", "scripts", "ayar.mjs");
// Gelen-notu şemasının TEK KOD-YOLU. Pano şemayı bilmez — bu script'i çağırır (kaynak: pano).
const GELEN_MJS = join(CLAUDE, "skills", "pm", "scripts", "gelen.mjs");
// 🟡 "doğrulanmadı" kademesinin TEK SEÇİCİSİ (PM defteri) + İNSAN REDDİNİN TEK YAZARI.
// Pano defteri SALT-OKUR (aşağıdaki LEDGER); deftere YAZAN tek kod-yolu bu script'tir.
const DISPATCH_MJS = join(CLAUDE, "skills", "pm", "scripts", "dispatch.mjs");
// PM dağıtım defteri — 🔎 "sonuç incelemesi" bölümü BURADAN türer (salt-okur).
// `durum --dry-run` bunu VEREMEZ: o yalnız AÇIK dağıtımları mutabakatlar; zaten
// `dogrulandi` ile KAPANMIŞ satırlar çıktısında yoktur. İncelenecek olan tam da onlar.
const LEDGER = join(PM_DIR, "dispatched.jsonl");

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

// Maestro iş dizini — CANLI rutin işin kadansını okumak için (U2). Çözümleme sırası
// maestro/config.json ile AYNI: env → config.jobs_dir → repo kökü/jobs.
const JOBS_DIR = process.env.MAESTRO_JOBS_DIR
  || readJSON(join(homedir(), "dev", "agent-ide", "packages", "maestro", "config.json"))?.jobs_dir
  || join(homedir(), "dev", "agent-ide", "jobs");

/**
 * U2 — KADANS/RUTİN AYRIŞMASI. `ayar.mjs set` frekansı `--apply` OLMADAN yazarsa ayar.json
 * "30m" der ama CANLI rutin iş 2h'de koşmaya DEVAM eder; hiçbir yüzey bunu göstermezdi
 * (ekran yalan söyler). Pano ayrışmayı ÖLÇER — job.json'dan SALT-OKUR (tek yazar zamanla/
 * ayar.mjs; pano job.json'a asla dokunmaz).
 *
 * Dönen: null (rutinJobId yok) · { mevcut:false } (iş silinmiş) · { mevcut:true, frekans, state }
 */
function rutinCanli(rutinJobId) {
  const id = String(rutinJobId ?? "");
  if (!id) return null;
  const job = readJSON(join(JOBS_DIR, id, "job.json"));
  if (!job) return { mevcut: false, frekans: null, state: null };
  const st = readJSON(join(JOBS_DIR, id, "state.json"));
  return {
    mevcut: true,
    frekans: job?.trigger?.every?.interval ?? null,
    state: st?.state ?? null,
  };
}

// ── PM sekmesi yardımcıları ──────────────────────────────────────────────────

/** Yazma/okuma beyaz-listesi: yalnız ~/.claude/pm/** ve ~/.claude/docs/** altındaki .md.
 *  Symlink kaçışına karşı gerçek yol doğrulanır; path traversal resolve ile ölür. */
const WRITE_ROOTS = [PM_DIR, DOCS_DIR];
function safeDocPath(rel) {
  if (typeof rel !== "string" || !rel) throw new Error("path gerekli");
  const abs = resolve(CLAUDE, rel);
  const real = existsSync(abs) ? realpathSync(abs) : abs; // yeni dosya: henüz realpath'i yok
  if (!WRITE_ROOTS.some((r) => real === r || real.startsWith(r + sep))) throw new Error("yol kapsam dışı");
  if (!real.endsWith(".md")) throw new Error("yalnız .md");
  return real;
}

/** PLAN dosyası okuma kapısı — SALT-OKUNUR, `safeDocPath`ten AYRI.
 *  Neden ayrı: safeDocPath ~/.claude köküne resolve eder ve WRITE_ROOTS'a yazma da
 *  açar. Plan dosyaları PROJE dizinlerinde yaşar; onları WRITE_ROOTS'a eklemek
 *  panoya proje kaynağına YAZMA yetkisi verirdi (pano salt-okur — doktrin).
 *  Kapsam ELLE LİSTE DEĞİL, ÖLÇÜMDEN türer (Ders 15/17): dizin ancak `plans/INDEX.json`
 *  taşıyorsa "plan projesi"dir — proje kendini ilan eder, biz ad saymayız.
 *  Traversal: resolve + realpath + prefix; `.md` zorunlu; yol `plans/` altında olmalı. */
function safePlanPath(cwd, rel) {
  if (typeof cwd !== "string" || !cwd) throw new Error("cwd gerekli");
  if (typeof rel !== "string" || !rel) throw new Error("path gerekli");
  const kok = resolve(cwd);
  if (!existsSync(join(kok, "plans", "INDEX.json"))) throw new Error("plan projesi değil");
  const plansKok = realpathSync(join(kok, "plans"));
  const abs = resolve(kok, rel);
  if (!existsSync(abs)) throw new Error("dosya yok");
  const real = realpathSync(abs);
  if (real !== plansKok && !real.startsWith(plansKok + sep)) throw new Error("yol kapsam dışı");
  if (!real.endsWith(".md")) throw new Error("yalnız .md");
  return real;
}

/** POST gövdesini oku (16KB tavan — kapasite ayarı küçük JSON). */
function govdeOku(req, tavan = 16384) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > tavan) { req.destroy(); reject(new Error("gövde çok büyük")); } });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/** Atomik yazım (tmp + rename) — veri-yuzeyleri sözleşmesi. */
function atomicWrite(target, content) {
  mkdirSync(join(target, ".."), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, target);
}

/** DNS-rebinding'e ucuz sigorta: yazma istekleri yalnız loopback Host'la. */
function hostOk(req) {
  const h = String(req.headers.host || "").split(":")[0];
  return h === "127.0.0.1" || h === "localhost";
}

/** CSRF kapısı: yazma isteği `application/json` OLMALI.
 *  Neden yeterli: tarayıcının "basit istek" (simple request) muafiyeti yalnız
 *  text/plain · form-urlencoded · multipart içindir. `application/json` şartı
 *  preflight'ı ZORUNLU kılar; preflight'ı da CORS reddeder (pano CORS başlığı
 *  yaymaz) → başka bir sekmedeki kötü niyetli sayfa pano açıkken `POST /api/pm/gelen`
 *  ile SAHTE "kullanıcı sesi" notu bırakamaz. (Host kapısı tek başına bunu durdurmaz:
 *  kurbanın tarayıcısı Host'u zaten 127.0.0.1 yazar.) */
function ctOk(req) {
  return /^application\/json\b/i.test(String(req.headers["content-type"] || ""));
}

/** Gelen-notu frontmatter'ının TOLERANSLI okunması (yalnız özet/rozet için). */
function parseGelenMeta(md) {
  const out = {};
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (m) for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  out._govde = md.slice(m ? m[0].length : 0).trim();
  return out;
}

/** .md dosyalarını derinlik sınırıyla listele (görece yol, CLAUDE köküne göre). */
function listMd(rootAbs, relPrefix, depth = 3) {
  const out = [];
  const walk = (dir, rel, d) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) { if (d < depth) walk(join(dir, e.name), `${rel}/${e.name}`, d + 1); }
      else if (e.name.endsWith(".md")) out.push(`${rel}/${e.name}`);
    }
  };
  walk(rootAbs, relPrefix, 1);
  return out.sort();
}

/** PM sekmesinin tek veri kaynağı. */
function pmState() {
  const gelen = [], islenen = [];
  try {
    for (const f of readdirSync(GELEN_DIR).sort().reverse()) {
      if (!f.endsWith(".md")) continue;
      const meta = parseGelenMeta(readFileSync(join(GELEN_DIR, f), "utf8"));
      gelen.push({ file: f, ts: meta.ts || null, tip: meta.tip || "direktif", proje: meta.proje || null,
        oncelik: meta.oncelik || null, kaynak: meta.kaynak || null, ozet: meta._govde.slice(0, 120) });
    }
  } catch { /* gelen/ henüz yok */ }
  try {
    const dir = join(GELEN_DIR, "islenen");
    for (const f of readdirSync(dir).sort().reverse().slice(0, 5)) {
      if (!f.endsWith(".md")) continue;
      const meta = parseGelenMeta(readFileSync(join(dir, f), "utf8"));
      islenen.push({ file: f, tip: meta.tip || "direktif", islendi: meta.islendi || null,
        sonuc: meta.sonuc || null, ozet: meta._govde.slice(0, 120) });
    }
  } catch { /* islenen/ henüz yok */ }

  const projeHedefleri = [];
  try {
    for (const f of readdirSync(HEDEFLER_DIR).sort()) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      const o = readJSON(join(HEDEFLER_DIR, f));
      if (Array.isArray(o?.hedefler)) projeHedefleri.push({ slug: f.slice(0, -5), hedefler: o.hedefler });
    }
  } catch { /* hedefler/ henüz yok */ }

  // Vizyon listesi: var olanlar + proje profili olan her slug için "oluşturulabilir" girdi.
  const vizyon = [{ path: "pm/vizyon.md", kapsam: "portföy", var: existsSync(join(PM_DIR, "vizyon.md")) }];
  try {
    for (const slug of readdirSync(join(PM_DIR, "projeler")).sort()) {
      const p = join(PM_DIR, "projeler", slug, "vizyon.md");
      vizyon.push({ path: `pm/projeler/${slug}/vizyon.md`, kapsam: slug, var: existsSync(p) });
    }
  } catch { /* projeler/ yok */ }

  let brifing = null;
  try {
    // "En son brifing" MTIME'a göre seçilir, dosya ADINA göre DEĞİL. Ad bir LLM tarafından
    // konur ve yalan söyleyebilir: kanıtlı olay (2026-07-13) — 07:07'de yazılan brifing
    // `2026-07-13-2115d.md` diye adlandırıldı; ad sıralaması bayat dosyayı "en yeni" gösterdi.
    // Dosya sisteminin mtime'ı uydurulamaz. (Adların dürüstlüğü ayrı kapıdır: PM SKILL §3.)
    const dir = join(PM_DIR, "brifing");
    const bs = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ f, mt: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => a.mt - b.mt);
    if (bs.length) {
      const son = bs[bs.length - 1].f;
      brifing = { file: son, path: `pm/brifing/${son}` };
    }
  } catch { /* brifing/ yok */ }

  // 🔴/🟡 aksiyon katmanı — türetilir, ikinci kopya tutulmaz (tek seçici çağrılır).
  const q = onayOku();

  // U2: kadranın YANINA canlı rutin işin gerçek kadansı iliştirilir. Pano KARAR VERMEZ,
  // yalnız iki gerçeği yan yana koyar (ayar.json ne diyor · rutin iş ne yapıyor) — ayrışma
  // varsa istemci görünür uyarı basar. ayar.json'a yazılmaz (salt-okur türetme).
  const ayar = ayarOku();
  if (ayar && ayar.kadans) ayar.rutinCanli = rutinCanli(ayar.rutinJobId);

  return {
    gelen, islenen,
    ustHedefler: readPmGoals(null),
    projeHedefleri,
    vizyon,
    docs: listMd(DOCS_DIR, "docs", 3),
    brifing,
    maestroVar: !!ZAMANLA,
    ayar,              // kadran (mod/frekans/paralel/tavan) — yazma yolu: POST /api/pm/ayar
    onay: q.onay,                       // 🔴 insan onayı bekliyor → POST /api/pm/onay
    onaylanan: q.onaylanan,             // ✔ onaylandı, daemon ateşlemeyi bekliyor (DÜĞMESİZ)
    takilan: q.takilan,                 // ⚠ park/fail — onay DEĞİL, onarım ister
    dogrulanmamis: dogrulanmamisOku(),  // 🟡 dağıtıldı, kanıtı gelmedi (onay değil)
    incelenecek: incelenecekOku(),      // 🔎 makine kanıtı geldi — İNSAN yargısı gelmedi
  };
}

/** Gelen kutusuna not yaz — pano ŞEMAYI BİLMEZ, tek kod-yolunu (gelen.mjs) çağırır.
 *  ayar.mjs deseninin aynısı: dosya adını SCRIPT üretir (istemci path veremez), enum
 *  doğrulaması gelen.mjs'te, hata metni olduğu gibi yansıtılır. `kaynak: pano` sabittir. */
function gelenYaz(b) {
  if (!existsSync(GELEN_MJS)) return Promise.resolve({ ok: false, error: "gelen.mjs bulunamadı" });
  const args = ["add", "--kaynak", "pano", "--json", "--text", String(b?.text ?? "")];
  if (b?.tip != null) args.push("--tip", String(b.tip));
  if (b?.proje) args.push("--proje", String(b.proje));
  if (b?.oncelik) args.push("--oncelik", String(b.oncelik));
  return new Promise((resolveP) => {
    const cp = spawn(process.execPath, [GELEN_MJS, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (err += d));
    cp.on("error", () => resolveP({ ok: false, error: "gelen.mjs koşulamadı" }));
    cp.on("close", (code) => {
      if (code !== 0) return resolveP({ ok: false, error: err.trim() || `gelen.mjs exit ${code}` });
      try { return resolveP(JSON.parse(out)); } catch { return resolveP({ ok: false, error: "gelen.mjs çıktısı okunamadı" }); }
    });
  });
}

/** Graf notu yaz — `gelenYaz` deseninin ikizi. Pano ÇAPA GRAMERİNİ ve not dosya biçimini
 *  BİLMEZ: `aide graf not ekle --json`u spawn eder, hükmü (geçersiz çapa · boş gövde) CLI
 *  verir (aşama 33'ün TEK kod-yolu `notYaz`). `kaynak: pano` SUNUCUDA sabittir — istemci
 *  kaynak bildiremez. Kullanıcı girdisi ayrı argv elemanıdır, kabuk YOK: çapadaki `|`
 *  (kenar grameri) ya da gövdedeki tırnak sorun değil. */
function grafNotYaz(b) {
  if (!AIDE_CLI) return Promise.resolve({ ok: false, error: "aide CLI yok" });
  const args = [
    "graf", "not", "ekle",
    "--capa", String(b?.capa ?? ""),
    "--metin", String(b?.metin ?? ""),
    "--kaynak", "pano",
    "--json",
  ];
  if (b?.tip != null) args.push("--tip", String(b.tip));
  if (b?.proje) args.push("--proje", String(b.proje));
  return new Promise((resolveP) => {
    const cp = spawn(BUN_BIN, [AIDE_CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (err += d));
    cp.on("error", () => resolveP({ ok: false, error: "aide graf not koşulamadı" }));
    cp.on("close", (code) => {
      if (code !== 0) return resolveP({ ok: false, error: err.trim() || `aide graf not exit ${code}` });
      try { return resolveP({ ok: true, ...JSON.parse(out) }); }
      catch { return resolveP({ ok: false, error: "aide graf not çıktısı okunamadı" }); }
    });
  });
}

const VIZYON_USER_H = "## Varılmak istenen nokta";
const VIZYON_PM_H = "## Rota / mevcut durum";

/** Vizyon iskeleti — PM SKILL "Vizyon dokümanı" şablonuyla rule-symmetric ayna.
 *  İki bölge: §Varılmak istenen (KULLANICI SESİ, PM budamaz) + §Rota (PM bölgesi). */
function vizyonIskelet(kapsam) {
  return [
    `# Vizyon — ${kapsam}`,
    "",
    VIZYON_USER_H,
    "<!-- KULLANICI SESİ — PM bu bölümü ASLA yeniden yazmaz/silmez/budamaz.",
    "     Panodan eklenen her ifade damgalı APPEND olarak buraya düşer. -->",
    "",
    VIZYON_PM_H,
    "<!-- PM BÖLGESİ — her koşumda serbestçe yeniden yazılabilir. -->",
    "(PM ilk koşumda dolduracak.)",
    "",
  ].join("\n");
}

/**
 * Vizyona EKLE — panonun ikinci dar kullanıcı-kalemi yüzeyi (üst-hedef ekleme gelen
 * kutusundan nasıl yapılıyorsa, vizyon eklemesi de buradan; PM koşumunu BEKLEMEZ).
 * Yazım YALNIZ §Varılmak istenen nokta bölümünün SONUNA damgalı satır olarak yapılır —
 * o bölge zaten kullanıcının; PM sözleşme gereği orayı asla budamaz. §Rota'ya (PM
 * bölgesi) ve gövdenin geri kalanına DOKUNULMAZ → PM ile yazar çakışması doğmaz.
 */
function vizyonEkle({ path: rel, text }) {
  if (!text || typeof text !== "string" || !text.trim()) throw new Error("text gerekli");
  const p = safeDocPath(rel);
  if (!p.endsWith(`${sep}vizyon.md`)) throw new Error("yalnız vizyon.md");
  const kapsam = rel.includes("/projeler/") ? rel.split("/projeler/")[1].split("/")[0] : "portföy";
  const vardi = existsSync(p);
  const cur = vardi ? readFileSync(p, "utf8") : vizyonIskelet(kapsam);
  const satir = `> [pano ${new Date().toISOString()}] ${text.trim().replace(/\s*\n\s*/g, " ")}`;

  const lines = cur.split("\n");
  const uIdx = lines.findIndex((l) => l.trim() === VIZYON_USER_H);
  if (uIdx < 0) throw new Error(`"${VIZYON_USER_H}" başlığı yok — dokümanı Düzenle ile onar`);
  // Bölgenin sonu = sonraki "## " başlığı (yoksa dosya sonu); sondaki boş satırları atla.
  let end = lines.findIndex((l, i) => i > uIdx && /^## /.test(l));
  if (end < 0) end = lines.length;
  let ins = end;
  while (ins > uIdx + 1 && lines[ins - 1].trim() === "") ins--;
  lines.splice(ins, 0, satir);
  atomicWrite(p, lines.join("\n"));
  return { path: rel, satir, olusturuldu: !vardi };
}

/** "Şimdi işle": kuyruğa pm-intake işi yaz (aide-bağımsız --new-cwd yolu; TCC-temiz).
 *  Dürüstlük: dönen mesaj "kuyruğa yazıldı" der — dispatched ≠ done. */
function simdiIsle() {
  if (!ZAMANLA) return { ok: false, error: "zamanla CLI bulunamadı" };
  return new Promise((resolveP) => {
    const cp = spawn(BUN_BIN, [ZAMANLA, "add",
      "--text", "/pm gelen kutusunu işle (yalnız P0+P0.5+P0.75; brifingi kısa bas)",
      // cwd ~/.claude — EV DİZİNİ DEĞİL. Ev dizini `hasTrustDialogAccepted:false`; orada
      // doğan oturum trust dialogunda donar, isIdle onu (haklı olarak) meşgul sayar ve iş
      // ASLA enjekte edilmez → "şimdi işle"ye basarsın, sessizce hiçbir şey olmaz.
      // Bu tam olarak PM rutinini 15 saat sessizce öldüren tuzaktır (SP7 §7.1). Tek kaynak:
      // rutin de `~/.claude`'da doğar (pm/scripts/ayar.mjs PM_CWD).
      "--new-cwd", join(homedir(), ".claude"), "--new-name", "pm-intake", "--at", "+5s", "--title", "pm-intake",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    cp.stdout.on("data", (d) => (out += d));
    cp.on("error", () => resolveP({ ok: false, error: "zamanla koşulamadı" }));
    cp.on("close", (code) => {
      if (code !== 0) return resolveP({ ok: false, error: `zamanla exit ${code}` });
      let id = null;
      try { id = JSON.parse(out).id ?? null; } catch { /* ham çıktı */ }
      resolveP({ ok: true, id, not: "kuyruğa yazıldı — metronom daemon kapalıysa enjekte edilmez (metronom.mjs start)" });
    });
  });
}

/** PM kadranını OKU — kanonik okuyucu ayar.mjs (dosya yoksa VARSAYILANI döndürür). */
function ayarOku() {
  if (!existsSync(AYAR_MJS)) return null;
  try {
    return JSON.parse(execFileSync(process.execPath, [AYAR_MJS, "get", "--json"],
      { encoding: "utf8", timeout: 10_000 }));
  } catch { return null; }
}

/** PM kadranını YAZ — pano ayar.json'a dokunmaz, TEK YAZAR ayar.mjs'i çağırır.
 *  Bayraklar beyaz-listeden kurulur (istemci ham argv gönderemez); doğrulama ayar.mjs'te. */
function ayarYaz(b) {
  if (!existsSync(AYAR_MJS)) return Promise.resolve({ ok: false, error: "ayar.mjs bulunamadı" });
  const args = ["set", "--kaynak", "pano"];
  if (b.frekans != null) args.push("--frekans", String(b.frekans));
  if (b.paralel != null) args.push("--paralel", String(b.paralel));
  if (b.gunlukTavan != null) args.push("--gunluk", String(b.gunlukTavan));
  if (b.mod != null) args.push("--mod", String(b.mod));
  if (b.apply) args.push("--apply");
  return new Promise((resolveP) => {
    const cp = spawn(process.execPath, [AYAR_MJS, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (err += d));
    cp.on("error", () => resolveP({ ok: false, error: "ayar.mjs koşulamadı" }));
    cp.on("close", (code) => {
      if (code !== 0) return resolveP({ ok: false, error: err.trim() || `ayar.mjs exit ${code}` });
      try { return resolveP(JSON.parse(out)); } catch { return resolveP({ ok: true }); }
    });
  });
}

/**
 * 🔴 ONAY KUYRUĞU — pano KENDİ sınıflandırıcısını YAZMAZ, tek seçiciyi çağırır:
 * `aide zamanla onay-list --json` → { onay:[…], takilan:[…] } (maestro/lib/approval.mjs).
 *   onay[]    = insan onayı bekleyen kırmızı iş; tek onay kapısı `aide zamanla run-now <id>`.
 *   takilan[] = park/fail; ONAY KUYRUĞU DEĞİL → onarım ister, panoda AYRI bölümde durur.
 * Salt-okur. Maestro yoksa/patlarsa boş kuyruk → pano PM kurulu olmadan da çalışır.
 */
function onayOku() {
  const bos = { onay: [], onaylanan: [], takilan: [] };
  if (!ZAMANLA) return bos;
  try {
    const q = JSON.parse(execFileSync(BUN_BIN, [ZAMANLA, "onay-list", "--json"],
      { encoding: "utf8", timeout: 15_000 }));
    const dizi = (x) => (Array.isArray(x) ? x : []);
    // onaylanan[]: insan onayladı, daemon henüz ateşlemedi. GÖSTERİLİR (yoksa "onayladım,
    // kayboldu" = sessiz ölüm) ama DÜĞMESİZ (yoksa çifte onay daveti). approval.mjs sözleşmesi.
    return { onay: dizi(q?.onay), onaylanan: dizi(q?.onaylanan), takilan: dizi(q?.takilan) };
  } catch { return bos; }
}

/**
 * 🟡 DOĞRULANMADI — dağıtıldı ama kanıtı gelmedi (akıbetsiz dağıtımlar).
 * Tek seçici: `dispatch.mjs durum` (PM defterinin kendi mutabakat çıktısı).
 *
 * ⚠ `--dry-run` ZORUNLU: dry-run OLMADAN `durum` defteri MUTASYONA UĞRATIR
 * (kapanan satırlar için appendLedger). Pano salt-okur bir yüzeydir; PM mutabakatını
 * kullanıcı adına KAPATAMAZ — o PM koşumunun işi (P1.5). Bu bayrağı kaldırma.
 *
 * `bekleyen` + `askida` = akıbeti belirlenmemiş. Her satır kendi `kademe`sini taşır
 * (🟡 sarı / 🟢 yeşil) — kırmızı zaten onay kuyruğunda, buraya düşmez.
 */
function dogrulanmamisOku() {
  if (!existsSync(DISPATCH_MJS)) return [];
  try {
    const d = JSON.parse(execFileSync(process.execPath, [DISPATCH_MJS, "durum", "--dry-run"],
      { encoding: "utf8", timeout: 15_000 }));
    const satir = (r, askida) => ({
      jobId: r.jobId ?? null,
      komut: String(r.komut ?? "").slice(0, 200),
      kademe: r.kademe ?? null,
      hedefProje: r.hedefProje ?? null,
      epic: r.epic ?? null,
      jobState: r.jobState ?? null,
      ts: r.ts ?? null,
      askida,
      yasSaat: r.yasSaat ?? null,
    });
    return [
      ...(Array.isArray(d?.askida) ? d.askida : []).map((r) => satir(r, true)),
      ...(Array.isArray(d?.bekleyen) ? d.bekleyen : []).map((r) => satir(r, false)),
    ];
  } catch { return []; }
}

/**
 * 🔎 SONUÇ İNCELEMESİ — "makine koştu dedi; DOĞRU mu koştu?"
 *
 * `dogrulandi` bir işin KOŞTUĞUNU söyler, İSTENEN şeyi yaptığını DEĞİL: worker testi koşup
 * PASS basabilir ama yanlış şeyi yapmış olabilir. Makine kanıtı ≠ insan yargısı. Panoda
 * tamamlanmış işi İNCELEYİP REDDEDECEK bir yer yoktu → kullanıcı ya sessizce kabul ediyor
 * ya her şeyi elle yeniden kuruyordu.
 *
 * Kaynak: defterin SON N dağıtımı (dağıtım = fingerprint+jobId; son satır kazanır) → içinden
 * `dogrulandi` olanlar. Bu SALT-OKUR bir dosya okumasıdır (dogrulanmamisOku dispatch.mjs'i
 * çağırır çünkü mutabakat TÜRETME ister; burada türetilecek bir şey yok — defter zaten yazmış).
 * Deftere YAZMA yalnız `dispatch.mjs reddet` spawn'ıyla olur (tek-yazar ilkesi).
 */
function incelenecekOku(n = 10) {
  let satirlar;
  try {
    satirlar = readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim());
  } catch { return []; } // defter yok → PM hiç dağıtmamış
  const son = new Map(); // `${fingerprint}:${jobId}` → SON satır (defter yalnız-ekle)
  for (const l of satirlar) {
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (!o?.fingerprint) continue;
    son.set(`${o.fingerprint}:${o.jobId ?? ""}`, o);
  }
  return [...son.values()]
    .sort((a, b) => (String(a.ts ?? "") < String(b.ts ?? "") ? 1 : -1))
    .slice(0, n)                                  // önce SON N dağıtım…
    .filter((r) => r.durum === "dogrulandi")      // …içinden makine kanıtı KAPATANLAR
    .map((r) => ({
      fingerprint: r.fingerprint,
      jobId: r.jobId ?? null,
      kademe: r.kademe ?? null,
      hedefProje: r.hedefProje ?? null,
      epic: r.epic ?? null,
      komut: String(r.komut ?? "").slice(0, 200),
      kanit: String(r.kanit ?? "").slice(0, 160),
      ts: r.ts ?? null,
    }));
}

/**
 * ⊘ İNSAN REDDİ — pano deftere DOKUNMAZ, TEK YAZARI çağırır: `dispatch.mjs reddet`.
 * (ayar.mjs/gelen.mjs deseninin aynısı: bayraklar beyaz-listeden kurulur, istemci ham argv
 * veremez; doğrulama script'te; stderr AYNEN yansıtılır.)
 *
 * İki şeyi birden yapar (dispatch.mjs): defteri `reddedildi` ile KAPATIR (Kapı 4b serbest)
 * ve geri bildirimi PM'in GELEN KUTUSUNA yazar → PM DÜZELTİLMİŞ işi dağıtır (yeni fingerprint).
 * Kör tekrar DEĞİLDİR. Gerekçesiz red YOKTUR: boş geri bildirim burada da reddedilir.
 */
function reddet(b) {
  if (!existsSync(DISPATCH_MJS)) return Promise.resolve({ ok: false, error: "dispatch.mjs bulunamadı" });
  const fp = String(b?.fingerprint ?? "").trim();
  const gb = String(b?.geriBildirim ?? "").trim();
  if (!/^[a-f0-9]{6,64}$/i.test(fp)) return Promise.resolve({ ok: false, error: "geçersiz fingerprint" });
  if (!gb) return Promise.resolve({ ok: false, error: "red gerekçesiz olamaz — geri bildirim yaz" });
  return new Promise((resolveP) => {
    const cp = spawn(process.execPath, [DISPATCH_MJS, "reddet", fp, "--geri-bildirim", gb],
      { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (err += d));
    cp.on("error", () => resolveP({ ok: false, error: "dispatch.mjs koşulamadı" }));
    cp.on("close", (code) => {
      if (code !== 0) return resolveP({ ok: false, error: err.trim() || `dispatch.mjs exit ${code}` });
      try { return resolveP(JSON.parse(out)); } catch { return resolveP({ ok: false, error: "dispatch.mjs çıktısı okunamadı" }); }
    });
  });
}

/**
 * ONAY EYLEMİ — TEK KAPI: `aide zamanla run-now <id>`. `--force` YOKTUR ve eklenmeyecek.
 * Pano bu kapıyı yalnız İNSAN tıklamasıyla (iki adımlı onay + loopback Host) çağırır;
 * kendi başına hiçbir kırmızı işi onaylamaz.
 * jobId beyaz-listeyle doğrulanır (spawn zaten kabuk açmaz — bu ikinci savunma hattı).
 */
function onayEt(jobId) {
  if (!ZAMANLA) return Promise.resolve({ ok: false, error: "zamanla CLI bulunamadı" });
  const id = String(jobId ?? "");
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return Promise.resolve({ ok: false, error: "geçersiz jobId" });
  return new Promise((resolveP) => {
    const cp = spawn(BUN_BIN, [ZAMANLA, "run-now", id], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (err += d));
    cp.on("error", () => resolveP({ ok: false, error: "zamanla koşulamadı" }));
    cp.on("close", (code) => {
      if (code !== 0) return resolveP({ ok: false, error: err.trim() || `zamanla exit ${code}` });
      resolveP({ ok: true, id, mesaj: out.trim() || "onaylandı — sonraki tick ateşler" });
    });
  });
}

/**
 * PM üst-hedefleri (~/.claude/pm/hedefler.json). Kaptan'ın epic modeliyle aynı katmanda
 * DEĞİL, üstündedir — bu yüzden model.mjs'e karıştırılmaz, yalnız bu görünüm katmanı okur.
 * Dosya yoksa/bozuksa boş dizi: pano PM kurulu olmadan da çalışır.
 */
function readPmGoals(cwdPrefix) {
  const o = readJSON(PM_GOALS);
  const all = Array.isArray(o?.hedefler) ? o.hedefler : [];
  if (!cwdPrefix) return all;
  // Kapsam daraltıldıysa: hedefin projelerinden biri prefix altındaysa göster (kapsamsız hedef daima görünür).
  return all.filter((h) => {
    const ps = h?.kapsam?.projeler;
    return !Array.isArray(ps) || !ps.length || ps.some((p) => String(p).startsWith(cwdPrefix));
  });
}

/** aide tmux pane'lerinin pid'leri. tmux yoksa/oturum yoksa boş küme. */
function aidePanePids() {
  try {
    const out = execFileSync(
      TMUX_BIN,
      ["-L", TMUX_SESSION, "list-panes", "-s", "-t", TMUX_SESSION, "-F", "#{pane_pid}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(out.split("\n").map((x) => Number(x.trim())).filter(Boolean));
  } catch { return new Set(); }
}

/** pid -> ppid (tek ps çağrısı). */
function parentPids() {
  const map = new Map();
  try {
    const out = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) map.set(Number(m[1]), Number(m[2]));
    }
  } catch { /* yut */ }
  return map;
}

/** pid, bir aide tmux pane'inin soyundan mı geliyor? */
function livesInAidePane(pid) {
  if (!pid) return false;
  const panes = aidePanePids();
  if (!panes.size) return false;
  const parents = parentPids();
  let p = Number(pid);
  for (let hop = 0; p && p > 1 && hop < 10; hop++) {
    if (panes.has(p)) return true;
    p = parents.get(p);
  }
  return false;
}

/**
 * Session NEREDE yaşıyor? — açma hedefi bunu izler.
 *   'claude-vscode' → VSCode penceresi   ·   'cli' → aide/tmux
 *
 * ÖNCE tmux pane soyağacına bakılır, entrypoint damgasına DEĞİL: tmux sunucusu bir
 * VSCode entegre terminalinden doğduysa pane'ler TERM_PROGRAM=vscode ortamını miras
 * alır ve içlerindeki agent oturumları (_pm, _kaptan) kendilerini "claude-vscode"
 * damgalar. O damgaya uyup VSCode yoluna saparsak, tmux'ta ZATEN CANLI bir oturumu
 * VSCode'da ikinci kez açmaya çalışırız (çifte-yazar) — ya da hiçbir pencere isteği
 * kapmadığı için 1.5sn boşuna bekleyip aide'ye düşeriz. Pane soyağacı kesindir.
 * Sıra: canlı pane → canlı registry → nabız kaydı (backfill entrypoint taşır) → transcript başı.
 */
function sessionOrigin(sessionId, cwd) {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith(".json")) continue;
      const o = readJSON(join(SESSIONS_DIR, f));
      if (o?.sessionId === sessionId) {
        if (livesInAidePane(o.pid)) return "cli"; // tmux'ta yaşıyor → damga ne derse desin
        return o.entrypoint || o.kind || null;
      }
    }
  } catch { /* registry yok */ }

  const slug = cwd ? slugOf(cwd) : null;
  if (slug) {
    const rec = readJSON(join(GOALS_DIR, slug, `${sessionId}.json`));
    if (rec?.entrypoint) return rec.entrypoint;
    try {
      const head = readFileSync(join(TRANSCRIPTS, slug, `${sessionId}.jsonl`), "utf8").slice(0, 64 * 1024);
      for (const line of head.split("\n")) {
        const j = readJSON(line) ?? (() => { try { return JSON.parse(line); } catch { return null; } })();
        if (j?.entrypoint) return j.entrypoint;
      }
    } catch { /* transcript yok */ }
  }
  return null;
}

/** VSCode yolu: cross-window istek dosyası (eklentinin processOpenRequests'i kapar). */
function writeOpenRequest(sessionId, cwd) {
  mkdirSync(OPEN_REQ_DIR, { recursive: true });
  const name = `${Date.now()}-kaptan-${Math.random().toString(36).slice(2, 8)}.json`;
  const p = join(OPEN_REQ_DIR, name);
  writeFileSync(p, JSON.stringify({ sessionId, cwd, from: "kaptan-dashboard", ts: Date.now() }));
  return p;
}

/** aide yolu: tmux 'aide' oturumunda resume (fork=true → --fork-session ile çatalla). */
function aideOpen(sessionId, cwd, fork = false) {
  if (!AIDE_BIN) return false;
  try {
    const cp = spawn(AIDE_BIN, ["open", sessionId, ...(cwd ? ["--cwd", cwd] : []), ...(fork ? ["--fork"] : [])], {
      stdio: "ignore", detached: true,
    });
    cp.on("error", () => {});
    cp.unref();
    return true;
  } catch { return false; }
}

/**
 * Session'ı KAYNAĞINDA aç. VSCode kökenliyse istek dosyası bırakılır; ~1.5sn içinde
 * hiçbir pencere kapmazsa (dosya duruyorsa) aide'ye düşülür. cli kökenli → doğrudan aide.
 */
async function openSession(sessionId, cwd, fork = false) {
  // fork daima aide/tmux yolundan: VSCode open-request mekanizması fork bilmez,
  // ayrıca fork'un amacı kaynağa dokunmadan YENİ bir oturum doğurmaktır.
  if (fork) return { ok: aideOpen(sessionId, cwd, true), via: "aide (fork)", origin: "fork" };
  const origin = sessionOrigin(sessionId, cwd);
  if (origin === "cli") return { ok: aideOpen(sessionId, cwd), via: "aide", origin };

  const req = writeOpenRequest(sessionId, cwd); // vscode (veya bilinmiyor) → önce VSCode
  await new Promise((r) => setTimeout(r, 1500));
  if (!existsSync(req)) return { ok: true, via: "vscode", origin: origin || "?" };

  try { unlinkSync(req); } catch {}       // kimse kapmadı → temizle, aide'ye düş
  return { ok: aideOpen(sessionId, cwd), via: "aide (vscode penceresi yok)", origin: origin || "?" };
}

/** buildModel()'i pano şekline indirge (canlı, her istekte). */
function snapshot(cwdPrefix = null) {
  let model;
  try {
    model = buildModel(cwdPrefix ? { cwdPrefix } : {});
  } catch (e) {
    return { error: String(e?.message || e), at: new Date().toISOString(), projects: [], allProjects: [] };
  }

  // Not: istemci mapEpic'in İLETMEDİĞİNİ gösteremez. tags/kategori/amac/kunyeli
  // eskiden burada kırpılıyordu → panoda gruplama ve künye işareti hiç görünmüyordu.
  const mapEpic = (e, cwd) => {
    const openBy = {};
    for (const t of e.tasks) if (t.resolution === null) openBy[t.sessionId] = (openBy[t.sessionId] || 0) + 1;
    return {
      id: e.id,
      title: e.title,
      status: e.status,
      provisional: e.provisional,
      kunyeli: !!e.kunyeli,
      kategori: e.kategori || null,
      amac: e.amac || "",
      tags: e.tags || [],
      cwd, // tıkla-git hedefi: (cwd, sessionId) çifti — sessionId projeler-arası benzersiz DEĞİL
      progress: e.progress,
      firstActivity: e.firstActivity,
      lastActivity: e.lastActivity,
      staleDays: e.staleDays,
      sessions: (e.members || e.sessions.map((s) => ({ sessionId: s }))).map((m) => ({
        sessionId: m.sessionId,
        short: m.short || String(m.sessionId).slice(0, 8),
        rol: m.rol || null,
        openCount: openBy[m.sessionId] || 0,
      })),
      tasks: e.tasks
        .filter((t) => t.resolution === null || t.resolution === "completed")
        .slice(0, TASK_CAP)
        .map((t) => ({
          id: t.id, // satır-expand durum anahtarı (render tick'lerinde kalıcı)
          status: t.status, resolution: t.resolution,
          short: t.short || String(t.content).slice(0, 42),
          content: t.content, kind: t.kind || null,
          sessionId: t.sessionId,
          firstSeen: t.firstSeen || null, // görev ne zaman üretildi
          lastChange: t.lastChange || null,
        })),
    };
  };

  let projects;
  if (cwdPrefix && model.projects.length) {
    // Katlama: prefix altındaki tüm cwd'ler tek sanal projede; her epic kendi cwd'sini KORUR.
    const epics = model.projects.flatMap((p) => p.epics.map((e) => mapEpic(e, p.cwd)));
    const backlog = model.projects.flatMap((p) => p.backlog.filter((b) => b.status === "open"));
    const plans = model.projects.flatMap((p) => p.plans || []);
    projects = [{ slug: cwdPrefix, dirName: basename(cwdPrefix) || cwdPrefix, cwd: cwdPrefix, epics, backlog, plans }];
  } else {
    projects = model.projects.map((p) => ({
      slug: p.slug,
      dirName: p.dirName,
      cwd: p.cwd,
      epics: p.epics.map((e) => mapEpic(e, p.cwd)),
      backlog: p.backlog.filter((b) => b.status === "open").map((b) => ({ id: b.id, skill: b.skill, desc: b.desc, severity: b.severity })),
      plans: p.plans || [], // plan ağacı projeksiyonu (plans/INDEX.json → model.readPlans)
    }));
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    at: model.generatedAt,
    scope: cwdPrefix || null,
    projects,
    allProjects: listProjects(), // seçici: kapsam daralsa da tam liste
    pmGoals: readPmGoals(cwdPrefix), // görünüm alanı; model sözleşmesi değil → schemaVersion bump YOK
  };
}

function page() {
  const meta = JSON.stringify(STATUS_META); // tek kaynak: model.mjs
  const katMeta = JSON.stringify(KATEGORI_META);
  const kindMeta = JSON.stringify(KIND_META);
  const katOrder = JSON.stringify(EPIC_KATEGORILER);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kaptan — görev panosu</title>
<style>
  :root {
    --bg:#11111b; --panel:#181825; --fg:#cdd6f4; --fg-dim:#9399b2; --dim:#6c7086;
    --accent:#89b4fa; --border:#313244; --hover:#1e1e2e;
    --ok:#a6e3a1; --warn:#f9e2af; --err:#f38ba8;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#eff1f5; --panel:#fff; --fg:#4c4f69; --fg-dim:#5c5f77; --dim:#8c8fa1;
            --accent:#1e66f5; --border:#dce0e8; --hover:#e6e9ef;
            --ok:#40a02b; --warn:#df8e1d; --err:#d20f39; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 var(--sans);
         -webkit-font-smoothing:antialiased; }
  .mono { font-family:var(--mono); font-size:12px; letter-spacing:-.01em; }

  header { display:flex; align-items:center; gap:14px; padding:12px 20px; background:var(--bg);
           border-bottom:1px solid var(--border); position:sticky; top:0; z-index:3; flex-wrap:wrap; }
  .logo { background:var(--accent); color:var(--bg); font-weight:700; font-size:13px; padding:3px 10px; border-radius:6px; }
  .spacer { margin-left:auto; }
  select, button { font:inherit; font-size:13px; color:var(--fg); background:var(--panel);
    border:1px solid var(--border); border-radius:6px; padding:5px 9px; cursor:pointer; }
  select:hover, button:hover { border-color:var(--accent); }
  select:focus-visible, button:focus-visible, .row:focus-visible, .chip:focus-visible,
  .grp-h:focus-visible, .act:focus-visible, .sess-c:focus-visible, .sess-t:focus-visible,
  .head.tgl:focus-visible {
    outline:2px solid var(--accent); outline-offset:2px; }
  label.ck { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--fg-dim); cursor:pointer; }

  .bar { display:flex; align-items:center; gap:14px; padding:10px 20px; border-bottom:1px solid var(--border);
         flex-wrap:wrap; background:var(--bg); position:sticky; top:57px; z-index:2; }
  .bar .lbl { font-size:12px; color:var(--dim); }

  main { padding:20px; max-width:1000px; margin:0 auto; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:22px; }
  .card { border:1px solid var(--border); border-radius:10px; padding:10px 14px; min-width:104px; background:var(--panel); }
  .card .k { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:22px; font-weight:650; margin-top:2px; font-family:var(--mono); }

  .proj { margin-bottom:26px; }
  .proj > h2 { font-size:15px; font-weight:650; margin:0 0 10px; display:flex; align-items:baseline; gap:8px; }
  .proj > h2 .n { color:var(--dim); font-weight:400; font-size:12px; font-family:var(--mono); }

  .epic { border:1px solid var(--border); border-left:3px solid var(--border); border-radius:10px;
          background:var(--panel); padding:12px 14px; margin-bottom:10px; }
  .epic.is-active { border-left-color:var(--accent); }
  .epic.is-stale  { border-left-color:var(--warn); }
  .epic.is-done   { border-left-color:var(--ok); opacity:.72; }
  .epic.is-dropped{ border-left-color:var(--err); opacity:.6; }
  .epic .head { display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; }
  /* birden çok task'lı epic: başlık tıklanabilir → gövde aç/kapa (varsayılan kapalı) */
  .epic .head.tgl { cursor:pointer; margin:-4px -6px; padding:4px 6px; border-radius:6px; }
  .epic .head.tgl:hover { background:var(--hover); }
  .epic .epic-c { flex:0 0 auto; color:var(--dim); width:1em; }
  .epic .title { font-weight:600; font-size:15px; }
  .epic .badge { font-size:11px; padding:1px 7px; border-radius:20px; border:1px solid var(--border); color:var(--dim); }
  .epic .prog { color:var(--fg-dim); }
  .epic .meta { color:var(--dim); font-size:12px; margin-top:3px; display:flex; gap:10px; flex-wrap:wrap; }
  /* birden çok task'lı epic: başlık tıklanabilir → gövde aç/kapa (varsayılan kapalı) */
  .epic .head.tgl { cursor:pointer; margin:-4px -6px; padding:4px 6px; border-radius:6px; }
  .epic .head.tgl:hover { background:var(--hover); }
  .epic .epic-c { flex:0 0 auto; color:var(--dim); width:1em; }

  .st-active{color:var(--accent)} .st-stale{color:var(--warn)} .st-paused{color:var(--dim)}
  .st-done{color:var(--ok)} .st-dropped{color:var(--err)} .st-planned{color:var(--dim);font-style:italic}

  .tasks { margin-top:9px; display:flex; flex-direction:column; gap:1px; }
  .row { display:flex; align-items:baseline; gap:9px; padding:4px 8px 4px 6px; border-radius:6px;
         border-left:2px solid transparent; cursor:pointer; flex-wrap:wrap; }
  .row:hover { background:var(--hover); border-left-color:var(--accent); }
  .row .g { flex:0 0 auto; color:var(--dim); font-size:12px; }
  .row.doing .g { color:var(--accent); }
  .row.doing .txt { color:var(--fg); font-weight:550; }
  .row.done .txt { color:var(--dim); text-decoration:line-through; }
  .row .txt { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .sid { flex:0 0 auto; color:var(--dim); opacity:0; }
  .row:hover .sid { opacity:1; }
  /* kind glifi: durum glifinin yanında, sönük ve ikincil */
  .row .kind { flex:0 0 auto; color:var(--dim); font-size:11px; opacity:.7; }
  /* satır tıklanınca AYRINTI açılır: tam mesaj + üretim zamanı + eylemler.
     Oturum açma artık expanded içindeki AYRI butonlarda (data-sid) — satırın
     kendisi data-exp taşır (bkz. delege dinleyici sırası). */
  .row .car { flex:0 0 auto; color:var(--dim); font-size:11px; }
  .row .full { flex-basis:100%; display:none; white-space:normal; color:var(--fg-dim);
               font-size:13px; padding:3px 0 3px 24px; }
  .row.exp { background:var(--hover); border-left-color:var(--accent); }
  .row.exp .full { display:block; }
  .row.exp .txt { white-space:normal; overflow:visible; }
  .row .fmeta { color:var(--dim); font-size:12px; margin-top:6px; display:flex; gap:12px; flex-wrap:wrap; }
  .row .facts { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
  .row .act { font-size:12.5px; padding:4px 11px; border-radius:6px; }
  .row .act:hover { color:var(--accent); }

  /* PM üst-hedefleri — Kaptan epic'lerinin ÜSTÜNDE duran katman */
  .hedefler { margin-bottom:18px; }
  .hedefler h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim);
                 margin:0 0 8px; font-weight:600; }
  .hedef { border:1px solid var(--border); border-left:3px solid var(--dim); border-radius:8px;
           padding:9px 12px; margin-bottom:7px; background:var(--panel); }
  .hedef.hd-acik, .hedef.hd-ilerliyor { border-left-color:var(--accent); }
  .hedef.hd-tikandi { border-left-color:var(--warn); }
  .hedef.hd-kapandi { border-left-color:var(--ok); opacity:.7; }
  .hedef.hd-iptal   { border-left-color:var(--err); opacity:.6; }
  .hedef .hd-bas { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .hedef .hd-t { font-weight:600; }
  .hedef .hd-kosul { color:var(--dim); font-size:12px; margin-top:3px; }
  .hedef .hd-kosul b { color:var(--fg); font-weight:500; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .chip { border:1px solid var(--border); border-radius:20px; padding:2px 9px; color:var(--dim);
          cursor:pointer; background:transparent; }
  .chip:hover { border-color:var(--accent); color:var(--accent); }

  /* epic künyesi: amaç alt-başlığı + etiketler + kategori/künye işareti */
  .epic .amac { color:var(--fg-dim); font-size:13px; margin:2px 0 0 23px; }
  .epic .kbadge { flex:0 0 auto; font-size:13px; }
  .epic .kunye { color:var(--accent); font-size:11px; opacity:.75; }
  .tags { display:flex; gap:5px; flex-wrap:wrap; margin:6px 0 0 23px; }
  .tag { color:var(--dim); font-size:11px; border:1px solid var(--border); border-radius:12px; padding:0 7px; }

  /* durum/kategori grup başlıkları (gorunum.mjs + GORUNUM.md ile aynı zihinsel model) */
  .grp { margin-bottom:8px; }
  .grp-h { display:flex; align-items:center; gap:8px; padding:5px 4px; cursor:pointer; border-radius:6px;
           color:var(--fg-dim); font-size:12px; text-transform:uppercase; letter-spacing:.03em; }
  .grp-h:hover { background:var(--hover); }
  .grp-c { color:var(--dim); width:1em; }
  .grp-l { font-weight:600; }
  .grp-n { color:var(--dim); margin-left:auto; }
  .grp.col .grp-b { display:none; }

  /* çok-oturumlu epic içinde oturum alt-başlıkları */
  .tasks.grouped { gap:6px; }
  .sess-h { display:flex; align-items:baseline; gap:8px; padding:3px 6px; margin-top:4px;
            border-left:2px solid var(--border); color:var(--fg-dim); font-size:12px; }
  .sess-c { color:var(--dim); cursor:pointer; }
  .sess-t { cursor:pointer; }
  .sess-t:hover { color:var(--accent); }
  .sess-r { color:var(--dim); }
  .sess-n { color:var(--dim); margin-left:auto; }
  .sess.col .sess-b { display:none; }
  .sess-b { padding-left:6px; }

  .backlog { margin-top:14px; border-top:1px dashed var(--border); padding-top:10px; }
  .backlog .h { color:var(--dim); font-size:12px; margin-bottom:6px; }
  .bl { padding:2px 0; font-size:13.5px; color:var(--fg-dim); }

  .empty { color:var(--dim); }
  .err-banner { color:var(--err); border:1px solid var(--err); border-radius:8px; padding:9px 12px; margin-bottom:14px; }

  /* sekme şeridi (Görevler | PM) */
  .tabs { display:flex; gap:2px; border:1px solid var(--border); border-radius:8px; padding:2px; background:var(--panel); }
  .tab { border:0; background:transparent; color:var(--fg-dim); padding:4px 14px; border-radius:6px; font-size:13px; cursor:pointer; }
  .tab.on { background:var(--accent); color:var(--bg); font-weight:600; }
  .tab .bdg { background:var(--warn); color:var(--bg); border-radius:10px; padding:0 6px; font-size:11px; margin-left:5px; }

  /* PM sekmesi */
  #pmview { display:none; }
  .viz-ekle { margin:8px 0 10px; }
  .viz-ekle textarea { width:100%; box-sizing:border-box; }
  #pmview h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:18px 0 8px; font-weight:600; }
  .pm-box { border:1px solid var(--border); border-radius:10px; background:var(--panel); padding:12px 14px; margin-bottom:10px; }
  .pm-form { display:flex; flex-direction:column; gap:8px; }
  .pm-form textarea, .doc-edit textarea { font:13px/1.5 var(--mono); color:var(--fg); background:var(--bg);
    border:1px solid var(--border); border-radius:8px; padding:9px 11px; min-height:72px; resize:vertical; width:100%; }
  .pm-form .opts { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .pm-note { padding:6px 8px; border-radius:6px; border-left:2px solid var(--border); font-size:13px; }
  .pm-note .m { color:var(--dim); font-size:11.5px; }
  .pm-note.islenmis { opacity:.65; }
  /* U2: kadans uyarıları — apply gereksinimi (form) + ayar↔rutin ayrışması (canlı) */
  .kd-uyari { color:var(--warn); font-size:12px; font-weight:600; }
  .kd-ayrisma { color:var(--warn); border:1px solid var(--warn); border-radius:8px;
    padding:7px 10px; font-size:12.5px; font-weight:600; }
  /* U3: tek-ekran (?only=gorev) körlük bandı — kırmızı onay sekme çubuğunda görünmüyordu */
  .onay-bant { display:block; text-decoration:none; color:var(--err); border:1px solid var(--err);
    border-radius:8px; padding:8px 12px; margin-bottom:12px; font-size:13px; font-weight:600;
    background:color-mix(in srgb, var(--err) 10%, transparent); }
  .onay-bant:hover { background:color-mix(in srgb, var(--err) 18%, transparent); }
  /* kadans şeridi (PM kadranı) */
  #pm-kadans .kd { display:flex; gap:6px; align-items:center; color:var(--dim); font-size:12px; }
  #pm-kadans .kd input { font:12px/1.4 var(--mono); color:var(--fg); background:var(--bg);
    border:1px solid var(--border); border-radius:6px; padding:4px 6px; width:64px; }
  #pm-kadans .m { color:var(--dim); font-size:11.5px; }
  .ph-satir { display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; padding:3px 0; font-size:13.5px; }
  .ph-satir .pid { color:var(--dim); font-family:var(--mono); font-size:11.5px; }
  /* 🔴 onay kuyruğu · 🟡 doğrulanmadı · ⚠ takılan — aksiyon katmanı (gelen kutusunun ÜSTÜ) */
  .pm-box.kutu-onay { border-left:3px solid var(--err); }
  .pm-box.kutu-sari { border-left:3px solid var(--warn); }
  .pm-box.kutu-inceleme { border-left:3px solid var(--ok); }
  .btn-kabul { flex:0 0 auto; font-size:12.5px; padding:4px 11px; }
  .btn-red { flex:0 0 auto; border-color:var(--err); color:var(--err); font-size:12.5px; padding:4px 11px; }
  .btn-red:hover { background:var(--hover); }
  .red-form { flex:1 1 100%; display:flex; gap:6px; margin-top:6px; }
  .red-form textarea { flex:1; min-height:52px; font-family:var(--mono); font-size:12px; }
  .pm-box.kutu-takilan { border-left:3px solid var(--dim); font-size:13px; }
  .ak { display:flex; gap:9px; align-items:baseline; flex-wrap:wrap; padding:7px 0; border-top:1px solid var(--border); }
  .ak:first-of-type { border-top:0; padding-top:2px; }
  .ak .ak-g { flex:0 0 auto; }
  .ak .ak-b { flex:1; min-width:0; }
  .ak .ak-t { font-weight:600; }
  .ak .ak-n { color:var(--err); font-size:11.5px; margin-left:6px; }
  .ak .ak-c { font-family:var(--mono); font-size:11.5px; color:var(--fg-dim); word-break:break-all; margin-top:2px; }
  .ak .ak-m { color:var(--dim); font-size:11.5px; margin-top:2px; }
  .ak .ak-m b { color:var(--fg-dim); font-weight:500; }
  .btn-onay { flex:0 0 auto; border-color:var(--err); color:var(--err); font-size:12.5px; padding:4px 11px; }
  .btn-onay:hover { border-color:var(--err); background:var(--hover); }
  .btn-onay.arm { background:var(--err); color:var(--bg); border-color:var(--err); font-weight:650;
                  max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .aciklama { color:var(--dim); font-size:11.5px; margin-bottom:7px; }
  .ak .onaylandi { flex:0 0 auto; color:var(--ok); font-size:12.5px; }
  .tab .bdg.kirmizi { background:var(--err); }
  /* doküman paneli: sol liste + sağ görüntü/edit */
  .doc-wrap { display:flex; gap:12px; align-items:flex-start; }
  .doc-list { flex:0 0 240px; max-height:480px; overflow-y:auto; display:flex; flex-direction:column; gap:1px; }
  .doc-list .dh { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.05em; margin:8px 0 3px; }
  .doc-item { text-align:left; border:0; background:transparent; color:var(--fg-dim); padding:3px 8px; border-radius:6px;
    cursor:pointer; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .doc-item:hover { background:var(--hover); }
  .doc-item.on { background:var(--hover); color:var(--accent); }
  .doc-item.yok { font-style:italic; opacity:.6; }
  .doc-pane { flex:1; min-width:0; }
  .doc-view { border:1px solid var(--border); border-radius:8px; padding:12px 16px; background:var(--bg);
    max-height:480px; overflow-y:auto; font-size:14px; }
  .doc-view h1 { font-size:18px; } .doc-view h2 { font-size:15px; text-transform:none; letter-spacing:0; color:var(--fg); margin:14px 0 6px; }
  .doc-view h3 { font-size:14px; } .doc-view code { font-family:var(--mono); font-size:12px; background:var(--panel); padding:0 4px; border-radius:4px; }
  .doc-view pre { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:8px 10px; overflow-x:auto; }
  .doc-view blockquote { border-left:3px solid var(--border); margin:6px 0; padding:2px 10px; color:var(--fg-dim); }
  .doc-bar { display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
  .doc-bar .p { font-family:var(--mono); font-size:12px; color:var(--dim); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
  .conflict { color:var(--warn); border:1px solid var(--warn); border-radius:8px; padding:7px 10px; margin-bottom:8px; font-size:13px; }
  #toast { position:fixed; bottom:18px; left:50%; transform:translateX(-50%) translateY(20px);
    background:var(--accent); color:var(--bg); padding:7px 14px; border-radius:8px; font-size:13px;
    opacity:0; transition:.18s; pointer-events:none; }
  #toast.on { opacity:1; transform:translateX(-50%) translateY(0); }
  /* --- Yük sekmesi --- */
  .yuk-top { display:flex; align-items:center; gap:22px; flex-wrap:wrap; }
  .yuk-big { font-size:38px; font-weight:700; line-height:1.05; white-space:nowrap; }
  .yuk-big small { display:block; font-size:11px; font-weight:400; color:var(--dim); }
  .yuk-spark { display:flex; align-items:flex-end; gap:2px; height:44px; flex:1; min-width:180px; }
  .yuk-spark i { flex:1; background:var(--acc,#4a9); border-radius:1px 1px 0 0; min-height:1px; opacity:.75; }
  .yuk-meta { font-size:12px; color:var(--dim); text-align:right; white-space:nowrap; }
  .yuk-row { display:flex; align-items:center; gap:10px; padding:5px 0; font-size:13px; }
  .yuk-row .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .yuk-row .val { font-variant-numeric:tabular-nums; text-align:right; width:104px; color:var(--dim); }
  .yuk-bar { width:150px; height:8px; background:rgba(128,128,128,.18); border-radius:4px; overflow:hidden; }
  .yuk-bar i { display:block; height:100%; background:var(--acc,#4a9); }
  .yuk-row.zero .yuk-bar i { background:rgba(128,128,128,.35); }
  .yuk-dot { width:7px; height:7px; border-radius:50%; flex:none; background:rgba(128,128,128,.4); }
  .yuk-dot.generating { background:#4a9; }
  .yuk-dot.waiting { background:#e9b949; }
  .yuk-dot.error { background:#e05; }
  .yuk-note { font-size:11px; color:var(--dim); }
  .yuk-stale { opacity:.45; }
  .yuk-hint { font-size:11px; font-weight:400; color:var(--dim); }
  .yuk-row.tik { cursor:pointer; border-radius:5px; }
  .yuk-row.tik:hover { background:rgba(128,128,128,.09); }
  .yuk-row .cev { width:12px; color:var(--dim); font-size:10px; flex:none; }
  .yuk-det { margin:2px 0 10px 27px; padding:9px 12px; border-left:2px solid rgba(128,128,128,.28);
             font-size:12px; display:grid; gap:5px; }
  .yuk-det .k { color:var(--dim); font-size:10px; text-transform:uppercase; letter-spacing:.5px; }
  .yuk-det .yok { color:var(--dim); font-style:italic; }
  .yuk-det .suan { color:var(--acc,#4a9); }
  .yuk-plan { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .plan-box { margin:8px 0; padding:9px 12px; border:1px solid rgba(128,128,128,.22); border-radius:7px; }
  .plan-hd { display:flex; gap:8px; align-items:center; font-size:13px; margin-bottom:6px; }
  .plan-hd .ilerleme { margin-left:auto; font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; }
  .asama { display:flex; gap:7px; align-items:center; font-size:12px; padding:2px 0; cursor:pointer; border-radius:4px; }
  .asama:hover { background:rgba(128,128,128,.09); }
  .asama.pasif { cursor:default; opacity:.75; }
  .asama .no { font-variant-numeric:tabular-nums; color:var(--dim); width:20px; }
  .asama .rz { font-size:10px; padding:1px 6px; border-radius:9px; border:1px solid rgba(128,128,128,.3); }
  .asama .rz.KAPALI { background:rgba(74,153,102,.18); border-color:rgba(74,153,102,.5); }
  .asama .rz.SÜRÜYOR { background:rgba(233,185,73,.18); border-color:rgba(233,185,73,.5); }
  .asama .rz.BLOKE { background:rgba(224,0,85,.15); border-color:rgba(224,0,85,.45); }
  .asama.aktif { outline:2px solid var(--acc,#4a9); outline-offset:1px; }
  .yuk-doc { margin-top:12px; border:1px solid rgba(128,128,128,.28); border-radius:7px; overflow:hidden; }
  .yuk-doc-head { display:flex; align-items:center; gap:10px; padding:7px 12px;
                  background:rgba(128,128,128,.08); font-size:12px; }
  .yuk-doc-head button { margin-left:auto; }
  #yuk-doc-govde { max-height:460px; overflow:auto; padding:10px 14px; }
  /* --- Kapasite --- */
  .kap-box { margin-top:10px; }
  .kap-hd { display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:8px; }
  .kap-mod { font-size:11px; padding:2px 9px; border-radius:9px; cursor:pointer;
             border:1px solid rgba(128,128,128,.3); color:var(--dim); }
  .kap-mod.on { background:var(--acc,#4a9); border-color:var(--acc,#4a9); color:#fff; }
  .kap-gauge { position:relative; height:22px; background:rgba(128,128,128,.16); border-radius:6px; overflow:hidden; }
  .kap-gauge i { display:block; height:100%; width:0; background:var(--acc,#4a9); transition:width .3s; }
  .kap-gauge i.asiri { background:#e05; }
  .kap-gauge span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                    font-size:12px; font-variant-numeric:tabular-nums; }
  .kap-det { font-size:12px; color:var(--dim); margin-top:6px; }
  .kap-det .uyari { color:#e05; }
</style></head><body>
<header>
  <span class="logo">⚓ kaptan</span>
  <nav class="tabs" role="tablist">
    <button class="tab on" id="tab-gorev" role="tab">Görevler</button>
    <button class="tab" id="tab-pm" role="tab">PM<span class="bdg" id="pm-bdg" style="display:none"></span></button>
    <button class="tab" id="tab-yuk" role="tab">Yük<span class="bdg" id="yuk-bdg" style="display:none"></span></button>
  </nav>
  <select id="project" title="Pano değiştir"></select>
  <button id="refresh" title="Şimdi yenile">↻</button>
  ${AIDE_CLI ? '<a href="/sistem-agi" target="_blank" title="Sistem Ağı — 12 katmanlı canlı graf (proje·plan·otomasyon·ajan·oturum·kilit·rota)" style="text-decoration:none">🕸 sistem ağı<span class="bdg" id="graf-bdg" style="display:none"></span></a>' : ""}
  <span class="spacer"></span>
  <span class="mono" id="at" style="color:var(--dim)"></span>
</header>
<div class="bar">
  <span class="lbl">grupla</span>
  <select id="grupla">
    <option value="durum">duruma göre</option>
    <option value="kategori">amaca göre</option>
    <option value="yok">grupsuz</option>
  </select>
  <span class="lbl">sırala</span>
  <select id="sort">
    <option value="activity">son aktivite</option>
    <option value="status">durum</option>
  </select>
  <span class="lbl">aralık</span>
  <select id="days">
    <option value="2">son 2 gün</option>
    <option value="7">son 7 gün</option>
    <option value="14">son 14 gün</option>
    <option value="30">son 30 gün</option>
    <option value="all">tümü</option>
  </select>
  <label class="ck"><input type="checkbox" id="completed"> tamamlananlar</label>
  <label class="ck"><input type="checkbox" id="dates"> tarihler</label>
</div>
<main>
  <!-- U3: ?only=gorev modunda sekme çubuğu (ve oradaki 🔴 rozet) gizlidir → kırmızı onay
       KÖR NOKTA olurdu. Bant tek-ekran modunda sayfanın en üstünde durur. -->
  <div id="onay-bant"></div>
  <!-- U4: /api/pm/state patlarsa PM verisi (ve onay rozeti) BAYAT kalır — sessizce yutma. -->
  <div id="pm-err"></div>
  <div id="err"></div>
  <div class="cards" id="cards"></div>
  <section id="hedefler"></section>
  <div id="projects"></div>
  <section id="pmview">
    <!-- U5a: AKSİYON KATMANI EN ÜSTTE. Eskiden nadiren dokunulan Kadans'ın ALTINDAYDI —
         kod yorumu "aksiyon önceliği" diyordu ama sıra öyle değildi. Onay bekleyen kırmızı
         iş, ekranın ilk gördüğü şeydir. Boş bölüm hiç çizilmez. -->
    <div id="pm-onay"></div>
    <div id="pm-dogrulanmamis"></div>
    <!-- 🔎 SONUÇ İNCELEMESİ: 🟡'nin hemen ALTINDA. "İş verdim, sonucu geldi — kabul mü
         ediyorum, geri bildirimle yeniden mi koşturuyorum?" sorusunun cevaplandığı yer.
         Kabul EYLEMSİZLİKTİR (iş zaten kapalı) → tek düğme REDdir. -->
    <div id="pm-incelenecek"></div>
    <div id="pm-takilan"></div>
    <h2>⚙ Kadans — PM kadranı</h2>
    <div class="pm-box pm-form" id="pm-kadans" style="display:none">
      <div class="opts">
        <label class="kd">mod
          <select id="kd-mod">
            <option value="gozlem">gözlem</option>
            <option value="yesil">yeşil</option>
            <option value="tam">tam</option>
          </select>
        </label>
        <label class="kd">frekans <input id="kd-frekans" placeholder="2h"></label>
        <label class="kd">paralel <input id="kd-paralel" type="number" min="1"></label>
        <label class="kd">günlük tavan <input id="kd-gunluk" type="number" min="1"></label>
        <!-- U2: apply artık OTOMATİK hesaplanır (TUI ile aynı kural: frekans/paralel değişti
             mi?). Bu kutu yalnız ZORLAMA içindir: rutin hiç yoksa ya da bozuksa yeniden kur. -->
        <label class="ck"><input type="checkbox" id="kd-apply"> rutini yeniden kur (zorla — frekans/paralel değişince zaten otomatik)</label>
        <button id="kd-kaydet">Kaydet</button>
      </div>
      <div class="kd-uyari" id="kd-uyari" style="display:none"></div>
      <div class="kd-ayrisma" id="kd-ayrisma" style="display:none"></div>
      <div class="m" id="kd-durum">—</div>
    </div>
    <h2>📥 Gelen kutusu — PM'e hedef/direktif bırak</h2>
    <div class="pm-box pm-form">
      <textarea id="pm-text" placeholder="Hedefini ya da direktifini yaz — PM bir sonraki koşumda işler (hedeflere + vizyona işler, Kaptan'a dağıtır)…"></textarea>
      <div class="opts">
        <select id="pm-tip"><option value="hedef">hedef</option><option value="vizyon">vizyon</option><option value="direktif">direktif</option><option value="soru">soru</option></select>
        <select id="pm-proje"><option value="">portföy (tümü)</option></select>
        <select id="pm-onc"><option value="">öncelik: —</option><option value="yuksek">yüksek</option><option value="orta">orta</option><option value="dusuk">düşük</option></select>
        <label class="ck" id="pm-simdi-l" style="display:none"><input type="checkbox" id="pm-simdi"> şimdi işle (kuyruğa pm-intake işi yazar)</label>
        <button id="pm-gonder">Bırak</button>
      </div>
    </div>
    <div id="pm-notlar"></div>
    <h2>🎯 Üst-hedefler</h2>
    <div id="pm-hedefler"></div>
    <h2>◎ Proje hedefleri</h2>
    <div id="pm-proje-hedefleri"></div>
    <h2>🗺 Planlar</h2>
    <div id="pm-planlar"></div>
    <h2>📄 Vizyon &amp; dokümanlar</h2>
    <div class="doc-wrap pm-box">
      <div class="doc-list" id="doc-list"></div>
      <div class="doc-pane" id="doc-pane"><p class="empty">Soldan bir doküman seç.</p></div>
    </div>
    <h2>🗒 Son brifing</h2>
    <div id="pm-brifing" class="pm-box empty">—</div>
  </section>
  <section id="yukview" style="display:none">
    <div class="yuk-top pm-box">
      <div class="yuk-big"><span id="yuk-tps">—</span><small id="yuk-win">60sn ort.</small></div>
      <div class="yuk-spark" id="yuk-spark" title="son 5 dk · 10sn kovalar"></div>
      <div class="yuk-meta" id="yuk-meta">—</div>
    </div>
    <div class="kap-box pm-box" id="yuk-kap">
      <div class="kap-hd">
        <b>Kapasite tavanı</b>
        <span id="kap-mod-5h" class="kap-mod" data-kap-mod="5h">5 saatlik</span>
        <span id="kap-mod-weekly" class="kap-mod" data-kap-mod="weekly">Haftalık</span>
        <button id="kap-ayarla" style="margin-left:auto">Limiti ayarla</button>
      </div>
      <div class="kap-gauge"><i id="kap-fill"></i><span id="kap-pct"></span></div>
      <div class="kap-det" id="kap-det"></div>
    </div>
    <h2>▨ Yüzeyler</h2>
    <div id="yuk-gruplar"></div>
    <h2>⚡ Oturumlar <span class="yuk-hint">— satıra tıkla: ne yapıyor, hangi planın neresinde</span></h2>
    <div id="yuk-sessions"></div>
    <h2>🗺 Planlar &amp; aşamalar <span class="yuk-hint">— aşamaya tıkla: planı oku</span></h2>
    <div id="yuk-planlar"></div>
    <div id="yuk-doc" class="yuk-doc" style="display:none">
      <div class="yuk-doc-head"><b id="yuk-doc-ad"></b><button id="yuk-doc-kapat">✕ kapat</button></div>
      <div id="yuk-doc-govde" class="doc-pane"></div>
    </div>
    <p class="yuk-note" id="yuk-note"></p>
  </section>
</main>
<div id="toast"></div>
<script>
const STATUS_META = ${meta};
const KATEGORI_META = ${katMeta};
const KIND = ${kindMeta};
const KAT_ORDER = ${katOrder};
const CLS = { active:"st-active", planned:"st-planned", stale:"st-stale", paused:"st-paused", done:"st-done", dropped:"st-dropped" };
const RANK = { active:0, planned:1, stale:2, paused:3, dropped:4, done:5 };
const SEV = { yuksek:"🔴", orta:"🟡", dusuk:"⚪" };
const Q = new URLSearchParams(location.search);

const LS = {
  get(k, d) { try { const v = localStorage.getItem("kaptan." + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kaptan." + k, v); } catch {} },
};
function esc(x){ return String(x??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function fmtDate(iso){ if(!iso) return "—"; const d=new Date(iso);
  return d.toLocaleDateString("tr-TR",{day:"2-digit",month:"short"})+" "+d.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"}); }
function ago(days){ if(days==null) return ""; return days===0 ? "bugün" : days+"g önce"; }

// ── ayarlar (localStorage kalıcı) ────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const state = {
  project: Q.get("project") ?? LS.get("project", ""),   // "" = tümü
  grupla: LS.get("grupla", "durum"),
  sort: LS.get("sort", "activity"),
  days: LS.get("days", "2"),
  completed: LS.get("completed", "0") === "1",
  dates: LS.get("dates", "0") === "1",
};
// daraltılmış grup/oturum anahtarları — reload'da kalıcı
const collapsed = new Set((LS.get("collapsed", "") || "").split(",").filter(Boolean));
function toggleGroup(key){
  collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
  LS.set("collapsed", [...collapsed].join(","));
  render();
}
// çoklu-task'lı epic gövdesi VARSAYILAN KAPALI → burada açık olanlar tutulur (ters küme)
const expandedEpics = new Set((LS.get("expandedEpics", "") || "").split(",").filter(Boolean));
function toggleEpic(key){
  expandedEpics.has(key) ? expandedEpics.delete(key) : expandedEpics.add(key);
  LS.set("expandedEpics", [...expandedEpics].join(","));
  render();
}

el("grupla").value = state.grupla;
el("sort").value = state.sort;
el("days").value = state.days;
el("completed").checked = state.completed;
el("dates").checked = state.dates;

el("grupla").addEventListener("change", e => { state.grupla = e.target.value; LS.set("grupla", state.grupla); render(); });
el("sort").addEventListener("change", e => { state.sort = e.target.value; LS.set("sort", state.sort); render(); });
el("days").addEventListener("change", e => { state.days = e.target.value; LS.set("days", state.days); render(); });
el("completed").addEventListener("change", e => { state.completed = e.target.checked; LS.set("completed", state.completed?"1":"0"); render(); });
el("dates").addEventListener("change", e => { state.dates = e.target.checked; LS.set("dates", state.dates?"1":"0"); render(); });
el("project").addEventListener("change", e => { state.project = e.target.value; LS.set("project", state.project); tick(); });
el("refresh").addEventListener("click", tick);

let toastT;
function toast(msg){ const t=el("toast"); t.textContent=msg; t.classList.add("on");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("on"), 1600); }

// ── tıkla-git: (cwd, sessionId) çifti ────────────────────────────────────────
// Session KAYNAĞINDA açılır: VSCode'da başladıysa VSCode penceresinde, aide/cli'de
// başladıysa tmux'ta. Yönlendirmeyi sunucu yapar (tek kaynak) — istemci sadece ister.
async function openSession(sessionId, cwd, fork){
  toast(fork ? "fork açılıyor…" : "açılıyor…");
  try {
    const r = await fetch("/api/open", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, cwd, fork: !!fork }),
    });
    const d = await r.json();
    toast(d.ok ? d.via + " içinde açılıyor" : "açılamadı: " + (d.error || d.via));
  } catch (e) { toast("açılamadı"); }
}
// açık (expanded) task satırları — 15sn'lik tick yeniden-render'ında kaybolmasın
// diye id ile tutulur (oturumlar arası kalıcılık gerekmez → bellek yeter).
const openRows = new Set();

// SIRA KRİTİK: data-sid (oturuma git/fork — en İÇTEKİ butonlar) → data-grp (daralt)
// → data-epic (epik aç/kapa) → data-exp (satır ayrıntısı). Eylem butonları expanded
// satırın İÇİNDE yaşar; önce onlar yoklanır ki tıklama satırı kapatmasın.
function hitOpen(t){ const n = t.closest?.("[data-sid]"); if (!n) return false; openSession(n.dataset.sid, n.dataset.cwd || "", n.dataset.fork === "1"); return true; }
function hitGroup(t){ const n = t.closest?.("[data-grp]"); if (!n) return false; toggleGroup(n.dataset.grp); return true; }
function hitEpic(t){ const n = t.closest?.("[data-epic]"); if (!n) return false; toggleEpic(n.dataset.epic); return true; }
function hitExpand(t){ const n = t.closest?.("[data-exp]"); if (!n) return false;
  const k = n.dataset.exp; openRows.has(k) ? openRows.delete(k) : openRows.add(k); render(); return true; }

document.addEventListener("click", (e) => {
  if (hitOpen(e.target)) return;
  if (hitGroup(e.target)) return;
  if (hitEpic(e.target)) return;
  hitExpand(e.target);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (hitOpen(e.target)) { e.preventDefault(); return; }
  if (hitGroup(e.target)) { e.preventDefault(); return; }
  if (hitEpic(e.target)) { e.preventDefault(); return; }
  if (hitExpand(e.target)) e.preventDefault();
});

// ── filtre + sıralama (client-side) ──────────────────────────────────────────
function visibleEpics(p){
  const maxDays = state.days === "all" ? Infinity : Number(state.days);
  let es = p.epics.filter(e => {
    if (!state.completed && (e.status === "done" || e.status === "dropped")) return false;
    if (e.staleDays != null && e.staleDays > maxDays) return false;
    return true;
  });
  es.sort((a,b) => state.sort === "status"
    ? (RANK[a.status]-RANK[b.status]) || String(b.lastActivity).localeCompare(String(a.lastActivity))
    : String(b.lastActivity).localeCompare(String(a.lastActivity)));
  return es;
}

// Birincil metin = short (≤42, tek satıra sığar). Satıra tıkla → AYRINTI açılır:
// ham content'in TAMAMI + üretim/değişiklik zamanı + eylemler (oturuma git · fork).
// Oturuma gitmek artık satırın kendisi DEĞİL, expanded içindeki açık butonlardır
// → yanlışlıkla oturum açma yok, hiçbir bilgi ellipsis'te saklı kalmaz.
function taskHtml(t, cwd){
  const done = t.resolution === "completed";
  const doing = t.status === "in_progress" && !done;
  const g = done ? "✓" : doing ? "◐" : "○";
  const key = t.id || (t.sessionId + ":" + (t.short||""));
  const open = openRows.has(key);
  const cls = "row" + (done ? " done" : doing ? " doing" : "") + (open ? " exp" : "");
  const km = t.kind && KIND[t.kind];
  const kind = km ? '<span class="kind" title="'+esc(km.label)+'">'+km.icon+'</span>' : '';
  const short = t.short || String(t.content||"").slice(0,42);
  const full = open
    ? '<div class="full">'+esc(t.content||short)+
        '<div class="fmeta mono">'+
          '<span>üretildi: '+fmtDate(t.firstSeen)+'</span>'+
          (t.lastChange && t.lastChange !== t.firstSeen ? '<span>son değişiklik: '+fmtDate(t.lastChange)+'</span>' : '')+
          '<span>oturum: '+esc(String(t.sessionId).slice(0,8))+'</span>'+
        '</div>'+
        '<div class="facts">'+
          '<button class="act" data-sid="'+esc(t.sessionId)+'" data-cwd="'+esc(cwd)+'" title="oturumu kaldığı yerden aç">⤷ oturuma git</button>'+
          '<button class="act" data-sid="'+esc(t.sessionId)+'" data-cwd="'+esc(cwd)+'" data-fork="1" title="bu noktadan YENİ oturum çatalla (kaynağa dokunmaz)">⑂ bu noktadan fork</button>'+
        '</div>'+
      '</div>'
    : '';
  return '<div class="'+cls+'" tabindex="0" role="button" aria-expanded="'+open+'" data-exp="'+esc(key)+'" '+
    'title="'+esc(t.content||short)+' — tıkla: ayrıntı">'+
    '<span class="g">'+g+'</span>'+kind+
    '<span class="txt">'+esc(short)+'</span>'+
    '<span class="car">'+(open?"▾":"▸")+'</span>'+
    '<span class="sid mono">'+esc(String(t.sessionId).slice(0,8))+'</span>'+
    full+'</div>';
}

function sessChip(s, cwd){
  const rol = s.rol ? ' · '+esc(s.rol) : '';
  return '<span class="chip" tabindex="0" role="button" data-sid="'+esc(s.sessionId)+'" data-cwd="'+esc(cwd||"")+'" '+
    'title="oturuma git">⤷ '+esc(s.short)+rol+'</span>';
}

// Çok-oturumlu epic: task satırları oturum alt-başlığı altında toplanır.
// Caret (data-grp) ve başlık (data-sid) KARDEŞ düğüm → tıklama çakışması yok.
function sessionsHtml(e, tasks){
  const byId = {};
  for (const t of tasks) (byId[t.sessionId] ||= []).push(t);
  let h = '<div class="tasks grouped">';
  for (const s of e.sessions){
    const rows = byId[s.sessionId] || [];
    if (!rows.length) continue;
    const key = "sess:"+e.id+":"+s.sessionId;
    const open = !collapsed.has(key);
    h += '<div class="sess'+(open?"":" col")+'">'+
      '<div class="sess-h">'+
        '<span class="sess-c" data-grp="'+esc(key)+'" role="button" tabindex="0" aria-label="daralt/genişlet">'+(open?"▾":"▸")+'</span>'+
        '<span class="sess-t" data-sid="'+esc(s.sessionId)+'" data-cwd="'+esc(e.cwd||"")+'" role="button" tabindex="0" title="oturuma git">⤷ '+esc(s.short)+'</span>'+
        (s.rol ? '<span class="sess-r">'+esc(s.rol)+'</span>' : '')+
        '<span class="sess-n mono">'+(s.openCount||0)+' açık</span>'+
      '</div>'+
      (open ? '<div class="sess-b">'+rows.map(t=>taskHtml(t, e.cwd)).join("")+'</div>' : '')+
    '</div>';
  }
  return h+'</div>';
}

function epicHtml(e){
  const m = STATUS_META[e.status] || { icon:"·", label:e.status };
  const pr = e.progress || {};
  const total = (pr.doneEver||0)+(pr.openActive||0);
  const tasks = (e.tasks||[]).filter(t => state.completed ? true : t.resolution === null);
  const multi = (e.sessions||[]).length > 1;
  const dates = state.dates
    ? '<span class="mono">oluşturma '+fmtDate(e.firstActivity)+'</span><span class="mono">son aktivite '+fmtDate(e.lastActivity)+'</span>'
    : '<span>son aktivite '+ago(e.staleDays)+'</span>';

  const km = e.kategori && KATEGORI_META[e.kategori];
  const kat = km ? '<span class="kbadge" title="'+esc(km.label)+'">'+km.icon+'</span>' : '';
  const kunye = !e.provisional ? '<span class="kunye" title="damıtılmış künye">⟨künye⟩</span>' : '';
  const amac = e.amac ? '<div class="amac">'+esc(e.amac)+'</div>' : '';
  const tags = (e.tags||[]).length
    ? '<div class="tags">'+e.tags.map(t=>'<span class="tag">#'+esc(t)+'</span>').join("")+'</div>' : '';

  const body = multi
    ? (tasks.length ? sessionsHtml(e, tasks) : '')
    : (tasks.length ? '<div class="tasks">'+tasks.map(t=>taskHtml(t, e.cwd)).join("")+'</div>' : '');
  const chips = (!multi && (e.sessions||[]).length)
    ? '<div class="chips">'+e.sessions.map(s=>sessChip(s, e.cwd)).join("")+'</div>' : '';

  // birden çok task → gövde katlanabilir, VARSAYILAN KAPALI; başlığa tıkla → expand.
  // Tek task'lı/boş epic eskisi gibi doğrudan görünür (caret yok).
  const collapsible = tasks.length > 1;
  const ekey = "epic:"+e.id;
  const open = !collapsible || expandedEpics.has(ekey);
  const headAttrs = collapsible
    ? ' tgl" data-epic="'+esc(ekey)+'" role="button" tabindex="0" aria-expanded="'+open+'" title="görevleri aç/kapat'
    : '';
  const caret = collapsible ? '<span class="epic-c">'+(open?"▾":"▸")+'</span>' : '';

  return '<div class="epic is-'+e.status+'">'+
    '<div class="head'+headAttrs+'">'+caret+'<span class="'+(CLS[e.status]||"")+'">'+m.icon+'</span>'+kat+
      '<span class="title">'+esc(e.title)+'</span>'+
      '<span class="badge '+(CLS[e.status]||"")+'" title="'+esc(m.label)+'">'+esc(m.label.split(" (")[0])+'</span>'+
      (total ? '<span class="prog mono">'+pr.doneEver+'/'+total+' · %'+pr.pct+'</span>' : '')+kunye+
    '</div>'+amac+
    '<div class="meta">'+dates+(pr.dropped?'<span>'+pr.dropped+' bırakıldı</span>':'')+
      (multi?'<span>'+e.sessions.length+' oturum</span>':'')+
      (open?'':'<span>'+tasks.length+' görev gizli</span>')+'</div>'+
    tags+(open ? body+chips : '')+
  '</div>';
}

// Gruplama ekseni. es zaten visibleEpics() ile filtreli+sıralı → grup içi sıra "sırala"ya uyar.
function groupsOf(p, es){
  if (state.grupla === "yok") return [{ key:"", head:null, epics:es }];
  if (state.grupla === "durum"){
    return Object.keys(RANK).sort((a,b)=>RANK[a]-RANK[b]).map(st => ({
      key: p.slug+":st:"+st,
      head: { icon:(STATUS_META[st]||{}).icon, label:(STATUS_META[st]||{}).label, cls:CLS[st] },
      epics: es.filter(e => e.status === st),
    })).filter(g => g.epics.length);
  }
  const groups = KAT_ORDER.map(k => ({
    key: p.slug+":kat:"+k,
    head: { icon:(KATEGORI_META[k]||{}).icon, label:(KATEGORI_META[k]||{}).label, cls:"" },
    epics: es.filter(e => e.kategori === k),
  })).filter(g => g.epics.length);
  const rest = es.filter(e => !KAT_ORDER.includes(e.kategori));  // künyesiz → kategori yok
  if (rest.length) groups.push({ key:p.slug+":kat:_", head:{icon:"•",label:"KÜNYESİZ",cls:""}, epics:rest });
  return groups;
}

function groupHtml(g){
  if (!g.head) return g.epics.map(epicHtml).join("");
  const open = !collapsed.has(g.key);
  return '<div class="grp'+(open?"":" col")+'">'+
    '<div class="grp-h" tabindex="0" role="button" data-grp="'+esc(g.key)+'" aria-expanded="'+open+'">'+
      '<span class="grp-c">'+(open?"▾":"▸")+'</span>'+
      '<span class="grp-i '+(g.head.cls||"")+'">'+esc(g.head.icon||"")+'</span>'+
      '<span class="grp-l">'+esc(g.head.label||"")+'</span>'+
      '<span class="grp-n mono">'+g.epics.length+'</span>'+
    '</div>'+
    (open ? '<div class="grp-b">'+g.epics.map(epicHtml).join("")+'</div>' : '')+
  '</div>';
}

function projHtml(p){
  const es = visibleEpics(p);
  if (!es.length && !(p.backlog||[]).length && !(p.plans||[]).length) return "";
  let h = '<section class="proj"><h2>'+esc(p.dirName)+' <span class="n">'+es.length+' epik</span></h2>';
  h += groupsOf(p, es).map(groupHtml).join("");
  h += plansHtml(p.plans, p.cwd);
  const bl = p.backlog||[];
  if (bl.length) h += '<div class="backlog"><div class="h">⚙ BACKLOG (açık · '+bl.length+')</div>'+
    bl.map(b=>'<div class="bl">'+(SEV[b.severity]||"·")+' <b class="mono">'+esc(b.id)+'</b> '+esc(b.desc)+'</div>').join("")+'</div>';
  return h+'</section>';
}

/** Plan ağacı bloğu — kaynak: <proje>/plans/INDEX.json (tek yazar: plan-organizatoru agac.mjs).
 *  Pano yalnız GÖSTERİR; plan üretimi /plan-kur, yerleştirme /plan-organizatoru işidir. */
const PLAN_ICON = { "AÇIK":"◇", "SÜRÜYOR":"▶", "KAPALI":"✓", "BLOKE":"⛔" };
function plansHtml(plans, cwd){
  const ps = plans||[];
  if (!ps.length) return "";
  // TUZAK 1 — KAÇIŞ BİR KATMAN ERKEN TÜKENİR: burası page()'in TEMPLATE LITERAL'i.
  //   Tek ters-bölü + apostrof yazarsan template onu YER, tarayıcıya çıplak apostrof
  //   gider, tek-tırnaklı string orada kapanır ve TÜM inline script ölür (pano komple
  //   çalışmaz: Görevler, PM, Yük — hepsi; sunucu yine 200 döner, hata SESSİZDİR).
  //   Doğrusu ÇİFT ters-bölü + apostrof. En temizi: apostrof kullanma.
  // TUZAK 2 — bu yoruma BACKTICK yazma: template'i orada kapatır ve dosya parse
  //   edilemez. (Tuzak 1'i belgelemek isterken tam olarak bu yaşandı, 2026-07-16.)
  // node --check dashboard.mjs İKİSİNİ DE tam yakalayamaz (biri modül-içi, öteki
  //   basılan metinde) → kapı: node scripts/dashboard-inline-check.mjs
  const agi = cwd ? ' <a href="/plan-agi?cwd='+encodeURIComponent(cwd)+'" target="_blank" title="Plan Ağı — 2D harita (rotalar · VE/VEYA kapıları · canlı runner rotaları)" style="text-decoration:none">🕸 ağ haritası</a>' : '';
  return '<div class="backlog"><div class="h">🗺 PLANLAR ('+ps.length+' · plans/INDEX.md)'+agi+'</div>'+
    ps.map(pl=>'<div class="bl">'+(PLAN_ICON[pl.durum]||"·")+' <b class="mono">'+esc(pl.slug)+'</b> v'+esc(pl.v)+
      (pl.kategori?' <span class="chip">'+esc(pl.kategori)+'</span>':'')+
      // künye rozeti — model.readPlans listeyi künye puanına göre sıralar; rozet o sırayı GÖRÜNÜR
      // kılar. Künyesiz plan sessizce normal görünmez: rozet eksikliği İLAN edilir.
      (pl.kunye&&pl.kunye.oncelik!=null
        ?' <span class="chip" title="kritiklik/aciliyet · hacim — öncelik TÜREVDİR (agac.mjs)">P'+pl.kunye.oncelik+' '+esc(pl.kunye.kritiklik+"/"+pl.kunye.aciliyet+" · "+pl.kunye.hacim)+'</span>'
        :' <span class="chip" title="MASTER.md ust blogunda Kritiklik/Aciliyet/Hacim yok — agac.mjs --kunye onar satirini verir">künyesiz</span>')+
      ' '+esc(pl.title||"")+
      (pl.asamaToplam?' <span class="m">aşama '+pl.asamaKapali+'/'+pl.asamaToplam+'</span>':'')+
      (pl.siradaki?' <span class="m">· sıradaki: '+esc(pl.siradaki.no+"-"+pl.siradaki.ad)+'</span>':'')+
      (pl.kunye&&pl.kunye.hedef?'<div class="m">↳ hedef: '+esc(pl.kunye.hedef)+'</div>':'')+
      '</div>').join("")+'</div>';
}

function fillProjects(all, scope){
  const sel = el("project");
  const cur = scope ?? state.project ?? "";
  sel.innerHTML = '<option value="">Tümü</option>' +
    all.map(p=>'<option value="'+esc(p.cwd)+'">'+esc(p.dirName)+'</option>').join("");
  sel.value = cur;
  if (sel.value !== cur) sel.value = ""; // kapsam listede yoksa Tümü'ne düş
}

const HD_META = {
  acik:      { g:"○", ad:"açık" },
  ilerliyor: { g:"▶", ad:"ilerliyor" },
  tikandi:   { g:"◑", ad:"tıkandı" },
  kapandi:   { g:"✓", ad:"kapandı" },
  iptal:     { g:"✕", ad:"iptal" },
};
const ONCELIK = { yuksek:"yüksek", orta:"orta", dusuk:"düşük" };

/** PM üst-hedefleri: epic'lerin üstünde, ayrı katman. Kapandı/iptal yalnız "tamamlananlar" açıkken.
 *
 *  U5b — basliksiz: PM ekranı bu render'ı YENİDEN KULLANIR ama kendi "🎯 Üst-hedefler"
 *  başlığı zaten vardır; fonksiyon kendi <h2>'sini de içeri taşıyınca İÇ İÇE ÇİFT BAŞLIK
 *  ("🎯 Üst-hedefler" > "PM üst-hedefleri") çiziliyordu. Başlık artık çağrıya bırakılır. */
function renderPmGoals(hedefler, basliksiz){
  const box = el("hedefler");
  if (!box) return;
  const list = (hedefler||[]).filter(h => state.completed || !["kapandi","iptal"].includes(h.durum));
  if (!list.length) { box.innerHTML = ""; return; }
  const rank = { tikandi:0, ilerliyor:1, acik:2, kapandi:3, iptal:4 };
  list.sort((a,b)=>(rank[a.durum]??9)-(rank[b.durum]??9));
  box.className = "hedefler";
  box.innerHTML = (basliksiz ? "" : '<h2>PM üst-hedefleri</h2>') + list.map(h => {
    const m = HD_META[h.durum] || { g:"·", ad:h.durum||"?" };
    const kanit = Array.isArray(h.ilerlemeKanidi) ? h.ilerlemeKanidi : [];
    const son = kanit.length ? kanit[kanit.length-1].kanit : null;
    const epikler = (h.kapsam?.epicler||[]).map(id =>
      '<span class="chip" title="epik">'+esc(id)+'</span>').join("");
    return '<div class="hedef hd-'+esc(h.durum||"acik")+'">'
      + '<div class="hd-bas">'
      +   '<span class="st-'+(h.durum==="tikandi"?"stale":h.durum==="kapandi"?"done":"active")+'">'+m.g+'</span>'
      +   '<span class="hd-t">'+esc(h.baslik||"(başlıksız)")+'</span>'
      +   '<span class="badge">'+esc(m.ad)+'</span>'
      +   (h.oncelik ? '<span class="badge">'+esc(ONCELIK[h.oncelik]||h.oncelik)+'</span>' : "")
      +   (kanit.length ? '<span class="badge">'+kanit.length+' kanıt</span>' : "")
      + '</div>'
      + (h.kapanmaKosulu ? '<div class="hd-kosul">kapanma: <b>'+esc(h.kapanmaKosulu)+'</b></div>' : "")
      + (son ? '<div class="hd-kosul">son kanıt: '+esc(son)+'</div>' : "")
      + (epikler ? '<div class="chips">'+epikler+'</div>' : "")
      + '</div>';
  }).join("");
}

// ── PM sekmesi ───────────────────────────────────────────────────────────────
const TABS = { gorev: ["cards","hedefler","projects"], pm: ["pmview"], yuk: ["yukview"] };
// TEK-EKRAN modu (?only=pm | ?only=gorev): pano tek bir yüzeye kilitlenir, sekme çubuğu
// gizlenir. VSCode eklentisi Görevler ve PM'i AYRI view'ler olarak iframe'ler → her biri
// kendi ekranı olur. only parametresi yoksa (tarayıcı / aide kaptan) sekmeli davranış sürer.
const ONLY = ["pm","gorev","yuk"].includes(Q.get("only")) ? Q.get("only") : null;
const TABQ = ["pm","yuk"].includes(Q.get("tab")) ? Q.get("tab") : null;
let tab = ONLY || TABQ || LS.get("tab", "gorev");
function setTab(t){
  if (ONLY) t = ONLY;                       // kilit: tek-ekran modunda sekme değişmez
  tab = t;
  if (!ONLY) LS.set("tab", t);              // tek-ekran seçimi kalıcı tercihi KİRLETMEZ
  el("tab-gorev").classList.toggle("on", t === "gorev");
  el("tab-pm").classList.toggle("on", t === "pm");
  el("tab-yuk").classList.toggle("on", t === "yuk");
  for (const id of TABS.gorev) el(id).style.display = t === "gorev" ? "" : "none";
  el("pmview").style.display = t === "pm" ? "block" : "none";
  el("yukview").style.display = t === "yuk" ? "block" : "none";
  document.querySelector(".bar").style.display = t === "gorev" ? "" : "none";
  if (t === "pm") pmTick();
  if (t === "yuk") yukTick();               // sekmeye geçişte ANINDA taze veri
}
if (ONLY) document.querySelector(".tabs").style.display = "none";
el("tab-gorev").addEventListener("click", () => setTab("gorev"));
el("tab-pm").addEventListener("click", () => setTab("pm"));
el("tab-yuk").addEventListener("click", () => setTab("yuk"));

let pmData = null;
let docSel = null;        // seçili doküman {path}
let docEdit = false;      // edit modu — poll yeniden ÇİZMEZ
let docMtime = 0;

let pmHata = null;   // U4: son /api/pm/state hatası (null = sağlıklı)

/** U4 — PM DURUMU HATASI SESSİZ YUTULMAZ. Eskiden sessiz "catch → return" idi: /api/pm/state
 *  500 dönerse PM ekranı BAYAT veriyle kalır, hiçbir gösterge düşmezdi — üstelik onay
 *  ROZETİ de bayatlar (kırmızı iş kaçırılır). "Sessiz ölüm yasak"ın kendi ekranındaki
 *  istisnasıydı. Görevler tarafı doğrusunu yapıyordu ("bağlantı yok"). */
function renderPmHata(){
  const b = el("pm-err");
  if (!b) return;
  b.innerHTML = pmHata
    ? '<div class="err-banner">PM durumu alınamadı: '+esc(pmHata)+
      ' — gösterilen PM verisi ve 🔴 onay rozeti BAYAT olabilir.</div>'
    : "";
}

/** U3 — TEK-EKRAN KÖR NOKTASI. "?only=gorev" sekme çubuğunu gizler; kırmızı onay rozeti o
 *  çubuktaki PM düğmesinde (#pm-bdg) yaşıyordu → VSCode "Görevler" view'üne gün boyu bakan
 *  kullanıcı bekleyen kırmızı işi ASLA öğrenemezdi. TUI onay rozetini HER segmentte gösterir;
 *  pano tek-ekran modu göstermiyordu. Veri zaten burada (pmTick 15sn'de bir koşar). */
function renderOnayBant(){
  const b = el("onay-bant");
  if (!b) return;
  const n = (ONLY === "gorev" && pmData && pmData.onay) ? pmData.onay.length : 0;
  b.innerHTML = n
    ? '<a class="onay-bant" href="?only=pm">🔴 '+n+' iş onay bekliyor → PM ekranı</a>'
    : "";
}

async function pmTick(){
  try {
    const r = await fetch("/api/pm/state");
    if (!r.ok) throw new Error("HTTP "+r.status);
    pmData = await r.json();
    pmHata = null;
  } catch (e) {
    pmHata = (e && e.message) ? String(e.message) : "bağlantı yok";
    renderPmHata();   // bant bas — bayat veriyle sessizce oturma
    return;
  }
  renderPmHata();     // düzeldiyse bandı kaldır
  // Rozet: gelen not + onay bekleyen. Onay varsa KIRMIZI — PM sekmesi kapalıyken bile
  // onay bekleyen kırmızı iş görünür kalır (sessiz ölüm yasak).
  const n = (pmData.gelen||[]).length;
  const onayN = (pmData.onay||[]).length;
  const b = el("pm-bdg");
  b.style.display = (n + onayN) ? "" : "none";
  b.textContent = String(n + onayN);
  b.classList.toggle("kirmizi", onayN > 0);
  b.title = onayN ? onayN+" onay bekliyor · "+n+" gelen not" : n+" gelen not";
  renderOnayBant();   // tek-ekran (gorev) modunda kırmızı bant
  if (tab !== "pm") return;
  renderPmTab();
}

// K36-6 — sistem ağı rozeti. Panonun graf-UI işi BU KADAR: fark/not sayaçları giriş
// satırında görünür, harita ve not formu motorun kendi HTML'inde yaşar. Kaynak
// /api/graf-ozet (aşama 34'ün DONMUŞ 6 alanı); iki sayaç da 0 iken rozet GİZLİ —
// sıfır rozeti gürültüdür. Ağ bağlantısı yoksa rozet SESSİZ kalır (bant basmaz):
// bu ikincil bir göstergedir, pmTick zaten kendi hatasını bildirir.
async function grafTick(){
  const b = el("graf-bdg");
  if (!b) return;              // AIDE_CLI yoksa link hiç basılmadı
  let o = null;
  try {
    const r = await fetch("/api/graf-ozet");
    if (!r.ok) throw new Error("HTTP "+r.status);
    o = await r.json();
  } catch (e) { return; }      // bayat sayıyı koru, yanlış sayı basma
  if (!o || o.yok || o.hata) { b.style.display = "none"; return; }
  const pf = o.planFark || {};
  const fark = (pf.planli||0) + (pf.kaldirilacak||0) + (pf.sarkik||0);
  const not = o.acikNot || 0;
  if (!fark && !not) { b.style.display = "none"; return; }
  b.style.display = "";
  b.textContent = (fark ? "⚠"+fark+" " : "") + (not ? "✎"+not : "");
  b.title = fark+" plan farkı ("+(pf.planli||0)+" planlı · "+(pf.kaldirilacak||0)+
            " kaldırılacak · "+(pf.sarkik||0)+" sarkık) · "+not+" açık not";
}

function renderPmTab(){
  if (!pmData) return;
  // form: proje seçici + şimdi-işle görünürlüğü
  const ps = el("pm-proje");
  if (ps.options.length <= 1 && data) {
    ps.innerHTML = '<option value="">portföy (tümü)</option>' +
      (data.allProjects||[]).map(p=>'<option value="'+esc(p.cwd)+'">'+esc(p.dirName)+'</option>').join("");
  }
  el("pm-simdi-l").style.display = pmData.maestroVar ? "" : "none";

  // gelen + işlenen notlar
  const notlar = (pmData.gelen||[]).map(g =>
    '<div class="pm-note"><b>'+esc(g.tip)+'</b> '+(g.proje?'<span class="m">'+esc(g.proje)+'</span> ':'')+
    (g.oncelik?'<span class="badge">'+esc(g.oncelik)+'</span> ':'')+esc(g.ozet)+
    '<div class="m">'+esc(g.file)+(g.kaynak?' · '+esc(g.kaynak):'')+' · bekliyor</div></div>').join("");
  const islenen = (pmData.islenen||[]).map(g =>
    '<div class="pm-note islenmis"><b>'+esc(g.tip)+'</b> '+esc(g.ozet)+
    '<div class="m">'+esc(g.file)+' · işlendi'+(g.sonuc?' → '+esc(g.sonuc):'')+'</div></div>').join("");
  el("pm-notlar").innerHTML =
    (notlar ? '<div class="pm-box">'+notlar+'</div>' : '<p class="empty">Bekleyen not yok.</p>') +
    (islenen ? '<div class="pm-box" style="opacity:.85">'+islenen+'</div>' : '');

  // üst-hedefler: mevcut renderPmGoals'un tam-liste varyantı (#pm-hedefler'e).
  // U5b: basliksiz=true — bu ekranın kendi "🎯 Üst-hedefler" <h2>'si var; fonksiyonun
  // kendi başlığını da içeri taşırsak iç içe ÇİFT BAŞLIK çıkar.
  const box = el("pm-hedefler");
  const saved = el("hedefler");
  const tmp = saved.innerHTML, tmpCls = saved.className;
  const oldCompleted = state.completed; state.completed = true;   // tam liste
  renderPmGoals(pmData.ustHedefler, true);
  box.innerHTML = saved.innerHTML || '<p class="empty">Üst-hedef yok.</p>';
  saved.innerHTML = tmp; saved.className = tmpCls; state.completed = oldCompleted;

  // proje hedefleri
  const PH = { P0:"🔴", P1:"🟠", P2:"🟡", P3:"⚪" };
  el("pm-proje-hedefleri").innerHTML = (pmData.projeHedefleri||[]).map(p =>
    '<div class="pm-box"><b>'+esc(p.slug)+'</b>'+
    p.hedefler.map(h=>'<div class="ph-satir">'+(PH[h.oncelik]||"·")+' <span>'+esc(h.text||h.id)+'</span>'+
      '<span class="pid">'+esc(h.id)+(h.onaylandi===false?' · öneri':'')+'</span></div>').join("")+
    '</div>').join("") || '<p class="empty">Proje hedefi yok (PM ilk koşumda iskeletler).</p>';

  // plan ağacı (kaynak: /api/state modelindeki p.plans — plans/INDEX.json projeksiyonu)
  const planlilar = ((data && data.projects)||[]).filter(p=>(p.plans||[]).length);
  el("pm-planlar").innerHTML = planlilar.map(p =>
    '<div class="pm-box"><b>'+esc(p.dirName)+'</b>'+plansHtml(p.plans, p.cwd)+'</div>').join("")
    || '<p class="empty">Plan ağacı yok — üretim: /plan-kur · yerleştirme: /plan-organizatoru.</p>';

  // U5a: aksiyon katmanı DOM'da kadansın ÜSTÜNDE (bkz. #pmview) — çağrı sırası da onu izler.
  renderOnay();
  renderDogrulanmamis();
  renderIncelenecek();
  renderTakilan();
  renderKadans();
  renderDocList();
  // son brifing
  if (pmData.brifing) loadDoc(pmData.brifing.path, "pm-brifing");
}

/** U2 — APPLY OTOMATİK HESAPLANIR. TUI'nin pmAyarSetArgs kuralının AYNISI (rule-symmetric):
 *  frekans ya da paralel değiştiyse rutin iş YENİDEN KURULMALI. Eskiden pano yalnız
 *  checkbox'a bakıyordu → işaretsizse ayar.json sessizce yazılır, "kadans kaydedildi" toast'ı
 *  basılır, ama RUTİN İŞ ESKİ KADANSTA KOŞMAYA DEVAM EDERDİ (ekran "30m" der, iş 2h'de koşar).
 *  Artık kullanıcının bir kutuyu bilmesi gerekmez: değişiklik apply'ı kendi getirir. */
function applyGerek(){
  const a = pmData && pmData.ayar;
  if (!a || !a.kadans) return false;
  return String(el("kd-frekans").value).trim() !== String(a.kadans.frekans)
      || Number(el("kd-paralel").value) !== Number(a.kadans.paralel);
}

/** Formda bekleyen değişiklik rutini yeniden kuracak mı? (TUI'deki "⚠ rutin YENİDEN
 *  KURULACAK" uyarısının pano karşılığı — kullanıcı Kaydet'e basmadan ÖNCE bilir.) */
function kadansUyari(){
  const u = el("kd-uyari");
  if (!u) return;
  const g = applyGerek();
  u.textContent = g ? "⚠ rutin YENİDEN KURULACAK (frekans/paralel değişti — eski iş iptal, yeni iş kurulur)" : "";
  u.style.display = g ? "" : "none";
}

/** U2 — AYAR ↔ CANLI RUTİN AYRIŞMASI. ayar.json ne diyor · rutin iş gerçekte ne yapıyor?
 *  Sunucu job.json'dan salt-okur getirir (pmData.ayar.rutinCanli). Farklıysa ekran YALAN
 *  SÖYLÜYOR demektir — görünür uyarı basılır. Hiçbir yüzey bunu göstermiyordu. */
function kadansAyrisma(){
  const box = el("kd-ayrisma");
  if (!box) return;
  const a = pmData && pmData.ayar;
  const rc = a && a.rutinCanli;
  let m = "";
  if (a && a.kadans && a.rutinJobId && rc) {
    if (!rc.mevcut)
      m = "⚠ rutin işi " + a.rutinJobId + " BULUNAMADI — 'rutini yeniden kur' işaretleyip kaydet";
    else if (rc.frekans && String(rc.frekans) !== String(a.kadans.frekans))
      m = "⚠ ayar " + a.kadans.frekans + " · rutin " + rc.frekans +
          " — AYRIŞMA: rutin hâlâ eski kadansta koşuyor. 'rutini yeniden kur' işaretleyip kaydet.";
  }
  box.textContent = m;
  box.style.display = m ? "" : "none";
}

/** Kadans şeridi — ayar.json (tek yazar: ayar.mjs) salt-okunur yansıması + küçük form. */
function renderKadans(){
  const a = pmData.ayar;
  const kutu = el("pm-kadans");
  if (!a || !a.kadans) { kutu.style.display = "none"; return; }
  kutu.style.display = "";
  kadansAyrisma();   // ayrışma UYARISI form odağından bağımsız — daima taze kalmalı
  // kullanıcı formda yazarken poll ezmesin
  if (document.activeElement && document.activeElement.closest("#pm-kadans")) return;
  el("kd-mod").value = a.mod;
  el("kd-frekans").value = a.kadans.frekans;
  el("kd-paralel").value = a.kadans.paralel;
  el("kd-gunluk").value = a.kadans.gunlukTavan;
  kadansUyari();     // form sunucu değerine döndü → bekleyen uyarı da düşer
  // U12: Türkçe karakterler ("rutin isi" → "rutin işi", "guncellendi" → "güncellendi").
  const rutin = a.rutinJobId
    ? "rutin işi: " + a.rutinJobId + (a.rutinCanli && a.rutinCanli.mevcut && a.rutinCanli.frekans
        ? " (canlı kadans " + a.rutinCanli.frekans + ")" : "")
    : "rutin işi yok — 'rutini yeniden kur' işaretleyip kaydet";
  const upd = a.guncellendi
    ? "  ·  güncellendi " + new Date(a.guncellendi).toLocaleString("tr-TR") + (a.kaynak ? " (" + a.kaynak + ")" : "")
    : "";
  el("kd-durum").textContent = rutin + upd;
}

// Kullanıcı yazarken uyarıyı canlı tut (Kaydet'e basmadan önce sonucu bilsin).
el("kd-frekans").addEventListener("input", kadansUyari);
el("kd-paralel").addEventListener("input", kadansUyari);

el("kd-kaydet").addEventListener("click", async () => {
  // apply = OTOMATİK (frekans/paralel değişti mi) VEYA kullanıcı zorladı (soğuk başlangıç /
  // bozuk rutin onarımı). Kutu artık yalnız EKLER — apply'ı asla ENGELLEMEZ.
  const oto = applyGerek();
  const govde = {
    mod: el("kd-mod").value,
    frekans: el("kd-frekans").value,
    paralel: Number(el("kd-paralel").value),
    gunlukTavan: Number(el("kd-gunluk").value),
    apply: oto || el("kd-apply").checked,
  };
  let d;
  try {
    d = await (await fetch("/api/pm/ayar", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify(govde) })).json();
  } catch { toast("kadans kaydedilemedi"); return; }
  if (!d.ok) { toast("hata: "+(d.error||"?")); return; }
  el("kd-apply").checked = false;
  // Toast DÜRÜST: rutine dokunulduysa söyle, dokunulmadıysa da söyle (eskiden her iki
  // durumda da "kadans kaydedildi" deyip ayrışmayı gizliyordu).
  toast(d.rutin ? "kadans kaydedildi · rutin yeniden kuruldu ("+(d.rutin.yeniJobId||"?")+")"
                : "kadans kaydedildi (frekans/paralel değişmedi — rutine dokunulmadı)");
  pmTick();
});

// ── Aksiyon katmanı: 🔴 onay · 🟡 doğrulanmadı · ⚠ takılan ───────────────────
// Pano SINIFLANDIRMAZ: iki tek-seçicinin (aide zamanla onay-list · dispatch.mjs durum)
// çıktısını olduğu gibi çizer. Onay eylemi tek kapıdan iner (POST /api/pm/onay →
// aide zamanla run-now). Sessiz ölüm yasak: onay bekleyen kırmızı iş EN ÜSTTE durur.
const ONAY_NEDEN = {
  "red-gate": "kırmızı valf tetiği manuale çekti",
  "red-manual": "kırmızı payload · manual tetik",
  "red-block": "kırmızı valf koşum anında parkladı",
};
const KADEME_G = { kirmizi:"🔴", sari:"🟡", yesil:"🟢" };
function kisalt(s, n){ s = String(s ?? ""); return s.length > n ? s.slice(0, n-1)+"…" : s; }

// İki adımlı onay: 1. tık SİLAHLANDIRIR (komutu düğmenin yüzüne basar), 2. tık ateşler.
// 8 sn sonra kendiliğinden geri düşer → yanlışlıkla git push ateşlenmez.
const onayArmed = new Map();   // jobId → geri-düşme zamanlayıcısı
function onayDisarm(id){ const t = onayArmed.get(id); if (t) clearTimeout(t); onayArmed.delete(id); }
function onayArm(id){
  onayArmed.set(id, setTimeout(() => { onayArmed.delete(id); renderOnay(); }, 8000));
  renderOnay();
}

// İki kova, iki anlam (kaynak: approval.mjs approvalQueue):
//   onay[]      → insan sözü BEKLİYOR  → düğme VAR
//   onaylanan[] → insan onayladı, daemon henüz ateşlemedi (hedef pane meşgul olabilir)
//                 → GÖRÜNÜR ama düğme YOK. Görünür olmalı: yoksa "onayladım, kayboldu"
//                   hissi doğar (sessiz ölüm). Düğmesiz olmalı: yoksa aynı kırmızı iş
//                   ikinci kez onaylanmaya davet edilir ve onay kapısının anlamı erir.
// Yerel set yalnız TIKLAMA ile SUNUCU TAZELEMESİ arasındaki ~1 sn için (anlık geri bildirim).
const onaylananYerel = new Set();

function onaySatir(j, onaylandiMi){
  const armed = onayArmed.has(j.id);
  const btn = onaylandiMi
    ? '<span class="onaylandi">✔ onaylandı · daemon ateşleyecek</span>'
    : armed
    ? '<button class="act btn-onay arm" data-onay="'+esc(j.id)+'" title="ikinci tık ATEŞLER">'+
      'Emin misin? 🔴 '+esc(kisalt(j.payload, 44))+'</button>'
    : '<button class="act btn-onay" data-onay="'+esc(j.id)+'" title="insan kapısı — aide zamanla run-now '+esc(j.id)+'">Onayla</button>';
  const hedef = j.cwd ? '<b>'+esc(j.cwd)+'</b> · ' : '';
  return '<div class="ak">'+
    '<span class="ak-g">'+(onaylandiMi ? "✔" : "⏳")+'</span>'+
    '<div class="ak-b">'+
      '<div><span class="ak-t">'+esc(j.title || "(başlıksız)")+'</span>'+
        '<span class="ak-n">🔴 '+esc(ONAY_NEDEN[j.reason] || j.reason || "?")+
        (j.red_pattern ? " ("+esc(j.red_pattern)+")" : "")+'</span></div>'+
      (j.payload ? '<div class="ak-c">'+esc(kisalt(j.payload, 160))+'</div>' : '')+
      '<div class="ak-m">'+hedef+'iş <b>'+esc(j.id)+'</b> · '+esc(j.state || "?")+'</div>'+
    '</div>'+btn+
  '</div>';
}

function renderOnay(){
  const box = el("pm-onay");
  if (!box) return;
  const bekleyen = (pmData && pmData.onay) || [];
  const onaylandi = (pmData && pmData.onaylanan) || [];
  // tıklama-anı işareti: iş sunucuda onaylanan[]'a geçince yerel işaret gereksizleşir
  for (const id of [...onaylananYerel])
    if (!bekleyen.some((j) => j.id === id)) onaylananYerel.delete(id);
  if (!bekleyen.length && !onaylandi.length) { box.innerHTML = ""; return; } // boşsa çizme

  let h = "";
  if (bekleyen.length)
    h += '<h2>⏳ Onay bekleyenler ('+bekleyen.length+')</h2>'+
      '<div class="pm-box kutu-onay">'+
        '<div class="aciklama">Geri alınamaz (kırmızı) iş insan onayı bekliyor. Tek onay kapısı: '+
          'aide zamanla run-now — PM dahil hiçbir otomasyon kendi kırmızı işini onaylayamaz.</div>'+
        bekleyen.map((j) => onaySatir(j, onaylananYerel.has(j.id))).join("")+
      '</div>';
  if (onaylandi.length)
    h += '<h2>✔ Onaylandı · ateşlenmeyi bekliyor ('+onaylandi.length+')</h2>'+
      '<div class="pm-box kutu-onay">'+
        '<div class="aciklama">Onay verildi. Daemon ilk uygun tick de ateşler (hedef pane meşgulse bekler). '+
          'TEKRAR ONAYLAMA gerekmez.</div>'+
        onaylandi.map((j) => onaySatir(j, true)).join("")+
      '</div>';
  box.innerHTML = h;
}

function renderDogrulanmamis(){
  const box = el("pm-dogrulanmamis");
  if (!box) return;
  const list = (pmData && pmData.dogrulanmamis) || [];
  if (!list.length) { box.innerHTML = ""; return; }
  const satir = (r) => {
    const yer = r.hedefProje ? '<b>'+esc(String(r.hedefProje).split("/").pop())+'</b> · ' : '';
    const yas = r.askida ? '<span class="ak-n">askıda · '+esc(r.yasSaat)+' saattir akıbetsiz</span>' : '';
    return '<div class="ak">'+
      '<span class="ak-g">'+(KADEME_G[r.kademe] || "•")+'</span>'+
      '<div class="ak-b">'+
        '<div class="ak-c">'+esc(kisalt(r.komut, 160))+'</div>'+
        '<div class="ak-m">'+yer+'iş <b>'+esc(r.jobId || "?")+'</b> · '+esc(r.jobState || "?")+
          (r.epic ? ' · epik '+esc(r.epic) : '')+' '+yas+'</div>'+
      '</div>'+
    '</div>';
  };
  box.innerHTML = '<h2>🟡 Doğrulanmadı ('+list.length+')</h2>'+
    '<div class="pm-box kutu-sari">'+
      '<div class="aciklama">Dağıtıldı ama kanıtı gelmedi. Bu bir ONAY DEĞİL — onaylanacak bir şey yok, '+
        'düğmesi de yok: işi KANIT kapatır (PM koşumu mutabakatta doğrular).</div>'+
      list.map(satir).join("")+
    '</div>';
}

// ── 🔎 SONUÇ İNCELEMESİ — kabul mü, geri bildirimle yeniden koşum mu? ─────────
// Makine kanıtı ("job done") işin KOŞTUĞUNU söyler, İSTENEN şeyi yaptığını DEĞİL. Bu bölüm
// o boşluğu kapatır: tamamlanmış (dogrulandi) işleri insan gözünden geçirir.
//   KABUL = EYLEMSİZLİK. İş zaten kapalı; deftere bir şey yazılmaz, hiçbir şey ateşlenmez —
//           düğme yalnız satırı bu oturumun ekranından düşürür (yerel).
//   RED    = tek gerçek eylem: dispatch.mjs reddet → defter reddedildi ile kapanır VE geri
//           bildirim PM gelen kutusuna düşer → PM DÜZELTİLMİŞ işi dağıtır (kör tekrar değil).
const kabulEdilen = new Set();  // yerel kabul (defter otoritedir; yenilemede geri gelmez —
                                // satır zaten kapalıdır, tazelemede yeniden listelenir ama
                                // bu Set aynı sekmede onu gizli tutar)
const redAcik = new Set();      // geri bildirim kutusu açık olan parmak izleri

function renderIncelenecek(){
  const box = el("pm-incelenecek");
  if (!box) return;
  const list = ((pmData && pmData.incelenecek) || []).filter(r => !kabulEdilen.has(r.fingerprint));
  if (!list.length) { box.innerHTML = ""; return; }
  const satir = (r) => {
    const yer = r.hedefProje ? '<b>'+esc(String(r.hedefProje).split("/").pop())+'</b> · ' : '';
    const form = redAcik.has(r.fingerprint)
      ? '<div class="red-form">'+
          '<textarea data-redtext="'+esc(r.fingerprint)+'" placeholder="Neyin yanlış, ne bekleniyordu? Gerekçesiz red yok — PM düzeltmeyi buna göre tasarlar."></textarea>'+
          '<button class="act btn-red" data-redgonder="'+esc(r.fingerprint)+'">Gönder</button>'+
        '</div>'
      : '';
    return '<div class="ak">'+
      '<span class="ak-g">'+(KADEME_G[r.kademe] || "•")+'</span>'+
      '<div class="ak-b">'+
        '<div class="ak-c">'+esc(kisalt(r.komut, 160))+'</div>'+
        '<div class="ak-m">'+yer+"iş <b>"+esc(r.jobId || "?")+"</b> · kanıt: "+
          esc(kisalt(r.kanit || "?", 90))+" · "+esc(r.fingerprint)+'</div>'+
      '</div>'+
      '<button class="act btn-kabul" data-kabul="'+esc(r.fingerprint)+
        '" title="kabul = bir şey yapmana gerek yok; iş zaten kapalı. Düğme yalnız satırı gizler.">Kabul</button>'+
      '<button class="act btn-red" data-red="'+esc(r.fingerprint)+
        '" title="reddet + geri bildirim → PM düzeltilmiş işi dağıtır (yeni parmak izi)">Reddet + geri bildirim</button>'+
      form+
    '</div>';
  };
  box.innerHTML = '<h2>🔎 Sonuç incelemesi ('+list.length+')</h2>'+
    '<div class="pm-box kutu-inceleme">'+
      '<div class="aciklama">'+
        "Makine kanıtı geldi (job done) — ama iş DOĞRU mu yapıldı? Bunu yalnız sen söyleyebilirsin. "+
        "KABUL = bir şey yapmana gerek yok: iş zaten kapalı, hiçbir düğmeye basmasan da olur. "+
        "REDDET = gerekçeni yaz: defter reddedildi ile kapanır ve geri bildirimin PM gelen kutusuna "+
        "düşer; PM aynı işi tekrar ateşlemez, DÜZELTİLMİŞ işi dağıtır."+
      '</div>'+
      list.map(satir).join("")+
    '</div>';
}

// Kabul / Reddet / Gönder — tek delege dinleyici (onay düğmesinin deseni).
document.addEventListener("click", async (e) => {
  const k = e.target.closest?.("[data-kabul]");
  if (k) {
    kabulEdilen.add(k.dataset.kabul);
    redAcik.delete(k.dataset.kabul);
    toast("kabul — bir şey yapılmadı (iş zaten kapalıydı; defter değişmedi)");
    renderIncelenecek();
    return;
  }
  const a = e.target.closest?.("[data-red]");
  if (a) {
    redAcik.add(a.dataset.red);
    renderIncelenecek();
    const t = document.querySelector('[data-redtext="'+a.dataset.red+'"]');
    if (t) t.focus();
    return;
  }
  const g = e.target.closest?.("[data-redgonder]");
  if (!g) return;
  const fp = g.dataset.redgonder;
  const t = document.querySelector('[data-redtext="'+fp+'"]');
  const gb = t ? t.value.trim() : "";
  // Gerekçesiz red YOK: boş geri bildirim gönderilmez (sunucu da reddeder — ikinci savunma).
  if (!gb) { toast("red gerekçesiz olamaz — neyin yanlış olduğunu yaz"); if (t) t.focus(); return; }
  g.disabled = true;
  let d;
  try {
    d = await (await fetch("/api/pm/reddet", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ fingerprint: fp, geriBildirim: gb }) })).json();
  } catch { toast("reddedilemedi"); g.disabled = false; return; }
  if (!d.ok) { toast("hata: "+(d.error||"?")); g.disabled = false; return; }
  redAcik.delete(fp);
  toast(d.gelenNotu
    ? "reddedildi · PM düzeltilmiş işi dağıtacak (gelen/"+d.gelenNotu+")"
    : "reddedildi · UYARI: gelen notu YAZILAMADI — PM düzeltmeyi görmeyecek, elle besle");
  pmTick();   // tazele: satır artık dogrulandi değil → listeden düşer
});

function renderTakilan(){
  const box = el("pm-takilan");
  if (!box) return;
  const list = (pmData && pmData.takilan) || [];
  if (!list.length) { box.innerHTML = ""; return; }
  const satir = (j) => '<div class="ak">'+
    '<span class="ak-g">'+(j.state === "failed" ? "✗" : "⏸")+'</span>'+
    '<div class="ak-b">'+
      '<div><span class="ak-t">'+esc(j.title || "(başlıksız)")+'</span></div>'+
      '<div class="ak-m">hata: '+esc(kisalt(j.last_error || "?", 120))+
        (j.fail_count ? ' ('+esc(j.fail_count)+' ardışık)' : '')+'</div>'+
      // U1: komut ÇALIŞTIRILABİLİR olmalı — "zamanla" PATH'te YOK, "aide" var.
      '<div class="ak-m">onar: <b>aide zamanla run-now '+esc(j.id)+'</b> · iptal: <b>aide zamanla cancel '+esc(j.id)+'</b></div>'+
    '</div>'+
  '</div>';
  box.innerHTML = '<h2>⚠ Takılan iş ('+list.length+')</h2>'+
    '<div class="pm-box kutu-takilan">'+
      '<div class="aciklama">ONAY KUYRUĞU DEĞİL: bu işler koştu/koşamadı ve durdu — onarım ya da iptal ister.</div>'+
      list.map(satir).join("")+
    '</div>';
}

// Onayla düğmesi — iki adımlı. Ateşleme sunucuya iner; istemci komut kurmaz.
document.addEventListener("click", async (e) => {
  const n = e.target.closest?.("[data-onay]");
  if (!n) return;
  const id = n.dataset.onay;
  if (!onayArmed.has(id)) { onayArm(id); toast("emin misin? ateşlemek için tekrar tıkla"); return; }
  onayDisarm(id);
  n.disabled = true;
  let d;
  try {
    d = await (await fetch("/api/pm/onay", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ jobId: id }) })).json();
  } catch { toast("onaylanamadı"); renderOnay(); return; }
  if (!d.ok) { toast("hata: "+(d.error||"?")); renderOnay(); return; }
  onaylananYerel.add(id);   // anlık geri bildirim; sunucu tazelemesinde onaylanan[]'a geçer
  toast("🔴 onaylandı — daemon ateşleyecek ("+esc(id)+")");
  pmTick();   // tazele: iş "Onay bekleyenler"den "Onaylandı"ya kayar (düğmesiz)
});

function renderDocList(){
  const grup = (ad, items) => '<div class="dh">'+ad+'</div>' + items.map(d =>
    '<button class="doc-item'+(docSel===d.path?' on':'')+(d.var===false?' yok':'')+'" data-doc="'+esc(d.path)+'" '+
    'title="'+esc(d.path)+'">'+esc(d.etiket)+'</button>').join("");
  const viz = (pmData.vizyon||[]).map(v => ({ path:v.path, var:v.var, etiket:(v.kapsam==="portföy"?"◎ portföy":v.kapsam)+(v.var?"":" (oluştur)") }));
  const docs = (pmData.docs||[]).map(p => ({ path:p, var:true, etiket:p.replace(/^docs\\//,"") }));
  el("doc-list").innerHTML = grup("Vizyon", viz) + grup("Mimari / docs", docs);
}
document.addEventListener("click", (e) => {
  const n = e.target.closest?.("[data-doc]");
  if (!n) return;
  if (docEdit && !confirm("Düzenleme açık — kaydetmeden geçilsin mi?")) return;
  docEdit = false; docSel = n.dataset.doc;
  renderDocList(); loadDoc(docSel, "doc-pane", true);
});

// hafif md → html (tam parser DEĞİL: başlık/bold/kod/liste/alıntı yeter)
function mdHtml(md){
  const lines = esc(md).split("\\n");
  let h = "", inCode = false, inList = false;
  for (const L of lines){
    if (L.startsWith("\`\`\`")) { h += inCode ? "</pre>" : "<pre>"; inCode = !inCode; continue; }
    if (inCode) { h += L+"\\n"; continue; }
    let x = L.replace(/\`([^\`]+)\`/g,"<code>$1</code>").replace(/\\*\\*([^*]+)\\*\\*/g,"<b>$1</b>");
    const li = /^\\s*[-*] (.*)$/.exec(x);
    if (li) { if(!inList){h+="<ul>";inList=true;} h+="<li>"+li[1]+"</li>"; continue; }
    if (inList){ h+="</ul>"; inList=false; }
    if (/^### /.test(x)) h += "<h3>"+x.slice(4)+"</h3>";
    else if (/^## /.test(x)) h += "<h2>"+x.slice(3)+"</h2>";
    else if (/^# /.test(x)) h += "<h1>"+x.slice(2)+"</h1>";
    else if (/^&gt; ?/.test(x)) h += "<blockquote>"+x.replace(/^&gt; ?/,"")+"</blockquote>";
    else if (x.trim()==="") h += "<br>";
    else h += "<p>"+x+"</p>";
  }
  if (inList) h += "</ul>";
  if (inCode) h += "</pre>";
  return h;
}

async function loadDoc(path, target, editable){
  let d;
  try { d = await (await fetch("/api/pm/doc?path="+encodeURIComponent(path))).json(); }
  catch { return; }
  if (!d.ok) { el(target).innerHTML = '<p class="empty">'+esc(d.error||"okunamadı")+'</p>'; return; }
  docMtime = d.mtime;
  if (!editable) { el(target).innerHTML = '<div class="doc-view">'+mdHtml(d.content||"(boş)")+'</div>'; return; }
  // Vizyon dokümanında hızlı EKLEME kutusu: üst-hedefe gelen kutusundan nasıl ekleniyorsa,
  // vizyona da buradan eklenir — tüm gövdeyi düzenlemeye girmeden, §Varılmak istenen'e append.
  const vz = /(^|\\/)vizyon\\.md$/.test(path);
  el(target).innerHTML =
    '<div class="doc-bar"><span class="p">'+esc(path)+'</span>'+
    '<button id="doc-duzenle">Düzenle</button></div>'+
    '<div id="doc-conf"></div>'+
    (vz ? '<div class="pm-form viz-ekle">'+
      '<textarea id="viz-text" rows="2" placeholder="Vizyona ekle — varılmak istenen noktayı kendi sözünle yaz (kullanıcı bölgesine damgalı eklenir; PM asla budamaz)…"></textarea>'+
      '<div class="opts"><button id="viz-ekle">＋ Vizyona ekle</button></div></div>' : "")+
    '<div class="doc-view" id="doc-goster">'+mdHtml(d.content||"(boş — ＋ Vizyona ekle ya da Düzenle ile oluştur)")+'</div>';
  if (vz) el("viz-ekle").addEventListener("click", vizyonEkleGonder);
  el("doc-duzenle").addEventListener("click", () => {
    docEdit = true;
    el("doc-goster").outerHTML =
      '<div class="doc-edit"><textarea id="doc-ta" rows="18">'+esc(d.content||"")+'</textarea>'+
      '<div class="doc-bar" style="margin-top:8px"><button id="doc-kaydet">Kaydet</button>'+
      '<button id="doc-vazgec">Vazgeç</button></div></div>';
    el("doc-kaydet").addEventListener("click", saveDoc);
    el("doc-vazgec").addEventListener("click", () => { docEdit = false; loadDoc(docSel, "doc-pane", true); });
  });
}

async function saveDoc(){
  const content = el("doc-ta").value;
  let d;
  try {
    d = await (await fetch("/api/pm/doc", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ path: docSel, content, mtime: docMtime }) })).json();
  } catch { toast("kaydedilemedi"); return; }
  if (d.ok) { docEdit = false; toast("kaydedildi"); loadDoc(docSel, "doc-pane", true); pmTick(); }
  else if (d.mtime !== undefined) {
    el("doc-conf").innerHTML = '<div class="conflict">Dosya bu arada değişti (PM yazmış olabilir). '+
      '<button id="doc-yenile">Yeniden yükle</button> — düzenlemen panoda kalır, kopyala.</div>';
    el("doc-yenile").addEventListener("click", () => { docEdit=false; loadDoc(docSel, "doc-pane", true); });
  } else toast("hata: "+(d.error||"?"));
}

/** Vizyona ekle — dosya yoksa sunucu sözleşme iskeletini kurar, sonra damgalı append. */
async function vizyonEkleGonder(){
  const text = el("viz-text").value;
  if (!text.trim()) { toast("vizyon notu boş"); return; }
  let d;
  try {
    d = await (await fetch("/api/pm/vizyon", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ path: docSel, text }) })).json();
  } catch { toast("eklenemedi"); return; }
  if (!d.ok) { toast("hata: "+(d.error||"?")); return; }
  el("viz-text").value = "";
  toast(d.olusturuldu ? "vizyon oluşturuldu + eklendi" : "vizyona eklendi");
  loadDoc(docSel, "doc-pane", true);   // taze gövde (mtime da tazelenir)
  pmTick();                            // "(oluştur)" etiketi düşsün
}

el("pm-gonder").addEventListener("click", async () => {
  const text = el("pm-text").value;
  if (!text.trim()) { toast("not boş"); return; }
  let d;
  try {
    d = await (await fetch("/api/pm/gelen", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ text, tip: el("pm-tip").value, proje: el("pm-proje").value || undefined,
        oncelik: el("pm-onc").value || undefined, simdiIsle: el("pm-simdi").checked }) })).json();
  } catch { toast("bırakılamadı"); return; }
  if (!d.ok) { toast("hata: "+(d.error||"?")); return; }
  el("pm-text").value = "";
  toast(d.isleJobu ? (d.isleJobu.ok ? "not bırakıldı · işleme kuyruğa alındı ("+(d.isleJobu.id||"?")+")" : "not bırakıldı · kuyruklanamadı: "+d.isleJobu.error)
                   : "not bırakıldı — bir sonraki PM koşumu işler");
  pmTick();
});

let data = null;
function render(){
  if (!data) return;
  renderPmGoals(data.pmGoals);
  const projects = data.projects.map(p => ({...p, _vis: visibleEpics(p)}));
  const allEpics = projects.flatMap(p => p._vis);
  const c = { openEpics:0, active:0, planned:0, stale:0, paused:0, openTasks:0, backlog:0 };
  for (const e of allEpics) {
    if (c[e.status] != null) c[e.status]++;
    // planned = PM hedefi konmuş, iş başlamamış → hâlâ AÇIK iş
    if (["active","planned","stale","paused"].includes(e.status)) c.openEpics++;
    c.openTasks += e.progress.openActive;
  }
  c.backlog = projects.reduce((n,p)=>n+(p.backlog?.length||0), 0);
  el("cards").innerHTML = [
    ["Açık epik", c.openEpics], ["▶ Aktif", c.active], ["◑ Bayat", c.stale],
    ["⏸ Duraklamış", c.paused], ["Açık task", c.openTasks], ["Backlog", c.backlog],
  ].map(([k,v])=>'<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>').join("");
  const html = data.projects.map(projHtml).join("");
  el("projects").innerHTML = html || '<p class="empty">Bu aralıkta görünür iş yok — aralığı genişlet ya da tamamlananları aç.</p>';
}

async function tick(){
  const url = "/api/state" + (state.project ? "?project="+encodeURIComponent(state.project) : "");
  let d;
  try { d = await (await fetch(url)).json(); }
  catch { el("at").textContent = "bağlantı yok"; return; }
  el("at").textContent = "güncellendi " + new Date(d.at).toLocaleTimeString("tr-TR");
  if (d.error) { el("err").innerHTML = '<div class="err-banner">türetme hatası: '+esc(d.error)+'</div>'; if (!data) return; }
  else { el("err").innerHTML = ""; data = d; fillProjects(d.allProjects, d.scope ?? ""); }
  render();
}
setTab(tab);
tick(); setInterval(tick, 15000);
pmTick(); setInterval(pmTick, 15000);   // PM sekmesi kapalıyken de rozet güncel kalır
grafTick(); setInterval(grafTick, 30000);   // graf rozeti: TTL 5sn « 30sn → poll başına ≤1 spawn

/* ---- Yük sekmesi: eşzamanlı AI yükü (kaynak: aide yuk --json → core/src/yuk.ts) ----
   Pano HESAP YAPMAZ; gelen snapshot'ı olduğu gibi gösterir (salt-okur doktrini). */
let yukData = null;
const yukAcik = new Set();   // açık (genişletilmiş) oturum satırları — poll bunu KORUR
let yukDoc = null;           // okunan plan dosyası (proje-göreli yol)
const YUK_LABEL = { generating:"üretiyor", waiting:"bekliyor", error:"hata", done:"bitti", seen:"görüldü", idle:"boşta" };
function fmtYuk(t){
  if (!isFinite(t) || t <= 0) return "0 tok/sn";
  if (t >= 1000) return "~"+(t/1000).toFixed(1)+"k tok/sn";
  return "~"+(t < 10 ? t.toFixed(1) : Math.round(t))+" tok/sn";
}
async function yukTick(){
  // Sekme kapalıyken taramayı boşuna koşturma — tek istisna rozet, o da ucuz değil
  // (her çağrı bir bun süreci) → rozet yalnız sekme açıkken tazelenir.
  if (tab !== "yuk") return;
  try {
    const r = await fetch("/api/yuk");
    yukData = await r.json();
  } catch { yukData = { hata: "bağlantı yok" }; }
  renderYuk();
}
function renderYuk(){
  const y = yukData;
  if (!y) return;
  const note = el("yuk-note");
  if (y.yok || y.hata) {
    // Kapsam dışıysa SÖYLE — boş panel "yük yok" diye okunur, o bir yalandır.
    el("yuk-tps").textContent = "—";
    el("yuk-meta").textContent = "";
    el("yuk-gruplar").innerHTML = ""; el("yuk-sessions").innerHTML = "";
    note.textContent = y.yok
      ? "aide CLI bulunamadı (~/dev/agent-ide) — yük çekirdeği okunamıyor."
      : "yük okunamadı: " + y.hata;
    return;
  }
  // Bayat veriyi taze gibi gösterme (Ders 16) — çekirdekle aynı 30sn eşiği.
  const bayat = !y.ts || Date.now() - y.ts > 30000;
  el("yukview").classList.toggle("yuk-stale", bayat);

  el("yuk-tps").textContent = fmtYuk(y.tokPerSec);
  el("yuk-win").textContent = y.windowSec + "sn ort. · yaklaşık";
  el("yuk-meta").innerHTML =
    "<b>"+y.liveCount+"</b> canlı oturum · <b>"+y.generatingCount+"</b> üretiyor<br>"+
    y.outTokens.toLocaleString("tr-TR")+" token / son "+y.windowSec+"sn<br>"+
    "<span style='opacity:.7'>"+y.olculenDosya+" transcript ölçüldü</span>";

  // Kapasite tavanı benchmark'ı (kapasite.ts; anlık hız = tüm-token/sn, cache_read hariç).
  const k = y.kapasite;
  if (k) {
    el("kap-mod-5h").classList.toggle("on", k.mod === "5h");
    el("kap-mod-weekly").classList.toggle("on", k.mod === "weekly");
    if (k.ayarli) {
      const pct = Math.round(k.doluluk * 100);
      const asiri = k.doluluk > 1;
      const fill = el("kap-fill");
      fill.style.width = Math.min(100, pct) + "%";
      fill.classList.toggle("asiri", asiri);
      el("kap-pct").textContent = pct + "%" + (asiri ? " ⚠" : "");
      const dk = Math.round(k.kalanSaniye / 60);
      el("kap-det").innerHTML =
        "anlık <b>"+Math.round(k.anlikHiz)+"</b> / sürdürülebilir <b>"+Math.round(k.surdurulebilir)+"</b> tok/sn · "+
        "resete "+dk+"dk · yakılan %"+Math.round(k.yakilanYuzde*100)+" ("+(k.limit?k.limit.toLocaleString("tr-TR"):"—")+" tok)"+
        (asiri ? " · <span class='uyari'>bu hızla limiti resetten önce bitirirsin</span>" : "");
    } else {
      el("kap-fill").style.width = "0";
      el("kap-pct").textContent = "ayarsız";
      el("kap-det").innerHTML = "Anthropic token tavanını vermiyor — <b>Limiti ayarla</b> ile 5h/haftalık bütçeni ve reset anını gir.";
    }
  }

  const mx = Math.max(...y.buckets.map(b=>b.out), 1);
  el("yuk-spark").innerHTML = y.buckets
    .map(b=>'<i style="height:'+Math.max(1, Math.round(b.out/mx*44))+'px"></i>').join("");

  el("yuk-gruplar").innerHTML = y.groups.length ? y.groups.map(g =>
    '<div class="yuk-row'+(g.tokPerSec?"":" zero")+'">'+
      '<span class="nm"><b>'+esc(g.label)+'</b> <span style="opacity:.6">· '+g.liveCount+' oturum</span></span>'+
      '<span class="yuk-bar"><i style="width:'+pct(g.tokPerSec, y.tokPerSec)+'%"></i></span>'+
      '<span class="val">'+fmtYuk(g.tokPerSec)+'</span>'+
    '</div>').join("") : '<p class="empty">Canlı oturum yok.</p>';

  const smax = Math.max(...y.sessions.map(s=>s.tokPerSec), 0.001);
  el("yuk-sessions").innerHTML = y.sessions.length ? y.sessions.map(s =>
    '<div class="yuk-row tik'+(s.tokPerSec?"":" zero")+'" data-sid="'+esc(s.id)+'">'+
      '<span class="cev">'+(yukAcik.has(s.id)?"▾":"▸")+'</span>'+
      '<span class="yuk-dot '+esc(s.state)+'" title="'+esc(YUK_LABEL[s.state]||s.state)+'"></span>'+
      '<span class="nm">'+esc(s.title)+
        ' <span style="opacity:.55">· '+esc(s.dirName)+' · '+esc(s.surface)+'</span></span>'+
      '<span class="yuk-bar"><i style="width:'+pct(s.tokPerSec, smax)+'%"></i></span>'+
      '<span class="val">'+fmtYuk(s.tokPerSec)+'</span>'+
    '</div>'+
    (yukAcik.has(s.id) ? oturumDetay(s) : "")
  ).join("") : '<p class="empty">Canlı oturum yok.</p>';

  // Planlar & aşamalar — PLAN KAYDI (STATE.md), nabızla karıştırılmaz.
  el("yuk-planlar").innerHTML = (y.projeler||[]).length ? y.projeler.map(pr =>
    pr.planlar.map(pl => planKutu(pr, pl)).join("")
  ).join("") : '<p class="empty">Canlı oturumu olan projede plan ağacı yok.</p>';

  const n = [];
  if (bayat) n.push("veri bayat (>30sn) — çekirdek yanıt vermiyor olabilir.");
  if (y.atifsizOut > 0) n.push("atıfsız "+y.atifsizOut.toLocaleString("tr-TR")+
    " token: pencerede üretilmiş ama oturumu artık canlı değil (toplama DAHİL).");
  if (y.planBagsiz > 0) n.push(y.planBagsiz+"/"+y.liveCount+
    " oturumun plan bağı yok (çoğu meşru: elle açılan oturum bir plan aşaması koşturmuyordur).");
  if (y.kirpildi) n.push("UYARI: okuma penceresi tavana çarptı — veri kırpılmış olabilir.");
  note.textContent = n.join(" ");
}

/** Oturum detayı: NE yapıyor (üç kaynak, üçü ayrı etiketli — karıştırılmaz). */
function oturumDetay(s){
  const b = s.baglam || {};
  const g = b.gorev, nb = b.nabiz, p = b.plan;
  let h = '<div class="yuk-det">';
  h += '<div><span class="k">istek</span><br>'+(b.istek ? esc(b.istek) : '<span class="yok">—</span>')+'</div>';
  h += '<div><span class="k">görev</span><br>'+ (g
    ? '<b>'+esc(g.baslik)+'</b>'+(g.kategori?' <span class="chip">'+esc(g.kategori)+'</span>':'')+
      (g.amac?'<br><span style="opacity:.75">'+esc(g.amac)+'</span>':'')
    : '<span class="yok">epic üyeliği yok — bu oturum bir göreve açıkça yazılmamış</span>')+'</div>';
  h += '<div><span class="k">şu an (canlı todo)</span><br>'+ (nb
    ? (nb.suanki ? '<span class="suan">▸ '+esc(nb.suanki)+'</span>' : '<span class="yok">açık madde yok</span>')+
      ' <span style="opacity:.6">· '+nb.acik+'/'+nb.toplam+' açık</span>'
    : '<span class="yok">todo defteri yok</span>')+'</div>';
  h += '<div><span class="k">plan</span><br>'+ (p
    ? '<span class="yuk-plan"><b>'+esc(p.baslik||p.slug)+'</b>'+
      '<span class="chip">'+esc(p.slug)+'/'+esc(p.v)+'</span>'+
      (p.asamaNo!=null?'<span class="rz '+esc(p.asamaDurum||"")+'">aşama '+esc(p.asamaNo)+' · '+esc(p.asamaDurum||"?")+'</span>':'')+
      '<span style="opacity:.6">'+p.asamaKapali+'/'+p.asamaToplam+' aşama kapalı</span>'+
      '<button data-plan-cwd="'+esc(s.cwd)+'" data-plan-path="'+esc(p.dosya)+'">planı oku</button>'+
      '<span style="opacity:.5;font-size:10px">kaynak: '+esc(p.kaynak)+'</span></span>'
    : '<span class="yok">plan bağı yok — uydurulmadı. (Dispatch edilen /goal işleri planına bağlı doğar.)</span>')+'</div>';
  return h + '</div>';
}

/** Plan kutusu: aşama aşama GERÇEKLEŞEN durum + tıklayınca oku. */
function planKutu(pr, pl){
  const kapali = pl.asamalar.filter(a=>a.durum==="KAPALI").length;
  let h = '<div class="plan-box">';
  h += '<div class="plan-hd"><b>'+esc(pl.baslik||pl.slug)+'</b>'+
       '<span class="chip">'+esc(pl.slug)+'/'+esc(pl.v)+'</span>'+
       (pl.kategori?'<span class="chip">'+esc(pl.kategori)+'</span>':'')+
       '<span style="opacity:.5;font-size:11px">'+esc(pr.dirName)+'</span>'+
       '<span class="ilerleme">'+kapali+'/'+pl.asamalar.length+' aşama kapalı'+
       (pl.siradaki?.no?' · sıradaki '+esc(pl.siradaki.no):'')+'</span></div>';
  h += pl.asamalar.length ? pl.asamalar.map(a =>
      '<div class="asama'+(a.dosya?'':' pasif')+(yukDoc===a.dosya?' aktif':'')+'"'+
        (a.dosya?' data-plan-cwd="'+esc(pr.cwd)+'" data-plan-path="'+esc(a.dosya)+'"':'')+'>'+
        '<span class="no">'+esc(a.no)+'</span>'+
        '<span class="rz '+esc(a.durum)+'">'+esc(a.durum)+'</span>'+
        '<span>'+esc(a.ad)+'</span>'+
        (a.dosya?'':'<span style="opacity:.5;font-size:10px">(dosya yok)</span>')+
      '</div>').join("")
    : '<p class="empty">STATE.md aşama tablosu yok.</p>';
  if (pl.master) h += '<div class="asama" data-plan-cwd="'+esc(pr.cwd)+'" data-plan-path="'+esc(pl.master)+'">'+
    '<span class="no">▤</span><span style="opacity:.75">MASTER.md — planın tamamı</span></div>';
  return h + '</div>';
}

/** Plan/aşama dosyasını OKU (salt-okunur route; pano proje kaynağına yazmaz). */
async function planOku(cwd, path){
  yukDoc = path;
  el("yuk-doc").style.display = "";
  el("yuk-doc-ad").textContent = path;
  el("yuk-doc-govde").innerHTML = '<p class="empty">yükleniyor…</p>';
  let d;
  try {
    d = await (await fetch("/api/plan?cwd="+encodeURIComponent(cwd)+"&path="+encodeURIComponent(path))).json();
  } catch { d = { ok:false, error:"bağlantı yok" }; }
  el("yuk-doc-govde").innerHTML = d.ok ? mdHtml(d.content) : '<p class="empty">okunamadı: '+esc(d.error||"?")+'</p>';
  el("yuk-doc").scrollIntoView({ behavior:"smooth", block:"nearest" });
  renderYuk();
}

// Tıklama: satır aç/kapa · "planı oku" · aşama satırı (olay DELEGASYONU — poll
// innerHTML'i yeniden yazdığı için elemana doğrudan listener bağlamak ölü buton üretir).
el("yukview").addEventListener("click", (e) => {
  // Kapasite: mod switch (5h/weekly) — tek tık config'i günceller.
  const km = e.target.closest("[data-kap-mod]");
  if (km) { e.stopPropagation(); kapAyarla({ mod: km.dataset.kapMod }); return; }
  if (e.target.id === "kap-ayarla") { e.stopPropagation(); kapLimitSor(); return; }
  const pb = e.target.closest("[data-plan-path]");
  if (pb) { e.stopPropagation(); planOku(pb.dataset.planCwd, pb.dataset.planPath); return; }
  const row = e.target.closest(".yuk-row.tik");
  if (row) {
    const id = row.dataset.sid;
    if (yukAcik.has(id)) yukAcik.delete(id); else yukAcik.add(id);
    renderYuk();
  }
});
el("yuk-doc-kapat").addEventListener("click", () => {
  el("yuk-doc").style.display = "none"; yukDoc = null; renderYuk();
});
function pct(v, max){ return Math.max(0, Math.min(100, (v/(max||1))*100)); }

// Kapasite config'ini güncelle (POST → aide yuk-limit set; pano hesap yapmaz).
async function kapAyarla(patch){
  try {
    const r = await (await fetch("/api/yuk-limit", { method:"POST",
      headers:{ "content-type":"application/json" }, body: JSON.stringify(patch) })).json();
    if (r.ok === false) toast("kapasite: " + (r.error||"hata"));
    else { toast("kapasite güncellendi"); yukTick(); }
  } catch { toast("kapasite: bağlantı yok"); }
}
// "Limiti ayarla" — Anthropic tavanı vermediği için değerleri kullanıcı girer.
function kapLimitSor(){
  const b5 = prompt("5 saatlik token bütçesi (deneyimsel, ör. 40000000). Boş = değiştirme:");
  const patch = {};
  if (b5 && b5.trim()) patch["5h"] = Number(b5.trim());
  const r5 = prompt("5h reset anı — ISO ya da boş='şimdiden +5h':", "");
  if (r5 !== null) patch.reset5h = r5.trim() || new Date(Date.now()+5*3600e3).toISOString();
  const bw = prompt("Haftalık token bütçesi (boş = değiştirme):");
  if (bw && bw.trim()) patch.weekly = Number(bw.trim());
  if (Object.keys(patch).length) kapAyarla(patch);
}
setInterval(yukTick, 5000);   // yalnız sekme açıkken iş yapar (yukTick'in ilk satırı)
if (tab === "yuk") yukTick();
</script>
</body></html>`;
}

// ── CLI önbelleği — TTL memoize + single-flight (aşama 24) ──────────────────
// Deterministik motor · 0 token. İki dert birden:
//  (1) her istek yeni bun süreci doğuruyordu — ölçüm: `sistem-graf --json` 3.77sn / 476KB.
//  (2) execFileSync SENKRON: spawn sürerken node event loop DONUYOR, o pencerede
//      ucuz uçlar bile yanıt veremiyordu. Buradaki spawn ASYNC.
// Sonuç: N sekme → TTL penceresi başına ≤1 spawn (in-flight coalescing).
const CLI_CACHE = new Map(); // anahtar → { at, damga, govde }
const CLI_UCUS = new Map(); // anahtar → Promise (aynı anahtara eşzamanlı istekler TEK spawn paylaşır)
const CLI_CACHE_TAVAN = 16; // en eski `at` düşer — sınırsız anahtar (proje süzgeci) sızıntı olurdu
const CLI_MAXBUF = 8 * 1024 * 1024;

// Damga: 21'in `damga` alanı OPSİYONEL GİRDİ — gövdede varsa O kanondur, yoksa sha1
// fallback (21 gecikirse/uç damgasız kalırsa koşullu yanıt yine de çalışır).
function cliDamga(govde) {
  const m = /"damga"\s*:\s*"([^"]{1,128})"/.exec(govde);
  return m ? m[1] : createHash("sha1").update(govde).digest("hex").slice(0, 16);
}

// Async spawn — stdout elle toplanır; maxBuffer tavanı ve timeout kill'i burada.
function cliSpawnJson(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let ch;
    try {
      ch = spawn(BUN_BIN, [AIDE_CLI, ...args], { stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) { reject(e); return; }
    let out = "", uzunluk = 0, bitti = false;
    const t = setTimeout(() => son(reject, new Error("zaman aşımı: " + timeoutMs + "ms")), timeoutMs);
    function son(fn, x) {
      if (bitti) return;
      bitti = true;
      clearTimeout(t);
      try { ch.kill("SIGKILL"); } catch {}
      fn(x);
    }
    ch.stdout.on("data", (d) => {
      uzunluk += d.length;
      if (uzunluk > CLI_MAXBUF) { son(reject, new Error("maxBuffer aşıldı: " + uzunluk)); return; }
      out += d;
    });
    ch.on("error", (e) => son(reject, e));
    ch.on("close", (code) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error("aide " + args[0] + " exit " + code));
    });
  });
}

// → Promise<{ at, damga, govde, kaynak: "cache"|"spawn" }>
function cliJsonCached(anahtar, args, ttlMs, timeoutMs = 20e3) {
  const taze = CLI_CACHE.get(anahtar);
  if (taze && Date.now() - taze.at < ttlMs) return Promise.resolve({ ...taze, kaynak: "cache" });
  const ucus = CLI_UCUS.get(anahtar);
  if (ucus) return ucus; // single-flight
  const p = cliSpawnJson(args, timeoutMs)
    .then((ham) => {
      const govde = ham.trim();
      const kayit = { at: Date.now(), damga: cliDamga(govde), govde };
      CLI_CACHE.set(anahtar, kayit);
      while (CLI_CACHE.size > CLI_CACHE_TAVAN) {
        let eskiK = null, eskiAt = Infinity;
        for (const [k, v] of CLI_CACHE) if (v.at < eskiAt) { eskiAt = v.at; eskiK = k; }
        CLI_CACHE.delete(eskiK);
      }
      return { ...kayit, kaynak: "spawn" };
    })
    .finally(() => CLI_UCUS.delete(anahtar));
  CLI_UCUS.set(anahtar, p);
  return p;
}

// ── sunucu ──────────────────────────────────────────────────────────────────
const isMain = (() => {
  try { return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (isMain) {
  const args = process.argv.slice(2);
  const argPort = args.includes("--port") ? parseInt(args[args.indexOf("--port") + 1], 10) : null;
  const port = argPort || Number(process.env.KAPTAN_DASH_PORT) || 4180;
  const pmOnly = args.includes("--pm"); // `aide pm` → doğrudan PM ekranının adresini bas

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/open" && req.method === "POST") {
      let body = "";
      req.on("data", (d) => { body += d; if (body.length > 4096) req.destroy(); });
      req.on("end", async () => {
        let out;
        try {
          const { sessionId, cwd, fork } = JSON.parse(body || "{}");
          if (!sessionId) throw new Error("sessionId gerekli");
          out = await openSession(sessionId, cwd || null, !!fork);
        } catch (e) {
          out = { ok: false, error: String(e?.message || e) };
        }
        res.writeHead(out.ok ? 200 : 400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (url.pathname === "/api/state") {
      const project = url.searchParams.get("project") || null; // yalnız kapsam server-side
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(snapshot(project)));
      return;
    }
    if (url.pathname === "/api/plan" && req.method === "GET") {
      // Plan/aşama dosyasını OKU (salt-okunur; yazma yolu YOK — POST tanımlı değil).
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      try {
        const p = safePlanPath(url.searchParams.get("cwd"), url.searchParams.get("path"));
        res.end(JSON.stringify({ ok: true, path: url.searchParams.get("path"), content: readFileSync(p, "utf8") }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
      return;
    }
    if (url.pathname === "/api/yuk-limit" && req.method === "POST") {
      // Kapasite config'ini AYARLA — aide yuk-limit set (tek yazar; pano hesap yapmaz).
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      if (!AIDE_CLI) { res.end(JSON.stringify({ ok: false, error: "aide CLI yok" })); return; }
      if (!hostOk(req)) { res.end(JSON.stringify({ ok: false, error: "yalnız loopback" })); return; }
      govdeOku(req).then((raw) => {
        const body = JSON.parse(raw);
        const args = [];
        // Yalnız bilinen bayraklar; değerler string'e çevrilip geçilir (kabuk yorumu YOK).
        if (body.mod) args.push("--mod", String(body.mod));
        if (body["5h"] != null) args.push("--5h", String(body["5h"]));
        if (body.weekly != null) args.push("--weekly", String(body.weekly));
        if (body.reset5h != null) args.push("--reset5h", String(body.reset5h));
        if (body.resetWeekly != null) args.push("--reset-weekly", String(body.resetWeekly));
        if (!args.length) { res.end(JSON.stringify({ ok: false, error: "boş" })); return; }
        const out = execFileSync(BUN_BIN, [AIDE_CLI, "yuk-limit", "set", ...args], {
          encoding: "utf8", timeout: 10e3, stdio: ["ignore", "pipe", "ignore"],
        });
        res.end(out.trim() || JSON.stringify({ ok: true }));
      }).catch((e) => {
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      });
      return;
    }
    if (url.pathname === "/api/sistem-graf") {
      // Sistem grafı — 12 katmanlı TEK salt-okur projeksiyon (agent-ide core/src/sistem-graf.ts).
      // Pano İKİNCİ graf motoru YAZMAZ: CLI'ı spawn eder, projeksiyonu taşır (Ders 2).
      // memoize: TTL 12sn + single-flight — sekme başına spawn YOK (asama 24)
      if (!AIDE_CLI) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ yok: true }));
        return;
      }
      const proje = url.searchParams.get("proje");
      const istenenDamga = url.searchParams.get("damga");
      cliJsonCached("graf:" + (proje || ""), ["sistem-graf", "--json", ...(proje ? ["--proje", proje] : [])], 12e3)
        .then((r) => {
          const bas = { "content-type": "application/json; charset=utf-8", "x-kaynak": r.kaynak };
          // Koşullu yanıt: damga eşitse gövde YERİNE ~60B. Spawn'ı değil BANT GENİŞLİĞİNİ kırpar.
          // Parametresiz istek geriye uyumlu — tam gövde döner (motor damgasız da olabilir).
          if (istenenDamga && istenenDamga === r.damga) {
            res.writeHead(200, bas);
            res.end(JSON.stringify({ degismedi: true, damga: r.damga }));
            return;
          }
          res.writeHead(200, bas);
          res.end(r.govde || JSON.stringify({ yok: true }));
        })
        .catch((e) => {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ hata: String(e?.message || e) }));
        });
      return;
    }

    // K36-3: passthrough + TTL — spawn poll'dan seyrek. Pano ŞEMAYI BİLMEZ: gövde
    // CLI çıktısının KENDİSİdir, yeniden şekillendirilmez (Ders 2 / tek kod-yolu).
    // TTL'ler canvas motorunun 15sn fark/not poll'unun ALTINDA (aşama 35 tempo matrisi).
    if (url.pathname === "/api/planlanan") {
      // FİİLİ ↔ PLANLANAN farkı (aşama 32 `SGPlanFark`) — canvas fark overlay'inin kaynağı.
      if (!AIDE_CLI) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ yok: true }));
        return;
      }
      const proje = url.searchParams.get("proje");
      cliJsonCached(
        "planlanan:" + (proje || ""),
        ["sistem-graf", "--planlanan", "--json", ...(proje ? ["--proje", proje] : [])],
        12e3,
      )
        .then((r) => {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-kaynak": r.kaynak });
          res.end(r.govde || JSON.stringify({ yok: true }));
        })
        .catch((e) => {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ hata: String(e?.message || e) }));
        });
      return;
    }

    if (url.pathname === "/api/graf-ozet") {
      // Aşama 34'ün DONMUŞ 6 alanı — giriş rozetinin (graf-bdg) tek kaynağı. Ucuz uç
      // sınıfı: rozet 30sn poll eder, TTL 5sn → rozet bayat kalmaz, spawn da patlamaz.
      if (!AIDE_CLI) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ yok: true }));
        return;
      }
      const proje = url.searchParams.get("proje");
      cliJsonCached(
        "ozet:" + (proje || ""),
        ["sistem-graf", "--ozet", "--json", ...(proje ? ["--proje", proje] : [])],
        5e3,
      )
        .then((r) => {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-kaynak": r.kaynak });
          res.end(r.govde || JSON.stringify({ yok: true }));
        })
        .catch((e) => {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ hata: String(e?.message || e) }));
        });
      return;
    }

    if (url.pathname === "/sistem-agi") {
      // Graf sayfası — veri GÖMÜLMEZ: HTML /api/sistem-graf'tan çeker + 15sn poll eder
      // (talep-üzerine sidecar değişmezi). Kullanıcı girdisi ayrı argv elemanı (kabuk yok).
      // memoize: TTL 60sn + single-flight — sekme başına spawn YOK (asama 24). Şablon
      // yalnız bayraklarla değişir, veri içinde DEĞİL → uzun TTL güvenli.
      // BLOKE (asama 24 / R2): --canli-url/--olay-url bayrakları burada VERİLMİYOR — motor
      // (23) onları taşıyor ama /api/canlilik + /api/olay uçları YOK, çünkü `aide canlilik`
      // ve `aide olay` CLI yüzeyi hiç doğmadı (18/19 core'da bıraktı). Bayrağı şimdi vermek
      // canvas'ı 404'e poll ettirirdi. Ayrıntı: plans/sistem-graf/v4/kanit/asama-24/BLOKE-R2.md
      // BLOKE (asama 36 / R5): --not-url + --not-yaz-url de VERİLMİYOR. Motor not
      // sarmalını `{bagli, ham}` bekliyor (bagli = grafa bağlanmış sayaçlar); bunu üreten
      // BİR CLI YÜZEYİ YOK (`graf not liste --json` yalnız ham tarafı verir) ve pano
      // çekirdeği import EDEMEZ (R6: tek temas CLI spawn'ı). Motor bagli'siz yanıtı HATA
      // sayar, `--not-yaz-url` de `--not-url` olmadan CLI'da exit 1'dir → yazma formu da
      // bu bacağa bağlı. Ayrıntı: plans/sistem-graf/v4/kanit/asama-36/BLOKE-R5-not-url.md
      if (!AIDE_CLI) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("aide CLI yok");
        return;
      }
      const proje = url.searchParams.get("proje");
      const veriUrl = "/api/sistem-graf" + (proje ? "?proje=" + encodeURIComponent(proje) : "");
      const farkUrl = "/api/planlanan" + (proje ? "?proje=" + encodeURIComponent(proje) : "");
      cliJsonCached(
        // memoize anahtarı DEĞİŞEN argv'yi içerir: bayrak seti değişince eski HTML dönmez.
        "html:fark:" + (proje || ""),
        [
          "sistem-graf", "--html",
          "--veri-url", veriUrl,
          "--fark-url", farkUrl,
          ...(proje ? ["--proje", proje] : []),
        ],
        60e3,
      )
        .then((r) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-kaynak": r.kaynak });
          res.end(r.govde);
        })
        .catch((e) => {
          res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          res.end("sistem grafi uretilemedi: " + String(e?.message || e));
        });
      return;
    }

    if (url.pathname === "/api/yuk") {
      // Eşzamanlı AI yükü — hesap ÇEKİRDEKTE (agent-ide core/src/yuk.ts), pano yalnız
      // taşır. Kendi tarayıcısını .mjs olarak çoğaltmak ikinci motor olurdu (Ders 2).
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      if (!AIDE_CLI) { res.end(JSON.stringify({ yok: true })); return; }
      try {
        const out = execFileSync(BUN_BIN, [AIDE_CLI, "yuk", "--json"], {
          encoding: "utf8", timeout: 10e3, stdio: ["ignore", "pipe", "ignore"],
        });
        res.end(out.trim() || JSON.stringify({ yok: true }));
      } catch (e) {
        res.end(JSON.stringify({ hata: String(e?.message || e) }));
      }
      return;
    }
    const json = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    // Plan Ağı — 2D harita (Obsidian graph-view tarzı). Veri: agac --graf + runner overlay
    // (harita.mjs grafVerisi); pano ikinci graf motoru YAZMAZ, projeksiyonu sunar.
    if (url.pathname === "/api/plan-graf") {
      const cwd = url.searchParams.get("cwd") || "";
      try {
        if (!cwd || !existsSync(join(cwd, "plans"))) throw new Error("plans/ yok: " + cwd);
        json(200, grafVerisi(cwd));
      } catch (e) { json(400, { error: String(e?.message || e) }); }
      return;
    }
    if (url.pathname === "/plan-agi") {
      const cwd = url.searchParams.get("cwd") || "";
      if (!cwd || !existsSync(join(cwd, "plans"))) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("plans/ yok: " + cwd);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(haritaHtml({ proje: basename(cwd) }, { veriUrl: "/api/plan-graf?cwd=" + encodeURIComponent(cwd) }));
      return;
    }
    if (url.pathname === "/api/pm/state" && req.method === "GET") {
      try { json(200, pmState()); } catch (e) { json(500, { error: String(e?.message || e) }); }
      return;
    }
    if (url.pathname === "/api/pm/doc" && req.method === "GET") {
      try {
        const p = safeDocPath(url.searchParams.get("path"));
        if (!existsSync(p)) return json(200, { ok: true, path: url.searchParams.get("path"), content: "", mtime: 0 });
        json(200, { ok: true, path: url.searchParams.get("path"), content: readFileSync(p, "utf8"), mtime: statSync(p).mtimeMs });
      } catch (e) { json(400, { ok: false, error: String(e?.message || e) }); }
      return;
    }
    if (
      (url.pathname === "/api/pm/doc" ||
        url.pathname === "/api/pm/gelen" ||
        url.pathname === "/api/pm/vizyon" ||
        url.pathname === "/api/pm/ayar" ||
        url.pathname === "/api/pm/onay" ||
        url.pathname === "/api/pm/reddet" ||
        url.pathname === "/api/graf-not/ekle") &&
      req.method === "POST"
    ) {
      if (!hostOk(req)) return json(403, { ok: false, error: "yalnız loopback" });
      // CSRF: application/json ŞART → preflight zorunlu → çapraz-origin sayfa yazamaz.
      if (!ctOk(req)) return json(415, { ok: false, error: "content-type application/json olmalı" });
      let body = "";
      req.on("data", (d) => { body += d; if (body.length > 262144) req.destroy(); }); // 256KB
      req.on("end", async () => {
        try {
          const b = JSON.parse(body || "{}");
          if (url.pathname === "/api/pm/doc") {
            const p = safeDocPath(b.path);
            // iyimser eşzamanlılık: PM bu arada §Rota yazmış olabilir — sessiz ezme yasak
            const cur = existsSync(p) ? statSync(p).mtimeMs : 0;
            if ((b.mtime ?? 0) !== cur) return json(409, { ok: false, error: "dosya değişti", mtime: cur });
            if (typeof b.content !== "string") throw new Error("content gerekli");
            atomicWrite(p, b.content);
            return json(200, { ok: true, mtime: statSync(p).mtimeMs });
          }
          if (url.pathname === "/api/pm/vizyon") {
            // Vizyona doğrudan ekleme — yalnız §Varılmak istenen (kullanıcı bölgesi).
            // mtime çakışma kapısı GEREKMEZ: append tüm gövdeyi ezmez, dosya taze okunur.
            return json(200, { ok: true, ...vizyonEkle(b) });
          }
          if (url.pathname === "/api/pm/ayar") {
            // Kadran — pano ayar.json'a YAZMAZ, tek yazarı (ayar.mjs) çağırır.
            const r = await ayarYaz(b);
            return json(r.ok === false ? 400 : 200, r);
          }
          if (url.pathname === "/api/pm/onay") {
            // 🔴 ONAY — insan kapısı. Pano job state'ine DOKUNMAZ, tek kapıyı çağırır:
            // `aide zamanla run-now <id>`. İkinci bir override yolu (--force) YOK; bu uç nokta
            // yalnız kullanıcının iki adımlı tıklamasıyla ve loopback Host ile açılır.
            const r = await onayEt(b.jobId);
            return json(r.ok === false ? 400 : 200, r);
          }
          if (url.pathname === "/api/pm/reddet") {
            // ⊘ İNSAN REDDİ — pano dispatched.jsonl'a YAZMAZ; tek yazarı (dispatch.mjs)
            // çağırır. Defter `reddedildi` ile kapanır VE geri bildirim PM'in gelen
            // kutusuna düşer → PM düzeltilmiş işi dağıtır (kör tekrar değil).
            const r = await reddet(b);
            return json(r.ok === false ? 400 : 200, r);
          }
          if (url.pathname === "/api/graf-not/ekle") {
            // Graf notu (aşama 35 K35.7 gövde sözleşmesi `{capa, metin}`). Pano HİÇBİR
            // alanı doğrulamaz — çapa grameri ve boş-gövde hükmü 33'ün CLI'ındadır.
            const r = await grafNotYaz(b);
            return json(r.ok === false ? 400 : 200, r);
          }
          // /api/pm/gelen — kullanıcı sesi notu. Şemayı pano DEĞİL gelen.mjs bilir (tek kod-yolu).
          const g = await gelenYaz(b);
          if (!g.ok) return json(400, g);
          const isle = b.simdiIsle ? await simdiIsle() : null;
          return json(200, { ok: true, file: g.file, ...(isle ? { isleJobu: isle } : {}) });
        } catch (e) { json(400, { ok: false, error: String(e?.message || e) }); }
      });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page());
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") { console.error(`port meşgul: ${port} — --port ile değiştir`); process.exit(1); }
    throw e;
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}${pmOnly ? "/?only=pm" : ""}`;
    console.log(
      pmOnly
        ? `kaptan PM ekranı → ${url}  (üst-hedef + vizyon: kullanıcı-kalemi · görevler ayrı ekranda)`
        : `kaptan dashboard → ${url}  (görev modeli salt-okunur · PM sekmesi kullanıcı-kalemi)`,
    );
  });
}

export { snapshot };
