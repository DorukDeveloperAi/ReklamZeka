#!/usr/bin/env node
/**
 * claim-guard — eşzamanlı session çakışma KAPISI (PreToolUse) + farkındalık enjeksiyonu.
 *
 * Kullanım (settings.json):
 *   node ~/.claude/hooks/claim-guard.mjs write     # PreToolUse, matcher "Edit|Write|NotebookEdit"
 *   node ~/.claude/hooks/claim-guard.mjs bash      # PreToolUse, matcher "Bash"
 *   node ~/.claude/hooks/claim-guard.mjs ctx       # SessionStart | UserPromptSubmit  (sync!)
 *   node ~/.claude/hooks/claim-guard.mjs giden    # PostToolUse, "SendMessage|…send_message|Bash"
 *   node ~/.claude/hooks/claim-guard.mjs limit_devir   # Stop — kendi kilitlerini devret
 *   node ~/.claude/hooks/claim-guard.mjs release_all   # SessionEnd (async olabilir)
 *
 * Karar sözleşmesi model-policy-guard.mjs'ten birebir alındı (tahmin değil, ölçüm):
 *   deny = stdout'a {"hookSpecificOutput":{...,"permissionDecision":"deny",...}} + exit 0
 *   pass = çıktısız exit 0
 *
 * DEĞİŞMEZ: kapı YALNIZ BAŞKASININ canlı claim'ini korur. Claim yoksa hiçbir şeye
 * karışmaz (tek-session gündelik akış sıfır sürtünme). Herhangi bir iç hata → PASS
 * (kapı, ürünü asla kilitlemez — session-status'un "never disrupt" deseni).
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as L from "./claims-lib.mjs";

// KOŞUM DAMGASI (otonomi-merdiveni:02.3) — `aide otomasyon durum`un akıbet ekseni bunu okur.
// Dinamik import + try: damga yazarı yoksa ya da bozuksa hook KOŞMAYA DEVAM EDER; bir ölçüm
// aracı ölçtüğü şeyi asla bozamaz. Maliyet: bir dosya yazımı, 0 token.
try { (await import("./hook-nabiz.mjs")).nabiz("claim-guard", process.argv[2]); } catch {}

const mode = process.argv[2] || "write";

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}
const pass = () => process.exit(0);
function out(o) {
  process.stdout.write(JSON.stringify(o));
  process.exit(0);
}
const deny = (reason) =>
  out({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });

const dk = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "az önce" : m < 60 ? `${m} dk önce` : `${Math.round(m / 60)} sa önce`;
};
/** Enjekte edilen blok her turda context'e girer — uzun başlık/niyet kırpılır, boş kalmaz. */
const kis = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return !t ? "" : t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

/**
 * BİLDİRİ OKUMA UCU (seviye 0) — POSTA KUTUSU: bu oturuma ÖZEL haberler.
 *
 * Üç cins, üç ayrı soru — bir arada basılırsa üçü de okunmaz olur:
 *   `sira`        bekleyendim, kaynak boşaldı  → zincirin İLERİ yönü
 *   `bekleyenVar` kilidimi bekleyen doğdu      → zincirin GERİ yönü (2026-08-09)
 *   `elle`        biri bana doğrudan yazdı     → orkestratörün "devam et" kanalı
 * Tanımadığı tipi ham olarak basar: haber DÜŞMEZ (ileri uyum).
 *
 * TÜKETİCİdir: haber bir kez basılır, kutu silinir. `others` erken dönüşünden ÖNCE
 * hesaplanır — bırakan çoktan kapanmış olsa da haber sahibine ulaşmalıdır.
 *
 * İKİ MUHATAP, İKİ KANAL (kullanıcı kararı 2026-08-10 — "bir session mesaj gönderdiğinde de
 * aldığında da bunu printlesin bana"): gövde MODELE gider (`additionalContext`), `ozet` ise
 * İNSANA (`systemMessage`). Kutu tüketici okunduğu için ikinci bir okuyucu haberi yerdi —
 * bu yüzden alma ucu burada, gönderme ucu `mesaj-nabzi.mjs`te. Dönüş: `{ satirlar, ozet }`.
 */
/* ── DEFTER BLOĞU (AIDE S · yonetim-katmani/v2:04) ─────────────────────────────
   Üç akıbet zincirinin ctx ucu. Hedefi bu oturum/rolü olan AÇIK kayıtlar burada görünür.

   İKİ SERT KURAL:
   - YEŞİL = EMİR bloğu: "işle ya da GEREKÇELİ reddet" — sessiz düşürme yasak. `alindi`
     damgasını hook MOTOR olarak yazar (LLM'e bırakılmaz; damga kesin olmalı).
   - KIRMIZI = EMİR BASILMAZ: yalnız "🔴 onay bekliyor" İLANI. Valf insanındır
     (`defter.mjs onayla <tid>`); jobs/'a tek bayt yazılmaz.

   Teslim POSTA ile yapılır (defter ikinci kanal açmaz); bu blok yalnız GÖRÜNÜRLÜK. */
function defterBloku(root, me) {
  const bos = { satirlar: [], ozet: [] };
  try {
    if (!L.defterBana) return bos;
    let roller = [];
    try {
      roller = (L.rolListe?.(root) || []).filter((r) => r.sahip?.sessionId === me).map((r) => r.ad);
    } catch {
      /* rol okunamadı — yalnız sid kutusuna bak */
    }
    const kayitlar = L.defterBana(root, { sid: me, roller });
    if (!kayitlar.length) return bos;
    const satirlar = [];
    const ozet = [];
    const yesil = kayitlar.filter((k) => k.sinif !== "kirmizi");
    const kirmizi = kayitlar.filter((k) => k.sinif === "kirmizi");
    if (yesil.length) {
      satirlar.push(
        `[EMİR] ${yesil.length} açık kayıt sana adresli — İŞLE ya da GEREKÇELİ REDDET (sessiz düşürme yasak):`,
      );
      for (const k of yesil.slice(0, 6)) {
        satirlar.push(`  • ${k.tid} · ${k.tur} · "${String(k.metin).slice(0, 120)}" — kimden: ${k.kimden?.etiket ?? "?"}`);
        try {
          L.defterAkibet(root, k.tid, "alindi", { kim: me, yol: "ctx" });
        } catch {
          /* damga yazılamadı — kayıt açık kalır, akıbet kapısı görür */
        }
      }
      satirlar.push(
        `  kapat: node ~/.claude/skills/aide-s/scripts/defter.mjs kapat <tid> --sonuc "…"  ·  ` +
          `reddet: … reddet <tid> --neden "…"`,
      );
      ozet.push(`✉ ${yesil.length} EMİR (defter)`);
    }
    if (kirmizi.length) {
      satirlar.push(
        `[🔴 ONAY BEKLİYOR] ${kirmizi.length} kayıt VALFTE — emir olarak işlenmez, yalnız İNSAN açar:`,
      );
      for (const k of kirmizi.slice(0, 4)) satirlar.push(`  • ${k.tid} · "${String(k.metin).slice(0, 100)}"`);
      satirlar.push(`  onay: node ~/.claude/skills/aide-s/scripts/defter.mjs onayla <tid>`);
      ozet.push(`🔴 ${kirmizi.length} onay bekliyor`);
    }
    return { satirlar, ozet };
  } catch {
    return bos;
  }
}

function bildiriBloku(root, me) {
  const bos = { satirlar: [], ozet: [] };
  if (!me || !L.ledgerExists() || typeof L.bildiriOku !== "function") return bos;
  let gelen = [];
  try {
    gelen = L.bildiriOku(root, me);
  } catch {
    return bos;
  }
  if (!gelen.length) return bos;
  const tipi = (b) => b?.tip || "sira";
  const sira = gelen.filter((b) => tipi(b) === "sira");
  const bekleyenVar = gelen.filter((b) => tipi(b) === "bekleyenVar");
  const elle = gelen.filter((b) => tipi(b) === "elle");
  const diger = gelen.filter((b) => !["sira", "bekleyenVar", "elle"].includes(tipi(b)));
  const CLI = "node ~/.claude/skills/eszamanli/scripts/claim.mjs";
  const yas = (b) => {
    const t = Date.parse(b?.ts || "");
    return Number.isFinite(t) ? ` (${dk(t)})` : "";
  };
  const out = [];

  /* ── ⏳ ZİNCİRİN GERİ YÖNÜ: seni bekleyen var ───────────────────────────────
     Kaynak başına EN TAZE haber: aynı kilide üç kişi geldiyse üç satır değil, en son
     durum + kuyruk derinliği. Sahibin kararı tek: yol ver ya da verme. */
  if (bekleyenVar.length) {
    const enTaze = new Map();
    for (const b of bekleyenVar) if (b?.key) enTaze.set(b.key, b);
    out.push(`[eşzamanlılık] ⏳ SENİ BEKLEYEN VAR (${enTaze.size} kaynak):`);
    for (const b of enTaze.values()) {
      out.push(
        `  • ${b.key} ← ${String(b.kimden || "?").slice(0, 8)}` +
          `${b.kimdenBaslik ? ` "${kis(b.kimdenBaslik, 44)}"` : ""}${yas(b)}` +
          `${b.kuyruk > 1 ? ` · kuyruk ${b.kuyruk}` : ""}`
      );
      if (b.bekleyenNiyet) out.push(`      bekleyenin işi: ${kis(b.bekleyenNiyet, 88)}`);
      out.push(`      İŞİN BİTTİYSE BIRAK (haber ona otomatik gider): ${CLI} release --res "${b.key}"`);
    }
  }

  /* ── ✉ ELLE BİLDİRİ: doğrudan sana yazılmış (orkestratörün "devam et" kanalı) ── */
  if (elle.length) {
    out.push(`[eşzamanlılık] ✉ SANA MESAJ (${elle.length}):`);
    for (const b of elle.slice(-6)) {
      out.push(
        `  • ${String(b.kimden || "?").slice(0, 8)}${b.kimdenBaslik ? ` "${kis(b.kimdenBaslik, 40)}"` : ""}` +
          `${b.key ? ` · ${b.key}` : ""}${yas(b)}: ${kis(b.mesaj, 220)}`
      );
    }
    if (elle.length > 6) out.push(`  … +${elle.length - 6} mesaj daha GÖSTERİLMEDİ (tavan 6).`);
  }

  /* ── 🔓 ZİNCİRİN İLERİ YÖNÜ: beklediğin kaynak boşaldı ─────────────────────
     Haber BAYAT OLABİLİR ve bunu SÖYLER: bırakma ile bu tur arasında kaynağı başkası
     kapmış olabilir → satır defteri OKUMA ANINDA ölçer, iki farklı çare basar. */
  if (sira.length) {
    const enTaze = new Map();
    for (const b of sira) if (b?.key) enTaze.set(b.key, b);
    if (enTaze.size) {
      let claims = [];
      try {
        claims = L.activeClaims(root); // yalnız haber VARKEN okunur (nadir yol)
      } catch {
        /* ölçülemedi → "yeniden alınmış mı" iddiası kurulmaz */
      }
      out.push(`[eşzamanlılık] 🔓 BEKLEDİĞİN KAYNAK BOŞALDI (${enTaze.size} bildiri):`);
      for (const b of enTaze.values()) {
        out.push(
          `  • ${b.key} — ${String(b.kimden || "?").slice(0, 8)}` +
            `${b.kimdenBaslik ? ` "${kis(b.kimdenBaslik, 48)}"` : ""} bıraktı${yas(b)}` +
            `${b.neden === "SessionEnd" ? " [oturumu kapanarak]" : ""}`
        );
        if (b.bekleyenNiyet) out.push(`      beklemedeki işin: ${kis(b.bekleyenNiyet, 96)}`);
        const yeni = claims.find((c) => c.resource.key === b.key);
        if (yeni) {
          const s = L.sessionInfo(yeni.owner?.sessionId);
          out.push(
            `      ⚠ kaynak YENİDEN alınmış (${String(yeni.owner?.sessionId).slice(0, 8)}` +
              `${s?.title ? ` "${kis(s.title, 40)}"` : ""}) — sıraya gir:`,
            `        ${CLI} wait --res "${b.key}" --intent "<beklemedeki iş>"   (run_in_background)`
          );
        } else {
          out.push(`      ŞİMDİ AL: ${CLI} claim --res "${b.key}" --intent "<beklemedeki iş>"`);
        }
      }
    }
  }

  for (const b of diger.slice(-4)) out.push(`  • ${tipi(b)}: ${kis(JSON.stringify(b), 180)}`);
  if (out.length) out.push(`  (bu haberler BİR KEZ basılır — gerekeni şimdi ele al.)`);

  /* İNSAN ÖZETİ — gövdenin kısaltması DEĞİL, farklı bir sorunun cevabı: kullanıcı "bana kim
     ne yazdı"yı görmek ister, kilit kuyruğunun mekaniğini değil. Bu yüzden `elle` mesajları
     TEK TEK ve metniyle, otomatik zincir haberleri (sira/bekleyenVar) tek sayaç satırında. */
  const ozet = [];
  for (const b of elle.slice(-3)) {
    ozet.push(
      `✉ MESAJ ALINDI ← ${String(b.kimden || "?").slice(0, 8)}` +
        `${b.kimdenBaslik ? ` "${kis(b.kimdenBaslik, 32)}"` : ""}: ${kis(b.mesaj, 160)}`
    );
  }
  if (elle.length > 3) ozet.push(`  … +${elle.length - 3} mesaj daha (gövdesi bağlama girdi)`);
  const otomatik = sira.length + bekleyenVar.length + diger.length;
  if (otomatik) ozet.push(`✉ ${otomatik} eşzamanlılık bildirisi alındı (kaynak · kuyruk haberi)`);

  return { satirlar: out, ozet };
}

/**
 * SAHA BESLEMESİ — orkestratörün gözü: `olay.jsonl`'ın PROJEKSİYONU (2026-08-09).
 *
 * Neden defter, neden elle bağlanan olaylar değil: elle bağlamada beşinci bir olay tipi
 * eklendiğinde biri çağırmayı unutursa besleme SESSİZCE eksilirdi — ve eksildiği hiçbir
 * yerden görülmezdi. Defter zaten eşzamanlılığın tek yazım noktası; onu okumak "her olay
 * akar"ı YAPISAL kılar. Yeni tip eklemek için burada kod değişmez: tanınmayan tip ham
 * satır olarak basılır.
 *
 * İMLEÇ: `orkestrator/imlec.json` (bayt ofseti). Kayıt anında defterin SONUNA konur, her
 * çizimden sonra ilerler → aynı olay iki kez basılmaz, geçmiş arşivi hiç dökülmez.
 *
 * GÜRÜLTÜ BÜTÇESİ SÖZLEŞMEDİR, süs değil (ölçüldü: 163 olayın 123'ü `claimsiz`):
 *   · `claimsiz` yığını TEK satıra katlanır (sayı · oturum · yol),
 *   · aynı (tip,key,oturum) üçlüsü tek satır + ×N,
 *   · tavan 12 satır, aşan `… +N GÖSTERİLMEDİ` ile İLAN edilir (sessiz kırpma yasak),
 *   · okunmamış > 500 olay → yalnız SAYAÇ özeti (gövde basılmaz, imleç yine ilerler).
 */
function sahaBloku(root, me) {
  if (!me || !L.ledgerExists() || typeof L.olayOku !== "function") return [];
  /* KİM BESLEME ALIR: rol sahibi HER oturum (kullanıcı kararı 2026-08-09 — "diğer
     session'ların progress'lerini de görsün"). Orkestratör sahanın TAMAMINI görür; öteki
     roller yalnız üst-düzey olayları ve daha kısa bir tavanla. Rolsüz worker hiçbir şey
     almaz: onun bilmesi gereken zaten kendi posta kutusundadır. */
  let benimRoller = [];
  try {
    benimRoller = L.rolleriOf?.(root, me) || [];
    if (!benimRoller.length && L.orkestratorOku?.(root)?.sessionId === me) benimRoller = ["orkestrator"];
  } catch {
    return [];
  }
  if (!benimRoller.length) return [];
  const rolAd = benimRoller.includes("orkestrator") ? "orkestrator" : benimRoller[0];
  /* `??` KULLANILMAZ: orkestratörün süzgeci BİLEREK `null`dur (= süzme yok) ve `null ??
     varsayilan` onu varsayılana düşürürdü — orkestratör sahanın tamamını görmeyi tam da
     bu satırda kaybederdi (ölçüldü: besleme "1 olay" gösterdi, deny/alindi düştü).
     Ölçüt VARLIK: anahtar tabloda var mı? */
  const SUZ = L.ROL_SUZGEC || {};
  const suz = Object.prototype.hasOwnProperty.call(SUZ, rolAd) ? SUZ[rolAd] : SUZ.varsayilan || null;
  const satirTavan = rolAd === "orkestrator" ? 12 : 5;
  let r;
  try {
    const ofset = L.imlecOku?.(root, rolAd);
    r = L.olayOku(root, { ofset: Number.isFinite(ofset) ? ofset : L.olaySonu(root) });
  } catch {
    return [];
  }
  const ilerlet = () => {
    try {
      L.imlecYaz?.(root, r.ofset, rolAd);
    } catch {
      /* yut — okunamayan imleç en fazla tekrar basar, olayı kaybetmez */
    }
  };
  // Rol süzgeci: orkestratör dışındaki roller yalnız üst-düzey olayları görür.
  if (suz) r = { ...r, satirlar: r.satirlar.filter((e) => suz.includes(e.tip)) };
  if (!r.satirlar.length) {
    ilerlet(); // süzgeçten hiçbir şey geçmediyse de imleç ilerler (aynı olaylar tekrar taranmaz)
    return [];
  }
  const sid = (x) => (x ? String(x).slice(0, 8) : "?");
  const say = {};
  for (const e of r.satirlar) say[e.tip] = (say[e.tip] || 0) + 1;

  // ── ÇOK BİRİKMİŞSE: gövde yerine sayaç özeti (bağlam bütçesi kararı, İLANLI) ──
  if (r.satirlar.length + r.atlanan > 500) {
    ilerlet();
    return [
      `[orkestratör] Sahadan ${r.satirlar.length + r.atlanan} olay birikmiş — GÖVDE BASILMADI (tavan).`,
      `  ${Object.entries(say).map(([k, v]) => `${k}:${v}`).join(" · ")}`,
      `  Defteri kendin oku: ~/.claude/claims/<repo>/olay.jsonl (imleç ilerletildi).`,
    ];
  }

  const claimsiz = r.satirlar.filter((e) => e.tip === "claimsiz");
  const kalan = r.satirlar.filter((e) => e.tip !== "claimsiz");
  // Aynı (tip,key,oturum) üçlüsünü katla: yankı satır değil, çarpandır.
  const katli = new Map();
  for (const e of kalan) {
    const k = `${e.tip}|${e.key}|${e.engellenen || e.sahip}`;
    const v = katli.get(k);
    if (v) {
      v.n++;
      v.son = e;
    } else katli.set(k, { n: 1, son: e, ilk: e });
  }
  const ikon = { alindi: "🔒", birakildi: "✅", deny: "⛔", mesgul: "⛔", bekleyis: "⏳",
                 kapanis: "⏱", kapandi: "🔚", devir: "🔁", cevrim: "💀" };
  const tumu = [...katli.values()];
  const goster = tumu.slice(-satirTavan);
  const satirlar = [
    rolAd === "orkestrator"
      ? `[orkestratör] Sahadan ${r.satirlar.length} olay:`
      : `[rol:${rolAd}] Sahadan ${r.satirlar.length} ilerleme:`,
  ];
  for (const { n, son: e } of goster) {
    const t = Date.parse(e.ts || "");
    const ne = Number.isFinite(t) ? ` (${dk(t)})` : "";
    const carpan = n > 1 ? ` ×${n}` : "";
    const kimlik = e.engellenen ? sid(e.engellenen) : sid(e.sahip);
    const anahtar = e.key ? ` ${e.key}` : "";
    const niye = e.why ? ` — ${kis(e.why, 72)}` : "";
    if (e.tip === "alindi") satirlar.push(`  🔒 aldı: ${sid(e.sahip)}${anahtar}${ne}${niye}${carpan}`);
    else if (e.tip === "birakildi")
      satirlar.push(
        `  ✅ bitti:${anahtar} ← ${sid(e.sahip)}${ne}${niye}` +
          `${e.queueLen ? ` · ${e.queueLen} bekleyen vardı` : ""}${carpan}`
      );
    else if (e.tip === "deny" || e.tip === "mesgul")
      satirlar.push(
        `  ⛔ bloke: ${sid(e.engellenen)} →${anahtar}${ne} (sahip: ${sid(e.sahip)})${niye}${carpan}`
      );
    else if (e.tip === "bekleyis")
      satirlar.push(`  ⏳ bekliyor: ${sid(e.engellenen)} →${anahtar}${ne}${niye}${carpan}`);
    else if (e.tip === "kapanis")
      satirlar.push(
        `  ⏱ bekleyiş bitti: ${sid(e.engellenen)} →${anahtar} · ${e.sonuc || "?"}` +
          `${Number.isFinite(e.sure_ms) ? ` (${Math.round(e.sure_ms / 60000)} dk)` : ""}${ne}${carpan}`
      );
    else if (e.tip === "kapandi") satirlar.push(`  🔚 kapandı: ${kimlik}${ne}${niye}${carpan}`);
    else if (e.tip === "devir") satirlar.push(`  🔁 devir:${anahtar} ← ${kimlik}${ne}${niye}${carpan}`);
    else if (e.tip === "cevrim")
      satirlar.push(`  💀 DÖNGÜ:${anahtar} · ${kimlik}${ne}${niye}${carpan} — kimse çözmezse iki taraf da bekler`);
    else satirlar.push(`  • ${e.tip}:${anahtar} ${kimlik}${ne}${niye}${carpan}`);
  }
  if (tumu.length > goster.length)
    satirlar.push(`  … +${tumu.length - goster.length} olay GÖSTERİLMEDİ (tavan ${satirTavan}).`);
  if (claimsiz.length) {
    const oturum = new Set(claimsiz.map((e) => e.engellenen)).size;
    const yol = new Set(claimsiz.map((e) => e.key)).size;
    satirlar.push(`  ✍ ${claimsiz.length} claim'siz yazım · ${oturum} oturum · ${yol} yol (katlandı)`);
  }
  if (r.atlanan) satirlar.push(`  ⚠ ${r.atlanan} eski olay okuma tavanına takıldı (defterden okunabilir).`);
  /* ORKESTRATÖRÜN ELİ: haberi alan, ilgiliyi tek komutla devam ettirir. Komut ÖRNEĞİ
     gerçek bir kimlikle basılır — şablon değil, kopyalanabilir olsun. */
  const sonlar = [...katli.values()].map((v) => v.son).reverse();
  /* Örnek hedef seçiminde ÖNCELİK BLOKE OLANDadır: "devam et" denecek oturum, tıkanmış
     olandır — işini bitirmiş olan zaten devam ediyor. */
  const ornek =
    sonlar.find((e) => ["deny", "mesgul", "bekleyis", "cevrim"].includes(e.tip)) ||
    sonlar.find((e) => ["birakildi", "kapandi", "devir"].includes(e.tip));
  satirlar.push(
    `  ↳ devam ettir: node ~/.claude/skills/eszamanli/scripts/claim.mjs bildir --hedef ` +
      `${sid(ornek?.engellenen || ornek?.sahip)} --mesaj "<ne yapsın>"`
  );
  satirlar.push(
    rolAd === "orkestrator"
      ? `  (orkestratörsün: bu olaylar BİR KEZ düşer — gerekeni şimdi planına al.)`
      : `  ([${rolAd}] rolündesin: bu ilerleme satırları BİR KEZ düşer.)`
  );
  ilerlet();
  return satirlar;
}

/**
 * COMMIT KANALI ÇİZİMİ (otonomi-merdiveni:16) — farkındalığın ikinci bacağı: İŞ commit'leri
 * satır satır (en yeni 12), CHECKPOINT'ler TEK satıra katlanır (cp özeti KONUDAN parse edilir
 * — diff koşulmaz; "repo canlı" sinyali kaybolmasın diye gizlenmez, `claimsiz` katlaması
 * emsali). Yalnız ORKESTRATÖR rolüne basılır (bu aşamada — İLANLI; diğer roller ayrı karar).
 * İmleç basım SONRASI ilerletilir: yazılamazsa en fazla tekrar basılır, commit kaybolmaz.
 * Kanal SALT-OKUR; her hata yutulur — guard kararı commit kanalı yüzünden DEĞİŞMEZ.
 */
function commitBloku(root, me) {
  try {
    if (!me || typeof L.commitOku !== "function") return [];
    let ork = false;
    try {
      ork =
        (L.rolleriOf?.(root, me) || []).includes("orkestrator") ||
        L.orkestratorOku?.(root)?.sessionId === me;
    } catch {
      return [];
    }
    if (!ork) return [];
    const r = L.commitOku(root);
    if (!r.head) return []; // git yok/repo değil — sessiz (kanal bu ortamda tanımsız)
    if (!r.yeni.length && !r.atlanan) {
      // yeni commit yok — imleç zaten HEAD'de (ucuz yol); blok basılmaz.
      return [];
    }
    const isler = r.yeni.filter((c) => c.tur === "is");
    const cpler = r.yeni.filter((c) => c.tur !== "is"); // checkpoint + birlesme katlanır
    const satirlar = [`[orkestratör] Commit kanalı — ${r.yeni.length} yeni commit:`];
    if (r.kopuk) satirlar.push(`  ⚠ imleç kopuktu (rebase/gc) — zaman penceresiyle okundu; mükerrer olabilirler elendi.`);
    const ISTAVAN = 12;
    for (const c of isler.slice(-ISTAVAN)) {
      const t = Number.isFinite(c.ts) && c.ts > 0 ? ` (${dk(c.ts)})` : "";
      satirlar.push(`  ⚙ ${kis(c.konu, 88)} · ${c.sha.slice(0, 8)}${t}`);
    }
    if (isler.length > ISTAVAN) satirlar.push(`  … +${isler.length - ISTAVAN} İŞ commit'i GÖSTERİLMEDİ (tavan ${ISTAVAN}).`);
    if (cpler.length) {
      const oz = cpler.map((c) => L.cpOzet?.(c.konu) || { kapsamlar: [], dosya: null, art: null, eks: null });
      const kapsamSay = {};
      let art = 0, eks = 0, sayili = false;
      for (const o of oz) {
        for (const k of o.kapsamlar) kapsamSay[k] = (kapsamSay[k] || 0) + 1;
        if (o.art != null) { art += o.art; eks += o.eks || 0; sayili = true; }
      }
      const kapsamMetin = Object.entries(kapsamSay).map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(" ") || "?";
      satirlar.push(`  ⧗ ${cpler.length} checkpoint · kapsam: ${kapsamMetin}${sayili ? ` · +${art}/-${eks}` : ""}`);
    }
    if (r.atlanan) satirlar.push(`  ⚠ en az ${r.atlanan} commit daha birikmişti — GÖVDE KIRPILDI; git log'u kendin oku.`);
    // İmleç basım SONRASI ilerler (sahaBloku `ilerlet` deseni).
    try {
      const imlec = L.commitImlecOku?.(root);
      L.commitImlecYaz?.(root, { son: r.head, sonListe: imlec?.sonListe || [] });
    } catch {
      /* yut — en fazla tekrar basılır */
    }
    return satirlar;
  } catch {
    return [];
  }
}

/**
 * SESSİZ EZME YOK (P2): kilidi DEVREDİLMİŞ olan eski sahip, ilk yazımında ne olduğunu
 * OKUR. Devir bir silme değil bir sahip değişimidir; `ownerMatch` artık false döndüğü
 * için eski sahip normal DENY yerdi ve "benim kilidim nereye gitti" sorusu cevapsız
 * kalırdı — devir sessiz olursa bayatlık kademesi bir korumadan bir sürprize dönüşür.
 */
function devredildiBlok(repoRoot, me) {
  try {
    const d = L.devirOfSession(repoRoot, me?.sessionId)[0];
    if (!d) return null;
    const sebep =
      d.kaynak === "limit"
        ? `LİMİT DEVRİ${d.limit ? ` (${d.limit.sinif})` : ""} — oturumun askıdaydı`
        : d.kaynak === "bayat"
          ? "BAYATLIK KADEMESİ — yenileme durmuştu ve sırada bekleyen vardı"
          : "kendi devrin (devret)";
    return [
      `KİLİDİN DEVREDİLDİ: ${d.keys.join(", ")}  ·  sebep: ${sebep}`,
      `  Kilit SİLİNMEDİ, sahibi DEĞİŞTİ (${d.at}). İş kaybolmadı: devir işareti ${d.id}.`,
      `  Devam etmek istiyorsan yeniden claim'le ya da kuyruğa gir:`,
      `    node ~/.claude/skills/eszamanli/scripts/claim.mjs claim --res "${d.keys[0]}" --intent "<işin>"`,
      ``,
    ].join("\n");
  } catch {
    return null;
  }
}

/** Sahip LİMİTLİ mi? (07'nin yazdığı `session-status → limit` alanı) — bekleyen körlüğünü
 *  kapatan tek satır: "pid canlı ama iş yapamıyor" hâli metinde GÖRÜNÜR olmalı. */
function limitliSatir(sessionId) {
  const lim = L.sessionInfo(sessionId)?.limit || null;
  if (!L.usageHalt(lim)) return null;
  const reset = Number.isFinite(lim.resetTs)
    ? new Date(lim.resetTs).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
    : null;
  return `  ⚠ sahip LİMİTLİ (${lim.sinif}${reset ? `, reset ~${reset}` : ", reset penceresi yok"}) — kilidi birazdan devredilecek; beklemen kısa sürebilir.`;
}

/** DENY mesajı = ÇALIŞTIRILABİLİR TALİMAT. Ölçüt: karşıdaki model bunu okuyup
 *  doğru davranabilmeli — işi ayırsın, beklesin, sonra devam etsin. */
function denyText(claim, repoRoot, cyc, me) {
  const o = claim.owner || {};
  const s = L.sessionInfo(o.sessionId); // KOPYA değil, okuma anında çözümlenir (Ders 4)
  /* `state` HAM basılmaz (lines[] ile aynı gerekçe): "durum: idle" okuyanı "sahip boşta,
     kilidi bırakmış sayılır" hükmüne davet eder — oysa `idle` yalnız son mesajdan beri
     geçen süredir. Sahibin işi zaten AŞAĞIDA `niyet:` satırında ÖLÇÜLÜ duruyor; burada
     yalnız nabız olgusu basılır (kademe satırı da bayatlığı ayrıca söyler). */
  const who = s
    ? `"${s.title || "(başlıksız)"}" (etiket) — ${s.dirName}, son nabız ${dk(s.updated)}${s.state === "generating" ? ", ŞU AN üretiyor" : ""}`
    : `session ${String(o.sessionId).slice(0, 8)}`;
  const devredildi = devredildiBlok(repoRoot, me);
  /* ÇEVRİM: beklemeye devam edersen DEADLOCK. Kuyruğa yazılmak çözmez → sıra SENDE.
     (Ölçüt CLI ile TEK kaynaktan: L.waitCycle — iki implementasyon drift üretir.) */
  if (cyc) {
    return [
      ...(devredildi ? [devredildi] : []),
      `ÇAKIŞMA KİLİDİ + DÖNGÜ (deadlock): "${claim.resource.key}" başkasında VE o seni bekliyor.`,
      `  sahip: ${who}`,
      `  bekleme zinciri: ${cyc.chain.join(" → ")} → (sen)`,
      ``,
      `BEKLEME İŞE YARAMAZ — iki taraf da canlı, kimse bırakmaz. SIRAYI ÇEVİR:`,
      ...cyc.release.map(
        (k) => `  node ~/.claude/skills/eszamanli/scripts/claim.mjs release --res "${k}"   # tuttuğun`
      ),
      `  node ~/.claude/skills/eszamanli/scripts/claim.mjs wait --res "${claim.resource.key}"`,
      `  # sıra sana gelince hedefi al, işini bitir, sonra bıraktıklarını geri claim'le`,
    ].join("\n");
  }
  const limitli = limitliSatir(o.sessionId);
  /* KADEME DENY METNİNDE (otonomi-merdiveni:06.5). `gradeClaim` vardı ama hiçbir DENY
     onu SÖYLEMİYORDU: reddedilen taraf "ne kadar beklerim, devir hakkım var mı" sorusunu
     yanıtlayamıyordu. `BAYAT` kademesi bugüne dek KODDA HİÇ KULLANILMAMIŞTI (SKILL.md
     "BAYAT → DENY" diyordu, karşılığı yoktu) — ilk tüketicisi bu satırdır.
     Kademe İCAT EDİLMEZ, tek kaynaktan (`L.gradeClaim`) okunur; ölçülemezse satır BASILMAZ
     (sessiz "TAZE" iddiası, olmayan bir güvence vermek olurdu). */
  const kademeSatiri = (() => {
    let g;
    try { g = L.gradeClaim(claim); } catch { return null; }
    if (g === "DEVREDILEBILIR")
      return `  kademe: DEVREDİLEBİLİR — sahip uzun süredir sessiz. \`wait\` KOŞARSAN devri sen alırsın (pasif işaret devri TETİKLEMEZ).`;
    if (g === "BAYAT")
      return `  kademe: BAYAT — sahip sessiz ama devir eşiğinin altında; \`wait\` kur, eşiği geçince devir KENDİLİĞİNDEN gelir.`;
    if (g === "TAZE")
      return `  kademe: TAZE — sahip çalışıyor; bekleme uzarsa sebebi bayatlık DEĞİLDİR (kırık koşum olabilir: aide kirik).`;
    return null;
  })();
  return [
    ...(devredildi ? [devredildi] : []),
    `ÇAKIŞMA KİLİDİ: "${claim.resource.key}" şu an BAŞKA bir Claude session'ında.`,
    `  sahip: ${who}`,
    ...(kademeSatiri ? [kademeSatiri] : []),
    ...(limitli ? [limitli] : []),
    `  niyet: ${claim.intent || "(belirtilmemiş)"}`,
    ``,
    `BEKLEME — İŞİ AYIR (protokol: /eszamanli):`,
    `1. Bu kaynağa dokunan todo maddesini TodoWrite ile`,
    `   "beklemede — ${claim.resource.key} (sahip session bitince)" olarak işaretle.`,
    `2. Bu kaynağa dokunmayan DİĞER işlerle devam et — durma.`,
    `3. Kaynak boşalınca uyanmak için (kuyruğa yazıldın, sıra sana gelince çıkar):`,
    `   Bash(run_in_background: true):`,
    `   node ~/.claude/skills/eszamanli/scripts/claim.mjs wait --res "${claim.resource.key}"`,
    `   Komut ÇIKINCA kaynağı claim'leyip beklemedeki maddeyi bitir.`,
    `4. Durumu görmek için: node ~/.claude/skills/eszamanli/scripts/claim.mjs status`,
    ``,
    `Sıraya İŞARET bırakıldı: sahip bırakırken sana BİLDİRİ düşer, ilk turunda okursun.`,
    `  Ama bildiri bir POSTA KUTUSUDUR, ZİL DEĞİL — durmuş bir oturumu uyandırmaz.`,
    `  İş BU oturumda bitecekse (3) şart: uyandıran tek şey senin kendi \`wait\` sürecindir.`,
    `Ve SEN de bir kilit tutuyorsan: işin bitince BIRAK — bırakma, sıradakine haberi gönderir.`,
    ``,
    `Kilit dosyasını ELLE SİLME: sahip crash ederse otomatik biçilir (pid ölçütü).`,
  ].join("\n");
}

/**
 * Kuyruğa İŞARET bırak ("bu kaynağı istedim, kapıda döndüm").
 *
 * İşaret SIRA TUTMAZ — sırayı yalnız canlı bir `wait` süreci tutar (claims-lib: kuyruk).
 * Gerekçe: model burada DENY yiyip başka işe geçebilir; bunu "bekliyor" saymak sahte
 * deadlock üretir. İşaret yalnızca sahibin `status`ta göreceği bir talep sinyalidir.
 * Karar akışını asla riske atmaz (yazım hatası DENY'yi bozmaz).
 */
function markWanted(repoRoot, claim, me, intent) {
  try {
    /* ORKESTRATÖRE "bloke" HABERİ — ama YALNIZ İLK KEZ. Kapı aynı çift (oturum × kaynak)
       için turda turda DENY verir; her DENY'i haber saysaydık koordinatörün kutusu tek bir
       tıkanıklığın yankısıyla dolardı. Yenilik ölçütü kuyruğun KENDİSİdir: kayıt zaten
       varsa bu yeni bir tıkanıklık değil, sürenin uzamasıdır. */
    const oncekiler = L.queueOf(repoRoot, claim.resource.key);
    const yeni = !oncekiler.some((w) => w.sessionId === me.sessionId);
    L.enqueue(repoRoot, claim.resource.key, {
      sessionId: me.sessionId,
      since: new Date().toISOString(),
      intent: intent || null,
      pid: null, // işaret: aktif bekleyiş DEĞİL
    });
    /* ZİNCİRİN GERİ YÖNÜ: kilidi TUTANA "seni bekleyen doğdu" haberi. Orkestratöre AYRICA
       yazılmaz — blokaj zaten `olayDeny` ile deftere düşüyor ve besleme defterin
       projeksiyonudur (iki yoldan raporlamak aynı olayı iki kez gösterirdi). */
    if (yeni) L.bildirSahibe?.(repoRoot, claim, { sessionId: me.sessionId, intent });
  } catch {
    /* yut */
  }
}

/**
 * DENY'i DEFTERE yaz (aşama 05) — bekleme ölçülebilir olsun.
 *
 * `markWanted`in bıraktığı işaret 30 dk sonra silinir; "X kaç kez Y yüzünden bloke oldu"
 * sorusu ondan TÜRETİLEMİYORDU. Bu satır kalıcıdır ve kademeyi (`grade`) OLAY ANINDA taşır.
 *
 * 05.4 — KAPI BLOKLANMAZ: çağrı optional (`?.`) ve try/catch içinde. Eski bir claims-lib ile
 * koşulursa (fonksiyon yok) `undefined` çağrısı sessizce geçer; ATILAN her hata burada yutulur.
 * Bu kritiktir: hata dışarı sızsaydı main()'in dış catch'i PASS'e düşer ve DENY KAYBOLURDU
 * (kapı gevşerdi — telafisi olmayan yön).
 */
function olayDeny(repoRoot, claim, me, why) {
  try {
    L.olayBlok?.(repoRoot, {
      tip: "deny",
      claim,
      engellenen: me?.sessionId || null,
      why,
    });
  } catch {
    /* yut — defter kararı ASLA değiştirmez */
  }
}

function meOf(payload) {
  const sid =
    payload.session_id || payload.sessionId || process.env.CLAUDE_CODE_SESSION_ID || null;
  // Kimlik tek kaynaktan: session-status kaydı (yoksa claude ata-pid'i → subagent köprüsü).
  return L.identityOf(sid);
}

function main() {
  const p = readStdin();

  if (mode === "release_all") {
    const sid = p.session_id || p.sessionId;
    if (!sid || !L.ledgerExists()) return pass();
    const root = L.repoRootOf(p.cwd || process.cwd());
    let kapananKilit = 0;
    for (const c of L.activeClaims(root)) {
      if (c.owner?.sessionId !== sid) continue;
      L.archiveClaim(root, c, "session bitti (SessionEnd)");
      kapananKilit++;
      // DEFTERE: bu kilit bırakıldı (orkestratör beslemesi defterin projeksiyonudur).
      try {
        L.yazOlay?.(root, {
          tip: "birakildi",
          key: c.resource.key,
          sahip: sid,
          why: "session bitti (SessionEnd)",
        });
      } catch {
        /* yut */
      }
      /* BİLDİRİ (2026-08-09): kapanan oturum da "işini bitiren"dir — sırada uyanma yolu
         OLMAYAN bekleyen varsa haberi burada bırakır. `release`i unutup kapanan oturum
         en sık hâldir; haber vermeyi yalnız açık `release`e bağlamak kuralı delerdi. */
      try {
        L.bildirSiradakine?.(root, c.resource.key, { sessionId: sid, neden: "SessionEnd" });
      } catch {
        /* yut — haber, kapanışı asla bozmaz */
      }
    }
    /* Sıradan da çık: biten bir session'ın kuyrukta yer tutması sırayı yalanlar.
       Kapanış KAYDI burada doğar (aşama 05): bekleyişin süresi `since` silinmeden ölçülür,
       `sonuc:"oldu"` = bekleyen öldü (session bitti), kilidi hiç alamadı. Bu, "kaç bekleyiş
       boşa gitti" sorusunun tek kaynağıdır. Eski claims-lib'e karşı güvenli: yoksa düz
       `dequeue`'ya düşülür — sıradan çıkış hiçbir yolda atlanmaz. */
    /* ÜSTLENİLEN ROLLER bu oturumla ölür (canlılık zaten pid'le ölçülüyor; kaydı burada
       düşürmek defteri temiz tutar ve "ölü koordinatör/altyapı" görüntüsünü hiç doğurmaz).
       Tek tek değil TOPLUCA: bir oturum birden çok rol üstlenmiş olabilir. */
    try {
      for (const ad of L.rolleriOf?.(root, sid) || []) L.rolBirak?.(root, ad, sid);
      L.orkestratorBirak?.(root, sid); // eski yol da temizlensin (geriye uyum)
    } catch {
      /* yut */
    }
    const bekledigi = L.queuedKeysOf(root, sid);
    /* ORKESTRATÖRE "kapandı": bir oturumun ölümü sahanın en sessiz olayıdır — kilidini
       bıraktı mı, yarım bir bekleyişi mi vardı, orkestratör bunu başka hiçbir yerden
       öğrenemez. Kendi kaydı düşerken kendine yazmaz (kütüphane eler). */
    try {
      if (kapananKilit || bekledigi.length)
        L.yazOlay?.(root, {
          tip: "kapandi",
          key: null,
          engellenen: sid,
          why: `${kapananKilit} kilit bırakıldı · ${bekledigi.length} bekleyiş yarım kaldı`,
        });
    } catch {
      /* yut */
    }
    for (const k of bekledigi) {
      try {
        if (typeof L.dequeueKapanis === "function")
          L.dequeueKapanis(root, k, sid, "oldu", "session bitti (SessionEnd)");
        else L.dequeue(root, k, sid);
      } catch {
        try {
          L.dequeue(root, k, sid);
        } catch {
          /* yut */
        }
      }
    }
    /* SÜPÜRME: kendi kaydını temizlemek yetmez — CANLI ama yoluna gitmiş session'ların
       süresi dolmuş İŞARETleri kimsenin temizlemediği için defterde birikiyordu (gc'yi
       çağıran hiçbir otomatik yol YOKTU; ölçüldü 2026-07-27). SessionEnd doğal süpürme
       noktasıdır: deterministik, async, 0 token. Hata yutulur — kapı ürünü kilitlemez. */
    try {
      L.gcQueues(root);
    } catch {
      /* yut */
    }
    /* TÜM-KÖK SÜPÜRMESİ (2026-07-29): tembel biçme yalnız okunan kökte işler; kimsenin
       bakmadığı kökteki ölü kilit biri bakana dek duruyordu (ölçüldü: 2 ölü kilit 2 gün).
       SessionEnd'de tüm kökler gezilir — deterministik, ps-ölçülemezse hiçbir şey biçmez. */
    try {
      L.sweepAllLedgers();
    } catch {
      /* yut */
    }
    return pass();
  }

  /* ── LİMİT DEVRİ (Stop) — nabız-tetikli deterministik ağ ────────────────────────
     07 limit-hit'i `session-status/<sid>.json → limit` alanına yazar (aynı olayda: Stop).
     Bu dal onu okur ve YALNIZ KENDİ kilitlerini devreder — üçüncü bir tarafın "limitli
     görünüyor" diye başkasının kilidini biçmesi YOKTUR. Çıktısızdır (Stop'u konuşturmak
     turu etkiler); hüküm defterde görünür. */
  if (mode === "limit_devir") {
    const sid = p.session_id || p.sessionId;
    if (!sid || !L.ledgerExists()) return pass();
    if (!L.sessionHalted(sid)) return pass(); // askıda değil → hiçbir şey yapma
    try {
      L.limitDevri(L.repoRootOf(p.cwd || process.cwd()), L.identityOf(sid));
    } catch {
      /* yut — kapı ürünü asla kilitlemez */
    }
    return pass();
  }

  /* ── YÖNETİM TABLOSU (Stop) — AIDE S ortak temeli (yonetim-katmani/v2:03) ───────
     Tablo, durumun MODDAN bağımsız yaşadığı yerdir (T-İLKE): `aide l` ve `aide x` aynı
     dosyayı okur-yazar. Bu dal onu her tur sonunda TAZELER ki uzaktan bakan (aide kurulu
     olmayan) bir okur güncel resmi görsün.

     ÜÇ SERT KURAL:
     - DEBOUNCE: `yaz()` girdi damgasını diskten okur; damga eşse HİÇBİR ŞEY yazmaz (0 maliyet).
     - HATA YUTULUR: tablo yazımı hedef işi ASLA bozmaz — tur her hâlükârda geçer.
     - ÇIKTISIZ: Stop'u konuşturmak turu etkiler; sonuç dosyada görünür, ekranda değil. */
  if (mode === "tablo") {
    try {
      const repo = L.repoRootOf(p.cwd || process.cwd());
      // TAŞIYICI SEÇİMİ (ölçülmüş): motoru `node` ile import ETMEK ÇALIŞMAZ — Node'un TS
      // desteği yalnız type-stripping'dir ve çekirdek zincirdeki `yazar-kilidi.ts`
      // constructor parameter property kullanır (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
      // Yazımı `aide` CLI'sı yapar (bun ile koşar). Motor ya da aide yoksa (legacy proje)
      // SESSİZCE geçilir — T5 adaptörü o durumu ayrıca ele alır.
      if (existsSync(`${repo}/packages/core/src/yonetim-tablo.ts`)) {
        spawnSync("aide", ["yonetim", "yaz", "--proje", repo], { timeout: 15000, stdio: "ignore" });
      }
    } catch {
      /* yut — kapı ürünü asla kilitlemez */
    }
    return pass();
  }

  /* ── GİDEN MESAJ (PostToolUse) — trafiğin İNSAN ucu ────────────────────────────
     Alma ucu `ctx` dalındaki `bildiriBloku.ozet`tir; bu dal onun eşi. İkisi de aynı şeyi
     yapar: zaten olan bir işi kullanıcıya da gösterir. Yeni bir mekanizma değil, mevcut
     çıktının ikinci muhatabı (kullanıcı kararı 2026-08-10).

     KANIT tool ÇIKTISIDIR, komut metni DEĞİL: `bildir` çözülemeyen rolde exit 5 ile durur —
     komuta bakıp "gönderildi" basmak, gönderilmemiş mesajı gönderilmiş göstermek olurdu. */
  if (mode === "giden") {
    const tool = String(p.tool_name || "");
    const ti = p.tool_input || {};
    const tr = p.tool_response;
    if (tr && typeof tr === "object" && (tr.is_error === true || tr.isError === true)) return pass();
    const satirlar = [];
    if (tool === "SendMessage") {
      // Alma ucu bir SUBAGENT'tır (printi kullanıcıya ulaşmaz) → gönderim burada basılır.
      satirlar.push(`📤 MESAJ GÖNDERİLDİ → ajan ${kis(ti.to || ti.agent_id || "?", 24)}: ${kis(ti.summary || ti.message, 140)}`);
    } else if (tool.endsWith("send_message")) {
      satirlar.push(`📤 MESAJ GÖNDERİLDİ → oturum ${String(ti.session_id || "?").slice(0, 8)}: ${kis(ti.message, 140)}`);
    } else if (tool === "Bash") {
      const govde = typeof tr === "string" ? tr : [tr?.stdout, tr?.stderr].filter((x) => typeof x === "string").join("\n");
      for (const raw of String(govde).split("\n")) {
        const l = raw.trim();
        if (!l.includes("BİLDİRİ GÖNDERİLDİ")) continue; // `bildir` ⊕ `release`in otomatik haberi
        satirlar.push(`📤 ${kis(l, 180)}`);
        if (satirlar.length >= 4) break; // tavan: tek turdaki mesaj seli satır seline dönmesin
      }
    }
    if (!satirlar.length) return pass();
    return out({ systemMessage: satirlar.join("\n") });
  }

  if (mode === "ctx") {
    // Farkındalık: bu repoda BAŞKA CANLI session varsa modele protokolü hatırlat.
    // Kapı zaten sert olduğu için bu katman unutulsa da çakışma imkânsızdır.
    const root = L.repoRootOf(p.cwd || process.cwd());
    const me = p.session_id || p.sessionId;
    const olay = p.hook_event_name || "UserPromptSubmit";

    /* ── T3 YEDEĞİ: kendi limit devri ────────────────────────────────────────────
       Stop kaydı (limit_devir) gecikirse ya da hiç ateşlenmezse pencere burada kapanır.
       Maliyet: askıda DEĞİLKEN tek dosya okuması (`sessionHalted`) — defter hiç açılmaz. */
    if (me && L.ledgerExists()) {
      try {
        if (L.sessionHalted(me)) L.limitDevri(root, L.identityOf(me));
      } catch {
        /* yut */
      }
    }

    /* ── T5: SESSION-YERLEŞİK ENKAZ SÜPÜRMESİ (yalnız SessionStart) ──────────────
       boot-katmani v2'den ABSORBE edilen tek bacak. SessionEnd tarafı zaten vardı
       (release_all → gcQueues + sweepAllLedgers); eksik olan uç AÇILIŞtı: en son
       oturum crash ettiyse SessionEnd hiç koşmaz ve enkaz (ölü sahipli kilit + bayat
       kuyruk kaydı) bir sonraki oturumu bekletir. Süpürme others ERKEN DÖNÜŞÜNDEN
       ÖNCEdir: enkaz, başka canlı session olmasa da temizlenmeli.
       İLANLI MUAFİYET: UserPromptSubmit yolunda süpürme YOK — her turda dizin gezmek
       hook bütçesini yakar ve açılışta yapılan iş turda tekrar edilmez. */
    let devirSatir = null;
    if (olay === "SessionStart" && L.ledgerExists()) {
      try {
        L.activeClaims(root); // tembel biçme: ölü sahipli kilitler burada arşive gider
        L.gcQueues(root); // bayat kuyruk/işaret kayıtları diskten düşer
        const bekleyen = L.listDevir(root);
        if (bekleyen.length) {
          const benim = bekleyen.filter((d) => d?.devreden?.sessionId === me).length;
          devirSatir =
            `Devralınmayı bekleyen devir işareti: ${bekleyen.length}` +
            (benim ? ` (${benim} tanesi SENDEN devredildi)` : "") +
            ` — gör: node ~/.claude/skills/eszamanli/scripts/claim.mjs devir list`;
        }
      } catch {
        /* yut */
      }
    }

    /* BİLDİRİ EN ÖNDE: "sıra sende" haberi, başka canlı session olup olmamasından
       BAĞIMSIZ olarak sahibine ulaşmalı — bırakan oturum çoktan kapanmış olabilir. */
    const bildiri = bildiriBloku(root, me);
    /* Saha beslemesi AYRI hesaplanır: posta kutusu bu oturuma ÖZEL haberleri, besleme ise
       koordinatörün gözünü taşır. Kişisel olan önce basılır — "sıra sana geldi" bilgisinin
       muhatabı sensin; saha bloğu ondan sonra gelir. */
    const defter = defterBloku(root, me);
    const saha = sahaBloku(root, me);
    /* Commit kanalı — sahanın İKİNCİ kaynağı (git geçmişi); yalnız orkestratöre basılır.
       İki blok ayrı imleçlidir, tavanları bağımsızdır (MASTER Karar bekleyenler #6). */
    const commitler = commitBloku(root, me);

    /* ORKESTRATÖR GÖRÜNÜRLÜĞÜ: sahada bir koordinatör varsa herkes BİLİR — çünkü bu
       oturumun bloke olması/işini bitirmesi ona otomatik haber düşürüyor. Görünmez bir
       gözlemci, sözleşmesi ilan edilmemiş bir gözlemcidir. Kendine bunu yazmaz. */
    let orkSatir = null;
    try {
      const roller = (L.rolListe?.(root) || []).filter((r) => r.sahip && r.sahip.sessionId !== me);
      if (roller.length) {
        const ork = roller.find((r) => r.ad === "orkestrator");
        orkSatir =
          `Bu repoda ROL SAHİBİ oturumlar: ` +
          roller
            .map((r) => `${r.ad}=${String(r.sahip.sessionId).slice(0, 8)}`)
            .join(" · ") +
          (ork ? ` — işini bitirmen/bloke olman orkestratöre OTOMATİK bildirilir (ayrıca rapor yazma).` : "") +
          `\n  Birine seslenmek için: node ~/.claude/skills/eszamanli/scripts/claim.mjs bildir --rol <ad> --mesaj "…"`;
      }
    } catch {
      /* yut */
    }

    const others = L.liveSessionsIn(root).filter((s) => s.sessionId !== me);
    /* Sarkık devir işareti TEK BAŞINA da haber değeridir (iş kaybolmasın); başka canlı
       session yoksa blok yalnız o satırı taşır. Üçü de yoksa TEK BAYT basılmaz. */
    if (!others.length) {
      if (!devirSatir && !bildiri.satirlar.length && !defter.satirlar.length && !saha.length && !commitler.length && !orkSatir) return pass();
      return out({
        ...(bildiri.ozet.length || defter.ozet.length
          ? { systemMessage: [...bildiri.ozet, ...defter.ozet].join("\n") }
          : {}),
        hookSpecificOutput: {
          hookEventName: olay,
          additionalContext: [
            ...bildiri.satirlar,
            ...defter.satirlar,
            ...saha,
            ...commitler,
            ...(orkSatir ? [`[eşzamanlılık] ${orkSatir}`] : []),
            ...(devirSatir ? [`[eşzamanlılık] ${devirSatir}`] : []),
          ].join("\n"),
        },
      });
    }
    const held = L.ledgerExists() ? L.activeClaims(root) : [];
    /* HER SATIR "ne yapıyor" TAŞIR (2026-08-10 kullanıcı kararı — gerekçe: claims-lib
       `neYapiyor` başlığı). Üç sert kural bu satırda MEKANİK olarak uygulanır:
         · başlık yalnız ETİKET sütununda durur — iş oradan okunmaz (doğduğunda donar);
         · `state` kelimesi BASILMAZ. "idle" bir hüküm sanılıp "boşta" diye raporlandı;
           yerine ölçülen süre (`son mesaj N dk`) ve yalnız `generating` için "ŞU AN
           üretiyor" yazılır — biri olgu, öteki yoktur;
         · ölçülemeyene "boşta" DEĞİL `ölçülemedi` yazılır.
       Böylece hata yapısal olarak önlenir: satır, doldurulmamış sütunla basılamaz. */
    const lines = others.slice(0, 6).map((s) => {
      const n = L.neYapiyor(root, s.sessionId, { claims: held });
      const kilit = n.kilit?.length ? `  [kilit: ${kis(n.kilit.join(" · "), 44)}]` : "";
      const ne = n.olculdu ? `${kis(n.metin, 92)}${kilit}` : "ölçülemedi (kilit yok · defterde iz yok)";
      return (
        `  • ${String(s.sessionId).slice(0, 8)} · ${s.dirName} · son mesaj ${dk(s.updated)}` +
        `${s.state === "generating" ? " · ŞU AN üretiyor" : ""} · etiket: "${kis(s.title, 44) || "(başlıksız)"}"\n` +
        `      ne yapıyor: ${ne}`
      );
    });
    const heldLines = held.map((c) => {
      /* Sahibe SIRAYI göster: kaç kişi gerçekten bekliyor (canlı wait) + kaç kişi istedi.
         "broad" bir claim'i tutarken kuyruk büyüyorsa yol vermek SENİN kararın —
         kapı bunu zorlamaz, ama görmediğin şeye karar veremezsin. */
      const q = L.queueOf(root, c.resource.key);
      const act = q.filter(L.waiterActive).length;
      const mark = q.length - act;
      const kuyruk = act || mark ? ` — ${act ? `${act} bekliyor` : ""}${act && mark ? ", " : ""}${mark ? `${mark} istedi` : ""}` : "";
      /* BEKLEYENE SAHİBİ GÖSTER (kullanıcı kararı 2026-07-27): "a5b49bff" bir kimlik değil,
         bir hash'tir. Kimi beklediğini bilmeyen, "daha ne kadar sürer / gidip bakayım mı /
         işimi bölüp devam mı edeyim" sorusunu ölçemez — bekleyiş körleşir. Bu yüzden sahip
         kimliği (başlık + o an ne yaptığı) SIRADAYKEN satıra iner; sıra dışındayken
         inmez (her turda enjekte edilen blok, ilgisiz oturumların günlüğü değildir). */
      const ben = q.find((w) => w.sessionId === me);
      const sira = ben ? q.filter(L.waiterActive).findIndex((w) => w.sessionId === me) : -1;
      const bana = !ben
        ? ""
        : L.waiterActive(ben)
          ? ` ← SEN ${sira + 1}. sıradasın`
          : " ← SEN istedin (sıra TUTMUYOR — wait kur)";
      const satir = `  • ${c.resource.key} ← ${String(c.owner?.sessionId).slice(0, 8)}${c.breadth === "broad" ? " [broad]" : ""}${kuyruk}${bana}`;
      if (!ben) return satir;
      const s = L.sessionInfo(c.owner?.sessionId);
      const lim = limitliSatir(c.owner?.sessionId);
      return [
        satir,
        /* `state` burada da ham basılmaz (yukarıdaki lines[] ile aynı gerekçe): "idle"
           kelimesi sahibi "boşta" sanmaya davettir — sahip kilidi TUTUYOR, boşta değil. */
        `      sahip etiketi: "${kis(s?.title, 56) || "(başlıksız)"}"${s?.updated ? ` · son mesaj ${dk(s.updated)}` : ""}${s?.state === "generating" ? " · ŞU AN üretiyor" : ""}`,
        ...(lim ? [`    ${lim.trim()}`] : []),
        `      sahip ne yapıyor: ${kis(c.intent, 96) || "(niyet belirtilmemiş)"}`,
      ].join("\n");
    });
    return out({
      ...(bildiri.ozet.length ? { systemMessage: bildiri.ozet.join("\n") } : {}),
      hookSpecificOutput: {
        hookEventName: olay,
        additionalContext: [
          ...bildiri.satirlar,
          ...saha,
          ...commitler,
          `[eşzamanlılık] Bu repoda ${others.length} BAŞKA canlı Claude session'ı var — HEPSİ ÇALIŞIYOR sayılır;` +
            ` "ne yapıyor" ÖLÇÜMDÜR, etiketten okunmaz. Rapora "boşta" yazma: ölçülemeyene "ölçülemedi" yaz.`,
          ...lines,
          heldLines.length ? `Tutulan kilitler:` : `Tutulan kilit yok.`,
          ...heldLines,
          ...(orkSatir ? [orkSatir] : []),
          ...(devirSatir ? [devirSatir] : []),
          `Protokol: yıkıcı/uzun bir yazımdan ÖNCE kaynağı claim'le, bitince bırak.`,
          `  node ~/.claude/skills/eszamanli/scripts/claim.mjs claim --res <kaynak> --intent "..."`,
          `Ayrıntı ve karar rehberi: /eszamanli skill'i. Başkasının kilidine yazım kapıda REDDEDİLİR.`,
        ].join("\n"),
      },
    });
  }

  // ── hızlı yol: defter yoksa hiçbir şey yapma (tek stat) ──
  if (!L.ledgerExists()) return pass();

  const root = L.repoRootOf(p.cwd || process.cwd());
  const claims = L.activeClaims(root);
  if (!claims.length) return pass();

  const resMap = L.loadResourceMap(root);
  const me = meOf(p);
  const ti = p.tool_input || {};

  /* ── P1: KALP ATIŞI ─────────────────────────────────────────────────────────
     `ownerMatch` dalı "sahip tuttuğu kaynağa ŞU AN dokunuyor"un TEK ve TAM kanıtıdır;
     bugüne dek geçip ATIYORDU. Geçmeden önce dokun: claim'in `renewedAt`i 60 sn'den
     eskiyse tazele. Bu, P2'nin "yenileme durmuş" hükmünü ölçülebilir kılan tek şeydir
     (alan aksi halde ölüdür: 1 yazar, 0 okuyucu). Yazım DİRİLTMEZ — `touchClaim`
     ino-önce/sonra kıyaslı `updateClaimIfUnchanged`i kullanır: sahip tam o an release
     ederse yazım İPTAL olur (hayalet kilit doğmaz). Hata YUTULUR: dokunuş başarısız
     diye kapı karar değiştirmez. */
  const kalpAt = (c) => {
    try {
      L.touchClaim(root, c);
    } catch {
      /* yut */
    }
  };

  if (mode === "bash") {
    const cmd = String(ti.command || "");
    if (!cmd) return pass();
    for (const c of claims) {
      if (L.ownerMatch(c, me)) {
        kalpAt(c);
        continue;
      }
      if (L.claimCoversBash(c, cmd, resMap, root, p.cwd)) {
        const cyc = L.waitCycle(root, claims, me.sessionId, c.resource.key);
        if (!cyc) markWanted(root, c, me, "bash: " + cmd.slice(0, 80)); // çevrimde kuyruk yalan olur
        olayDeny(root, c, me, cyc ? "bash yazımı · DÖNGÜ (deadlock)" : "bash yazımı");
        return deny(denyText(c, root, cyc, me));
      }
    }
    return pass();
  }

  // write modu: Edit | Write | NotebookEdit
  const fp = ti.file_path || ti.notebook_path;
  if (!fp) return pass();
  let kendiClaimim = false;
  for (const c of claims) {
    if (L.ownerMatch(c, me)) {
      kalpAt(c); // kendi claim'in → tazele, geç
      if (L.claimCoversPath(c, fp, root, resMap)) kendiClaimim = true;
      continue;
    }
    if (L.claimCoversPath(c, fp, root, resMap)) {
      const cyc = L.waitCycle(root, claims, me.sessionId, c.resource.key);
      if (!cyc) markWanted(root, c, me, null);
      olayDeny(root, c, me, cyc ? "dosya yazımı · DÖNGÜ (deadlock)" : "dosya yazımı");
      return deny(denyText(c, root, cyc, me));
    }
  }
  // MÜKERRER EMEK ÖLÇÜMÜ — kapı DEĞİL, defter. Buraya düşen yazım GEÇER; tek yaptığımız
  // "bu oturum bu dosyaya claim ALMADAN dokundu" olgusunu bir kez kaydetmek. İki farklı
  // oturum aynı yola claim'siz dokunduysa mükerrer emek RİSKİ vardır ve bugüne dek bu
  // hiçbir yerde görünmüyordu (ölçülen kayıp: aynı zombi yaması iki kez yazıldı, biri
  // merge'de çöpe gitti). Rapor: `claim.mjs mukerrer`.
  if (!kendiClaimim) {
    try {
      L.olayClaimsiz?.(root, me?.sessionId, fp); // yol normalizasyonu kütüphanede
    } catch {
      /* yut — ölçü ASLA yazımı etkilemez */
    }
  }
  return pass();
}

try {
  main();
} catch {
  pass(); // kapı ürünü asla kilitlemez
}
