#!/usr/bin/env node
// kopru.mjs — KÖPRÜ: telefonun kalıcı kumanda odası.
//
//   kopru.mjs kur [--json]     # idempotent: varsa dokunmaz, yoksa kurar
//   kopru.mjs durum [--json]   # üç kanıt: tmux oturumu · pane süreci · happy kaydı
//
// Köprü = varsayılan tmux soketinde `kopru` adlı oturumda, ~/.claude cwd'sinde
// koşan bir `happy` süreci. tmux+happy doğduğu için (K3, happy-devir.md) AYNI ANDA
// iki yüzeyde yaşar: terminalden `tmux attach -t kopru`, telefondan Happy uygulaması.
// Daemon-detached spawn'ın K5 sınırına (tty yok → attach imkânsız) hiç girmez.
//
// Kalıcılık: Maestro bekçi işi (--every 10m, `kopru.mjs kur`) — happy ölürse pane
// ölür → tek-pencereli oturum kapanır → bir sonraki bekçi turu yeniden kurar.
// Reboot zinciri: launchd → metronom (RunAtLoad) → bekçi → köprü. Yeni daemon YOK.
//
// KURALLAR:
//   · İdempotentlik oturum ADI üzerinden: `tmux has-session -t kopru` varsa HİÇBİR
//     ŞEYE dokunulmaz (K2: ikinci happy = aynı cwd'de ikinci yazar riski).
//   · Bekçi pane'e ASLA send-keys yapmaz — enjeksiyon yalnız metronomun (payload'la).
//   · cwd ~/.claude (trust'lı; `~` bilinçli KULLANILMAZ — trust diyaloğu asar).
//   · Prompt gönderilemez (E2E) — ilk mesajı insan yazar (telefondan ya da attach'la).

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const CWD = join(HOME, ".claude"); // PM rutiniyle AYNI kök (ayar.json/gelen orada + trust'lı)
const OTURUM = "kopru";
/** Oturum adı (claude `-n`; happy tüm claude bayraklarını geçirir) — telefondaki
 *  sohbet listesinde köprü TANINSIN: her tetikte yeni sohbet açılmaz, hep bu. */
const AD = "aide-kopru";
const HAPPY_SESSIONS = join(HOME, ".happy", "sessions.json");
const HAPPY_LOGS = join(HOME, ".happy", "logs");
/** Köprünün kimlik defteri — TEK YAZAR bu script (yalnız kimlik; sır tutmaz). */
const DEFTER = join(HOME, ".claude", "pm", "kopru.json");

function sh(cmd, argv, timeout = 8000) {
  try {
    return execFileSync(cmd, argv, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

/** happy binary'sinin mutlak yolu — pano/daemon bağlamında PATH kısıtlı olabilir. */
function happyYolu() {
  for (const p of ["/usr/local/bin/happy", "/opt/homebrew/bin/happy", join(HOME, ".bun", "bin", "happy")]) {
    if (existsSync(p)) return p;
  }
  return sh("which", ["happy"])?.trim() || null;
}

/** Sistem konteyneri: köprü + pm-rutin gibi sağlık/otomasyon daemon'ları burada window
 *  olarak yaşar (proje-bazlı tmux yapısı, kullanıcı kararı 2026-07-20). */
const SISTEM = "sistem";

/** Köprü koşusunun tmux hedefi: 'kopru' adlı window'un pane-id'si (yeni yapı: sistem
 *  konteynerinde ya da geçiş sırasında herhangi bir session'da) — yoksa legacy top-level
 *  'kopru' session (geçiş penceresi) — hiçbiri yoksa null. İki şekli de bildiği için kod
 *  dağıtımı ile canlı taşıma arasındaki her an guardian çift-kopru AÇMAZ. */
function kopruTarget() {
  const panes = sh("tmux", ["list-panes", "-a", "-F", "#{window_name}\t#{pane_id}\t#{session_name}"]);
  if (panes) {
    for (const line of panes.trim().split("\n")) {
      const [wn, pid, sess] = line.split("\t");
      if (wn === OTURUM && pid) return { target: pid, session: sess };
    }
  }
  if (sh("tmux", ["has-session", "-t", "=" + OTURUM]) !== null) return { target: OTURUM, session: OTURUM };
  return null;
}

function tmuxVar() {
  return kopruTarget() !== null;
}

/** Daemon ayakta mı (state dosyasındaki pid gerçekten yaşıyor mu)? */
function daemonAyakta() {
  try {
    const st = JSON.parse(readFileSync(join(HOME, ".happy", "daemon.state.json"), "utf8"));
    if (!st?.pid) return false;
    try {
      process.kill(st.pid, 0);
      return true;
    } catch (e) {
      return e?.code === "EPERM";
    }
  } catch {
    return false;
  }
}

/** Köprüden ÖNCE daemon'u TEMİZ env ile ayağa kaldır.
 *
 *  NEDEN (kanıtlı olay 2026-07-15): köprü `HAPPY_RECONNECT_*` env'iyle açılır; happy
 *  daemon kapalıysa onu KENDİ ÇOCUĞU olarak doğurur → daemon reconnect env'ini miras
 *  alır → daemon'un telefondan doğurduğu HER yeni oturum da miras alır ve köprünün
 *  session id'sine çakılır. Sonuç: telefondan yeni oturum açılamaz, tek sohbette
 *  çok yazar birikir (ölçüldü: 6890 → 7041 → {17832, 18112}, üçü de aynı happy id).
 *
 *  Değişmez: reconnect env'i YALNIZ köprü sürecine ulaşır, torunlarına ASLA.
 *  Bunu daemon'u önden, reconnect env'i süzülmüş bir env ile başlatarak sağlarız —
 *  böylece happy'nin auto-start yolu hiç tetiklenmez. */
function daemonuGarantile(happy) {
  if (daemonAyakta()) return;
  const temiz = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("HAPPY_RECONNECT_")) temiz[k] = v;
  }
  try {
    execFileSync(happy, ["daemon", "start"], { stdio: "ignore", env: temiz });
  } catch {
    /* daemon kalkmazsa köprü yine kurulur (happy kendi doğurur) — degrade gracefully */
  }
}

/** Köprü pane'inin İÇ happy süreci.
 *  DİKKAT: `happy` bir sarmalayıcıdır (`node /usr/local/bin/happy` → `node …/dist/index.mjs`)
 *  ve log dosyası İÇ sürecin pid'iyle adlandırılır (`*-pid-<iç>.log`). Sarmalayıcıyı
 *  döndürürsek claude id log'dan hiç çözülemez → soyağacında dist/index.mjs aranır. */
function paneSureci() {
  const hedef = kopruTarget();
  const out = hedef ? sh("tmux", ["list-panes", "-t", hedef.target, "-F", "#{pane_pid}"]) : null;
  const panePid = Number(out?.trim().split("\n")[0]);
  if (!panePid) return null;
  const ps = sh("ps", ["-axo", "pid=,ppid=,command="]) ?? "";
  const satirlar = [];
  for (const line of ps.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) satirlar.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] });
  }
  const ebeveyn = new Map(satirlar.map((s) => [s.pid, s.ppid]));
  const soyundan = (pid) => {
    let p = pid;
    for (let hop = 0; p && p > 1 && hop < 20; hop++) {
      if (p === panePid) return true;
      p = ebeveyn.get(p);
    }
    return false;
  };
  // DAEMON ELEMESİ: daemon köprünün ÇOCUĞU olabilir (happy kapalıysa onu doğurur) →
  // soyağacı testini geçer ve `dist/index.mjs` desenine de uyar. Onu köprü sanmak
  // deftere daemon'un pid'ini yazdırır (ölçüldü: kopru.json hostPid 7041 = daemon)
  // ve claude id'yi yanlış log'dan çözdürür. Köprü ASLA `daemon` alt-komutlu değildir.
  const daemonMu = (cmd) => /\bdaemon\b/.test(cmd);
  // İç süreç: happy-coder dist bundle'ı (log adı bunun pid'ini taşır)
  const ic = satirlar.find(
    (s) => /happy-coder\/dist\/index\.mjs/.test(s.cmd) && !daemonMu(s.cmd) && soyundan(s.pid),
  );
  if (ic) return { panePid, happyPid: ic.pid };
  // Yedek: soyunda herhangi bir happy süreci
  const her = satirlar.find((s) => /\bhappy\b/i.test(s.cmd) && !daemonMu(s.cmd) && soyundan(s.pid));
  return { panePid, happyPid: her?.pid ?? null };
}

/** KÖPRÜNÜN happy kaydı — pane'in KENDİ sürecine göre eşleştir.
 *  Yalnız `path === ~/.claude` bakmak yetmez: aynı cwd'de daemon-doğumlu eski
 *  oturumlar da var; onlardan birini "köprü" sanmak durumu yalan söyletirdi. */
function happyKaydi(happyPid) {
  try {
    const data = JSON.parse(readFileSync(HAPPY_SESSIONS, "utf8"));
    const canli = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return e?.code === "EPERM";
      }
    };
    for (const [happyId, v] of Object.entries(data?.sessions ?? {})) {
      const m = v?.metadata ?? {};
      if (m.path !== CWD || m.lifecycleState !== "running" || !m.hostPid) continue;
      if (!canli(m.hostPid)) continue;
      // Köprünün pane'indeki süreç biliniyorsa BİREBİR eşleşme şart.
      if (happyPid && m.hostPid !== happyPid) continue;
      return { happyId, hostPid: m.hostPid };
    }
  } catch {
    /* dosya yok/bozuk → kayıt yok */
  }
  return null;
}

export function durum() {
  const p = tmuxVar() ? paneSureci() : null;
  const defter = defterOku();
  // Kimlik: sessions.json reconnect modunda kayıt yazmaz → defter + log yetkilidir.
  const claudeId = p?.happyPid ? claudeIdCoz(p.happyPid) : null;
  return {
    tmux: tmuxVar(),
    surec: !!(p && (p.happyPid || p.panePid)),
    happyId: defter?.happyId ?? happyKaydi(p?.happyPid ?? null)?.happyId ?? null,
    claudeSessionId: claudeId ?? defter?.claudeSessionId ?? null,
    hostPid: p?.happyPid ?? null,
  };
}

// ── KİMLİK SÜREKLİLİĞİ — telefonda TEK sohbet ────────────────────────────────
// Happy her açılışta `sessionTag = randomUUID()` üretip `getOrCreateSession` çağırır
// → her yeniden kurulum YENİ bir Happy oturumu = telefonda YENİ bir sohbet kartı.
// Tek istisna: `HAPPY_RECONNECT_*` ortam değişkenleri verilirse happy sunucuya hiç
// sormadan AYNI oturum kimliğine + anahtarına yeniden bağlanır (dist index:6149-6160).
// Köprü bunu kullanır: kimliğini defterine yazar, her kurulumda ona geri döner.
// Claude tarafında da `--resume <claudeSessionId>` ile AYNI sohbet sürer.
//
// Defter: ~/.claude/pm/kopru.json — TEK YAZAR bu script. (Şifreleme anahtarı zaten
// ~/.happy/sessions.json'da; defter yalnız KİMLİK tutar, sır kopyalamaz.)

function defterOku() {
  try {
    return JSON.parse(readFileSync(DEFTER, "utf8"));
  } catch {
    return null;
  }
}

function defterYaz(o) {
  try {
    mkdirSync(dirname(DEFTER), { recursive: true });
    const tmp = `${DEFTER}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(o, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, DEFTER);
  } catch {
    /* defter yazılamazsa köprü yine kurulur — yalnız kimlik sürekliliği kaybolur */
  }
}

/** hostPid → happy log'undan Claude session id (K4 join'inin bağımsız kopyası;
 *  kit script'i core'u import edemez — MANIFESTO §7 kuralı). */
function claudeIdCoz(hostPid) {
  try {
    const suffix = `-pid-${hostPid}.log`;
    const dosyalar = readdirSync(HAPPY_LOGS)
      .filter((f) => f.endsWith(suffix) && !f.endsWith("-daemon.log"))
      .map((f) => join(HAPPY_LOGS, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    for (const p of dosyalar) {
      const re = /session_id["']?\s*[:=]\s*["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
      let m, son = null;
      const icerik = readFileSync(p, "utf8");
      while ((m = re.exec(icerik))) son = m[1];
      if (son) return son;
    }
  } catch {
    /* log yok → id yok */
  }
  return null;
}

/** Claude transkripti gerçekten var mı (ve boş değil mi)? — resume ön koşulu. */
function transkriptVar(claudeId) {
  try {
    const slug = CWD.replace(/[^a-zA-Z0-9]/g, "-");
    const p = join(HOME, ".claude", "projects", slug, `${claudeId}.jsonl`);
    return statSync(p).size > 0;
  } catch {
    return false;
  }
}

/** Defterdeki happyId'nin şifreleme kaydı (sessions.json) → HAPPY_RECONNECT_* env. */
function reconnectEnv(happyId) {
  try {
    const data = JSON.parse(readFileSync(HAPPY_SESSIONS, "utf8"));
    const v = data?.sessions?.[happyId];
    if (!v?.encryptionKey || !v?.encryptionVariant) return null;
    return {
      HAPPY_RECONNECT_SESSION_ID: happyId,
      HAPPY_RECONNECT_ENCRYPTION_KEY: v.encryptionKey,
      HAPPY_RECONNECT_ENCRYPTION_VARIANT: v.encryptionVariant,
      HAPPY_RECONNECT_SEQ: String(v.seq ?? 0),
      HAPPY_RECONNECT_METADATA_VERSION: String(v.metadataVersion ?? 0),
      HAPPY_RECONNECT_AGENT_STATE_VERSION: String(v.agentStateVersion ?? 0),
    };
  } catch {
    return null;
  }
}

/** Köprünün kimliğini defterle.
 *  DİKKAT: reconnect modunda (HAPPY_RECONNECT_*) happy sessions.json'a kayıt YAZMAZ —
 *  `getOrCreateSession` hiç çağrılmaz. Bu yüzden kimlik sessions.json'dan DEĞİL,
 *  pane'in kendi happy sürecinden (log → claude id) + defterdeki happyId'den türetilir. */
function defteriTazele(oncekiHappyId, oncekiClaudeId) {
  const p = paneSureci();
  const happyPid = p?.happyPid ?? null;
  if (!happyPid) return;
  const kayit = happyKaydi(happyPid); // yeni kimlikli (reconnect'siz) kurulumda dolu gelir
  const happyId = kayit?.happyId ?? oncekiHappyId ?? null;
  if (!happyId) return;
  // Claude id: bu sürecin log'undan (K4). Henüz yazılmadıysa eskisini KORUMA —
  // yeni oturumda eski id yanlıştır; null bırak, bir sonraki tur çözer.
  const claudeId = claudeIdCoz(happyPid) ?? (kayit ? null : oncekiClaudeId) ?? null;
  defterYaz({
    happyId,
    hostPid: happyPid,
    claudeSessionId: claudeId,
    guncellendi: new Date().toISOString(),
  });
}

/** Servis şalteri: aide config'inde happy kapalıysa köprü KURULMAZ — bekçi işi
 *  (kopru-bekci, 10dk) no-op'a döner; iş silinmez, şalter açılınca kendiliğinden
 *  yeniden kurar. Kaynak: ~/.config/agent-ide/config.json → services.happy
 *  (yazar: core/servisler.ts — `aide servis` / Yapılandır paneli; kit script'i
 *  core import edemez, dosyayı DOĞRUDAN okur). Dosya yok/bozuk → AÇIK varsayılır. */
function servisAcik() {
  try {
    const cfg = JSON.parse(readFileSync(join(HOME, ".config", "agent-ide", "config.json"), "utf8"));
    return cfg?.services?.happy !== false;
  } catch {
    return true;
  }
}

export function kur() {
  if (!servisAcik())
    return { ok: true, kapali: true, mesaj: "happy servisi kapalı (aide servis happy ac ile açılır) — köprü kurulmadı" };
  if (tmuxVar()) {
    // Açıkken de kimliği tazele: bekçi turları defteri güncel tutar → köprü bir gün
    // ölürse kimliği (ve sohbeti) elimizde olur.
    const d = defterOku();
    defteriTazele(d?.happyId ?? null, d?.claudeSessionId ?? null);
    return { ok: true, zatenVar: true, mesaj: `köprü zaten açık — yerelden: tmux attach -t ${kopruTarget()?.session ?? SISTEM}` };
  }
  const happy = happyYolu();
  if (!happy) return { ok: false, zatenVar: false, mesaj: "happy kurulu değil (npm i -g happy-coder)" };

  // SIRA KRİTİK: daemon, köprüden ÖNCE ve TEMİZ env ile ayağa kalkmalı. Aksi halde
  // happy onu aşağıdaki reconnect env'iyle kendi çocuğu olarak doğurur ve telefondan
  // açılan her oturum köprünün sohbetine çakılır (bkz. daemonuGarantile).
  daemonuGarantile(happy);

  // Defterdeki kimliğe geri dön: telefonda AYNI sohbet, Claude'da AYNI konuşma.
  const defter = defterOku();
  const env = defter?.happyId ? reconnectEnv(defter.happyId) : null;
  const hamId = defter?.claudeSessionId ?? (defter?.hostPid ? claudeIdCoz(defter.hostPid) : null);
  // `--resume`'u YALNIZ transkript GERÇEKTEN varsa geçir. Hiç mesaj yazılmamış bir
  // oturumun (Claude id'si atanmış ama .jsonl yazılmamış) resume'u claude'u ANINDA
  // düşürür → happy de kapanır → köprü ölü kalırdı (kanıtlı: 2026-07-13, pid 16669).
  const claudeId = hamId && transkriptVar(hamId) ? hamId : null;
  const surdur = !!env;

  // Köprü sistem konteynerinde WINDOW olarak doğar (proje-bazlı yapı, 2026-07-20). Konteyner
  // yoksa kalıcı ⌂ index'iyle kurulur → son daemon ölse de "sistem" bölümü kaybolmaz.
  if (sh("tmux", ["has-session", "-t", "=" + SISTEM]) === null) {
    sh("tmux", ["new-session", "-d", "-s", SISTEM, "-n", "⌂", "-c", CWD]);
    sh("tmux", ["set-option", "-g", "automatic-rename", "off"]);
  }
  const argv = ["new-window", "-t", "=" + SISTEM, "-n", OTURUM, "-c", CWD];
  if (env) for (const [k, v] of Object.entries(env)) argv.push("-e", `${k}=${v}`);
  const komut = `${happy} -n ${AD}${claudeId ? ` --resume ${claudeId}` : ""}`;
  argv.push(komut);

  const r = sh("tmux", argv);
  if (r === null && !tmuxVar()) {
    return { ok: false, zatenVar: false, mesaj: "tmux new-window başarısız (tmux kurulu mu?)" };
  }
  // happy'nin oturumu kaydetmesini kısa süre bekle, sonra defteri tazele.
  const bitis = Date.now() + 15_000;
  const bekle = () => {
    const p = paneSureci();
    if (p?.happyPid && happyKaydi(p.happyPid)) return true;
    return false;
  };
  while (Date.now() < bitis && !bekle()) {
    try {
      execFileSync("sleep", ["0.5"]);
    } catch {
      break;
    }
  }
  defteriTazele(defter?.happyId ?? null, claudeId);

  return {
    ok: true,
    zatenVar: false,
    surdur,
    mesaj: surdur
      ? `köprü kuruldu — AYNI Happy sohbeti sürüyor (${defter.happyId.slice(0, 8)}${claudeId ? `, claude ${claudeId.slice(0, 8)}` : ""}); yerelden: tmux attach -t ${kopruTarget()?.session ?? SISTEM}`
      : `köprü kuruldu (yeni kimlik) — telefonda Happy'de ~/.claude oturumu; yerelden: tmux attach -t ${kopruTarget()?.session ?? SISTEM}`,
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
  const cmd = process.argv[2];
  const json = process.argv.includes("--json");
  if (cmd === "kur") {
    const r = kur();
    console.log(json ? JSON.stringify(r) : r.mesaj);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "durum") {
    const d = durum();
    if (json) console.log(JSON.stringify(d));
    else
      console.log(
        `tmux: ${d.tmux ? "✓" : "✗"} · süreç: ${d.surec ? "✓" : "✗"}` +
          ` · happy sohbeti: ${d.happyId ? `${d.happyId.slice(0, 8)} (sabit)` : "—"}` +
          ` · claude: ${d.claudeSessionId ? d.claudeSessionId.slice(0, 8) : "— (henüz mesaj yok)"}` +
          `${d.hostPid ? ` · pid ${d.hostPid}` : ""}`,
      );
    process.exit(0);
  } else {
    console.error(`kopru: bilinmeyen komut: ${cmd ?? "(boş)"} — kur | durum`);
    process.exit(1);
  }
}
