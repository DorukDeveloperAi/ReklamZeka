// HOOK KOŞUM DAMGASI — plans/otonomi-merdiveni/v1 aşama-02 (02.3).
// Sınıf: motor (deterministik · LLM doğurmaz · 0 token). Taşıyıcı: session-yerleşik —
// hook'un KENDİ sürecinde koşar, ayrı bir şalteri YOKTUR (hook susarsa damga da susar,
// ve o susma zaten ölçülmek istenen şeydir).
//
// NEDEN VAR: `aide otomasyon durum` 52 aktörü üç eksende ölçer; akıbet ekseninde HOOK
// taşıyıcısının hiçbir kaydı "koştum" diyemiyordu. `settings.json` KAYDI ölçülebiliyordu
// ("kayıtsız hook ölü metindir") ama kayıtlı VE her koşumda çöken bir hook yeşil
// görünüyordu — R2'nin "yeşil görünen ölüm" sınıfı. Bu modül o boşluğu kapatır.
//
// SÖZLEŞME — ÜÇ SERT KURAL:
//   1. HOOK'U ASLA BLOKLAMAZ. Her yol try/catch içindedir; damga yazılamazsa hook hiç
//      bilmez. Bir ölçüm aracının ölçtüğü şeyi bozması, ölçümü ölçüm olmaktan çıkarır.
//   2. EXIT KODUNU GERÇEKTEN OKUR. Damga `process.on("exit")` içinde yazılır: `process.exit()`
//      ile biten dallar da, hata fırlatan dallar da (exit 1) doğru kodu bırakır. Girişte
//      yazsaydı damga "başladı"yı söylerdi, "koştu"yu değil.
//   3. HOOK BAŞINA AYRI DOSYA. Tek bir birleşik JSON, eşzamanlı koşan hook'larda
//      oku-değiştir-yaz yarışına girer ve kaybeden hook'un damgası SİLİNİR (bu makinede
//      aynı anda 8 Claude oturumu ölçüldü) — yani ölçüm kendi yarattığı boşluğu
//      "hiç koşmamış" diye rapor ederdi. Ayrı dosya + tmp&rename ile yarış YAPISAL olarak yok.
//
// KÖR NOKTA (İLANLI): SIGKILL ile öldürülen ya da zaman aşımına uğrayan bir hook damga
// bırakmaz — `exit` olayı hiç doğmaz. Böyle bir hook sondada BEKLIYOR görünür (yanlış
// PASS değil, ölçüm eksikliği yönünde yanılır).
//
// Okuyan uç: `scripts/otomasyon-akibet.mjs hook <ad>` → exit 0 PASS · 1 FAIL · 3 BEKLIYOR.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NABIZ_DIZINI = join(process.env.HOME || homedir(), ".config", "agent-ide", "hook-nabiz");

let kayitli = false;

/** `nabiz("goal-tracker", process.argv[2])` — hook'un ilk satırlarından biri. İkinci çağrı
 *  yok sayılır (aynı süreçte iki damga yazmaz). `ad` kütükteki `akibet-sondasi` argümanıyla
 *  BİREBİR aynı olmalıdır; kanon eşleme kütükte durur. */
export function nabiz(ad, olay) {
  try {
    if (kayitli || !ad) return;
    kayitli = true;
    const baslangic = new Date().toISOString();
    const dosya = join(NABIZ_DIZINI, `${String(ad).replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
    process.on("exit", (kod) => {
      try {
        mkdirSync(NABIZ_DIZINI, { recursive: true });
        const gecici = `${dosya}.${process.pid}.tmp`;
        writeFileSync(
          gecici,
          `${JSON.stringify({ ad, olay: olay ?? null, baslangic, bitis: new Date().toISOString(), exit: typeof kod === "number" ? kod : 0, pid: process.pid })}\n`,
        );
        renameSync(gecici, dosya); // atomik: okuyan ya eski ya yeni damgayı görür, yarımını asla
      } catch {
        /* damga hiçbir koşulda hook'u bloklamaz (sözleşme md.1) */
      }
    });
  } catch {
    /* aynı sebep — kayıt bile başarısız olsa hook koşmaya devam eder */
  }
}

export default nabiz;
