#!/usr/bin/env node
/**
 * claim-guard — eşzamanlı session çakışma KAPISI (PreToolUse) + farkındalık enjeksiyonu.
 *
 * Kullanım (settings.json):
 *   node ~/.claude/hooks/claim-guard.mjs write     # PreToolUse, matcher "Edit|Write|NotebookEdit"
 *   node ~/.claude/hooks/claim-guard.mjs bash      # PreToolUse, matcher "Bash"
 *   node ~/.claude/hooks/claim-guard.mjs ctx       # SessionStart | UserPromptSubmit  (sync!)
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

import { readFileSync } from "node:fs";
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
 * BİLDİRİ OKUMA UCU (seviye 0, 2026-08-09) — "beklediğin kaynak boşaldı" haberi.
 *
 * Yazan uç `release` / SessionEnd (`claims-lib: bildirSiradakine`); burası OKUYAN uçtur ve
 * TÜKETİCİdir: haber bir kez basılır, dosya silinir. Blok `others` erken dönüşünden ÖNCE
 * hesaplanır — haber, repoda başka canlı session kalmasa da (bırakan çoktan kapanmış
 * olabilir!) sahibine ulaşmalıdır.
 *
 * Haber BAYAT OLABİLİR ve bunu SÖYLER: bırakma ile bu turun arasında kaynağı başkası
 * kapmış olabilir. O yüzden satır, defteri OKUMA ANINDA ölçer ve iki farklı çare basar
 * (al · yeniden bekle). Ölçülemeyen hiçbir şey iddia edilmez.
 */
function bildiriBloku(root, me) {
  if (!me || !L.ledgerExists() || typeof L.bildiriOku !== "function") return [];
  let gelen = [];
  try {
    gelen = L.bildiriOku(root, me);
  } catch {
    return [];
  }
  if (!gelen.length) return [];
  /* İKİ CİNS HABER, İKİ AYRI SORU (2026-08-09): "sıra" haberi BANA ne düştüğünü söyler
     (bekleyendim, kaynak boşaldı); SAHA haberleri orkestratöre başkalarının işini söyler
     (bitti · bloke · kapandı · devir). Aynı kutuya düşerler, ama tek blokta karıştırılırsa
     ikisi de okunmaz olur. Eski kayıtlarda `tip` yoktur → "sira" sayılır (geriye uyum). */
  const saha = gelen.filter((b) => b?.tip && b.tip !== "sira");
  const sira = gelen.filter((b) => !b?.tip || b.tip === "sira");
  // Aynı kaynak birden çok kez bırakılmış olabilir — kaynak başına yalnız EN TAZE haber.
  const enTaze = new Map();
  for (const b of sira) if (b?.key) enTaze.set(b.key, b);
  if (!enTaze.size) return sahaBloku(saha);
  let claims = [];
  try {
    claims = L.activeClaims(root); // yalnız haber VARKEN okunur (nadir yol)
  } catch {
    /* ölçülemedi → "yeniden alınmış mı" iddiası kurulmaz */
  }
  const CLI = "node ~/.claude/skills/eszamanli/scripts/claim.mjs";
  const satirlar = [`[eşzamanlılık] 🔓 BEKLEDİĞİN KAYNAK BOŞALDI (${enTaze.size} bildiri):`];
  for (const b of enTaze.values()) {
    const ts = Date.parse(b.ts || "");
    const kimden = b.kimden ? String(b.kimden).slice(0, 8) : "?";
    satirlar.push(
      `  • ${b.key} — ${kimden}${b.kimdenBaslik ? ` "${kis(b.kimdenBaslik, 48)}"` : ""} bıraktı` +
        `${Number.isFinite(ts) ? ` (${dk(ts)})` : ""}` +
        `${b.neden === "SessionEnd" ? " [oturumu kapanarak]" : ""}`
    );
    if (b.bekleyenNiyet) satirlar.push(`      beklemedeki işin: ${kis(b.bekleyenNiyet, 96)}`);
    const yeni = claims.find((c) => c.resource.key === b.key);
    if (yeni) {
      const s = L.sessionInfo(yeni.owner?.sessionId);
      satirlar.push(
        `      ⚠ kaynak YENİDEN alınmış (${String(yeni.owner?.sessionId).slice(0, 8)}` +
          `${s?.title ? ` "${kis(s.title, 40)}"` : ""}) — sıraya gir:`,
        `        ${CLI} wait --res "${b.key}" --intent "<beklemedeki iş>"   (run_in_background)`
      );
    } else {
      satirlar.push(`      ŞİMDİ AL: ${CLI} claim --res "${b.key}" --intent "<beklemedeki iş>"`);
    }
  }
  satirlar.push(`  (bu haber BİR KEZ basılır — beklemedeki maddeyi şimdi ele al ya da bırak.)`);
  return [...sahaBloku(saha), ...satirlar];
}

/**
 * SAHA HABERLERİ — yalnız ORKESTRATÖRÜN kutusuna düşer (kütüphane hedefi orada seçer;
 * burası sadece ÇİZER). Koordinatörün tek soruşu vardır: *sahada ne oldu, neye elimi
 * atmalıyım?* Satırlar bu yüzden olguyu ve varsa ÇAREYİ taşır, yorum taşımaz.
 *
 * TAVAN 12 SATIR + "+N daha": okunmamış kutu şişerse blok bir güne yayılmış günlüğe döner
 * ve enjeksiyon bütçesini yakar. Kırpma SESSİZ DEĞİLDİR — kaç haberin gösterilmediği yazılır.
 */
function sahaBloku(saha) {
  if (!saha?.length) return [];
  const ikon = { bitti: "✅", bloke: "⛔", kapandi: "🔚", devir: "🔁" };
  const goster = saha.slice(-12);
  const satirlar = [`[orkestratör] Sahadan ${saha.length} haber:`];
  for (const b of goster) {
    const ts = Date.parse(b.ts || "");
    const kim = b.kimden ? String(b.kimden).slice(0, 8) : "?";
    const ne = Number.isFinite(ts) ? ` (${dk(ts)})` : "";
    if (b.tip === "bitti")
      satirlar.push(
        `  ${ikon.bitti} bitti: ${b.key} ← ${kim}${ne}` +
          `${b.niyet ? ` — ${kis(b.niyet, 72)}` : ""}${b.bekleyen ? ` · ${b.bekleyen} bekleyen vardı` : ""}`
      );
    else if (b.tip === "bloke")
      satirlar.push(
        `  ${ikon.bloke} bloke: ${kim} → ${b.key}${ne}` +
          `${b.sahip ? ` (sahip: ${String(b.sahip).slice(0, 8)}${b.sahipNiyet ? ` — ${kis(b.sahipNiyet, 48)}` : ""})` : ""}`
      );
    else if (b.tip === "kapandi")
      satirlar.push(
        `  ${ikon.kapandi} kapandı: ${kim}${ne} — ${b.kilit || 0} kilit bırakıldı` +
          `${b.bekledigi ? ` · ${b.bekledigi} bekleyişi yarım kaldı` : ""}`
      );
    else if (b.tip === "devir")
      satirlar.push(
        `  ${ikon.devir} devir: ${b.key} ← ${kim}${ne}${b.gorev ? ` — ${kis(b.gorev, 72)}` : ""}` +
          `${b.devirId ? `\n      üstlen: node ~/.claude/skills/eszamanli/scripts/claim.mjs devir al --id ${b.devirId}` : ""}`
      );
  }
  if (saha.length > goster.length)
    satirlar.push(`  … +${saha.length - goster.length} haber daha GÖSTERİLMEDİ (tavan 12).`);
  satirlar.push(`  (orkestratörsün: bu haberler BİR KEZ düşer — gerekeni şimdi planına al.)`);
  return satirlar;
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
  const who = s
    ? `"${s.title || "(başlıksız)"}" — ${s.dirName}, durum: ${s.state}, son nabız ${dk(s.updated)}`
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
    if (yeni)
      L.bildirOrkestratore?.(repoRoot, {
        tip: "bloke",
        key: claim.resource.key,
        kimden: me.sessionId,
        sahip: claim.owner?.sessionId || null,
        sahipNiyet: claim.intent || null,
        niyet: intent || null,
      });
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
    /* Orkestratörlük kaydı da bu oturumla ölür (canlılık zaten pid'le ölçülüyor; kaydı
       burada düşürmek defteri temiz tutar ve "ölü koordinatör" görüntüsünü hiç doğurmaz). */
    try {
      L.orkestratorBirak?.(root, sid);
    } catch {
      /* yut */
    }
    const bekledigi = L.queuedKeysOf(root, sid);
    /* ORKESTRATÖRE "kapandı": bir oturumun ölümü sahanın en sessiz olayıdır — kilidini
       bıraktı mı, yarım bir bekleyişi mi vardı, orkestratör bunu başka hiçbir yerden
       öğrenemez. Kendi kaydı düşerken kendine yazmaz (kütüphane eler). */
    try {
      if (kapananKilit || bekledigi.length)
        L.bildirOrkestratore?.(root, {
          tip: "kapandi",
          kimden: sid,
          kilit: kapananKilit,
          bekledigi: bekledigi.length,
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

    /* ORKESTRATÖR GÖRÜNÜRLÜĞÜ: sahada bir koordinatör varsa herkes BİLİR — çünkü bu
       oturumun bloke olması/işini bitirmesi ona otomatik haber düşürüyor. Görünmez bir
       gözlemci, sözleşmesi ilan edilmemiş bir gözlemcidir. Kendine bunu yazmaz. */
    let orkSatir = null;
    try {
      const o = L.orkestratorOku?.(root);
      if (o && o.sessionId !== me) {
        const os = L.sessionInfo(o.sessionId);
        orkSatir =
          `Bu repoda ORKESTRATÖR var: ${String(o.sessionId).slice(0, 8)}` +
          `${os?.title ? ` "${kis(os.title, 44)}"` : ""}${o.kapsam ? ` · kapsam: ${kis(o.kapsam, 48)}` : ""}` +
          ` — işini bitirmen/bloke olman ona OTOMATİK bildirilir (ayrıca rapor yazma).`;
      }
    } catch {
      /* yut */
    }

    const others = L.liveSessionsIn(root).filter((s) => s.sessionId !== me);
    /* Sarkık devir işareti TEK BAŞINA da haber değeridir (iş kaybolmasın); başka canlı
       session yoksa blok yalnız o satırı taşır. Üçü de yoksa TEK BAYT basılmaz. */
    if (!others.length) {
      if (!devirSatir && !bildiri.length && !orkSatir) return pass();
      return out({
        hookSpecificOutput: {
          hookEventName: olay,
          additionalContext: [
            ...bildiri,
            ...(orkSatir ? [`[eşzamanlılık] ${orkSatir}`] : []),
            ...(devirSatir ? [`[eşzamanlılık] ${devirSatir}`] : []),
          ].join("\n"),
        },
      });
    }
    const held = L.ledgerExists() ? L.activeClaims(root) : [];
    const lines = others
      .slice(0, 6)
      .map((s) => `  • "${s.title || "(başlıksız)"}" (${s.dirName}, ${s.state}, ${dk(s.updated)})`);
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
        `      sahip: "${kis(s?.title, 56) || "(başlıksız)"}"${s?.state ? ` (${s.state}` : ""}${s?.updated ? `, ${dk(s.updated)})` : s?.state ? ")" : ""}`,
        ...(lim ? [`    ${lim.trim()}`] : []),
        `      sahip ne yapıyor: ${kis(c.intent, 96) || "(niyet belirtilmemiş)"}`,
      ].join("\n");
    });
    return out({
      hookSpecificOutput: {
        hookEventName: olay,
        additionalContext: [
          ...bildiri,
          `[eşzamanlılık] Bu repoda ${others.length} BAŞKA canlı Claude session'ı var:`,
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
