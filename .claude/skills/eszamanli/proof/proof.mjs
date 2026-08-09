#!/usr/bin/env node
/**
 * /eszamanli kanıt harness'ı — SALT-OKUNUR (gerçek ~/.claude'a dokunmaz).
 *
 * Kanıtı "koda bakarak" değil ÜRÜNÜ SÜREREK alır:
 *  • kapı, settings.json'daki komut satırının AYNISIYLA (node claim-guard.mjs <mod>)
 *    ayrı süreçte çağrılır, karar stdout SÖZLEŞMESİNDEN okunur (exit kodundan değil),
 *  • session'lar GERÇEK canlı süreçlerdir (`sleep`), biri gerçekten `kill -9` edilir,
 *  • izolasyon: HOME=<sandbox> → os.homedir() oraya düşer; gerçek defter/kayıtlar
 *    koşu öncesi/sonrası hash'lenip DEĞİŞMEDİĞİ doğrulanır.
 *
 * Koşum:  node ~/.claude/skills/eszamanli/proof/proof.mjs
 */

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, "..", "..", "..", "hooks", "claim-guard.mjs");
const CLI = join(HERE, "..", "scripts", "claim.mjs");

let pass = 0, fail = 0, belirsiz = 0;
const ok = (name, cond, detay = "") => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${detay && !cond ? `\n        ${detay}` : ""}`);
};
/** ÖLÇÜLEMEDİ — ölçümün kendisi geçersiz (koşul harness'ın dışında). Yeşil DEĞİL, ama
 *  kırmızı da değil: "ölçemediysen ölçülemedi yaz, tahmin yazma". İLAN edilir, sayılır. */
const olculemedi = (name, neden) => {
  belirsiz++;
  console.log(`  ÖLÇÜLEMEDİ  ${name}\n        ${neden}`);
};

/* ── sandbox ── */
const SB = mkdtempSync(join(tmpdir(), "eszamanli-proof-"));
const HOME = join(SB, "home");
const REPO = join(SB, "repo");
const STATUS = join(HOME, ".claude", "session-status");
mkdirSync(STATUS, { recursive: true });
mkdirSync(join(REPO, ".claude"), { recursive: true });
mkdirSync(join(REPO, "design-source"), { recursive: true });
mkdirSync(join(REPO, "scripts"), { recursive: true });
execFileSync("git", ["init", "-q", REPO]);
writeFileSync(join(REPO, "design-source", "studio.dc.html"), "<html>");
writeFileSync(join(REPO, "scripts", "x.cjs"), "//");
writeFileSync(
  join(REPO, ".claude", "claims-resources.json"),
  JSON.stringify({
    resources: {
      "dc-html": { paths: ["design-source/*.dc.html"] },
      "db:media_slot": { bash: ["tbl_media_slot", "media\\.php.*\\bop\\b"] },
      /* Desen ÇAĞRIYI ölçer, ANMAYI değil — gerçek projelerin (dorukcom06 dc-html)
         demirlenmiş biçimi. Çıplak "build-studio\\.py" hem FAZLA GENİŞti (adı anan
         grep/mesaj DENY yerdi) hem FAZLA DARdı (asıl yazar `npm run build` uymuyordu). */
      build: {
        bash: ["(^|[;&|(]\\s*)(python3?|py)\\s+\\S*build-studio\\.py", "(^|[;&|(]\\s*)npm\\s+run\\s+build\\b"],
      },
      /* REPO DIŞI kaynak — bu sistemin koruduklarının ÇOĞU böyledir (~/.claude/pm/…).
         Kalıp repo köküne göreli çözülürse `..` ile başlar ve eşleşme sessizce elenir:
         koruma İLAN EDİLİR ama YOKTUR (ölçüldü — kapı bu yolları hiç görmüyordu). */
      "ev:ayar": { paths: ["~/.claude/pm/ayar.json"], bash: ["ayar\\.mjs\\s+set"] },
      "ev:goals": { paths: ["~/.claude/kaptan/goals/**"] },
      /* POLİTİKA: farklı anahtar, AYNI dosyalar → gerçek çakışma yol kesişiminden türer. */
      "stüdyo:hepsi": { paths: ["design-source/**"] },
      /* POLİTİKA: yolların ifade EDEMEDİĞİ öncüllük — beyan edilir. */
      endeks: { paths: ["INDEX.md"], conflictsWith: ["dc-html"], note: "INDEX dc-html'den türer" },
    },
  })
);
/* Repo dışı kaynakların GERÇEK dosyaları (kalıbın kanonikleşmesi var-olan öneki gerektirir). */
mkdirSync(join(HOME, ".claude", "pm"), { recursive: true });
mkdirSync(join(HOME, ".claude", "kaptan", "goals"), { recursive: true });
writeFileSync(join(HOME, ".claude", "pm", "ayar.json"), "{}");

const ENV = { ...process.env, HOME, CLAUDE_CONFIG_DIR: join(HOME, ".claude") };

/* ── gerçek canlı "session" süreçleri ── */
const procs = [];
function spawnSession(sessionId, title) {
  const p = spawn("sleep", ["300"], { stdio: "ignore" });
  procs.push(p);
  const start = psStart(p.pid);
  writeFileSync(
    join(STATUS, `${sessionId}.json`),
    JSON.stringify({ sessionId, cwd: REPO, dirName: "repo", state: "generating",
                     since: Date.now(), updated: Date.now(), title, pid: p.pid, procStart: start })
  );
  return { sessionId, pid: p.pid, procStart: start };
}
function psStart(pid) {
  const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  return (r.stdout || "").trim();
}

/* ── ürünü sür ── */
function runGuard(mode, payload) {
  const r = spawnSync("node", [GUARD, mode], { input: JSON.stringify(payload), encoding: "utf8", env: ENV, cwd: REPO });
  let dec = null;
  try { dec = JSON.parse(r.stdout || "{}")?.hookSpecificOutput ?? null; } catch { /* pass = çıktısız */ }
  return { raw: r.stdout || "", dec, code: r.status };
}
function runCli(sessionId, args, envEk = null) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8", cwd: REPO, env: { ...ENV, CLAUDE_CODE_SESSION_ID: sessionId, ...(envEk || {}) },
  });
  return { out: (r.stdout || "") + (r.stderr || ""), code: r.status };
}

/* ── aşama 08 fikstürleri: Maestro'nun İKİ hâli ──
   Devir artık ÇİFT YOLLU: Maestro yazılabiliyorsa iş kuyruğa da düşer, yazılamıyorsa
   kalıcı devir işareti tek başına taşır. İkisini ölçmenin tek dürüst yolu `aide`nin
   VARLIĞINI kontrol etmek: sahte bir `aide` (canlı) ve `aide`siz bir PATH (ölü).
   GERÇEK `aide` ASLA çağrılmaz — çağrılsaydı harness canlı Maestro kuyruğuna iş yazardı
   (salt-okunurluk sözleşmesinin ihlali). */
const FAKEBIN = join(SB, "fakebin");
const AIDE_LOG = join(SB, "aide-cagrilari.log");
mkdirSync(FAKEBIN, { recursive: true });
writeFileSync(join(FAKEBIN, "aide"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${AIDE_LOG}\nexit 0\n`, { mode: 0o755 });
/* NODE'U KAYBETME (düzeltme 2026-08-09): sabit PATH `/usr/local/bin:/usr/bin:/bin` bu
   makinede (Apple Silicon, node = /opt/homebrew/bin) NODE'U da eliyordu. `spawnSync("node")`
   hiç koşmuyor, `status` null dönüyor ve ⑱'in dört ölçümü ÜRÜNÜ SÜRMEDEN kırmızı oluyordu
   (aynı FAIL kurulu kopyada da vardı → yalancı-kırmızı, ürün hatası değil harness hatası).
   Ölü Maestro'nun ölçütü "aide YOK"tur, "node yok" DEĞİL: node'un dizini korunur. */
const NODE_DIR = dirname(process.execPath);
const ENV_MAESTRO_CANLI = { PATH: `${FAKEBIN}:${NODE_DIR}:/usr/local/bin:/usr/bin:/bin` };
const ENV_MAESTRO_OLU = { PATH: `${NODE_DIR}:/usr/bin:/bin` }; // node var, aide YOK
/** …ve bunu İDDİA ETME, ÖLÇ: aide node'un dizininde de olabilir (o hâlde ölçüm geçersiz). */
const AIDE_GERCEKTEN_OLU = !(
  spawnSync("sh", ["-c", "command -v aide"], { env: { PATH: ENV_MAESTRO_OLU.PATH }, encoding: "utf8" })
    .stdout || ""
).trim();

/** session-status kaydını yamala (state · limit alanı — 07'nin 08'e verdiği arayüz). */
function statusYama(sessionId, yama) {
  const f = join(STATUS, `${sessionId}.json`);
  const j = JSON.parse(readFileSync(f, "utf8"));
  writeFileSync(f, JSON.stringify({ ...j, ...yama, updated: Date.now() }));
}

/** Claim DOSYASININ yolunu ÜRÜNDEN sor (sha1/defter mantığı harness'a kopyalanmaz). */
function claimFileOf(key) {
  const r = spawnSync(
    "node",
    ["-e", `import(process.argv[1]).then(L=>console.log(L.claimPath(L.ledgerDirOf(L.repoRootOf(process.argv[2])),process.argv[3])))`,
     join(HERE, "..", "..", "..", "hooks", "claims-lib.mjs"), REPO, key],
    { encoding: "utf8", env: ENV, cwd: REPO }
  );
  return (r.stdout || "").trim();
}

/** Bir claim'in YENİLENMESİNİ yaşlandır (P1/P2 eksenini gerçek saat beklemeden ölç;
 *  ürünün kendi eşiği ölçülür — sabit sahtelenmez). `null` → alanı tamamen SİL (legacy). */
function claimYaslandir(key, ms) {
  const f = claimFileOf(key);
  const j = JSON.parse(readFileSync(f, "utf8"));
  if (ms === null) delete j.renewedAt;
  else j.renewedAt = new Date(Date.now() - ms).toISOString();
  writeFileSync(f, JSON.stringify(j));
  return j;
}
const claimOku = (key) => { try { return JSON.parse(readFileSync(claimFileOf(key), "utf8")); } catch { return null; } };
const devirListe = () => { try { return JSON.parse(runCli("zzzz", ["devir", "list", "--json"]).out).devir; } catch { return []; } };
const arsivDosyalari = () => { try { return readdirSync(join(ledgerDirIn(), "_archive")); } catch { return []; } };
/** CLI'ı ARKA PLANDA koştur (yarış ölçümü: aynı işi iki oturum birlikte üstlenemez). */
function spawnCli(sessionId, args, envEk = null) {
  const c = spawn("node", [CLI, ...args], {
    cwd: REPO,
    env: { ...ENV, CLAUDE_CODE_SESSION_ID: sessionId, ...(envEk || {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  c.stderr.on("data", (d) => (out += d));
  procs.push(c);
  return { p: c, out: () => out, exited: new Promise((r) => c.on("exit", (code) => r(code))) };
}

/** GERÇEK bir bekleyen süreç doğur. Sıra tutmanın ölçütü budur: canlı `wait` süreci.
 *  (İşaret ≠ bekleyiş — bunu ayırmayan bir harness sahte deadlock'u yakalayamaz.) */
function spawnWait(sessionId, res, extra = []) {
  const w = spawn("node", [CLI, "wait", "--res", res, ...extra], {
    cwd: REPO,
    env: { ...ENV, CLAUDE_CODE_SESSION_ID: sessionId },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  w.stdout.on("data", (d) => (out += d));
  w.stderr.on("data", (d) => (out += d));
  procs.push(w);
  return { p: w, out: () => out, exited: new Promise((r) => w.on("exit", (c) => r(c))) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Kuyruğu ÜRÜNÜN çözümleyicisine sor. Harness sha1/defter yolu mantığını KOPYALAMAZ —
 *  kopyalarsa üründen bağımsız yalanlaşır (ledgerDirIn ile aynı gerekçe). Kilit
 *  arşivlendikten SONRA da okunur: kuyruk kaynağa aittir, claim'e değil. */
function queueOf(key) {
  const r = spawnSync(
    "node",
    ["-e", `import(process.argv[1]).then(L=>console.log(JSON.stringify(L.queueOf(L.repoRootOf(process.argv[2]),process.argv[3]))))`,
     join(HERE, "..", "..", "..", "hooks", "claims-lib.mjs"), REPO, key],
    { encoding: "utf8", env: ENV, cwd: REPO }
  );
  try {
    return JSON.parse(r.stdout);
  } catch {
    return [];
  }
}

/** Kuyruk DOSYASININ yolunu ÜRÜNDEN sor (sha1/defter mantığı harness'a kopyalanmaz). */
function queueFileOf(key) {
  const r = spawnSync(
    "node",
    ["-e", `import(process.argv[1]).then(L=>console.log(L.queuePath(L.ledgerDirOf(L.repoRootOf(process.argv[2])),process.argv[3])))`,
     join(HERE, "..", "..", "..", "hooks", "claims-lib.mjs"), REPO, key],
    { encoding: "utf8", env: ENV, cwd: REPO }
  );
  return (r.stdout || "").trim();
}

/** Bir kuyruk kaydını YAŞLANDIR. TTL'i gerçek saatle beklemek testi hem yavaş hem
 *  kırılgan yapardı; ölçülen şey kaydın YAŞI olduğu için kaydı eskitmek doğru
 *  simülasyondur (TTL sabitini de sahtelemez — ürünün kendi eşiği ölçülür). */
function yaslandir(qfile, sessionId, ms) {
  const j = JSON.parse(readFileSync(qfile, "utf8"));
  for (const w of j.q || []) {
    if (w.sessionId === sessionId) w.since = new Date(Date.now() - ms).toISOString();
  }
  writeFileSync(qfile, JSON.stringify(j));
}

/** Bildiri kutusunun yolunu ÜRÜNDEN sor (slug/dizin mantığı harness'a KOPYALANMAZ). */
function bildiriFileOf(sessionId) {
  const r = spawnSync(
    "node",
    ["-e", `import(process.argv[1]).then(L=>console.log(L.bildiriPath(L.repoRootOf(process.argv[2]),process.argv[3])))`,
     join(HERE, "..", "..", "..", "hooks", "claims-lib.mjs"), REPO, sessionId],
    { encoding: "utf8", env: ENV, cwd: REPO }
  );
  return (r.stdout || "").trim();
}

/** Defter dizinini ÜRÜNÜN çözümleyicisinden sor (sandbox HOME altında). */
function ledgerDirIn() {
  const r = spawnSync(
    "node",
    ["-e", `import(process.argv[1]).then(L=>console.log(L.ledgerDirOf(L.repoRootOf(process.argv[2]))))`,
     join(HERE, "..", "..", "..", "hooks", "claims-lib.mjs"), REPO],
    { encoding: "utf8", env: ENV, cwd: REPO }
  );
  return (r.stdout || "").trim();
}

/** Kapının MARJİNAL maliyeti (node açılışı hariç) — hızlı-yol değişmezi budur.
 *  İlk spawn soğuk olduğu için 3 koşunun EN İYİSİ alınır (tek ölçüm gürültüdür). */
function bestMs(fn, n = 3) {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t = Date.now();
    fn();
    best = Math.min(best, Date.now() - t);
  }
  return best;
}

const editPayload = (sid, file) => ({
  hook_event_name: "PreToolUse", tool_name: "Edit", session_id: sid, cwd: REPO,
  tool_input: { file_path: join(REPO, file), old_string: "a", new_string: "b" },
});

/* ── gerçek ~/.claude salt-okunurluk damgası ── */
const realHash = () => {
  const dirs = [join(homedir(), ".claude", "claims")];
  const h = createHash("sha1");
  for (const d of dirs) {
    if (!existsSync(d)) { h.update(`${d}:YOK`); continue; }
    for (const f of readdirSync(d, { recursive: true })) {
      try { h.update(String(f)).update(readFileSync(join(d, String(f)))); } catch { /* dizin */ }
    }
  }
  return h.digest("hex");
};
const hashBefore = realHash();

/* ═══════════════════ SENARYO ═══════════════════ */
console.log("eşzamanlı session protokolü — kanıt\n");

const A = spawnSession("aaaaaaaa-0000-0000-0000-000000000001", "kapsamlı: bant kanonu turu");
const B = spawnSession("bbbbbbbb-0000-0000-0000-000000000002", "küçük: onChange düzeltmesi");
const C = spawnSession("cccccccc-0000-0000-0000-000000000003", "üçüncü session");

console.log("① kilit yokken kapı hiçbir şeye karışmaz");
{
  const base = bestMs(() => spawnSync("node", ["-e", "0"], { env: ENV }));
  let r;
  const dur = bestMs(() => (r = runGuard("write", editPayload(B.sessionId, "design-source/studio.dc.html"))));
  ok("defter yokken PASS (çıktısız)", r.dec === null && r.code === 0, `stdout=${r.raw}`);
  // Ölçüt node açılışı DEĞİL kapının kendi maliyeti: her Edit'te koşuyor.
  ok(`hızlı yol marjinal < 150ms (kapı ${dur}ms − node açılışı ${base}ms = ${dur - base}ms)`, dur - base < 150);
}

console.log("\n② A kapsamlı claim alır, B reddedilir");
{
  const r = runCli(A.sessionId, ["claim", "--res", "dc-html", "--intent", "bant kanonu turu", "--breadth", "broad"]);
  ok("A claim aldı", r.code === 0 && /CLAIM ALINDI/.test(r.out), r.out);

  const g = runGuard("write", editPayload(B.sessionId, "design-source/studio.dc.html"));
  ok("B'nin Edit'i DENY", g.dec?.permissionDecision === "deny", JSON.stringify(g.dec));
  ok("deny mesajı ÇALIŞTIRILABİLİR talimat taşır (wait komutu)", /claim\.mjs wait --res/.test(g.dec?.permissionDecisionReason || ""));
  ok("deny mesajı sahibin BAŞLIĞINI çözümler (kopya değil)", /kapsamlı: bant kanonu turu/.test(g.dec?.permissionDecisionReason || ""));
  ok("deny mesajı 'işi ayır' der", /İŞİ AYIR/.test(g.dec?.permissionDecisionReason || ""));
}

console.log("\n③ sahiplik: kendi kapın seni reddetmez");
{
  const g = runGuard("write", editPayload(A.sessionId, "design-source/studio.dc.html"));
  ok("A kendi claim'ine yazabilir (session_id eşleşmesi)", g.dec === null);

  // Subagent: KENDİ session_id'si var (ölçüldü: goal-tracker.mjs:120-129), ama aynı
  // claude sürecinde koşar → session-status kaydı ebeveynin pid'ini taşır.
  const sub = "dddddddd-0000-0000-0000-000000000004";
  writeFileSync(join(STATUS, `${sub}.json`), JSON.stringify({
    sessionId: sub, cwd: REPO, dirName: "repo", state: "generating", updated: Date.now(),
    title: "A'nın subagent'ı", pid: A.pid, procStart: A.procStart,
  }));
  const g2 = runGuard("write", { ...editPayload(sub, "design-source/studio.dc.html"), agent_id: "x1", agent_type: "general-purpose" });
  ok("A'nın SUBAGENT'ı geçer (ata-pid köprüsü)", g2.dec === null, JSON.stringify(g2.dec));
}

console.log("\n④ claim'lenmemiş kaynak serbest — paralellik korunur");
{
  const g = runGuard("write", editPayload(B.sessionId, "scripts/x.cjs"));
  ok("B başka dosyada çalışabilir (izole et + devam et)", g.dec === null);
}

console.log("\n⑤ bekleyen kuyruğu + FIFO");
{
  const r = runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "onChange"]);
  ok("B: MEŞGUL + exit 3", r.code === 3 && /MEŞGUL/.test(r.out), r.out);
  ok("B kuyruğa yazıldı (1/1)", /kuyruktaki yerin: 1\/1/.test(r.out), r.out);

  const r2 = runCli(C.sessionId, ["claim", "--res", "dc-html"]);
  ok("C kuyrukta 2. sırada", r2.code === 3 && /kuyruktaki yerin: 2\/2/.test(r2.out), r2.out);

  const st = runCli(A.sessionId, ["status"]);
  ok("A status'ta sırayı GÖRÜR (yol verme sinyali)", /sıra: 1\.bbbbbbbb.*2\.cccccccc/.test(st.out), st.out);
  ok("sırada bekleyen ile İSTEYEN ayrılır (işaret sıra tutmaz)", /1\.bbbbbbbb\(istedi\)/.test(st.out), st.out);
}

console.log("\n⑥ bash kapısı (mantıksal kaynak)");
{
  const r = runCli(A.sessionId, ["claim", "--res", "db:media_slot", "--intent", "slot ataması"]);
  ok("A db:media_slot claim'ledi", r.code === 0, r.out);
  const bp = (sid, cmd) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: sid, cwd: REPO, tool_input: { command: cmd } });
  const g1 = runGuard("bash", bp(B.sessionId, "mysql -e 'select * from tbl_media_slot' dz"));
  ok("B'nin DB komutu DENY", g1.dec?.permissionDecision === "deny");
  const g2 = runGuard("bash", bp(B.sessionId, "node scripts/_pw.cjs --help"));
  ok("alakasız bash geçer (sessiz kırpma yok)", g2.dec === null);

  /* ⑥b — KİLİT YAZIMI KORUR, OKUMAYI DEĞİL.
     Ölçüldü (2026-07-16): kaynağın adını yalnızca ANAN salt-okunur bir `grep` 4 session'ı
     35 dk durdurdu; hatayı ANLATAN mesaj bile (adı metninde geçtiği için) reddedildi.
     Okuma hiçbir kaynağı mutasyona uğratmaz → beklemesi anlamsız. */
  for (const [cmd, ad] of [
    ['grep -rn "tbl_media_slot" scripts/', "grep (yalnız anma)"],
    ["cat scripts/x.cjs 2>/dev/null", "cat + 2>/dev/null (zararsız yönlendirme)"],
    ["git log --oneline -- tbl_media_slot", "git log (okuyan alt-komut)"],
    ['grep -rn "tbl_media_slot" . | head -5', "boru: grep | head"],
    ["sed -n '1,20p' scripts/x.cjs", "sed -n (okuma)"],
  ]) {
    const g = runGuard("bash", bp(B.sessionId, cmd));
    ok(`salt-okunur GEÇER: ${ad}`, g.dec === null, cmd + " → " + JSON.stringify(g.dec));
  }
  /* TERS YÖN — gevşeme YOK (uyum bozulmadı): şüphe = yazar. */
  for (const [cmd, ad] of [
    ['grep -rn "tbl_media_slot" . > /tmp/out.txt', "grep AMA yönlendirmeli → YAZIM"],
    ["sed -i '' 's/tbl_media_slot/x/' scripts/x.cjs", "sed -i (yerinde yazar)"],
    ['bash -c "mysql -e \'delete from tbl_media_slot\'"', "bash -c (içi ölçülemez)"],
    ["echo $(mysql -e 'drop table tbl_media_slot')", "komut ikamesi (içi ölçülemez)"],
    ["git checkout -- tbl_media_slot", "git checkout (yazan alt-komut)"],
    ["find . -name tbl_media_slot -delete", "find -delete (yazar)"],
  ]) {
    const g = runGuard("bash", bp(B.sessionId, cmd));
    ok(`yazan hâlâ DENY: ${ad}`, g.dec?.permissionDecision === "deny", cmd + " → " + JSON.stringify(g.dec));
  }
  runCli(A.sessionId, ["release", "--res", "db:media_slot"]);
}

console.log("\n⑥c desen ÇAĞRIYI ölçer, ANMAYI değil (fazla-geniş ∧ fazla-dar)");
{
  const r = runCli(A.sessionId, ["claim", "--res", "build", "--intent", "derleme"]);
  ok("A build claim'ledi", r.code === 0, r.out);
  const bp = (sid, cmd) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: sid, cwd: REPO, tool_input: { command: cmd } });
  // FAZLA-GENİŞ yüzü: adı yalnız bir ARGÜMANDA taşıyan, derlemeyle ilgisiz komut → GEÇMELİ
  const g1 = runGuard("bash", bp(B.sessionId, 'bun zamanla.mjs add --text "önce build-studio.py koş"'));
  ok("adı yalnız ANAN komut GEÇER (mesaj/argüman)", g1.dec === null, JSON.stringify(g1.dec));
  // FAZLA-DAR yüzü: gerçek yazar İKİ biçimde de yakalanmalı
  const g2 = runGuard("bash", bp(B.sessionId, "python3 scripts/build-studio.py"));
  ok("gerçek çağrı DENY: python3 …/build-studio.py", g2.dec?.permissionDecision === "deny", JSON.stringify(g2.dec));
  const g3 = runGuard("bash", bp(B.sessionId, "npm run build"));
  ok("gerçek çağrı DENY: npm run build (eski desenin KAÇIRDIĞI delik)", g3.dec?.permissionDecision === "deny", JSON.stringify(g3.dec));
  runCli(A.sessionId, ["release", "--res", "build"]);
}

console.log("\n⑥d ÇEVRİM (deadlock) freni — bekleme sonsuza dek dönmez");
{
  const bp = (sid, cmd) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: sid, cwd: REPO, tool_input: { command: cmd } });
  /* TEMİZ DEFTER: önceki bloklardan kalan claim/waiter bu senaryoyu YALANLAR
     (ilk koşuda yakalandı: ②'den kalan waiter yüzünden çevrim yanlış yerde doğdu). */
  for (const s of [A, B, C]) runCli(s.sessionId, ["release", "--all"]);
  /* SAHTE DÖNGÜ OLMAZ (ölçüldü — eski tasarımın hatası): A yalnız bir kez claim deneyip
     İŞARET bıraktıysa "bekliyor" DEĞİLDİR; işareti zincire saymak, kimsenin beklemediği
     yerde DÖNGÜ hükmü verir ve B'ye haksız yere "tuttuğunu bırak" dedirtir (= yarım yazım). */
  runCli(A.sessionId, ["claim", "--res", "dc-html", "--intent", "A: dc-html"]);
  runCli(B.sessionId, ["claim", "--res", "db:media_slot", "--intent", "B: slot"]);
  const mark = runCli(A.sessionId, ["claim", "--res", "db:media_slot", "--intent", "A istedi, vazgeçti"]);
  ok("ön koşul: A yalnız İŞARET bıraktı (MEŞGUL)", mark.code === 3, mark.out);
  const sahte = runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B: dc-html ister"]);
  ok("bayat İŞARET sahte DÖNGÜ üretmez (exit 3, 7 DEĞİL)", sahte.code === 3, sahte.out);
  // Kurulumu temizle: bu denemelerin işaretleri aşağıdaki senaryonun ölçümünü kirletir.
  runCli(B.sessionId, ["release", "--res", "dc-html"]); // vazgeç (işareti çek)

  /* GERÇEK DÖNGÜ: A dc-html'i TUTAR ve db:media_slot'u GERÇEKTEN bekler (canlı wait süreci).
     B (slot'un sahibi) şimdi dc-html isterse iki taraf da bloke → süresiz kilitlenme. */
  const aw = spawnWait(A.sessionId, "db:media_slot", ["--intent", "A gerçekten bekliyor"]);
  await sleep(700);
  ok("ön koşul: A AKTİF bekleyici (canlı wait süreci sıra tutar)",
     queueOf("db:media_slot").some((w) => w.sessionId === A.sessionId && w.pid),
     JSON.stringify(queueOf("db:media_slot")));

  const cyc = runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B ayrıca dc-html ister"]);
  ok("B'ye DÖNGÜ hükmü — exit 7 (kuyruk DEĞİL)", cyc.code === 7, cyc.out);
  ok("çözüm SÖYLENİR: tuttuğunu bırak", /release --res "db:media_slot"/.test(cyc.out), cyc.out);
  ok("çevrimde kuyruğa YAZILMAZ (kuyruk yalan olmaz)",
     !queueOf("dc-html").some((w) => w.sessionId === B.sessionId),
     JSON.stringify(queueOf("dc-html")));

  /* KAPI da AYNI ölçütü okur (tek kaynak L.waitCycle) — Ders 11: her giriş kapısında. */
  aw.p.kill(9); // önceki bekleyişi bitir: sırası düşsün (canlılık ölçütü = süreç)
  await sleep(300);
  for (const s of [A, B, C]) runCli(s.sessionId, ["release", "--all"]);
  runCli(A.sessionId, ["claim", "--res", "build", "--intent", "A: derleme"]);
  runCli(B.sessionId, ["claim", "--res", "db:media_slot", "--intent", "B: slot"]);
  const aw2 = spawnWait(A.sessionId, "db:media_slot", ["--intent", "A gerçekten bekliyor"]);
  await sleep(700);
  const g = runGuard("bash", bp(B.sessionId, "npm run build"));
  const rz = g.dec?.permissionDecisionReason || "";
  ok("kapı: yazım DENY (koruma duruyor)", g.dec?.permissionDecision === "deny", JSON.stringify(g.dec));
  ok("kapı DENY metni DÖNGÜ der (bekle demez)", /DÖNGÜ/.test(rz), rz);
  ok("kapı çözümü SÖYLER: tuttuğunu bırak", /release --res "db:media_slot"/.test(rz), rz);

  // NEGATİF: çevrim yokken kapı ESKİ metnini basar (uyum bozulmadı)
  aw2.p.kill(9); // A artık beklemiyor → çevrim yok
  await sleep(300);
  const g2 = runGuard("bash", bp(C.sessionId, "npm run build"));
  const rz2 = g2.dec?.permissionDecisionReason || "";
  ok("çevrim YOKken kapı normal 'İŞİ AYIR' der", /İŞİ AYIR/.test(rz2) && !/DÖNGÜ/.test(rz2), rz2);

  // NEGATİF: çevrim yokken normal MEŞGUL+kuyruk davranışı BOZULMAZ
  const normal = runCli(C.sessionId, ["claim", "--res", "db:media_slot", "--intent", "C bekler"]);
  ok("çevrim YOKken normal MEŞGUL+kuyruk (uyum bozulmadı)", normal.code === 3, normal.out);

  /* DEFTERİ BULDUĞUN GİBİ BIRAK: ⑦ ve sonrası ②'nin bıraktığı A/dc-html claim'ine
     yaslanıyor (ilk koşuda tam bu yüzden çöktü — harness'ın kendi yan etkisi). */
  for (const s of [A, B, C]) runCli(s.sessionId, ["release", "--all"]);
  runCli(A.sessionId, ["claim", "--res", "dc-html", "--intent", "bant kanonu turu", "--breadth", "broad"]);
}

console.log("\n⑦ CANLILIK ÖLÇÜTÜ: süre değil, süreç (Ders 16)");
{
  // A'nın claim'i saatler önce yazılmış gibi görünse de (idle ama CANLI) biçilmemeli.
  // Defter yolunu HARNESS HESAPLAMAZ — ürünün kendi çözümleyicisine sorar.
  // (Slug/realpath mantığını kopyalamak harness'ı üründen bağımsız yalanlaştırır.)
  const ledgerDir = ledgerDirIn();
  const f = readdirSync(ledgerDir).find((x) => x.endsWith(".json") && !x.endsWith(".q.json"));
  const p = join(ledgerDir, f);
  const c = JSON.parse(readFileSync(p, "utf8"));
  c.createdAt = new Date(Date.now() - 12 * 3600e3).toISOString();
  c.renewedAt = c.createdAt;
  writeFileSync(p, JSON.stringify(c));
  spawnSync("touch", ["-t", "202601010101", p]); // mtime: aylar önce
  const g = runGuard("write", editPayload(B.sessionId, "design-source/studio.dc.html"));
  ok("12 saatlik idle-ama-CANLI claim BİÇİLMEZ (TTL/mtime ölçüt değil)", g.dec?.permissionDecision === "deny");

  // procStart BİÇİM gürültüsü kilidi düşürmemeli. (Duman testinde yaşandı: session-status'a
  // `tr -s ' '` ile yazılan sondaki-boşluklu değer, CANLI sahibin kilidini "ölü" saydırıp
  // sessizce biçti — kapı AÇIK fail etti.)
  const sf = join(STATUS, `${A.sessionId}.json`);
  const rec = JSON.parse(readFileSync(sf, "utf8"));
  rec.procStart = `  ${String(rec.procStart).replace(/\s+/g, "  ")} `; // aynı an, bozuk boşluk
  writeFileSync(sf, JSON.stringify(rec));
  const g3 = runGuard("write", editPayload(B.sessionId, "design-source/studio.dc.html"));
  ok("procStart boşluk gürültüsü kilidi DÜŞÜRMEZ (normalize)", g3.dec?.permissionDecision === "deny", JSON.stringify(g3.dec));
  writeFileSync(sf, JSON.stringify({ ...rec, procStart: A.procStart }));

  // Şimdi A gerçekten ölür (crash — SessionEnd ateşlenmez, kayıt 'generating' kalır).
  process.kill(A.pid, 9);
  await new Promise((r) => setTimeout(r, 300));
  const g2 = runGuard("write", editPayload(B.sessionId, "design-source/studio.dc.html"));
  ok("sahip CRASH etti → kilit otomatik biçildi, B geçer (sistem kilitlenmez)", g2.dec === null, JSON.stringify(g2.dec));
  const arch = join(ledgerDir, "_archive");
  ok("biçilen claim _archive/'e taşındı (iz kalır)", existsSync(arch) && readdirSync(arch).length > 0);
}

console.log("\n⑧ B devralır, iş biter, bırakır");
{
  const r = runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "onChange düzeltmesi"]);
  ok("B artık claim alabiliyor (beklemedeki madde devam edebilir)", r.code === 0 && /CLAIM ALINDI/.test(r.out), r.out);
  const g = runGuard("write", editPayload(C.sessionId, "design-source/studio.dc.html"));
  ok("şimdi C reddediliyor (kilit gerçekten devretti)", g.dec?.permissionDecision === "deny");
  const rel = runCli(B.sessionId, ["release", "--res", "dc-html"]);
  ok("B bıraktı", rel.code === 0 && /BIRAKILDI/.test(rel.out), rel.out);
  const g2 = runGuard("write", editPayload(C.sessionId, "design-source/studio.dc.html"));
  ok("bırakınca C serbest", g2.dec === null);
}

console.log("\n⑨ wait: boşalınca ÇIKAR (uyanma sinyali)");
{
  runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C'nin işi"]);
  const w = spawnWait(B.sessionId, "dc-html", ["--intent", "B'nin beklemedeki işi"]);
  await sleep(800);
  ok("kaynak meşgulken wait BEKLER (çıkmaz)", w.p.exitCode === null);
  runCli(C.sessionId, ["release", "--res", "dc-html"]);
  const code = await Promise.race([w.exited, sleep(12000).then(() => "timeout")]);
  ok("boşalınca wait ÇIKAR → session uyanır", code === 0, `code=${code} out=${w.out()}`);

  /* DEVAMLILIK: uyanmak yetmez. "Boşaldı, şimdi sen claim'le" ile modelin claim'i
     koşması arasındaki boşlukta başka bir session kaynağı kapardı → sıra beklemiş olan
     yine aç kalırdı. Bekleyen süreç sırası gelince kilidi SESSION ADINA alır. */
  ok("wait kilidi SESSION ADINA ALIR (uyanınca kaynak elinde)", /SIRA SENDE — CLAIM ALINDI/.test(w.out()), w.out());
  /* Uyanış BAĞLAM taşır: model bekleyişi kurduğu turdan çok sonra uyanır — "ne için
     bekliyordum" cevabı çıktıda yoksa uyanan tur todo arkeolojisine düşer. */
  ok("uyanış intent'i GERİ SÖYLER (bağlam taşınır)", /beklemedeki iş: B'nin beklemedeki işi/.test(w.out()), w.out());
  const gC = runGuard("write", editPayload(C.sessionId, "design-source/studio.dc.html"));
  ok("devralma GERÇEK: kilit B'de → C reddedilir", gC.dec?.permissionDecision === "deny", JSON.stringify(gC.dec));
  const gB = runGuard("write", editPayload(B.sessionId, "design-source/studio.dc.html"));
  ok("B kendi devraldığı kilide yazabilir", gB.dec === null, JSON.stringify(gB.dec));
  ok("alınca sıradan çıkar (kuyruk yalan tutmaz)", !queueOf("dc-html").some((x) => x.sessionId === B.sessionId));
  runCli(B.sessionId, ["release", "--res", "dc-html"]);
}

console.log("\n⑨b SIRA ADALETİ: bekleyen varken kapmak açlık üretir");
{
  const A2 = spawnSession("eeeeeeee-0000-0000-0000-000000000005", "dördüncü session (sahip)");
  runCli(A2.sessionId, ["claim", "--res", "dc-html", "--intent", "sahip"]);
  const w = spawnWait(B.sessionId, "dc-html", ["--intent", "B sırada"]);
  await sleep(700);
  /* C kaynağı beklemeden kapmaya çalışır. Eski tasarımda kuyruk claim'in İÇİNDE yaşadığı
     için bırakınca ölürdü → "sıra" diye bir şey yoktu, boşalanı ilk YOKLAYAN alırdı ve
     B süresiz aç kalabilirdi. Kuyruk artık kaynağa ait → sıra kilitten uzun yaşar. */
  runCli(A2.sessionId, ["release", "--res", "dc-html"]);
  const c = runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C sollamaya çalışır"]);
  ok("boşalmış kaynağı SOLLAMA reddedilir — exit 4 (sıra sende değil)", c.code === 4, c.out);
  ok("kimin sırası olduğu SÖYLENİR", /önünde bekleyen/.test(c.out), c.out);
  const code = await Promise.race([w.exited, sleep(12000).then(() => "timeout")]);
  ok("sıradaki B kilidi ALIR (FIFO gerçek)", code === 0 && /SIRA SENDE — CLAIM ALINDI/.test(w.out()), `${code} ${w.out()}`);
  runCli(B.sessionId, ["release", "--res", "dc-html"]);
  const c2 = runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C artık alabilir"]);
  ok("sıra boşalınca C alır (kimse süresiz aç kalmaz)", c2.code === 0, c2.out);
  runCli(C.sessionId, ["release", "--res", "dc-html"]);
}

console.log("\n⑩ SessionEnd → kilitler bırakılır (Ders 11: değişmez her kapıda)");
{
  runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C"]);
  const g0 = runGuard("write", editPayload(B.sessionId, "design-source/studio.dc.html"));
  ok("ön koşul: C'nin kilidi B'yi bloke ediyor", g0.dec?.permissionDecision === "deny");
  runGuard("release_all", { hook_event_name: "SessionEnd", session_id: C.sessionId, cwd: REPO });
  const g = runGuard("write", editPayload(B.sessionId, "design-source/studio.dc.html"));
  ok("SessionEnd sonrası kilit yok → B geçer", g.dec === null);
}

console.log("\n⑪ farkındalık enjeksiyonu (ctx)");
{
  const r = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: B.sessionId, cwd: REPO });
  ok("başka canlı session varken additionalContext basılır", /eşzamanlılık/.test(r.dec?.additionalContext || ""), JSON.stringify(r.dec));
  ok("ctx canlı session'ları LİSTELER", /üçüncü session/.test(r.dec?.additionalContext || ""));
}

console.log("\n⑬ REPO DIŞI (~/…) kaynaklar gerçekten korunuyor");
{
  /* Bu sistemin koruduğu kaynakların ÇOĞU repo dışındadır (~/.claude/pm/…, kaptan modeli).
     Kalıplar repo köküne göreli çözülünce hepsi `..` ile başlıyor ve eşleşme sessizce
     eleniyordu: koruma İLAN EDİLİYOR ama YOKTU — ölçüldü, `pm:kadran` claim'liyken
     `Edit ~/.claude/pm/ayar.json` kapıdan geçiyordu. */
  const r = runCli(B.sessionId, ["claim", "--res", "ev:ayar", "--intent", "kadran yazımı"]);
  ok("B repo-dışı kaynağı claim'ledi", r.code === 0, r.out);
  const g = runGuard("write", {
    hook_event_name: "PreToolUse", tool_name: "Edit", session_id: C.sessionId, cwd: REPO,
    tool_input: { file_path: join(HOME, ".claude", "pm", "ayar.json"), old_string: "a", new_string: "b" },
  });
  ok("repo DIŞI yola Edit DENY (koruma artık gerçek)", g.dec?.permissionDecision === "deny", JSON.stringify(g.dec));

  // `**` içeren repo-dışı kalıp + henüz VAR OLMAYAN dosya (Write yeni dosya açar)
  runCli(B.sessionId, ["claim", "--res", "ev:goals", "--intent", "hedef yazımı"]);
  const g2 = runGuard("write", {
    hook_event_name: "PreToolUse", tool_name: "Write", session_id: C.sessionId, cwd: REPO,
    tool_input: { file_path: join(HOME, ".claude", "kaptan", "goals", "yeni.json"), content: "{}" },
  });
  ok("repo-dışı glob + henüz yok olan dosya DENY", g2.dec?.permissionDecision === "deny", JSON.stringify(g2.dec));

  // TERS YÖN: alakasız repo-dışı yol GEÇER (fazla-blokaj yok)
  const g3 = runGuard("write", {
    hook_event_name: "PreToolUse", tool_name: "Edit", session_id: C.sessionId, cwd: REPO,
    tool_input: { file_path: join(HOME, ".claude", "pm", "baska.json"), old_string: "a", new_string: "b" },
  });
  ok("alakasız repo-dışı yol GEÇER (sessiz fazla-blokaj yok)", g3.dec === null, JSON.stringify(g3.dec));
  runCli(B.sessionId, ["release", "--all"]);
}

console.log("\n⑭ YOL claim'i Bash yazımına karşı da korunur");
{
  /* `bash` desenleri YALNIZ mantıksal kaynaklarda tanımlı → bir dosya/glob claim'i Bash'e
     karşı çıplaktı: claim'li dosya `sed -i` ya da `>` ile kapıdan geçerek eziliyordu.
     (SKILL bunu delik olarak İLAN ediyordu; ilan etmek kapatmak değildir.) */
  const r = runCli(B.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "yol claim'i"]);
  ok("B dosya claim'ledi", r.code === 0, r.out);
  const bp = (sid, cmd) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: sid, cwd: REPO, tool_input: { command: cmd } });
  for (const [cmd, ad] of [
    ["sed -i '' 's/a/b/' scripts/x.cjs", "sed -i claim'li dosyayı ezer"],
    ["echo hi > scripts/x.cjs", "yönlendirme claim'li dosyayı ezer"],
    ["cp /etc/hosts scripts/x.cjs", "cp claim'li dosyanın üstüne yazar"],
    ["rm -f ./scripts/x.cjs", "farklı yazım (./) aynı dosya"],
    // Tırnak farkındalığı GEVŞEME DEĞİL: tırnak DIŞINDAKİ yazar segment hâlâ ölçülür.
    ['grep -rn "a|b" scripts/x.cjs; rm -f scripts/x.cjs', "tırnak dışı gerçek yazar segment"],
    ["cat 'scripts/x.cjs' && rm -f scripts/x.cjs", "okuma + yazar zinciri"],
  ]) {
    const g = runGuard("bash", bp(C.sessionId, cmd));
    ok(`DENY: ${ad}`, g.dec?.permissionDecision === "deny", cmd + " → " + JSON.stringify(g.dec));
  }
  // TERS YÖN: okuma ve alakasız yazım GEÇER (uyum bozulmadı)
  for (const [cmd, ad] of [
    ["cat scripts/x.cjs", "okuma geçer (kilit YAZIMI korur)"],
    ["grep -rn x scripts/x.cjs", "grep geçer"],
    ["echo hi > scripts/baska.cjs", "alakasız dosyaya yazım geçer"],
    // TIRNAK İÇİ AYIRICI: kör bölme bunu ikiye kesip "tanınmayan binary" → yazar sayıyordu.
    ['grep -rn "a\\|b" scripts/x.cjs', "argümanında | geçen grep geçer"],
    ["grep -rn 'x;y' scripts/x.cjs | head -3", "tırnak içi ; + gerçek boru geçer"],
    ['cat scripts/x.cjs | grep -c "a&&b"', "tırnak içi && geçer"],
  ]) {
    const g = runGuard("bash", bp(C.sessionId, cmd));
    ok(`GEÇER: ${ad}`, g.dec === null, cmd + " → " + JSON.stringify(g.dec));
  }
  ok("sahibin kendi Bash yazımı geçer", runGuard("bash", bp(B.sessionId, "echo hi > scripts/x.cjs")).dec === null);

  /* ── KAPI KENDİ ÇARESİNİ REDDEDEMEZ (2026-07-27) ──
     DENY metni "sıraya girmek için `claim.mjs wait --res <kaynak>` koş" der; o komut kilitli
     YOLU argüman olarak andığı ve `node` RO_BINS'te olmadığı için kapıda ölüyordu → kuyruğa
     girilemiyor, sıra yalanlanıyordu. Muafiyet DAR: yalnız eszamanli/…/claim.mjs, ve tek bir
     yazar segment bile varsa düşer. */
  for (const [cmd, ad] of [
    [`node ${CLI} wait --res "scripts/x.cjs"`, "wait — kapının önerdiği çare"],
    [`node ${CLI} claim --res scripts/x.cjs --intent "devral"`, "claim"],
    [`node ${CLI} release --res scripts/x.cjs`, "release"],
    [`node ${CLI} devret --res scripts/x.cjs --gorev "parça B"`, "devret"],
    [`node ${CLI} status`, "status"],
    [`node ${CLI} free --res scripts/x.cjs | grep -q MEŞGUL`, "protokol + salt-okunur boru"],
  ]) {
    const g = runGuard("bash", bp(C.sessionId, cmd));
    ok(`GEÇER: protokol komutu — ${ad}`, g.dec === null, cmd + " → " + JSON.stringify(g.dec));
  }
  /* Muafiyet KALKAN DEĞİLDİR: protokol komutuna yazar bir segment iliştirilemez. */
  for (const [cmd, ad] of [
    [`node ${CLI} wait --res scripts/x.cjs && rm -f scripts/x.cjs`, "protokol + yazar segment"],
    [`node ${CLI} wait --res scripts/x.cjs; sed -i '' 's/a/b/' scripts/x.cjs`, "protokol + sed -i"],
    ["node /tmp/sahte/claim.mjs wait --res scripts/x.cjs", "adı çakışan yabancı claim.mjs"],
    [`node ${CLI} bilinmeyen --res scripts/x.cjs`, "tanınmayan alt-komut"],
  ]) {
    const g = runGuard("bash", bp(C.sessionId, cmd));
    ok(`DENY: ${ad}`, g.dec?.permissionDecision === "deny", cmd + " → " + JSON.stringify(g.dec));
  }
  runCli(B.sessionId, ["release", "--all"]);
}

console.log("\n⑮ POLİTİKA: çakışma anahtar eşitliğinden İBARET değil");
{
  /* Anahtar eşitliği tek ölçüt olsaydı `dc-html` ile `stüdyo:hepsi` aynı dosyaları
     sürdüğü halde ikisi de claim edilir, İKİ session da "sahibim" sanırdı. */
  const r = runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B: dc-html"]);
  ok("ön koşul: B dc-html tutuyor", r.code === 0, r.out);
  const c = runCli(C.sessionId, ["claim", "--res", "stüdyo:hepsi", "--intent", "C: tüm stüdyo"]);
  ok("YOL KESİŞİMİ çakışma sayılır — farklı anahtar, aynı dosyalar", c.code === 3, c.out);
  ok("neden bloke olduğu SÖYLENİR (yol kesişimi)", /yol kesişimi/.test(c.out), c.out);

  /* ÖNCÜLLÜK (precursor): yolların ifade EDEMEDİĞİ ilişki — BEYAN edilir (conflictsWith).
     `endeks` dc-html'den TÜRER; yarım yazılmış bir kaynaktan türetilen endeks yalandır. */
  const e = runCli(C.sessionId, ["claim", "--res", "endeks", "--intent", "C: endeks türet"]);
  ok("İLAN EDİLMİŞ öncüllük çakışma sayılır (conflictsWith)", e.code === 3, e.out);
  ok("ilanın gerekçesi SÖYLENİR", /ilan edilmiş çakışma/.test(e.out), e.out);

  // TERS YÖN: gerçekten kesişmeyen kaynak SERBEST (fazla-blokaj yok — paralellik korunur)
  const f = runCli(C.sessionId, ["claim", "--res", "db:media_slot", "--intent", "C: alakasız iş"]);
  ok("kesişmeyen kaynak SERBEST (paralellik korunur)", f.code === 0, f.out);
  runCli(B.sessionId, ["release", "--all"]);
  runCli(C.sessionId, ["release", "--all"]);
}

console.log("\n⑯ KUYRUK kilitten uzun yaşar (eski tasarımda claim ile ölüyordu)");
{
  const r = runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B tutar"]);
  ok("ön koşul: B tutuyor", r.code === 0, r.out);
  runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C ister"]); // işaret
  ok("C kuyrukta", queueOf("dc-html").some((w) => w.sessionId === C.sessionId));
  runCli(B.sessionId, ["release", "--res", "dc-html"]);
  /* Kuyruk claim'in İÇİNDE yaşarken release onu arşive gömüyordu → sıra yok olurdu.
     Kuyruk artık KAYNAĞA ait: kilit gidince sıra ayakta kalır. */
  ok("release sonrası sıra AYAKTA (kaynağa ait, claim'e değil)",
     queueOf("dc-html").length > 0, "kuyruk release ile öldü");

  // Vazgeçme yolu: kuyrukta unutulmuş bir istek sırayı yalanlar → release onu da çeker.
  const v = runCli(C.sessionId, ["release", "--res", "dc-html"]);
  ok("release = vazgeçme (sahip değilsen sıradan çıkarsın)", /SIRADAN ÇIKTIN/.test(v.out), v.out);
  ok("vazgeçince sıradan düştü", queueOf("dc-html").length === 0);
}

console.log("\n⑯b İŞARET ÖMÜRLÜDÜR: kapıda reddedilen kayıt bir yerden sonra ölür");
{
  const qf = queueFileOf("dc-html");
  const r = runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B tutar"]);
  ok("ön koşul: B tutuyor", r.code === 0, r.out);
  runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C istedi, yoluna gitti"]); // İŞARET
  ok("taze İŞARET yaşar (İŞARET→AKTİF yükseltme penceresi açık)",
     queueOf("dc-html").some((w) => w.sessionId === C.sessionId && !w.pid));

  /* Eski kural "session canlıysa işaret yaşar" pratikte SONSUZ demekti: ölçüldü
     2026-07-27 — agent-ide defterinde 3 işaret 1+ saattir duruyordu, kaynakları
     serbest, hiçbiri geri dönmedi. */
  yaslandir(qf, C.sessionId, 31 * 60 * 1000);
  ok("ömrü dolan İŞARET biçilir (session CANLI olsa bile)",
     !queueOf("dc-html").some((w) => w.sessionId === C.sessionId), JSON.stringify(queueOf("dc-html")));

  /* MUAFİYET: TTL yalnız pid'siz işarete uygulanır. Saatlerce bekleyen MEŞRU bir `wait`
     süreci sırasını KAYBETMEZ — onun ölçütü hâlâ SÜREÇ (Ders 16). */
  const cw = spawnWait(C.sessionId, "dc-html", ["--intent", "C gerçekten bekliyor"]);
  await sleep(700);
  yaslandir(qf, C.sessionId, 31 * 60 * 1000);
  ok("AKTİF bekleyici TTL'den MUAF (ölçüt süreç, süre değil)",
     queueOf("dc-html").some((w) => w.sessionId === C.sessionId && w.pid),
     JSON.stringify(queueOf("dc-html")));
  cw.p.kill(9);
  await cw.exited;
  runCli(C.sessionId, ["release", "--res", "dc-html"]);
  runCli(B.sessionId, ["release", "--res", "dc-html"]);
}

console.log("\n⑯c gc YETİM kuyruğu süpürür (eski gc onu HİÇ görmüyordu)");
{
  /* Eski `gc` kuyruğu AKTİF CLAIM'lerden yürüyordu: claim'i bırakılmış anahtarın kuyruk
     dosyası sayıma hiç girmiyor, gc "sırada 0 kayıt" diye temiz rapor veriyordu (ölçüldü). */
  runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B tutar"]);
  runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C istedi"]); // İŞARET
  runCli(B.sessionId, ["release", "--res", "dc-html"]); // claim gitti, kuyruk kaldı → YETİM
  const qf = queueFileOf("dc-html");
  ok("ön koşul: yetim kuyruk dosyası diskte", existsSync(qf), qf);
  yaslandir(qf, C.sessionId, 31 * 60 * 1000);
  const g = runCli(A.sessionId, ["gc"]);
  ok("gc biçtiğini SÖYLER (sessiz temizlik denetlenemez)", /[1-9]\d* bayat kayıt biçildi/.test(g.out), g.out);
  ok("boşalan kuyruk dosyası DİSKTEN silindi", !existsSync(qf), g.out);
}

console.log("\n⑰ PARÇALA: free sondası + devret (parça B kuyruktan gelince)");
{
  /* `free` KİMLİKSİZDİR — Maestro `when-shell` koşulu daemon ortamında koşar, orada
     CLAUDE_CODE_SESSION_ID yoktur. Sonda session env'siz, repo DIŞI cwd'den, --repo ile
     çalışmalı; aksi halde devir işi hiç ateşlenemezdi. */
  const freeProbe = () => {
    const r = spawnSync("node", [CLI, "free", "--res", "dc-html", "--repo", REPO], {
      encoding: "utf8", cwd: SB, env: ENV, // session id YOK, cwd repo DIŞI
    });
    return { out: (r.stdout || "") + (r.stderr || ""), code: r.status };
  };
  let f = freeProbe();
  ok("serbest kaynak: free exit 0 (kimliksiz, repo dışından)", f.code === 0 && /SERBEST/.test(f.out), f.out);

  runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B tutar"]);
  f = freeProbe();
  ok("tutulan kaynak: free exit 1 (MEŞGUL)", f.code === 1 && /MEŞGUL/.test(f.out), f.out);

  /* Çakışma ölçütü claim yolundakiyle AYNI: farklı anahtar, aynı dosyalar → devralınamaz.
     Sonda yalnız anahtar eşitliğine baksaydı devir, yol-kesişen kilidin üstüne ateşlenirdi. */
  const fc = spawnSync("node", [CLI, "free", "--res", "stüdyo:hepsi", "--repo", REPO], {
    encoding: "utf8", cwd: SB, env: ENV,
  });
  ok("free GERÇEK çakışmayı ölçer (yol kesişimi → exit 1)", fc.status === 1, fc.stdout + fc.stderr);

  /* Kaynak BOŞ ama sırada AKTİF bekleyen var — release ile bekleyenin devralması
     arasındaki pencere. Sonda burada 0 dönerse devir işi bekleyenin ÖNÜNE ateşlenir
     (canlı bekleyişin önceliği yalanlanır). Pencere gerçekte ~2 sn (wait poll aralığı);
     deterministik gözlem için aktif bekleyici kütüphane üzerinden, CANLI bir sürecin
     pid'iyle kurulur (waiterActive ölçütü aynen: pid + procStart). */
  runCli(B.sessionId, ["release", "--res", "dc-html"]);
  spawnSync(
    "node",
    ["-e", `import(process.argv[1]).then(L=>L.enqueue(L.repoRootOf(process.argv[2]),process.argv[3],{sessionId:process.argv[4],since:new Date().toISOString(),intent:"C sırada",pid:+process.argv[5],procStart:L.selfProcStart(+process.argv[5])}))`,
     join(HERE, "..", "..", "..", "hooks", "claims-lib.mjs"), REPO, "dc-html", C.sessionId, String(C.pid)],
    { encoding: "utf8", env: ENV, cwd: REPO }
  );
  f = freeProbe();
  ok("kaynak boş + AKTİF bekleyen → free exit 1 (canlı bekleyiş devirden önce)", f.code === 1 && /SIRADA BEKLEYEN/.test(f.out), f.out);
  runCli(C.sessionId, ["release", "--res", "dc-html"]); // sıradan vazgeç
  runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B tutar"]); // sonraki blok için geri al

  /* İŞARET ateşi ENGELLEMEZ: devret'in kendi işareti kendi sondasını bloke etseydi
     devir hiç ateşlenemezdi (kendi kendini kilitleyen kuyruk). */
  runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B tutar"]);
  runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C ister"]); // işaret (exit 3)
  runCli(B.sessionId, ["release", "--res", "dc-html"]);
  ok("ön koşul: kuyrukta işaret var", queueOf("dc-html").some((x) => x.sessionId === C.sessionId));
  f = freeProbe();
  ok("işaret sondayı BLOKE ETMEZ (free exit 0)", f.code === 0, f.out);
  runCli(C.sessionId, ["release", "--res", "dc-html"]); // işaretten vazgeç

  /* MEŞGUL raporu artık İKİ teslim yolunu da söyler: wait (canlı) + devret (oturum-ötesi). */
  runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B tutar"]);
  const m = runCli(C.sessionId, ["claim", "--res", "dc-html", "--intent", "C ister"]);
  ok("MEŞGUL raporu devir yolunu da SÖYLER", /devret --res/.test(m.out), m.out);
  runCli(C.sessionId, ["release", "--res", "dc-html"]);

  /* devret --kuru: koşacağı işi BASAR, hiçbir yere YAZMAZ (Maestro'ya da kuyruğa da). */
  const d = runCli(C.sessionId, ["devret", "--res", "dc-html", "--gorev", "parça B: onChange düzelt", "--kuru"]);
  ok("devret --kuru zamanla işini ÜRETİR (when-shell + free sondası)",
     d.code === 0 && /zamanla add/.test(d.out) && /--when-shell/.test(d.out) && /free --res/.test(d.out), d.out);
  ok("devir görevi claim ÖN KOŞULU taşır (ateşlenen session kaynağı kendisi alır)", /ÖN KOŞUL — kaynağı devral/.test(d.out), d.out);
  ok("--kuru kuyruğa iz BIRAKMAZ", !queueOf("dc-html").some((x) => x.sessionId === C.sessionId));
  runCli(B.sessionId, ["release", "--all"]);
}

/* ═══════════ AŞAMA 08 · KİLİT ÖMRÜ — sahip ölse/limitlense de kuyruk çözülür ═══════════ */

console.log("\n⑱ DEVİR İŞARETİ: Maestro ölüyken de iş kaybolmaz (ÇİFT YOL)");
{
  for (const s of [B, C]) runCli(s.sessionId, ["release", "--all"]);
  runCli(B.sessionId, ["claim", "--res", "dc-html", "--intent", "B tutar"]);

  /* Maestro ÖLÜ (aide PATH'te yok — metronom KİLİTLİ dönemin birebir hâli). Eskiden bu
     yol exit 5'ti: iş Maestro'yla birlikte ölüyordu, yani devir en çok ihtiyaç duyulan
     anda hiç çalışmıyordu. */
  const d = runCli(C.sessionId, ["devret", "--res", "dc-html", "--gorev", "parça B: onChange düzelt"], ENV_MAESTRO_OLU);
  if (!AIDE_GERCEKTEN_OLU)
    olculemedi("Maestro ölü senaryosu", "aide, node'un dizininde bulunuyor → 'ölü Maestro' PATH'i kurulamadı");
  ok("Maestro ölü → devret exit 0 (eski sözleşme 5: iş kaybolurdu)", d.code === 0, d.out);
  ok("çıktı NE OLDUĞUNU söyler (MAESTRO YAZILAMADI + işaret KALDI)",
     /MAESTRO YAZILAMADI/.test(d.out) && /devir işareti KALDI/.test(d.out), d.out);
  ok("çıktı iki ucu da SÖYLER (devir list · devir al --id)", /devir list/.test(d.out) && /devir al --id/.test(d.out), d.out);
  const l1 = devirListe();
  ok("devir işareti diskte — kalıcı · süreçsiz · TTL'siz",
     l1.length === 1 && l1[0]?.kaynak === "devret" && l1[0]?.keys?.[0] === "dc-html", JSON.stringify(l1));
  ok("işaret devredeni + görevi + şemayı taşır (v=1)",
     l1[0]?.v === 1 && l1[0]?.devreden?.sessionId === C.sessionId && /onChange/.test(l1[0]?.gorev || ""), JSON.stringify(l1[0]));
  ok("GERÇEK aide HİÇ çağrılmadı (canlı Maestro kuyruğuna yazım YOK)", !existsSync(AIDE_LOG));

  /* Maestro CANLI (sahte aide): iş kuyruğa YAZILIR **ve** işaret yine kalır — çift yol,
     biri ölse öbürü taşır. Dedup'ı goal önsözünün İLK adımı sağlar. */
  const d2 = runCli(C.sessionId, ["devret", "--res", "dc-html", "--gorev", "parça B2", "--title", "t2"], ENV_MAESTRO_CANLI);
  ok("Maestro canlı → devret exit 0 + DEVREDİLDİ", d2.code === 0 && /DEVREDİLDİ/.test(d2.out), d2.out);
  const log = existsSync(AIDE_LOG) ? readFileSync(AIDE_LOG, "utf8") : "";
  ok("kuyruğa when-shell işi + kimliksiz free sondası yazıldı",
     /zamanla add/.test(log) && /--when-shell/.test(log) && /free --res/.test(log), log);
  ok("goal önsözünün İLK ADIMI `devir al --id` (aynı iş İKİ KEZ koşulamaz)",
     /İLK ADIM — işi ÜSTLEN/.test(log) && /devir al --id/.test(log), log);
  ok("Maestro canlıyken de işaret YAZILIR (tek yol değil, çift yol)", devirListe().length === 2, JSON.stringify(devirListe().map((x) => x.id)));
  ok("Maestro damgası işarete işlendi (maestro.yazildi)", devirListe().some((x) => x.maestro?.yazildi === true), JSON.stringify(devirListe()));
}

console.log("\n⑱b ÜSTLENME ATOMİKTİR: iki oturum aynı devri birlikte koşamaz");
{
  const id = devirListe()[0].id;
  const y1 = spawnCli(B.sessionId, ["devir", "al", "--id", id]);
  const y2 = spawnCli(C.sessionId, ["devir", "al", "--id", id]);
  const [c1, c2] = await Promise.all([y1.exited, y2.exited]);
  const kazanan = [c1, c2].filter((c) => c === 0).length;
  ok("eşzamanlı `al` ×2 → TAM BİR kazanan (POSIX rename)", kazanan === 1, `kodlar=${c1},${c2}\n${y1.out()}\n${y2.out()}`);
  ok("kaybeden 'Bu işi KOŞMA' der (exit 1 — hata değil, dedup)",
     /Bu işi KOŞMA/.test(y1.out() + y2.out()) && [c1, c2].includes(1), y1.out() + y2.out());
  ok("kazanan görevi + claim komutunu GERİ SÖYLER (bağlam taşınır)", /ÜSTLENİLDİ/.test(y1.out() + y2.out()) && /claim --res/.test(y1.out() + y2.out()));
  ok("üstlenilen kayıt listeden düştü (arşive gitti)", !devirListe().some((d) => d.id === id), JSON.stringify(devirListe().map((x) => x.id)));
  runCli(B.sessionId, ["release", "--all"]);
  runCli(C.sessionId, ["release", "--all"]);
}

console.log("\n⑲ LİMİT DEVRİ: 27 Tem vakası (tek kilit 4 session'ı dondurdu) YENİDEN ÜRETİLEMEZ");
{
  const D = spawnSession("d1d1d1d1-0000-0000-0000-000000000006", "sahip: plan-index yazımı");
  const E = spawnSession("e2e2e2e2-0000-0000-0000-000000000007", "bekleyen (aktif)");
  const F = spawnSession("f3f3f3f3-0000-0000-0000-000000000008", "isteyen (işaret)");
  globalThis.__D = D; globalThis.__E = E; globalThis.__F = F;

  ok("ön koşul: D kilidi aldı", runCli(D.sessionId, ["claim", "--res", "dc-html", "--intent", "plan-index yazımı"]).code === 0);
  const ew = spawnWait(E.sessionId, "dc-html", ["--intent", "E'nin beklemedeki işi"]);
  await sleep(700);
  const fm = runCli(F.sessionId, ["claim", "--res", "dc-html", "--intent", "F de ister"]);
  ok("ön koşul: E AKTİF bekliyor, F işaret bıraktı (vakanın kuyruğu)",
     queueOf("dc-html").some((w) => w.sessionId === E.sessionId && w.pid) && fm.code === 3, JSON.stringify(queueOf("dc-html")));

  /* Sahip spend-limit'e girer: pid CANLI (o yüzden kilit DOĞRU biçilmez) ama iş yapamaz.
     07 bunu `session-status/<sid>.json → limit` alanına yazar; 08 oradan okur. */
  statusYama(D.sessionId, { limit: { sinif: "spend", resetTs: null, ts: Date.now() } });
  ok("ön koşul: sahip pid'i HÂLÂ CANLI (biçme sebebi ölüm DEĞİL)", psStart(D.pid) !== "");
  const arsivOnce = arsivDosyalari().length;
  runGuard("limit_devir", { hook_event_name: "Stop", session_id: D.sessionId, cwd: REPO });

  ok("D'nin kilidi devredildi (canlı dizinde yok)", !existsSync(claimFileOf("dc-html")) || claimOku("dc-html")?.owner?.sessionId !== D.sessionId);
  const arsiv = arsivDosyalari().filter((f) => !arsivOnce || true);
  const yeni = arsiv.map((f) => { try { return JSON.parse(readFileSync(join(ledgerDirIn(), "_archive", f), "utf8")); } catch { return null; } })
                    .filter((x) => x?._reaped?.why === "limit devri");
  ok("arşiv kaydı sebebi TAŞIR (_reaped.why = limit devri)", yeni.length === 1, JSON.stringify(arsiv.slice(-3)));
  const dl = devirListe().filter((x) => x.kaynak === "limit");
  ok("devir işareti kaynak=limit + limit sınıfını taşır", dl.length === 1 && dl[0].limit?.sinif === "spend", JSON.stringify(dl));

  const code = await Promise.race([ew.exited, sleep(12000).then(() => "timeout")]);
  ok("⭐ KUYRUK ÇÖZÜLDÜ: bekleyen E kilidi ALDI (vaka 27 Tem'de burada donuyordu)",
     code === 0 && /SIRA SENDE — CLAIM ALINDI/.test(ew.out()), `code=${code} out=${ew.out()}`);
  runCli(E.sessionId, ["release", "--res", "dc-html"]);
  const f2 = runCli(F.sessionId, ["claim", "--res", "dc-html", "--intent", "F sırası"]);
  ok("ardından F de alır (kimse süresiz aç kalmaz)", f2.code === 0, f2.out);
  runCli(F.sessionId, ["release", "--all"]);
}

console.log("\n⑲b YANLIŞ POZİTİF KAPISI: her 'limit' alanı devir tetiklemez");
{
  const { __D: D } = globalThis;
  const dur = (etiket) => {
    runCli(D.sessionId, ["claim", "--res", "dc-html", "--intent", etiket]);
    runGuard("limit_devir", { hook_event_name: "Stop", session_id: D.sessionId, cwd: REPO });
    const c = claimOku("dc-html");
    const kaldi = c?.owner?.sessionId === D.sessionId;
    runCli(D.sessionId, ["release", "--all"]);
    return kaldi;
  };
  statusYama(D.sessionId, { limit: { sinif: "diger", resetTs: null, ts: Date.now() } });
  ok("`diger` (geçici overload) → kilit DURUR (bu bir askı değil)", dur("diger denemesi"));
  statusYama(D.sessionId, { limit: { sinif: "session", resetTs: Date.now() - 3600e3, ts: Date.now() - 7200e3 } });
  ok("BAYAT limit alanı (reset geçmiş) → kilit DURUR (pencere kapandı)", dur("bayat resetTs"));
  statusYama(D.sessionId, { limit: { sinif: "session", resetTs: Date.now() + 3600e3, ts: Date.now() } });
  ok("POZİTİF kontrol: reset İLERİDE → devredilir (kapı çalışıyor, kapalı değil)", !dur("canlı pencere"));
}

console.log("\n⑲c ÖZ-KAPSAM: limitli session BAŞKASININ kilidine dokunamaz");
{
  const { __D: D, __F: F } = globalThis;
  runCli(F.sessionId, ["claim", "--res", "dc-html", "--intent", "F'nin işi (limitli DEĞİL)"]);
  statusYama(D.sessionId, { limit: { sinif: "spend", resetTs: null, ts: Date.now() } });
  const devirOnce = devirListe().length;
  runGuard("limit_devir", { hook_event_name: "Stop", session_id: D.sessionId, cwd: REPO });
  ok("F'nin kilidi YERİNDE (üçüncü tarafın biçmesi YOK)", claimOku("dc-html")?.owner?.sessionId === F.sessionId, JSON.stringify(claimOku("dc-html")?.owner));
  ok("hiç devir kaydı doğmadı (öz-kapsam sert)", devirListe().length === devirOnce);
  runCli(F.sessionId, ["release", "--all"]);
}

console.log("\n⑲d İDEMPOTENS · ctx YEDEĞİ · talimat katmanının eli");
{
  const { __D: D } = globalThis;
  statusYama(D.sessionId, { limit: { sinif: "spend", resetTs: null, ts: Date.now() } });
  runCli(D.sessionId, ["claim", "--res", "dc-html", "--intent", "idempotens denemesi"]);
  runGuard("limit_devir", { hook_event_name: "Stop", session_id: D.sessionId, cwd: REPO });
  const n1 = devirListe().length;
  runGuard("limit_devir", { hook_event_name: "Stop", session_id: D.sessionId, cwd: REPO });
  ok("limit_devir ×2 → İKİNCİ koşum yeni kayıt DOĞURMAZ (idempotent)", devirListe().length === n1, `${n1} → ${devirListe().length}`);

  /* ctx YEDEĞİ: Stop kaydı gecikse/hiç ateşlenmese de pencere bir sonraki turda kapanır. */
  runCli(D.sessionId, ["claim", "--res", "dc-html", "--intent", "ctx yedeği denemesi"]);
  ok("ön koşul: kilit yine D'de", claimOku("dc-html")?.owner?.sessionId === D.sessionId);
  runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: D.sessionId, cwd: REPO });
  ok("ctx YEDEĞİ kendi kilidini devretti (07 gecikse de pencere kapanır)",
     claimOku("dc-html")?.owner?.sessionId !== D.sessionId, JSON.stringify(claimOku("dc-html")?.owner));

  /* TALİMAT katmanı: modelin kendi eli. `--kuru` hiçbir şey yazmaz. */
  runCli(D.sessionId, ["claim", "--res", "dc-html", "--intent", "elle devir denemesi"]);
  const k = runCli(D.sessionId, ["limit-devir", "--kuru"]);
  ok("`limit-devir --kuru` devredileceği SÖYLER, YAZMAZ",
     /KURU KOŞUM/.test(k.out) && /devredilecek: dc-html/.test(k.out) && claimOku("dc-html")?.owner?.sessionId === D.sessionId, k.out);
  const e = runCli(D.sessionId, ["limit-devir"]);
  ok("`limit-devir` ıslak koşum devreder ve işaret id'sini söyler",
     /LİMİT DEVRİ/.test(e.out) && /devir işareti/.test(e.out) && claimOku("dc-html")?.owner?.sessionId !== D.sessionId, e.out);
  statusYama(D.sessionId, { limit: null });
  const y = runCli(D.sessionId, ["limit-devir"]);
  ok("askıda DEĞİLKEN `limit-devir` hiçbir şey yapmaz ve bunu SÖYLER", /GEREKMİYOR/.test(y.out), y.out);
}

console.log("\n⑳ P1 KALP ATIŞI: `renewedAt` artık ölü alan değil (1 yazar → 0 okuyucu idi)");
{
  const { __F: F } = globalThis;
  runCli(F.sessionId, ["release", "--all"]);
  runCli(F.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "P1 ölçümü"]);
  const c0 = claimOku("scripts/x.cjs");
  ok("ön koşul: yeni claim'de renewedAt == createdAt", c0.renewedAt === c0.createdAt);

  claimYaslandir("scripts/x.cjs", 2 * 60 * 1000); // 2 dk sessizlik
  const g = runGuard("write", editPayload(F.sessionId, "scripts/x.cjs"));
  ok("sahip kendi kilidine yazabilir (uyum bozulmadı)", g.dec === null, JSON.stringify(g.dec));
  const c1 = claimOku("scripts/x.cjs");
  ok("dokunuş: renewedAt İLERLEDİ (kapı artık geçerken tazeliyor)",
     Date.parse(c1.renewedAt) > Date.parse(c0.createdAt) && Date.now() - Date.parse(c1.renewedAt) < 60_000, `${c0.createdAt} → ${c1.renewedAt}`);
  ok("createdAt DEĞİŞMEDİ (kilit diriltilmedi, yalnız tazelendi)", c1.createdAt === c0.createdAt);

  runGuard("write", editPayload(F.sessionId, "scripts/x.cjs"));
  const c2 = claimOku("scripts/x.cjs");
  ok("THROTTLE: aynı dakikadaki ikinci yazım defteri KIMILDATMAZ (60 sn)", c2.renewedAt === c1.renewedAt);

  /* NEGATİF: başkasının kilidi tazelenmez — dokunuş YALNIZ ownerMatch dalındadır. */
  const { __E: E } = globalThis;
  claimYaslandir("scripts/x.cjs", 3 * 60 * 1000);
  const eski = claimOku("scripts/x.cjs").renewedAt;
  const gd = runGuard("write", editPayload(E.sessionId, "scripts/x.cjs"));
  ok("başkasının yazımı DENY (koruma duruyor)", gd.dec?.permissionDecision === "deny");
  ok("başkasının dokunuşu kilidi TAZELEMEZ (bayatlık sahibin işidir)", claimOku("scripts/x.cjs").renewedAt === eski);
  runCli(F.sessionId, ["release", "--all"]);
  runCli(E.sessionId, ["release", "--all"]);
}

console.log("\n㉑ P2 BAYATLIK: kilit SİLİNMEZ, sahibi DEĞİŞİR — ve devir ASLA sessiz olmaz");
{
  const { __D: D, __E: E } = globalThis;
  runCli(D.sessionId, ["claim", "--res", "dc-html", "--intent", "D: uzun süre dokunmadığı iş"]);
  statusYama(D.sessionId, { state: "idle" });
  claimYaslandir("dc-html", 2 * 3600e3); // 2 sa yenileme yok
  const devirOnce = devirListe().length;

  const ew = spawnWait(E.sessionId, "dc-html", ["--intent", "E: sıradaki iş"]);
  const code = await Promise.race([ew.exited, sleep(12000).then(() => "timeout")]);
  ok("⭐ DEVREDİLEBİLİR kilit AKTİF BEKLEYENE devroldu", code === 0 && /BAYAT KİLİT DEVRALINDI/.test(ew.out()), `code=${code} out=${ew.out()}`);
  ok("gerekçe + eşik SÖYLENİR (sessiz devir yok)", /yenilenmedi/.test(ew.out()) && /eşik 60 dk/.test(ew.out()), ew.out());
  ok("kilit E'de (sahip DEĞİŞTİ, kilit silinmedi)", claimOku("dc-html")?.owner?.sessionId === E.sessionId);
  ok("pid-canlılık DEĞİŞMEZİ ihlal edilmedi: eski sahip HÂLÂ CANLI", psStart(D.pid) !== "");
  ok("eski sahibe devir işareti bırakıldı (kaynak=bayat)",
     devirListe().some((d) => d.kaynak === "bayat" && d.devreden?.sessionId === D.sessionId), JSON.stringify(devirListe().map((x) => x.kaynak)));
  ok("arşiv kaydı sebebi TAŞIR (bayat — devredildi)",
     arsivDosyalari().map((f) => { try { return JSON.parse(readFileSync(join(ledgerDirIn(), "_archive", f), "utf8"))?._reaped?.why; } catch { return ""; } })
       .some((w) => /bayat — devredildi/.test(String(w))));

  /* SESSİZ EZME YOK: eski sahip ilk yazımında ne olduğunu OKUR. */
  const g = runGuard("write", editPayload(D.sessionId, "design-source/studio.dc.html"));
  const rz = g.dec?.permissionDecisionReason || "";
  ok("eski sahip DENY yer (kilit gerçekten devretti)", g.dec?.permissionDecision === "deny", JSON.stringify(g.dec));
  ok("⭐ DENY metni başta 'KİLİDİN DEVREDİLDİ' der (sürpriz değil, ilan)", /^KİLİDİN DEVREDİLDİ/.test(rz), rz);
  ok("sebebi ve yeniden claim yolunu SÖYLER", /BAYATLIK KADEMESİ/.test(rz) && /claim --res "dc-html"/.test(rz), rz);
  runCli(E.sessionId, ["release", "--all"]);
  ok("ön koşul (sonraki bloklar): devir kaydı sayısı arttı", devirListe().length > devirOnce);
}

console.log("\n㉑b P2'nin ÜÇ FRENİ — yanlış pozitif en pahalı hatadır");
{
  const { __D: D, __E: E, __F: F } = globalThis;
  /* FREN 1 — BEKLEYEN YOKSA HİÇBİR ŞEY OLMAZ: devir yalnız aktif bekleyicinin elindedir,
     arka planda koşan bir zamanlayıcı YOK. */
  runCli(D.sessionId, ["claim", "--res", "dc-html", "--intent", "bekleyeni olmayan bayat kilit"]);
  statusYama(D.sessionId, { state: "idle" });
  claimYaslandir("dc-html", 2 * 3600e3);
  const c = runCli(F.sessionId, ["claim", "--res", "dc-html", "--intent", "F ister ama beklemez"]);
  ok("bekleyensiz: `claim` MEŞGUL (exit 3) — devir DOĞMAZ", c.code === 3, c.out);
  await sleep(1200);
  ok("bekleyensiz: kilit 1,2 sn sonra da YERİNDE (zamanlayıcı yok)", claimOku("dc-html")?.owner?.sessionId === D.sessionId);
  ok("bekleyensiz: kapı hâlâ DENY (koruma gevşemedi)",
     runGuard("write", editPayload(F.sessionId, "design-source/studio.dc.html")).dec?.permissionDecision === "deny");
  runCli(F.sessionId, ["release", "--res", "dc-html"]);

  /* FREN 2 — `generating` sahip ASLA düşürülmez: çalışan bir iş bayat değildir. */
  statusYama(D.sessionId, { state: "generating" });
  claimYaslandir("dc-html", 3 * 3600e3);
  const w2 = spawnWait(E.sessionId, "dc-html", ["--intent", "E bekler ama devralmamalı"]);
  await sleep(2600);
  ok("`generating` sahip düşürülmez (wait BEKLEMEYE devam eder)", w2.p.exitCode === null && !/DEVRALINDI/.test(w2.out()), w2.out());
  ok("kilit hâlâ D'de (3 saatlik sessizliğe rağmen)", claimOku("dc-html")?.owner?.sessionId === D.sessionId);
  w2.p.kill(9);
  await sleep(300);

  /* FREN 3 — ÖLÇÜM YOKLUĞU ÖLÜM DEĞİLDİR: `renewedAt` taşımayan legacy kayıt TAZE sayılır. */
  statusYama(D.sessionId, { state: "idle" });
  claimYaslandir("dc-html", null); // alanı SİL (eski sürümle alınmış kilit)
  const w3 = spawnWait(F.sessionId, "dc-html", ["--intent", "F bekler ama legacy kayıt devralınmaz"]);
  await sleep(2600);
  ok("legacy kayıt (renewedAt YOK) TAZE sayılır — devralınmaz", w3.p.exitCode === null && !/DEVRALINDI/.test(w3.out()), w3.out());
  ok("kilit hâlâ D'de (ölçemediğin şeye hüküm vermezsin)", claimOku("dc-html")?.owner?.sessionId === D.sessionId);
  w3.p.kill(9);
  await sleep(300);
  runCli(D.sessionId, ["release", "--all"]);
}

console.log("\n㉑c İŞARET YAZILAMAZSA DEVİR YAPILMAZ — devrin ön koşulu, süsü değil");
{
  /* otonomi-merdiveni:10.3 — fikstür denetiminin bulduğu TEK boşluk.
   *
   * `claim.mjs`in devir dalı işareti ÖNCE yazar, sonra kilidi arşivler:
   *     try { isaretId = writeDevir(...) } catch { isaretId = null }
   *     if (isaretId) { archiveClaim(...); ... }
   * Bu `if` bir savunmadır: işaret yazılamadığı hâlde devir yapılsaydı eski sahip kilidini
   * KAYBEDER ve bunu okuyacağı hiçbir kayıt OLMAZDI — yani tam olarak tasarımın yasakladığı
   * SESSİZ EZME. ㉑ bu dalın MUTLU yolunu ölçüyordu; hata yolu ölçülmemişti, dolayısıyla
   * savunmanın çalıştığı bir VARSAYIMdı. (Kanıt sınıfı: "kapı var" ≠ "kapı kapanıyor".)
   *
   * Arıza GERÇEK üretilir, mock'lanmaz: `devir` dizininin yerine bir DOSYA konur →
   * `writeDevir`in `mkdirSync(dir, {recursive:true})` çağrısı EEXIST fırlatır. */
  const { __D: D, __E: E } = globalThis;
  const devirYol = join(ledgerDirIn(), "devir");
  const yedek = existsSync(devirYol) ? `${devirYol}.yedek-${Date.now()}` : null;
  if (yedek) renameSync(devirYol, yedek);
  writeFileSync(devirYol, "bu bir DOSYA — mkdirSync EEXIST fırlatmalı");

  runCli(D.sessionId, ["claim", "--res", "dc-html", "--intent", "D: işaret yazılamayacak"]);
  statusYama(D.sessionId, { state: "idle" });
  claimYaslandir("dc-html", 2 * 3600e3);
  const arsivOnce = arsivDosyalari().length;

  const w = spawnWait(E.sessionId, "dc-html", ["--intent", "E bekler ama işaret yazılamaz"]);
  await sleep(2600);
  ok("⭐ işaret YAZILAMAYINCA devir YAPILMAZ (sessiz ezme yasağı mekanik)",
     w.p.exitCode === null && !/DEVRALINDI/.test(w.out()), `exit=${w.p.exitCode} out=${w.out()}`);
  ok("kilit ESKİ SAHİPTE kaldı (kaybolan kilit + kayıtsız devir YOK)",
     claimOku("dc-html")?.owner?.sessionId === D.sessionId);
  ok("arşive de hiçbir şey yazılmadı (yarım devir bırakılmadı)",
     arsivDosyalari().length === arsivOnce, `${arsivOnce} → ${arsivDosyalari().length}`);
  ok("eski sahip kendi kilidine HÂLÂ yazabilir (hakkı eksilmedi)",
     runGuard("write", editPayload(D.sessionId, "design-source/studio.dc.html")).dec === null);
  w.p.kill(9);
  await sleep(300);

  /* Arızayı KALDIR ve aynı kurulumda devrin GERÇEKTEN olabildiğini göster: yukarıdaki
     "olmadı" hükmü ancak "engel kalkınca olur" ile birlikte bir şey KANITLAR — yoksa
     testin kendisi başka bir sebeple de yeşil kalabilirdi (yanlış-negatif kapısı).
     YENİDEN YAŞLANDIRMA ŞART: bir önceki `ok` sahibin KENDİ yazımıydı ve P1 kalp atışı
     `renewedAt`i tazeledi (㉑'in ölçtüğü davranış) — kilit artık TAZE, devredilemez.
     Bu satırın yokluğu kontrolü sahte kırmızıya boyuyordu (ölçüldü: code=timeout). */
  rmSync(devirYol, { force: true });
  if (yedek) renameSync(yedek, devirYol);
  claimYaslandir("dc-html", 2 * 3600e3);
  const w2 = spawnWait(E.sessionId, "dc-html", ["--intent", "E: engel kalktı"]);
  const c2 = await Promise.race([w2.exited, sleep(12000).then(() => "timeout")]);
  ok("kontrol: engel KALKINCA aynı kurulum devri YAPAR (test yanlış-negatif değil)",
     c2 === 0 && /BAYAT KİLİT DEVRALINDI/.test(w2.out()), `code=${c2} out=${w2.out()}`);
  /* Zaman aşımına düşen bekleyen SIZDIRILMAZ: canlı `wait` süreci kuyrukta kayıt tutar ve
     SONRAKİ blokların kurulumunu bozar (ölçüldü: ㉘'in `claim`i MEŞGUL'e düşüp yetim kuyruk
     dosyası hiç doğmadı → ENOENT). Harness'ın kendi artığı, ürünün hükmü gibi görünmemeli. */
  if (c2 !== 0) { try { w2.p.kill(9); } catch { /* zaten ölmüş */ } await sleep(300); }
  runCli(E.sessionId, ["release", "--all"]);
  runCli(D.sessionId, ["release", "--all"]);
}

console.log("\n㉑d H2 KOD KİLİDİ: kapalı bir ön koşul, kodda kapalıdır (belgede değil)");
{
  /* otonomi-merdiveni:10.5 — K2, H2'yi (bayat kilidi CANLI BEKLEYEN OLMADAN devretme) üç ön
   * koşula bağladı. Belgede yazan ön koşul ön koşul DEĞİLDİR: onu atlayan kod derlenir,
   * testler yeşil kalır, kimse fark etmez. O yüzden koşul H2'yi yazabilecek TEK yolun içinde. */
  /* Lib AYRI SÜREÇTE ve SANDBOX ENV'iyle sürülür — bu dosyanın kendi süreci GERÇEK homedir()'i
     taşır, in-process import `CLAIMS_DIR`i gerçek ~/.claude'a çözerdi (salt-okunurluk ihlali).
     Harness'ın değişmezi: ürüne HER ZAMAN dışarıdan, ENV ile dokunulur. */
  const LIB = join(HERE, "..", "..", "..", "hooks", "claims-lib.mjs");
  const libKos = (govde) => {
    const r = spawnSync("node", ["--input-type=module", "-e",
      `const L = await import(${JSON.stringify(LIB)});\nconst REPO = ${JSON.stringify(REPO)};\n${govde}`],
      { encoding: "utf8", cwd: REPO, env: ENV });
    return ((r.stdout || "") + (r.stderr || "")).trim();
  };

  const once = devirListe().length;
  const h2 = libKos(`try { L.writeDevir(REPO, { keys: ["dc-html"], kaynak: L.H2_KAYNAK, gorev: "H2 nöbetçisi" }); console.log("YAZDI"); }
                     catch (e) { console.log("FIRLATTI: " + e.message); }`);
  ok("⭐ H2 yazımı (kaynak='nobet') kapı kapalıyken FIRLATIR", /^FIRLATTI/.test(h2), h2);
  ok("mesaj HANGİ ön koşulun eksik olduğunu söyler (çaresiz alarm değil)",
     /H2 KAPALI/.test(h2) && /ön koşul:/.test(h2) && /h2-kapi/.test(h2), h2);
  ok("HİÇBİR ŞEY YAZILMADI (yarım H2 bırakılmaz)", devirListe().length === once, `${once} → ${devirListe().length}`);

  /* Kilit DAR olmalı: bugünkü meşru üç yol H0/H1'dir (arkalarında ya insan iradesi ya CANLI
     bekleyen vardır) ve bu kapıdan GEÇMEZ. Geniş bir kilit devri komple kırardı. */
  for (const k of ["devret", "limit", "bayat"]) {
    const y = libKos(`try { const r = L.writeDevir(REPO, { keys: ["dc-html"], kaynak: ${JSON.stringify(k)}, gorev: "meşru yol" });
                            L.takeDevir(REPO, r.id); console.log("YAZDI"); }
                      catch (e) { console.log("FIRLATTI: " + e.message); }`);
    ok(`meşru yol etkilenmedi: kaynak='${k}' yazabiliyor`, y === "YAZDI", y);
  }

  /* Kapının kendi ölçümü de okunabilir olmalı — "neden açılmıyor" cevapsız kalmamalı. */
  const kj = runCli(globalThis.__D.sessionId, ["h2-kapi", "--json"]);
  let kapi = null; try { kapi = JSON.parse(kj.out); } catch { /* şekil bozuk */ }
  ok("`h2-kapi` eşik altında exit 1 verir (kapı DURDURUR)", kj.code === 1, `code=${kj.code}`);
  ok("kapı ölçümü eksen eksen okunabilir", Array.isArray(kapi?.eksenler) && kapi.eksenler.length >= 3,
     JSON.stringify(kapi?.eksenler?.map((e) => `${e.eksen}=${e.hukum}`)));
  ok("onay kuyruğu ekseni İLANLI KÖR NOKTA (BEKLIYOR — sessizce 'yok' sayılmaz)",
     !!kapi?.eksenler?.some((e) => e.eksen === "onay-kuyrugu" && e.hukum === "BEKLIYOR"));
  ok("her FAIL ekseni bir `onar:` taşır (çaresi olmayan alarm alarmı köreltir)",
     !!kapi?.eksenler?.filter((e) => e.hukum === "FAIL").every((e) => !!e.onar));
}

console.log("\n㉒ P5: her arşivleme TEK kayıt bırakır (588 'kayıtsız' kaydın gerçek kaynağı)");
{
  const { __F: F } = globalThis;
  const once = arsivDosyalari();
  runCli(F.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "P5 ölçümü"]);
  runCli(F.sessionId, ["release", "--res", "scripts/x.cjs"]);
  const sonra = arsivDosyalari();
  ok("arşiv TAM +1 arttı (ikiz YOK — eskiden her biçme 2 dosya yazıyordu)", sonra.length - once.length === 1, `${once.length} → ${sonra.length}`);
  const yeniAd = sonra.filter((f) => !once.includes(f))[0];
  const kayit = JSON.parse(readFileSync(join(ledgerDirIn(), "_archive", yeniAd), "utf8"));
  ok("kayıt sebebi TAŞIR (_reaped.why = release)", kayit?._reaped?.why === "release", JSON.stringify(kayit?._reaped));
  ok("kayıt biçme anındaki KUYRUK UZUNLUĞUNU taşır (A2.5'in ölçüm ihtiyacı)", "queueLen" in (kayit?._reaped || {}), JSON.stringify(kayit?._reaped));
  ok("'-x-' çıplak ikiz HİÇ doğmadı", !sonra.some((f) => f.includes("-x-")), sonra.filter((f) => f.includes("-x-")).join(","));
  ok("canlı dizinde kalmadı", !existsSync(claimFileOf("scripts/x.cjs")));
}

console.log("\n㉓ T5: enkaz süpürmesi AÇILIŞTA (SessionEnd tarafı zaten vardı)");
{
  const { __E: E, __F: F } = globalThis;
  runCli(F.sessionId, ["claim", "--res", "dc-html", "--intent", "F tutar"]);
  runCli(E.sessionId, ["claim", "--res", "dc-html", "--intent", "E istedi, yoluna gitti"]); // İŞARET
  runCli(F.sessionId, ["release", "--res", "dc-html"]); // claim gitti, kuyruk YETİM kaldı
  const qf = queueFileOf("dc-html");
  ok("ön koşul: yetim kuyruk dosyası diskte", existsSync(qf), qf);
  yaslandir(qf, E.sessionId, 31 * 60 * 1000);

  runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: F.sessionId, cwd: REPO });
  ok("UserPromptSubmit yolunda SÜPÜRME YOK (ilanlı muafiyet — her tur dizin gezilmez)", existsSync(qf), qf);

  const r = runGuard("ctx", { hook_event_name: "SessionStart", session_id: F.sessionId, cwd: REPO });
  ok("SessionStart bayat kuyruk kaydını SÜPÜRDÜ (boşalan dosya silindi)", !existsSync(qf), qf);
  ok("açılış bloğu devralınmayı bekleyen devir işaretini İLAN eder",
     /devir işareti/.test(r.dec?.additionalContext || ""), JSON.stringify(r.dec?.additionalContext || "").slice(0, 400));
}

console.log("\n㉔ muafiyet: kapı YENİ çareyi de reddedemez — ama muafiyet kalkan değildir");
{
  const { __E: E, __F: F } = globalThis;
  runCli(F.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "F tutar"]);
  const bp = (sid, cmd) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: sid, cwd: REPO, tool_input: { command: cmd } });
  for (const [cmd, ad] of [
    [`node ${CLI} devir list`, "devir list — kilitliyken başka session'dan okunur"],
    [`node ${CLI} devir al --id 123-abc`, "devir al — devrin üstlenilme ucu"],
    [`node ${CLI} limit-devir --kuru`, "limit-devir — talimat katmanının eli"],
    [`node ${CLI} devir list --json | grep -c id`, "protokol + salt-okunur boru"],
  ]) {
    ok(`GEÇER: ${ad}`, runGuard("bash", bp(E.sessionId, cmd)).dec === null, cmd);
  }
  for (const [cmd, ad] of [
    [`node ${CLI} devir al --id 123-abc && rm -f scripts/x.cjs`, "devir al + yazar segment"],
    [`node ${CLI} limit-devir; sed -i '' 's/a/b/' scripts/x.cjs`, "limit-devir + sed -i"],
  ]) {
    ok(`DENY: ${ad}`, runGuard("bash", bp(E.sessionId, cmd)).dec?.permissionDecision === "deny", cmd);
  }
  runCli(F.sessionId, ["release", "--all"]);
  runCli(E.sessionId, ["release", "--all"]);
}

console.log("\n㉕ PLAN ANAHTARI KÖPRÜSÜ: iki claim ailesi mekanik olarak çakışır (otonomi-merdiveni:03)");
{
  /* ÖLÇÜLMÜŞ KIRMIZI (2026-08-03): `plan:<slug>:asama:<no>` tanımsız bir anahtardı →
     `resolveRes` onu literal "path"e düşürüyor, `pathsOfResource` onu YOL sanıyordu.
     `plans/<slug>/**` ile hiçbir yönde kesişmiyordu: canlı iki session glob ailesini
     tutarken aynı plana aşama claim'i DENY YEMEDEN geçiyordu (çift dispatch'in kaynağı). */
  runCli(B.sessionId, ["release", "--all"]);
  runCli(C.sessionId, ["release", "--all"]);

  const r = runCli(B.sessionId, ["claim", "--res", "glob:plans/pnl/**", "--intent", "B: plan düzeyi"]);
  ok("ön koşul: B plan globunu tutuyor", r.code === 0, r.out);

  const a = runCli(C.sessionId, ["claim", "--res", "plan:pnl:asama:01", "--intent", "C: aşama"]);
  ok("YÖN A — glob tutuluyorken AŞAMA anahtarı DENY yer", a.code === 3, a.out);
  ok("DENY sebebi köprüyü SÖYLER (plan kilidi)", /plan kilidi/.test(a.out), a.out);
  ok("DENY plan-ARASI paralelliğin sürdüğünü söyler", /plan-ARASI/.test(a.out), a.out);

  // FAZLA-BLOKAJ YOK: köprü yalnız AYNI slug'ı bağlar.
  const n1 = runCli(C.sessionId, ["claim", "--res", "plan:baska-plan:asama:01", "--intent", "C: başka plan"]);
  ok("BAŞKA planın aşaması SERBEST (fazla-blokaj yok)", n1.code === 0, n1.out);
  const n2 = runCli(C.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "C: kod yolu"]);
  ok("alakasız kod yolu SERBEST", n2.code === 0, n2.out);
  runCli(C.sessionId, ["release", "--all"]);
  runCli(B.sessionId, ["release", "--all"]);

  // TERS YÖN — simetri şart: tek yönlü bir köprü yalnız yarısını korur.
  const b1 = runCli(C.sessionId, ["claim", "--res", "plan:pnl:asama:02", "--intent", "C: aşama önce"]);
  ok("ön koşul: C aşama anahtarını tutuyor", b1.code === 0, b1.out);
  const b2 = runCli(B.sessionId, ["claim", "--res", "glob:plans/pnl/**", "--intent", "B: glob sonra"]);
  ok("YÖN B — aşama tutuluyorken GLOB DENY yer (köprü simetrik)", b2.code === 3, b2.out);

  /* İLANLI YAN ETKİ: türev yol plan DİZİNİdir → aynı planın İKİ AŞAMASI da çakışır.
     Bu kabuldür (iki aşama zaten aynı STATE.md/CHECKLIST.md'ye yazar) ve İLAN EDİLİR. */
  const y = runCli(B.sessionId, ["claim", "--res", "plan:pnl:asama:07", "--intent", "B: aynı planın ikinci aşaması"]);
  ok("İLANLI YAN ETKİ: aynı planın iki aşaması da çakışır", y.code === 3, y.out);
  ok("yan etki DENY metninde İLAN edilir", /plan kilidi/.test(y.out), y.out);
  runCli(C.sessionId, ["release", "--all"]);
  runCli(B.sessionId, ["release", "--all"]);
}

console.log("\n㉕b TOCTOU VALFİ: claim-sonrası mutabakat turu (çift sahiplik ÜRETİLEMEZ)");
{
  /* `tryCreateClaim`in `wx` atomiği yalnız AYNI anahtarın yarışını çözer (dosya adı
     sha1(key)). Köprü FARKLI anahtarları çakıştırdığı için yeni bir yarış açtı: iki
     session ön-taramayı aynı anda geçip ikisi de yazabilir → ÇİFT SAHİPLİK.
     Valf: yazımdan sonra defter bir kez daha okunur; ÖNCE YAZILMIŞ (mtime) çakışan bir
     kilit varsa kaybeden kendi kilidini geri verir. */
  runCli(B.sessionId, ["release", "--all"]);
  runCli(C.sessionId, ["release", "--all"]);

  const canliSayisi = () =>
    readdirSync(join(HOME, ".claude", "claims"), { recursive: true })
      .filter((f) => /toc/.test(String(f)) && String(f).endsWith(".json") && !String(f).endsWith(".q.json")).length;

  let cift = 0, valf = 0, tur = 12;
  for (let i = 0; i < tur; i++) {
    runCli(B.sessionId, ["release", "--all"]);
    runCli(C.sessionId, ["release", "--all"]);
    // AYNI ANDA: iki farklı aile, aynı plan → ön-tarama ikisini de kaçırabilir
    const p1 = spawn("node", [CLI, "claim", "--res", "glob:plans/toc/**", "--intent", "yarış B"],
                     { cwd: REPO, env: { ...ENV, CLAUDE_CODE_SESSION_ID: B.sessionId } });
    const p2 = spawn("node", [CLI, "claim", "--res", "plan:toc:asama:01", "--intent", "yarış C"],
                     { cwd: REPO, env: { ...ENV, CLAUDE_CODE_SESSION_ID: C.sessionId } });
    let o1 = "", o2 = "";
    p1.stdout.on("data", (d) => (o1 += d)); p2.stdout.on("data", (d) => (o2 += d));
    await Promise.all([p1, p2].map((p) => new Promise((res) => p.on("close", res))));
    if (/MUTABAKAT/.test(o1 + o2)) valf++;
    if (canliSayisi() >= 2) cift++;
  }
  ok(`ÇİFT SAHİPLİK üretilemedi (${tur} eşzamanlı yarış turu)`, cift === 0, `${cift} turda iki kilit birden`);
  /* valf=0 ise yarış penceresi hiç açılmamıştır → bu koşu valfi SINAMAMIŞTIR.
     Yokluk kanıt değildir: ölçemediğimizi İLAN ederiz, "geçti" demeyiz. */
  if (valf === 0)
    olculemedi("valf gerçekten devreye girdi", `${tur} turun hiçbirinde yarış penceresi açılmadı (ön-tarama yakaladı)`);
  else ok(`valf devreye girdi ve kilidi geri verdi (${valf}/${tur} tur)`, true);
  runCli(B.sessionId, ["release", "--all"]);
  runCli(C.sessionId, ["release", "--all"]);
}

console.log("\n㉖ OLAY DEFTERİ: bekleme ÖLÇÜLEBİLİR (otonomi-merdiveni:05)");
{
  /* NEDEN VAR: kilit hakemi (06) doğmadan önce VERİ gerekir — hakemin yanlış hükmü çalışan
     işi öldürür. Bugüne dek DENY'in tek izi 30 dk ömürlü kuyruk İŞARETİydi ve `since`
     bekleyiş bitince siliniyordu → "X kaç kez Y yüzünden bloke oldu, kaç dakika kaybetti"
     TÜRETİLEMİYORDU. Defter yalnız YAZAR; hüküm 06'nın, eylem hiç kimsenin.

     Bu bölüm defteri ÜRÜNÜ SÜREREK ölçer: satırlar gerçek bir kapı reddinden, gerçek bir
     CLI blokajından ve gerçek bir bekleyiş kapanışından doğar — hiçbiri harness tarafından
     elle yazılmaz. */
  const olayDosyasi = () => join(ledgerDirIn(), "olay.jsonl");
  /** Defteri ÜRÜNÜN yazdığı gibi oku: bozuk satır ATLANIR, silinmez (defter kuralı). */
  const olaylar = () => {
    let ham = "";
    try { ham = readFileSync(olayDosyasi(), "utf8"); } catch { return []; }
    return ham.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  };
  const sonuncu = (tip) => [...olaylar()].reverse().find((o) => o.tip === tip) || null;
  /* TİP BAZLI SAYIM (2026-08-09): defter artık `alindi`/`birakildi`/`bekleyis` olaylarını da
     taşıyor (orkestratör beslemesi onun projeksiyonu). "Toplam satır +1" ölçütü bu yüzden
     yalanlar — ölçülen şey her zaman İLGİLİ TİPİN artışıdır. */
  const sayTip = (tip) => olaylar().filter((o) => o.tip === tip).length;

  runCli(B.sessionId, ["release", "--all"]);
  runCli(C.sessionId, ["release", "--all"]);

  /* ── 05.1 · kapı reddi DEFTERE düşer ── */
  const n0 = sayTip("deny");
  runCli(B.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "B: defter turu"]);
  const g = runGuard("write", { ...editPayload(C.sessionId, "scripts/x.cjs") });
  ok("ön koşul: C'nin Edit'i DENY yedi", g.dec?.permissionDecision === "deny", JSON.stringify(g.dec));

  const d = sonuncu("deny");
  ok("DENY deftere BİR satır yazdı", sayTip("deny") === n0 + 1, `${n0} → ${sayTip("deny")}`);
  ok("satır şeması TAM (v·ts·tip·key·engellenen·sahip·why·queueLen·grade·sure_ms·sonuc)",
     d && ["v", "ts", "tip", "key", "engellenen", "sahip", "why", "queueLen", "grade", "sure_ms", "sonuc"]
       .every((k) => k in d), JSON.stringify(d));
  ok("key = BLOKE EDEN kaynak", d?.key === "scripts/x.cjs", JSON.stringify(d));
  ok("engellenen = reddedilen session (sid8)", d?.engellenen === C.sessionId.slice(0, 8), JSON.stringify(d));
  ok("sahip = kilidi tutan session (sid8)", d?.sahip === B.sessionId.slice(0, 8), JSON.stringify(d));
  ok("why kapı dalını söyler", /dosya yazımı/.test(d?.why || ""), JSON.stringify(d));
  ok("blokaj satırında sure_ms/sonuc NULL (yalnız kapanışta dolar)",
     d?.sure_ms === null && d?.sonuc === null, JSON.stringify(d));

  /* ── 05.2 · kademe OLAY ANINDA ölçülür (sonradan türetilmez) ──
     Ölçüt: aynı kilit yaşlandırılınca AYNI kaynağın yeni satırı FARKLI kademe taşır.
     Kademe sonradan türetilseydi iki satır da bugünkü hâli gösterirdi. */
  ok("taze kilidin satırı TAZE", d?.grade === "TAZE", JSON.stringify(d));
  statusYama(B.sessionId, { state: "idle" });        // gradeClaim yalnız idle/waiting sahibi biçer
  claimYaslandir("scripts/x.cjs", 20 * 60 * 1000);   // > BAYAT eşiği (15 dk), < devredilebilir (60 dk)
  runGuard("write", { ...editPayload(C.sessionId, "scripts/x.cjs") });
  const d2 = sonuncu("deny");
  ok("yaşlanmış kilidin satırı BAYAT (kademe olay anında yazıldı)", d2?.grade === "BAYAT", JSON.stringify(d2));
  ok("ilk satır TAZE kaldı (geçmiş sonradan YENİDEN yazılmaz)",
     olaylar().filter((o) => o.tip === "deny" && o.key === "scripts/x.cjs" && o.grade === "TAZE").length >= 1);
  statusYama(B.sessionId, { state: "generating" });

  /* ── 05.1b · CLI blokajı (exit 3) de aynı satırı hak eder ── */
  const m0 = olaylar().length;
  const mr = runCli(C.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "C: meşgule düşecek"]);
  ok("ön koşul: CLI exit 3 (MEŞGUL)", mr.code === 3, mr.out);
  const m = sonuncu("mesgul");
  ok("MEŞGUL deftere düştü", olaylar().length === m0 + 1 && m?.tip === "mesgul", JSON.stringify(m));
  ok("MEŞGUL satırı engelleneni/sahibi taşır",
     m?.engellenen === C.sessionId.slice(0, 8) && m?.sahip === B.sessionId.slice(0, 8), JSON.stringify(m));

  /* ── 05.3 · bekleyiş KAPANIŞI — `since` silinmeden süre ölçülür ──
     C kapıda DENY yiyince `markWanted` onu kuyruğa yazdı (`since` damgalı). İşareti
     yaşlandırıp B'yi bırakıyoruz: C claim'i alınca `dequeueKapanis` süreyi ÖLÇÜP sonra
     sıradan düşürmeli. Eski kodda bu bilgi kuyruk dosyasıyla birlikte yok oluyordu. */
  const q = queueOf("scripts/x.cjs");
  ok("ön koşul: C kuyrukta (kapı işareti bıraktı)", q.some((w) => w.sessionId === C.sessionId), JSON.stringify(q));
  yaslandir(queueFileOf("scripts/x.cjs"), C.sessionId, 90 * 1000);
  runCli(B.sessionId, ["release", "--all"]);
  const k0 = sayTip("kapanis");
  const cr = runCli(C.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "C: sıra bende"]);
  ok("ön koşul: C kilidi aldı", cr.code === 0, cr.out);
  const k = sonuncu("kapanis");
  ok("KAPANIŞ satırı doğdu", sayTip("kapanis") === k0 + 1 && k?.tip === "kapanis", JSON.stringify(k));
  ok("sure_ms DOLU ve beklenen bekleyişi ölçüyor (≥90sn)",
     Number.isFinite(k?.sure_ms) && k.sure_ms >= 90_000, JSON.stringify(k));
  ok("sonuc = aldi", k?.sonuc === "aldi", JSON.stringify(k));
  ok("kuyruktan gerçekten düştü (ölç, SONRA boşalt)",
     !queueOf("scripts/x.cjs").some((w) => w.sessionId === C.sessionId), JSON.stringify(queueOf("scripts/x.cjs")));

  /* Sıraya hiç girmemiş bir session SAHTE kapanış satırı üretmemeli. */
  const s0 = sayTip("kapanis");
  runCli(A.sessionId, ["claim", "--res", "design-source/studio.dc.html", "--intent", "A: sırasız"]);
  ok("sırada olmayan claim SAHTE kapanış YAZMAZ", sayTip("kapanis") === s0, `${s0} → ${sayTip("kapanis")}`);
  runCli(A.sessionId, ["release", "--all"]);
  runCli(C.sessionId, ["release", "--all"]);

  /* ── `sonuc:"oldu"` — bekleyen KENDİ İRADESİYLE çekilmedi, LİMİT onu düşürdü ──
     Bu dal 05.3'ün "her `dequeue` çağrı noktası" gereğinde ATLANMIŞTI: `limitDevri`
     düz `dequeue` çağırıyordu, yani askıya alınan bir session'ın beklediği kaynağı hiç
     alamadan çekilmesi ÖLÇÜLMÜYORDU — oysa "kaç bekleyiş boşa gitti" sorusunun tam
     cevabı odur. `vazgecti` ile ayrı tutulur: biri KARAR, öteki ARIZA. */
  {
    const { __D: D } = globalThis;
    runCli(D.sessionId, ["release", "--all"]);
    runCli(B.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "B: D'yi kuyruğa itecek"]);
    const dg = runGuard("write", { ...editPayload(D.sessionId, "scripts/x.cjs") });
    ok("ön koşul: D DENY yiyip kuyruğa girdi", dg.dec?.permissionDecision === "deny" &&
       queueOf("scripts/x.cjs").some((w) => w.sessionId === D.sessionId));
    yaslandir(queueFileOf("scripts/x.cjs"), D.sessionId, 45 * 1000);
    statusYama(D.sessionId, { limit: { sinif: "spend", resetTs: null, ts: Date.now() } });
    const l0 = olaylar().length;
    const lr = runCli(D.sessionId, ["limit-devir"]);
    ok("ön koşul: limit devri koştu", /LİMİT DEVRİ/.test(lr.out) || /kuyruk/.test(lr.out), lr.out);
    const lk = sonuncu("kapanis");
    ok("limit devri kuyruktan düşüşü KAPANIŞ olarak yazdı",
       olaylar().length === l0 + 1 && lk?.tip === "kapanis" && lk?.key === "scripts/x.cjs", JSON.stringify(lk));
    ok("sonuc = oldu (karar değil ARIZA)", lk?.sonuc === "oldu", JSON.stringify(lk));
    ok("kayıp süre ölçüldü (≥45sn)", Number.isFinite(lk?.sure_ms) && lk.sure_ms >= 45_000, JSON.stringify(lk));
    statusYama(D.sessionId, { limit: null });
    runCli(D.sessionId, ["release", "--all"]);
    runCli(B.sessionId, ["release", "--all"]);
  }

  /* ── BOZUK SATIR defteri ÖLDÜRMEZ ── */
  appendFileSync(olayDosyasi(), "{bu JSON değil\n");
  const b0 = olaylar().length;
  runCli(B.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "B: bozuk satır sonrası"]);
  const bg = runGuard("write", { ...editPayload(C.sessionId, "scripts/x.cjs") });
  ok("bozuk satırdan SONRA kapı hâlâ DENY veriyor", bg.dec?.permissionDecision === "deny", JSON.stringify(bg.dec));
  ok("bozuk satırdan SONRA defter büyümeye devam etti", olaylar().length > b0, `${b0} → ${olaylar().length}`);
  ok("bozuk satır SİLİNMEDİ (ölçülemeyene hüküm verilmez, veri atılmaz)",
     readFileSync(olayDosyasi(), "utf8").includes("{bu JSON değil"));

  /* ── 05.4 · KAPI ÜRÜNÜ ASLA KİLİTLEMEZ: defter yazılamasa da karar DEĞİŞMEZ ──
     Defteri yazılamaz hâle getiriyoruz (olay.jsonl'i DİZİN yap → appendFileSync EISDIR).
     Bu, "eski claims-lib" ve "disk dolu" sınıflarının ikisini birden temsil eder. */
  const df = olayDosyasi();
  const yedek = readFileSync(df, "utf8");
  rmSync(df, { force: true });
  mkdirSync(df, { recursive: true });          // artık append EDİLEMEZ
  const zg = runGuard("write", { ...editPayload(C.sessionId, "scripts/x.cjs") });
  ok("defter YAZILAMAZKEN kapı yine DENY verdi (karar defterden bağımsız)",
     zg.dec?.permissionDecision === "deny", JSON.stringify(zg.dec));
  ok("DENY metni eksiksiz (defter arızası mesajı bozmadı)",
     /claim\.mjs wait --res/.test(zg.dec?.permissionDecisionReason || ""), zg.dec?.permissionDecisionReason);
  const zc = runCli(C.sessionId, ["claim", "--res", "scripts/x.cjs", "--intent", "C: defter ölüyken"]);
  ok("defter YAZILAMAZKEN CLI yine exit 3 verdi", zc.code === 3, zc.out);
  const zs = runCli(C.sessionId, ["status"]);
  ok("defter YAZILAMAZKEN status sağlıklı (exit 0)", zs.code === 0, zs.out);
  rmSync(df, { recursive: true, force: true });
  writeFileSync(df, yedek);                    // defteri geri koy: sonraki bölüm ölçülebilsin
  const yg = runGuard("write", { ...editPayload(C.sessionId, "scripts/x.cjs") });
  ok("defter geri gelince yazım KENDİLİĞİNDEN sürdü (kalıcı hasar yok)",
     yg.dec?.permissionDecision === "deny" && sonuncu("deny")?.key === "scripts/x.cjs");

  runCli(B.sessionId, ["release", "--all"]);
  runCli(C.sessionId, ["release", "--all"]);
}

console.log("\n㉒ BİLDİRİ: bırakan SIRADAKİNE haber verir (seviye 0)");
{
  /* Ölçülen olgu: bir kilit bırakıldığında, uyanma yolu OLMAYAN bekleyen haberi ALIR ve
     haberi kendi turunda OKUR. Eski davranışta bırakma sonucu yalnız BIRAKANIN ekranına
     basılıyordu — bekleyen hiçbir şey görmüyordu (kullanıcı raporu 2026-08-09).
     TAZE SESSION'LAR: A/B/C bu noktaya kadar limit/devir senaryolarından geçti; onların
     üzerine kurulan bir ölçüm ürünü değil harness'ın kalıntısını ölçerdi. */
  const M = spawnSession("sess-m", "bırakan (bildiri senaryosu)");
  const N = spawnSession("sess-n", "SESSİZ bekleyen (işaret)");
  const KEY = "scripts/bildiri-a.txt";
  writeFileSync(join(REPO, KEY), "//");
  const nDosya = bildiriFileOf(N.sessionId);

  const cl = runCli(M.sessionId, ["claim", "--res", KEY, "--intent", "bildiri senaryosu"]);
  ok("ön koşul: M kilidi aldı", cl.code === 0, cl.out);
  const deny = runGuard("write", { hook_event_name: "PreToolUse", session_id: N.sessionId, cwd: REPO,
                                   tool_name: "Write", tool_input: { file_path: join(REPO, KEY) } });
  ok("N kapıda reddedildi (işaret bırakıldı)", deny.dec?.permissionDecision === "deny", JSON.stringify(deny.dec));
  ok("N'nin kaydı SESSİZ (pid yok = kendi uyanamaz)",
     queueOf(KEY).some((w) => w.sessionId === N.sessionId && !w.pid), JSON.stringify(queueOf(KEY)));

  // M bırakır → bildiri YAZILMALI ve bunu SÖYLEMELİ (sessiz bırakma yok).
  const rel = runCli(M.sessionId, ["release", "--res", KEY]);
  ok("release BİLDİRİ GÖNDERDİĞİNİ söyler", /BİLDİRİ GÖNDERİLDİ/.test(rel.out), rel.out);
  ok("bildiri kutusu N için diske düştü", existsSync(nDosya), nDosya);

  // N kendi turunda haberi OKUR — ve haber TÜKETİLİR (her turda yeniden basılmaz).
  const ctx1 = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: N.sessionId, cwd: REPO });
  const m1 = ctx1.dec?.additionalContext || "";
  ok("N haberi ilk turunda görür", /BEKLEDİĞİN KAYNAK BOŞALDI/.test(m1), m1.slice(0, 300));
  ok("haber KAYNAĞI ve ÇAREYİ taşır", m1.includes(KEY) && /ŞİMDİ AL: node .*claim --res/.test(m1), m1.slice(0, 400));
  const ctx2 = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: N.sessionId, cwd: REPO });
  ok("haber TÜKETİLİR (ikinci turda tekrarlanmaz)",
     !/BEKLEDİĞİN KAYNAK BOŞALDI/.test(ctx2.dec?.additionalContext || ""));

  /* BAYAT HABER YALAN SÖYLEMEZ: bırakma ile okuma arasında kaynağı başkası kapmış olabilir.
     Haber o hâlde "şimdi al" DEMEZ, yeniden sıraya girmeyi söyler. */
  runCli(M.sessionId, ["claim", "--res", KEY, "--intent", "kaynağı yeniden aldım"]);
  runCli(M.sessionId, ["release", "--res", KEY]); // N hâlâ işaret bırakmış durumda → yeni bildiri
  runCli(M.sessionId, ["claim", "--res", KEY, "--intent", "araya giren sahip"]);
  const m3 = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: N.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("araya sahip girdiyse haber BUNU SÖYLER (bayat haber yalanlamaz)",
     /kaynak YENİDEN alınmış/.test(m3) && /wait --res/.test(m3), m3.slice(0, 400));
  runCli(M.sessionId, ["release", "--all"]);
}

console.log("\n㉒b AKTİF bekleyene bildiri YAZILMAZ (kendi süreci uyandırır)");
{
  /* Yanlış pozitifin bedeli: canlı `wait` süreci kilidi ZATEN sahibi adına alır ve çıkışıyla
     oturumu uyandırır. Ona bir de bildiri yazmak, okunduğunda çoktan bayatlamış bir haber
     üretirdi ("sıra sende" derken kaynak zaten onun). */
  const M2 = spawnSession("sess-m2", "bırakan (aktif bekleyen senaryosu)");
  const P = spawnSession("sess-p", "AKTİF bekleyen (wait süreci)");
  const KEY = "scripts/bildiri-b.txt";
  writeFileSync(join(REPO, KEY), "//");
  const cl = runCli(M2.sessionId, ["claim", "--res", KEY, "--intent", "aktif bekleyen senaryosu"]);
  ok("ön koşul: M2 kilidi aldı", cl.code === 0, cl.out);
  const w = spawnWait(P.sessionId, KEY);
  await sleep(1500); // wait süreci kuyruğa pid'li kayıt yazsın
  ok("P AKTİF bekleyen (pid'li kayıt)",
     queueOf(KEY).some((x) => x.sessionId === P.sessionId && !!x.pid), JSON.stringify(queueOf(KEY)));
  const rel = runCli(M2.sessionId, ["release", "--res", KEY]);
  ok("release 'bildiri GEREKMEZ' der", /bildiri GEREKMEZ/.test(rel.out), rel.out);
  ok("aktif bekleyene bildiri YAZILMADI", !existsSync(bildiriFileOf(P.sessionId)));
  await w.exited;
  ok("aktif bekleyen kilidi KENDİ aldı (uyanma yolu çalıştı)", /SIRA SENDE/.test(w.out()), w.out());
  runCli(P.sessionId, ["release", "--all"]);
}

console.log("\n㉓ ORKESTRATÖR: saha olayları koordinatöre KENDİLİĞİNDEN düşer");
{
  /* Orkestratör = planı yürüten, sahadaki koordinatör oturum (PM'in repo-içi, 0-token,
     hands-on karşılığı). Ölçülen olgu: kimse ona rapor YAZMADAN, olaylar ona ULAŞIR. */
  const O = spawnSession("sess-o", "ORKESTRATÖR (planı yürüten)");
  const W = spawnSession("sess-w", "sahada çalışan oturum");
  const X = spawnSession("sess-x", "bloke olan oturum");
  const KEY = "scripts/orkestrator-a.txt";
  writeFileSync(join(REPO, KEY), "//");

  // TEK SLOT: ikinci kayıt sessizce kapamaz.
  const k1 = runCli(O.sessionId, ["orkestrator", "kayit", "--kapsam", "plan: bildiri v1"]);
  ok("kayıt olur ve sözleşmeyi SÖYLER", k1.code === 0 && /ORKESTRATÖR SENSİN/.test(k1.out), k1.out);
  const k2 = runCli(W.sessionId, ["orkestrator", "kayit"]);
  ok("ikinci kayıt sessizce KAPMAZ (--devral ister)",
     k2.code === 3 && /ORKESTRATÖR ZATEN VAR/.test(k2.out) && /--devral/.test(k2.out), k2.out);
  ok("status ROL TABLOSUNU gösterir", /roller:[\s\S]*orkestrator\s+sess-o/.test(runCli(W.sessionId, ["status"]).out),
     runCli(W.sessionId, ["status"]).out);
  /* REGRESYON (2026-08-09): kayıt defterin KÖKÜNDE dururken `activeClaims` onu sahipsiz
     claim sanıp arşive atıyordu — orkestratörlük ilk taramada sessizce buharlaşıyordu. */
  runCli(W.sessionId, ["status"]); // defteri TARAT (activeClaims)
  runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: W.sessionId, cwd: REPO });
  ok("kayıt defter TARAMASINDAN sağ çıkar (claim sanılıp biçilmez)",
     /orkestratör: sess-o/.test(runCli(W.sessionId, ["orkestrator", "durum"]).out));

  // Saha olayı 1: W bloke olur (kapıda DENY) → "bloke" haberi.
  runCli(W.sessionId, ["claim", "--res", KEY, "--intent", "sahadaki iş"]);
  runGuard("write", { hook_event_name: "PreToolUse", session_id: X.sessionId, cwd: REPO,
                      tool_name: "Write", tool_input: { file_path: join(REPO, KEY) } });
  // Aynı tıkanıklığın ikinci DENY'i haber ÜRETMEZ (yankı değil, olay bildirilir).
  runGuard("write", { hook_event_name: "PreToolUse", session_id: X.sessionId, cwd: REPO,
                      tool_name: "Write", tool_input: { file_path: join(REPO, KEY) } });
  // Saha olayı 2: W işini bitirir → "bitti" haberi.
  const rel = runCli(W.sessionId, ["release", "--res", KEY]);
  ok("bırakan, olayın orkestratöre gideceğini SÖYLER", /orkestratör deftere düşen bu olayı/.test(rel.out), rel.out);

  // Orkestratör kendi turunda hepsini TEK blokta okur.
  const m = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: O.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("saha bloğu basılır", /\[orkestratör\] Sahadan \d+ olay/.test(m), m.slice(0, 300));
  ok("bloke olayı düştü (kim → hangi kaynak)",
     new RegExp(`bloke: ${X.sessionId.slice(0, 8)} → ${KEY.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}`).test(m), m.slice(0, 500));
  ok("bitti olayı düştü (iş + niyet)", /bitti: scripts\/orkestrator-a\.txt/.test(m) && /sahadaki iş/.test(m), m.slice(0, 500));
  ok("aynı tıkanıklığın yankısı TEKRAR bildirilmedi", (m.match(/⛔ bloke:/g) || []).length === 1, m.slice(0, 500));
  ok("saha haberi TÜKETİLİR",
     !/\[orkestratör\] Sahadan/.test(runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: O.sessionId, cwd: REPO }).dec?.additionalContext || ""));

  // Sahadaki oturum, gözlendiğini BİLİR (görünmez gözlemci yok).
  const mw = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: W.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("sahadakiler rol sahiplerini (orkestratör dahil) GÖRÜR",
     /ROL SAHİBİ oturumlar: .*orkestrator=sess-o/.test(mw), mw.slice(0, 400));

  // Kendi olayı kendine yazılmaz + oturum kapanınca kayıt düşer.
  runCli(O.sessionId, ["claim", "--res", "scripts/orkestrator-b.txt", "--intent", "orkestratörün kendi işi"]);
  runCli(O.sessionId, ["release", "--res", "scripts/orkestrator-b.txt"]);
  ok("orkestratör KENDİ olayını kendine yazmaz", !existsSync(bildiriFileOf(O.sessionId)));
  runGuard("release_all", { hook_event_name: "SessionEnd", session_id: O.sessionId, cwd: REPO });
  ok("SessionEnd orkestratörlüğü düşürür", /orkestratör: YOK/.test(runCli(W.sessionId, ["orkestrator", "durum"]).out));
  runCli(X.sessionId, ["release", "--all"]);
}

console.log("\n㉔ BESLEME: orkestratör TÜM eşzamanlılık olaylarını defterden alır");
{
  /* Ölçülen olgu: besleme elle bağlanan olay listesi DEĞİL, `olay.jsonl`'ın projeksiyonudur.
     Kayıttan SONRA doğan her tip akar, kayıttan ÖNCEKİ geçmiş dökülmez, imleç ilerler. */
  const OK = spawnSession("sess-ork2", "ORKESTRATÖR (besleme)");
  const S1 = spawnSession("sess-s1", "sahada: kilidi tutan");
  const S2 = spawnSession("sess-s2", "sahada: bloke olan");
  const KEY = "scripts/besleme-a.txt";
  writeFileSync(join(REPO, KEY), "//");

  // GEÇMİŞ: kayıttan ÖNCE bir olay üret (beslemede GÖRÜNMEMELİ).
  runCli(S1.sessionId, ["claim", "--res", "scripts/besleme-gecmis.txt", "--intent", "kayıttan ÖNCEKİ iş"]);
  runCli(S1.sessionId, ["release", "--res", "scripts/besleme-gecmis.txt"]);
  runCli(OK.sessionId, ["orkestrator", "kayit", "--kapsam", "besleme testi"]);

  // Kayıttan SONRA: alindi · deny(bloke) · birakildi · bekleyis/kapanis · devir
  runCli(S1.sessionId, ["claim", "--res", KEY, "--intent", "sahadaki iş"]);
  const deny = runGuard("write", { hook_event_name: "PreToolUse", session_id: S2.sessionId, cwd: REPO,
                                   tool_name: "Write", tool_input: { file_path: join(REPO, KEY) } });
  ok("ön koşul: S2 kapıda reddedildi", deny.dec?.permissionDecision === "deny");
  runCli(S1.sessionId, ["release", "--res", KEY]);

  const m = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: OK.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("saha bloğu defterden basılır", /\[orkestratör\] Sahadan \d+ olay/.test(m), m.slice(0, 400));
  ok("kilit ALINDI olayı akar (eskiden hiç yazılmıyordu)", /🔒 aldı: sess-s1/.test(m), m.slice(0, 600));
  ok("BLOKE olayı akar", /⛔ bloke: sess-s2/.test(m), m.slice(0, 600));
  ok("BİTTİ olayı akar", /✅ bitti: scripts\/besleme-a\.txt/.test(m), m.slice(0, 600));
  ok("kayıttan ÖNCEKİ geçmiş DÖKÜLMEZ", !/besleme-gecmis/.test(m), m.slice(0, 600));
  ok("devam ettirme komutu KOPYALANABİLİR basılır",
     /↳ devam ettir: node .*bildir --hedef sess-s\d/.test(m), m.slice(-400));
  const m2 = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: OK.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("imleç ilerler: aynı olaylar TEKRAR basılmaz", !/\[orkestratör\] Sahadan/.test(m2), m2.slice(0, 200));

  /* GÜRÜLTÜ: claim'siz yazımlar TEK satıra katlanır.
     ÖN KOŞUL: kapı, repoda HİÇ aktif claim yoksa hızlı yoldan geçer ve claim'siz yazımı
     defterine hiç yazmaz (mevcut davranış) — o yüzden ölçüm için canlı bir kilit şart. */
  runCli(S1.sessionId, ["claim", "--res", "design-source/studio.dc.html", "--intent", "gürültü ön koşulu"]);
  for (const yol of ["a", "b", "c"])
    for (let i = 0; i < 3; i++)
      runGuard("write", { hook_event_name: "PreToolUse", session_id: S2.sessionId, cwd: REPO,
                          tool_name: "Write", tool_input: { file_path: join(REPO, `scripts/serbest-${yol}.txt`) } });
  const m3 = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: OK.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("claim'siz yığını TEK satıra katlanır", /✍ \d+ claim'siz yazım · \d+ oturum · \d+ yol/.test(m3), m3.slice(0, 400));

  // Besleme SALT-OKUR: kapının kararını değiştirmez.
  runCli(S1.sessionId, ["claim", "--res", KEY, "--intent", "ikinci tur"]);
  const deny2 = runGuard("write", { hook_event_name: "PreToolUse", session_id: S2.sessionId, cwd: REPO,
                                    tool_name: "Write", tool_input: { file_path: join(REPO, KEY) } });
  ok("besleme kapının kararını DEĞİŞTİRMEZ", deny2.dec?.permissionDecision === "deny");
  runCli(S1.sessionId, ["release", "--all"]);
  runCli(S2.sessionId, ["release", "--all"]);
  runGuard("release_all", { hook_event_name: "SessionEnd", session_id: OK.sessionId, cwd: REPO });
}

console.log("\n㉔b ZİNCİRİN GERİ YÖNÜ: kilidi TUTAN da haber alır");
{
  /* "Bitir de sıra bana gelsin" bilgisinin asıl muhatabı kilidi tutandır; bugüne dek
     yalnız `status`a bakarsa görüyordu. Yankı bildirilmez: aynı bekleyen ikinci kez
     DENY yediğinde sahibin kutusuna ikinci satır düşmez. */
  const H = spawnSession("sess-h", "kilidi tutan");
  const B1 = spawnSession("sess-b1", "bekleyen (işaret)");
  const B2 = spawnSession("sess-b2", "bekleyen (aktif wait)");
  const KEY = "scripts/geri-yon.txt";
  writeFileSync(join(REPO, KEY), "//");
  runCli(H.sessionId, ["claim", "--res", KEY, "--intent", "sahibin işi"]);

  // (a) kapı yolu: DENY → işaret → sahibe haber
  runGuard("write", { hook_event_name: "PreToolUse", session_id: B1.sessionId, cwd: REPO,
                      tool_name: "Write", tool_input: { file_path: join(REPO, KEY) } });
  runGuard("write", { hook_event_name: "PreToolUse", session_id: B1.sessionId, cwd: REPO,
                      tool_name: "Write", tool_input: { file_path: join(REPO, KEY) } }); // yankı
  // (b) CLI yolu: MEŞGUL → işaret → sahibe haber
  runCli(B2.sessionId, ["claim", "--res", KEY, "--intent", "B2'nin işi"]);

  const m = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: H.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("sahip 'SENİ BEKLEYEN VAR' bloğunu görür", /⏳ SENİ BEKLEYEN VAR/.test(m), m.slice(0, 400));
  ok("blok kaynağı ve çareyi taşır",
     m.includes(KEY) && /İŞİN BİTTİYSE BIRAK.*release --res/.test(m), m.slice(0, 500));
  /* Sayım YALNIZ bekleyen bloğunda yapılır: ctx'in "Tutulan kilitler" listesi de
     `• <kaynak> ← <sahip>` şeklindedir ve saf metin sayımı onu da sayardı (yalancı-kırmızı). */
  const blok = (m.split("⏳ SENİ BEKLEYEN VAR")[1] || "").split("[eşzamanlılık]")[0];
  ok("yankı İKİNCİ satır üretmez (kaynak başına tek satır)",
     (blok.match(new RegExp(`• ${KEY.replace(/[.*+?^$()|[\]\\]/g, "\\$&")} ←`, "g")) || []).length === 1, blok.slice(0, 400));
  ok("haber TÜKETİLİR",
     !/⏳ SENİ BEKLEYEN VAR/.test(runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: H.sessionId, cwd: REPO }).dec?.additionalContext || ""));
  runCli(H.sessionId, ["release", "--all"]);
  runCli(B2.sessionId, ["release", "--all"]);
}

console.log("\n㉔c ORKESTRATÖRÜN ELİ: hedefli bildiri (devam ettir)");
{
  const K1 = spawnSession("sess-k1", "gönderen (orkestratör)");
  const K2 = spawnSession("sess-k2", "devam edecek oturum");
  const g = runCli(K1.sessionId, ["bildir", "--hedef", K2.sessionId, "--mesaj", "kaynak boşaldı, a07'yi sürdür"]);
  ok("bildir gönderildiğini SÖYLER", g.code === 0 && /BİLDİRİ GÖNDERİLDİ/.test(g.out), g.out);
  ok("kendine bildiri YASAK", runCli(K1.sessionId, ["bildir", "--hedef", K1.sessionId, "--mesaj", "x"]).code === 5);
  const m = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: K2.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("hedef mesajı ilk turunda okur", /✉ SANA MESAJ/.test(m) && /a07'yi sürdür/.test(m), m.slice(0, 400));
  ok("mesaj TÜKETİLİR",
     !/✉ SANA MESAJ/.test(runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: K2.sessionId, cwd: REPO }).dec?.additionalContext || ""));
}

console.log("\n㉕ ROL TABLOSU: kalıcı oturumların ADI (tekil ⊕ çoğul)");
{
  /* Hex kimlik her oturumda değişir; rol kararlıdır. Ölçülen asıl olgu ÇOĞUL KORUMASIdır:
     `worker` gibi N-instance bir role adres üretmek, haberin sessizce yanlış oturuma
     gitmesi demektir — gönderen "ilettim" sanır (kullanıcı kararı 2026-08-09). */
  const R1 = spawnSession("sess-r1", "altyapı rolü");
  const R2 = spawnSession("sess-r2", "rakip aday");
  const R3 = spawnSession("sess-r3", "haber gönderen");

  const k = runCli(R1.sessionId, ["rol", "kayit", "--rol", "altyapi", "--kapsam", "kit·boot·sync"]);
  ok("rol kaydı olur ve sözleşmeyi SÖYLER", k.code === 0 && /ROL SENDE: altyapi/.test(k.out), k.out);
  ok("rol durum tabloyu basar", /altyapi\s+sess-r1/.test(runCli(R3.sessionId, ["rol", "durum"]).out));

  const k2 = runCli(R2.sessionId, ["rol", "kayit", "--rol", "altyapi"]);
  ok("TEKİL rol sessizce KAPILMAZ (--devral ister)",
     k2.code === 3 && /ROL DOLU/.test(k2.out) && /--devral/.test(k2.out), k2.out);
  const kx = runCli(R2.sessionId, ["rol", "kayit", "--rol", "altyapii"]);
  ok("TANIMSIZ rol reddedilir (kapalı küme)", kx.code === 3 && /TANIMSIZ ROL/.test(kx.out), kx.out);
  const kw = runCli(R2.sessionId, ["rol", "kayit", "--rol", "worker"]);
  ok("ÇOĞUL role KAYIT yok (slot tutmaz)", kw.code === 3 && /ÇOĞUL ROL/.test(kw.out), kw.out);

  // Rolle seslenme: tek muhatap → gider.
  const b = runCli(R3.sessionId, ["bildir", "--rol", "altyapi", "--mesaj", "kit sapması var, sync gerek"]);
  ok("bildir --rol tek muhatabı BULUR", b.code === 0 && /\[altyapi\] sess-r1/.test(b.out), b.out);
  const m = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: R1.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("rol sahibi mesajı okur", /✉ SANA MESAJ/.test(m) && /sync gerek/.test(m), m.slice(0, 300));

  // ÇOĞUL role bildiri: ADRES ÜRETİLMEZ — hüküm nedeniyle durur.
  const bw = runCli(R3.sessionId, ["bildir", "--rol", "worker", "--mesaj", "x"]);
  ok("ÇOĞUL role bildiri REDDEDİLİR (belirsiz adres yasak)",
     bw.code === 5 && /ÇOĞUL ROL/.test(bw.out) && /bildir --hedef/.test(bw.out), bw.out);
  const bs = runCli(R3.sessionId, ["bildir", "--rol", "pm", "--mesaj", "x"]);
  ok("SAHİPSİZ role bildiri REDDEDİLİR", bs.code === 5 && /ROL SAHİPSİZ/.test(bs.out), bs.out);

  // Sahadakiler rol sahiplerini GÖRÜR (görünmez koordinatör yok).
  const mw = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: R3.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("ctx rol sahiplerini LİSTELER", /ROL SAHİBİ oturumlar: .*altyapi=sess-r1/.test(mw), mw.slice(0, 400));

  // Devralma AÇIK olur, kapanış rolü DÜŞÜRÜR.
  const kd = runCli(R2.sessionId, ["rol", "kayit", "--rol", "altyapi", "--devral"]);
  ok("--devral ile rol AÇIKÇA el değiştirir", kd.code === 0 && /devralındı: sess-r1/.test(kd.out), kd.out);
  runGuard("release_all", { hook_event_name: "SessionEnd", session_id: R2.sessionId, cwd: REPO });
  ok("SessionEnd üstlenilen rolleri düşürür",
     !/altyapi\s+sess-r2/.test(runCli(R3.sessionId, ["rol", "durum"]).out));
}

console.log("\n㉕b ROL BESLEMESİ: her rol ilerlemeyi görür, orkestratör HEPSİNİ");
{
  /* Kullanıcı isteği (2026-08-09): "diğer session'ların progress'lerini de görsün".
     Ama bağlam bütçesi: orkestratör dışındaki roller yalnız ÜST-DÜZEY olayları görür.
     Bu testin asıl koruduğu şey `??` tuzağıdır — orkestratörün süzgeci bilerek null'dur
     ve `null ?? varsayilan` onu bir kez sessizce süzgeçli beslemeye düşürmüştü. */
  const A = spawnSession("sess-alt", "ALTYAPI rolü");
  const O2 = spawnSession("sess-ork3", "ORKESTRATÖR");
  const W4 = spawnSession("sess-w4", "sahada çalışan");
  const KEY = "scripts/rol-besleme.txt";
  writeFileSync(join(REPO, KEY), "//");
  runCli(A.sessionId, ["rol", "kayit", "--rol", "altyapi"]);
  runCli(O2.sessionId, ["rol", "kayit", "--rol", "orkestrator", "--devral"]);

  runCli(W4.sessionId, ["claim", "--res", KEY, "--intent", "rol beslemesi turu"]);
  runGuard("write", { hook_event_name: "PreToolUse", session_id: A.sessionId, cwd: REPO,
                      tool_name: "Write", tool_input: { file_path: join(REPO, KEY) } });
  runCli(W4.sessionId, ["release", "--res", KEY]);

  const mo = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: O2.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("orkestratör HER olayı görür (alindi + bloke dahil)",
     /🔒 aldı: sess-w4/.test(mo) && /⛔ bloke: sess-alt/.test(mo), mo.slice(0, 600));

  const ma = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: A.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("öteki rol İLERLEME bloğu alır", /\[rol:altyapi\] Sahadan \d+ ilerleme/.test(ma), ma.slice(0, 500));
  ok("öteki rol SÜZÜLMÜŞ görür (alindi/bloke gürültüsü YOK)",
     !/🔒 aldı/.test(ma) && !/⛔ bloke/.test(ma) && /✅ bitti/.test(ma), ma.slice(0, 500));
  ok("imleçler AYRI: biri ötekinin beslemesini tüketmez",
     !/Sahadan/.test(runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: A.sessionId, cwd: REPO }).dec?.additionalContext || ""));

  // Rolsüz worker besleme ALMAZ (bileceği şey kendi kutusundadır).
  const mw = runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: W4.sessionId, cwd: REPO })
    .dec?.additionalContext || "";
  ok("ROLSÜZ oturum besleme ALMAZ", !/Sahadan/.test(mw), mw.slice(0, 300));

  // kutu: TÜKETMEZ.
  runCli(A.sessionId, ["bildir", "--hedef", W4.sessionId, "--mesaj", "kutu testi"]);
  const k1 = runCli(W4.sessionId, ["kutu"]);
  ok("kutu bildiriyi gösterir", /✉ sess-alt/.test(k1.out) && /kutu testi/.test(k1.out), k1.out);
  ok("kutu TÜKETMEZ (ikinci bakışta da orada)", /kutu testi/.test(runCli(W4.sessionId, ["kutu"]).out));
  ok("ama ctx TÜKETİR",
     /kutu testi/.test(runGuard("ctx", { hook_event_name: "UserPromptSubmit", session_id: W4.sessionId, cwd: REPO }).dec?.additionalContext || "") &&
     !/kutu testi/.test(runCli(W4.sessionId, ["kutu"]).out));
  runCli(W4.sessionId, ["release", "--all"]);
}

console.log("\n⑫ salt-okunurluk");
{
  /* Ölçüt gerçek defterin HASH'i; ama defter PAYLAŞILAN bir yüzeydir — koşu sırasında
     BAŞKA canlı session claim alıp bırakırsa hash değişir ve harness kendi sızıntısı
     sanıp FAIL verirdi (ölçüldü 2026-07-27: 10 canlı session varken her koşu kırmızı).
     Yanlış alarm alarmı köreltir. Bu yüzden hüküm KANITA bağlanır: sızıntı ancak gerçek
     defterde HARNESS'IN KENDİ session id'leri görünüyorsa vardır; hash başka bir sebeple
     kaymışsa hüküm verilmez → ÖLÇÜLEMEDİ (ölçüm yokluğu, temizlik iddiası değil). */
  const bizim = [A.sessionId, B.sessionId, C.sessionId, SB,
                 globalThis.__D?.sessionId, globalThis.__E?.sessionId, globalThis.__F?.sessionId].filter(Boolean);
  const izVar = () => {
    const d = join(homedir(), ".claude", "claims");
    if (!existsSync(d)) return false;
    for (const f of readdirSync(d, { recursive: true })) {
      let ic = "";
      try { ic = readFileSync(join(d, String(f)), "utf8"); } catch { continue; }
      if (bizim.some((s) => String(f).includes(s) || ic.includes(s))) return true;
    }
    return false;
  };
  if (realHash() === hashBefore) ok("gerçek ~/.claude/claims koşudan ETKİLENMEDİ", true);
  else if (izVar()) ok("gerçek ~/.claude/claims koşudan ETKİLENMEDİ", false, "harness izi gerçek defterde");
  else {
    olculemedi(
      "gerçek ~/.claude/claims koşudan ETKİLENMEDİ",
      "defter koşu sırasında değişti ama harness izi YOK → değişimi başka canlı session yaptı",
    );
  }
}

/* ── temizlik ── */
for (const p of procs) { try { p.kill(9); } catch {} }
rmSync(SB, { recursive: true, force: true });

console.log(
  `\n${fail === 0 ? "✅" : "❌"}  ${pass}/${pass + fail} PASS${fail ? ` · ${fail} FAIL` : ""}` +
    (belirsiz ? ` · ${belirsiz} ÖLÇÜLEMEDİ` : ""),
);
process.exit(fail ? 1 : 0);
