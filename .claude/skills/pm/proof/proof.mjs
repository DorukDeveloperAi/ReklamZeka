#!/usr/bin/env node
/**
 * /pm kanıt harness'ı — SALT-OKUNUR (gerçek ~/.claude/pm'e dokunmaz).
 *
 * Desen `eszamanli/proof/proof.mjs`'in AYNISI (yeni yüzey icat edilmedi): sayaç + mikro
 * `ok()` · `olculemedi()` dalı · sonda özeti · exit kodu. Kanıtı "koda bakarak" değil
 * ÜRÜNÜ SÜREREK alır: `gelen.mjs` · `ayar.mjs` · `dispatch.mjs` gerçek CLI bayraklarıyla
 * AYRI SÜREÇTE koşulur, hüküm stdout/stderr SÖZLEŞMESİNDEN + exit kodundan okunur.
 *
 * İZOLASYON (R3): `HOME` sandbox'a çevrilir → `os.homedir()` oraya düşer.
 *   ~/.claude/pm/dispatched.jsonl PM'in Kapı-1 idempotens KAYNAĞIDIR; oraya bir test satırı
 *   düşerse gerçek bir dağıtım sessizce engellenir. `MAESTRO_JOBS_DIR` de sandbox'a bakar.
 *   `PATH` kasten daraltılır (`/usr/bin:/bin`) → Kapı 2 (`bun zamanla list`) ve Kapı 5
 *   (`aide yuk-limit vites`) DIŞ DÜNYAYA çıkamaz; ikisi de "araç yok → kapı atlanır" dalına
 *   düşer ve koşum hermetik olur. `bildir.mjs` (telefon push) bu harness'ta HİÇ çağrılmaz —
 *   ölçülen üç script'in hiçbiri onu import etmiyor (ölçüldü).
 *
 * Ölçülen ilkeler:
 *   ① `gelen.mjs` TEK KOD-YOLU: dosya adını SCRIPT üretir → path traversal imkânsız
 *   ② yazım ATOMİK (tmp+rename): yarım not yok, `.tmp-` artığı yok
 *   ③ enum kapısı fail-closed: geçersiz alan → exit 1 ve HİÇBİR dosya yazılmaz
 *   ④ kadran FAIL-CLOSED: bozuk/eksik `mod` → en kısıtlı hüküm (`gozlem`), sessizce DEĞİL
 *   ⑤ Kapı 0 mekanik: tanınmayan kadranda 🔴 iş GEÇMEZ (kanıtlı olay: `mod:"TAM"` geçiriyordu)
 *   ⑥ Kapı 1 idempotens: aynı parmak izi uçuştayken ikinci dağıtım YOK; kapanış kilidi AÇAR
 *   ⑦ reddedilen dağıtım deftere YAZILMAZ, ama olay defterine DÜŞER (sessiz ölüm yok)
 *   ⑧ izolasyon: gerçek ~/.claude/pm koşudan ETKİLENMEZ
 *
 * Koşum:  node ~/.claude/skills/pm/proof/proof.mjs
 */

import { spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync, readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GELEN = join(HERE, "..", "scripts", "gelen.mjs");
const AYAR_CLI = join(HERE, "..", "scripts", "ayar.mjs");
const DISPATCH = join(HERE, "..", "scripts", "dispatch.mjs");

let pass = 0, fail = 0, belirsiz = 0;
const ok = (name, cond, detay = "") => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${detay && !cond ? `\n        ${detay}` : ""}`);
};
/** ÖLÇÜLEMEDİ — ölçümün kendisi geçersiz. Yeşil DEĞİL, kırmızı da değil: İLAN edilir, sayılır. */
const olculemedi = (name, neden) => {
  belirsiz++;
  console.log(`  ÖLÇÜLEMEDİ  ${name}\n        ${neden}`);
};

function hashTree(root) {
  if (!existsSync(root)) return "YOK";
  const h = createHash("sha256");
  const walk = (d, rel) => {
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of [...ents].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else { h.update(r); try { h.update(readFileSync(p)); } catch { h.update("?"); } }
    }
  };
  walk(root, "");
  return h.digest("hex").slice(0, 16);
}

/* ── sandbox ── */
const SB = mkdtempSync(join(tmpdir(), "pm-proof-"));
const HOME = join(SB, "home");
const CLAUDE = join(HOME, ".claude");
const PM_DIR = join(CLAUDE, "pm");
const GELEN_DIR = join(PM_DIR, "gelen");
const AYAR = join(PM_DIR, "ayar.json");
const LEDGER = join(PM_DIR, "dispatched.jsonl");
const OLAY = join(PM_DIR, "olay.jsonl");
mkdirSync(PM_DIR, { recursive: true });
mkdirSync(join(SB, "jobs"), { recursive: true });

const ENV = {
  ...process.env,
  HOME,
  CLAUDE_CONFIG_DIR: CLAUDE,
  MAESTRO_JOBS_DIR: join(SB, "jobs"),
  PATH: "/usr/bin:/bin",   // Kapı 2/5'in dış araçları (bun · aide) KASTEN erişilemez
};
const kos = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: ENV, timeout: 60_000 });

const mdSay = () => (existsSync(GELEN_DIR) ? readdirSync(GELEN_DIR).filter((f) => f.endsWith(".md")).length : 0);
const tmpArtik = () => (existsSync(GELEN_DIR) ? readdirSync(GELEN_DIR).filter((f) => f.includes(".tmp-")) : []);
const ledgerSatir = () => { try { return readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).length; } catch { return 0; } };
const olaySatir = () => { try { return readFileSync(OLAY, "utf8").trim().split("\n").filter(Boolean).length; } catch { return 0; } };
/** stderr'deki SON `engel` taşıyan JSON satırı — kapı hükmü buradan okunur (exit kodundan değil). */
const engelOku = (r) => {
  const satirlar = String(r.stderr || "").trim().split("\n").filter(Boolean);
  for (let i = satirlar.length - 1; i >= 0; i--) {
    try { const j = JSON.parse(satirlar[i]); if (j && j.engel) return j; } catch { /* JSON değil */ }
  }
  return null;
};
const ayarYaz = (o) => writeFileSync(AYAR, typeof o === "string" ? o : JSON.stringify(o, null, 2));
const fpHesapla = (komut, proje, epic = "") =>
  createHash("sha256").update(`${komut}|${proje}|${epic}`).digest("hex").slice(0, 12);

/* ── gerçek defterin koşu ÖNCESİ hash'i (⑧) ── */
const GERCEK = join(homedir(), ".claude", "pm");
const gercekOnce = hashTree(GERCEK);

console.log("① gelen.mjs — dosya adını SCRIPT üretir (path traversal imkânsız)");
{
  // İstemcinin kontrol ettiği HER alan düşmanca: metin, proje, kaynak. Hiçbiri ada dokunamaz.
  const r = kos(GELEN, [
    "add",
    "--text", "../../../../etc/passwd — bu METİNDİR, yol DEĞİL",
    "--proje", "../../../tmp/kacis\nikinci: satir",
    "--kaynak", "cli", "--json",
  ]);
  ok("exit 0", r.status === 0, `exit ${r.status} · ${(r.stderr || "").slice(0, 200)}`);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* aşağıda FAIL */ }
  ok("--json sözleşmesi geçerli", !!j?.ok && !!j?.file && !!j?.path);
  ok("üretilen ad <YYYY-MM-DD-HHmm>-<rand4>.md desenine uyuyor",
     /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]{4}\.md$/.test(String(j?.file)), String(j?.file));
  ok("dosya GELEN_DIR İÇİNDE", String(j?.path || "").startsWith(GELEN_DIR + "/"), String(j?.path));
  ok("dizin dışına dosya DÜŞMEDİ", !existsSync(join(PM_DIR, "..", "..", "..", "etc", "passwd")) && mdSay() === 1);
  ok("ada kullanıcı metninden HİÇBİR parça sızmadı", !/passwd|kacis|\.\./.test(String(j?.file)), String(j?.file));

  const gövde = readFileSync(join(GELEN_DIR, j.file), "utf8");
  ok("düşman metin GÖVDEDE (frontmatter'a değil)", gövde.split("---")[2]?.includes("etc/passwd"));
  ok("proje alanı TEK SATIRA indirildi (frontmatter enjeksiyonu yok)",
     !/^ikinci: satir$/m.test(gövde), gövde.slice(0, 200));
}

console.log("\n② yazım ATOMİK (tmp + rename)");
{
  const oncekiSayi = mdSay();
  const r = kos(GELEN, ["add", "--text", "PM-PROOF-FIXTURE atomiklik", "--tip", "hedef", "--json"]);
  ok("exit 0", r.status === 0);
  ok("tam olarak 1 not eklendi", mdSay() === oncekiSayi + 1);
  ok(".tmp- artığı YOK", tmpArtik().length === 0, JSON.stringify(tmpArtik()));
  const j = JSON.parse(r.stdout);
  const s = readFileSync(j.path, "utf8");
  ok("not TAM yazıldı (açılış + kapanış frontmatter + gövde)",
     s.startsWith("---\n") && s.split("\n---\n").length >= 2 && s.includes("PM-PROOF-FIXTURE atomiklik"));
  ok("tip frontmatter'a işlendi", /^tip: hedef$/m.test(s));
  ok("ts ISO damgası var", /^ts: \d{4}-\d{2}-\d{2}T/m.test(s));
}

console.log("\n③ enum kapısı FAIL-CLOSED — geçersiz alan yarım not BIRAKMAZ");
{
  for (const [ad, args] of [
    ["geçersiz --tip", ["add", "--text", "x", "--tip", "boyle-bir-tip-yok"]],
    ["geçersiz --kaynak", ["add", "--text", "x", "--kaynak", "sihirli-kanal"]],
    ["geçersiz --oncelik", ["add", "--text", "x", "--oncelik", "acil-acil"]],
    ["boş --text", ["add", "--text", "   "]],
    ["komutsuz çağrı", ["listele"]],
  ]) {
    const oncekiSayi = mdSay();
    const r = kos(GELEN, args);
    ok(`${ad} → exit 1`, r.status === 1, `exit ${r.status}`);
    ok(`${ad} → dosya YAZILMADI`, mdSay() === oncekiSayi && tmpArtik().length === 0);
  }
}

console.log("\n④ kadran FAIL-CLOSED — tanınmayan değer = EN KISITLI yorum");
{
  const get = () => {
    const r = kos(AYAR_CLI, ["get", "--json"]);
    let j = null; try { j = JSON.parse(r.stdout); } catch { /* aşağıda */ }
    return { r, j };
  };

  rmSync(AYAR, { force: true });
  {
    const { r, j } = get();
    ok("ayar.json YOKken exit 0 + varsayılan", r.status === 0 && j?.mod === "gozlem");
    ok("okuma DOSYA YAZMADI (get salt-okunur)", !existsSync(AYAR));
  }

  // KANITLI OLAY: `mod:"TAM"` şema kayması hiçbir kara-liste dalına uymuyor → 🔴 iş GEÇİYORDU.
  ayarYaz({ schemaVersion: 1, mod: "TAM", kadans: { frekans: "2h", paralel: 1, gunlukTavan: 8 } });
  {
    const { j } = get();
    ok('mod:"TAM" → gozlem (en kısıtlı)', j?.mod === "gozlem", JSON.stringify(j?.mod));
    ok("düzeltme SESSİZ değil — bozukAlanlar ilan ediyor",
       Array.isArray(j?.bozukAlanlar) && j.bozukAlanlar.some((b) => /^mod=/.test(b)), JSON.stringify(j?.bozukAlanlar));
  }

  ayarYaz({ schemaVersion: 1, mod: "tam", kadans: { frekans: "iki saat", paralel: 0, gunlukTavan: "abc" } });
  {
    const { j } = get();
    ok('gunlukTavan:"abc" → 8 (NaN karşılaştırması tavanı YOK etmiyor)', j?.kadans?.gunlukTavan === 8, JSON.stringify(j?.kadans));
    ok("paralel:0 → 1", j?.kadans?.paralel === 1);
    ok('frekans:"iki saat" → 2h', j?.kadans?.frekans === "2h");
    ok("üç bozuk alan da İLAN edildi", (j?.bozukAlanlar || []).length === 3, JSON.stringify(j?.bozukAlanlar));
    ok("geçerli mod KORUNDU (fail-closed aşırı-daralmıyor)", j?.mod === "tam");
  }

  ayarYaz("{ bu JSON degil ");
  {
    const { r, j } = get();
    ok("bozuk JSON → exit 0 + varsayılan gozlem", r.status === 0 && j?.mod === "gozlem");
    ok("bozuk dosya EZİLMEDİ (get yazmaz)", readFileSync(AYAR, "utf8").includes("bu JSON degil"));
  }
}

console.log("\n⑤ Kapı 0 — kadran mekanik FREN (beyan değil, kod)");
{
  const TETIK = ["--text", "echo PM-PROOF-FIXTURE kapi-0", "--at", "+5s"];
  const dagit = (meta, z = TETIK) => kos(DISPATCH, ["add", ...meta, "--", ...z]);

  ayarYaz({ schemaVersion: 1, mod: "TAM", kadans: { frekans: "2h", paralel: 1, gunlukTavan: 8 } });
  {
    // ASIL YÜKLEM: `mod:"TAM"` (kanıtlı şema kayması) ile 🔴 iş GEÇMEZ. Hangi dalda kapandığı
    // ÖLÇÜLDÜ: `ayarOku()` Kapı 0 daha okumadan `TAM`ı `gozlem`e düşürüyor → fren `mod-gozlem`
    // dalında kapanıyor, `tanimsiz-kadran` dalında değil. Yani `mod` ekseninde ikinci kilit
    // ULAŞILAMAZ; dispatch.mjs'in kendi yorumu da bunu söylüyor ("bu ikinci kilit niyeti kodda
    // görünür kılar"). İkinci kilidin GERÇEKTEN ateşlendiği eksen `kademe`dir (alttaki vaka).
    const r = dagit(["--kademe", "kirmizi", "--proje", "/tmp/pm-proof"]);
    const e = engelOku(r);
    ok('mod:"TAM" + 🔴 kademe → dağıtım YOK (exit 2)', r.status === 2, `exit ${r.status}`);
    ok("fren en kısıtlı dalda kapandı (mod-gozlem)", e?.engel === "mod-gozlem", JSON.stringify(e));
    ok("red, SANİTİZE EDİLMİŞ modu raporlar (TAM değil, gozlem)", e?.mod === "gozlem", JSON.stringify(e?.mod));
    // KÖR NOKTA — İLAN: bu redde `bozukAlanlar` TAŞINMIYOR. Davranış doğru (iş geçmedi) ama
    // operatör "kadran gozlem" görüyor, "çünkü mod bozuktu ve gozlem'e düşürüldü"yü görmüyor.
    // Yalnız `tanimsiz-kadran` dalı bozukAlanlar taşıyor — o dal da mod ekseninde ateşlenmiyor.
    // onar: dispatch.mjs `mod-gozlem`/`mod-yesil` redlerine de `...(ayar.bozukAlanlar ? {bozukAlanlar} : {})` ekle.
    const gorunur = (e?.bozukAlanlar || []).some((b) => /^mod=/.test(b));
    console.log(`  NOT    bozukAlanlar bu redde ${gorunur ? "TAŞINIYOR" : "TAŞINMIYOR (ilan edilmiş kör nokta)"}`);
  }
  {
    const r = dagit(["--kademe", "boyle-kademe-yok", "--proje", "/tmp/pm-proof"]);
    const e = engelOku(r);
    ok("tanınmayan KADEME → ikinci kilit (tanimsiz-kadran) ateşlenir", r.status === 2 && e?.engel === "tanimsiz-kadran", JSON.stringify(e));
    ok("ikinci kilitte bozukAlanlar redde TAŞINIYOR", (e?.bozukAlanlar || []).some((b) => /^mod=/.test(b)), JSON.stringify(e?.bozukAlanlar));
  }

  ayarYaz({ schemaVersion: 1, mod: "gozlem", kadans: { frekans: "2h", paralel: 1, gunlukTavan: 8 } });
  {
    const r = dagit(["--kademe", "yesil", "--proje", "/tmp/pm-proof"]);
    ok("mod gozlem → 🟢 iş bile dağıtılmaz", r.status === 2 && engelOku(r)?.engel === "mod-gozlem", JSON.stringify(engelOku(r)));
  }

  ayarYaz({ schemaVersion: 1, mod: "yesil", kadans: { frekans: "2h", paralel: 1, gunlukTavan: 8 } });
  {
    const r = dagit(["--kademe", "kirmizi", "--proje", "/tmp/pm-proof"]);
    ok("mod yesil → 🔴 iş dağıtılmaz", r.status === 2 && engelOku(r)?.engel === "mod-yesil", JSON.stringify(engelOku(r)));
    const r2 = dagit(["--kademe", "sari", "--proje", "/tmp/pm-proof"]);
    ok("mod yesil → 🟡 iş de dağıtılmaz", r2.status === 2 && engelOku(r2)?.engel === "mod-yesil");
  }

  ayarYaz({ schemaVersion: 1, mod: "tam", kadans: { frekans: "2h", paralel: 5, gunlukTavan: 8 } });
  {
    const r = dagit(["--kademe", "yesil", "--proje", "/tmp/pm-proof"], ["--text", "tetiksiz iş"]);
    ok("Kapı 0.5 — TETİKSİZ yeşil iş reddedilir (sessiz manual takılma yok)",
       r.status === 2 && engelOku(r)?.engel === "tetiksiz-yesil", JSON.stringify(engelOku(r)));
  }
}

console.log("\n⑥ Kapı 1 — aynı parmak izi iki kez dağıtılmaz (idempotens)");
{
  const KOMUT = "echo PM-PROOF-FIXTURE idempotens";
  const PROJE = "/tmp/pm-proof";
  const fp = fpHesapla(KOMUT, PROJE);
  const bugun = new Date().toISOString();
  writeFileSync(LEDGER, JSON.stringify({
    ts: bugun, fingerprint: fp, jobId: "proof-job-1", durum: "dagitildi",
    goalId: null, epic: null, hedefProje: PROJE, kademe: "yesil",
  }) + "\n");

  const dagit = (komut) => kos(DISPATCH, [
    "add", "--kademe", "yesil", "--proje", PROJE, "--", "--text", komut, "--at", "+5s",
  ]);

  ayarYaz({ schemaVersion: 1, mod: "tam", kadans: { frekans: "2h", paralel: 5, gunlukTavan: 8 } });
  {
    const oncekiSatir = ledgerSatir(), oncekiOlay = olaySatir();
    const r = dagit(KOMUT);
    const e = engelOku(r);
    ok("uçuştaki parmak izi ikinci kez dağıtılmaz", r.status === 2 && e?.engel === "defter", JSON.stringify(e));
    ok("red, uçuştaki işin jobId'sini gösterir", e?.jobId === "proof-job-1", JSON.stringify(e));
    ok("parmak izi harness'ın hesabıyla AYNI (fp tanımı sözleşme)", e?.fingerprint === fp, `${e?.fingerprint} ≠ ${fp}`);
    ok("⑦ reddedilen dağıtım DEFTERE yazılmadı", ledgerSatir() === oncekiSatir);
    ok("⑦ ama olay defterine DÜŞTÜ (sessiz ölüm yok)", olaySatir() > oncekiOlay);
  }
  {
    // FARKLI parmak izi: Kapı 1 geçer, Kapı 4b (paralel=1) durdurur → açık satırın
    // eşzamanlılık tavanını da doldurduğu MEKANİK olarak görünür.
    ayarYaz({ schemaVersion: 1, mod: "tam", kadans: { frekans: "2h", paralel: 1, gunlukTavan: 8 } });
    const r = dagit("echo PM-PROOF-FIXTURE bambaska");
    const e = engelOku(r);
    ok("farklı iş Kapı 1'i GEÇER, Kapı 4b'de durur", r.status === 2 && e?.engel === "kadans-paralel", JSON.stringify(e));
    ok("uçuştaki iş sayısı doğru raporlandı", e?.ucusta === 1 && e?.paralel === 1, JSON.stringify(e));
  }
  {
    // KİLİDİN AÇILMASI: defterde kapanış satırı (`askida`) varsa aynı fp artık uçuşta DEĞİL.
    // Terminal duvar olarak günlük tavan 1'e çekilir → koşum gerçek bir dağıtıma ASLA varmaz;
    // hüküm "engel `defter` DEĞİL" olmasından okunur.
    appendFileSync(LEDGER, JSON.stringify({
      ts: bugun, fingerprint: fp, jobId: "proof-job-1", durum: "askida", kanit: "proof: kilidi aç",
    }) + "\n");
    ayarYaz({ schemaVersion: 1, mod: "tam", kadans: { frekans: "2h", paralel: 5, gunlukTavan: 1 } });
    const oncekiSatir = ledgerSatir();
    const r = dagit(KOMUT);
    const e = engelOku(r);
    ok("kapanış satırı Kapı 1 kilidini AÇAR (engel artık `defter` değil)",
       r.status === 2 && e?.engel !== "defter", JSON.stringify(e));
    ok("terminal duvar günlük tavandır (gerçek dağıtıma varılmadı)", e?.engel === "kadans-gunluk", JSON.stringify(e));
    ok("defter yine büyümedi", ledgerSatir() === oncekiSatir);
  }
}

console.log("\n⑧ izolasyon — gerçek ~/.claude/pm salt-okunur kaldı");
{
  const gercekSonra = hashTree(GERCEK);
  // Defter PAYLAŞILAN yüzeydir: koşu sırasında gerçek PM/başka session yazarsa hash değişir ve
  // harness kendi sızıntısı sanıp FAIL verirdi (eszamanli ⑫'de ölçülmüş yanlış-alarm deseni).
  // Hüküm KANITA bağlanır: sızıntı ancak gerçek defterde HARNESS İZİ görünüyorsa vardır.
    // Token'lar YAPISAL olmalı: gündelik Türkçe bir ifade ("idempotens ölçümü") gerçek
  // nabızda DA geçebilir ve iz taraması yanlış-pozitif verir (ölçüldü 2026-08-03:
  // 5 gün önceki bir todo aynı ifadeyi taşıyordu). Yalnız çakışmayan işaretler kullanılır.
  const bizim = [SB, "proof-job-1", "PM-PROOF-FIXTURE", "claude-proof-fake"];
  const izVar = () => {
    if (!existsSync(GERCEK)) return false;
    for (const f of readdirSync(GERCEK, { recursive: true })) {
      const p = join(GERCEK, String(f));
      let ic = "";
      try { ic = readFileSync(p, "utf8"); } catch { continue; }
      if (bizim.some((s) => String(f).includes(s) || ic.includes(s))) return true;
    }
    return false;
  };
  if (gercekOnce === gercekSonra) ok("gerçek ~/.claude/pm koşudan ETKİLENMEDİ", true, `hash ${gercekOnce}`);
  else if (izVar()) ok("gerçek ~/.claude/pm koşudan ETKİLENMEDİ", false, "harness izi gerçek defterde");
  else {
    olculemedi("gerçek ~/.claude/pm koşudan ETKİLENMEDİ",
      `defter koşu sırasında değişti (${gercekOnce} → ${gercekSonra}) ama harness izi YOK → değişimi başka yazar yaptı`);
  }
  ok("harness izi gerçek deftere DÜŞMEDİ", !izVar());
  ok("gerçek dispatched.jsonl'a test satırı GİRMEDİ",
     !existsSync(join(GERCEK, "dispatched.jsonl")) ||
     !readFileSync(join(GERCEK, "dispatched.jsonl"), "utf8").includes("proof-job-1"));
}

/* ── temizlik ── */
rmSync(SB, { recursive: true, force: true });

console.log(
  `\n${fail === 0 ? "✅" : "❌"}  ${pass}/${pass + fail} PASS${fail ? ` · ${fail} FAIL` : ""}` +
    (belirsiz ? ` · ${belirsiz} ÖLÇÜLEMEDİ` : ""),
);
process.exit(fail ? 1 : 0);
