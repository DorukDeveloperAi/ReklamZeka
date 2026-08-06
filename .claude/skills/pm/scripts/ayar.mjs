#!/usr/bin/env node
// ayar.mjs — PM kadranının TEK YAZARI (~/.claude/pm/ayar.json).
//
//   ayar.mjs get [--json]
//   ayar.mjs set [--frekans 2h] [--paralel 1] [--gunluk 8] [--mod gozlem|yesil|tam]
//                [--kaynak cli|tui|pano|session|vscode] [--apply]   (bkz. KAYNAKLAR — BEŞ yüzey)
//
// TEK-YAZAR SÖZLEŞMESİ: ayar.json'a YALNIZ bu script yazar. Pano (`POST /api/pm/ayar`),
// `aide pm ayar …` ve session içi /pm HEPSİ bu script'i çağırır → tek-yazar ilkesi
// kod-yolu düzeyinde korunur. Okurlar: dispatch.mjs (Kapı 4) · PM SKILL P0 · pano/TUI.
//
// --apply: PM rutin işini kadansa göre YENİDEN KURAR (job.json immutable).
//   1) eski rutin (ayar.json.rutinJobId) cancel edilir ve state:cancelled OKUNARAK doğrulanır
//      (plan §3 "job rebuild'de çifte rutin" riski),
//   2) yeni iş `zamanla add --text '/pm rutin' --new-cwd ~/.claude --every <frekans>
//      --group pm --cap <paralel> --on-fail retry` ile kurulur (cwd = PM_CWD; ~ DEĞİL —
//      ev dizini trust'lı değil, ~/.claude trust'lı: §7.1 trust kapısı),
//   3) dönen id `rutinJobId`'ye yazılır.
//   --agent KULLANILMAZ (aide tmux kapalıysa park tuzağı); --shell KULLANILMAZ (TCC tuzağı).
//
// Mod ayar.json'da yaşar, job METNİNDE değil → mod değişikliği job yeniden kurmayı
// GEREKTİRMEZ (PM her koşumda P0'da okur). Yalnız frekans/paralel değişikliği --apply ister.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
/** PM rutininin çalışma dizini — PM'in kendi veri kökü (bkz. rutiniKur yorumu). */
const PM_CWD = join(HOME, ".claude");
const AYAR = join(HOME, ".claude", "pm", "ayar.json");
const ZAMANLA = "/Users/ybg/dev/agent-ide/packages/maestro/bin/zamanla.mjs";
const JOBS_DIR = process.env.MAESTRO_JOBS_DIR || "/Users/ybg/dev/agent-ide/jobs";
// bun'u PATH'e bağlamadan çöz — pano (node dashboard.mjs) bu script'i spawn ettiğinde
// PATH'inde ~/.bun/bin olmayabilir; dashboard.mjs BUN_BIN keşfiyle aynı desen.
const BUN_BIN = [join(HOME, ".bun", "bin", "bun"), "/usr/local/bin/bun", "/opt/homebrew/bin/bun"]
  .find((p) => existsSync(p)) || "bun";

export const MODLAR = ["gozlem", "yesil", "tam"];
/** Kadranı kimin çevirdiği (provenance — brifingde ve `get` çıktısında görünür).
 *  `tui` = aide Otomasyon paneli kadans şeridi; `cli` = `aide pm ayar`; `pano` = web formu;
 *  `session` = /pm içinden (kullanıcı açıkça istedi). */
export const KAYNAKLAR = ["cli", "tui", "pano", "session", "vscode"];
// maestro parseInterval ile aynı dil (birim zorunlu: s|m|h|d)
const FREKANS_RE = /^\d+[smhd]$/;

export const VARSAYILAN = {
  schemaVersion: 1,
  mod: "gozlem",
  kadans: { frekans: "2h", paralel: 1, gunlukTavan: 8 },
  rutinJobId: null,
  guncellendi: null,
  kaynak: null,
};

/** Ayarı oku — dosya yoksa/bozuksa VARSAYILANI döndür (YAZMADAN).
 *
 *  FREN FAIL-CLOSED'DUR. Eskiden ham dosya DOĞRULANMADAN merge ediliyordu (`dogrula()`
 *  yalnız `set` CLI'ında koşuyordu) ve Kapı 0/Kapı 4 kara-liste mantığı kullanıyordu
 *  (`mod === "gozlem"`, `mod === "yesil"`). Sonuç: elle düzenleme / yarım yazım / şema
 *  kayması `mod`u `"TAM"` yapınca hiçbir dala uymuyor → 🔴 iş GEÇİYORDU; `gunlukTavan:"abc"`
 *  ise NaN karşılaştırması (`sayı >= NaN` hep false) → tavan HİÇ YOKTU. Kullanıcı frenin
 *  basılı olduğunu sanarken fren yoktu.
 *
 *  Artık: TANINMAYAN DEĞER = EN KISITLAYICI YORUM. Ve sessizce değil — düzeltilen alanlar
 *  `bozukAlanlar[]` ile yüzeylere taşınır ("sessiz ölüm yasak"). */
export function ayarOku() {
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(AYAR, "utf8"));
  } catch {
    return { ...VARSAYILAN, kadans: { ...VARSAYILAN.kadans } };
  }
  if (!raw || typeof raw !== "object") return { ...VARSAYILAN, kadans: { ...VARSAYILAN.kadans } };
  // Kısmi/eski dosya: eksik alanlar varsayılanla tamamlanır, fazlalar KORUNUR.
  const a = {
    ...VARSAYILAN,
    ...raw,
    kadans: { ...VARSAYILAN.kadans, ...(raw.kadans && typeof raw.kadans === "object" ? raw.kadans : {}) },
  };

  const bozuk = [];
  const tamsayi = (v) => (typeof v === "number" ? v : Number.NaN);
  if (!MODLAR.includes(a.mod)) {
    bozuk.push(`mod=${JSON.stringify(a.mod)} → gozlem`);
    a.mod = VARSAYILAN.mod; // en kısıtlayıcı: hiç dağıtım yok
  }
  if (!FREKANS_RE.test(String(a.kadans.frekans))) {
    bozuk.push(`frekans=${JSON.stringify(a.kadans.frekans)} → ${VARSAYILAN.kadans.frekans}`);
    a.kadans.frekans = VARSAYILAN.kadans.frekans;
  }
  const p = tamsayi(a.kadans.paralel);
  if (!Number.isInteger(p) || p < 1) {
    bozuk.push(`paralel=${JSON.stringify(a.kadans.paralel)} → ${VARSAYILAN.kadans.paralel}`);
    a.kadans.paralel = VARSAYILAN.kadans.paralel;
  }
  const g = tamsayi(a.kadans.gunlukTavan);
  if (!Number.isInteger(g) || g < 1) {
    bozuk.push(`gunlukTavan=${JSON.stringify(a.kadans.gunlukTavan)} → ${VARSAYILAN.kadans.gunlukTavan}`);
    a.kadans.gunlukTavan = VARSAYILAN.kadans.gunlukTavan;
  }
  if (bozuk.length) a.bozukAlanlar = bozuk;
  return a;
}

/** Atomik yazım (tmp + rename), mode 0600. TEK yazma noktası. */
function ayarYaz(obj) {
  mkdirSync(dirname(AYAR), { recursive: true });
  const tmp = `${AYAR}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, AYAR);
  try { chmodSync(AYAR, 0o600); } catch { /* dosya sistemi izin vermiyorsa sessiz */ }
}

function hata(msg) {
  console.error(`ayar: ${msg}`);
  process.exit(1);
}

/** Doğrulama — geçersizse exit 1 + net hata. */
function dogrula(a) {
  if (!FREKANS_RE.test(String(a.kadans.frekans)))
    hata(`geçersiz --frekans: ${a.kadans.frekans} (beklenen: <sayı><s|m|h|d>, ör. 2h)`);
  if (!Number.isInteger(a.kadans.paralel) || a.kadans.paralel < 1)
    hata(`geçersiz --paralel: ${a.kadans.paralel} (tamsayı ve ≥1 olmalı)`);
  if (!Number.isInteger(a.kadans.gunlukTavan) || a.kadans.gunlukTavan < 1)
    hata(`geçersiz --gunluk: ${a.kadans.gunlukTavan} (tamsayı ve ≥1 olmalı)`);
  if (!MODLAR.includes(a.mod)) hata(`geçersiz --mod: ${a.mod} (geçerli: ${MODLAR.join(" | ")})`);
  return a;
}

function zamanla(args) {
  return execFileSync(BUN_BIN, [ZAMANLA, ...args], { encoding: "utf8", timeout: 30_000 });
}

/** zamanla `--hemen` bayrağını DESTEKLİYOR mu?
 *
 *  MAKİNE-OKUNUR BEYANDAN sorar (`zamanla capabilities` → {flags:[…]}). Eskiden zamanla.mjs'in
 *  KAYNAK METNİNİ greplerdi (`/["'-]hemen/`) — bir YORUM satırındaki "hemen" bile true döndürürdü;
 *  kırılgan özellik-algılama. Beyan okunamazsa (eski zamanla / bozuk çıktı) FALSE döner:
 *  bayrağı geçmemek güvenlidir (iş kurulur, yalnız ilk ateş bir aralık bekler). */
function hemenDesteklenirMi() {
  try {
    const out = execFileSync(BUN_BIN, [ZAMANLA, "capabilities"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return JSON.parse(out)?.flags?.includes("hemen") === true;
  } catch {
    return false;
  }
}

/** `pm-rutin` oturumu BAŞKA cwd'de açıksa kapat (bayat hedef). Aynı cwd'deyse dokunma. */
function eskiOturumuTemizle() {
  const tmux = (args) =>
    execFileSync("tmux", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    tmux(["has-session", "-t", "pm-rutin"]);
  } catch {
    return null; // oturum yok — temiz
  }
  let mevcut = null;
  try {
    mevcut = tmux(["display-message", "-p", "-t", "pm-rutin", "#{session_path}"]);
  } catch {
    /* okunamadı — dokunma */
  }
  if (!mevcut || mevcut === PM_CWD) return null; // doğru dizinde: meşru reuse hedefi
  try {
    tmux(["kill-session", "-t", "pm-rutin"]);
    return `${mevcut} (≠ ${PM_CWD})`;
  } catch {
    return null;
  }
}

/** PM rutin işini kadansa göre yeniden kur. Önce cancel DOĞRULA, sonra create.
 *
 *  `--hemen` (ilk tick'te ateşle) SOĞUK BAŞLANGIÇTA otomatiktir: rutin hiç yoksa kullanıcı
 *  "kur ve başlasın" bekler. Ama MEVCUT bir rutinin kadansını değiştirmek "şimdi koş"
 *  DEMEK DEĞİLDİR — frekansı 4h'e çekmek bir PM koşumu tetiklemez. Aksi halde her kadran
 *  dokunuşu beklenmedik bir koşum (ve token) doğururdu. Şimdi koşulması isteniyorsa açıkça:
 *  `ayar.mjs set --frekans 4h --apply --simdi`. */
function rutiniKur(a, simdi) {
  const rapor = { iptalEdilen: null, iptalDogrulandi: null, yeniJobId: null, hemen: false };
  const soguktBaslangic = !a.rutinJobId;
  if (a.rutinJobId) {
    try { zamanla(["cancel", a.rutinJobId]); } catch { /* iş zaten yoksa devam */ }
    // DOĞRULA: state gerçekten cancelled mı? (çifte rutin riskinin tek savunması)
    let st = null;
    try { st = JSON.parse(readFileSync(join(JOBS_DIR, a.rutinJobId, "state.json"), "utf8")).state; }
    catch { st = "yok"; }
    rapor.iptalEdilen = a.rutinJobId;
    rapor.iptalDogrulandi = st;
    if (!["cancelled", "yok", "done", "failed"].includes(st))
      hata(`eski rutin ${a.rutinJobId} iptal edilemedi (state: ${st}) — çifte rutin riski, yeni iş KURULMADI`);
  }
  // Bayat oturum temizliği: `pm-rutin` adlı oturum BAŞKA bir cwd'de ayakta kaldıysa
  // (ör. rutinin dizini değişti) yeni iş ona enjekte edemez — tmux.spawn artık haklı
  // olarak hata veriyor. Kaynağında çöz: yalnız cwd TUTMUYORSA öldür. Aynı cwd'deki
  // oturum meşru reuse hedefidir (koşum sürüyor olabilir) — ona DOKUNMA.
  rapor.bayatOturumKapatildi = eskiOturumuTemizle();
  const args = [
    "add",
    "--text", "/pm rutin",
    // Rutinin cwd'si HOME DEĞİL, ~/.claude — iki sebep:
    //  1) TRUST KAPISI: doğan oturum "Is this a project you trust?" dialogunda donarsa
    //     isIdle onu (haklı olarak) meşgul sayar ve HİÇ enjekte etmez → rutin sessizce
    //     hiç koşmaz. Ev dizini güvenilir işaretli değildi; ~/.claude için kullanıcı
    //     onayı alındı (2026-07-11). Kanıt: `hasTrustDialogAccepted` ~/.claude.json.
    //  2) PATLAMA YARIÇAPI: PM'in verisi zaten burada (pm/ kaptan/ skills/). Ev
    //     dizinini (dev/, Desktop/, Documents/…) güvenilir yapmaya gerek yok.
    "--new-cwd", PM_CWD,
    "--new-name", "pm-rutin",
    "--every", a.kadans.frekans,
    "--group", "pm",
    "--cap", String(a.kadans.paralel),
    "--on-fail", "retry",
    "--title", "pm-rutin",
  ];
  // Soğuk başlangıç (rutin hiç yok) → hemen ateşle. Kadans değişimi → ateşleme, sadece yeni
  // aralık. `--simdi` açık talep olduğunda her iki durumda da hemen ateşler.
  if ((soguktBaslangic || simdi) && hemenDesteklenirMi()) { args.push("--hemen"); rapor.hemen = true; }
  const out = zamanla(args);
  try { rapor.yeniJobId = JSON.parse(out).id ?? null; } catch { /* ham çıktı */ }
  if (!rapor.yeniJobId) hata(`zamanla add çıktısı okunamadı: ${out.slice(0, 200)}`);
  return rapor;
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const isMain = (() => {
  // SYMLINK: `resolve()` symlink ÇÖZMEZ, Node import.meta.url'yi çözer → skills dizini bir
  // symlink ise bu karşılaştırma TUTMAZ ve script SESSİZCE hiçbir şey yapmadan exit 0 döner
  // (çağıran "JSON Parse error" görür). Sessiz no-op yasak → realpath ile karşılaştır.
  try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])); }
  catch { return false; }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opt = (n, fb = null) => {
    const i = argv.indexOf(`--${n}`);
    return i > -1 ? argv[i + 1] : fb;
  };
  const int = (v, ad) => {
    const n = Number(v);
    if (!Number.isInteger(n)) hata(`geçersiz --${ad}: ${v} (tamsayı bekleniyor)`);
    return n;
  };

  if (cmd === "get") {
    const a = ayarOku();
    if (argv.includes("--json")) console.log(JSON.stringify(a, null, 2));
    else {
      console.log(`mod          : ${a.mod}`);
      console.log(`frekans      : ${a.kadans.frekans}`);
      console.log(`paralel      : ${a.kadans.paralel}`);
      console.log(`günlük tavan : ${a.kadans.gunlukTavan}`);
      console.log(`rutin işi    : ${a.rutinJobId ?? "—  (aide pm ayar --apply ile kur)"}`);
      console.log(`güncellendi  : ${a.guncellendi ?? "—"}${a.kaynak ? ` (${a.kaynak})` : ""}`);
      if (!existsSync(AYAR)) console.log("\n(ayar.json yok — varsayılanlar gösterildi, dosya yazılmadı)");
    }
  } else if (cmd === "set") {
    const a = ayarOku();                       // diğer alanlar KORUNUR (kısmi set)
    // Değişim tespiti için ÖNCEKİ kadansın kopyası (aşağıdaki sessiz-ayrışma kapısı okur).
    const onceki = { kadans: { ...a.kadans }, mod: a.mod };
    if (opt("frekans") !== null) a.kadans.frekans = String(opt("frekans"));
    if (opt("paralel") !== null) a.kadans.paralel = int(opt("paralel"), "paralel");
    if (opt("gunluk") !== null) a.kadans.gunlukTavan = int(opt("gunluk"), "gunluk");
    if (opt("mod") !== null) a.mod = String(opt("mod"));
    const kaynak = opt("kaynak", "cli");
    if (!KAYNAKLAR.includes(kaynak)) hata(`geçersiz --kaynak: ${kaynak} (geçerli: ${KAYNAKLAR.join(" | ")})`);
    dogrula(a);
    a.schemaVersion = 1;
    a.kaynak = kaynak;
    a.guncellendi = new Date().toISOString();

    // SESSİZ AYRIŞMA KAPISI (UX/U2): frekans/paralel `job.json`'a MÜHÜRLÜDÜR (immutable) →
    // yalnız `--apply` (cancel+create) onu değiştirir. `--apply` verilmezse ayar.json "30m" der,
    // canlı rutin 2h'de koşmaya devam eder ve HİÇBİR YÜZEY bunu göstermez: ekran yalan söyler.
    // Bu yüzden `--apply`ı KENDİMİZ ekliyoruz (TUI/pano zaten böyle yapıyor; doğrudan çağıran
    // session/skill de aynı korumayı almalı). `--apply-yok` diyen bilinçli olarak ayrışmayı seçer.
    const rutinDegisti =
      (opt("frekans") !== null && opt("frekans") !== onceki.kadans.frekans) ||
      (opt("paralel") !== null && a.kadans.paralel !== onceki.kadans.paralel);
    const applyIstendi = argv.includes("--apply");
    const applyReddedildi = argv.includes("--apply-yok");
    let rutin = null;
    if ((applyIstendi || (rutinDegisti && !applyReddedildi)) && a.rutinJobId !== null) {
      if (!applyIstendi)
        console.error(
          `ayar: frekans/paralel değişti → rutin yeniden kuruluyor (sessiz ayrışma olmasın). ` +
            `İstemiyorsan --apply-yok ver.`,
        );
      rutin = rutiniKur(a, argv.includes("--simdi")); // hata olursa exit 1 → ayar.json yazılmaz
      a.rutinJobId = rutin.yeniJobId;
    } else if (applyIstendi) {
      // rutin henüz yok (soğuk başlangıç) → kur
      rutin = rutiniKur(a, argv.includes("--simdi"));
      a.rutinJobId = rutin.yeniJobId;
    } else if (rutinDegisti && applyReddedildi) {
      console.error("ayar: UYARI — rutin ESKİ kadansta koşmaya devam ediyor (--apply-yok verildi).");
    }
    ayarYaz(a);
    console.log(JSON.stringify({ ok: true, ayar: a, ...(rutin ? { rutin } : {}) }, null, 2));
  } else {
    console.error(`komutlar: get [--json] | set [--frekans 2h] [--paralel 1] [--gunluk 8] [--mod gozlem|yesil|tam] [--kaynak ${KAYNAKLAR.join("|")}] [--apply] [--simdi]`);
    console.error("  --apply : rutin işini yeni kadansla yeniden kurar (frekans değiştiyse ŞART)");
    console.error("  --simdi : kadans değişiminde rutini HEMEN ateşle (varsayılan: yalnız ilk kurulumda)");
    process.exit(1);
  }
}
