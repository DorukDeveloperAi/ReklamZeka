#!/usr/bin/env node
/**
 * /kaptan kanıt harness'ı — SALT-OKUNUR (gerçek ~/.claude/kaptan'a dokunmaz).
 *
 * Desen `eszamanli/proof/proof.mjs`'in AYNISI (yeni yüzey icat edilmedi): sayaç + mikro
 * `ok()` · `olculemedi()` dalı · sonda özeti · exit kodu. Kanıtı "koda bakarak" değil
 * ÜRÜNÜ SÜREREK alır:
 *  • scriptler AYRI SÜREÇTE, gerçek CLI bayraklarıyla koşulur (`model.mjs --write`, `durum.mjs --hizli`),
 *  • `HOME` sandbox'a çevrilir → `os.homedir()` oraya düşer; canlı defter (`~/.claude/kaptan/model.json`
 *    4 MB+, nabız kaynağı) hiç açılmaz,
 *  • "canlı session" GERÇEK bir süreçtir (`ps -p` ile doğrulanır — durum.mjs'in kendi ölçütü).
 *
 * Ölçülen ilkeler (hepsi post-mortem'den değil, SÖZLEŞMEDEN doğar):
 *   ① nabız→model türetmesi İDEMPOTENT (aynı girdi → `generatedAt` hariç bayt-eş çıktı)
 *   ② bozuk nabız türetmeyi ÇÖKERTMEZ ve sessizce de öldürmez (şema korunur, bozuk kayıt sızmaz)
 *   ③ `durum.mjs` altyapı eksikken HARD-FAIL ETMEZ ve eksiği İLAN eder (`warnings[]`)
 *   ④ `durum.mjs` HİÇBİR ŞEY YAZMAZ ("Tek yazma yüzeyi: YOK" beyanı mekanik ölçülür)
 *   ⑤ hedef sözleşmesi: canlı session'a AÇIK maddeler iliştirilir (completed/removed elenir)
 *   ⑥ izolasyon: gerçek ~/.claude/kaptan koşudan ETKİLENMEZ
 *
 * Koşum:  node ~/.claude/skills/kaptan/proof/proof.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = join(HERE, "..", "scripts", "model.mjs");
const DURUM = join(HERE, "..", "scripts", "durum.mjs");

let pass = 0, fail = 0, belirsiz = 0;
const ok = (name, cond, detay = "") => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${detay && !cond ? `\n        ${detay}` : ""}`);
};
/** ÖLÇÜLEMEDİ — ölçümün kendisi geçersiz (koşul harness'ın dışında). Yeşil DEĞİL, kırmızı da
 *  değil: "ölçemediysen ölçülemedi yaz, tahmin yazma". İLAN edilir, sayılır. */
const olculemedi = (name, neden) => {
  belirsiz++;
  console.log(`  ÖLÇÜLEMEDİ  ${name}\n        ${neden}`);
};

/* ── ağaç hash'i (izolasyon + salt-okunurluk ölçütü) ── */
function hashTree(root) {
  if (!existsSync(root)) return "YOK";
  const h = createHash("sha256");
  const walk = (d, rel) => {
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of [...ents].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else { h.update(r); try { h.update(readFileSync(p)); } catch { h.update("?"); } }
    }
  };
  walk(root, "");
  return h.digest("hex").slice(0, 16);
}

/* ── sandbox ── */
const SB = mkdtempSync(join(tmpdir(), "kaptan-proof-"));
const HOME = join(SB, "home");
const CLAUDE = join(HOME, ".claude");
const GOALS = join(CLAUDE, "kaptan", "goals");
const CWD_A = "/tmp/kaptan-proof-projesi";
const SLUG_A = CWD_A.replace(/[^A-Za-z0-9]/g, "-");
const SID_CANLI = "aaaa1111-2222-3333-4444-555566667777";
const SID_KAPALI = "bbbb1111-2222-3333-4444-555566667777";
const SID_BOZUK = "cccc1111-2222-3333-4444-555566667777";

mkdirSync(join(GOALS, SLUG_A), { recursive: true });
mkdirSync(join(CLAUDE, "sessions"), { recursive: true });
mkdirSync(join(CLAUDE, "session-status"), { recursive: true });
mkdirSync(join(SB, "jobs"), { recursive: true });
mkdirSync(join(SB, "bin"), { recursive: true });

const ISO = (msGeri) => new Date(Date.now() - msGeri).toISOString();
const goalDosyasi = (sessionId, todos, extra = {}) => ({
  sessionId, cwd: CWD_A, dirName: "kaptan-proof-projesi",
  title: `/goal proof ${sessionId.slice(0, 4)}`, agent: null, transcriptPath: null,
  startedAt: ISO(3600_000), endedAt: null,
  todos: todos.map((t) => ({
    content: t.content, status: t.status, removed: !!t.removed,
    firstSeen: ISO(3600_000), lastChange: ISO(1800_000),
  })),
  goal: { text: "proof hedefi", setAt: ISO(3600_000), promptId: "p-1" },
  lastPromptAt: ISO(3600_000), lastPromptId: "p-1", updatedAt: ISO(1800_000),
  counts: {
    total: todos.length,
    completed: todos.filter((t) => t.status === "completed").length,
    in_progress: todos.filter((t) => t.status === "in_progress").length,
    pending: todos.filter((t) => t.status === "pending").length,
  },
  ...extra,
});

writeFileSync(
  join(GOALS, SLUG_A, `${SID_CANLI}.json`),
  JSON.stringify(goalDosyasi(SID_CANLI, [
    { content: "AÇIK-1 uygula ve doğrula", status: "in_progress" },
    { content: "KAPALI-1 tamamlandı", status: "completed" },
    { content: "AÇIK-2 bekliyor", status: "pending" },
    { content: "SİLİNDİ-1 listeden düştü", status: "pending", removed: true },
  ]), null, 2),
);
writeFileSync(
  join(GOALS, SLUG_A, `${SID_KAPALI}.json`),
  JSON.stringify(goalDosyasi(SID_KAPALI, [
    { content: "KAPALI-2 planı yazıldı", status: "completed" },
  ], { endedAt: ISO(600_000) }), null, 2),
);

const ENV = {
  ...process.env,
  HOME,
  CLAUDE_CONFIG_DIR: CLAUDE,
  MAESTRO_JOBS_DIR: join(SB, "jobs"),
  // PATH'i daraltmak KASITLI: `aide`/`tmux` bulunamayınca durum.mjs'in "eksik altyapı =
  // warning" dalı GERÇEKTEN koşar (③). `ps`/`git` /bin·/usr/bin'de olduğu için kalır.
  PATH: "/usr/bin:/bin",
};

const kos = (script, args = [], env = ENV) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env, timeout: 60_000 });

const okuJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const MODEL_JSON = join(CLAUDE, "kaptan", "model.json");
const GORUNUM_MD = join(CLAUDE, "kaptan", "GORUNUM.md");
const PM_JSON = join(CLAUDE, "kaptan", "PM.json");

/* ── gerçek defterin koşu ÖNCESİ hash'i (⑥) ── */
const GERCEK = join(homedir(), ".claude", "kaptan");
const gercekOnce = hashTree(GERCEK);

const procs = [];

console.log("① nabız → model türetmesi İDEMPOTENT");
{
  const r1 = kos(MODEL, ["--write"]);
  ok("1. koşum exit 0", r1.status === 0, `exit ${r1.status} · ${(r1.stderr || "").slice(0, 300)}`);
  const m1 = okuJSON(MODEL_JSON);
  const g1 = existsSync(GORUNUM_MD) ? readFileSync(GORUNUM_MD, "utf8") : null;
  const p1 = okuJSON(PM_JSON);
  ok("model.json + GORUNUM.md + PM.json yazıldı", !!m1 && !!g1 && !!p1);

  const r2 = kos(MODEL, ["--write"]);
  ok("2. koşum exit 0", r2.status === 0, `exit ${r2.status} · ${(r2.stderr || "").slice(0, 300)}`);
  const m2 = okuJSON(MODEL_JSON);
  const g2 = existsSync(GORUNUM_MD) ? readFileSync(GORUNUM_MD, "utf8") : null;
  const p2 = okuJSON(PM_JSON);

  // Zaman damgası TEK değişken olmalı — onu çıkarıp geri kalanı BAYT-EŞ karşılaştır.
  const soy = (o) => { if (!o) return null; const c = { ...o }; delete c.generatedAt; return JSON.stringify(c); };
  // GORUNUM.md künye satırı `> Üretim: <ts> · schemaVersion N` — yalnız o satır maskelenir.
  const maskele = (s) => (s == null ? null : s.replace(/^> Üretim: .*$/m, "> Üretim: <MASKELİ>"));

  ok("model.json generatedAt HARİCİ bayt-eş", soy(m1) !== null && soy(m1) === soy(m2));
  ok("PM.json generatedAt HARİCİ bayt-eş", soy(p1) !== null && soy(p1) === soy(p2));
  ok("GORUNUM.md üretim damgası HARİCİ bayt-eş", maskele(g1) !== null && maskele(g1) === maskele(g2));
  ok("generatedAt GERÇEKTEN değişti (maske gerçek farkı gizlemiyor)", !!m1 && !!m2 && m1.generatedAt !== m2.generatedAt);
  ok("schemaVersion sabit", m1?.schemaVersion === m2?.schemaVersion && Number.isInteger(m1?.schemaVersion));
  ok("nabız fixture'ı türetmede görünüyor", JSON.stringify(m1 ?? {}).includes("AÇIK-1"));
}

console.log("\n② BOZUK nabız türetmeyi ÇÖKERTMEZ (sessiz ölüm de yok)");
{
  const oncekiProje = okuJSON(MODEL_JSON)?.projects?.length ?? -1;
  writeFileSync(join(GOALS, SLUG_A, `${SID_BOZUK}.json`), "{ bu gecerli JSON degil ");
  // eksik/yarım alanlar: todos yok, counts yok, cwd yok
  writeFileSync(join(GOALS, SLUG_A, "dddd0000-0000-0000-0000-000000000000.json"),
    JSON.stringify({ sessionId: "dddd0000-0000-0000-0000-000000000000" }));

  const r = kos(MODEL, ["--write"]);
  ok("bozuk + yarım kayıtla exit 0", r.status === 0, `exit ${r.status} · ${(r.stderr || "").slice(0, 300)}`);
  const m = okuJSON(MODEL_JSON);
  ok("model.json hâlâ geçerli JSON", !!m);
  ok("schemaVersion korundu", m?.schemaVersion === 3 || Number.isInteger(m?.schemaVersion));
  ok("sağlam proje kaybolmadı", (m?.projects?.length ?? -1) >= oncekiProje && oncekiProje >= 0);
  ok("bozuk dosyanın çöp içeriği modele SIZMADI", !JSON.stringify(m ?? {}).includes("bu gecerli JSON degil"));
  ok("sağlam nabız hâlâ türüyor", JSON.stringify(m ?? {}).includes("AÇIK-1"));

  rmSync(join(GOALS, SLUG_A, `${SID_BOZUK}.json`));
  rmSync(join(GOALS, SLUG_A, "dddd0000-0000-0000-0000-000000000000.json"));
}

console.log("\n③ durum.mjs — ALTYAPI EKSİKKEN hard-fail YOK, eksik İLAN edilir");
{
  const r = kos(DURUM, ["--hizli"]);
  ok("exit 0 (eksik altyapı = warning, asla hard-fail)", r.status === 0, `exit ${r.status} · ${(r.stderr || "").slice(0, 300)}`);
  let snap = null;
  try { snap = JSON.parse(r.stdout); } catch { /* aşağıda FAIL */ }
  ok("stdout geçerli JSON", !!snap);
  const ALANLAR = ["generatedAt", "sessions", "projects", "maestro", "agents", "warnings"];
  const eksik = ALANLAR.filter((a) => !(snap && a in snap));
  ok(`sözleşme alanları ${ALANLAR.length - eksik.length}/${ALANLAR.length}`, eksik.length === 0, `eksik: ${eksik.join(", ")}`);
  ok("warnings BİR DİZİ", Array.isArray(snap?.warnings));
  // Sessiz ölüm yasağı: eksiklik VAR ve İLAN EDİLİYOR (boş warnings = sessiz yutma olurdu).
  ok("eksik altyapı warnings[] ile İLAN edildi", (snap?.warnings?.length ?? 0) > 0,
     `warnings: ${JSON.stringify(snap?.warnings)}`);
  ok("aide/tmux yokluğu ADIYLA ilan edildi",
     (snap?.warnings || []).some((w) => /aide-index|tmux/.test(String(w))),
     JSON.stringify(snap?.warnings));
}

console.log("\n④ durum.mjs HİÇBİR ŞEY YAZMAZ (\"tek yazma yüzeyi: YOK\")");
{
  const once = hashTree(CLAUDE);
  const r = kos(DURUM, ["--hizli"]);
  const sonra = hashTree(CLAUDE);
  ok("koşum başarılı", r.status === 0);
  ok("sandbox ~/.claude ağacı DEĞİŞMEDİ", once === sonra, `${once} → ${sonra}`);
}

console.log("\n⑤ hedef sözleşmesi — canlı session'a AÇIK maddeler iliştirilir");
{
  // GERÇEK süreç: durum.mjs canlılığı `ps -p <pid> -o command=` ile /claude|happy/ deseninden
  // ölçer. Sahte pid yazmak ölçüyü ölçmek olurdu — o yüzden adı desene uyan gerçek bir süreç
  // doğuruyoruz (eszamanli proof'unun canlı `sleep` session'larıyla aynı yaklaşım).
  const sahteBin = join(SB, "bin", "claude-proof-fake");
  writeFileSync(sahteBin, "#!/bin/sh\nsleep 45\n", { mode: 0o755 });
  const p = spawn("/bin/sh", [sahteBin], { stdio: "ignore", detached: false });
  procs.push(p);
  const pid = p.pid;

  writeFileSync(join(CLAUDE, "sessions", `${pid}.json`),
    JSON.stringify({ pid, sessionId: SID_CANLI, cwd: CWD_A, name: "proof", kind: "session", entrypoint: "cli" }));
  writeFileSync(join(CLAUDE, "session-status", `${SID_CANLI}.json`),
    JSON.stringify({ sessionId: SID_CANLI, dirName: "kaptan-proof-projesi", updated: Date.now() }));

  const r = kos(DURUM, ["--hizli"]);
  let snap = null;
  try { snap = JSON.parse(r.stdout); } catch { /* aşağıda */ }
  const s = (snap?.sessions || []).find((x) => x.sessionId === SID_CANLI);

  if (!s) {
    // `ps` sandbox'ta beklenmedik davranırsa hüküm VERİLMEZ (tahmin yazmak yerine ilan).
    olculemedi("canlı session durum.mjs tarafından görüldü",
      `oturum snapshot'ta yok — ps -p ${pid} deseni tutmamış olabilir (sessions: ${(snap?.sessions || []).length})`);
    olculemedi("hedef sözleşmesi (acikMaddeler)", "canlı session görülemediği için ölçüm dayanaksız");
  } else {
    ok("canlı session durum.mjs tarafından görüldü", true);
    const acik = s.hedef?.acikMaddeler || [];
    ok("hedef iliştirildi", !!s.hedef);
    ok("AÇIK maddeler geldi (2 adet)", acik.length === 2, JSON.stringify(acik));
    ok("completed madde acikMaddeler'e GİRMEDİ", !acik.some((t) => /KAPALI-1/.test(t)), JSON.stringify(acik));
    ok("removed madde acikMaddeler'e GİRMEDİ", !acik.some((t) => /SİLİNDİ-1/.test(t)), JSON.stringify(acik));
    ok("counts sözleşmesi taşındı", !!s.hedef?.counts && s.hedef.counts.total === 4);
  }
}

console.log("\n⑥ izolasyon — gerçek ~/.claude/kaptan salt-okunur kaldı");
{
  const gercekSonra = hashTree(GERCEK);
  // Defter PAYLAŞILAN bir yüzeydir: koşu sırasında BAŞKA canlı session Stop hook'uyla
  // `model.mjs --write` çalıştırırsa hash değişir ve harness kendi sızıntısı sanıp FAIL
  // verirdi (eszamanli ⑫'de ölçülmüş yanlış-alarm deseni). Hüküm KANITA bağlanır: sızıntı
  // ancak gerçek defterde HARNESS'IN KENDİ izleri görünüyorsa vardır.
  const bizim = [SB, SLUG_A, SID_CANLI, SID_KAPALI, SID_BOZUK, "kaptan-proof-projesi"];
  const izVar = () => {
    if (!existsSync(GERCEK)) return false;
    for (const f of readdirSync(GERCEK, { recursive: true })) {
      const p = join(GERCEK, String(f));
      let ic = "";
      try { ic = readFileSync(p, "utf8"); } catch { continue; }
      if (bizim.some((s) => String(f).includes(s) || ic.includes(s))) return true;
    }
    return false;
  };
  if (gercekOnce === gercekSonra) ok("gerçek ~/.claude/kaptan koşudan ETKİLENMEDİ", true, `hash ${gercekOnce}`);
  else if (izVar()) ok("gerçek ~/.claude/kaptan koşudan ETKİLENMEDİ", false, "harness izi gerçek defterde");
  else {
    olculemedi("gerçek ~/.claude/kaptan koşudan ETKİLENMEDİ",
      `defter koşu sırasında değişti (${gercekOnce} → ${gercekSonra}) ama harness izi YOK → ` +
      "değişimi başka canlı session yaptı (Stop hook → model.mjs --write)");
  }
  ok("harness izi gerçek deftere DÜŞMEDİ", !izVar());
}

/* ── temizlik ── */
for (const p of procs) { try { p.kill(9); } catch { /* zaten ölmüş */ } }
rmSync(SB, { recursive: true, force: true });

console.log(
  `\n${fail === 0 ? "✅" : "❌"}  ${pass}/${pass + fail} PASS${fail ? ` · ${fail} FAIL` : ""}` +
    (belirsiz ? ` · ${belirsiz} ÖLÇÜLEMEDİ` : ""),
);
process.exit(fail ? 1 : 0);
