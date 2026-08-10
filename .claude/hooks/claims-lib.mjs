/**
 * claims-lib — eşzamanlı session kilit (claim/lease) defterinin TEK çözümleyicisi.
 *
 * Bu dosya hem sert kapı (claim-guard.mjs) hem protokol CLI'ı (skills/eszamanli/
 * scripts/claim.mjs) tarafından import edilir. İki ayrı implementasyon yazmak
 * drift üretir (Ders 5/9: kapının okuduğu ile aracın yazdığı TEK kaynak olmalı).
 *
 * Defter:  ~/.claude/claims/<repo-slug>/<sha1(resourceKey)>.json
 * Arşiv:   ~/.claude/claims/<repo-slug>/_archive/<sha1>-<ts>.json
 * Harita:  <repo>/.claude/claims-resources.json   (mantıksal kaynak → yol/bash kalıpları)
 *
 * Canlılık ASLA süreyle (TTL/mtime) ölçülmez — Ders 16: dokunulmamayı ölçen kapı
 * gece açık kalan bir session'ın kilidini haksız çalar. Ölçüt gerçek süreçtir:
 * pid canlı mı + süreç başlama zamanı eşleşiyor mu (pid-reuse koruması).
 */

import { homedir } from "node:os";
import { join, dirname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  statSync,
  realpathSync,
  unlinkSync,
  appendFileSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";

export const CLAUDE = join(homedir(), ".claude");
export const CLAIMS_DIR = join(CLAUDE, "claims");
export const STATUS_DIR = join(CLAUDE, "session-status");

export const slugOf = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");

/** Sembolik linkleri çözen kanonik mutlak yol; çözülemezse en azından resolve(). */
export function canonical(p) {
  try {
    return realpathSync.native(resolve(p));
  } catch {
    return resolve(p);
  }
}
const sha1 = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 16);

/* ─────────────────────────── repo kökü ─────────────────────────── */

/**
 * cwd'den yukarı tırmanarak repo KÖKÜNÜ çözer (git spawn etmeden).
 * Worktree'de `.git` bir DOSYADIR (gitdir: …/.git/worktrees/x) → commondir ile
 * ana repoya çıkılır. Gerekçe: worktree farklı cwd taşır ama aynı git-dışı
 * kaynakları (DB, yayın, saved-design.json, :8002) paylaşır; cwd-bazlı slug
 * defteri ikiye böler ve korumayı deler (Ders 11: değişmez her giriş kapısında).
 */
export function repoRootOf(cwd) {
  // KANONİK yol şart: defterin anahtarı budur. resolve() sembolik link ÇÖZMEZ →
  // macOS'ta /var ile /private/var (ya da /tmp ↔ /private/tmp) aynı repoyu İKİ
  // ayrı deftere böler ve korumayı sessizce yok eder (kanıt yakaladı: bir session
  // payload.cwd'den /var/…, diğeri process.cwd()'den /private/var/… türetiyordu).
  // Tek anahtar → realpath (Ders 10-1: bir state'i iki anahtar sürerse biri yalan).
  let dir = canonical(cwd || process.cwd());
  for (let i = 0; i < 40; i++) {
    const g = join(dir, ".git");
    try {
      const st = statSync(g);
      if (st.isDirectory()) return dir;
      if (st.isFile()) {
        const m = readFileSync(g, "utf8").match(/gitdir:\s*(.+)/);
        if (m) {
          const gitdir = resolve(dir, m[1].trim());
          try {
            const cd = readFileSync(join(gitdir, "commondir"), "utf8").trim();
            return dirname(resolve(gitdir, cd));
          } catch {
            return dirname(gitdir);
          }
        }
        return dir;
      }
    } catch {
      /* yok, yukarı çık */
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return resolve(cwd || process.cwd());
}

export const ledgerDirOf = (repoRoot) => join(CLAIMS_DIR, slugOf(repoRoot));

/* ─────────────────────────── canlılık ─────────────────────────── */

let _psCache = null;
let _psOk = false;
/** Tek `ps` snapshot'ı: pid → {ppid, state, start, comm}. Yalnız yavaş yolda çağrılır. */
export function psSnapshot() {
  if (_psCache) return _psCache;
  const m = new Map();
  try {
    const r = spawnSync("ps", ["-axo", "pid=,ppid=,stat=,lstart=,comm="], {
      encoding: "utf8",
      maxBuffer: 8 << 20,
    });
    for (const line of (r.stdout || "").split("\n")) {
      const mt = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
      if (!mt) continue;
      m.set(+mt[1], { ppid: +mt[2], state: mt[3], start: mt[4].trim(), comm: mt[5].trim() });
    }
  } catch {
    /* aşağıda _psOk=false → ölçüm YOK hükmü */
  }
  /* ps'in KENDİSİ snapshot'ta görünmeli. Görünmüyorsa çıktı ya boş ya ayrıştırılamadı
     → "ölçemiyoruz" demektir, "hiçbir süreç canlı değil" DEĞİL. Ayrım şart: ikincisi
     TÜM kilitleri aynı anda biçer (kapı AÇIK fail eder = en kötü yön). */
  _psOk = m.size > 0;
  _psCache = m;
  return m;
}

/** Canlılık ÖLÇÜLEBİLİYOR mu? (ps çalıştı ve ayrıştırıldı) */
export function livenessMeasurable() {
  psSnapshot();
  return _psOk;
}

/**
 * ps önbelleğini boşalt — YALNIZ uzun ömürlü süreçler için (`claim.mjs wait`).
 *
 * Önbellek hook'lar için doğrudur (tek ölçüm, tek karar, süreç ölür). Ama `wait`
 * DAKİKALARCA/SAATLERCE döner ve snapshot ilk turda donuyordu: sahibin süreci sonradan
 * ÖLSE BİLE bekleyen onu canlı görmeye devam ediyordu → kilit biçilmez, bekleyiş sonsuza
 * dek sürerdi (B08-1, bu aşamada ölçüldü). Bekleyişin her turu TAZE ölçüm ister; bu
 * aşamanın SONUCU zaten "sahip ölse/limitlense de kuyruk çözülür"dür.
 */
export function psYenile() {
  _psCache = null;
  _psOk = false;
}

/** Süreç başlama zamanı BİÇİMLENMİŞ bir string'dir; boşluk gürültüsü (ps çıktısının
 *  gün-dolgusu, tr -s, trim farkı) iki yazarı ayrıştırabilir. Karşılaştırma bunu
 *  ölçmemeli: normalize et. Ölçüldü — normalize edilmeden CANLI bir sahibin kilidi
 *  "ölü" sayılıp sessizce biçildi (kapı AÇIK fail eder = en kötü yön). */
const normStart = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * pid + süreç başlama zamanı çifti canlı mı? (pid-reuse'a karşı çift zorunlu)
 *
 * ÖLÇEMEDİĞİMİZDE "ölü" DEMEYİZ. ps çökerse/boş dönerse her pid "yok" görünür ve
 * activeClaims TÜM kilitleri "sahip ölü" diye biçerdi — tek bir ps hatası bütün
 * korumayı aynı anda düşürür (kapı AÇIK fail eder). Ölçüm yoksa hüküm de yoktur:
 * muhafazakâr yön CANLI saymaktır (kilit durur; gerçekten ölüyse `gc` biçer).
 */
export function procAlive(pid, procStart) {
  if (!pid) return false;
  const ps = psSnapshot();
  if (!_psOk) return true; // ölçüm yok → hüküm yok (kilidi koru)
  const p = ps.get(+pid);
  return procKaydiCanli(p, procStart);
}

/** Snapshot kaydından işlevsel canlılık: zombi PID tablosunda dursa da iş yapamaz. */
export function procKaydiCanli(p, procStart) {
  if (!p) return false; // süreç yok → gerçekten ölü
  // Parent henüz reap etmemiş olsa bile Z... süreç işlevsel olarak ölüdür; canlı saymak,
  // sahibi crash eden claim'i sonsuza dek tutar ve wait kuyruğunu dondurur.
  if (String(p.state || "").startsWith("Z")) return false;
  if (procStart && p.start && normStart(p.start) !== normStart(procStart)) return false; // pid geri dönüşmüş
  return true;
}

/** Kendi sürecimin ps damgası — kuyruğa "gerçekten bekliyorum" kanıtı olarak yazılır. */
export function selfProcStart(pid = process.pid) {
  return psSnapshot().get(+pid)?.start || null;
}

/** Süreç ağacını tırmanıp en yakın `claude` atasının {pid,start}'ını bulur. */
export function claudeAncestor(startPid = process.pid) {
  const ps = psSnapshot();
  let pid = +startPid;
  for (let i = 0; i < 30; i++) {
    const p = ps.get(pid);
    if (!p) return null;
    if (/(^|\/)claude$/.test(p.comm) || /(^|\/)claude\s/.test(p.comm + " ")) {
      return { pid, start: p.start };
    }
    if (!p.ppid || p.ppid === pid || p.ppid <= 1) return null;
    pid = p.ppid;
  }
  return null;
}

/* ───────────────────── session-status (Ders 2: ikinci defter YOK) ───────────────────── */

/** Sahibin başlığı/durumu KOPYALANMAZ; okuma anında session-status'tan çözümlenir. */
export function sessionInfo(sessionId) {
  try {
    return JSON.parse(readFileSync(join(STATUS_DIR, `${sessionId}.json`), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Bir session'ın KİMLİĞİ = kendi session-status kaydı (pid + procStart oraya yazılır).
 * İkinci bir kimlik kaynağı icat edilmez (Ders 2). Kayıt yoksa (hook henüz yazmadıysa)
 * süreç ağacındaki claude atasına düşülür — subagent köprüsü de bunu kullanır.
 */
export function identityOf(sessionId, fallbackPid = process.pid) {
  const s = sessionId ? sessionInfo(sessionId) : null;
  if (s?.pid) return { sessionId, pid: s.pid, procStart: s.procStart || null };
  const a = claudeAncestor(fallbackPid);
  return { sessionId, pid: a?.pid || null, procStart: a?.start || null };
}

/**
 * Bu repoda canlı session'lar. ÖLÇÜT session-status dosyasının VARLIĞI DEĞİLDİR
 * (ölçüldü: 136 dosyanın çoğu ölü, bazıları aylardır state:"generating" —
 * crash'te SessionEnd ateşlenmez). Ölçüt: kayıtlı pid gerçekten canlı mı.
 * pid taşımayan kayıt (eski sürüm) canlılığını KANITLAYAMAZ → ölü sayılır.
 */
export function liveSessionsIn(repoRoot) {
  const out = [];
  let files = [];
  try {
    files = readdirSync(STATUS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    let s;
    try {
      s = JSON.parse(readFileSync(join(STATUS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    if (!s?.cwd) continue;
    if (repoRootOf(s.cwd) !== repoRoot) continue;
    if (!procAlive(s.pid, s.procStart)) continue;
    out.push(s);
  }
  return out;
}

/* ─────────────────────────── defter ─────────────────────────── */

function atomicWrite(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${process.hrtime.bigint()}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}

export const claimPath = (dir, key) => join(dir, `${sha1(key)}.json`);

/**
 * Stale claim'i arşivle (tembel biçme — her OKUMA kapısında, tek yerde değil).
 *
 * P5 (2026-07-30): eskiden her arşivleme İKİ dosya doğuruyordu — `_reaped` taşıyan
 * zenginleştirilmiş kopya (`<ts>-<file>`) **ve** orijinalin çıplak rename'i
 * (`<ts>-x-<file>`, sebepsiz). Ölçüldü: 1202 arşiv kaydının 588'i `-x-` ikizi ve
 * `_reaped` taşımayan tam olarak o 588 → "yarısı kayıtsız" görüntüsü bir teşhis
 * DEĞİL, bu fonksiyonun kendi artefaktıydı.
 *
 * Yeni akış TEK dosya bırakır ve yarışı da kapatır: orijinal **doğrudan hedef adına**
 * rename edilir (POSIX: tek kazanan — N eşzamanlı biçici yarışırsa yalnız biri arşiv
 * kaydı doğurur, ötekiler sessiz çıkar), sonra AYNI yol zenginleştirilerek yeniden
 * yazılır. Zenginleştirme başarısız olursa çıplak kayıt yerinde kalır: bilgi eksilir
 * ama KAYIT KAYBOLMAZ ve ikiz yine doğmaz.
 *
 * `queueLen` (A2.5'in ölçüm ihtiyacı): biçme anında kuyrukta kaç AKTİF bekleyen vardı.
 * "Bayat kilitlerin kaçında gerçekten bekleyen vardı" sorusu bu alan olmadan
 * ölçülemiyordu (kuyruk dosyası gc ile siliniyor, arşivde izi kalmıyordu).
 */
function reap(dir, file, claim, why) {
  try {
    const arch = join(dir, "_archive");
    mkdirSync(arch, { recursive: true, mode: 0o700 });
    const ts = Date.now();
    const hedef = join(arch, `${ts}-${file}`);
    try {
      renameSync(join(dir, file), hedef); // SAHİPLENME: kazanan tek olur
    } catch {
      return; // başkası biçti ya da dosya yok → ikinci kayıt doğurmayız
    }
    try {
      claim._reaped = { at: new Date(ts).toISOString(), why, queueLen: queueLenIn(dir, claim?.resource?.key) };
      atomicWrite(hedef, claim); // aynı yolu zenginleştir (ikinci dosya YOK)
    } catch {
      /* çıplak kayıt kaldı — kayıp yok, ikiz de yok */
    }
  } catch {
    /* biçme başarısızsa karar akışı bozulmaz */
  }
}

/** Biçme anındaki AKTİF bekleyen sayısı; ölçülemezse null (tahmin yazılmaz). */
function queueLenIn(dir, key) {
  if (!key) return null;
  try {
    const j = JSON.parse(readFileSync(queuePath(dir, key), "utf8"));
    return pruneQueue(Array.isArray(j?.q) ? j.q : []).filter(waiterActive).length;
  } catch {
    return null;
  }
}

/**
 * Aktif (canlı sahipli) claim'ler. Stale olanlar okurken biçilir.
 * stale ⇔ sahibin pid'i ölü ∨ süreç başlangıcı uyuşmuyor ∨ session-status kaydı
 * silinmiş (temiz SessionEnd) — süre ASLA ölçüt değildir (Ders 16).
 */
export function activeClaims(repoRoot) {
  const dir = ledgerDirOf(repoRoot);
  let files = [];
  try {
    /* `.q.json` KUYRUK dosyalarıdır, claim DEĞİL. Elenmezlerse claim sanılıp
       `owner` taşımadıkları için "sahip ölü" hükmüyle arşive atılırlardı —
       sıra, kullanılmadan önce sessizce ölürdü. */
    files = readdirSync(dir).filter(
      (f) => f.endsWith(".json") && !f.endsWith(".q.json") && !f.includes(".tmp-")
    );
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    let c;
    try {
      c = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      continue;
    }
    /* CLAIM OLMAYANI BİÇME (2026-08-09): biçme kararı yalnız claim ŞEKLİNDEKİ kayda
       uygulanır. Defter köküne düşen yabancı bir `.json` (yanlış konumlanmış kayıt, elle
       bırakılmış not) eskiden "sahip ölü" hükmüyle arşive taşınıyordu — sessiz veri kaybı.
       Ölçülemeyene hüküm verilmez: tanımadığımız dosya ATLANIR, taşınmaz. */
    if (!c?.resource?.key || !c?.owner) continue;
    const o = c.owner;
    if (!procAlive(o.pid, o.procStart)) {
      reap(dir, f, c, "sahip süreci ölü");
      continue;
    }
    if (o.sessionId && !sessionInfo(o.sessionId)) {
      reap(dir, f, c, "session temiz bitti (session-status silinmiş)");
      continue;
    }
    c._file = f;
    out.push(c);
  }
  return out;
}

export function writeClaim(repoRoot, claim) {
  const dir = ledgerDirOf(repoRoot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  atomicWrite(claimPath(dir, claim.resource.key), claim);
}

/** Edinme = exclusive-create (wx). İki session yarışırsa POSIX kaybedeni düşürür. */
export function tryCreateClaim(repoRoot, claim) {
  const dir = ledgerDirOf(repoRoot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(claimPath(dir, claim.resource.key), JSON.stringify(claim, null, 1), {
      flag: "wx",
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}

export function archiveClaim(repoRoot, claim, why = "release") {
  const dir = ledgerDirOf(repoRoot);
  const f = claim._file || `${sha1(claim.resource.key)}.json`;
  reap(dir, f, claim, why);
}

/**
 * Var olan claim'i DİRİLTMEDEN güncelle (kuyruk yazımı için).
 *
 * Yarış: sahip tam bu anda release ederse (claim dosyası arşive rename edilir), koşulsuz
 * bir writeClaim dosyayı ESKİ SAHİPLE yeniden yaratır; sahip canlı olduğu için biçilmez
 * → session sonuna kadar HAYALET KİLİT. Bu yüzden yazım, dosyanın kesintisiz aynı kalmış
 * olmasına bağlanır: ino önce/sonra karşılaştırılır, değiştiyse yazım iptal.
 */
export function updateClaimIfUnchanged(repoRoot, claim, mutate) {
  const dir = ledgerDirOf(repoRoot);
  const file = claimPath(dir, claim.resource.key);
  let tmp;
  try {
    const ino0 = statSync(file).ino;
    const next = mutate({ ...claim, _file: undefined });
    tmp = `${file}.tmp-${process.pid}-${process.hrtime.bigint()}`;
    writeFileSync(tmp, JSON.stringify(next, null, 1), { mode: 0o600 });
    if (statSync(file).ino !== ino0) throw new Error("claim değişti (release/devir)");
    renameSync(tmp, file);
    return true;
  } catch {
    try {
      if (tmp) unlinkSync(tmp);
    } catch {
      /* yut */
    }
    return false;
  }
}

/* ─────────────────── P1: KALP ATIŞI (renewedAt gerçekten yenilenir) ───────────────────
 * `renewedAt` alanı bugüne dek ÖLÜYDÜ: tek yazarı claim yaratımı, sıfır okuyucusu vardı
 * (ölçüldü 2026-07-30 — `grep -rn renewedAt packages/` → 1 yazar, 0 okuyucu). Oysa
 * "sahip tuttuğu kaynağa ŞU AN dokunuyor"un tek ve tam kanıtı kapının `ownerMatch`
 * dalıdır: sahip kendi kilidine yazdığı her an oradan geçer. Kapı o dalda kilide
 * dokunmazsa, P2'nin "yenileme durmuş" hükmü ÖLÇÜLMEYEN bir alana dayanır = uydurma.
 *
 * Yazım primitifi YENİ DEĞİL: `updateClaimIfUnchanged` (ino önce/sonra) — yani "sahip
 * tam o an release etti" yarışı zaten çözülmüş; P1 onun ilk çağıranıdır, DİRİLTMEZ.
 * Throttle durumu claim'in KENDİSİNDE (`renewedAt`) tutulur → ikinci defter yok (Ders 2).
 */
export const KALP_ATISI_MS = 60 * 1000;

/** Kendi claim'ini tazele (≥60 sn geçmişse). Dönüş: yazıldı mı. Hata YUTULUR — dokunuş
 *  başarısız diye kapı asla karar değiştirmez (kapı ürünü kilitlemez). */
export function touchClaim(repoRoot, claim, now = Date.now()) {
  try {
    const t = Date.parse(claim?.renewedAt || claim?.createdAt || "");
    if (Number.isFinite(t) && now - t < KALP_ATISI_MS) return false; // taze → dosyaya dokunma
    return updateClaimIfUnchanged(repoRoot, claim, (k) => ({
      ...k,
      renewedAt: new Date(now).toISOString(),
    }));
  } catch {
    return false;
  }
}

/* ─────────────────────────── kuyruk (sıra) ───────────────────────────
 * Kuyruk KAYNAĞA aittir, claim'e DEĞİL — ayrı dosya: <sha1>.q.json.
 *
 * Gerekçe (ölçüldü): kuyruk claim'in İÇİNDE tutulunca, kilit bırakılınca claim arşive
 * gider ve kuyruk onunla ölür → "sıradaki" diye bir şey kalmaz, boşalanı ilk yoklayan
 * kapar. FIFO bu tasarımda İMKÂNSIZDI (kodda "kuyruk bir sonraki edinmede taşınır"
 * diyen yorum vardı; taşıyan kod hiç yazılmamıştı). Sıra, kilidin ömründen uzun yaşamalı.
 *
 * Bekleyici İKİ cinstir ve ayrımı sıra adaletinin temelidir:
 *  • AKTİF  (pid var, süreç canlı) — `wait` süreci gerçekten dönüyor → SIRA TUTAR.
 *  • İŞARET (pid yok) — kapıda DENY yemiş, "istedim" kaydı → bilgidir, SIRA TUTMAZ.
 * Ölçüt yine süre değil SÜREÇ (Ders 16): vazgeçip yoluna devam etmiş bir session'ın
 * işareti kimseyi bekletmez; ölen bir bekleyici sırayı kilitleyemez.
 */

export const queuePath = (dir, key) => join(dir, `${sha1(key)}.q.json`);

export function readQueue(repoRoot, key) {
  try {
    const j = JSON.parse(readFileSync(queuePath(ledgerDirOf(repoRoot), key), "utf8"));
    return Array.isArray(j?.q) ? j.q : [];
  } catch {
    return [];
  }
}

/** Bekleyici GERÇEKTEN bekliyor mu? Ölçüt: kendi `wait` süreci canlı. */
export function waiterActive(w) {
  return !!(w?.pid && procAlive(w.pid, w.procStart));
}

/**
 * İŞARET ÖMRÜ — pid'siz "istedim" kaydı sonsuza dek yaşamaz.
 *
 * Neden SÜRE, oysa AKTİF bekleyicinin ölçütü SÜREÇ (Ders 16)? Çünkü işaretin ÖLÇÜLECEK
 * bir süreci YOKTUR: session canlıdır ama o kaynağa dönüp dönmeyeceği görülemez. Eski
 * ölçüt ("session canlıysa işaret yaşar") pratikte "sonsuz" demekti — ölçüldü 2026-07-27:
 * agent-ide defterinde 3 işaret 1+ saattir duruyordu, kaynakları çoktan serbest, hiçbiri
 * geri dönmedi. Sıra tutmuyorlardı (activeQueue onları saymaz) ama defteri kirletiyor ve
 * "bekleyen var" izlenimi veriyorlardı.
 *
 * İşaretin TEK işlevi dar bir penceredir: kapıda DENY yiyen session birkaç dakika içinde
 * `wait` kurup İŞARET→AKTİF yükselirse yerini KAYBETMEZ. Pencere kapanınca işaret bilgi
 * olmaktan çıkıp çöp olur. AKTİF bekleyici bu kuraldan MUAFtır — onun ölçütü hâlâ pid.
 */
export const MARKER_TTL_MS = 30 * 60 * 1000;

/** İşaretin süresi doldu mu? Zamanı okunamayan kayıt eski davranışta kalır (biçilmez). */
export function markerExpired(w, now = Date.now()) {
  const t = Date.parse(w?.since || "");
  return Number.isFinite(t) && now - t > MARKER_TTL_MS;
}

/** Ölmüş kayıtları düşür: aktif bekleyicinin wait süreci, işaretçinin session'ı canlı
 *  olmalı — ve işaretin ömrü dolmamış olmalı (MARKER_TTL_MS). */
export function pruneQueue(q, now = Date.now()) {
  return (q || []).filter((w) => {
    if (w?.pid) return procAlive(w.pid, w.procStart);
    if (markerExpired(w, now)) return false;
    const s = w?.sessionId ? sessionInfo(w.sessionId) : null;
    return !!(s && procAlive(s.pid, s.procStart));
  });
}

export function queueOf(repoRoot, key) {
  return pruneQueue(readQueue(repoRoot, key));
}

/** Sırayı TUTANLAR — yalnız aktif bekleyiciler (işaretler sıra tutsa yalan olurdu). */
export function activeQueue(repoRoot, key) {
  return queueOf(repoRoot, key).filter(waiterActive);
}

/** Sıra kimde? İlk aktif bekleyici; yoksa null (kaynak serbestse ilk gelen alır). */
export function queueHead(repoRoot, key) {
  return activeQueue(repoRoot, key)[0] || null;
}

function writeQueueDir(dir, key, q) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!q.length) {
    try {
      unlinkSync(queuePath(dir, key));
    } catch {
      /* yoktu */
    }
    return;
  }
  atomicWrite(queuePath(dir, key), { v: 1, key, q });
}

function writeQueue(repoRoot, key, q) {
  writeQueueDir(ledgerDirOf(repoRoot), key, q);
}

/** Kuyruğa gir. Aynı session iki kez sıra tutmaz; İŞARET → AKTİF yükseltilir (tersi asla). */
export function enqueue(repoRoot, key, entry) {
  const q = queueOf(repoRoot, key);
  const i = q.findIndex((w) => w.sessionId === entry.sessionId);
  if (i < 0) q.push(entry);
  else if (entry.pid && !q[i].pid) q[i] = { ...q[i], pid: entry.pid, procStart: entry.procStart };
  writeQueue(repoRoot, key, q);
  return q;
}

/** Sıradan çık (aldın · vazgeçtin · timeout). Bekleyişin BİTTİĞİ her yolda çağrılır. */
export function dequeue(repoRoot, key, sessionId) {
  const q = queueOf(repoRoot, key).filter((w) => w.sessionId !== sessionId);
  writeQueue(repoRoot, key, q);
}

/**
 * KUYRUK SÜPÜRMESİ — bayat kayıtları diskten SİLER (deterministik, 0 token).
 *
 * `queueOf` tembel biçer ama YAZMAZ: okuma dosyaya dokunmadığı için ölü kayıt defterde
 * kalır. Üstelik eski `gc` kuyruğu yalnız AKTİF CLAIM'İ OLAN anahtarlar için sayıyordu —
 * claim'i bırakılmış bir anahtarın kuyruk dosyası gc'nin gözüne hiç görünmüyordu (ölçüldü
 * 2026-07-27: defterde 3 bayat işaret dururken `gc` "sırada 0 kayıt" dedi). Bu yüzden
 * süpürme CLAIM'DEN DEĞİL, dizindeki `*.q.json` dosyalarından yürür.
 *
 * Bozuk/okunamayan kayıt ATLANIR (silinmez): ölçülemeyen şeye hüküm verilmez.
 */
export function gcQueues(repoRoot, now = Date.now()) {
  return gcQueuesDir(ledgerDirOf(repoRoot), now);
}

/** Dizin-tabanlı süpürme gövdesi — `sweepAllLedgers` slug'dan repoRoot'u GERİ ÇÖZEMEZ
 *  (slug tek yönlüdür), o yüzden gövde dizin üzerinden çalışır; gcQueues delegedir. */
export function gcQueuesDir(dir, now = Date.now()) {
  const rapor = { dosya: 0, bicilen: 0, kalan: 0, silinen: 0, okunamayan: 0 };
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".q.json"));
  } catch {
    return rapor;
  }
  rapor.dosya = files.length;
  for (const f of files) {
    let j = null;
    try {
      j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      rapor.okunamayan++;
      continue;
    }
    if (!j?.key || !Array.isArray(j.q)) {
      rapor.okunamayan++;
      continue;
    }
    const q = pruneQueue(j.q, now);
    rapor.kalan += q.length;
    if (q.length === j.q.length) continue;
    rapor.bicilen += j.q.length - q.length;
    if (!q.length) rapor.silinen++;
    writeQueueDir(dir, j.key, q); // boşalan dosyayı writeQueueDir'ün kendisi siler
  }
  return rapor;
}

/**
 * TÜM KÖKLERİN SÜPÜRMESİ (2026-07-29). Tembel biçme yalnız OKUNAN kökte işler; kimsenin
 * bakmadığı kökteki ölü kilit/işaret biri bakana dek durur (ölçüldü: pm-gelen +
 * soft-resume köklerinde 2 ölü kilit 2 gün bekledi, ancak elle `status` biçti).
 * SessionEnd doğal süpürme noktasıdır: deterministik · async · 0 token.
 * Hüküm semantiği activeClaims ile BİREBİR: ps ölçülemezse procAlive canlı sayar →
 * hiçbir kilit yanlışlıkla biçilmez (kapı açık fail etmez).
 */
export function sweepAllLedgers(now = Date.now()) {
  const rapor = { kok: 0, bicilenClaim: 0, bicilenKuyruk: 0 };
  let dirs = [];
  try {
    dirs = readdirSync(CLAIMS_DIR);
  } catch {
    return rapor;
  }
  for (const d of dirs) {
    const dir = join(CLAIMS_DIR, d);
    let claimFiles = [];
    try {
      claimFiles = readdirSync(dir).filter(
        (f) => f.endsWith(".json") && !f.endsWith(".q.json") && !f.includes(".tmp-")
      );
    } catch {
      continue; // dosya (ör. _archive dışı artık) ya da okunamayan giriş — dizin değilse atla
    }
    rapor.kok++;
    for (const f of claimFiles) {
      let c;
      try {
        c = JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        continue; // ölçülemeyene hüküm yok
      }
      const o = c?.owner || {};
      if (!procAlive(o.pid, o.procStart)) {
        reap(dir, f, c, "sahip süreci ölü (SessionEnd tüm-kök süpürmesi)");
        rapor.bicilenClaim++;
      } else if (o.sessionId && !sessionInfo(o.sessionId)) {
        reap(dir, f, c, "session temiz bitti (SessionEnd tüm-kök süpürmesi)");
        rapor.bicilenClaim++;
      }
    }
    rapor.bicilenKuyruk += gcQueuesDir(dir, now).bicilen;
  }
  return rapor;
}

/** Bu session'ın bu repoda sıra tuttuğu/işaretlediği tüm kaynaklar (SessionEnd temizliği). */
export function queuedKeysOf(repoRoot, sessionId) {
  const dir = ledgerDirOf(repoRoot);
  const out = [];
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".q.json"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if ((j?.q || []).some((w) => w.sessionId === sessionId)) out.push(j.key);
    } catch {
      /* bozuk kayıt */
    }
  }
  return out;
}

/* ═════════════════ OLAY DEFTERİ (aşama 05) — bekleme ÖLÇÜLEBİLİR olsun ═════════════════
 *
 * Bugüne dek bir DENY'in TEK izi kuyruğa bırakılan 30 dk ömürlü İŞARETti (`markWanted`):
 * "X kaç kez Y yüzünden bloke oldu, toplam kaç dakika kaybetti" TÜRETİLEMİYORDU. Kuyruğun
 * `since` alanı bekleyiş bitince siliniyor (kuyruk boşalınca dosya unlink), `_reaped.queueLen`
 * arşive yazılıyor ama hiçbir tüketicisi yok (ölçüldü 2026-08-03: 1734 arşiv kaydının 113'ünde
 * alan var, 80'i null) — yani ölçüm VARDI, defter YOKTU.
 *
 * Bu defter yalnız YAZAR. Hüküm 06'nın (kilit hakemi), eylem hiç kimsenin: hakemin yanlış
 * hükmü çalışan işi öldürür, o yüzden ÖNCE VERİ. `grade` olay ANINDA yazılır — tarihsel
 * kademe dağılımı bedavaya birikir ve 06'nın eşikleri veriyle doğrulanabilir.
 *
 * SINIF: motor · 0 token · taşıyıcı: session-yerleşik (kapı ve CLI ile aynı ömür).
 * FİLİNG SINIFI: **DURUM** — `claims` deseni (`bilgi-sinif.ts`) bu dizinin tamamını zaten
 * DURUM sayar; defter makineye bağlıdır (pid'li olayların kaydı), handover'da TAŞINMAZ.
 *
 * DEĞİŞMEZ (05.4): **kapı ürünü asla kilitlemez.** Yazımın her yolu try/catch; hata sessizce
 * geçilir ve guard'ın kararı defter yüzünden ASLA değişmez. Bu yüzden yazım kararın
 * ARDINDAN, ayrı bir fonksiyonda durur ve dönüşü hiçbir dalda okunmaz.
 *
 * ATOMİKLİK: tek `appendFileSync` çağrısı O_APPEND ile açar; POSIX'te PIPE_BUF'tan (4096 B)
 * küçük tek yazım ATOMİKtir — satırlarımız ~200-300 B. Eşzamanlı yazarlar birbirinin satırını
 * BÖLMEZ. Bu yüzden kilit/tmp+rename gerekmez (ve gerekseydi kapının önünde durmuş olurdu).
 *
 * MUAFİYET (İLANLI): retention/rotation YOKTUR (DURUM sınıfı; ayrı iş). Okuyucu yüzey de
 * yoktur — 06'nın işidir. Geriye dönük veri üretilmez: birikme bugün başlar.
 */
export const OLAY_SURUM = 1;
export const olayPath = (repoRoot) => join(ledgerDirOf(repoRoot), "olay.jsonl");

/**
 * Deftere TEK satır ekle. Dönüş yazıldı mı — ama HİÇBİR çağıran bunu okumaz (05.4).
 * Şema SABİTtir: alanı olmayan olay `null` taşır (eksik alan yerine null → okuyucu tek şema
 * görür). `tip` sözlüğü (2026-08-09'da tamamlandı — defter artık eşzamanlılığın TEK kaynağı,
 * orkestratör beslemesi bunun projeksiyonudur; deftere düşmeyen olay kimseye ulaşmaz):
 *   `deny` kapı reddetti · `mesgul` CLI bloke oldu · `kapanis` bekleyiş bitti (`sonuc`) ·
 *   `claimsiz` claim'siz ilk yazım · `alindi` kilit alındı · `birakildi` kilit bırakıldı ·
 *   `bekleyis` aktif bekleyiş başladı · `devir` iş/kilit devredildi · `cevrim` deadlock görüldü.
 * YENİ TİP EKLERKEN: yalnız buraya ekle — okuyucu (`olayOku`) tipten bağımsızdır, çizim
 * (`claim-guard: sahaBloku`) tanımadığı tipi ham satır olarak basar, yani hiçbir olay DÜŞMEZ.
 */
export function yazOlay(repoRoot, kayit) {
  try {
    if (!kayit?.tip) return false;
    const dir = ledgerDirOf(repoRoot);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const sid8 = (s) => (s ? String(s).slice(0, 8) : null);
    const satir = {
      v: OLAY_SURUM,
      ts: kayit.ts || new Date().toISOString(),
      tip: kayit.tip,
      key: kayit.key ?? null,
      engellenen: sid8(kayit.engellenen),
      sahip: sid8(kayit.sahip),
      why: kayit.why ?? null,
      queueLen: Number.isFinite(kayit.queueLen) ? kayit.queueLen : null,
      grade: kayit.grade ?? null,
      sure_ms: Number.isFinite(kayit.sure_ms) ? kayit.sure_ms : null,
      sonuc: kayit.sonuc ?? null,
    };
    appendFileSync(olayPath(repoRoot), JSON.stringify(satir) + "\n", { mode: 0o600 });
    return true;
  } catch {
    return false; // 05.4: defter kararı ASLA değiştirmez
  }
}

/**
 * BLOKAJ olayı (`deny` ∨ `mesgul`) — kademe ve kuyruk uzunluğu OLAY ANINDA ölçülür.
 *
 * `grade` neden burada: `gradeClaim`in bugüne dek tek çağıranı `claim.mjs`in devir dalıydı ve
 * `BAYAT` kademesi hiç kullanılmıyordu (SKILL.md "BAYAT → DENY" diyor, kodda karşılığı yoktu).
 * Kademeyi olay anında YAZMAK, 06'nın eşiklerini sonradan veriyle doğrulanabilir kılar —
 * bugün hiçbir davranış değişmez.
 */
export function olayBlok(repoRoot, { tip, key, claim, engellenen, sahip, why, now = Date.now() }) {
  try {
    const k = key ?? claim?.resource?.key ?? null;
    yazOlay(repoRoot, {
      ts: new Date(now).toISOString(),
      tip,
      key: k,
      engellenen,
      sahip: sahip ?? claim?.owner?.sessionId ?? null,
      why: why ?? null,
      queueLen: k ? activeQueue(repoRoot, k).length : null,
      grade: claim ? gradeClaim(claim, now) : null,
    });
  } catch {
    /* yut */
  }
}

/**
 * BEKLEYİŞ KAPANIŞI — `since` SİLİNMEDEN önce süreyi kaydet, sonra sıradan çık.
 *
 * Kuyruk boşalınca dosya unlink ediliyor (writeQueueDir), yani "kaç dakika beklendi" bilgisi
 * bekleyiş bittiği anda YOK OLUYORDU. Bu sarmalayıcı `dequeue`'nun tek meşru giriş kapısıdır:
 * önce ölç, sonra düş. Kayıt yalnız GERÇEKTEN sırada olan bir session için doğar (kuyrukta
 * olmayan bir sid için `dequeue` zaten no-op'tur → sahte kapanış satırı üretilmez).
 *
 * Kuyruk HAM okunur (`readQueue`), budanmış değil: kendi kaydım budanmış olsa bile (işaret
 * ömrü dolmuş ∨ ps ölçülemedi) bekleyişin süresi ölçülebilir olmalı.
 *
 * `sonuc`: `aldi` (kilidi aldı) · `devraldi` (bayat kilidi devraldı) · `vazgecti` (timeout ·
 * sinyal · döngü · limit · elle release) · `oldu` (öldü — session bitti/limit devri).
 *
 * `dequeue` try/catch DIŞINDADIR: defter yazılamasa da sıradan çıkış YAPILIR (aksi hâlde
 * ölçüm arızası sırayı dondururdu — kapı ürünü asla kilitlemez).
 */
export function dequeueKapanis(repoRoot, key, sessionId, sonuc, why = null) {
  try {
    const w = readQueue(repoRoot, key).find((x) => x?.sessionId === sessionId);
    if (w) {
      const t = Date.parse(w.since || "");
      yazOlay(repoRoot, {
        tip: "kapanis",
        key,
        engellenen: sessionId,
        why,
        sonuc: sonuc || null,
        sure_ms: Number.isFinite(t) ? Math.max(0, Date.now() - t) : null,
        queueLen: activeQueue(repoRoot, key).length,
      });
    }
  } catch {
    /* yut */
  }
  dequeue(repoRoot, key, sessionId);
}

/* ═════════════════ DEVİR İŞARETİ (T1) — kilidin devri, kuyruğun sırası DEĞİL ═════════════════
 *
 * ÜÇ İŞARET birbirine benzer ve karıştırılırsa biri öbürünü sanıp siler. Ayrım:
 *
 *  • KUYRUK İŞARETİ  (`<sha1>.q.json` → pid'siz kayıt) — "bu kaynağı İSTEDİM".
 *    Ömürlü (MARKER_TTL_MS = 30 dk), sıra TUTMAZ, `gcQueues` biçer.
 *  • DEVİR İŞARETİ   (`devir/<epoch>-<sid8>.json`, BU bölüm) — "bu İŞ devredildi, sahibi
 *    arayan üstlensin". TTL'siz · süreçsiz · kalıcı (ilanlı muafiyet). `gcQueues` ona
 *    ASLA dokunmaz: ayrı ALT DİZİNDE yaşar, `*.q.json` süzgecine hiç girmez.
 *  • DEVİR NOTU      (`<proje>/plans/oturumlar/devir/<ref>.json`, aşama 05) — OTURUMUN
 *    devri; bu dosyayla hiçbir ilişkisi yoktur, adı benzer diye aynı sanılmamalı.
 *
 * Neden TTL'siz: "sıra, kilidin ömründen uzun yaşamalı" dersinin devamı — devredilen iş
 * kaynağın boşalmasından da, devredenin oturumundan da uzun yaşar. Bayat devir kaydını
 * kimse OTOMATİK silmez (MASTER muafiyet 9); yaş İLAN edilir (`devir list`), eskalasyon
 * aşama 09'un işidir.
 *
 * Üstlenme ATOMİKTİR: `takeDevir` kaydı `devir/_archive/`e renameSync eder — POSIX'te tek
 * kazanan. İki session aynı işi birlikte koşamaz (dedup mekanizması bu, niyet beyanı değil).
 */
export const DEVIR_SURUM = 1;
export const devirDirOf = (repoRoot) => join(ledgerDirOf(repoRoot), "devir");
const devirArchiveOf = (repoRoot) => join(devirDirOf(repoRoot), "_archive");

/* ═════════════ H2 KAPISI — sözleşme DEĞİL KOD KİLİDİ (otonomi-merdiveni:10.5) ═════════════
 *
 * K2 (kullanıcı kararı) H2'yi — *bayat kilidi, canlı bir bekleyen OLMADAN, arka planda tarayan
 * bir aktörün devir işaretine çevirmesi* — üç ön koşula bağladı: **≥7 günlük ölçüm** + **canlı
 * tatbikat** + **onay kuyruğu**. Bu üç koşul bugüne dek yalnız BELGEDE yazıyordu.
 *
 * Belgede yazan bir ön koşul, ön koşul DEĞİLDİR: onu atlayan kod derlenir, testler yeşil kalır
 * ve kimse fark etmez. Bu planın kovaladığı hata sınıfının ta kendisi budur — "tüm davranışı
 * varsayımdı" (`ARSIV.md:20`). O yüzden koşul, H2'yi yazabilecek TEK kod yolunun İÇİNE konur.
 *
 * MEKANİZMA: H2 yazımı kendi `kaynak` değerini taşır (`nobet`). `writeDevir` o değeri görürse
 * kapıyı koşar ve GEÇMEZSE FIRLATIR — yani H2 kodu, kapı açılmadan var olamaz. Bugünkü meşru
 * yollar (`devret` · `limit` · `bayat`) bu kapıdan GEÇMEZ ve etkilenmez: onlar H0/H1'dir ve
 * hepsinin arkasında ya insan iradesi ya CANLI bir bekleyen vardır.
 *
 * KAPI GEÇMEK YETMEZ, GEREKLİDİR. Üçüncü koşul (onay kuyruğu) burada ÖLÇÜLMEZ ve bu İLANDIR:
 * ölçeni yoktur, sahibi K2/insandır. Kapı yeşil yandığında H2 "serbest" değil "önündeki iki
 * mekanik engel kalktı" demektir. */
export const H2_KAYNAK = "nobet";        // H2'nin (arka plan nöbetçisi) yazacağı kaynak değeri
export const H2_OLCUM_GUN = 7;           // K2: ≥7 günlük ölçüm
export const H2_OLAY_ASGARI = 100;       // "7 gün geçti ama defter boş" hâlini eler (süre ≠ ölçüm)
/** Canlı tatbikatın (10.2) makine-okunur damgası. GLOBAL: tatbikat repoya özgü bir olguyu
 *  değil, PAYLAŞILAN KODUN davranışını kanıtlar — repo-başına tekrarı anlamsız olurdu. */
export const h2TatbikatYolu = () => join(CLAIMS_DIR, "h2-tatbikat.json");

/**
 * H2 ön koşulu — ÖLÇER ve hüküm verir; hiçbir şey yazmaz/açmaz.
 * @returns {{gecti:boolean, eksenler:Array<{eksen,hukum,detay,onar?}>}}
 */
export function h2Kapisi(repoRoot, now = Date.now()) {
  const eksenler = [];
  const ekle = (eksen, hukum, detay, onar) => eksenler.push({ eksen, hukum, detay, ...(onar ? { onar } : {}) });

  /* (a) ÖLÇÜM SÜRESİ + HACMİ — olay defterinin (05) yaşı ve satır sayısı. */
  let ilk = null, satir = 0;
  try {
    const t = readFileSync(olayPath(repoRoot), "utf8").trim();
    const satirlar = t ? t.split("\n") : [];
    satir = satirlar.length;
    for (const s of satirlar) { try { const ts = Date.parse(JSON.parse(s)?.ts); if (Number.isFinite(ts)) { ilk = ts; break; } } catch { /* bozuk satır atlanır */ } }
  } catch { /* defter yok */ }

  if (ilk == null) {
    ekle("olcum-suresi", "FAIL", "olay defteri yok ya da ts'li kayıt taşımıyor — ölçüm HİÇ başlamamış",
         "defter 05'in kapısıyla kendiliğinden dolar; H2 için beklemek gerekir");
  } else {
    const gun = (now - ilk) / 86_400_000;
    ekle("olcum-suresi", gun >= H2_OLCUM_GUN ? "PASS" : "FAIL",
         `defter ${gun.toFixed(1)} gündür yazıyor (gereken ≥${H2_OLCUM_GUN})`,
         gun >= H2_OLCUM_GUN ? undefined : `${Math.ceil(H2_OLCUM_GUN - gun)} gün daha ölçüm gerekir — kısayolu YOK`);
  }
  ekle("olcum-hacmi", satir >= H2_OLAY_ASGARI ? "PASS" : "FAIL",
       `${satir} olay kaydı (gereken ≥${H2_OLAY_ASGARI})`,
       satir >= H2_OLAY_ASGARI ? undefined : "süre tek başına ölçüm değildir: defterde gerçek trafik olmalı");

  /* (b) CANLI TATBİKAT ARTEFAKTI — 10.2'nin makine-okunur damgası. */
  let tat = null;
  try { tat = JSON.parse(readFileSync(h2TatbikatYolu(), "utf8")); } catch { /* yok */ }
  const tatOk = !!(tat && tat.gecti === true && tat.kalan === 0);
  ekle("canli-tatbikat", tatOk ? "PASS" : "FAIL",
       tatOk ? `tatbikat damgası var (${tat.at} · ${tat.gecen} ölçüt)` : "canlı devir tatbikatı damgası YOK ya da BAŞARISIZ",
       tatOk ? undefined : `tatbikatı koş: otonomi-merdiveni:10.2 (damga → ${h2TatbikatYolu()})`);

  /* (c) ONAY KUYRUĞU — İLANLI KÖR NOKTA: ölçeni yok, sahibi K2/insan. Hükme GİRMEZ ama
     görünür kalır; ölçülmeyeni sessizce "yok" saymak kapıyı yalanlaştırırdı. */
  ekle("onay-kuyrugu", "BEKLIYOR", "K2'nin üçüncü koşulu — bu kapı ölçmez, sahibi İNSAN",
       "H2 açılacaksa onay kuyruğu tasarımı ayrı bir karardır (🔴 valf)");

  const olculen = eksenler.filter((e) => e.hukum !== "BEKLIYOR");
  return { gecti: olculen.every((e) => e.hukum === "PASS"), eksenler };
}

/** Devir işareti yaz. Dönüş: `{id, file}` · yazılamazsa fırlatır (çağıran hüküm verir). */
export function writeDevir(repoRoot, kayit) {
  /* H2 KİLİDİ — kapıyı geçmeyen bir nöbetçi devir işareti YAZAMAZ (10.5). Fırlatmak
     KASITLI: `writeDevir`in çağıranları zaten "işaret yazılamadıysa devri YAPMA" dalını
     taşır (proof ㉑c) → kapı kapalıyken H2 sessizce yarım iş bırakamaz, hiç başlayamaz. */
  if (kayit?.kaynak === H2_KAYNAK) {
    const k = h2Kapisi(repoRoot);
    if (!k.gecti) {
      const kalan = k.eksenler.filter((e) => e.hukum === "FAIL").map((e) => e.eksen).join(", ");
      throw new Error(`H2 KAPALI (kod kilidi · otonomi-merdiveni:10.5) — karşılanmayan ön koşul: ${kalan}. ` +
                      `Ölç: claim.mjs h2-kapi --json · K2: ≥7 gün ölçüm + canlı tatbikat + onay kuyruğu`);
    }
  }
  const dir = devirDirOf(repoRoot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sid8 = String(kayit?.devreden?.sessionId || "anon").slice(0, 8);
  const id = kayit.id || `${Date.now()}-${sid8}`;
  const tam = {
    v: DEVIR_SURUM,
    id,
    keys: Array.isArray(kayit.keys) ? kayit.keys : [kayit.keys].filter(Boolean),
    gorev: kayit.gorev ?? null,
    intent: kayit.intent ?? null,
    todo: kayit.todo ?? null,
    breadth: kayit.breadth ?? null,
    devreden: kayit.devreden || null,
    at: kayit.at || new Date().toISOString(),
    kaynak: kayit.kaynak || "devret", // devret | limit | bayat
    limit: kayit.limit ?? null,
    maestro: kayit.maestro ?? null,
  };
  atomicWrite(join(dir, `${id}.json`), tam);
  return { id, file: join(dir, `${id}.json`) };
}

/**
 * Üstlenilmeyi bekleyen devir işaretleri (en yeni ÖNCE).
 * BOZUK KAYIT ATLANIR, SİLİNMEZ: ölçülemeyene hüküm verilmez (defter kuralı).
 */
export function listDevir(repoRoot) {
  const dir = devirDirOf(repoRoot);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes(".tmp-"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (j && j.v === DEVIR_SURUM && j.id) out.push(j);
    } catch {
      /* bozuk kayıt: atla, dokunma */
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * İşi ÜSTLEN — atomik: kayıt `devir/_archive/`e rename edilir, kazanan tektir.
 * Dönüş: kayıt (üstlendin) | null (başkası aldı ∨ hiç yoktu). Kaybeden İŞİ YAPMAZ.
 */
export function takeDevir(repoRoot, id) {
  if (!id) return null;
  const src = join(devirDirOf(repoRoot), `${id}.json`);
  let kayit = null;
  try {
    kayit = JSON.parse(readFileSync(src, "utf8"));
  } catch {
    return null;
  }
  try {
    const arch = devirArchiveOf(repoRoot);
    mkdirSync(arch, { recursive: true, mode: 0o700 });
    renameSync(src, join(arch, `${Date.now()}-${id}.json`)); // tek kazanan (POSIX)
  } catch {
    return null; // yarışı kaybettik
  }
  return kayit;
}

/** Bu session'ın KİLİDİ DEVREDİLMİŞ mi? (denyText "sessiz ezme yok" bloğunun kaynağı) */
export function devirOfSession(repoRoot, sessionId) {
  if (!sessionId) return [];
  return listDevir(repoRoot).filter((d) => d?.devreden?.sessionId === sessionId);
}

/* ═════════════════ P2: BAYATLIK — canlılıktan AYRI eksen ═════════════════
 *
 * Bayatlık kilidi SİLMEZ; yalnız DEVİR HAKKI doğurur ve devir asla sessiz olmaz.
 * pid-canlılık değişmezi İHLAL EDİLMEZ: `activeClaims`/`procAlive` bu eksenden habersizdir
 * (süre oraya ASLA girmez — Ders 16). İki eksen ayrı ölçülür, ayrı hüküm verir.
 *
 * Üç FREN (yanlış pozitif en pahalı hatadır — iki yazar aynı dosyaya girerse koruma
 * tersine döner):
 *  1. `generating` sahip ASLA düşürülmez — çalışan bir iş "bayat" değildir.
 *  2. ÖLÇÜM YOKLUĞU ÖLÜM DEĞİLDİR: ps ölçülemiyorsa · session-status kaydı yoksa ·
 *     `renewedAt` taşımayan legacy kayıtta → TAZE.
 *  3. Bekleyen YOKSA devir hiç doğmaz (bunu `cmdWait` uygular: devir yalnız aktif
 *     bekleyicinin elinde gerçekleşir, arka planda koşan bir zamanlayıcı YOK).
 *
 * Eşikler İLANLI ve kullanıcı onayıyla çivilendi (2026-07-30): p90 = 1 sa 13 dk ölçümüne
 * göre meşru uzun işin kilidi de devredilebilir; telafisi DENY metnindeki
 * "KİLİDİN DEVREDİLDİ" ilanı + yeniden claim yoludur.
 */
export const BAYAT_ESIK_MS = 15 * 60 * 1000;
export const DEVREDILEBILIR_ESIK_MS = 60 * 60 * 1000;

/** TAZE | BAYAT | DEVREDILEBILIR — şüphe daima TAZE yönünde. */
export function gradeClaim(claim, now = Date.now()) {
  if (!livenessMeasurable()) return "TAZE"; // ölçüm yok → hüküm yok
  const t = Date.parse(claim?.renewedAt || "");
  if (!Number.isFinite(t)) return "TAZE"; // legacy kayıt: yenileme izi yok
  const s = claim?.owner?.sessionId ? sessionInfo(claim.owner.sessionId) : null;
  if (!s) return "TAZE"; // sahibin durumu ölçülemiyor
  if (s.state !== "idle" && s.state !== "waiting") return "TAZE"; // generating ∨ tanınmayan
  const yas = now - t;
  if (yas > DEVREDILEBILIR_ESIK_MS) return "DEVREDILEBILIR";
  if (yas > BAYAT_ESIK_MS) return "BAYAT";
  return "TAZE";
}

/* ═════════════════ T3: LİMİT DEVRİ — 27 Tem vakasının katili ═════════════════
 *
 * Vaka: `plan-index` kilidinin sahibi spend-limit'e girdi; pid CANLIYDI (o yüzden kilit
 * DOĞRU biçilmedi) ama süreç iş yapamıyordu → 4 session dondu. Açık sınıf:
 * **canlı-görünen-ama-askıda sahip.**
 *
 * ÖZ-KAPSAM SERTTİR: yalnız KENDİ session'ının kilitleri devredilir. Üçüncü bir tarafın
 * "şu limitli görünüyor" diye başkasının kilidini biçmesi YOKTUR — o, bayatlık ekseninin
 * (P2) dar ve frenli yolundan geçer.
 */

/** Sahip GERÇEKTEN askıda mı? Geçici overload (`diger`) ASLA tetiklemez; bayat limit
 *  alanı da tetiklemez (reset geçmişse pencere kapanmıştır) — yanlış-pozitif kapısı. */
export function usageHalt(limit, now = Date.now()) {
  if (!limit || typeof limit !== "object") return false;
  const s = limit.sinif;
  if (s === "spend") return true; // fatura tavanı: reset penceresi YOK
  if (s !== "weekly" && s !== "session") return false; // `diger` + tanınmayan → hüküm yok
  return Number.isFinite(limit.resetTs) && limit.resetTs > now;
}

/** Bir session'ın limit hâli — kaynak 07'nin yazdığı `session-status/<sid>.json → limit`. */
export function sessionHalted(sessionId, now = Date.now()) {
  return usageHalt(sessionInfo(sessionId)?.limit, now);
}

/**
 * Kendi kilitlerini deterministik olarak DEVRET (idempotent · TEK implementasyon —
 * CLI de guard da burayı çağırır; iki implementasyon drift üretir).
 *
 * Sıra sözleşmedir: (1) devir işareti YAZ, (2) claim'i arşivle, (3) kendi kuyruk
 * kayıtlarını düş. İşaret ÖNCE yazılır — arşivleyip işareti yazamamak işi kaybetmek olurdu.
 */
export function limitDevri(repoRoot, kimlik, now = Date.now()) {
  const rapor = { devredilen: [], atlanan: [], kuyruktanDusen: 0 };
  const lim = sessionInfo(kimlik?.sessionId)?.limit || null;
  for (const c of activeClaims(repoRoot)) {
    if (!c.owner?.sessionId || c.owner.sessionId !== kimlik?.sessionId) continue; // ÖZ-KAPSAM
    let id = null;
    try {
      id = writeDevir(repoRoot, {
        keys: [c.resource.key],
        gorev: c.todo || c.intent || null,
        intent: c.intent || null,
        todo: c.todo || null,
        breadth: c.breadth || null,
        devreden: { ...c.owner },
        kaynak: "limit",
        limit: lim ? { sinif: lim.sinif, resetTs: lim.resetTs ?? null } : null,
        at: new Date(now).toISOString(),
      }).id;
    } catch {
      rapor.atlanan.push(c.resource.key); // işaret yazılamadı → kilidi BIRAKMA (iş kaybolmasın)
      continue;
    }
    archiveClaim(repoRoot, c, "limit devri");
    rapor.devredilen.push({ key: c.resource.key, id });
  }
  /* Kuyruktan düşüş de bir KAPANIŞTIR (05.3): askıya alınan session'ın beklediği kaynağı
     hiç alamadan çekilmesi, "kaç bekleyiş boşa gitti" sorusunun tam da cevabıdır ve
     `since` bu satırda siliniyor. `sonuc:"oldu"` — bekleyen kendi iradesiyle vazgeçmedi,
     limit onu düşürdü (`vazgecti` ile karıştırılmamalı: biri karar, öteki arıza). */
  for (const k of queuedKeysOf(repoRoot, kimlik?.sessionId)) {
    dequeueKapanis(repoRoot, k, kimlik.sessionId, "oldu", "limit devri — sahip askıda");
    rapor.kuyruktanDusen++;
  }
  return rapor;
}

/* ─────────────────────────── sahiplik ─────────────────────────── */

/**
 * Kendi claim'ini kendi kapın reddetmemeli. İki köprü:
 *  1. session_id eşitliği (ana loop),
 *  2. claude ata-pid eşitliği — SUBAGENT'ın kendi session_id'si vardır
 *     (goal-tracker.mjs:120-129'da ölçülmüş), ama aynı claude sürecinde koşar.
 */
export function ownerMatch(claim, me) {
  const o = claim?.owner || {};
  if (me?.sessionId && o.sessionId && me.sessionId === o.sessionId) return true;
  if (me?.pid && o.pid && +me.pid === +o.pid) return true;
  return false;
}

/* ─────────────────────────── kaynak eşleştirme ─────────────────────────── */

export function loadResourceMap(repoRoot) {
  try {
    const j = JSON.parse(readFileSync(join(repoRoot, ".claude", "claims-resources.json"), "utf8"));
    return j?.resources || {};
  } catch {
    return {};
  }
}

const _reCache = new Map();
/** Glob → RegExp. Kontrol-karakteri sentinel YOK: elle tarayıcı (kaynak ASCII kalır). */
function globToRe(g) {
  const hit = _reCache.get(g);
  if (hit) return hit;
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 2; }   // **/ → 0+ dizin
        else { re += ".*"; i += 1; }                          // **  → ayraç dahil her şey
      } else { re += "[^/]*"; }                               // *   → tek segment içinde
    } else if (c === "?") { re += "[^/]"; }
    else { re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&"); }
  }
  const out = new RegExp("^" + re + "$");
  _reCache.set(g, out);
  return out;
}

/* ─────────────────── köprü: plan aşama anahtarı → plan dizini ───────────────────
 * `plan:<slug>:asama:<no>` bu sistemin EN ÇOK claim'lenen anahtarıdır (koşucu · rotacı ·
 * her /goal oturumu), ama `resolveRes` onu tanımadığı için literal "path" tipine düşürüyordu:
 * anahtar `plan:x:asama:1` bir YOL sanılıyor, `plans/x/**` ile hiçbir yönde kesişmiyordu.
 * Sonuç ÖLÇÜLDÜ (2026-08-03): canlı iki session `glob:plans/<slug>/**` tutarken aynı plana
 * `plan:<slug>:asama:<no>` claim'i DENY YEMEDEN geçiyordu — iki aile mekanik olarak birbirini
 * görmüyordu. `tryCreateClaim`in `wx` atomiği yalnız AYNI anahtarın yarışını çözer.
 *
 * Köprü YOL katmanındadır, ikinci bir eşleme tablosunda değil: statik bir `resources` kaydı
 * slug/aşama dinamik olduğu için sayamazdı. Anahtarın KENDİSİNDEN türetildiği için ESKİ claim
 * dosyaları da (type:"path" olarak yazılmış) veri göçü olmadan köprüye girer — çakışma okuma
 * anında hesaplanır.
 *
 * YAN ETKİ, İLANLI: türev yol plan DİZİNİDİR (`plans/<slug>/**`), aşama dosyası değil — yani
 * köprüden sonra AYNI planın iki aşaması da çakışır. Bu KABULdür: iki aşama zaten aynı
 * STATE.md/CHECKLIST.md'ye yazıyordu, paralellik plan-ARASI kalır.
 */
export const PLAN_ASAMA_RE = /^plan:([^:/]+):asama:([^/]+)$/;

/** `plan:<slug>:asama:<no>` → `["plans/<slug>/**"]`; değilse null (köprü yok). */
export function planAsamaPaths(key) {
  const m = PLAN_ASAMA_RE.exec(String(key || ""));
  return m ? [`plans/${m[1]}/**`] : null;
}

/** `glob:plans/<slug>/**` ya da `plan:<slug>:asama:<no>` → slug; değilse null. */
export function planSlugOfKey(key) {
  const k = String(key || "");
  const a = PLAN_ASAMA_RE.exec(k);
  if (a) return { slug: a[1], no: a[2] };
  const g = /^glob:plans\/([^/*?]+)\/\*\*$/.exec(k);
  return g ? { slug: g[1], no: "*" } : null;
}

/** Bir KAYNAĞIN kapsadığı yol kalıpları. Repoya göreli VEYA mutlak (`~/…`, `/…`) olabilir. */
export function pathsOfResource(r, resMap) {
  if (!r) return [];
  // İLAN EDİLMİŞ kaynak her zaman kazanır: köprü yalnız tanınmayan anahtarı kurtarır.
  if (!resMap?.[r.key]) {
    const bridged = planAsamaPaths(r.key);
    if (bridged) return bridged;
  }
  if (r.type === "path") return [r.key];
  if (r.type === "glob") return [r.key.replace(/^glob:/, "")];
  return resMap[r.key]?.paths || [];
}

export function pathsOf(claim, resMap) {
  return pathsOfResource(claim?.resource, resMap);
}

export function bashPatternsOf(claim, resMap) {
  if (claim.resource.type !== "logical") return [];
  return resMap[claim.resource.key]?.bash || [];
}

/* ─────────────────── mutlak (repo-dışı) yol kalıpları ───────────────────
 * Bu sistemin koruduğu kaynakların ÇOĞU repo dışındadır: ~/.claude/pm/defterleri,
 * kaptan modeli, köprü kimliği. Kalıplar repo köküne göreli çözülünce bunların hepsi
 * `..` ile başlar ve eşleşme sessizce elenir → koruma İLAN EDİLİR ama YOKTUR.
 * (Ölçüldü: `pm:kadran` claim'liyken `Edit ~/.claude/pm/ayar.json` kapıdan geçiyordu.)
 * Bu yüzden kalıp mutlaksa mutlak yolla, göreliyse göreli yolla ölçülür.
 */
const isAbsPattern = (p) => p.startsWith("~/") || p === "~" || p.startsWith(sep);

export const expandTilde = (p) =>
  p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const _absPatCache = new Map();
/**
 * Mutlak kalıbı kanonikleştir: `~` genişletilir, glob İÇERMEYEN en derin var-olan önek
 * realpath'lenir. Sembolik link farkı (macOS /var ↔ /private/var, ~/.claude bir link
 * olabilir) yoksa eşleşme sessizce kaçar — hedef yol zaten kanonikleştiriliyor, kalıp
 * kanonikleşmezse iki taraf farklı dilde konuşur.
 */
function canonicalPattern(p) {
  const hit = _absPatCache.get(p);
  if (hit) return hit;
  const ex = resolve(expandTilde(p));
  const segs = ex.split(sep);
  let glob = segs.length;
  for (let k = 0; k < segs.length; k++) {
    if (/[*?]/.test(segs[k])) {
      glob = k;
      break;
    }
  }
  let out = ex;
  for (let j = glob; j > 0; j--) {
    try {
      const real = realpathSync.native(segs.slice(0, j).join(sep) || sep);
      out = [real, ...segs.slice(j)].join(sep);
      break;
    } catch {
      /* bu önek yok → bir üste çık */
    }
  }
  _absPatCache.set(p, out);
  return out;
}

/* ─────────────────── politika: GERÇEK çakışma ───────────────────
 * "Kilit ancak iki iş birbirini gerçekten kesiyorsa" — kesişmenin ölçütü ANAHTAR EŞİTLİĞİ
 * DEĞİLDİR. `pm:defter` ile `~/.claude/pm/log.jsonl` farklı anahtarlardır ama AYNI dosyayı
 * sürer; bugün ikisi de claim edilebiliyor ve iki session da "sahibim" sanıyor. Çakışma
 * üç kaynaktan türer: aynı anahtar · yol kesişimi · İLAN EDİLMİŞ ilişki (conflictsWith).
 *
 * conflictsWith, yolların ifade EDEMEDİĞİ ilişkinin yeridir: "A bitmeden B anlamsızdır"
 * (öncül/precursor) ya da "A koşarken B'nin çıktısı bozulur". Yol kesişimi mekanik olarak
 * görülebilir; öncüllük görülemez — BEYAN edilir.
 */

/** İki kalıp kesişebilir mi? YALNIZ SAĞLAM durumlarda true. */
export function patternsOverlap(p, q) {
  if (p === q) return true;
  const lit = (s) => !/[*?]/.test(s);
  const norm = (s) => (isAbsPattern(s) ? canonicalPattern(s) : s);
  const [a, b] = [norm(p), norm(q)];
  if (isAbsPattern(p) !== isAbsPattern(q)) return false; // biri repoya göreli, biri mutlak → ölçüşmez
  if (lit(a) && lit(b)) return a === b;
  if (lit(a)) return globToRe(b).test(a);
  if (lit(b)) return globToRe(a).test(b);
  /* İki glob: genel glob-kesişimi karar verilebilir değil. `**` içeren desende dizin
     öneki kapsamı SAĞLAM ölçülür; gerisinde şüphe → false. Fazla-blokaj üretmeyiz;
     görülemeyen kesişim conflictsWith ile BEYAN edilir (ve SKILL bunu ilan eder). */
  const base = (s) => s.replace(/\*\*.*$/, "").replace(/[^/]*$/, "");
  const [ba, bb] = [base(a), base(b)];
  if (/\*\*/.test(a) && bb.startsWith(ba)) return true;
  if (/\*\*/.test(b) && ba.startsWith(bb)) return true;
  return false;
}

/**
 * İki kaynak GERÇEKTEN çakışır mı? Dönüş: null | { why }.
 * `why` DENY/MEŞGUL metnine girer — karşıdaki model neden bloke olduğunu bilmeli.
 */
export function resourcesConflict(a, b, resMap) {
  if (!a || !b) return null;
  if (a.key === b.key) return { why: "aynı kaynak" };
  const declared = (x, y) => (resMap[x]?.conflictsWith || []).includes(y);
  if (declared(a.key, b.key) || declared(b.key, a.key)) {
    const note = resMap[a.key]?.conflictsWith?.includes(b.key) ? resMap[a.key]?.note : resMap[b.key]?.note;
    return { why: `ilan edilmiş çakışma (conflictsWith)${note ? ` — ${note}` : ""}` };
  }
  for (const p of pathsOfResource(a, resMap)) {
    for (const q of pathsOfResource(b, resMap)) {
      if (patternsOverlap(p, q)) {
        /* Köprü devredeyse SEBEBİ SÖYLE: karşıdaki model "plan:x:asama:1 ile
           glob:plans/x/** neden çakıştı" sorusunu kendi başına çözemez, ve aynı planın
           İKİ AŞAMASININ da çakıştığını (İLANLI yan etki) burada öğrenir. */
        const pa = planSlugOfKey(a.key);
        const pb = planSlugOfKey(b.key);
        if (pa && pb && pa.slug === pb.slug) {
          return {
            why:
              `plan kilidi: ikisi de \`plans/${pa.slug}/**\` sürüyor ` +
              `(${a.key} ∩ ${b.key}) — plan kilidi AŞAMA değil PLAN düzeyindedir, ` +
              `çünkü iki aşama aynı STATE.md/CHECKLIST.md'ye yazar. Paralellik plan-ARASIdır.`,
          };
        }
        return { why: `yol kesişimi: ${p} ∩ ${q}` };
      }
    }
  }
  return null;
}

/* ─────────────────── salt-okunur komut dedektörü ───────────────────
 * KİLİT YAZIMI KORUR, OKUMAYI DEĞİL. Bash deseni "bu komut kaynağı SÜRÜYOR mu"
 * sorusunun vekilidir; ama regex komutun TAMAMINA bakar → kaynağın adını yalnızca
 * ANAN salt-okunur bir komut (grep/cat/git log) da DENY yerdi. Ölçüldü (2026-07-16):
 * bir `grep` 4 session'ı 35 dk durdurdu; hatayı ANLATAN bir mesaj bile (adı metninde
 * geçtiği için) reddedildi. Okuma hiçbir kaynağı mutasyona uğratmaz → beklemesi anlamsız.
 *
 * FAIL-SAFE YÖN (kritik): tanımadığın komut YAZAR sayılır. Bu liste hiçbir şeyi
 * sıkılaştırmaz, yalnız BİLİNEN-GÜVENLİ okumayı gevşetir → listeye girmeyen her şey
 * bugünkü davranışı korur. (Ders 15'in güvenli yönü: eksik liste FAZLA blokaj üretir,
 * ASLA eksik-blokaj.)
 */
const RO_BINS = new Set([
  "grep", "egrep", "fgrep", "rg", "ag", "cat", "bat", "head", "tail", "less", "more",
  "wc", "ls", "stat", "file", "du", "df", "tree", "jq", "yq", "cut", "sort", "uniq",
  "tr", "column", "basename", "dirname", "realpath", "readlink", "pwd", "cd", "echo",
  "printf", "date", "which", "type", "command", "diff", "comm", "shasum", "sha1sum",
  "sha256sum", "md5", "md5sum", "cksum", "true", "false", "test", "env", "printenv",
  "ps", "whoami", "hostname", "uname", "man",
]);
/** git alt-komutları: yalnız OKUYANLAR (checkout/commit/reset/clean… YAZAR). */
const RO_GIT = new Set([
  "log", "show", "diff", "status", "ls-files", "ls-tree", "rev-parse", "rev-list",
  "cat-file", "blame", "describe", "shortlog", "grep", "remote", "config", "branch",
  "tag", "reflog", "whatchanged", "name-rev", "check-ignore", "var",
]);

/** Komutu segmentlere ayırır (`;` `&&` `||` `|` · satır sonu). Kabuk yapısı ÖLÇÜLEMİYORSA
 *  (komut ikamesi · yönlendirme · heredoc) `null` döner = "hüküm verme, yazar say". */
function bashSegments(command) {
  const raw = String(command || "");
  if (!raw.trim()) return [];
  /* Komut İKAMESİ içini ölçemeyiz ve argüman olarak HER YERDE durabilir → yazar say.
     (eval · xargs · sudo · source · `.` · bash -c ayrıca segment döngüsünde elenir:
     RO_BINS'te yoklar. Burada tekrar ARAMA — ölçüldü: `grep … . | head`in yol argümanı
     olan `.` "source" sanılıp salt-okunur bir komut DENY yedi.) */
  if (/\$\(|`/.test(raw)) return null;
  /* Yönlendirme: `2>/dev/null` · `>/dev/null` · `2>&1` zararsız (hiçbir kaynağa yazmaz);
     KALAN her `>` / `>>` / tee bir YAZIMdır. Heredoc (<<) dosya üretebilir. */
  const norm = raw.replace(/\d?>\s*\/dev\/null/g, " ").replace(/\d?>&\d/g, " ");
  if (/>|\btee\b|<</.test(norm)) return null;
  const segs = splitSegments(norm);
  if (segs === null) return null;
  return segs.length ? segs : null;
}

/** `;` `|` `&` ve satır sonundan böler — TIRNAK İÇİNİ ayırıcı SAYMAZ.
 *  Neden: kör bölme, argümanının içinde `|` geçen salt-okunur komutu ikiye kesiyordu —
 *  `grep -rn "a\|b" yol` ikinci parçası `b" yol` olarak "tanınmayan binary" → yazar → DENY
 *  (ölçüldü 2026-07-27; kilitli bir yolu ANAN bir grep reddedildi, emsali 2026-07-16'da
 *  4 session'ı 35 dk durdurmuştu). Tırnak DENGESİZSE hüküm verilmez → null = yazar say.
 *  Yön güvenli: tırnak içi bash'te de çalıştırılmaz, yani gizlenmiş bir yazar segment
 *  zaten yoktur; tırnak dışındaki her yazar segment eskisi gibi ölçülür. */
function splitSegments(s) {
  const out = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "\\") { cur += ch + (s[i + 1] ?? ""); i++; continue; } // kaçırılmış ayırıcı literaldir
    if (ch === ";" || ch === "|" || ch === "&" || ch === "\n") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (q) return null; // dengesiz tırnak → ölçülemez
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Segmentin `FOO=bar` öneklerini atlayıp [binary, …argümanlar] döner. */
function segTokens(seg) {
  const toks = seg.split(/\s+/).filter(Boolean);
  let i = 0;
  while (toks[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
  return toks.slice(i);
}

/** Tek segment hiçbir şey yazmıyor mu? (fail-safe: tanımadığın binary YAZARdır) */
function segReadOnly(seg) {
  const toks = segTokens(seg);
  const bin = (toks[0] || "").replace(/^.*\//, ""); // yol → binary adı
  if (!bin) return false;
  if (bin === "git") return RO_GIT.has(toks[1]);
  if (bin === "sed") return !/(^|\s)-[a-z]*i/.test(seg); // sed -i YAZAR
  if (bin === "awk") return true; // `print > f` yönlendirme kontrolüne takılır
  if (bin === "find") return !/-delete|-exec|-execdir|-ok|-fprint/.test(seg);
  return RO_BINS.has(bin);
}

/**
 * Komut HİÇBİR ŞEY yazmıyor mu? true → kilit kapısı onu ölçmez (geçer).
 * Bilinçli KATIDIR: şüphe = false (yazar say).
 */
export function isReadOnlyBash(command) {
  const segs = bashSegments(command);
  if (segs === null) return false;
  if (!segs.length) return true; // boş komut
  return segs.every(segReadOnly);
}

/* ─────────────────── protokolün KENDİ komutu ───────────────────
 * KAPI KENDİ ÇARESİNİ REDDEDEMEZ. DENY metni "sıraya girmek için `claim.mjs wait --res
 * <kaynak>` koş" diyor; ama o komut kilitli YOLU argüman olarak anıyor ve `node` RO_BINS'te
 * olmadığı için "yazar bash" sayılıyordu → çarenin kendisi kapıda ölüyordu (ölçüldü
 * 2026-07-27: kuyruğa girilemedi, sıra yalanlandı, model yolu kabuk değişkenine saklayarak
 * kapıyı dolanmak zorunda kaldı — kapıyı dolandıran bir kapı, kapı değildir).
 *
 * MUAFİYETİN SINIRI (ilan): claim.mjs kilit DEFTERİNE yazar, KİLİTLİ KAYNAĞA değil —
 * gate'in koruduğu şey kaynaktır, defter değil (deftere eşzamanlı yazım claim.mjs'in kendi
 * atomik yazma disiplinine bağlıdır). Muafiyet YALNIZ `…/eszamanli/…/claim.mjs` yolundaki
 * script'e tanınır (adı çakışan başka bir `claim.mjs` kalkan olarak kullanılamasın) ve
 * TEK BİR yazar segment bile varsa DÜŞER: `claim.mjs wait … && rm -rf <claim'li>` DENY yer.
 */
const PROTOKOL_ALT = new Set([
  "status", "claim", "release", "wait", "free", "devret", "gc", "resources",
  /* KAPI ÖNERDİĞİ ÇAREYİ REDDEDEMEZ (2026-07-30 · aşama 08): devir işaretinin iki ucu da
     DENY/MEŞGUL metninde ÖNERİLİR — `devir list` ile sarkık işi görmek, `devir al --id`
     ile üstlenmek, `limit-devir` ile kendi kilidini bırakmak. Üçü de kilit DEFTERİNE yazar,
     kilitli KAYNAĞA değil. Muafiyet aynı DAR sınırlarla: yalnız eszamanli/…/claim.mjs
     yolundaki script ve zincirdeki TEK bir yazar segment bile muafiyeti DÜŞÜRÜR. */
  "devir", "limit-devir",
]);

function segProtokol(seg) {
  let toks = segTokens(seg);
  if ((toks[0] || "").replace(/^.*\//, "") === "exec") toks = toks.slice(1);
  const bin = (toks[0] || "").replace(/^.*\//, "");
  if (bin !== "node" && bin !== "bun") return false;
  const script = (toks[1] || "").replace(/^["']|["']$/g, "");
  if (!/eszamanli[/\\].*claim\.mjs$/.test(script)) return false;
  const alt = toks[2] || "status"; // argümansız çağrı = status
  return PROTOKOL_ALT.has(alt);
}

/** Komut, eşzamanlılık protokolünün kendi CLI'ı mı? (→ kapı ölçmez, geçer) */
export function isProtocolBash(command) {
  const segs = bashSegments(command);
  if (segs === null || !segs.length) return false;
  return segs.some(segProtokol) && segs.every((s) => segProtokol(s) || segReadOnly(s));
}

/* ─────────────────── çevrim (deadlock) tespiti ───────────────────
 * Bekleme grafiği ZATEN defterde yazılı (claim: owner · kuyruk: bekleyenler) → ikinci bir
 * kaynak icat etme, olanı yürü (Ders 17). Soru: `me` `targetKey`'i beklemeye başlarsa
 * çevrim doğar mı? Zincir: owner(target) → onun beklediği kaynaklar → onların sahipleri…
 * Zincir BANA dönüyorsa (benim tuttuğum bir kaynağı bekliyorlar) → DEADLOCK.
 * Pid'ler canlı olduğu için otomatik biçme devreye girmez ve `wait`in varsayılan
 * timeout'u sonsuzdur → tespit edilmezse iki session süresiz döner.
 *
 * ZİNCİR YALNIZ AKTİF BEKLEYİŞTEN kurulur (canlı `wait` süreci). Kapıda bir kez DENY
 * yiyip yoluna devam etmiş bir session "bekliyor" DEĞİLDİR; onun işaretini zincire
 * saymak, hiç kimsenin beklemediği yerde DÖNGÜ hükmü verir ve karşı tarafa haksız yere
 * "tuttuğunu bırak" dedirtir (= yarım kalmış yazım). Deadlock iki tarafın da BLOKE
 * olmasıdır; blokenin ölçütü niyet değil, dönen süreçtir.
 *
 * Dönüş: null (çevrim yok) | { chain:[resourceKey…], release:[benim tuttuğum ve
 * zincirin beklediği kaynaklar] } → "önce şunu bırak" talimatı buradan türer.
 */
export function waitCycle(repoRoot, claims, meSessionId, targetKey) {
  const ownerOf = (k) => (claims.find((c) => c.resource.key === k) || {}).owner?.sessionId;
  const waitsFor = (sid) =>
    claims
      .filter((c) => activeQueue(repoRoot, c.resource.key).some((w) => w.sessionId === sid))
      .map((c) => c.resource.key);
  const heldByMe = new Set(
    claims.filter((c) => c.owner?.sessionId === meSessionId).map((c) => c.resource.key)
  );
  if (!heldByMe.size) return null; // hiçbir şey tutmuyorsam çevrim İMKÂNSIZ
  const seen = new Set();
  const stack = [{ sid: ownerOf(targetKey), chain: [targetKey] }];
  while (stack.length) {
    const { sid, chain } = stack.pop();
    if (!sid || sid === meSessionId || seen.has(sid)) continue;
    seen.add(sid);
    for (const k of waitsFor(sid)) {
      if (heldByMe.has(k)) return { chain: [...chain, k], release: [k] }; // zincir bana döndü
      stack.push({ sid: ownerOf(k), chain: [...chain, k] });
    }
  }
  return null;
}

/**
 * Hedef yolun kanonik hâli. Dosya HENÜZ YOKSA (Write yeni dosya açıyor) realpath
 * başarısız olur → DİZİNİ kanonikleştirip adı ekle; yoksa /var ↔ /private/var farkı
 * eşleşmeyi sessizce kaçırır (= delik).
 */
export function canonicalPath(p) {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    try {
      return join(realpathSync.native(dirname(abs)), abs.split(sep).pop());
    } catch {
      return abs;
    }
  }
}

/** Bir yol kalıbı (göreli ya da mutlak) verilen mutlak yolu kapsıyor mu? */
function patternCoversAbs(p, abs, repoRoot) {
  if (isAbsPattern(p)) return globToRe(canonicalPattern(p)).test(abs);
  const rel = relative(repoRoot, abs);
  if (rel.startsWith("..") || rel.startsWith(sep)) return false; // repo dışı ↔ göreli kalıp: ölçüşmez
  return globToRe(p).test(rel);
}

export function claimCoversPath(claim, absPath, repoRoot, resMap) {
  const abs = canonicalPath(absPath);
  return pathsOf(claim, resMap).some((p) => patternCoversAbs(p, abs, repoRoot));
}

/* ─────────────────── Bash'in dokunduğu yollar ───────────────────
 * `bash` desenleri YALNIZ mantıksal kaynaklarda tanımlıdır → bir dosya/glob claim'i
 * Bash'e karşı çıplaktı: `sed -i … src/app.ts` ya da `echo x > src/app.ts` claim'li
 * dosyayı kapıdan geçerek eziyordu (SKILL bunu delik olarak ilan ediyordu; ilan etmek
 * kapatmak değildir). Yazar bir komutun andığı yol-benzeri argümanlar çıkarılıp claim
 * kalıplarıyla ölçülür.
 *
 * YÖN: salt-okunur komutlar zaten elenir (isReadOnlyBash); kalan komut YAZARdır ve
 * claim'li bir yolu anıyorsa şüphe blokaj yönüne yazılır (`cp claim'li /tmp/yedek`
 * fazladan DENY yer). Ters yön — yazan komutun sessizce geçmesi — telafisizdir.
 */
function bashPathTokens(command) {
  const raw = String(command || "");
  const out = [];
  const add = (t) => {
    if (!t || t.startsWith("-") || t === "/dev/null") return;
    if (!/[/.]/.test(t) || /^\.{1,2}$/.test(t)) return; // yol-benzeri değil ("." / ".." gürültü)
    out.push(t.replace(/^["']|["']$/g, ""));
  };
  for (const m of raw.matchAll(/\d?>>?\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&>]+))/g)) add(m[1] || m[2] || m[3]);
  for (const m of raw.matchAll(/(?:^|\s)(?:"([^"]+)"|'([^']+)'|([^\s;|&<>]+))/g)) add(m[1] || m[2] || m[3]);
  return out;
}

export function claimCoversBash(claim, command, resMap, repoRoot, cwd) {
  /* Kilit YAZIMI korur: salt-okunur komut hiçbir kaynağı sürmez → ölçme, geç.
     (Fail-safe: isReadOnlyBash şüphede false döner = bugünkü davranış korunur.) */
  if (isReadOnlyBash(command)) return false;
  /* Protokolün kendi CLI'ı da geçer — kapı, DENY metninde ÖNERDİĞİ komutu reddedemez. */
  if (isProtocolBash(command)) return false;
  const hitPattern = bashPatternsOf(claim, resMap).some((p) => {
    try {
      return new RegExp(p, "i").test(command);
    } catch {
      return false;
    }
  });
  if (hitPattern) return true;
  if (!repoRoot) return false;
  const paths = pathsOf(claim, resMap);
  if (!paths.length) return false;
  const base = cwd || repoRoot;
  return bashPathTokens(command).some((t) => {
    const abs = canonicalPath(resolve(base, expandTilde(t)));
    return paths.some((p) => patternCoversAbs(p, abs, repoRoot));
  });
}

/** Boş defter mi? (hızlı yol: tek stat — tek-session akışı sıfır maliyet olmalı) */
export function ledgerExists() {
  return existsSync(CLAIMS_DIR);
}

/* ──────────────── MÜKERRER EMEK ÖLÇÜMÜ (2026-08-07) ────────────────
 *
 * ÖLÇÜLEN ARIZA: 2026-08-07'de iki oturum aynı yamayı (`procAlive` zombi kuralı) BAĞIMSIZ
 * olarak yazdı; merge çakıştı ve bir implementasyon çöpe gitti. Kilit sistemi DOSYAYI korur,
 * NİYETİ korumaz — ve kimse yazmadan önce claim almamıştı, dolayısıyla iki oturumun aynı işe
 * girdiği hiçbir yerde GÖRÜNMÜYORDU. Görünmeyen bir israf, ölçülmeyen bir israftır.
 *
 * ÖLÇÜ: bir oturumun bir dosyaya **claim'siz İLK yazımı** bir olaydır (`tip: "claimsiz"`).
 * Aynı yol için farklı oturumlardan ≥2 kayıt = mükerrer emek RİSKİ. Hüküm değil sinyal:
 * iki oturum aynı dosyayı meşru sebeplerle de düzenlemiş olabilir — rapor bunu söyler.
 *
 * NEDEN "İLK": her yazımı yazmak defteri şişirirdi (7 oturum × yüzlerce Edit). Ölçünün
 * ihtiyacı olan şey SAYI değil KÜME: hangi oturum hangi dosyaya dokundu. Oturum başına
 * küçük bir "dokunulan" seti bunu O(1) tutar; defter yalnız ilk temasla büyür.
 *
 * KAPI DEĞİL, DEFTER: bu yol hiçbir yazımı engellemez ve hiçbir kararı değiştirmez.
 * Hatası yutulur (defter kararı ASLA değiştirmez — 05.4 ile aynı ilke). */

/** Bu oturum bu yola DAHA ÖNCE dokundu mu? Dokunmadıysa işaretler ve `true` döner. */
export function ilkDokunus(repoRoot, sessionId, yol) {
  try {
    if (!sessionId || !yol) return false;
    const sid8 = String(sessionId).slice(0, 8);
    const dir = join(ledgerDirOf(repoRoot), "dokunulan");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = join(dir, `${sid8}.json`);
    let set = [];
    try {
      const ham = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(ham)) set = ham;
    } catch {
      /* yok ∨ bozuk → boş küme; bozuk dosya ölçümü DURDURMAZ */
    }
    if (set.includes(yol)) return false;
    set.push(yol);
    // TAVAN: patolojik bir oturum defteri şişirmesin. Aşılırsa en eskiler düşer — ölçü
    // yaklaşıktır ve bunu İLAN EDER (kesin sayım bu ölçünün amacı değil, küme örtüşmesi).
    if (set.length > 500) set = set.slice(-500);
    writeFileSync(p, JSON.stringify(set), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Claim'siz ilk yazımı deftere düşür. Yazım ZATEN geçmiştir; bu satır yalnız ölçüdür.
 *
 *  Yol repo-GÖRELİ normalize edilir: iki oturumun aynı dosyayı farklı mutlak yollarla
 *  (symlink · worktree) yazması küme örtüşmesini kaçırırdı. Repo dışı yol ölçülmez —
 *  bu ölçünün konusu paylaşılan repo yüzeyidir. */
export function olayClaimsiz(repoRoot, sessionId, absYol, why = "claim'siz ilk yazım") {
  try {
    const rel = relative(repoRoot, canonicalPath(absYol));
    if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return; // repo dışı → konu dışı
    if (!ilkDokunus(repoRoot, sessionId, rel)) return;
    yazOlay(repoRoot, { tip: "claimsiz", key: rel, engellenen: sessionId, why });
  } catch {
    /* yut */
  }
}

/* ═══════════════ BİLDİRİ — bırakan, SIRADAKİNE haber verir (seviye 0) ═══════════════
 *
 * Kilit sistemi sırayı DOĞRU kuruyordu ama "sıra sana geldi" haberi kimseye ULAŞMIYORDU:
 * bırakan session sonucu KENDİ stdout'una basıyor, bekleyen ise başka bir pencerede
 * sessizce oturuyordu. Ölçüldü (2026-08-07/08 defteri): 25 bloke olayına karşılık 15
 * kapanış — yani ~10 bloke oturum hiçbir uyanma yolu kurmadan kaldı.
 *
 * İKİ BEKLEYEN SINIFI, İKİ FARKLI ÇARE (ayrım bu bölümün özü):
 *   · AKTİF bekleyen (canlı `wait` süreci) → KENDİ uyanır: süreç kilidi onun adına alır,
 *     çıkışıyla oturumu uyandırır. Ona bildiri YAZILMAZ (gürültü + bayat haber olurdu).
 *   · SESSİZ bekleyen (pid'siz "istedim" işareti — kapıda DENY yiyip devam etmiş oturum)
 *     → hiçbir uyanma yolu YOK. Bildiri TAM BU BOŞLUK içindir.
 *
 * Taşıyıcı SEVİYE 0'dır: Maestro/tmux/PM YOK. Yazan `release` (ve SessionEnd'de
 * `release_all`), okuyan `claim-guard ctx` (SessionStart + UserPromptSubmit) — ikisi de
 * zaten kayıtlı yüzeyler, 0 token. İLANLI SINIR: bu bir POSTA KUTUSUDUR, ZİL DEĞİL —
 * durmuş bir oturumu UYANDIRAMAZ (uyandırma tek yoldan olur: enjeksiyon = Maestro).
 * Bekleyen döndüğü ilk anda okur; "geldim ve kaynağın boşaldığını görmedim" hâli biter.
 */
export const BILDIRI_SURUM = 1;
/** Haberin tazelik ömrü: 12 saat. Daha eskisi bilgi değil arkeolojidir (kaynak çoktan
 *  el değiştirmiş olabilir) — okuma anında elenir, dosya zaten tüketimde silinir. */
export const BILDIRI_TTL_MS = 12 * 60 * 60 * 1000;
export const bildiriDirOf = (repoRoot) => join(ledgerDirOf(repoRoot), "bildiri");
export const bildiriPath = (repoRoot, sessionId) =>
  join(bildiriDirOf(repoRoot), `${slugOf(sessionId)}.jsonl`);

/** Tek bir bildiri satırı yaz (append; hedef başına dosya). Hatayı YUTMAZ — çağıran sarar. */
export function bildir(repoRoot, kayit) {
  const hedef = kayit?.hedef;
  if (!hedef) return null;
  const satir = { v: BILDIRI_SURUM, ts: new Date().toISOString(), ...kayit };
  mkdirSync(bildiriDirOf(repoRoot), { recursive: true, mode: 0o700 });
  appendFileSync(bildiriPath(repoRoot, hedef), JSON.stringify(satir) + "\n", { mode: 0o600 });
  return satir;
}

/**
 * Bana gelen bildiriler. Varsayılan TÜKETİCİdir (okundu = dosya silinir): aynı haber her
 * turda yeniden enjekte edilirse bağlam çöpe döner ve haber olmaktan çıkar.
 * Salt bakmak için `{ tuket: false }` (teşhis yolu — `claim status` bunu kullanır).
 */
export function bildiriOku(repoRoot, sessionId, { tuket = true, now = Date.now() } = {}) {
  if (!sessionId) return [];
  const f = bildiriPath(repoRoot, sessionId);
  let ham;
  try {
    ham = readFileSync(f, "utf8");
  } catch {
    return []; // kutu yok = haber yok (en sık hâl; tek stat maliyeti)
  }
  const rows = ham
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((r) => {
      const t = Date.parse(r?.ts || "");
      return !Number.isFinite(t) || now - t <= BILDIRI_TTL_MS;
    });
  if (tuket) {
    try {
      unlinkSync(f);
    } catch {
      /* yoktu/yarışıldı — haber zaten okundu */
    }
  }
  return rows;
}

/**
 * BIRAKMA ANININ SÖZLEŞMESİ: bir kilit bırakılırken sırada SESSİZ bekleyen varsa herkes
 * haberdar edilir. Aktif bekleyen VARSA hiç kimseye yazılmaz — sıra onundur, o da kendi
 * süreciyle uyanır; sıra ona geçtikten sonra bırakırken bu fonksiyon yeniden koşar.
 *
 * Dönüş: { aktif, sessiz, bildirilen } — çağıran ne olduğunu RAPOR edebilsin diye
 * (sessiz sonuç, "haber verdim mi?" sorusunu ölçülemez kılar).
 */
export function bildirSiradakine(repoRoot, key, kimden = {}) {
  const bos = { aktif: [], sessiz: [], bildirilen: [] };
  let q;
  try {
    q = queueOf(repoRoot, key);
  } catch {
    return bos;
  }
  const aktif = q.filter(waiterActive);
  const sessiz = q.filter((w) => !waiterActive(w));
  if (aktif.length) return { aktif, sessiz, bildirilen: [] };
  const kimdenBaslik = kimden?.sessionId ? sessionInfo(kimden.sessionId)?.title || null : null;
  const bildirilen = [];
  sessiz.forEach((w, i) => {
    try {
      const r = bildir(repoRoot, {
        hedef: w.sessionId,
        key,
        kimden: kimden?.sessionId || null,
        kimdenBaslik,
        kimdenNiyet: kimden?.intent || null,
        bekleyenNiyet: w.intent || null,
        bekleyisBaslangic: w.since || null,
        sira: i + 1,
        toplam: sessiz.length,
        neden: kimden?.neden || "release",
      });
      if (r) bildirilen.push(w);
    } catch {
      /* yut — haber yazılamaması BIRAKMAYI asla bozmaz */
    }
  });
  return { aktif, sessiz, bildirilen };
}

/**
 * ZİNCİRİN GERİ YÖNÜ — kilidi TUTANA "seni bekleyen var" haberi.
 *
 * Bildiri bugüne dek yalnız İLERİ akıyordu (bitiren → sıradaki). Oysa bir oturum kilit
 * aşamasında bloke olduğunda bu bilginin asıl muhatabı kilidi tutandır: küçük bir işi
 * bekletiyor olabilir ve bunu ancak `status`a bakarsa görür. Sıra bir zincirse, zincirin
 * gerisindeki halkanın varlığı öndekine SÖYLENİR.
 *
 * YALNIZ YENİ BEKLEYEN İÇİN: yankı bildirilmez. Ölçüt kuyruğun kendisidir — kayıt zaten
 * varsa bu yeni bir tıkanıklık değil, bekleyişin uzamasıdır (çağıran `yeniMi` ile söyler).
 * Sahip = ben isem yazılmaz (kendi kilidime kendim engel değilim).
 */
export function bildirSahibe(repoRoot, claim, bekleyen = {}) {
  try {
    const sahip = claim?.owner?.sessionId;
    if (!sahip || sahip === bekleyen.sessionId) return null;
    const k = claim?.resource?.key;
    if (!k) return null;
    return bildir(repoRoot, {
      hedef: sahip,
      tip: "bekleyenVar",
      key: k,
      kimden: bekleyen.sessionId || null,
      kimdenBaslik: bekleyen.sessionId ? sessionInfo(bekleyen.sessionId)?.title || null : null,
      bekleyenNiyet: bekleyen.intent || null,
      kuyruk: activeQueue(repoRoot, k).length + queueOf(repoRoot, k).filter((w) => !waiterActive(w)).length,
    });
  } catch {
    return null; // haber, kapının kararını ASLA etkilemez
  }
}

/* ═══════════════ ROL TABLOSU — kalıcı oturumların adı olsun (seviye 0) ═══════════════
 *
 * Oturumlar birbirine hex kimlikle sesleniyordu (`bildir --hedef 06584495`) ve o kimlik HER
 * oturumda değişiyor: "altyapıya söyle" demek için önce `status`a bakmak gerekiyordu. Rol,
 * kimliğin ÜSTÜNDEKİ kararlı addır — oturum yenilenince bağ kopmaz.
 *
 * KAPALI KÜME (vendor'lardaki gibi): tanınmayan rol kabul EDİLMEZ. Gerekçe kullanıcı
 * kararıdır (2026-08-09): serbest metin rol adı, "altyapi" ile "altyapı"yı iki ayrı role
 * çevirir ve haber sessizce yanlış kutuya düşer.
 *
 * TEKİL ⊕ ÇOĞUL — bu ayrım bu tablonun ASIL işidir:
 *   · TEKİL rol (orkestrator·altyapi·pm·vizyon·plan) tek slottur: canlı bir sahibi varken
 *     ikincisi sessizce kapamaz, `--devral` ister. `bildir --rol X` tek muhatap bulur.
 *   · ÇOĞUL rol (worker) slot TUTMAZ: aynı anda N tane olur ve bu normaldir. `--rol worker`
 *     ile bildiri göndermek YASAKTIR — hangi worker olduğu belirsizdir ve belirsiz adres,
 *     yanlış adresten beterdir (haber gider, yanlış yere gider, kimse fark etmez).
 * Çoğul rolde muhatap seçmek çağıranın işidir: `rol durum` adayları listeler, `bildir
 * --hedef <sessionId>` ile tek tek yazılır.
 */
export const ROLLER = {
  orkestrator: { tekil: true, ne: "repo içi koordinasyon — saha olayları buraya akar" },
  altyapi: { tekil: true, ne: "kit · boot · sync · kurulum · filing · vendor · seviye 0" },
  pm: { tekil: true, ne: "projeler-arası üst hedef ve dağıtım" },
  vizyon: { tekil: true, ne: "kutup yıldızı (utopya/) — epizodik, sürekli açık olması beklenmez" },
  plan: { tekil: true, ne: "roadmap üretimi/revizyonu — plan başına açılır" },
  worker: { tekil: false, ne: "işi yapan oturum(lar) — ÇOĞUL, slot tutmaz, adreslenmez" },
};
export const rolDirOf = (repoRoot) => join(ledgerDirOf(repoRoot), "rol");
export const rolPath = (repoRoot, ad) => join(rolDirOf(repoRoot), `${slugOf(ad)}.json`);
export const rolGecerli = (ad) => Object.prototype.hasOwnProperty.call(ROLLER, String(ad || ""));

/** Rolün CANLI sahibi (yoksa/ölmüşse null). Canlılık ölçütü claim'lerinkinin AYNISI. */
export function rolOku(repoRoot, ad) {
  let j;
  try {
    j = JSON.parse(readFileSync(rolPath(repoRoot, ad), "utf8"));
  } catch {
    return null;
  }
  if (!j?.sessionId) return null;
  const s = sessionInfo(j.sessionId);
  const canli = procAlive(j.pid, j.procStart) || (s && procAlive(s.pid, s.procStart));
  return canli ? j : null;
}

/** Tüm roller: tanımlı küme ⊕ canlı sahibi (yoksa null). Teşhis ve `bildir` çözümü için. */
export function rolListe(repoRoot) {
  return Object.entries(ROLLER).map(([ad, tanim]) => ({ ad, ...tanim, sahip: tanim.tekil ? rolOku(repoRoot, ad) : null }));
}

export function rolKayit(repoRoot, ad, kimlik, { kapsam = null, devral = false } = {}) {
  if (!rolGecerli(ad)) return { ok: false, neden: "tanimsiz", roller: Object.keys(ROLLER) };
  if (!ROLLER[ad].tekil) return { ok: false, neden: "cogul" }; // worker slot tutmaz
  const mevcut = rolOku(repoRoot, ad);
  if (mevcut && mevcut.sessionId !== kimlik.sessionId && !devral)
    return { ok: false, neden: "dolu", mevcut };
  const kayit = {
    v: 1,
    rol: ad,
    sessionId: kimlik.sessionId,
    pid: kimlik.pid ?? null,
    procStart: kimlik.procStart ?? null,
    since: new Date().toISOString(),
    kapsam,
    devralindi: mevcut && mevcut.sessionId !== kimlik.sessionId ? mevcut.sessionId : null,
  };
  mkdirSync(rolDirOf(repoRoot), { recursive: true, mode: 0o700 });
  atomicWrite(rolPath(repoRoot, ad), kayit);
  return { ok: true, kayit, oncekiSahip: kayit.devralindi };
}

/** Bırak — yalnız KENDİ kaydını (üçüncü taraf başkasının rolünü düşüremez). */
export function rolBirak(repoRoot, ad, sessionId) {
  let j;
  try {
    j = JSON.parse(readFileSync(rolPath(repoRoot, ad), "utf8"));
  } catch {
    return false;
  }
  if (j?.sessionId !== sessionId) return false;
  try {
    unlinkSync(rolPath(repoRoot, ad));
  } catch {
    return false;
  }
  return true;
}

/** Bu oturumun ÜSTLENDİĞİ roller (kapanışta hepsini bırakmak için). */
export function rolleriOf(repoRoot, sessionId) {
  return Object.keys(ROLLER).filter((ad) => rolOku(repoRoot, ad)?.sessionId === sessionId);
}

/**
 * `bildir --rol <ad>` çözümü. BELİRSİZLİKTE ADRES ÜRETMEZ — bu fonksiyonun asıl sözü budur:
 * çoğul rolde (worker) ya da sahipsiz rolde bir "en iyi tahmin" döndürmek, haberin sessizce
 * yanlış oturuma gitmesi demektir. Hüküm açıkça `neden` ile döner, çağıran onu BASAR.
 */
export function rolCoz(repoRoot, ad) {
  if (!rolGecerli(ad)) return { ok: false, neden: "tanimsiz", roller: Object.keys(ROLLER) };
  if (!ROLLER[ad].tekil) return { ok: false, neden: "cogul", adaylar: liveSessionsIn(repoRoot) };
  const r = rolOku(repoRoot, ad);
  return r ? { ok: true, sessionId: r.sessionId, kayit: r } : { ok: false, neden: "sahipsiz" };
}

/* ══════════ ORKESTRATÖR — sahadaki tek koordinatör oturum (seviye 0) ══════════
 *
 * Bildiri, "sıradaki bekleyen"i çözdü ama bir boşluk daha vardı: planı yürüten,
 * aşamaları sırayla ateşleyen bir oturum sahada olup biteni HİÇ öğrenmiyordu — hangi iş
 * bitti, kim nerede bloke oldu, hangi oturum açık kilitle kapandı. PM bu soruyu
 * projeler-arası ve agentic olarak soruyor; ORKESTRATÖR onun sahadaki, repo İÇİNDEKİ,
 * 0-token karşılığıdır: kimse ona rapor yazmaz — olaylar KENDİLİĞİNDEN düşer.
 *
 * TEK SLOT, ÖLÇÜLEN CANLILIK: repo başına bir kayıt; canlılık claim'lerdeki ölçütün
 * AYNISIdır (pid ⊕ procStart). Ölmüş orkestratör YOK sayılır — kayıt silinmez, hükmü
 * ölçüm verir. Bu yüzden "orkestratörüm ama çöktüm" hâli kuyruğu dondurmaz.
 *
 * İLANLI SINIR — KAPSAM REPO'DUR: bu katman `~/.claude/claims/<repo>/` defterinde yaşar
 * ve yalnız o repodaki olayları taşır. Projeler-arası eksen PM'in işidir (`/pm`); burada
 * ikinci bir küresel router YAPILMAZ. Orkestratör başka repoda da koordine edecekse orada
 * AYRICA kayıt olur — sessizce genişletilmez.
 */
/* KAYIT ALT DİZİNDE DURUR — defter KÖKÜ claim'lerin yeridir (ölçülen hata 2026-08-09:
   kök dizine konan `orkestrator.json`u `activeClaims` "sahipsiz claim" sanıp ARŞİVE ATTI;
   kayıt ilk `status`ta sessizce buharlaştı). `.q.json` için yıllar önce yazılmış uyarının
   aynısı: bu dizinde claim'den başka bir şey YAŞAYAMAZ. Alt dizin adı `.json` ile bitmediği
   için taramanın dışındadır — `devir/` ve `bildiri/` de bu yüzden alt dizindir. */
export const orkestratorPath = (repoRoot) =>
  join(ledgerDirOf(repoRoot), "orkestrator", "kayit.json");
export const orkestratorImlecPath = (repoRoot) =>
  join(ledgerDirOf(repoRoot), "orkestrator", "imlec.json");

/**
 * DEFTER OKUYUCUSU — orkestratör beslemesinin tek kaynağı.
 *
 * `olay.jsonl` bugüne dek yalnız YAZILIYORDU (belgesinde "okuyucu yüzey YOKTUR" diye ilan
 * edilmişti). Besleme onun PROJEKSİYONUdur: dört olayı elle bağlamak yerine defteri okumak,
 * "yeni bir olay tipi eklendi ama biri bağlamayı unuttu" sınıfını tümüyle ortadan kaldırır.
 *
 * İmleç BAYT OFSETİdir (satır sayısı değil): dosya yalnız sona eklenerek büyür (`appendFileSync`,
 * PIPE_BUF altı satırlar bölünmez) → ofset kararlı bir kesme noktasıdır. Dosya KÜÇÜLDÜYSE
 * (rotasyon · elle temizlik) ofset 0'a düşer: ölçüm yokluğunda geçmiş UYDURULMAZ, baştan okunur.
 * Son satır yarım yazılmışsa (eşzamanlı append) o satır TÜKETİLMEZ — ofset onun başında bırakılır.
 */
export function olayOku(repoRoot, { ofset = 0, tavan = 2000 } = {}) {
  const f = olayPath(repoRoot);
  let boy = 0;
  try {
    boy = statSync(f).size;
  } catch {
    return { satirlar: [], ofset: 0, atlanan: 0, boy: 0 }; // defter yok = olay yok
  }
  let bas = Number.isFinite(ofset) && ofset >= 0 ? ofset : 0;
  if (bas > boy) bas = 0; // dosya küçüldü → baştan
  if (bas === boy) return { satirlar: [], ofset: boy, atlanan: 0, boy };
  let ham = "";
  try {
    const fd = openSync(f, "r");
    try {
      const buf = Buffer.allocUnsafe(boy - bas);
      readSync(fd, buf, 0, buf.length, bas);
      ham = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return { satirlar: [], ofset, atlanan: 0, boy };
  }
  /* Yarım satır koruması: son "\n"den sonrası bir sonraki okumaya bırakılır. */
  const sonNl = ham.lastIndexOf("\n");
  const tuketilen = sonNl < 0 ? 0 : sonNl + 1;
  const govde = ham.slice(0, tuketilen);
  const satirlar = [];
  for (const l of govde.split("\n")) {
    if (!l) continue;
    try {
      satirlar.push(JSON.parse(l));
    } catch {
      /* bozuk satır ATLANIR, silinmez — ölçülemeyene hüküm verilmez */
    }
  }
  const atlanan = Math.max(0, satirlar.length - tavan);
  return { satirlar: atlanan ? satirlar.slice(-tavan) : satirlar, ofset: bas + tuketilen, atlanan, boy };
}

/* İMLEÇ ROL BAŞINADIR (2026-08-09, kullanıcı isteği: "diğer sessionların progresslerini de
   görsün"). Her rol defteri KENDİ hızında tüketir: orkestratör her olayı okurken altyapı
   yalnız üst-düzey olayları görür ve biri ötekinin imlecini ilerletmez. Orkestratörün yolu
   ESKİ yerinde kalır (geriye uyum: canlı kayıt taşınma yüzünden sıfırlanmaz). */
export const rolImlecPath = (repoRoot, ad) =>
  ad === "orkestrator" ? orkestratorImlecPath(repoRoot) : join(rolDirOf(repoRoot), `${slugOf(ad)}.imlec.json`);

/** İmleci oku (yoksa null → çağıran "şimdiden itibaren" kurar; geçmiş dökülmez). */
export function imlecOku(repoRoot, ad = "orkestrator") {
  try {
    const j = JSON.parse(readFileSync(rolImlecPath(repoRoot, ad), "utf8"));
    return Number.isFinite(j?.ofset) ? j.ofset : 0;
  } catch {
    return null;
  }
}

export function imlecYaz(repoRoot, ofset, ad = "orkestrator") {
  try {
    mkdirSync(dirname(rolImlecPath(repoRoot, ad)), { recursive: true, mode: 0o700 });
    atomicWrite(rolImlecPath(repoRoot, ad), { v: 1, ofset, ts: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
}

/* Rol başına BESLEME SÜZGECİ — orkestratör sahanın TAMAMINI görür (koordinasyon onun işi);
   öteki roller yalnız ÜST-DÜZEY olayları (bir iş bitti · bir oturum kapandı · iş devredildi ·
   döngü). Gerekçe bağlam bütçesidir: altyapı rolünün her `claimsiz` yazımı görmesi ona hiçbir
   karar kazandırmaz, ama her turunun başına yazılır. */
export const ROL_SUZGEC = { orkestrator: null, varsayilan: ["birakildi", "kapandi", "devir", "cevrim"] };

/** Defterin ŞU ANKİ sonu — kayıt anında imleç buraya konur (yeni orkestratör arşivle karşılanmaz). */
export function olaySonu(repoRoot) {
  try {
    return statSync(olayPath(repoRoot)).size;
  } catch {
    return 0;
  }
}

/**
 * Orkestratör = rol tablosundaki `orkestrator` rolü (2026-08-09'da genelleştirildi).
 *
 * ESKİ YOL SESSİZCE DÜŞÜRÜLMEZ: genelleştirmeden önce kaydolmuş CANLI bir orkestratör
 * `orkestrator/kayit.json`'da duruyor olabilir ve onu görmezden gelmek, çalışan bir
 * koordinasyonu bir dosya taşıma yüzünden yok saymak olurdu. Yeni kayıt varsa o geçerlidir;
 * yoksa eski dosyaya BAKILIR (okuma yolu geriye uyumlu, yazma yolu yalnız yeniye yazar).
 */
export function orkestratorOku(repoRoot) {
  const yeni = rolOku(repoRoot, "orkestrator");
  if (yeni) return yeni;
  let j;
  try {
    j = JSON.parse(readFileSync(orkestratorPath(repoRoot), "utf8")); // eski yol
  } catch {
    return null;
  }
  if (!j?.sessionId) return null;
  const s = sessionInfo(j.sessionId);
  return procAlive(j.pid, j.procStart) || (s && procAlive(s.pid, s.procStart)) ? j : null;
}

/** Kayıt ol. Başkası CANLI kayıtlıysa devralma AÇIK BEYAN ister (sessiz kapma yok). */
export function orkestratorKayit(repoRoot, kimlik, { kapsam = null, devral = false } = {}) {
  const r = rolKayit(repoRoot, "orkestrator", kimlik, { kapsam, devral });
  if (!r.ok) return r;
  /* İMLEÇ DEFTERİN SONUNA: yeni orkestratör, kaydolmadan önceki günlerin arşiviyle
     karşılanmaz. "Kaydolduğum andan itibaren" sözleşmesi burada kurulur. */
  imlecYaz(repoRoot, olaySonu(repoRoot));
  return r;
}

/** Bırak — yalnız KENDİ kaydını (başkasınınkini üçüncü taraf silemez). Eski yol da temizlenir. */
export function orkestratorBirak(repoRoot, sessionId) {
  const yeni = rolBirak(repoRoot, "orkestrator", sessionId);
  let eski = false;
  try {
    const j = JSON.parse(readFileSync(orkestratorPath(repoRoot), "utf8"));
    if (j?.sessionId === sessionId) {
      unlinkSync(orkestratorPath(repoRoot));
      eski = true;
    }
  } catch {
    /* eski kayıt yok */
  }
  return yeni || eski;
}

/**
 * Orkestratörün posta kutusuna HEDEFLİ bir kayıt bırak (elle bildiriler · özel durumlar).
 *
 * DİKKAT — SAHA BESLEMESİ ARTIK BURADAN GEÇMEZ (2026-08-09): olayların orkestratöre akışı
 * `olay.jsonl` PROJEKSİYONUdur (`olayOku` + imleç, çizim `claim-guard: sahaBloku`). Dört olayı
 * elle bağlamak kırılgandı: beşinci olay eklendiğinde biri çağırmayı unutursa besleme sessizce
 * eksilirdi. Bu fonksiyon yalnız defterde KARŞILIĞI OLMAYAN, kişiye özel haberler içindir.
 * KENDİ olayını kendine yazmaz. Hata YUTULUR — haber, haber verdiren işi ASLA bozmaz.
 */
export function bildirOrkestratore(repoRoot, olay = {}) {
  try {
    const o = orkestratorOku(repoRoot);
    if (!o) return null;
    if (o.sessionId === olay.kimden) return null; // kendi olayın
    return bildir(repoRoot, { hedef: o.sessionId, ...olay });
  } catch {
    return null;
  }
}
