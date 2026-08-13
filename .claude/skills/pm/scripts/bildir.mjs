#!/usr/bin/env node
// sg: katman=modul rol=motor
// bildir.mjs — sistemin telefona SESİ: `happy notify` sarmalayıcısı ve push
// dedupe state'inin (~/.claude/pm/bildirim-durum.json) TEK YAZARI.
//
//   bildir.mjs gonder --tip soru|kirmizi-onay|brifing-ozet|is-basarisiz
//                     --kimlik "<dedupe anahtarı>" --mesaj "<gövde>"
//                     [--baslik "<başlık>"] [--ttl 24h] [--json]
//   bildir.mjs gonder --stdin [--json]     # Maestro notify_cmd modu: alerts satırı
//                                          # stdin'den okunur, tip TÜRETİLİR
//   bildir.mjs durum [--json]              # state dökümü (teşhis; yazmaz)
//
// KİMLİK = OLAY (çağıran değil): aynı 🔴 iş için PM rutini + kaptan brifingi +
// Maestro alarmı TOPLAMDA BİR push atar. Anahtar sözleşmesi (PM SKILL ile ayna):
//   soru          → gelen dosya adı ya da soru metninin sha256 ilk 8   (TTL 24h)
//   kirmizi-onay  → <jobId>                                            (TTL 24h)
//   brifing-ozet  → özet metninin sha256 ilk 8 (aynı içerik → tek push) (TTL 24h)
//   is-basarisiz  → <jobId>:<state>                                    (TTL 12h)
//
// İKİ KANAL — ZİL ve İÇERİK ayrı şeylerdir:
//   · push (`happy notify`) = ZİL. Saf Expo push'tur (`sendToAllDevices`, source:"cli");
//     Happy uygulamasına HİÇBİR kayıt bırakmaz → bildirime tıklayınca görecek bir şey yoktur
//     (kanıt: dist handleNotifyCommand, 2026-07-13 — bu bir hata değil, aracın sınırı).
//   · telegram (Bot API sendMessage) = İÇERİK. Mesaj sohbette KALIR, komut kopyalanabilir,
//     tıklanabilir. Kanal kuruluysa (token + eşleşmiş chat) otomatik kullanılır.
// İkisi TEK dedupe anahtarını paylaşır: bir olay → bir zil + bir içerik satırı.
//
// GRACEFUL NO-OP (hepsi exit 0 — rutinler bildirim hatasıyla ASLA ölmez):
//   happy PATH'te yok → push atlanır (neden:"happy-yok")
//   ~/.happy/access.key yok → push atlanır (neden:"auth-yok")
//   happy notify hatası/timeout → push atlanır (neden:"gonderim-hatasi")
//   telegram kurulu değil / API hatası → telegram atlanır
//   HİÇBİR kanal başarmadıysa → {gonderildi:false, neden:<ilk sebep>} (state'e YAZILMAZ:
//   kanal geri gelince aynı olay yeniden denensin).
//
// Saatlik tavan: saat-kovası başına 6 push — kaçak döngü telefonu bombalayamaz.
// Mesaj 500 karaktere kırpılır; yapıştırılabilir komut kırpılmadan ÖNCE gelmeli
// (çağıran sözleşmesi: komut gövdenin başında/ortasında, süs sonda).
//
// Kırmızı valfe DOKUNMAZ: yalnız okur ve haber verir; onay her zaman insan
// elinden `aide zamanla run-now <id>` ile.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const STATE = join(HOME, ".claude", "pm", "bildirim-durum.json");
const ACCESS_KEY = join(HOME, ".happy", "access.key");
const TG_ENV = join(HOME, ".claude", "channels", "telegram", ".env");
const TG_ACCESS = join(HOME, ".claude", "channels", "telegram", "access.json");

export const TIPLER = ["soru", "kirmizi-onay", "brifing-ozet", "is-basarisiz", "dialog-bekliyor", "draft-riski"];
const BASLIKLAR = {
  soru: "PM sorusu",
  "kirmizi-onay": "🔴 Onay bekliyor",
  "brifing-ozet": "Brifing",
  "is-basarisiz": "İş başarısız",
  "dialog-bekliyor": "⏳ Pane dialog'da bekliyor",
  "draft-riski": "✍️ Gönderilmemiş taslak (enjeksiyon ertelendi)",
};
// tip → varsayılan dedupe penceresi (ms)
// dialog/draft = 1h: bu iki durum ACİLİYET taşır (insan pane'e bakmalı); 12-24h pencere
// onları saatlerce gizlerdi (runtime-sertlesme aşama-03). Kısa TTL = daha sık hatırlatma.
const TTL_MS = {
  soru: 24 * 3600_000,
  "kirmizi-onay": 24 * 3600_000,
  "brifing-ozet": 24 * 3600_000,
  "is-basarisiz": 12 * 3600_000,
  "dialog-bekliyor": 1 * 3600_000,
  "draft-riski": 1 * 3600_000,
};
const SAATLIK_TAVAN = 6;
const MESAJ_TAVAN = 500;
const BUDAMA_MS = 14 * 24 * 3600_000; // 14 günden eski kayıt silinir

function hata(msg) {
  console.error(`bildir: ${msg}`);
  process.exit(1);
}

function ttlParse(s) {
  const m = /^(\d+)([smhd])$/.exec(String(s));
  if (!m) return null;
  const n = Number(m[1]);
  return n * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

function stateOku() {
  try {
    const o = JSON.parse(readFileSync(STATE, "utf8"));
    if (o && typeof o === "object" && o.kayitlar) return o;
  } catch {
    /* yok/bozuk → sıfırdan */
  }
  return { schemaVersion: 1, kayitlar: {}, saatlik: {} };
}

/** Atomik yazım (tmp+rename, 0600) — ayar.mjs ayarYaz deseni. */
function stateYaz(st) {
  mkdirSync(dirname(STATE), { recursive: true });
  const tmp = `${STATE}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, STATE);
}

function buda(st, now) {
  for (const [k, v] of Object.entries(st.kayitlar)) {
    if (now - Date.parse(v.sonGonderim || 0) > BUDAMA_MS) delete st.kayitlar[k];
  }
  const buKova = kova(now);
  for (const k of Object.keys(st.saatlik)) if (k !== buKova) delete st.saatlik[k];
}

function kova(now) {
  return new Date(now).toISOString().slice(0, 13); // "2026-07-13T14"
}

export function sha8(s) {
  return createHash("sha256").update(String(s)).digest("hex").slice(0, 8);
}

function happyYolu() {
  // execFileSync("happy") PATH'e bakar; pano/daemon bağlamında PATH kısıtlı
  // olabilir → bilinen kurulum yerleri de denenir (dashboard BUN_BIN deseni).
  for (const p of ["/usr/local/bin/happy", "/opt/homebrew/bin/happy", join(HOME, ".bun", "bin", "happy")]) {
    if (existsSync(p)) return p;
  }
  try {
    execFileSync("which", ["happy"], { stdio: "ignore" });
    return "happy";
  } catch {
    return null;
  }
}

/** Telegram kanalının kimliği — kurulu değilse null (kanal sessizce atlanır).
 *  Token .env'de yaşar (yalnız OKUNUR, hiçbir yere basılmaz); hedef sohbet
 *  access.json → allowFrom[0] (eşleşmiş kullanıcı). */
function telegramKimlik() {
  try {
    const env = readFileSync(TG_ENV, "utf8");
    const m = /TELEGRAM_BOT_TOKEN\s*=\s*(\S+)/.exec(env);
    const acc = JSON.parse(readFileSync(TG_ACCESS, "utf8"));
    const chatId = acc?.allowFrom?.[0];
    if (!m || !chatId) return null;
    return { token: m[1], chatId: String(chatId) };
  } catch {
    return null;
  }
}

/** İÇERİK kanalı: mesajı Telegram sohbetine yaz (kalıcı + kopyalanabilir).
 *  Ağ hatası akışı BOZMAZ — "kurulu-degil" | "ok" | "hata" döner. */
function telegramGonder(metin) {
  const k = telegramKimlik();
  if (!k) return "kurulu-degil";
  try {
    // curl: node fetch'i senkron değil; bu script kısa ömürlü ve senkron akışlı.
    execFileSync(
      "curl",
      [
        "-sS", "-m", "12", "-o", "/dev/null",
        "-X", "POST",
        `https://api.telegram.org/bot${k.token}/sendMessage`,
        "--data-urlencode", `chat_id=${k.chatId}`,
        "--data-urlencode", `text=${metin}`,
        "--data-urlencode", "disable_web_page_preview=true",
      ],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 15_000 },
    );
    return "ok";
  } catch {
    return "hata";
  }
}

/**
 * Bildir: ZİL (happy notify) + İÇERİK (telegram) — tek dedupe anahtarıyla.
 * @returns {{gonderildi:boolean, neden?:string, kimlik:string, kanallar?:object}}
 */
export function gonder({ tip, kimlik, mesaj, baslik, ttlMs } = {}) {
  if (!TIPLER.includes(tip)) throw new Error(`geçersiz tip: ${tip} (geçerli: ${TIPLER.join(" | ")})`);
  if (!kimlik || !String(kimlik).trim()) throw new Error("kimlik gerekli (dedupe anahtarı)");
  if (!mesaj || !String(mesaj).trim()) throw new Error("mesaj gerekli");
  const now = Date.now();
  const anahtar = `${tip}:${kimlik}`;
  const st = stateOku();
  buda(st, now);

  const kayit = st.kayitlar[anahtar];
  const pencere = ttlMs ?? TTL_MS[tip];
  if (kayit && now - Date.parse(kayit.sonGonderim) < pencere) {
    stateYaz(st); // budama kalıcı olsun
    return { gonderildi: false, neden: "dedupe", kimlik: anahtar };
  }
  const buKova = kova(now);
  if ((st.saatlik[buKova] ?? 0) >= SAATLIK_TAVAN) {
    stateYaz(st);
    return { gonderildi: false, neden: "saatlik-tavan", kimlik: anahtar };
  }

  const govde = String(mesaj).slice(0, MESAJ_TAVAN);
  const bas = baslik || BASLIKLAR[tip];
  const kanallar = {};

  // 1) ZİL — happy notify (içerik taşımaz; yalnız haber verir)
  const happy = happyYolu();
  if (!happy) kanallar.push = "happy-yok";
  else if (!existsSync(ACCESS_KEY)) kanallar.push = "auth-yok";
  else {
    try {
      execFileSync(happy, ["notify", "-p", govde, "-t", bas], { stdio: "ignore", timeout: 15_000 });
      kanallar.push = "ok";
    } catch {
      kanallar.push = "gonderim-hatasi";
    }
  }

  // 2) İÇERİK — telegram (mesaj sohbette kalır; komut kopyalanabilir)
  kanallar.telegram = telegramGonder(`${bas}\n\n${govde}`);

  const basaran = Object.values(kanallar).some((v) => v === "ok");
  if (!basaran) {
    // Hiçbir kanal başaramadı → state'e YAZMA: kanal geri gelince yeniden denenmeli.
    return { gonderildi: false, neden: kanallar.push ?? "kanal-yok", kimlik: anahtar, kanallar };
  }

  st.kayitlar[anahtar] = {
    sonGonderim: new Date(now).toISOString(),
    sayac: (kayit?.sayac ?? 0) + 1,
    sonOzet: govde.slice(0, 120),
  };
  st.saatlik[buKova] = (st.saatlik[buKova] ?? 0) + 1;
  stateYaz(st);
  return { gonderildi: true, kimlik: anahtar, kanallar };
}

/** Maestro alerts satırı ({ts,job,title,state,reason,hint}) → gonder() girdisi.
 *  reason "red-action:*" → kirmizi-onay (kimlik=jobId; hint onay komutunu taşır);
 *  diğer her alarm → is-basarisiz (kimlik=jobId:state). SAF — test edilir. */
export function alertsGirdisi(a) {
  const job = a?.job ?? "?";
  const kirmizi = /^red-action:/.test(String(a?.reason ?? ""));
  const parcalar = [a?.title, a?.reason, a?.hint].filter(Boolean);
  return {
    tip: kirmizi ? "kirmizi-onay" : "is-basarisiz",
    kimlik: kirmizi ? job : `${job}:${a?.state ?? "?"}`,
    mesaj: parcalar.join(" — ") || `iş ${job}: ${a?.state ?? "?"}`,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const invokedDirectly = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opt = (ad) => {
    const i = argv.indexOf(ad);
    return i > -1 ? argv[i + 1] : undefined;
  };
  const json = argv.includes("--json");

  if (cmd === "gonder") {
    let girdi;
    if (argv.includes("--stdin")) {
      let raw = "";
      try {
        raw = readFileSync(0, "utf8");
      } catch {
        hata("--stdin verildi ama stdin okunamadı");
      }
      let a;
      try {
        a = JSON.parse(raw);
      } catch {
        hata(`stdin JSON değil: ${raw.slice(0, 80)}`);
      }
      girdi = alertsGirdisi(a);
    } else {
      girdi = { tip: opt("--tip"), kimlik: opt("--kimlik"), mesaj: opt("--mesaj"), baslik: opt("--baslik") };
      const ttl = opt("--ttl");
      if (ttl) {
        const ms = ttlParse(ttl);
        if (!ms) hata(`geçersiz --ttl: ${ttl} (örnek: 30m, 12h, 2d)`);
        girdi.ttlMs = ms;
      }
    }
    let r;
    try {
      r = gonder(girdi);
    } catch (e) {
      hata(e.message); // kullanım hatası = exit 1; gönderim hataları exit 0'dır
    }
    const kanalOzet = r.kanallar
      ? ` [zil: ${r.kanallar.push} · içerik: ${r.kanallar.telegram}]`
      : "";
    console.log(
      json
        ? JSON.stringify(r)
        : `${r.gonderildi ? "📨 gönderildi" : `— gönderilmedi (${r.neden})`} · ${r.kimlik}${kanalOzet}`,
    );
    process.exit(0);
  }

  if (cmd === "durum") {
    const st = stateOku();
    if (json) console.log(JSON.stringify(st, null, 2));
    else {
      const n = Object.keys(st.kayitlar).length;
      console.log(`kayıt: ${n} · saatlik: ${JSON.stringify(st.saatlik)}`);
      for (const [k, v] of Object.entries(st.kayitlar))
        console.log(`  ${k} · ${v.sonGonderim} · x${v.sayac} · ${v.sonOzet ?? ""}`);
    }
    process.exit(0);
  }

  hata(`bilinmeyen komut: ${cmd ?? "(boş)"} — gonder | durum`);
}
