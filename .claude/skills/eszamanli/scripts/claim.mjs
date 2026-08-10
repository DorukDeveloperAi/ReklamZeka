#!/usr/bin/env node
/**
 * claim.mjs — eşzamanlı session protokolünün CLI'ı (/eszamanli skill'inin makine yüzü).
 *
 *   claim   --res <kaynak> [--intent "..."] [--todo "..."] [--breadth broad|focused]
 *   release [--res <kaynak> | --all]             # sahipsen bırakır; sıradaysan VAZGEÇER
 *   status  [--json]
 *   orkestrator kayit [--kapsam "..."] [--devral] | birak | durum   # sahadaki koordinatör
 *   kutu    [--json]                                              # gelen kutum (TÜKETMEZ)
 *   rol     kayit --rol <ad> [--kapsam "..."] [--devral] | birak | durum  # kalıcı oturum rolleri
 *   bildir  (--rol <ad> | --hedef <session>) --mesaj "..." [--res <kaynak>]  # roller arası haber
 *   wait    --res <kaynak> [--timeout <sn>] [--no-acquire] [--intent "..."]
 *   free    --res <kaynak> [--repo <yol>]        # KİMLİKSİZ sonda: devralınabilir mi? exit 0/1
 *   devret  --res <kaynak> --gorev "..." [--kuru]  # parça B'yi devret (Maestro + kalıcı işaret)
 *   devir   list [--json] | al --id <id>         # devir işaretleri: gör · ATOMİK üstlen
 *   limit-devir [--kuru]                         # ben limitliyim → kilitlerimi devret
 *   gc                                           # stale claim/kuyruk kayıtlarını biç
 *   resources                                    # bu repoda tanımlı mantıksal kaynaklar
 *
 * Kapı (claim-guard.mjs) ile AYNI kütüphaneyi kullanır: kimin neyi tuttuğu, stale
 * ölçütü, sıra ve çakışma politikası TEK yerde (claims-lib.mjs) — iki implementasyon
 * drift üretir.
 *
 * `wait` VARSAYILAN OLARAK KİLİDİ ALIR (--no-acquire ile salt bekleyiş). Gerekçe:
 * "boşaldı, şimdi sen claim'le" ile modelin claim'i koşması arasındaki boşlukta başka
 * bir session kaynağı kapardı — sıra beklemiş olan yine aç kalırdı. Bekleyen süreç
 * sırası gelince kilidi session adına alır; model uyandığında kaynak ZATEN elindedir.
 *
 * Çıkış kodları:  0 = oldu · 1 = free: henüz devralınamaz · 3 = kaynak başkasında
 *                 (kuyruğa yazıldın) · 4 = sıra sende değil (önünde bekleyen var)
 *                 5 = kullanım hatası · 6 = timeout · 7 = DÖNGÜ (beklersen deadlock)
 */

import { join, resolve, relative, sep } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as L from "../../../hooks/claims-lib.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0] || "status";
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i < 0 ? d : argv[i + 1] ?? true;
};
const has = (n) => argv.includes(`--${n}`);

const ROOT = L.repoRootOf(process.cwd());
const RESMAP = L.loadResourceMap(ROOT);

/** Kimlik: CLAUDE_CODE_SESSION_ID Bash ortamında VAR (ölçüldü) — süreç ağacına
 *  tırmanmaya gerek yok. pid, subagent köprüsü için yine de kaydedilir. */
function me() {
  const sid = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  if (!sid) {
    console.error(
      "HATA: CLAUDE_CODE_SESSION_ID yok — bu komut bir Claude session'ının Bash aracından çalışmalı."
    );
    process.exit(5);
  }
  // Kimlik = session'ın kendi session-status kaydı (kapı da aynı yerden okur).
  return L.identityOf(sid);
}

/**
 * Kaynak anahtarını çözümle: mantıksal ad · glob · yol.
 *
 * Yol anahtarı KANONİKLEŞTİRİLİR: "./src/a.ts", "src/a.ts" ve "/repo/src/a.ts" aynı
 * dosyadır — üç ayrı anahtar üç ayrı kilit demektir, yani koruma YOKTUR (iki session
 * aynı dosyayı farklı yazımla claim'leyip ikisi de "sahibim" sanır). Tek dosya → tek anahtar.
 */
function resolveRes(key, root = ROOT, resmap = RESMAP, cwd = process.cwd()) {
  if (!key) {
    console.error("HATA: --res gerekli. Tanımlı kaynaklar için: claim.mjs resources");
    process.exit(5);
  }
  if (resmap[key]) return { type: "logical", key };
  if (key.startsWith("glob:")) return { type: "glob", key };
  if (/[*?]/.test(key)) return { type: "glob", key: `glob:${key}` }; // "src/**" yazana glob: dedirtme
  const abs = L.canonicalPath(resolve(cwd, L.expandTilde(key)));
  const rel = relative(root, abs);
  const inRepo = !rel.startsWith("..") && !rel.startsWith(sep);
  return { type: "path", key: inRepo ? rel : abs };
}

const short = (s) => String(s || "").slice(0, 8);
const dk = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "az önce" : m < 60 ? `${m} dk önce` : `${Math.round(m / 60)} sa önce`;
};

/** Anahtarı hem çözümlenmiş hem HAM haliyle ara: eski yazımla alınmış bir claim
 *  (kanonikleştirme öncesi) sahibinin elinde mahsur kalmamalı. */
function findClaim(resolved, raw) {
  const cl = L.activeClaims(ROOT);
  return cl.find((c) => c.resource.key === resolved.key || (raw && c.resource.key === raw)) || null;
}

function mkClaim(resource, I) {
  const now = new Date().toISOString();
  return {
    v: 1,
    resource,
    owner: I,
    intent: flag("intent") || null,
    todo: flag("todo") || null,
    breadth: flag("breadth") || "focused",
    createdAt: now,
    renewedAt: now,
  };
}

/** Sahip LİMİTLİ mi? Bekleyen körlüğünün en pahalı yüzü buydu: 27 Tem'de 4 session,
 *  sahibi spend-limit'e girmiş (pid canlı, iş yapamıyor) bir kilidin arkasında dondu ve
 *  hiçbir çıktı bunu SÖYLEMİYORDU. Artık söyler — ve devrin yakın olduğunu da. */
function limitliSatir(sessionId) {
  const lim = L.sessionInfo(sessionId)?.limit || null;
  if (!L.usageHalt(lim)) return null;
  const reset = Number.isFinite(lim.resetTs)
    ? new Date(lim.resetTs).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
    : null;
  return `  ⚠ sahip LİMİTLİ (${lim.sinif}${reset ? `, reset ~${reset}` : ", reset penceresi yok"}) — kilidi birazdan devredilecek (kendi limit devri ∨ bayatlık kademesi).`;
}

/**
 * İŞARET BIRAK + ZİNCİRİN GERİ YÖNÜ: kilidi TUTANA "seni bekleyen doğdu" haberi.
 *
 * Kuyruğa girişin TEK kapısı burasıdır (üç blokaj dalı da buradan geçer), çünkü haberin
 * dedup ölçütü "kuyrukta ZATEN var mıydım" sorusudur ve bu ancak enqueue'dan ÖNCE ölçülebilir.
 * Aynı tıkanıklığın her turdaki tekrarı sahibin kutusunu doldurmaz — kapı yolundaki
 * `markWanted` ile bire bir aynı kural.
 */
function isaretBirak(claim, I, intent) {
  const key = claim.resource.key;
  const yeni = !L.queueOf(ROOT, key).some((w) => w.sessionId === I.sessionId);
  L.enqueue(ROOT, key, {
    sessionId: I.sessionId,
    since: new Date().toISOString(),
    intent: intent || null,
    pid: null, // işaret: sıra TUTMAZ (sırayı yalnız canlı bir wait süreci tutar)
  });
  if (yeni) L.bildirSahibe?.(ROOT, claim, { sessionId: I.sessionId, intent });
}

/** MEŞGUL raporu — neden bloke olduğunu ve nasıl devam edeceğini SÖYLER. */
function mesgul(cur, I, targetKey, why) {
  const s = L.sessionInfo(cur.owner?.sessionId);
  const q = L.queueOf(ROOT, cur.resource.key);
  const yer = q.findIndex((x) => x.sessionId === I.sessionId);

  console.log(
    [
      `MEŞGUL: ${targetKey}${why && why !== "aynı kaynak" ? `  (çakışma: ${cur.resource.key} — ${why})` : ""}`,
      `  sahip: ${s ? `"${s.title || "(başlıksız)"}" (${s.dirName}, ${s.state})` : short(cur.owner?.sessionId)}`,
      limitliSatir(cur.owner?.sessionId) || ``,
      `  niyet: ${cur.intent || "(belirtilmemiş)"}`,
      yer >= 0 ? `  kuyruktaki yerin: ${yer + 1}/${q.length}` : ``,
      ``,
      `İŞİ AYIR, BEKLEME. Bloke parçanın İKİ teslim yolu var:`,
      `  a) bu oturumda bitecekse — uyanma kur (run_in_background; sıra sana gelince kilidi`,
      `     SENİN ADINA alır, uyandığında kaynak elinde olur):`,
      `       node ${process.argv[1]} wait --res "${cur.resource.key}" --intent "<devam eden iş>"`,
      `  b) oturum kapanabilir / iş bağımsız koşabilirse — parçayı Maestro'ya DEVRET`,
      `     (kaynak devralınabilir olunca ateşlenir; oturumun yaşaması gerekmez):`,
      `       node ${process.argv[1]} devret --res "${cur.resource.key}" --gorev "<parça B tarifi>"`,
    ]
      .filter((x) => x !== ``)
      .join("\n")
  );
  /* DEFTER (aşama 05): MEŞGUL bir DENY'in CLI yüzüdür ve aynı satırı hak eder. `key` BLOKE
     EDEN kaynaktır (sahibin tuttuğu); istediğim hedef ondan farklıysa `why`ye iner — şema
     sabit kalsın diye ikinci bir alan açılmaz. Yazım kararı DEĞİŞTİRMEZ: exit 3 her yolda. */
  L.olayBlok(ROOT, {
    tip: "mesgul",
    claim: cur,
    engellenen: I.sessionId,
    why:
      (why || "aynı kaynak") +
      (targetKey && targetKey !== cur.resource.key ? ` · hedef: ${targetKey}` : ""),
  });
  process.exit(3);
}

/* ─────────────────── TOCTOU VALFİ — claim-sonrası mutabakat turu ───────────────────
 * Claim akışı oku→tara→yaz'dır: adım 2'de (`resourcesConflict` taraması) tabloyu okuduktan
 * sonra, adım 4'te (`tryCreateClaim`) yazana kadar geçen pencerede BAŞKA bir session
 * FARKLI bir anahtarla çakışan bir kilit yazabilir. `tryCreateClaim`in `wx` atomiği yalnız
 * AYNI anahtarın yarışını çözer (dosya adı `sha1(key)`); farklı-aile yarışında iki taraf da
 * "kazandım" der — köprü (claims-lib `planAsamaPaths`) bu yarışı YENİ AÇTI, çünkü artık
 * `plan:x:asama:1` ile `glob:plans/x/**` gerçekten çakışıyor.
 *
 * Valf küçük ve DETERMİNİSTİK: kilit alındıktan hemen sonra defter BİR KEZ daha okunur.
 * Çakışan ve DAHA ÖNCE YAZILMIŞ bir kilit varsa kaybeden BENİM — kendi kilidimi bırakır,
 * kuyruğa girer, MEŞGUL raporu basarım.
 *
 * SIRA ÖLÇÜTÜ `createdAt` DEĞİL, KİLİT DOSYASININ YAZIM ANIdır (mtime, ns) — ve bu fark
 * ÖLÇÜLDÜ (fikstür: 40 tur çakışan eşzamanlı claim). `createdAt` `mkClaim`de damgalanır,
 * yazımdan ÖNCE; iki tarafın damgası yazım sırasıyla aynı yönde olmak zorunda değildir.
 * Sızan senaryo şuydu: A yazar → A mutabakat turunu B daha YAZMADAN koşar (rakip görmez,
 * kalır) → B yazar → B, A'yı görür ama A'nın `createdAt`i daha YENİ olduğu için "kazandım"
 * der ve o da kalır → **ÇİFT SAHİPLİK** (40 turun 2'sinde üretildi).
 *
 * mtime bunu kapatır çünkü tek yönlü bir olgu taşır: **sonra yazan, önce yazanı HER ZAMAN
 * görür** (kendi yazımından sonra okur, öncekinin dosyası çoktan diskte). Sonra yazanın
 * mtime'ı daima büyüktür → daima çekilir. Önce yazan rakibi görürse mtime'ını büyük ölçer
 * → kalır. İki taraf da AYNI iki dosyanın mtime'ını okur, yani AYNI hükmü verir: ne ikisi
 * birden çekilir, ne ikisi birden kalır.
 *
 * KALAN KÖR NOKTA (İLANLI): iki dosya AYNI nanosaniyede damgalanırsa sıra anahtar adına
 * düşer (`localeCompare`) ve o durumda "yalnız sonra yazan görüyorsa" çift sahiplik teorik
 * olarak mümkündür. APFS mtime çözünürlüğü ns'dir; fikstürde hiç gözlenmedi.
 *
 * Dönüş: null (kilit senin) | { rakip, why }.
 */
const LEDGER_DIR = L.ledgerDirOf(ROOT);
const yazimAni = (key) => {
  try {
    return statSync(L.claimPath(LEDGER_DIR, key), { bigint: true }).mtimeNs;
  } catch {
    return null; // dosya yok → yazım anı ölçülemedi
  }
};

function mutabakatTuru(claim, I) {
  const benim = yazimAni(claim.resource.key);
  for (const c of L.activeClaims(ROOT)) {
    if (c.resource.key === claim.resource.key) continue; // aynı anahtar → wx zaten çözdü
    if (L.ownerMatch(c, I)) continue;                    // kendi kaynaklarımla çakışmam
    const cf = L.resourcesConflict(claim.resource, c.resource, RESMAP);
    if (!cf) continue;
    const onun = yazimAni(c.resource.key);
    let kaybettim;
    if (onun == null) kaybettim = false;      // rakibin dosyası yok (bıraktı) → kilit bende
    else if (benim == null) kaybettim = true; // benimki yok → zaten kaybettim
    else if (onun !== benim) kaybettim = onun < benim; // önce yazan kazanır
    else kaybettim = String(c.resource.key).localeCompare(String(claim.resource.key)) < 0;
    if (kaybettim) return { rakip: c, why: cf.why };
  }
  return null;
}

/** `wait` yolundaki valf: kaybettiysen kilidi geri ver ve **beklemeye devam et** (true döner).
 *  `claim` yolu çıkıp raporlar, `wait` yolu döngüde kalır — bekleyişin tanımı budur. */
function mutabakatCekil(claim, I) {
  const kayip = mutabakatTuru(claim, I);
  if (!kayip) return false;
  L.archiveClaim(ROOT, claim, `mutabakat: ${kayip.rakip.resource.key} daha eski`);
  isaretBirak(kayip.rakip, I, flag("intent"));
  return true;
}

function cycleRapor(cyc, targetKey) {
  /* DEFTERE: DÖNGÜ sistemin en pahalı hâlidir (iki canlı pid, otomatik biçme devrede DEĞİL)
     ve bugüne dek hiçbir yere yazılmıyordu — orkestratör bunu görmezse çözecek kimse yok. */
  L.yazOlay(ROOT, {
    tip: "cevrim",
    key: targetKey,
    engellenen: (process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || "").slice(0, 8) || null,
    why: `zincir: ${cyc.chain.join(" → ")} → (ben) · tuttuklarım: ${cyc.release.join(", ")}`,
  });
  console.error(
    [
      `DÖNGÜ (deadlock) — kuyruğa YAZILMADIN: ${targetKey}`,
      `  bekleme zinciri: ${cyc.chain.join(" → ")} → (sen)`,
      `  sebep: sen ${cyc.release.join(", ")} tutuyorsun; "${targetKey}" sahibi zincir üzerinden onu bekliyor.`,
      ``,
      `ÇÖZÜM — sırayı çevir (tuttuğunu bırak, hedefi al, sonra geri al):`,
      ...cyc.release.map((k) => `  node ${process.argv[1]} release --res "${k}"`),
      `  node ${process.argv[1]} wait --res "${targetKey}"`,
    ].join("\n")
  );
  process.exit(7);
}

/* ─────────────────────────── komutlar ─────────────────────────── */

function cmdClaim() {
  const I = me();
  const raw = flag("res");
  const resource = resolveRes(raw);
  const active = L.activeClaims(ROOT);

  /* 1. Aynı anahtar bende mi / başkasında mı? */
  const cur = findClaim(resource, raw);
  if (cur) {
    if (L.ownerMatch(cur, I)) {
      console.log(`ZATEN SENDE: ${resource.key}`);
      process.exit(0);
    }
    /* ÇEVRİM (DEADLOCK) FRENİ — kuyruğa yazılmadan ÖNCE. Bir kaynağı TUTARKEN, beni
       (zincir üzerinden) AKTİF bekleyen birinin kaynağını beklersem çevrim doğar; iki pid
       de canlı olduğu için otomatik biçme devreye girmez → süresiz kilitlenme. Grafik
       defterde ZATEN yazılı (owner + kuyruk) → yürü, kuyruğa YAZILMA, çözümü SÖYLE. */
    const cyc = L.waitCycle(ROOT, active, I.sessionId, resource.key);
    if (cyc) cycleRapor(cyc, resource.key);
    isaretBirak(cur, I, flag("intent"));
    mesgul(cur, I, resource.key, "aynı kaynak");
  }

  /* 2. POLİTİKA: farklı anahtar ama GERÇEK çakışma (yol kesişimi ∨ ilan edilmiş öncüllük).
     Anahtar eşitliği tek başına yetseydi `pm:defter` ile `~/.claude/pm/log.jsonl`
     aynı anda claim edilir, iki session da "sahibim" sanırdı. */
  for (const c of active) {
    if (L.ownerMatch(c, I)) continue; // kendi kaynaklarımla çakışmam
    const cf = L.resourcesConflict(resource, c.resource, RESMAP);
    if (cf) {
      const cyc = L.waitCycle(ROOT, active, I.sessionId, c.resource.key);
      if (cyc) cycleRapor(cyc, c.resource.key);
      isaretBirak(c, I, flag("intent"));
      mesgul(c, I, resource.key, cf.why);
    }
  }

  /* 3. SIRA: kaynak boş ama önünde AKTİF bekleyen varsa kapmak açlık üretir.
     (Sırayı yalnız canlı bir `wait` süreci tutar → vazgeçmiş kimse kimseyi bekletmez.) */
  const head = L.queueHead(ROOT, resource.key);
  if (head && head.sessionId !== I.sessionId) {
    const hs = L.sessionInfo(head.sessionId);
    console.error(
      [
        `SIRA SENDE DEĞİL: ${resource.key}`,
        `  önünde bekleyen: ${hs ? `"${hs.title || "(başlıksız)"}" (${hs.state})` : short(head.sessionId)} — ${head.intent || "(niyet belirtilmemiş)"}`,
        `  o session ${dk(head.since)} beri sırada ve kilidi alacak.`,
        ``,
        `Sıraya gir (sıra sana gelince kilit SENİN adına alınır):`,
        `  node ${process.argv[1]} wait --res "${resource.key}" --intent "<işin>"`,
      ].join("\n")
    );
    /* exit 4 de bir BLOKAJdır ve deftere girer: kaynak BOŞ ama sıra başkasında. Bu satır
       olmadan "açlık" (sürekli önüne geçilen session) tarihsel olarak görünmezdi. Tutan bir
       claim YOK → `claim: null`, sahip = sıranın başındaki bekleyen. */
    L.olayBlok(ROOT, {
      tip: "mesgul",
      key: resource.key,
      claim: null,
      engellenen: I.sessionId,
      sahip: head.sessionId,
      why: "sıra sende değil (önünde aktif bekleyen var)",
    });
    process.exit(4);
  }

  const claim = mkClaim(resource, I);
  if (!L.tryCreateClaim(ROOT, claim)) {
    console.log(`YARIŞ KAYBEDİLDİ: ${resource.key} — tekrar dene.`);
    process.exit(3);
  }
  /* 4. TOCTOU VALFİ (03.4): yazdım ama pencerede biri FARKLI bir aileden çakışan kilidi
        kapmış olabilir. Bir kez daha oku; daha ÖNCE YAZILMIŞ bir çakışan varsa kaybeden
        benim → kilidi geri ver, kuyruğa gir, MEŞGUL raporla.
        (05 ile kesişim: kaybeden `mesgul()`den geçtiği için olay defterine de düşer.) */
  const kayip = mutabakatTuru(claim, I);
  if (kayip) {
    L.archiveClaim(ROOT, claim, `mutabakat: ${kayip.rakip.resource.key} önce yazılmış`);
    isaretBirak(kayip.rakip, I, flag("intent"));
    console.log(`MUTABAKAT — kilit GERİ VERİLDİ: ${resource.key} (yarışı ${short(kayip.rakip.owner?.sessionId)} ÖNCE YAZARAK kazandı)`);
    mesgul(kayip.rakip, I, resource.key, kayip.why);
  }

  // aldın → sıradan çık; bekleyişin süresi `since` SİLİNMEDEN kapanış kaydına yazılır (05.3)
  L.dequeueKapanis(ROOT, resource.key, I.sessionId, "aldi", "claim ile alındı");
  /* DEFTERE: kilit ALINDI. Bugüne dek defter yalnız BLOKAJI görüyordu — kaynağın ne zaman
     kimin eline geçtiği hiçbir yerde yazmıyordu, yani "sahada ne oluyor" sorusu yarım
     cevaplanıyordu. Orkestratör beslemesi bu defterin projeksiyonudur (2026-08-09). */
  L.yazOlay(ROOT, {
    tip: "alindi",
    key: resource.key,
    sahip: I.sessionId,
    why: flag("intent") || null,
    queueLen: L.activeQueue(ROOT, resource.key).length,
  });
  console.log(
    `CLAIM ALINDI: ${resource.key}${claim.breadth === "broad" ? " (breadth: broad — küçük işlere yol ver)" : ""}\n` +
      `  İş bitince BIRAK: node ${process.argv[1]} release --res "${resource.key}"`
  );
}

/**
 * BIRAKMANIN İKİNCİ YARISI — sıradakine HABER VER (seviye 0, kullanıcı kararı 2026-08-09).
 *
 * Bırakma bugüne dek sonucu YALNIZ bırakanın ekranına basıyordu; bekleyen başka bir
 * pencerede oturduğu için "sıra sana geldi" haberi ona hiç ulaşmıyordu. Kural artık şu:
 * **eşzamanlılık sırasına girmiş bir işi bitiren, sıradakine bildiri bırakır.**
 *
 * Kimin haber ALDIĞINI kütüphane belirler (`bildirSiradakine`): canlı `wait` süreci olan
 * bekleyen KENDİ uyanır (ona yazılmaz), pid'siz işaret bırakmış olan uyanamaz (ona yazılır).
 * Bu satır o hükmü yalnızca GÖRÜNÜR kılar — haber verildiyse söylenir, verilmediyse NEDEN
 * verilmediği söylenir. Sessiz bırakma yok.
 */
function birakmaRaporu(key, I, claim = null) {
  let r;
  try {
    r = L.bildirSiradakine(ROOT, key, { sessionId: I.sessionId, intent: null, neden: "release" });
  } catch {
    return `BIRAKILDI: ${key}  (bildiri ölçülemedi)`;
  }
  /* DEFTERE: kilit BIRAKILDI = o iş bitti. Orkestratör bunu buradan öğrenir (besleme
     defterin projeksiyonudur) — ayrıca ona elle haber GÖNDERİLMEZ, çift raporlama olurdu. */
  L.yazOlay(ROOT, {
    tip: "birakildi",
    key,
    sahip: I.sessionId,
    why: claim?.intent || "release",
    queueLen: r.sessiz.length + r.aktif.length,
  });
  const ad = (w) => `${short(w.sessionId)} (${w.intent || "niyet yok"})`;
  const orkSatir = L.orkestratorOku?.(ROOT) ? `\n  ↳ orkestratör deftere düşen bu olayı turunda görecek` : ``;
  if (r.bildirilen.length)
    return (
      [
        `BIRAKILDI: ${key} → BİLDİRİ GÖNDERİLDİ: ${r.bildirilen.length} bekleyen`,
        ...r.bildirilen.map((w, i) => `  ${i + 1}. ${ad(w)} — ilk turunda okuyacak`),
      ].join("\n") + orkSatir
    );
  if (r.aktif.length)
    return (
      `BIRAKILDI: ${key} → sıra: ${ad(r.aktif[0])} — bildiri GEREKMEZ, ` +
      `bekleyen süreci kilidi kendi alıp oturumunu uyandıracak` + orkSatir
    );
  return `BIRAKILDI: ${key}  (sırada kimse yok)` + orkSatir;
}

/** release = "bu kaynakla işim bitti": sahipsen BIRAKIR, sıradaysan VAZGEÇERSİN.
 *  Vazgeçme yolu şart — kuyrukta unutulmuş bir istek sırayı yalanlar. */
function cmdRelease() {
  const I = me();
  const all = has("all");
  const raw = flag("res");
  const mine = L.activeClaims(ROOT).filter((c) => L.ownerMatch(c, I));

  if (all) {
    for (const c of mine) {
      L.archiveClaim(ROOT, c, "release");
      console.log(birakmaRaporu(c.resource.key, I, c));
    }
    let cikti = 0;
    for (const k of L.queuedKeysOf(ROOT, I.sessionId)) {
      L.dequeueKapanis(ROOT, k, I.sessionId, "vazgecti", "release --all");
      cikti++;
    }
    if (cikti) console.log(`SIRADAN ÇIKILDI: ${cikti} kaynak (vazgeçme)`);
    if (!mine.length && !cikti) console.log("Bırakılacak claim yok.");
    return;
  }

  const resource = resolveRes(raw);
  const hedef = mine.filter((c) => c.resource.key === resource.key || c.resource.key === raw);
  if (hedef.length) {
    for (const c of hedef) {
      L.archiveClaim(ROOT, c, "release");
      console.log(birakmaRaporu(c.resource.key, I, c));
    }
    return;
  }
  // Sahibi değilim: kuyrukta mıyım? → vazgeç.
  const q = L.queueOf(ROOT, resource.key);
  if (q.some((w) => w.sessionId === I.sessionId)) {
    L.dequeueKapanis(ROOT, resource.key, I.sessionId, "vazgecti", "release (sıradan çıkış)");
    console.log(`SIRADAN ÇIKTIN: ${resource.key} (vazgeçme — artık kimseyi bekletmiyorsun)`);
    return;
  }
  console.log(`Sende değil: ${resource.key}`);
}

function cmdStatus() {
  const claims = L.ledgerExists() ? L.activeClaims(ROOT) : [];
  const live = L.liveSessionsIn(ROOT);
  /* Kendini sırada GÖR: `me()` burada kullanılamaz (session dışında exit 5 verir —
     status her yerden okunabilmeli), o yüzden kimlik YUMUŞAK okunur; yoksa işaret düşer. */
  const benSid = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  if (has("json")) {
    /* `ownerAlive`: sahibin süreci ÖLÇÜLMÜŞ canlılık hükmü (procAlive = pid ⊕ procStart,
       pid geri-dönüşüne karşı). Tüketici sistem grafı: kilit düğümünün `canli` alanı bu
       hükümden gelir — hüküm KAYNAĞINDA yaşasın diye burada taşınır, grafta yeniden
       ölçülmez (ikinci hüküm makinesi yaratmamak için). activeClaims ölü sahipli kilidi
       zaten biçtiğinden pratikte hep true; alan yine de AÇIK yazılır ki tüketici sabit
       `true` uydurmak zorunda kalmasın. */
    const withQ = claims.map((c) => ({
      ...c,
      ownerAlive: L.procAlive(c.owner?.pid, c.owner?.procStart),
      queue: L.queueOf(ROOT, c.resource.key),
    }));
    console.log(
      JSON.stringify({ repo: ROOT, orkestrator: L.orkestratorOku?.(ROOT) || null, claims: withQ, live }, null, 1)
    );
    return;
  }
  console.log(`repo: ${ROOT}`);
  {
    // ROL TABLOSU: yalnız DOLU roller basılır (boş kadro her status'u şişirirdi).
    const dolu = (L.rolListe?.(ROOT) || []).filter((r) => r.sahip);
    if (dolu.length) {
      console.log(`roller:`);
      for (const r of dolu) {
        const s = L.sessionInfo(r.sahip.sessionId);
        console.log(
          `  ${r.ad.padEnd(11)} ${short(r.sahip.sessionId)}${r.sahip.sessionId === benSid ? " «SEN»" : ""}` +
            `${s ? ` "${(s.title || "").slice(0, 36)}"` : ""}${r.sahip.kapsam ? ` · ${String(r.sahip.kapsam).slice(0, 44)}` : ""}`
        );
      }
    }
  }
  console.log(`canlı session: ${live.length}`);
  for (const s of live)
    console.log(`  • ${short(s.sessionId)} "${s.title || "(başlıksız)"}" — ${s.dirName}, ${s.state}`);
  console.log(`aktif kilit: ${claims.length}`);
  for (const c of claims) {
    const s = L.sessionInfo(c.owner?.sessionId);
    const q = L.queueOf(ROOT, c.resource.key);
    console.log(
      `  • ${c.resource.key}  ←  ${short(c.owner?.sessionId)}` +
        `${s ? ` "${(s.title || "").slice(0, 40)}"` : ""} [${c.breadth}] ${dk(c.createdAt)}` +
        `${c.intent ? `\n      niyet: ${c.intent}` : ""}` +
        (q.length
          ? `\n      sıra: ${q
              .map(
                (w, i) =>
                  `${i + 1}.${short(w.sessionId)}${w.sessionId === benSid ? "«SEN»" : ""}${L.waiterActive(w) ? "(bekliyor)" : "(istedi)"}`
              )
              .join(" ")}`
          : "")
    );
  }
  if (!claims.length) console.log("  (kilit yok — serbest)");

  /* OKUNMAMIŞ BİLDİRİ — status TEŞHİS yüzeyidir, TÜKETMEZ (`tuket:false`). Haberi basıp
     silen tek yer `claim-guard ctx`tir; status da tüketseydi insan bakışı modelin haberini
     çalardı. Kimlik yumuşak: session dışından koşulursa bu blok hiç doğmaz. */
  {
    /* Orkestratörsem: defterde okunmamış kaç saha olayı birikmiş? (TÜKETMEZ — imleç
       yalnız `ctx` çizimi tarafından ilerletilir; status teşhis yüzeyidir.) */
    const o = L.orkestratorOku?.(ROOT);
    if (o && o.sessionId === benSid && typeof L.olayOku === "function") {
      const ofset = L.imlecOku?.(ROOT);
      const r = L.olayOku(ROOT, { ofset: Number.isFinite(ofset) ? ofset : L.olaySonu(ROOT) });
      if (r.satirlar.length)
        console.log(`okunmamış saha olayı: ${r.satirlar.length}${r.atlanan ? ` (+${r.atlanan} tavan dışı)` : ""}`);
    }
  }
  if (benSid && typeof L.bildiriOku === "function") {
    let gelen = [];
    try {
      gelen = L.bildiriOku(ROOT, benSid, { tuket: false });
    } catch {
      /* yut */
    }
    if (gelen.length) {
      console.log(`okunmamış bildiri: ${gelen.length} (ilk turunda otomatik okunacak)`);
      for (const b of gelen)
        console.log(`  • ${b.key} — ${short(b.kimden)} bıraktı${b.ts ? ` (${dk(b.ts)})` : ""}`);
    }
  }
}

/**
 * Boşalmayı bekle ve SIRA SENDEYSE KİLİDİ AL. run_in_background altında koşar;
 * çıkışı = "sıra sende geldi ve kaynak artık senin" sinyali.
 *
 * Bu sürecin CANLILIĞI kuyrukta sıra tutmanın ölçütüdür: süreç ölürse sıra düşer,
 * yani unutulmuş bir bekleyiş kimseyi süresiz bekletemez.
 */
async function cmdWait() {
  const I = me();
  const raw = flag("res");
  const resource = resolveRes(raw);
  const timeout = +(flag("timeout", 0) || 0);
  const acquire = !has("no-acquire");
  const t0 = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const entry = {
    sessionId: I.sessionId,
    since: new Date().toISOString(),
    intent: flag("intent"),
    pid: process.pid,
    procStart: L.selfProcStart(),
  };
  /* Bekleyişin BİTTİĞİ tek kapı. `sonuc` her çağrı noktasında AÇIKÇA verilir (aşama 05):
     bekleyişin nasıl bittiği — aldı mı, devraldı mı, vazgeçti mi — kapanış kaydının asıl
     bilgisidir ve exit koduna bakılarak TAHMİN EDİLEMEZ (exit 0 hem "aldım" hem "serbest
     olduğunu bildirdim"i taşır). Kayıt `since` silinmeden yazılır, sonra sıradan çıkılır. */
  const bitir = (code, sonuc = code === 0 ? "aldi" : "vazgecti", why = null) => {
    try {
      L.dequeueKapanis(ROOT, resource.key, I.sessionId, sonuc, why); // ölç, sonra sırayı boşalt
    } catch {
      /* yut */
    }
    process.exit(code);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(sig, () => bitir(6, "vazgecti", `sinyal: ${sig}`));

  /* Sıraya HEMEN gir: kapıda DENY yiyip bıraktığın İŞARET burada AKTİF bekleyişe
     yükselir (yerini kaybetmeden — ilk isteyen ilk sırada). Bunu atlarsak işaret
     sonsuza dek pasif kalır: sıra tutmaz, çevrim grafiğinde görünmez. */
  L.enqueue(ROOT, resource.key, entry);
  /* DEFTERE: AKTİF bekleyiş başladı (kapanışı `kapanis` satırı yazar → süre ölçülebilir).
     Orkestratör "kim ne zamandan beri bekliyor"u başka hiçbir yerden göremez. */
  L.yazOlay(ROOT, {
    tip: "bekleyis",
    key: resource.key,
    engellenen: I.sessionId,
    why: flag("intent") || null,
    queueLen: L.activeQueue(ROOT, resource.key).length,
  });

  /* KİMİ BEKLİYORUM (kullanıcı kararı 2026-07-27): bu süreç arka planda koşar ve
     çıkana dek tek satır basmazdı — çıktısına bakan "takıldı mı, kim tutuyor?"
     sorusunu ancak ayrı bir `status` koşumuyla yanıtlayabiliyordu. Bekleyişin İLK
     satırı artık sahibi söyler: kim (başlık) · ne yapıyor (niyet) · kaçıncı sıradayım. */
  {
    const cur0 = findClaim(resource, raw);
    /* ZİNCİRİN GERİ YÖNÜ (aktif uç): işaret bırakan "belki dönerim" der, AKTİF bekleyen
       gerçekten park etmiştir — sahibin bunu bilmesi en yüksek değerli haberdir. */
    if (cur0 && !L.ownerMatch(cur0, I))
      L.bildirSahibe?.(ROOT, cur0, { sessionId: I.sessionId, intent: flag("intent") });
    if (cur0 && !L.ownerMatch(cur0, I)) {
      const s0 = L.sessionInfo(cur0.owner?.sessionId);
      const aktif = L.queueOf(ROOT, resource.key).filter(L.waiterActive);
      const yer = aktif.findIndex((w) => w.sessionId === I.sessionId);
      console.log(
        [
          `BEKLİYOR: ${resource.key}`,
          `  sahip: ${short(cur0.owner?.sessionId)}${s0 ? ` "${(s0.title || "(başlıksız)").slice(0, 56)}" (${s0.state})` : ""} — ${dk(cur0.createdAt)} tutuyor`,
          `  sahip ne yapıyor: ${cur0.intent || "(niyet belirtilmemiş)"}`,
          `  sıra: ${yer >= 0 ? `${yer + 1}/${aktif.length}` : `${aktif.length} bekleyen`}`,
        ].join("\n")
      );
    }
  }

  for (;;) {
    /* TAZE ÖLÇÜM: ps snapshot'ı süreç-ömürlü önbellekte tutulur (hook'lar için doğru),
       ama bekleyiş uzun yaşar — yenilenmezse sahibin ÖLÜMÜ hiç görülmez (B08-1). */
    L.psYenile();

    /* ÖZ-KONTROL (tur başı): BEN limitliysem bekleyişim anlamsızdır — sıra bana gelse
       kilidi kapıp kuyruğu yeniden dondururdum (27 Tem vakasının tam kendisi, bu kez
       bekleyen tarafta). Kilidi kapmak yerine işi devret ve çık. */
    if (L.sessionHalted(I.sessionId)) {
      const lim = L.sessionInfo(I.sessionId)?.limit || {};
      console.log(
        [
          `LİMİTLİSİN — bekleyiş anlamsız: ${resource.key}`,
          `  limit: ${lim.sinif}${Number.isFinite(lim.resetTs) ? ` · reset ${new Date(lim.resetTs).toISOString()}` : " · reset penceresi yok"}`,
          `  Sıra sana gelse kilidi kapar ama iş yapamazdın → kuyruk yeniden donardı.`,
          `  İşi DEVRET (oturumun yaşaması gerekmez):`,
          `    node ${process.argv[1]} devret --res "${resource.key}" --gorev "<beklemedeki iş>"`,
          `  Kendi tuttuklarını da bırak: node ${process.argv[1]} limit-devir`,
        ].join("\n")
      );
      bitir(6, "vazgecti", "bekleyen LİMİTLİ — bekleyiş anlamsız");
    }

    const cur = findClaim(resource, raw);
    if (cur && L.ownerMatch(cur, I)) {
      console.log(`ZATEN SENDE: ${resource.key}`);
      bitir(0, "aldi", "zaten sende");
    }
    /* ── P2 DEVİR HAKKI ────────────────────────────────────────────────────────
       Kilit BAŞKASINDA ∧ DEVREDİLEBİLİR (sahip idle/waiting ∧ yenileme 1 saattir
       durmuş) ∧ SIRA BENDE → devral. Üç fren burada da geçerlidir: `gradeClaim`
       ölçüm yokluğunda TAZE der, `generating` sahibi ASLA düşürmez, ve bu kod yalnız
       AKTİF bir bekleyicinin (bu sürecin) içinde koşar — bekleyeni olmayan bir kilit
       hiç devredilmez, çünkü devri yapacak kimse yoktur. Devir SESSİZ DEĞİLDİR:
       eski sahibe kalıcı bir devir işareti bırakılır ve o, ilk yazımında DENY metninde
       "KİLİDİN DEVREDİLDİ" bloğunu okur. Kilit SİLİNMEZ — sahibi DEĞİŞİR. */
    if (cur && !L.ownerMatch(cur, I) && L.gradeClaim(cur) === "DEVREDILEBILIR") {
      const head = L.queueHead(ROOT, resource.key);
      if (head && head.sessionId === I.sessionId) {
        const yasDk = Math.round((Date.now() - Date.parse(cur.renewedAt)) / 60000);
        const why = `bayat — devredildi (${yasDk} dk yenilenmedi, sahip idle)`;
        let isaretId = null;
        try {
          isaretId = L.writeDevir(ROOT, {
            keys: [cur.resource.key],
            gorev: cur.todo || cur.intent || null,
            intent: cur.intent || null,
            todo: cur.todo || null,
            breadth: cur.breadth || null,
            devreden: { ...cur.owner },
            kaynak: "bayat",
          }).id;
        } catch {
          isaretId = null; // işaret yazılamadıysa devri YAPMA (sessiz ezme yasak)
        }
        if (isaretId) {
          L.archiveClaim(ROOT, cur, why);
          const yeni = mkClaim(resource, I);
          if (L.tryCreateClaim(ROOT, yeni) && !mutabakatCekil(yeni, I)) {
            console.log(
              [
                `BAYAT KİLİT DEVRALINDI: ${resource.key}`,
                `  eski sahip: ${short(cur.owner?.sessionId)} — ${cur.intent || "(niyet yok)"}`,
                `  gerekçe: ${why} · eşik ${Math.round(L.DEVREDILEBILIR_ESIK_MS / 60000)} dk`,
                `  eski sahibe devir işareti bırakıldı: ${isaretId} (sessiz ezme yok — ilk yazımında okur)`,
                `  İş bitince BIRAK: node ${process.argv[1]} release --res "${resource.key}"`,
              ].join("\n")
            );
            bitir(0, "devraldi", why);
          }
          // yarışı kaybettik (başkası wx ile kaptı) → normal döngüye devam
        }
      }
    }
    if (!cur) {
      const head = L.queueHead(ROOT, resource.key);
      if (!head || head.sessionId === I.sessionId) {
        if (!acquire) {
          console.log(`SERBEST: ${resource.key} — şimdi claim'le:`);
          console.log(`  node ${process.argv[1]} claim --res "${resource.key}" --intent "<devam eden iş>"`);
          bitir(0, "vazgecti", "--no-acquire: serbest bildirildi, kilit ALINMADI");
        }
        const yeni = mkClaim(resource, I);
        if (L.tryCreateClaim(ROOT, yeni) && !mutabakatCekil(yeni, I)) {
          const niyet = flag("intent");
          console.log(
            [
              `SIRA SENDE — CLAIM ALINDI: ${resource.key}`,
              // Uyanış bağlam TAŞIR: model bekleyişi kurduğu turdan çok sonra uyanır;
              // "ne için bekliyordum" cevabı çıktıda olmazsa todo arkeolojisi gerekir.
              niyet ? `  beklemedeki iş: ${niyet}` : `  Kaynak artık SENİN; beklemedeki todo maddesini şimdi bitir.`,
              `  İş bitince BIRAK: node ${process.argv[1]} release --res "${resource.key}"`,
            ].join("\n")
          );
          bitir(0, "aldi", "sıra geldi — wait kilidi aldı");
        }
        // yarışı kaybettik (başkası wx ile kaptı) → döngüye devam
      }
    }
    /* ÇEVRİM FRENİ — HER turda (claim yolundaki ölçütün AYNISI, tek kaynak: L.waitCycle).
       Yalnız girişte bakmak yetmez: zincir bekleme SIRASINDA da kapanabilir. */
    const cyc = L.waitCycle(ROOT, L.activeClaims(ROOT), I.sessionId, resource.key);
    if (cyc) {
      L.yazOlay(ROOT, {
        tip: "cevrim",
        key: resource.key,
        engellenen: I.sessionId,
        why: `bekleyiş sırasında doğdu · zincir: ${cyc.chain.join(" → ")} · tuttuklarım: ${cyc.release.join(", ")}`,
      });
      console.error(
        [
          `DÖNGÜ (deadlock): ${resource.key} — BEKLEME BİTTİ, çözüm sende.`,
          `  bekleme zinciri: ${cyc.chain.join(" → ")} → (sen)`,
          `  sen ${cyc.release.join(", ")} tutuyorsun; "${resource.key}" sahibi zincir üzerinden onu bekliyor.`,
          `ÇÖZÜM: önce bırak → ${cyc.release.map((k) => `release --res "${k}"`).join(" · ")}, sonra bu wait'i tekrar kur.`,
        ].join("\n")
      );
      bitir(7, "vazgecti", "DÖNGÜ (deadlock) — bekleme kesildi");
    }
    // Sırada kal: kuyruk dosyası başka yazarla yarışıp bizi düşürmüş olabilir.
    const benim = L.queueOf(ROOT, resource.key).find((w) => w.sessionId === I.sessionId);
    if (!benim || !L.waiterActive(benim)) L.enqueue(ROOT, resource.key, entry);
    if (timeout && Date.now() - t0 > timeout * 1000) {
      console.log(`TIMEOUT: ${resource.key} hâlâ meşgul.`);
      bitir(6, "vazgecti", "timeout");
    }
    await sleep(2000);
  }
}

function cmdGc() {
  const dir = L.ledgerDirOf(ROOT);
  const before = (() => {
    try {
      return readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".q.json")).length;
    } catch {
      return 0;
    }
  })();
  const after = L.activeClaims(ROOT).length; // okuma = tembel biçme
  /* Kuyruk süpürmesi CLAIM'DEN yürümez, DİZİNDEN yürür: claim'i bırakılmış anahtarın
     kuyruk dosyası eski sayımda görünmüyordu ve gc "sırada 0 kayıt" diye YALAN söylüyordu. */
  const q = L.gcQueues(ROOT);
  console.log(
    `gc: ${before} kayıt → ${after} aktif (stale olanlar _archive/'e taşındı) · ` +
      `kuyruk: ${q.dosya} dosya · ${q.bicilen} bayat kayıt biçildi` +
      (q.silinen ? ` · ${q.silinen} dosya silindi` : "") +
      ` · ${q.kalan} kayıt kaldı` +
      (q.okunamayan ? ` · ${q.okunamayan} okunamadı (dokunulmadı)` : "")
  );
}

function cmdResources() {
  const keys = Object.keys(RESMAP);
  if (!keys.length) {
    console.log(
      `Bu repoda mantıksal kaynak haritası yok (${join(ROOT, ".claude/claims-resources.json")}).\n` +
        `Yol/glob ile claim'leyebilirsin:  --res "src/app.ts"  ya da  --res "src/**"`
    );
    return;
  }
  console.log(`kaynaklar (${join(ROOT, ".claude/claims-resources.json")}):`);
  for (const k of keys) {
    const r = RESMAP[k];
    console.log(
      `  • ${k}${r.note ? ` — ${r.note}` : ""}` +
        (r.paths?.length ? `\n      yollar: ${r.paths.join(", ")}` : "") +
        (r.bash?.length ? `\n      bash: /${r.bash.join("/ , /")}/` : "") +
        (r.conflictsWith?.length ? `\n      çakışır: ${r.conflictsWith.join(", ")}` : "")
    );
  }
}

/**
 * KİMLİKSİZ sonda: kaynak DEVRALINABİLİR mi? (deterministik, 0 token, session env
 * GEREKTİRMEZ — Maestro `when-shell` koşulu daemon ortamında koşar, orada
 * CLAUDE_CODE_SESSION_ID yoktur.)
 *
 * Ölçüt üç parça: (1) aynı anahtar tutulmuyor, (2) GERÇEK çakışan kaynak tutulmuyor
 * (yol kesişimi ∨ conflictsWith — claim yolundaki ölçütün AYNISI), (3) önünde AKTİF
 * bekleyen yok (varsa ateşlenen iş kuyruğun arkasına düşerdi — boşa spawn). İşaret
 * kayıtları saymaz: devret'in kendi işareti kendi sondasını bloke etseydi devir
 * hiç ateşlenemezdi.
 *
 * exit 0 = devralınabilir · 1 = değil (henüz) · 5 = kullanım hatası
 */
function cmdFree() {
  const root = flag("repo") ? L.repoRootOf(resolve(L.expandTilde(flag("repo")))) : ROOT;
  const resmap = flag("repo") ? L.loadResourceMap(root) : RESMAP;
  const resource = resolveRes(flag("res"), root, resmap, root);
  for (const c of L.activeClaims(root)) {
    const cf =
      c.resource.key === resource.key
        ? { why: "aynı kaynak" }
        : L.resourcesConflict(resource, c.resource, resmap);
    if (cf) {
      console.log(`MEŞGUL: ${resource.key} (${c.resource.key} ← ${short(c.owner?.sessionId)} — ${cf.why})`);
      process.exit(1);
    }
  }
  const head = L.queueHead(root, resource.key);
  if (head) {
    console.log(`SIRADA BEKLEYEN VAR: ${resource.key} (${short(head.sessionId)} — ${head.intent || "?"})`);
    process.exit(1);
  }
  console.log(`SERBEST: ${resource.key} — devralınabilir`);
}

/**
 * Bloke parçayı (parça B) Maestro kuyruğuna DEVRET: kaynak devralınabilir olunca
 * (`free` sondası exit 0) iş ateşlenir. `wait`ten farkı: bu oturumun YAŞAMASI
 * GEREKMEZ — bekleyiş süreçte değil iş kuyruğunda taşınır. Bedeli: sıra TUTMAZ
 * (aktif bekleyen her zaman önce alır; sıra istiyorsan wait kur, ikisi birlikte de
 * kurulabilir). Ateşlenen iş claim'i KENDİSİ alır — sonda ile ateş arasındaki yarışı
 * protokol çözer (MEŞGUL görürse wait kurar).
 *
 *   devret --res <k> --gorev "<parça B tarifi>"   → yeni agentic session (goal)
 *   devret --res <k> --text "<metin>" [--session <sid>]  → canlı pane'e enjeksiyon
 *   --kuru  → kuyruğa YAZMAZ, koşacağı komutu basar (prova)
 *
 * Bu komut ajan DOĞURMAZ; işi Maestro'ya YAZAR (aide zamanla üzerinden — Maestro'yla
 * temas sözleşmesi). Doğacak ajanın maliyeti ateş anında, iş kaydında görünür.
 */
function cmdDevret() {
  const I = me();
  const raw = flag("res");
  const resource = resolveRes(raw);
  const gorev = flag("gorev");
  const text = flag("text");
  if (!gorev && !text) {
    console.error('HATA: --gorev "<parça B tarifi>" (agentic) ya da --text "<enjeksiyon>" gerekli.');
    process.exit(5);
  }
  const self = resolve(process.argv[1]);
  const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const probe = `node ${shq(self)} free --res ${shq(resource.key)} --repo ${shq(ROOT)}`;
  const title = flag("title") || `devir: ${resource.key}`;
  /* Kimlik ÖNCE hesaplanır: kuru koşum ıslak koşumun BİREBİR metnini basmalı (yoksa
     "önce bak" yolu gerçekte koşulacak komutu göstermez = kuru koşum yalanlar). */
  const devirId = `${Date.now()}-${String(I.sessionId).slice(0, 8)}`;

  const args = ["zamanla", "add", "--when-shell", probe, "--title", title];
  if (gorev) {
    // Goal önsözü: ateşlenen session ÖNCE işi ÜSTLENİR (dedup), SONRA kaynağı devralır —
    // sonda "serbest" dedi diye kaynak onun değildir; arada başka session kapmış olabilir.
    args.push(
      "--goal",
      [
        `İLK ADIM — işi ÜSTLEN (dedup): node ${self} devir al --id ${devirId}`,
        `ALINAMADI derse İŞ BİTTİ: bu devri başka bir oturum üstlenmiş, aynı işi İKİNCİ KEZ koşma.`,
        `ÖN KOŞUL — kaynağı devral: node ${self} claim --res "${resource.key}" --intent "${title}"`,
        `MEŞGUL derse: aynı komutun wait halini run_in_background ile kur, çıkınca kaynak sendedir.`,
        `İş bitince: node ${self} release --res "${resource.key}"`,
        `GÖREV: ${gorev}`,
      ].join("\n"),
      "--new-cwd",
      ROOT
    );
  } else {
    args.push("--text", text, "--session", flag("session") || I.sessionId, "--cwd", ROOT);
  }

  if (has("kuru")) {
    console.log(
      `KURU KOŞUM — yazılacak iş:\n  aide ${args.map((a) => (/\s/.test(a) ? shq(a) : a)).join(" ")}` +
        (gorev ? `\n  devir işareti: ${devirId} (kuru koşumda YAZILMAZ)` : "")
    );
    return;
  }

  /* ── ÇİFT YOL (aşama 08) ────────────────────────────────────────────────────
     Eskiden devrin TEK taşıyıcısı Maestro'ydu: `aide` yoksa/kuyruk kapalıysa komut
     exit 5 ile ölür, iş de onunla giderdi. Oysa bu planın koşulduğu dönemde metronom
     KİLİTLİ (26 Tem'den beri süreç yok) — yani en çok ihtiyaç duyulan anda devir hiç
     çalışmıyordu. İkinci taşıyıcı: KALICI DEVİR İŞARETİ. Sıra sözleşmedir — işaret
     Maestro'dan ÖNCE yazılır, çünkü yazılamayan işareti telafi edecek bir yol yoktur. */
  let isaret = null;
  if (gorev) {
    try {
      isaret = L.writeDevir(ROOT, {
        id: devirId,
        keys: [resource.key],
        gorev,
        intent: title,
        todo: flag("todo") || null,
        breadth: flag("breadth") || null,
        devreden: I,
        kaynak: "devret",
        maestro: { yazildi: false, jobRef: null },
      });
    } catch (e) {
      // İŞARET DE yazılamadı → gerçekten kaybediyoruz; tek gerçek hata dalı.
      console.error(
        `DEVİR İŞARETİ YAZILAMADI (${e?.code || e?.message || "bilinmeyen"}) — devir KAYDEDİLMEDİ.\n` +
          `  Kaynağı elle beklemek için: node ${self} wait --res "${resource.key}"`
      );
      process.exit(5);
    }
  }

  const r = spawnSync("aide", args, { stdio: "inherit" });
  const maestroOk = !r.error && r.status === 0;
  if (!maestroOk && !isaret) {
    // --text yolu: devredilecek bir İŞ yok (canlı pane'e enjeksiyon), işaret de yazılmadı
    // → eski sözleşme aynen (ilanlı sınır: çift yol yalnız --gorev yolundadır).
    console.error(
      `DEVİR YAZILAMADI (${r.error?.code || `exit ${r.status}`}) — komutu kendin koş:\n` +
        `  aide ${args.map((a) => (/\s/.test(a) ? shq(a) : a)).join(" ")}`
    );
    process.exit(5);
  }
  if (isaret && maestroOk) {
    try {
      L.writeDevir(ROOT, {
        ...JSON.parse(readFileSync(isaret.file, "utf8")),
        maestro: { yazildi: true, jobRef: title },
      });
    } catch {
      /* damga yazılamadı — iş yine iki yoldan da bulunur; hüküm değişmez */
    }
  }

  /* DEFTERE: devredilen iş, üstlenecek birini arayan İŞTİR — orkestratörün görmesi gereken
     tam olarak budur (Maestro ölüyken işin tek bulucusu odur). `why` görevi ve devir id'sini
     taşır: şema sabittir, olay başına yeni alan açılmaz. */
  L.yazOlay(ROOT, {
    tip: "devir",
    key: resource.key,
    engellenen: I.sessionId,
    why: [gorev ? `görev: ${gorev}` : null, isaret ? `devir id: ${devirId}` : null]
      .filter(Boolean)
      .join(" · ") || "devret",
  });

  /* Kuyruk İŞARETİ (devir işaretinden AYRI şey): sahip status'ta "isteyen var" görsün,
     elverişli ilk anda yol versin. Sıra TUTMAZ (pid yok) — devrin sırası iş kuyruğunda.
     Sahibi olan bir kilit varsa haber de düşer: onu bekleyen artık bir DEVREDİLMİŞ iştir. */
  {
    const cur = findClaim(resource, raw);
    if (cur && !L.ownerMatch(cur, I)) isaretBirak(cur, I, title);
    else
      L.enqueue(ROOT, resource.key, {
        sessionId: I.sessionId,
        since: new Date().toISOString(),
        intent: title,
        pid: null,
      });
  }

  if (maestroOk) {
    console.log(
      `DEVREDİLDİ: ${resource.key} — kaynak devralınabilir olunca Maestro ateşler.\n` +
        `  devir işareti: ${devirId} (Maestro ateşlenmezse de iş kayıtlı; üstlenen ilk oturum alır)\n` +
        `  Bu oturum kapanabilir; iş oturumdan bağımsız koşacak. İzleme: aide zamanla list`
    );
    return;
  }
  /* Maestro ÖLÜ ama iş KAYITLI → bu bir hata değil, İKİNCİ YOL. exit 0 (sözleşme
     değişikliği, İLANLI: eskiden 5). Kod tüketicisi yoktu (ölçüldü 2026-07-30:
     `grep -rn devret packages/` → yalnız belge/SKILL/proof; `aide devret` BAŞKA komut). */
  console.log(
    `MAESTRO YAZILAMADI (${r.error?.code || `exit ${r.status}`}) — devir işareti KALDI: ${devirId}\n` +
      `  İş kaybolmadı: açılış-devralma (aşama 06) ya da bu kaynağı bekleyen sıradaki oturum devralır.\n` +
      `  Görmek için: node ${self} devir list   ·   üstlenmek için: node ${self} devir al --id ${devirId}\n` +
      `  Maestro'yu kendin sürmek istersen: aide ${args.map((a) => (/\s/.test(a) ? shq(a) : a)).join(" ")}`
  );
}

/**
 * `devir list [--json]` · `devir al --id <id>` — devir işaretinin İKİ ucu.
 *
 * KİMLİKSİZDİR (`me()` çağrılmaz): `list`i insan da, açılış-devralma da (aşama 06)
 * session ortamı olmadan okuyabilmeli; `al` da yeni doğmuş bir oturumdan koşulur ve
 * kimliği YUMUŞAK okur — kimlik yokluğu üstlenmeyi engellemez (üstlenmenin ölçütü
 * atomik rename'dir, beyan değil).
 */
function cmdDevir() {
  const alt = argv[1] || "list";
  if (alt === "list") {
    const kayitlar = L.listDevir(ROOT);
    if (has("json")) {
      console.log(JSON.stringify({ repo: ROOT, devir: kayitlar }, null, 1));
      return;
    }
    if (!kayitlar.length) {
      console.log("devir işareti yok (üstlenilmeyi bekleyen devredilmiş iş bulunmuyor).");
      return;
    }
    console.log(`devir işareti: ${kayitlar.length} (TTL'siz — kimse otomatik silmez)`);
    for (const d of kayitlar) {
      console.log(
        `  • ${d.id}  [${d.kaynak}]  ${d.keys.join(", ")}  ${dk(d.at)}` +
          (d.limit ? ` · sahip limitli (${d.limit.sinif}${d.limit.resetTs ? `, reset ${new Date(d.limit.resetTs).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : ""})` : "") +
          `\n      devreden: ${short(d.devreden?.sessionId)}` +
          (d.gorev ? `\n      görev: ${String(d.gorev).slice(0, 160)}` : "") +
          (d.intent ? `\n      niyet: ${String(d.intent).slice(0, 120)}` : "") +
          `\n      üstlen: node ${resolve(process.argv[1])} devir al --id ${d.id}`
      );
    }
    return;
  }
  if (alt === "al") {
    const id = flag("id");
    if (!id) {
      console.error("HATA: devir al --id <id> gerekli. Listelemek için: devir list");
      process.exit(5);
    }
    const kayit = L.takeDevir(ROOT, id);
    if (!kayit) {
      /* Tek kazanan kuralı: kaybeden İŞİ YAPMAZ. Bu exit 1'dir, hata değil — goal
         önsözü bunu okuyup turu bitirir (aynı iş iki kez koşulmaz). */
      console.log(`ALINAMADI: ${id} — başka bir oturum üstlenmiş ya da kayıt yok. Bu işi KOŞMA.`);
      process.exit(1);
    }
    console.log(
      `ÜSTLENİLDİ: ${id}\n` +
        `  kaynak: ${kayit.keys.join(", ")}\n` +
        `  görev: ${kayit.gorev || "(tarif yok — niyet: " + (kayit.intent || "?") + ")"}\n` +
        `  Şimdi kaynağı claim'le: node ${resolve(process.argv[1])} claim --res "${kayit.keys[0]}" --intent "${(kayit.intent || "devralınan iş").replace(/"/g, "'")}"`
    );
    return;
  }
  console.error(`Bilinmeyen devir alt-komutu: ${alt}\nKullanım: devir list [--json] · devir al --id <id>`);
  process.exit(5);
}

/**
 * `limit-devir [--kuru]` — TALİMAT KATMANININ ELİ (SKILL bunu söyler).
 *
 * Karar sahipliği KATMANLIDIR ve bu en üst katmandır: model limit uyarısını görünce
 * kendi kilidini bırakır/devreder. Altında nabız-tetikli deterministik ağ (guard
 * `limit_devir` + `ctx` yedeği), en altta SessionEnd `release_all` durur.
 */
function cmdLimitDevir() {
  const I = me();
  const lim = L.sessionInfo(I.sessionId)?.limit || null;
  const askida = L.usageHalt(lim);
  const mine = L.activeClaims(ROOT).filter((c) => c.owner?.sessionId === I.sessionId);
  if (!askida) {
    console.log(
      `LİMİT DEVRİ GEREKMİYOR: bu oturum askıda değil` +
        (lim ? ` (limit alanı: ${lim.sinif}${lim.resetTs ? `, reset ${new Date(lim.resetTs).toISOString()}` : ""} — geçersiz/geçmiş)` : " (limit alanı yok)") +
        `\n  Kilidini yine bırakmak istersen: node ${resolve(process.argv[1])} release --all`
    );
    return;
  }
  if (has("kuru")) {
    console.log(
      `KURU KOŞUM — limit devri (${lim.sinif}):\n` +
        (mine.length
          ? mine.map((c) => `  • devredilecek: ${c.resource.key} — ${c.intent || "(niyet yok)"}`).join("\n")
          : "  (devredilecek kilit yok)")
    );
    return;
  }
  const r = L.limitDevri(ROOT, I);
  console.log(
    `LİMİT DEVRİ (${lim.sinif}): ${r.devredilen.length} kilit devredildi` +
      (r.atlanan.length ? ` · ${r.atlanan.length} ATLANDI (işaret yazılamadı → kilit DURUYOR)` : "") +
      (r.kuyruktanDusen ? ` · ${r.kuyruktanDusen} kuyruk kaydı düştü` : "") +
      r.devredilen.map((d) => `\n  • ${d.key} → devir işareti ${d.id}`).join("") +
      (r.devredilen.length
        ? `\n  Sıradaki bekleyen kaynağı ALIR; iş kaybolmadı (devir list ile görünür).`
        : "")
  );
}

/**
 * `h2-kapi [--json]` — H2'nin ön koşulunu ÖLÇER (otonomi-merdiveni:10.5). Sınıf: **kapı** ·
 * deterministik · 0 token. Eşik altındaysa **exit 1** ve HİÇBİR ŞEY YAZMAZ.
 *
 * Neden bir komut: kilidin kendisi `writeDevir`in içindedir (atlanamaz), ama atlanamayan bir
 * kilit İNSANA ne eksik olduğunu SÖYLEMEZ — "neden açılmıyor" sorusunun cevabı ölçülebilir
 * olmalı. Kapı YAZMAZ ve AÇMAZ: `--onar`/`--zorla` bayrağı YOKTUR, çünkü H2'yi açmak K2'nin
 * (insanın) kararıdır; kapı yalnız mekanik iki engelin durumunu bildirir.
 */
function cmdH2Kapi() {
  const r = L.h2Kapisi(ROOT);
  if (has("json")) {
    console.log(JSON.stringify({ gecti: r.gecti, esikler: { olcumGun: L.H2_OLCUM_GUN, olayAsgari: L.H2_OLAY_ASGARI },
                                 tatbikatDamgasi: L.h2TatbikatYolu(), eksenler: r.eksenler }, null, 1));
    process.exit(r.gecti ? 0 : 1);
  }
  console.log(`H2 KAPISI (bayat kilidi bekleyensiz devretme) — ${r.gecti ? "mekanik engel KALMADI" : "KAPALI"}`);
  for (const e of r.eksenler) {
    const glif = e.hukum === "PASS" ? "✓" : e.hukum === "BEKLIYOR" ? "⋯" : "✗";
    console.log(`  ${glif} ${e.eksen.padEnd(15)} ${e.detay}`);
    if (e.onar) console.log(`      onar: ${e.onar}`);
  }
  console.log(
    r.gecti
      ? `\nGEÇTİ ≠ AÇIK: bu kapı K2'nin üç koşulundan MEKANİK olan ikisini ölçer.\n` +
        `Üçüncüsü (onay kuyruğu) insanın kararıdır — H2 kodu hâlâ YAZILMAMIŞTIR.`
      : `\nH2 yazan kod yolu (kaynak="${L.H2_KAYNAK}") bu kapı geçmeden FIRLATIR — sözleşme değil KOD KİLİDİ.`
  );
  process.exit(r.gecti ? 0 : 1);
}


/* ── MÜKERRER EMEK RAPORU (2026-08-07) ──────────────────────────────────────────
 *
 * SORU: "iki oturum farkında olmadan aynı işi mi yapıyor?"
 *
 * Kilit sistemi DOSYAYI korur, NİYETİ korumaz. Ölçülen kayıp (2026-08-07): iki oturum
 * `claims-lib.mjs`e aynı zombi kuralını bağımsız yazdı, merge çakıştı, bir implementasyon
 * çöpe gitti — ve bu hiçbir yerde GÖRÜNMEDİ, çünkü ikisi de claim almamıştı.
 *
 * ÖLÇÜ: `claim-guard` her oturumun her dosyaya **claim'siz İLK yazımını** deftere düşürür
 * (`tip: "claimsiz"`). Aynı yola ≥2 FARKLI oturum dokunduysa mükerrer emek RİSKİ vardır.
 *
 * HÜKÜM DEĞİL SİNYAL: iki oturum aynı dosyayı meşru sebeplerle de düzenlemiş olabilir
 * (farklı fonksiyonlar, ardışık turlar). Rapor bunu iddia ETMEZ — "bakmaya değer" der.
 * Deterministik · 0 token · salt-okur. */
function cmdMukerrer() {
  const root = ROOT;
  const json = has("json");
  const saatler = Number(flag("saat", 24));
  const esik = Date.now() - saatler * 3600_000;

  const yol = L.olayPath(root);
  let satirlar = [];
  try {
    satirlar = readFileSync(yol, "utf8").trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    /* defter yok → ölçüm yok, hüküm yok */
  }

  const pencere = satirlar.filter((o) => o.tip === "claimsiz" && Date.parse(o.ts) >= esik);
  const yolaGore = new Map();
  for (const o of pencere) {
    if (!o.key) continue;
    if (!yolaGore.has(o.key)) yolaGore.set(o.key, new Map());
    // İlk temas anı korunur — "kim önce girdi" sorusu devir kararında işe yarar.
    const m = yolaGore.get(o.key);
    if (!m.has(o.engellenen)) m.set(o.engellenen, o.ts);
  }
  const riskli = [...yolaGore.entries()]
    .filter(([, m]) => m.size >= 2)
    .sort((a, b) => b[1].size - a[1].size);

  if (json) {
    console.log(JSON.stringify({
      repo: root, pencere_saat: saatler,
      olcum: { claimsiz_yazim: pencere.length, dokunulan_yol: yolaGore.size, riskli_yol: riskli.length },
      riskli: riskli.map(([k, m]) => ({ yol: k, oturumlar: [...m.entries()].map(([sid, ts]) => ({ oturum: sid, ilk: ts })) })),
    }, null, 2));
    return;
  }

  console.log(`mükerrer emek taraması — ${root} · son ${saatler} saat`);
  console.log(`  claim'siz ilk yazım: ${pencere.length} · dokunulan yol: ${yolaGore.size} · RİSKLİ: ${riskli.length}`);
  if (!satirlar.length) {
    console.log("  ölçüm YOK — olay defteri boş (kapı henüz hiç claim'siz yazım görmedi)");
    return;
  }
  if (!riskli.length) {
    console.log("  aynı yola claim'siz dokunan ikinci bir oturum yok.");
    return;
  }
  console.log("");
  for (const [k, m] of riskli.slice(0, 20)) {
    console.log(`  ⚠ ${k}  ← ${m.size} oturum`);
    for (const [sid, ts] of m) console.log(`      ${sid}  ilk temas ${ts}`);
  }
  if (riskli.length > 20) console.log(`  … +${riskli.length - 20} yol daha (--json ile tamamı)`);
  console.log(
    `\nSİNYAL, HÜKÜM DEĞİL: meşru olabilir (farklı fonksiyonlar · ardışık turlar).` +
    `\nÖnce bakılacak yer: aynı yolu tutan oturumların niyetleri → node claim.mjs status`,
  );
}

/**
 * `orkestrator kayit|birak|durum` — sahadaki koordinatör oturumu İLAN eder.
 *
 * Orkestratör, planı yürüten/aşamaları sırayla ateşleyen oturumdur: PM'in projeler-arası
 * ve agentic olanının aksine repo İÇİNDE, elini işe sokmuş ve 0 token. Kayıt olduğu andan
 * itibaren saha olayları (iş bitti · biri bloke oldu · oturum kapandı · iş devredildi)
 * ona KENDİLİĞİNDEN düşer — kimse ona rapor yazmak zorunda değildir.
 *
 * TEK SLOT: canlı bir kayıt varken ikincisi sessizce KAPAMAZ, `--devral` ister. Gerekçe
 * kilitlerdekiyle aynı: sessiz sahip değişimi, haberlerin nereye gittiğini ölçülemez kılar.
 */
function cmdOrkestrator() {
  const alt = argv[1] || "durum";
  if (alt === "durum") {
    const o = L.orkestratorOku(ROOT); // kimliksiz okunur: insan da bakabilmeli
    if (!o) return console.log(`orkestratör: YOK (repo: ${ROOT})`);
    const s = L.sessionInfo(o.sessionId);
    console.log(
      `orkestratör: ${short(o.sessionId)}${s ? ` "${(s.title || "(başlıksız)").slice(0, 56)}" (${s.state})` : ""}\n` +
        `  ${dk(o.since)} kayıtlı${o.kapsam ? ` · kapsam: ${o.kapsam}` : ""}` +
        `${o.devralindi ? ` · devraldı: ${short(o.devralindi)}` : ""}`
    );
    return;
  }
  const I = me();
  if (alt === "birak") {
    console.log(
      L.orkestratorBirak(ROOT, I.sessionId)
        ? "ORKESTRATÖRLÜK BIRAKILDI — saha haberleri artık kimseye düşmüyor."
        : "Sende değil: orkestratör kaydı başkasında ya da hiç yok."
    );
    return;
  }
  if (alt !== "kayit") {
    console.error("Kullanım: orkestrator kayit [--kapsam \"...\"] [--devral] | birak | durum");
    process.exit(5);
  }
  const r = L.orkestratorKayit(ROOT, I, { kapsam: flag("kapsam"), devral: has("devral") });
  if (!r.ok) {
    const s = L.sessionInfo(r.mevcut?.sessionId);
    console.error(
      `ORKESTRATÖR ZATEN VAR: ${short(r.mevcut?.sessionId)}${s ? ` "${(s.title || "").slice(0, 48)}" (${s.state})` : ""}\n` +
        `  ${dk(r.mevcut?.since)} kayıtlı. Gerçekten sen devralacaksan: orkestrator kayit --devral`
    );
    process.exit(3);
  }
  console.log(
    [
      `ORKESTRATÖR SENSİN: ${ROOT}`,
      r.oncekiSahip ? `  devralındı: ${short(r.oncekiSahip)}` : ``,
      `  Saha olayları turlarının başında sana düşecek: iş bitti · bloke · oturum kapandı · devir.`,
      `  Oturum kapanınca kayıt KENDİLİĞİNDEN düşer; erken bırakmak için: orkestrator birak`,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

/**
 * `kutu [--json]` — GELEN KUTUSU: bana ne yazılmış, sahada ne olmuş? (TÜKETMEZ)
 *
 * Haberler zaten her turun başında `claim-guard ctx` ile otomatik basılır ve orada TÜKETİLİR.
 * Bu komut ONDAN AYRIDIR: istediğin an bakarsın, hiçbir şeyi okunmuş saymaz. Gerekçesi
 * kullanıcı isteğidir (2026-08-09): "kendim tetiklediğimde diğer session'ların söylediklerini
 * ve progress'leri görmeliyim" — tetikleyen sensin, kutu SORULUR.
 */
function cmdKutu() {
  const benSid = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  if (!benSid) {
    console.error("HATA: kimlik yok — bu komut bir Claude oturumunun Bash aracından çalışmalı.");
    process.exit(5);
  }
  const gelen = L.bildiriOku?.(ROOT, benSid, { tuket: false }) || [];
  const roller = L.rolleriOf?.(ROOT, benSid) || [];
  let ilerleme = { satirlar: [] };
  if (roller.length) {
    const rolAd = roller.includes("orkestrator") ? "orkestrator" : roller[0];
    const ofset = L.imlecOku?.(ROOT, rolAd);
    const r = L.olayOku?.(ROOT, { ofset: Number.isFinite(ofset) ? ofset : L.olaySonu(ROOT) }) || { satirlar: [] };
    const SUZ = L.ROL_SUZGEC || {}; // `??` değil VARLIK ölçütü — orkestratörün süzgeci bilerek null
    const suz = Object.prototype.hasOwnProperty.call(SUZ, rolAd) ? SUZ[rolAd] : SUZ.varsayilan || null;
    ilerleme = { rol: rolAd, satirlar: suz ? r.satirlar.filter((e) => suz.includes(e.tip)) : r.satirlar };
  }
  if (has("json")) {
    console.log(JSON.stringify({ session: benSid, roller, bildiri: gelen, ilerleme }, null, 1));
    return;
  }
  console.log(`kutu: ${short(benSid)}${roller.length ? ` · roller: ${roller.join(", ")}` : " · rol yok"}`);
  if (!gelen.length) console.log("  bildiri yok");
  for (const b of gelen) {
    const t = b.tip || "sira";
    const kim = short(b.kimden);
    if (t === "elle") console.log(`  ✉ ${kim}${b.key ? ` · ${b.key}` : ""} (${dk(b.ts)}): ${b.mesaj}`);
    else if (t === "bekleyenVar") console.log(`  ⏳ ${b.key} ← ${kim} seni bekliyor (${dk(b.ts)})`);
    else console.log(`  🔓 ${b.key} boşaldı — ${kim} bıraktı (${dk(b.ts)})`);
  }
  if (roller.length)
    console.log(
      `okunmamış ilerleme (${ilerleme.rol}): ${ilerleme.satirlar.length}` +
        (ilerleme.satirlar.length ? ` — ilk turunda otomatik basılacak` : "")
    );
  console.log(`(TÜKETMEZ: bu satırlar bir sonraki turunda yine karşına çıkar.)`);
}

/**
 * `rol kayit|birak|durum --rol <ad>` — kalıcı oturumların ADI.
 *
 * Hex kimlik her oturumda değişir; rol kararlıdır. `orkestrator` komutu bu tablonun
 * `--rol orkestrator` kısayolu olarak YAŞAMAYA DEVAM EDER (eski çağrılar kırılmaz).
 *
 * ÇOĞUL ROLE KAYIT YOK: `worker` slot tutmaz — aynı anda N tane olması normaldir ve tek
 * bir "worker" adresi uydurmak, haberin hangi worker'a gittiğini ölçülemez kılardı.
 */
function cmdRol() {
  const alt = argv[1] || "durum";
  if (alt === "durum" || alt === "list") {
    const roller = L.rolListe(ROOT); // kimliksiz okunur: insan da bakabilmeli
    const benSid = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
    for (const r of roller) {
      if (!r.tekil) {
        const canli = L.liveSessionsIn(ROOT);
        console.log(`  worker      ÇOĞUL — ${canli.length} canlı oturum · adreslenmez (bildir --hedef <id>)`);
        continue;
      }
      const s = r.sahip ? L.sessionInfo(r.sahip.sessionId) : null;
      console.log(
        `  ${r.ad.padEnd(11)} ${
          r.sahip
            ? `${short(r.sahip.sessionId)}${r.sahip.sessionId === benSid ? " «SEN»" : ""}` +
              `${s ? ` "${(s.title || "").slice(0, 36)}"` : ""}${r.sahip.kapsam ? ` · ${String(r.sahip.kapsam).slice(0, 40)}` : ""}`
            : `— (boş) · ${r.ne}`
        }`
      );
    }
    return;
  }
  const I = me();
  const ad = flag("rol");
  if (!ad) {
    console.error(`Kullanım: rol kayit --rol <${Object.keys(L.ROLLER).join("|")}> [--kapsam "..."] [--devral] | rol birak --rol <ad> | rol durum`);
    process.exit(5);
  }
  if (alt === "birak") {
    console.log(
      L.rolBirak(ROOT, ad, I.sessionId)
        ? `ROL BIRAKILDI: ${ad}`
        : `Sende değil: ${ad} rolü başkasında ya da hiç kayıtlı değil.`
    );
    return;
  }
  if (alt !== "kayit") {
    console.error("Kullanım: rol kayit|birak|durum");
    process.exit(5);
  }
  const r =
    ad === "orkestrator"
      ? L.orkestratorKayit(ROOT, I, { kapsam: flag("kapsam"), devral: has("devral") })
      : L.rolKayit(ROOT, ad, I, { kapsam: flag("kapsam"), devral: has("devral") });
  if (!r.ok) {
    if (r.neden === "tanimsiz")
      console.error(`TANIMSIZ ROL: "${ad}" — kapalı küme: ${r.roller.join(" · ")}`);
    else if (r.neden === "cogul")
      console.error(
        `ÇOĞUL ROL: "${ad}" slot TUTMAZ (aynı anda N tane olur, bu normaldir).\n` +
          `  Kayda gerek yok: işini claim'le ve yap. Sana yazacak olan \`bildir --hedef <sessionId>\` kullanır.`
      );
    else {
      const s = L.sessionInfo(r.mevcut?.sessionId);
      console.error(
        `ROL DOLU: ${ad} ← ${short(r.mevcut?.sessionId)}${s ? ` "${(s.title || "").slice(0, 44)}" (${s.state})` : ""}\n` +
          `  ${dk(r.mevcut?.since)} kayıtlı. Gerçekten sen devralacaksan: rol kayit --rol ${ad} --devral`
      );
    }
    process.exit(3);
  }
  console.log(
    [
      `ROL SENDE: ${ad}${r.oncekiSahip ? ` (devralındı: ${short(r.oncekiSahip)})` : ""}`,
      `  ${L.ROLLER[ad].ne}`,
      ad === "orkestrator"
        ? `  Saha olayları turlarının başında sana düşecek (defter beslemesi).`
        : `  Sana \`bildir --rol ${ad} --mesaj "…"\` ile seslenilecek; kutunu her turun başında okursun.`,
      `  Oturum kapanınca kayıt kendiliğinden düşer; erken bırakmak: rol birak --rol ${ad}`,
    ].join("\n")
  );
}

/**
 * `bildir --rol <ad> | --hedef <session> --mesaj "..." [--res <kaynak>]` — ROLLER ARASI EL.
 *
 * Saha olaylarını okuyan koordinatörün "şu oturum devam etsin" diyebileceği kanal. Hedefin
 * posta kutusuna kayıt bırakır; hedef İLK TURUNDA okur (`claim-guard ctx`, tek sefer).
 *
 * İLANLI SINIR — POSTA KUTUSU, ZİL DEĞİL: durmuş bir oturumu UYANDIRMAZ. Uyandırma
 * enjeksiyondur (Maestro) ve o katman ayrıdır/kilitlidir. Hedef canlı değilse komut UYARIR
 * ama YAZAR: oturum geri döndüğünde mesaj orada olsun (haberi düşürmek, sessiz kayıptır).
 * Kimseye özel yetki gerekmez — orkestratör olmayan da kullanabilir; koordinasyon tek
 * yönlü bir ayrıcalık değildir.
 */
function cmdBildir() {
  const I = me();
  const mesaj = flag("mesaj");
  const rol = flag("rol");
  let hedef = flag("hedef");
  if ((!hedef && !rol) || !mesaj) {
    console.error('Kullanım: bildir (--rol <ad> | --hedef <sessionId>) --mesaj "<metin>" [--res <kaynak>]');
    process.exit(5);
  }
  /* ROL ÇÖZÜMÜ — BELİRSİZLİKTE ADRES ÜRETİLMEZ. "En iyi tahmin" bir muhatap seçmek,
     haberin sessizce yanlış oturuma gitmesi demektir; yanlış adres, adressizlikten beterdir
     çünkü gönderen "ilettim" sanır (kullanıcı kararı 2026-08-09: çoğul rolde karışıklığı
     ÖNLE). Bu yüzden çözülemeyen her hâl exit 5 ile ve NEDENİYLE durur. */
  if (rol) {
    const c = L.rolCoz(ROOT, rol);
    if (!c.ok) {
      if (c.neden === "tanimsiz") console.error(`TANIMSIZ ROL: "${rol}" — kapalı küme: ${c.roller.join(" · ")}`);
      else if (c.neden === "cogul")
        console.error(
          `ÇOĞUL ROL: "${rol}" adreslenemez — aynı anda N tane olabilir ve hangisi olduğu ÖLÇÜLEMEZ.\n` +
            `  Muhatabı sen seç: node ${process.argv[1]} status  →  bildir --hedef <sessionId>` +
            (c.adaylar?.length
              ? `\n  canlı oturumlar:\n` +
                c.adaylar.map((s) => `    ${short(s.sessionId)} "${(s.title || "").slice(0, 48)}" (${s.state})`).join("\n")
              : "")
        );
      else console.error(`ROL SAHİPSİZ: "${rol}" — o rolü üstlenmiş canlı oturum yok (rol durum ile bak).`);
      process.exit(5);
    }
    hedef = c.sessionId;
  }
  if (hedef === I.sessionId) {
    console.error("HATA: hedef SENSİN — kendine bildiri yazmak gürültüdür.");
    process.exit(5);
  }
  const s = L.sessionInfo(hedef);
  const key = flag("res") ? resolveRes(flag("res")).key : null;
  const yazildi = L.bildir(ROOT, {
    hedef,
    tip: "elle",
    key,
    kimden: I.sessionId,
    kimdenBaslik: L.sessionInfo(I.sessionId)?.title || null,
    mesaj: String(mesaj),
  });
  if (!yazildi) {
    console.error(`BİLDİRİ YAZILAMADI: ${short(hedef)} — kutu açılamadı.`);
    process.exit(5);
  }
  console.log(
    [
      `BİLDİRİ GÖNDERİLDİ → ${rol ? `[${rol}] ` : ""}${short(hedef)}${s ? ` "${(s.title || "(başlıksız)").slice(0, 48)}" (${s.state})` : ""}`,
      key ? `  kaynak: ${key}` : ``,
      s
        ? `  Hedef ilk turunda okuyacak (posta kutusu — ZİL DEĞİL, oturumu uyandırmaz).`
        : `  ⚠ hedef ŞU AN CANLI DEĞİL — mesaj kutuda bekliyor, oturum dönerse okur.`,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

const table = {
  claim: cmdClaim,
  bildir: cmdBildir,
  kutu: cmdKutu,
  rol: cmdRol,
  release: cmdRelease,
  orkestrator: cmdOrkestrator,
  status: cmdStatus,
  wait: cmdWait,
  free: cmdFree,
  devret: cmdDevret,
  devir: cmdDevir,
  "limit-devir": cmdLimitDevir,
  "h2-kapi": cmdH2Kapi,
  gc: cmdGc,
  resources: cmdResources,
  mukerrer: cmdMukerrer,
};
const fn = table[cmd];
if (!fn) {
  console.error(`Bilinmeyen komut: ${cmd}\nKomutlar: ${Object.keys(table).join(" · ")}`);
  process.exit(5);
}
await fn();
