#!/usr/bin/env node
// sg: katman=modul rol=motor
// dispatch.mjs — PM dağıtım sarmalayıcısı: `zamanla add` + dağıtım defteri tek yerde.
//
//   dispatch.mjs add [--goal <goalId>] [--epic <epicId>] [--proje <cwd>]
//                    [--kademe yesil|sari|kirmizi] [--amac <kisa-ad>]
//                    -- <zamanla add bayrakları...>
//   dispatch.mjs durum [--dry-run] [--json]
//   dispatch.mjs kapat <fingerprint> --sonuc dogrulandi|basarisiz|askida --kanit "<metin>" [--job <id>]
//
// add: BEŞ kapıyı denetler (mod · defter · kuyruk · model · kadans), geçerse zamanla add'i
//      `--title pm:<fp>:<amac>` ile koşar ve deftere `dagitildi` satırı yazar.
//      Kapı 0 (mod) ve Kapı 4 (kadans) ~/.claude/pm/ayar.json'dan OKUNUR (tek yazar: ayar.mjs).
//      Başlık öneki `pm:<fp>:` ÇAĞIRAN `--title` VERSE DE ZORLANIR (B4/B11): önek yetim
//      taramasının ve Kapı 2'nin tek tutamağıdır; düşerse kendi tespitimizi kör ederiz.
// durum: açık `dagitildi` satırlarını jobs/<id>/state.json + history verdict'iyle eşler;
//      done → `dogrulandi`, parked/failed/cancelled → `basarisiz`, ASKIDA_SAAT'ten eski
//      akıbetsizler → `askida` satırı append eder (--dry-run yazmaz). Çıktı JSON (PM tüketir).
//      AYRICA `yetim[]`: kuyrukta `pm:<fp>:` başlıklı olup defterin HİÇBİR satırında
//      karşılığı olmayan canlı işler (SP7/G1 — bypass/yarım-dağıtım TESPİTİ).
// kapat: PM'in MEKANİK KAPATMA ARACI (SP7/B3). Mutabakatta (P1.5) transcript/nabız kanıtı
//      bulunan ya da sonucu artık bilinemeyecek olan açık satırı deftere kapanış satırıyla
//      kapatır. Defterin TEK YAZARI hâlâ bu script'tir.
//
// AKIBET SÖZLÜĞÜ (defter `durum` alanı):
//   dagitildi  — açık: iş uçuşta, sonucu bilinmiyor (Kapı 1/2/4b'yi doldurur)
//   dogrulandi — KANITLI başarı (job done · kanıt işi PASS · transcript/nabız kanıtı)
//   basarisiz  — KANITLI başarısızlık (job parked/failed/cancelled)
//   askida     — SONUÇ BİLİNMİYOR, kanıt bulunamadı: satır KAPANIR (tavanı bloke etmez)
//                ama BAŞARI SAYILMAZ. `dispatched ≠ done` kutsaldır: hiçbir otomatik yol
//                akıbetsiz bir işi `dogrulandi` yapmaz.
//
// NEDEN `askida` bir AKIBET (B3'ün özü): `--text` işinin kanıt kapısı yoksa scheduler onu
// terminal `dispatched` state'ine yazar ve BİR DAHA DEĞİŞTİRMEZ. Eski `durum` yalnız
// done/parked/failed/cancelled kapatıyordu → `dispatched` satır defterde SÜRESİZ AÇIK
// kalıyor, Kapı 4b'yi (paralel tavan, varsayılan 1) doldurup TÜM yeni dağıtımları süresiz
// blokluyordu. Ateşle-unut döngüsü kendini kilitliyordu ve PM'in defteri kapatacak
// mekanik yolu yoktu. Üçüncü akıbet (`askida`) + `kapat` komutu o kilidi açar.
//
// Defter: ~/.claude/pm/dispatched.jsonl (tek yazar: bu script).
// fingerprint = sha256(komut|cwd|hedefEpic) ilk 12 hane — SKILL.md ile aynı tanım.

import { readFileSync, appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ayarOku } from "./ayar.mjs";   // SALT-OKUR (yazma yalnız ayar.mjs CLI'ından)
import { olayYaz } from "./_olay.mjs";  // GÖZLEMLENEBİLİRLİK (olay-log.ts şema aynası)

const HOME = homedir();
const LEDGER = join(HOME, ".claude", "pm", "dispatched.jsonl");
// pm katmanı gözlem defteri (tek-yazar bu script). Yol şeması: ~/.claude/pm/olay.jsonl.
const OLAY_DEFTERI = join(HOME, ".claude", "pm", "olay.jsonl");
// Kapı reddi = DAVRANIŞI KORUYAN sarmalayıcı: aynı stderr JSON + aynı exit(2), ARTI
// bir `kapi`/`engel` olay satırı. Reddin NEDENİ artık deftere de düşer (görünürlük).
function kapiRed(engelObj) {
  olayYaz(OLAY_DEFTERI, { katman: "pm", tur: "event", sinif: "kapi", olay: "engel", baglam: engelObj });
  console.error(JSON.stringify(engelObj));
  process.exit(2);
}
// Mutabakat kapanışı → `mutabakat` olay. `basarisiz` ayrıca AGENTIC HATA doğurur:
// dağıtılan iş (worker/agent) başarısız döndü = yarım-iş / sahte-done / park —
// sessiz ölmesin (kanıtlı örnek 1: job noo2jmmsu tetiksiz dağıtım → yetim/agentic).
function mutabakatOlay(satir) {
  olayYaz(OLAY_DEFTERI, {
    katman: "pm", tur: "event", sinif: "mutabakat", olay: `kapandi-${satir.durum}`,
    baglam: { fingerprint: satir.fingerprint, jobId: satir.jobId ?? null, durum: satir.durum, kaynak: satir.kaynak ?? null },
  });
  if (satir.durum === "basarisiz") {
    olayYaz(OLAY_DEFTERI, {
      katman: "pm", tur: "error", sinif: "agentic", olay: "dagitim-basarisiz",
      baglam: { fingerprint: satir.fingerprint, jobId: satir.jobId ?? null, kanit: satir.kanit ?? null },
    });
  }
}
const MODEL_JSON = join(HOME, ".claude", "kaptan", "model.json");
const ZAMANLA = "/Users/ybg/dev/agent-ide/packages/maestro/bin/zamanla.mjs";
const JOBS_DIR = process.env.MAESTRO_JOBS_DIR || "/Users/ybg/dev/agent-ide/jobs";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)); // gelen.mjs komşu dosya (reddet)
const ASKIDA_SAAT = 48;
const MODEL_BAYAT_SAAT = 6;   // Kapı 3 tazelik eşiği: bayat model ne engeller ne onaylar

const argv = process.argv.slice(2);
const cmd = argv[0];

function opt(args, name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : fallback;
}

function readLedger() {
  try {
    return readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function appendLedger(rec) {
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(rec) + "\n");
}

function readJson(p, fb = null) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fb;
  }
}

/** Yerel gün anahtarı (YYYY-MM-DD) — günlük tavan yerel güne göre sayılır. */
function yerelGun(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Dağıtım başına (fp+jobId) SON defter satırı — akıbetin tek doğrusu. */
function sonSatirlar(ledger) {
  const last = new Map(); // `${fingerprint}:${jobId}` → son satır
  for (const r of ledger) last.set(`${r.fingerprint}:${r.jobId ?? ""}`, r);
  return last;
}

/** Defterde uçuşta (kapanmamış) satırlar: fp+jobId başına son durum `dagitildi` ise açık.
 *  `dogrulandi|basarisiz|askida` KAPANIŞTIR — üçü de satırı uçuştan düşürür, yani
 *  Kapı 1 (defter) ve Kapı 4b (paralel tavan) artık o satırla dolmaz. */
function openDispatches(ledger) {
  return [...sonSatirlar(ledger).values()].filter((r) => r.durum === "dagitildi");
}

/** Bu dağıtımın (fp+jobId) defterde KAPANIŞ satırı var mı? */
function defterdeKapali(last, fp, jobId) {
  const r = last.get(`${fp}:${jobId ?? ""}`);
  return !!r && r.durum !== "dagitildi";
}

// AKIBET SÖZLÜĞÜ — üçü MAKİNE kanıtı, biri İNSAN yargısı:
//   dogrulandi : kanıt geldi (job done / çocuk job done) — makine
//   basarisiz  : iş park/fail/cancel oldu — makine
//   askida     : akıbet 48s+ belirsiz — makine ("bilmiyorum", başarı DEĞİL)
//   reddedildi : İNSAN sonuca baktı ve BEĞENMEDİ — geri bildirimle birlikte (yeni)
//
// `reddedildi` NEDEN AYRI BİR AKIBET: makine kanıtı "iş koştu" der, insan yargısı "iş DOĞRU
// koştu" der. İkisi farklı sorulardır. `dogrulandi` bir işi kapatır ama sonucun İSTENEN şey
// olduğunu söylemez — worker testi koşup PASS basabilir, yine de yanlış şeyi yapmış olabilir.
// İnsan reddi olmadan sistemde "sonucu beğenmedim, düzelt" diyecek bir yer yoktu: kullanıcı
// ya sessizce kabul edecek ya elle her şeyi yeniden kuracaktı.
//
// RED KÖR TEKRAR DEĞİLDİR: `reddet` defteri kapatır (Kapı 4b serbest) VE geri bildirimi PM'in
// GELEN KUTUSUNA yazar. Düzeltmeyi PM tasarlar (yeni fingerprint, düzeltilmiş komut) — aynı
// işi aynı haliyle yeniden ateşlemek zaten hatayı tekrarlardı.
const AKIBETLER = ["dogrulandi", "basarisiz", "askida", "reddedildi"];

/** `kapat`ın dokunabileceği satırlar. `dagitildi` = açık. `askida` = KAPALI ama sonucu
 *  bilinmiyor → kanıt SONRADAN çıkabilir (defter yalnız-ekle: son satır kazanır), bu yüzden
 *  yeniden kapatılabilir. `dogrulandi`/`basarisiz` KANITLI akıbetlerdir — ezilmez.
 *  AMA `reddet` `dogrulandi`yı EZEBİLİR: makine "koştu" dedi, insan "yanlış koştu" diyor —
 *  insan sözü makine kanıtının üstündedir (kullanıcı her yazarın üstündedir ilkesi). */
const KAPATILABILIR = ["dagitildi", "askida"];
const REDDEDILEBILIR = ["dagitildi", "askida", "dogrulandi"];

if (cmd === "add") {
  const sep = argv.indexOf("--");
  if (sep === -1) {
    console.error("kullanım: dispatch.mjs add [--goal g] [--epic e] [--proje cwd] [--kademe k] [--amac a] -- <zamanla add bayrakları>");
    process.exit(1);
  }
  const meta = argv.slice(1, sep);
  const zArgs = argv.slice(sep + 1);
  const goalId = opt(meta, "goal");
  const epic = opt(meta, "epic");
  const proje = opt(meta, "proje") || opt(zArgs, "cwd") || opt(zArgs, "new-cwd") || "";
  const kademe = opt(meta, "kademe", "yesil");
  const amac = (opt(meta, "amac") || "is").replace(/[^A-Za-z0-9çğıöşüÇĞİÖŞÜ_-]+/g, "-").slice(0, 24);
  const komut = opt(zArgs, "text") || opt(zArgs, "shell") || opt(zArgs, "task") || opt(zArgs, "goal") || "";
  if (!komut) {
    console.error("zamanla bayraklarında --text/--shell/--task/--goal bulunamadı");
    process.exit(1);
  }
  const fp = createHash("sha256").update(`${komut}|${proje}|${epic ?? ""}`).digest("hex").slice(0, 12);

  const ledger = readLedger();
  const son = sonSatirlar(ledger);
  const acik = openDispatches(ledger);
  const ayar = ayarOku();   // kadran: mod + kadans (dosya yoksa varsayılan: gozlem · 2h · 1 · 8)

  // Kapı 0 — MOD (kullanıcının FRENİ; B3b). Eskiden mod YALNIZ SKILL disipliniydi: dispatch
  // `mod`u hiç okumuyordu, yalnız `kadans.*`ı. Kanıtlı olay (2026-07-11): kadran 18:06Z'de
  // `gozlem`e döndü, 18:11Z'de bir dağıtım YAPILDI ve hiçbir kapı itiraz etmedi — belge
  // ("gozlem = dağıtım YOK") koddan daha iddialıydı. Fren mekanik olmalı:
  //   gozlem → hiç dağıtım yok  ·  yesil → yalnız 🟢 yeşil kademe  ·  tam → üç kademe serbest
  //
  // DÜRÜSTLÜK SINIRI (belgeye de yazılı): `--kademe` beyanını PM'in KENDİSİ verir → bu kapı
  // BEYANI zorlar, beyanın DOĞRULUĞUNU değil. "yesil" diye etiketlenmiş bir commit'i mod
  // kapısı ayırt edemez. Beyandan bağımsız tek hat maestro'dadır (policy.mjs kırmızı deseni
  // createJob + fire-time iki noktada yakalar → trigger.manual). Kapı 0 ilk savunmadır,
  // tek savunma değil.
  // BEYAZ-LİSTE (fail-closed). Kara-liste (`=== "gozlem"`) tanınmayan değerde AÇIK kalıyordu:
  // `mod:"TAM"` hiçbir dala uymuyor → 🔴 iş geçiyordu. ayarOku() artık sanitize ediyor; bu
  // ikinci kilit niyeti kodda görünür kılar ve şema kayarsa freni AÇIK bırakmaz.
  const KADEMELER = ["yesil", "sari", "kirmizi"];
  if (!["gozlem", "yesil", "tam"].includes(ayar.mod) || !KADEMELER.includes(kademe)) {
    kapiRed({
      engel: "tanimsiz-kadran", fingerprint: fp, mod: ayar.mod, kademe,
      ...(ayar.bozukAlanlar ? { bozukAlanlar: ayar.bozukAlanlar } : {}),
      mesaj: `tanınmayan mod/kademe — fren KAPALI varsayılır (dağıtım yok). geçerli mod: gozlem|yesil|tam · kademe: ${KADEMELER.join("|")}`,
    });
  }
  if (ayar.mod === "gozlem") {
    kapiRed({
      engel: "mod-gozlem", fingerprint: fp, mod: ayar.mod, kademe,
      mesaj: "kadran `gozlem` — dağıtım YOK; kararı brifinge 'onay bekliyor' olarak yaz",
    });
  }
  if (ayar.mod === "yesil" && kademe !== "yesil") {
    kapiRed({
      engel: "mod-yesil", fingerprint: fp, mod: ayar.mod, kademe,
      mesaj: "kadran `yesil` — yalnız 🟢 yeşil kademe dağıtılır; 🟡/🔴 işi brifingde ÖNER",
    });
  }

  // Kapı 0.5 — TETİK (kanıtlı olay, 2026-07-16 G3 canlı deneyi): PM yeşil işi TETİKSİZ
  // dağıttı (job noo2jmmsu) → zamanla tetiksiz add'i `trigger.manual` yapar = iş yalnız
  // insan `run-now`'ıyla ateşlenir → yeşil zincir SESSİZCE takıldı. SKILL P4 sözleşmesi:
  // tetiksiz add KIRMIZI reçetesidir (bilerek manual); yeşil/sarı işte çelişkidir.
  // Sözleşmeyi, yazması beklenen aktöre (LLM) bırakmayız — kapı mekanik zorlar.
  const TETIKLER = ["--at", "--every", "--after", "--after-ok", "--when-file", "--when-shell"];
  if (kademe !== "kirmizi" && !TETIKLER.some((t) => zArgs.includes(t))) {
    kapiRed({
      engel: "tetiksiz-yesil", fingerprint: fp, kademe,
      mesaj: "yeşil/sarı iş TETİK ister (--at +5s gibi) — tetiksiz add trigger.manual olur ve insan onayı olmadan ASLA ateşlenmez; manual istiyorsan kademe kirmizi",
    });
  }

  // Kapı 1 — defter: aynı parmak izi uçuşta mı?
  const open = acik.find((r) => r.fingerprint === fp);
  if (open) {
    kapiRed({ engel: "defter", fingerprint: fp, jobId: open.jobId, mesaj: "aynı iş uçuşta — dağıtılmadı" });
  }
  // Kapı 2 — kuyruk: pm:<fp>: başlıklı bekleyen job var mı?
  // SP7/B3: `dispatched` scheduler'ın TERMİNAL state'idir (enjekte edildi, sonucu bilinmiyor)
  // ama done/failed/cancelled listesinde olmadığı için burada SÜRESİZ "bekliyor" sayılıyordu:
  // defter `askida` ile kapatılsa bile Kapı 2 aynı parmak izini sonsuza bloke ederdi
  // (kilidin ikinci yarısı). Kural: iş `dispatched` VE defterde kapanış satırı varsa
  // (dogrulandi|basarisiz|askida) artık uçuşta değildir → engellemez. Defterde HÂLÂ AÇIKSA
  // engeller — kapı, Kapı 1'in kuyruk tarafındaki yedeği olarak gücünü korur.
  try {
    const list = JSON.parse(execFileSync("bun", [ZAMANLA, "list"], { encoding: "utf8", timeout: 20_000 }));
    const bekleyen = (Array.isArray(list) ? list : []).find((j) => {
      if (!String(j.title || "").startsWith(`pm:${fp}:`)) return false;
      if (["done", "failed", "cancelled"].includes(j.state)) return false;
      if (j.state === "dispatched" && defterdeKapali(son, fp, j.id)) return false;
      return true;
    });
    if (bekleyen) {
      kapiRed({ engel: "kuyruk", fingerprint: fp, jobId: bekleyen.id, mesaj: "kuyrukta bekleyen eş iş var — dağıtılmadı" });
    }
  } catch { /* zamanla list okunamadıysa kapı atlanır (kapı 1+3 hâlâ korur) */ }
  // Kapı 3 — model: hedef epic zaten active/done mu? (model.json cache — Stop hook tazeler)
  // TAZELİK EŞİĞİ: cache MODEL_BAYAT_SAAT'ten eskiyse kapı BİLMİYOR demektir → ne engeller
  // ne onaylar; yalnız uyarır (plan §3: bayat cache'e karar bağlama).
  if (epic) {
    let yasSaat = Infinity;
    try { yasSaat = (Date.now() - statSync(MODEL_JSON).mtimeMs) / 3_600_000; } catch { /* dosya yok */ }
    if (yasSaat > MODEL_BAYAT_SAAT) {
      console.error(JSON.stringify({
        uyari: "model-bayat", epic,
        yasSaat: Number.isFinite(yasSaat) ? Math.round(yasSaat) : null,
        mesaj: `model bayat: ${Number.isFinite(yasSaat) ? `${Math.round(yasSaat)} saat` : "dosya yok"} — kapı atlandı`,
      }));
    } else {
      const model = readJson(MODEL_JSON);
      const ep = (model?.projects ?? []).flatMap((p) => p.epics ?? []).find((e) => e.id === epic);
      if (ep && ["active", "done"].includes(ep.status)) {
        kapiRed({ engel: "model", fingerprint: fp, epic, status: ep.status, mesaj: "epic zaten aktif/bitmiş — dağıtılmadı" });
      }
    }
  }
  // Kapı 4a — kadans/günlük tavan: bugün (yerel gün) kaç dağıtım yapıldı?
  const bugun = yerelGun(new Date().toISOString());
  const bugunku = ledger.filter((r) => r.durum === "dagitildi" && yerelGun(r.ts) === bugun).length;
  if (bugunku >= ayar.kadans.gunlukTavan) {
    kapiRed({
      engel: "kadans-gunluk", fingerprint: fp, bugunku, tavan: ayar.kadans.gunlukTavan,
      mesaj: "günlük dağıtım tavanı doldu — dağıtılmadı",
    });
  }
  // Kapı 4b — kadans/paralel: akıbeti belirlenmemiş (uçuştaki) dağıtım sayısı.
  if (acik.length >= ayar.kadans.paralel) {
    kapiRed({
      engel: "kadans-paralel", fingerprint: fp, ucusta: acik.length, paralel: ayar.kadans.paralel,
      mesaj: "eşzamanlı dağıtım tavanı dolu — önce açık işler kapansın (dispatch.mjs durum)",
    });
  }

  // Kapı 5 — KAPASİTE/VİTES (otonomi-kontrol aşama-03). Usage-aware throttle: yüksek token
  // yakımında LLM-doğuran dağıtımı frenler. Vites çözümü TEK kaynaktan gelir
  // (`aide yuk-limit vites --json`) — dispatch `yakilanYuzde` karşılaştırması YAPMAZ (eşik
  // core'da, çoğaltma yok). kritik → her kademe red · tutumlu → yalnız 🟢 geçer.
  // Bozuk kapasite.json'da vitesCoz ZATEN `kritik` döndürür (fail-closed core'da). Transport
  // hatası (aide PATH'te değil/çalışmadı) → kapı ATLANIR + uyarı (Kapı 2 deseni) — "aide yok"
  // TÜM dağıtımı durdurmasın; gerçek fren okunabildiğinde konuşur. Sınıf: kapı, 0 token.
  let vitesDeger = null;
  try {
    const vj = JSON.parse(execFileSync("aide", ["yuk-limit", "vites", "--json"], { encoding: "utf8", timeout: 20_000 }));
    if (vj?.vites) vitesDeger = vj.vites;
  } catch {
    console.error(JSON.stringify({ uyari: "vites-okunamadi", fingerprint: fp, mesaj: "aide yuk-limit vites --json çalışmadı — Kapı 5 atlandı (Kapı 0/4 hâlâ korur)" }));
  }
  if (vitesDeger === "kritik") {
    kapiRed({
      engel: "vites-kritik", fingerprint: fp, vites: vitesDeger, kademe,
      mesaj: "kapasite KRİTİK (yakım ≥ kritik eşik) — dağıtım YOK; LLM-eylem durdu. Brifingde 'kapasite bekliyor' yaz",
    });
  }
  if (vitesDeger === "tutumlu" && kademe !== "yesil") {
    kapiRed({
      engel: "vites-tutumlu", fingerprint: fp, vites: vitesDeger, kademe,
      mesaj: "kapasite TUTUMLU — yalnız 🟢 yeşil kademe dağıtılır; 🟡/🔴 işi brifingde ÖNER",
    });
  }

  // `--group pm --cap <paralel>` EKLENİR ama DÜRÜST DEĞERİ SINIRLIDIR (SP7/G1):
  // scheduler'ın grup-cap'i yalnız GÖZETİMLİ işleri (done_when/agentic → `running` kalan)
  // bağlar. `--text` işi fire içinde anında terminal `dispatched`e düşer, `groupRunning()`
  // onu SAYMAZ — saysaydı grup SONSUZA kilitlenirdi (metin işinin kapanışını yalnız PM
  // defteri bilir, maestro o defteri OKUMAZ). Ve daha ölümcülü: bu bayrağı işe ekleyen
  // BU SCRIPT'tir → dispatch'i atlayıp `zamanla add`i doğrudan çağıran bir PM'in işinde
  // bayrak ZATEN YOKTUR. Yani grup-cap "Kapı 4'ün ikinci savunması" DEĞİLDİR — defter kapısı
  // devre dışı kalsa dahi tavanı zorlayacağı iddiası yanlıştı. Tek gerçek kadans tavanı
  // Kapı 4'tür (defter-tabanlı); bypass'a karşı mekanik olan ÖNLEME değil TESPİT'tir →
  // `durum` çıktısındaki `yetim[]`.
  // BAŞLIK ÖNEKİ ZORLANIR (B4/B11): `pm:<fp>:` öneki kozmetik değildir — `yetim[]` taramasının
  // ve Kapı 2'nin TEK tutamağıdır. Eski davranış (`--title` verilmişse aynen geçir) kendi
  // tespitimizi kör ediyordu: kendi aracımızla dağıtılan iş başlıksız kalınca ne Kapı 2 onu
  // görüyor ne yetim taraması. Artık çağıranın başlığı önekin ARDINA eklenir; önek DÜŞMEZ.
  const onek = `pm:${fp}:`;
  const tIdx = zArgs.indexOf("--title");
  let withTitle;
  if (tIdx > -1) {
    const kullanici = String(zArgs[tIdx + 1] ?? "").trim();
    withTitle = [...zArgs];
    withTitle[tIdx + 1] = kullanici.startsWith(onek) ? kullanici : `${onek}${kullanici || amac}`;
  } else {
    withTitle = [...zArgs, "--title", `${onek}${amac}`];
  }
  const withGroup = withTitle.includes("--group")
    ? withTitle
    : [...withTitle, "--group", "pm", "--cap", String(ayar.kadans.paralel)];

  // TRUST KAPISI (kanıtlı olay ×3): `--agent` işi `--cwd` almazsa `runAgent` `$HOME`'a düşer;
  // ev dizini güvenilir işaretli DEĞİLDİR → doğan oturum trust dialogunda DONAR, enjeksiyon
  // asla olmaz, iş SESSİZCE sonsuza bekler. (Kaptan devir emri tam böyle çakıldı.) Dağıtımın
  // hedef projesi zaten elimizde (`--proje`) → agent işine cwd'yi BİZ geçeriz. Çağıran kendi
  // `--cwd`'sini verdiyse ona dokunulmaz. core/src/trust.ts artık ayrıca gürültülü hata verir.
  //
  // AYNISI `--shell` İÇİN DE GEÇERLİ (kanıtlı olay, 2026-07-13): shell payload'ının `cwd` alanı
  // var ama PM onu kullanmıyordu — komutun BAŞINA `cd <proje> && …` yazıyordu. O önek, dispatch →
  // zamanla → job.json → execSync tırnak katmanlarında DÜŞTÜ; iş daemon'un cwd'sinde koştu,
  // `packages/maestro/test` bulunamadı, iş park oldu. PM üç kez denedi, üçünde de düştü ve
  // sonunda geçici script dosyası yazmaya mecbur kaldı. Hedef proje ZATEN elimizde → cwd'yi
  // makine geçirir; PM'in `cd &&` yazmasına hiç gerek kalmaz.
  const agentIdx = withGroup.indexOf("--agent");
  const shellIdx = withGroup.indexOf("--shell");
  const withCwd =
    (agentIdx > -1 || shellIdx > -1) && !withGroup.includes("--cwd") && proje
      ? [...withGroup, "--cwd", proje]
      : withGroup;

  // ÇOCUK-İŞ ÖNEKİ MAKİNE TARAFINDAN YAZILIR (kanıtlı olay, 2026-07-13).
  // Kaptan'a devredilen işte kanıt, Kaptan'ın kuracağı ÇOCUK job'un `done` olmasıdır; `durum`
  // o çocuğu YALNIZ `pm:<fp>:` başlık önekinden tanır. Önce bu önek PM'in emir metnine ELLE
  // yazılıyordu — ve PM fingerprint yerine amacı yazdı (`pm:s4-kaptan:`) → mekanik kanıt yolu
  // hiç ateşlenmedi, defter PM'in KENDİ beyanıyla (`kapat`) kapandı. Bir sözleşme, onu yazması
  // beklenen aktör yanlış yazarsa YOKTUR. Fingerprint'i zaten BİZ hesaplıyoruz → emre BİZ
  // ekleriz; LLM'in kopyalamasına bırakılmaz.
  const taskIdx = withCwd.indexOf("--task");
  const withTask =
    agentIdx > -1 && taskIdx > -1
      ? withCwd.map((v, i) =>
          i === taskIdx + 1
            ? `${v}\n\nZORUNLU (makine kapısı): kuracağın ÇOCUK job'un başlığı TAM OLARAK şu önekle ` +
              `başlamalı: "${onek}" — bu parmak izi PM'in defterindeki satırın anahtarıdır; ` +
              `amaç/açıklama YAZMA, önek AYNEN bu olacak. Önek yanlışsa iş yetim kalır ve ` +
              `kanıtın PM'e ULAŞMAZ.`
            : v,
        )
      : withCwd;

  const out = execFileSync("bun", [ZAMANLA, "add", ...withTask], { encoding: "utf8", timeout: 30_000 });
  let jobId = null;
  try {
    jobId = JSON.parse(out).id ?? null;
  } catch { /* zamanla çıktısı değişmişse ham basılır */ }
  appendLedger({
    ts: new Date().toISOString(),
    goalId, epic: epic ?? null, fingerprint: fp, hedefProje: proje || null,
    komut: komut.slice(0, 200), jobId, kademe, durum: "dagitildi",
  });
  // OLAY: dağıtım uçuşa çıktı (beş kapıyı geçti, iş kuyruğa girdi).
  olayYaz(OLAY_DEFTERI, {
    katman: "pm", tur: "event", sinif: "dagitim", olay: "dagitildi",
    baglam: { fingerprint: fp, jobId, kademe, epic: epic ?? null, hedefProje: proje || null },
  });
  console.log(JSON.stringify({ ok: true, jobId, fingerprint: fp, kademe }, null, 2));
} else if (cmd === "durum") {
  const dry = argv.includes("--dry-run");
  const ledger = readLedger();
  const sonuc = { kapatilan: [], askida: [], bekleyen: [], yetim: [], hata: [] };
  // Kuyruk BİR KEZ okunur: hem çocuk-iş kanıt yolu (kaptan devri) hem yetim taraması kullanır.
  // Okunamazsa boş dizi → iki tarama da sessizce atlar (teşhis, dağıtımı bloke etmez).
  let kuyruk = [];
  try {
    const l = JSON.parse(execFileSync("bun", [ZAMANLA, "list"], { encoding: "utf8", timeout: 20_000 }));
    if (Array.isArray(l)) kuyruk = l;
  } catch { /* zamanla okunamadı — taramalar atlanır */ }
  for (const r of openDispatches(ledger)) {
    if (!r.jobId) {
      sonuc.hata.push({ ...r, neden: "jobId yok (zamanla çıktısı okunamamıştı)" });
      continue;
    }
    const state = readJson(join(JOBS_DIR, r.jobId, "state.json"));
    if (!state) {
      sonuc.hata.push({ ...r, neden: "state.json yok (iş silinmiş olabilir — .graveyard'a bak)" });
      continue;
    }
    const yasSaat = (Date.now() - Date.parse(r.ts)) / 3_600_000;

    // ÇOCUK-İŞ KANIT YOLU (Kaptan devri) — kanıtlı boşluk:
    // Kaptan'a devredilen iş (`--agent global:kaptan --task "DAĞIT: …"`) ana job olarak
    // `--agent`tır → terminal state'i HER ZAMAN `dispatched` (runAgent beklemez; sonuç
    // bilinmez — `dispatched ≠ done` kutsalı). Yani ana işe bakan mutabakat o satırı ASLA
    // kapatamaz ve Kapı 4b sonsuza dolu kalırdı. Ama gerçek kanıt ÇOCUK iştedir: Kaptan
    // SKILL'i "açtığın her çocuk job'ın başlığına `pm:<fp>:` önekini taşı — PM defterini
    // bununla kapatır" der. O önek buraya kadar sözleşmede duruyordu, KULLANILMIYORDU.
    // Artık: aynı fp önekli, ana işten farklı bir job `done` ise kanıt ODUR.
    // (Kanıtlı koşum: iwr77s5yb `dispatched` · çocuk iwuqvxe3y `done` → satır artık kapanır.)
    const cocuklar = kuyruk
      .filter((j) => j.id !== r.jobId && String(j.title || "").startsWith(`pm:${r.fingerprint}:`));
    const cocukDone = cocuklar.find((j) => j.state === "done");
    const cocukKotu = cocuklar.find((j) => ["parked", "failed"].includes(j.state));

    // MÜHÜR İÇERİĞİ OKUNUR (kanıtlı olay, 2026-07-16 G3 canlı deneyi — N9): done_when
    // regex'i PASS|FAIL kabul eder → işçi dürüstçe FAIL mühürlese de iş `done` olur.
    // Eskiden bu dal içeriğe bakmadan `dogrulandi` (EZİLMEZ akıbet) yazıyordu; 19:21
    // brifingi de defterden okuyup mührü "PASS" diye YANLIŞ raporladı. done ≠ başarı:
    // hüküm, WAL verdict'inin `match` alanından (işçi ÇIKTISI) okunur.
    const muhurFail = (() => {
      if (state.state !== "done") return null;
      try {
        const wal = readFileSync(join(JOBS_DIR, r.jobId, "wal.jsonl"), "utf8").trim().split("\n");
        for (let i = wal.length - 1; i >= 0; i--) {
          const e = JSON.parse(wal[i]);
          if (e.event === "verdict" && typeof e.match === "string")
            return /FAIL\s*$/.test(e.match) ? e.match.trim() : null;
        }
      } catch { /* WAL yok/bozuk → içerik hükmü verilemez, done kanıtı yeter */ }
      return null;
    })();
    if (muhurFail) {
      const satir = { ...r, ts: new Date().toISOString(), durum: "basarisiz",
        kanit: `mühür FAIL (iş done ama işçi başarısızlık mühürledi): ${muhurFail.slice(0, 160)}`, kaynak: "durum" };
      if (!dry) { appendLedger(satir); mutabakatOlay(satir); }
      sonuc.kapatilan.push(satir);
    } else if (state.state === "done" || cocukDone) {
      const kanit = cocukDone && state.state !== "done"
        ? `çocuk job ${cocukDone.id} done (kaptan devri; ana job ${r.jobId} dispatched)`
        : `job ${r.jobId} done`;
      const satir = { ...r, ts: new Date().toISOString(), durum: "dogrulandi", kanit, kaynak: "durum" };
      if (!dry) { appendLedger(satir); mutabakatOlay(satir); }
      sonuc.kapatilan.push(satir);
    } else if (cocukKotu && !["parked", "failed", "cancelled"].includes(state.state)) {
      const satir = { ...r, ts: new Date().toISOString(), durum: "basarisiz",
        kanit: `çocuk job ${cocukKotu.id} ${cocukKotu.state} (kaptan devri)`, kaynak: "durum" };
      if (!dry) { appendLedger(satir); mutabakatOlay(satir); }
      sonuc.kapatilan.push(satir);
    } else if (["parked", "failed", "cancelled"].includes(state.state)) {
      const satir = { ...r, ts: new Date().toISOString(), durum: "basarisiz", kanit: `job ${r.jobId} ${state.state}: ${String(state.last_error ?? "").slice(0, 120)}`, kaynak: "durum" };
      if (!dry) { appendLedger(satir); mutabakatOlay(satir); }
      sonuc.kapatilan.push(satir);
    } else if (yasSaat > ASKIDA_SAAT) {
      // SP7/B3 — AÇIK KAPANIŞ POLİTİKASI: ASKIDA_SAAT'i aşan akıbetsiz satır artık
      // "sessizce açık" bırakılmaz; deftere `askida` KAPANIŞ SATIRI yazılır.
      // İki şey aynı anda doğrudur ve ikisi de korunur:
      //   (1) sonucu BİLMİYORUZ → `dogrulandi` DEMEYİZ (`dispatched ≠ done` kutsal),
      //   (2) sonsuza dek tavanı (Kapı 4b) bloke etmesi de yanlış → satır kapanır.
      // Kanıt sonradan bulunursa PM `kapat <fp> --sonuc dogrulandi --kanit "…"` ile
      // gerçek akıbeti deftere yazabilir (son satır kazanır).
      const satir = {
        ...r, ts: new Date().toISOString(), durum: "askida",
        kanit: `${Math.round(yasSaat)} saat akıbetsiz (job ${r.jobId} state=${state.state}) — kanıt bulunamadı; SONUÇ BİLİNMİYOR, başarı DEĞİL`,
        kaynak: "durum",
      };
      if (!dry) { appendLedger(satir); mutabakatOlay(satir); }
      sonuc.askida.push({ ...satir, yasSaat: Math.round(yasSaat), jobState: state.state, not: "deftere `askida` yazıldı (tavanı bloke etmez) — kanıt bulursan: dispatch.mjs kapat <fp> --sonuc dogrulandi --kanit '…'" });
    } else {
      sonuc.bekleyen.push({ ...r, jobState: state.state });
    }
  }

  // YETİM TARAMASI (SP7/G1) — sökülen "ikinci savunma" iddiasının DÜRÜST karşılığı.
  // Bypass'ı mekanik olarak ÖNLEMEK imkânsızdır (`Bash(*)` izinli bir LLM aynı kullanıcı,
  // aynı dosya sistemi; `zamanla`yı doğrudan çağırabilir ve o işte `--group pm --cap` bayrağı
  // ZATEN OLMAZ). Mekanik olarak yapılabilen ÖNLEME değil TESPİT'tir: kuyrukta `pm:<fp>:`
  // başlıklı, canlı, ama defterin HİÇBİR satırında karşılığı OLMAYAN iş = defter-dışı pm işi.
  //
  // Not SUÇLAMA değil IŞIK TUTMADIR: meşru kökeni de vardır — `add` deftere `zamanla add`DEN
  // SONRA yazar, arada çökme YARIM DAĞITIM bırakır (iş kuyrukta, defter satırı yok).
  //
  // KÖR NOKTA (B4 — itiraf edilmeli, TESPİT de sınırlıdır): tarama `^pm:<fp>:` BAŞLIK
  // KONVANSİYONUNA bağlıdır ve o başlığı işe `add` ekler. Dispatch'i ATLAYAN gerçek bir
  // bypass'ın işinde o başlık ZATEN YOKTUR → tarama onu GÖRMEZ. Burada güvenilir yakalanan
  // sınıf yalnız YARIM DAĞITIM'dır (ve başlığı taşıyan çocuk işler). Başlıksız bypass ancak
  // insan/kaptan kuyruk incelemesiyle (`zamanla list` gözden geçirme) görünür.
  //
  // `zamanla list` okunamazsa tarama SESSİZ ATLANIR (Kapı 2 ile aynı desen: tarama bir
  // teşhistir, dağıtımı bloke etmez).
  const bilinenFp = new Set(ledger.map((r) => r.fingerprint));
  try {
    const list = JSON.parse(execFileSync("bun", [ZAMANLA, "list"], { encoding: "utf8", timeout: 20_000 }));
    for (const j of Array.isArray(list) ? list : []) {
      const m = /^pm:([0-9a-f]{12}):/.exec(String(j.title || ""));
      if (!m) continue;
      if (["done", "failed", "cancelled"].includes(j.state)) continue;
      if (bilinenFp.has(m[1])) continue;
      sonuc.yetim.push({
        jobId: j.id, title: j.title, state: j.state, fp: m[1],
        not: "defter-dışı pm işi — bypass şüphesi ya da yarım dağıtım",
      });
      // AGENTIC HATA: defter-dışı pm işi (kanıtlı örnek 1 — tetiksiz dağıtım/yetim).
      // Kuyruk salt-okunur tarandığından `--dry-run` olsa da bu tespit gerçektir;
      // tekrarlı satırı `durum`'un çağıran tarafı sönümler (aynı fp/jobId).
      if (!dry) olayYaz(OLAY_DEFTERI, {
        katman: "pm", tur: "error", sinif: "agentic", olay: "yetim-is",
        baglam: { jobId: j.id, fingerprint: m[1], state: j.state, title: String(j.title) },
      });
    }
  } catch { /* zamanla list okunamadıysa tarama SESSİZ ATLANIR (Kapı 2 ile aynı desen) */ }

  console.log(JSON.stringify(sonuc, null, 2));
} else if (cmd === "kapat") {
  // SP7/B3 — defterin MEKANİK KAPATMA KAPISI. SKILL P1.5 "kanıt bulursan kapat" diyordu
  // ama araç YOKTU: defterin tek yazarı bu script, `yaz.mjs` beyaz-listesi dispatched.jsonl'ı
  // reddediyor → PM açık satırı kapatamıyordu. Tek-yazar mülkiyeti korunur: defteri yine
  // yalnız dispatch.mjs yazar; bu komut o yazarın kapatma yüzüdür.
  const fp = argv[1] && !argv[1].startsWith("--") ? argv[1] : null;
  const sonucArg = opt(argv, "sonuc");
  const kanit = opt(argv, "kanit");
  const jobFiltre = opt(argv, "job");
  if (!fp || !AKIBETLER.includes(sonucArg) || !kanit || !String(kanit).trim()) {
    console.error(JSON.stringify({
      hata: "kullanım", mesaj: `kapat <fingerprint> --sonuc ${AKIBETLER.join("|")} --kanit "<metin>" [--job <id>]`,
      not: "`--kanit` ZORUNLU: kapanış her zaman gerekçelidir. `askida` = sonuç bilinmiyor (başarı DEĞİL).",
    }));
    process.exit(1);
  }
  const ledger = readLedger();
  const hedefler = [...sonSatirlar(ledger).values()].filter(
    (r) => r.fingerprint === fp && KAPATILABILIR.includes(r.durum) && (!jobFiltre || r.jobId === jobFiltre),
  );
  if (!hedefler.length) {
    console.error(JSON.stringify({
      hata: "acik-satir-yok", fingerprint: fp,
      mesaj: `bu parmak izinde kapatılabilir satır yok (gereken: ${KAPATILABILIR.join(" | ")}) — ` +
        "`dogrulandi`/`basarisiz` KANITLI akıbetlerdir, ezilmez",
    }));
    process.exit(3);
  }
  const yazilan = [];
  for (const r of hedefler) {
    const satir = { ...r, ts: new Date().toISOString(), durum: sonucArg, kanit: String(kanit).slice(0, 400), kaynak: "kapat" };
    appendLedger(satir);
    yazilan.push(satir);
  }
  console.log(JSON.stringify({ ok: true, fingerprint: fp, sonuc: sonucArg, kapatilan: yazilan.length, satirlar: yazilan }, null, 2));
} else if (cmd === "reddet") {
  // İNSAN REDDİ + GERİ BİLDİRİM → YENİDEN KOŞUM (eksik yetenek; hedefin açık talebi).
  //
  // Makine kanıtı ("job done") ile insan yargısı ("iş DOĞRU yapıldı") FARKLI sorulardır.
  // `dogrulandi` bir işin koştuğunu söyler, İSTENEN şeyi yaptığını değil: worker testi
  // koşup PASS basabilir ama yanlış şeyi test etmiş olabilir. İnsan reddi olmadan kullanıcı
  // ya sessizce kabul edecek ya her şeyi elle yeniden kuracaktı.
  //
  // İKİ ŞEY BİRDEN YAPAR (ikisi de şart):
  //   1. Defteri KAPATIR (`reddedildi`) → Kapı 4b serbest kalır, sistem tıkanmaz.
  //   2. Geri bildirimi PM'in GELEN KUTUSUNA yazar → PM bir sonraki koşumda DÜZELTİLMİŞ işi
  //      kendi kararıyla dağıtır (yeni fingerprint). KÖR TEKRAR DEĞİLDİR: aynı işi aynı
  //      haliyle yeniden ateşlemek hatayı tekrarlardı — düzeltmeyi PM tasarlar.
  //
  // `dogrulandi`yı EZEBİLİR: insan sözü makine kanıtının üstündedir.
  const fp = argv[1] && !argv[1].startsWith("--") ? argv[1] : null;
  const gb = opt(argv, "geri-bildirim");
  if (!fp || !gb || !String(gb).trim()) {
    console.error(JSON.stringify({
      hata: "kullanım", mesaj: 'reddet <fingerprint> --geri-bildirim "<neyin yanlış, ne bekleniyor>"',
      not: "Red bir AKIBETTİR: defteri kapatır VE geri bildirimi PM'in gelen kutusuna yazar → PM düzeltilmiş işi dağıtır.",
    }));
    process.exit(1);
  }
  const ledger = readLedger();
  const hedefler = [...sonSatirlar(ledger).values()].filter(
    (r) => r.fingerprint === fp && REDDEDILEBILIR.includes(r.durum),
  );
  if (!hedefler.length) {
    console.error(JSON.stringify({
      hata: "satir-yok", fingerprint: fp,
      mesaj: `bu parmak izinde reddedilebilir satır yok (gereken: ${REDDEDILEBILIR.join(" | ")})`,
    }));
    process.exit(3);
  }
  const yazilan = [];
  for (const r of hedefler) {
    const satir = { ...r, ts: new Date().toISOString(), durum: "reddedildi",
      kanit: `İNSAN REDDİ: ${String(gb).slice(0, 400)}`, kaynak: "reddet" };
    appendLedger(satir);
    yazilan.push(satir);
  }
  // Geri bildirimi PM'in gelen kutusuna yaz — düzeltmeyi PM tasarlar (tek kod-yolu: gelen.mjs).
  const asil = hedefler[0];
  let gelenDosya = null;
  try {
    const not =
      `REDDEDİLEN İŞ — DÜZELTİLMİŞ HALİYLE YENİDEN DAĞIT.\n\n` +
      `Parmak izi : ${fp}\n` +
      `İş         : ${asil.jobId ?? "?"} (kademe: ${asil.kademe ?? "?"})\n` +
      `Proje      : ${asil.hedefProje ?? "?"}\n` +
      `Önceki komut:\n${asil.komut ?? "(kayıt yok)"}\n\n` +
      `KULLANICININ GERİ BİLDİRİMİ:\n${String(gb)}\n\n` +
      `YAPILACAK: Aynı işi AYNEN yeniden dağıtma (hatayı tekrarlar). Geri bildirimi göreve ` +
      `İŞLE, komutu düzelt ve yeni bir fingerprint ile dağıt. Düzeltmenin neyi değiştirdiğini ` +
      `brifingde yaz.`;
    const out = execFileSync("node", [join(SCRIPT_DIR, "gelen.mjs"), "add",
      "--text", not, "--tip", "direktif", "--oncelik", "yuksek",
      ...(asil.hedefProje ? ["--proje", asil.hedefProje] : []),
      "--kaynak", "cli", "--json"], { encoding: "utf8", timeout: 15_000 });
    gelenDosya = JSON.parse(out).file ?? null;
  } catch (e) {
    console.error(`uyarı: geri bildirim gelen kutusuna yazılamadı (${String(e.message).slice(0, 80)}) — ` +
      `defter kapandı ama PM düzeltmeyi görmeyecek. Elle: aide pm feed "..."`);
  }
  console.log(JSON.stringify({ ok: true, fingerprint: fp, durum: "reddedildi",
    kapatilan: yazilan.length, gelenNotu: gelenDosya,
    not: gelenDosya ? "PM bir sonraki koşumda düzeltilmiş işi dağıtacak" : "GELEN NOTU YAZILAMADI — elle besle",
  }, null, 2));
} else {
  console.error(`komutlar: add | durum [--dry-run] | kapat <fingerprint> --sonuc ${AKIBETLER.join("|")} --kanit "<metin>" [--job <id>] | reddet <fingerprint> --geri-bildirim "<metin>"`);
  process.exit(1);
}
