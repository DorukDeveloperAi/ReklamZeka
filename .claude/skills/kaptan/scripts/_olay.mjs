// _olay.mjs — GÖZLEMLENEBİLİRLİK yazıcısının SCRIPT AYNASI (.mjs).
//
// Kanonik şema TypeScript'te: packages/core/src/olay-log.ts. Scriptler o TS modülü
// import EDEMEZ (core TS, script .mjs) → şema burada ELLE aynalanır. Sapma serbest
// bırakılmaz: packages/core/test/olay-log.test.ts SÖZLEŞME testi core'daki enum
// sabitlerinin bu dosyada AYNEN bulunmasını zorlar; biri değişip diğeri unutulursa
// test KIRILIR. (Ayna deseni: packages/kit/test/kit-el-aynasi.test.mjs.)
//
// Bu dosya pm ve kaptan scripts/ altında BYTE-EŞ iki kopya olarak durur; makineye çivili
// mutlak yol içermez → kit sync'i olduğu gibi dağıtır (kurulu kopya = kaynak).
//
// SATIR ŞEMASI (sabit alan sırası): { ts, katman, tur, sinif, olay, baglam }

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const KATMANLAR = ["happy", "pm", "kaptan", "daemon"];
export const TURLER = ["event", "error"];
export const SINIFLAR = ["kopru", "dagitim", "kapi", "mutabakat", "turetme", "agentic"];
export const ALAN_SIRASI = ["ts", "katman", "tur", "sinif", "olay", "baglam"];

/** Girdiyi şemaya göre doğrula (olay-log.ts:olayDogrula aynası). */
export function olayDogrula(rec) {
  if (!rec || typeof rec !== "object") return { ok: false, hata: "obje değil" };
  if (!KATMANLAR.includes(rec.katman)) return { ok: false, hata: `katman geçersiz: ${String(rec.katman)}` };
  if (!TURLER.includes(rec.tur)) return { ok: false, hata: `tur geçersiz: ${String(rec.tur)}` };
  if (!SINIFLAR.includes(rec.sinif)) return { ok: false, hata: `sinif geçersiz: ${String(rec.sinif)}` };
  if (typeof rec.olay !== "string" || !rec.olay.trim()) return { ok: false, hata: "olay boş" };
  if ("baglam" in rec && (typeof rec.baglam !== "object" || rec.baglam === null || Array.isArray(rec.baglam)))
    return { ok: false, hata: "baglam obje değil" };
  if ("ts" in rec && typeof rec.ts !== "string") return { ok: false, hata: "ts string değil" };
  return { ok: true };
}

/** Deftere sabit-şemalı satır ekle (append-only, BEST-EFFORT: THROW ETMEZ).
 *  Gözlemleme gözlemleneni kıramaz → geçersiz girdi/yazım hatası `false` döner. */
export function olayYaz(dosya, girdi) {
  if (!olayDogrula(girdi).ok) return false;
  const satir = {
    ts: new Date().toISOString(),
    katman: girdi.katman,
    tur: girdi.tur,
    sinif: girdi.sinif,
    olay: girdi.olay,
    baglam: girdi.baglam ?? {},
  };
  try {
    mkdirSync(dirname(dosya), { recursive: true });
    appendFileSync(dosya, JSON.stringify(satir) + "\n");
    return true;
  } catch {
    return false;
  }
}
