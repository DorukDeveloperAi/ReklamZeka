#!/usr/bin/env node
// kurallar.mjs — kutup yıldızı dönüşüm yetkisinin TEK okuyucusu (SAF; PM P0.75 çağırır).
// Kaynak: <proje>/utopya/KURALLAR.md içindeki fenced ```json bloğu (surum 1 ve 2 desteklenir).
//
// FAIL-CLOSED sözleşmesi (kilitli):
//   · blok yok / parse edilemez → HER karar "insana-sor"
//   · chunk tipinin profili yok / tip bilinmiyor → "insana-sor"
//   · profil.otomatik BOŞ liste → "insana-sor" (boşluk "koşulsuz otomatik" DEĞİL "asla otomatik"tir
//     — KURALLAR'daki alt-proje bilinçli boşluğunun mekanik karşılığı)
//   · kirmizi=true → HER durumda "insana-sor" (🔴 valf hiyerarşisi tavandır)
//   · ilke tipi → "insana-sor" (ilke dönüşüm nesnesi değildir; chunk olmamalıydı)
// Koşul BEYANI (saglanan/tetiklenen) çağırana aittir — makine beyanı ZORLAR, doğruluğunu değil
// (Kapı-0 simetrisi). Şüphede beyan edilmez → karar kendiliğinden insana-sor'a düşer.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ISTEK_TIPLERI = ["hedef", "yetenek", "nitelik", "ilke", "alt-proje"];

export function kurallarOku(projeYolu) {
  try {
    const md = readFileSync(join(projeYolu, "utopya", "KURALLAR.md"), "utf8");
    const m = md.match(/```json\n([\s\S]*?)```/);
    const j = JSON.parse(m[1]);
    if (j.varsayilan !== "insana-sor") throw new Error("varsayilan insana-sor değil");
    return { ...j, kaynak: "kurallar" };
  } catch {
    return { varsayilan: "insana-sor", kaynak: "fail-closed" };
  }
}

export function tipCoz(ref) {
  // "uy:<a>/<b>[#alt-N]" → a istek tipiyse o; değilse söz-slug'ıdır → "vizyon"
  const a = String(ref || "").replace(/^uy:/, "").split("#")[0].split("/")[0];
  return ISTEK_TIPLERI.includes(a) ? a : "vizyon";
}

export function karar({ ref, saglanan = [], tetiklenen = [], kirmizi = false }, kurallar) {
  const tip = tipCoz(ref);
  const sor = (gerekce) => ({ sonuc: "insana-sor", tip, gerekce });
  if (kirmizi) return sor("🔴 geri-alınamaz yüzey — hiçbir kural otomatikleştiremez");
  if (tip === "ilke") return sor("ilke dönüşüm nesnesi değildir — bu ref'ten chunk üretilmemeliydi");
  if (!kurallar || kurallar.kaynak === "fail-closed") return sor("KURALLAR bloğu yok/bozuk (fail-closed)");
  const insanaSor = kurallar["insana-sor"]?.kosullar || [];
  const tetik = tetiklenen.filter((k) => insanaSor.includes(k));
  if (tetik.length) return sor(`insana-sor koşulu tetiklendi: ${tetik.join(", ")}`);
  let otomatik;
  if (kurallar.surum >= 2) {
    const profil = kurallar.tipler?.[tip];
    if (!profil) return sor(`'${tip}' için tip profili yok (surum:2)`);
    otomatik = profil.otomatik || [];
  } else {
    otomatik = kurallar.otomatik?.kosullar || [];
  }
  if (otomatik.length === 0) return sor(`'${tip}' otomatik koşulu tanımsız — daima insan`);
  const eksik = otomatik.filter((k) => !saglanan.includes(k));
  if (eksik.length) return sor(`otomatik koşulları eksik: ${eksik.join(", ")}`);
  return { sonuc: "otomatik", tip, gerekce: `tüm koşullar beyanla sağlandı: ${otomatik.join(", ")}` };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opt = (a) => { const i = argv.indexOf(a); return i >= 0 ? argv[i + 1] : null; };
  const liste = (a) => (opt(a) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const proje = opt("--proje") || process.cwd();
  const K = kurallarOku(proje);
  if (cmd === "oku") { console.log(JSON.stringify(K, null, 2)); process.exit(0); }
  if (cmd === "karar") {
    const r = karar({ ref: opt("--ref"), saglanan: liste("--saglanan"),
      tetiklenen: liste("--tetiklenen"), kirmizi: argv.includes("--kirmizi") }, K);
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }
  console.error("kullanım: kurallar.mjs oku|karar --proje <kök> [--ref uy:… --saglanan a,b --tetiklenen x --kirmizi]");
  process.exit(1);
}
