#!/usr/bin/env node
// kaptan durum toplayıcı — projeler-arası tek-atış durum anlık görüntüsü (JSON).
// Sıfır bağımlılık (node stdlib). Eksik altyapı = warning; asla hard-fail etmez.
// Kullanım: node/bun durum.mjs [--json] [--proje <path>] [--hizli] [--derin]
//   --hizli : git + transcript okumalarını atla (yalnız session/maestro/agents)
//   --derin : proje başına en yeni transcript kuyruğundan son konuşma satırlarını ekle
// Kaynaklar (hepsi salt-okunur):
//   ~/.claude/session-status/*.json  ~/.claude/sessions/<pid>.json
//   ~/.claude/projects/<slug>/*.jsonl  ~/.config/agent-ide/{instances,config}.json
//   $MAESTRO_JOBS_DIR || <AIDE_ROOT>/jobs  ~/.claude/kaptan/projects/<slug>/
// Tek yazma yüzeyi: YOK (bu script hiçbir şey yazmaz).

import { execFileSync } from "node:child_process";
import {
  readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync, fstatSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readGoal, openItems } from "./model.mjs";

const HOME = homedir();
const CLAUDE = join(HOME, ".claude");
const FRESH_MS = 90_000; // sessions.ts:FRESH_MS aynası
const args = process.argv.slice(2);
const opt = {
  hizli: args.includes("--hizli"),
  derin: args.includes("--derin"),
  proje: args.includes("--proje") ? args[args.indexOf("--proje") + 1] : null,
};
const warnings = [];

// /Users/ybg/dev/agent-ide kurulumda kit tarafından doldurulur; repo'dan ham koşuluyorsa tahmin et.
const AIDE_ROOT = (() => {
  const raw = "/Users/ybg/dev/agent-ide";
  if (!raw.startsWith("{{")) return raw;
  const guess = join(HOME, "dev", "agent-ide");
  return existsSync(guess) ? guess : null;
})();

function sh(cmd, argv, timeout = 4000) {
  try {
    return execFileSync(cmd, argv, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
function readJSON(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function tailText(p, bytes = 256 * 1024) {
  try {
    const fd = openSync(p, "r");
    const size = fstatSync(fd).size;
    const n = Math.min(bytes, size);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}
const slugOf = (p) => p.replace(/[^A-Za-z0-9]/g, "-");

// ── 1) Canlı session'lar (pid doğrulamalı) ─────────────────────────────────
function pidAliveClaude(pid) {
  const cmd = sh("ps", ["-p", String(pid), "-o", "command="]);
  return !!cmd && /claude|happy/i.test(cmd);
}
function collectSessions() {
  const statusDir = join(CLAUDE, "session-status");
  const sessDir = join(CLAUDE, "sessions");
  const statusBy = new Map();
  let stale = 0;
  if (existsSync(statusDir)) {
    for (const f of readdirSync(statusDir)) {
      const s = readJSON(join(statusDir, f));
      if (s?.sessionId) statusBy.set(s.sessionId, s);
    }
  } else warnings.push("session-status-dizini-yok");
  const out = [];
  if (existsSync(sessDir)) {
    for (const f of readdirSync(sessDir)) {
      const rec = readJSON(join(sessDir, f));
      if (!rec?.pid || !rec?.sessionId) continue;
      if (!pidAliveClaude(rec.pid)) { stale++; continue; }
      const st = statusBy.get(rec.sessionId);
      const fresh = !!st && Date.now() - (st.updated ?? 0) < FRESH_MS;
      out.push({
        sessionId: rec.sessionId, pid: rec.pid, cwd: rec.cwd,
        dirName: st?.dirName ?? rec.cwd?.split("/").pop(),
        name: rec.name, kind: rec.kind, entrypoint: rec.entrypoint,
        state: fresh ? (st.state ?? "idle") : (st?.state ?? "bilinmiyor"),
        fresh, title: st?.title ?? null, lastTool: st?.lastTool ?? null,
        updated: st?.updated ?? null, tmux: null,
      });
    }
  } else warnings.push("sessions-dizini-yok");
  if (stale) warnings.push(`olu-pid-kaydi:${stale}`);
  // Aynı sessionId birden çok pid dosyasında görünebilir — fresh > daha yeni updated kazanır.
  const byId = new Map();
  for (const s of out) {
    const prev = byId.get(s.sessionId);
    const better = !prev || (s.fresh !== prev.fresh ? s.fresh : (s.updated ?? 0) > (prev.updated ?? 0));
    if (better) byId.set(s.sessionId, s);
  }
  return [...byId.values()];
}

// ── 2) tmux pane eşlemesi (routing çapası) — default + aide soketleri ──────
function psTree() {
  const out = sh("ps", ["-ax", "-o", "pid=,ppid="]);
  const tree = new Map();
  if (!out) return tree;
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) tree.set(Number(m[1]), Number(m[2]));
  }
  return tree;
}
function ancestryHits(pid, panePid, tree) {
  let cur = pid;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur === panePid) return true;
    cur = tree.get(cur);
  }
  return false;
}
function tmuxArgs(socket, rest) { return socket ? ["-L", socket, ...rest] : rest; }
function paneIdle(socket, paneId) {
  const text = sh("tmux", tmuxArgs(socket, ["capture-pane", "-p", "-t", paneId]));
  if (!text || !text.trim()) return false;
  const tail = text.trimEnd().split("\n").slice(-15).join("\n");
  if (/esc to interrupt|Mulling|Thinking|Working|tokens\)/i.test(tail)) return false;
  // dialog/menü ekranı (trust dialog vb.) idle DEĞİL — menü imleci de ❯ kullanır
  if (/Enter to confirm|Esc to cancel|trust this folder|Security guide/i.test(tail)) return false;
  return /❯|\$\s*$|%\s*$/m.test(tail);
}
function mapTmux(sessions) {
  // ayraç '|' — tmux, format çıktısındaki tab gibi kontrol karakterlerini '_' yapar
  const fmt = "#{pane_id}|#{pane_pid}|#{session_name}:#{window_index}.#{pane_index}|#{pane_current_path}";
  const panes = [];
  let anyServer = false;
  for (const socket of [null, "aide"]) {
    const out = sh("tmux", tmuxArgs(socket, ["list-panes", "-a", "-F", fmt]));
    if (out == null) continue;
    anyServer = true;
    for (const line of out.trim().split("\n").filter(Boolean)) {
      const [paneId, panePid, target, ...rest] = line.split("|");
      const path = rest.join("|");
      panes.push({ socket, paneId, panePid: Number(panePid), target, path });
    }
  }
  if (!anyServer) { warnings.push("tmux-sunucusu-yok"); return; }
  const tree = psTree();
  for (const s of sessions) {
    const pane = panes.find((p) => ancestryHits(s.pid, p.panePid, tree));
    if (pane) {
      s.tmux = {
        socket: pane.socket, paneId: pane.paneId, target: pane.target,
        idle: paneIdle(pane.socket, pane.paneId),
      };
    }
  }
}

// ── 3) Projeler (git + transcript kuyruğu) ──────────────────────────────────
function latestTranscript(slugDir) {
  try {
    const files = readdirSync(slugDir).filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f, m: statSync(join(slugDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files[0] ? { path: join(slugDir, files[0].f), mtime: files[0].m } : null;
  } catch { return null; }
}
function cwdFromTranscript(p) {
  const m = tailText(p, 64 * 1024).match(/"cwd":"([^"]+)"/);
  if (m) return m[1];
  // kuyrukta yoksa (dev satırlar) baştan dene — ilk kayıtlarda cwd hep vardır
  try {
    const fd = openSync(p, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const h = buf.toString("utf8", 0, n).match(/"cwd":"([^"]+)"/);
    return h ? h[1] : null;
  } catch { return null; }
}
function transcriptTail(p, n = 6) {
  const lines = tailText(p).split("\n").filter(Boolean);
  const msgs = [];
  for (let i = lines.length - 1; i >= 0 && msgs.length < n; i--) {
    let j; try { j = JSON.parse(lines[i]); } catch { continue; }
    const role = j.type === "user" ? "user" : j.type === "assistant" ? "assistant" : null;
    if (!role) continue;
    const c = j.message?.content;
    let text = typeof c === "string" ? c
      : Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join(" ") : "";
    text = text.replace(/\s+/g, " ").trim();
    if (text) msgs.unshift({ role, text: text.slice(0, 240) });
  }
  return msgs;
}
// Proje başına recent session envanteri — kapalı session'ları `claude --resume <id>`
// ile devam ettirebilmenin veri tabanı. Dosya adı = sessionId (~/.claude/projects/<slug>/).
function recentSessions(slugDir, slug, liveIds) {
  try {
    const cutoff = Date.now() - 14 * 24 * 3600_000;
    const files = readdirSync(slugDir).filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ id: f.slice(0, -6), m: statSync(join(slugDir, f)).mtimeMs, p: join(slugDir, f) }))
      .filter((x) => x.m > cutoff).sort((a, b) => b.m - a.m).slice(0, 6);
    return files.map((x) => {
      const goal = readGoal(slug, x.id); // canlı VEYA arşiv (model.mjs)
      const acik = openItems(goal).length;
      const rec = {
        sessionId: x.id, sonAktivite: new Date(x.m).toISOString(),
        canli: liveIds.has(x.id), title: goal?.title ?? null,
        acikHedef: acik, yarimKalan: !liveIds.has(x.id) && acik > 0,
        devam: liveIds.has(x.id) ? null : `claude --resume ${x.id}`,
      };
      if (opt.derin) {
        const son = transcriptTail(x.p, 1)[0];
        rec.sonMesaj = son ? `${son.role}: ${son.text.slice(0, 160)}` : null;
      }
      return rec;
    });
  } catch { return []; }
}

// Proje başına kullanılabilir skill/komut envanteri — kaptan talimatı doğru
// slash-komuta çevirebilsin diye (yalnız isim listesi, içerik okunmaz).
function projectSkills(root) {
  const out = [];
  try {
    const sd = join(root, ".claude", "skills");
    if (existsSync(sd)) for (const d of readdirSync(sd)) {
      if (existsSync(join(sd, d, "SKILL.md"))) out.push(`/${d}`);
    }
  } catch {}
  try {
    const cd = join(root, ".claude", "commands");
    if (existsSync(cd)) for (const f of readdirSync(cd)) {
      if (f.endsWith(".md")) out.push(`/${f.slice(0, -3)}`);
    }
  } catch {}
  return out.slice(0, 40);
}

// Global (~/.claude) skill envanteri — projeye ÖZEL yazılmış ama global kurulmuş
// kanıt-skilleri (ör. dorukcom'un /ana-kontrol, /sayfa-kontrol'ü) routing'de
// görünmez kalmasın. Bir kez hesaplanır, her projeye aynı liste gider.
let _globalSkills = null;
function globalSkills() {
  if (_globalSkills) return _globalSkills;
  _globalSkills = projectSkills(HOME);
  return _globalSkills;
}

function gitInfo(root) {
  if (!existsSync(join(root, ".git"))) return null;
  const branch = sh("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"])?.trim() ?? null;
  const log = sh("git", ["-C", root, "log", "-5", "--format=%h %ar %s"])?.trim().split("\n") ?? [];
  const dirty = sh("git", ["-C", root, "status", "--porcelain"])?.trim();
  return { branch, son_commitler: log, kirli_dosya: dirty ? dirty.split("\n").length : 0 };
}
function collectProjects(sessions) {
  const projDir = join(CLAUDE, "projects");
  const cand = new Map(); // realPath → {slug, lastActivity}
  for (const s of sessions) {
    if (s.cwd) cand.set(s.cwd, { slug: slugOf(s.cwd), lastActivity: s.updated ?? Date.now() });
  }
  if (existsSync(projDir)) {
    const cutoff = Date.now() - 7 * 24 * 3600_000;
    const recent = readdirSync(projDir)
      .map((d) => {
        const t = latestTranscript(join(projDir, d));
        return t && t.mtime > cutoff ? { d, t } : null;
      })
      .filter(Boolean).sort((a, b) => b.t.mtime - a.t.mtime).slice(0, 8);
    for (const { d, t } of recent) {
      if ([...cand.values()].some((c) => c.slug === d)) continue;
      // en yeni dosya cwd'siz stub olabilir (subagent ai-title kaydı) → birkaç dosya dene
      let cwd = null;
      try {
        const cands = readdirSync(join(projDir, d)).filter((f) => f.endsWith(".jsonl"))
          .map((f) => ({ p: join(projDir, d, f), m: statSync(join(projDir, d, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m).slice(0, 5);
        for (const c of cands) { cwd = cwdFromTranscript(c.p); if (cwd) break; }
      } catch {}
      if (cwd && existsSync(cwd)) cand.set(cwd, { slug: d, lastActivity: t.mtime });
      else warnings.push(`proje-yolu-cozulemedi:${d}`);
    }
  }
  let entries = [...cand.entries()];
  if (opt.proje) entries = entries.filter(([p]) => p === opt.proje || p.endsWith("/" + opt.proje));
  const liveIds = new Set(sessions.map((s) => s.sessionId));
  return entries.sort((a, b) => b[1].lastActivity - a[1].lastActivity).map(([root, meta]) => {
    const slugDir = join(projDir, meta.slug);
    const proj = {
      root, slug: meta.slug, sonAktivite: new Date(meta.lastActivity).toISOString(),
      canliSessionlar: sessions.filter((s) => s.cwd === root).map((s) => s.sessionId),
      sonSessionlar: opt.hizli ? undefined : recentSessions(slugDir, meta.slug, liveIds),
      skills: opt.hizli ? undefined : projectSkills(root),
      globalSkills: opt.hizli ? undefined : globalSkills(),
      git: opt.hizli ? undefined : gitInfo(root),
      kaptan: kaptanRecords(meta.slug),
    };
    if (opt.derin && !opt.hizli) {
      const t = latestTranscript(slugDir);
      proj.sonKonusma = t ? transcriptTail(t.path) : [];
    }
    return proj;
  });
}

// ── 4) Maestro (jobs + daemon) ──────────────────────────────────────────────
function collectMaestro() {
  const jobsDir = process.env.MAESTRO_JOBS_DIR || (AIDE_ROOT ? join(AIDE_ROOT, "jobs") : null);
  const daemon = !!sh("pgrep", ["-f", "bin/metronom.mjs"])?.trim();
  // launchd kalıcılığı: plist yüklü mü (reboot sonrası daemon kendiliğinden kalkar mı)
  const uid = typeof process.getuid === "function" ? process.getuid() : sh("id", ["-u"])?.trim();
  const launchd = !!sh("launchctl", ["print", `gui/${uid}/com.aide.maestro.metronom`]);
  if (!jobsDir || !existsSync(jobsDir)) {
    warnings.push("maestro-jobs-yok");
    return AIDE_ROOT ? { jobsDir, daemon, launchd, jobs: [] } : null;
  }
  const jobs = readdirSync(jobsDir)
    .filter((d) => { try { return statSync(join(jobsDir, d)).isDirectory(); } catch { return false; } })
    .map((d) => {
      const dir = join(jobsDir, d);
      const job = readJSON(join(dir, "job.json"));
      const state = readJSON(join(dir, "state.json"));
      if (!job) return null;
      const runs = tailText(join(dir, "history", "runs.jsonl"), 16 * 1024)
        .split("\n").filter(Boolean).slice(-3)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      let m = 0; try { m = statSync(join(dir, "state.json")).mtimeMs; } catch {}
      return { id: d, title: job.title ?? null, trigger: job.trigger ?? null,
        payload: job.payload?.kind ?? null, status: state?.state ?? null, sonKosular: runs, _m: m };
    })
    .filter(Boolean).sort((a, b) => b._m - a._m).slice(0, 20)
    .map(({ _m, ...j }) => j);
  return { jobsDir, daemon, launchd, jobs };
}

// ── 5) Agent instance'ları ──────────────────────────────────────────────────
function collectAgents() {
  const p = join(HOME, ".config", "agent-ide", "instances.json");
  const list = readJSON(p);
  if (!Array.isArray(list)) return null;
  return list.slice(-10).reverse().map((i) => ({
    id: i.id, ref: i.ref, name: i.name, cwd: i.cwd,
    startedAt: i.startedAt, live: !i.stoppedAt,
  }));
}

// ── 6) kaptan PM kayıtları (~/.claude/kaptan) ───────────────────────────────
// Session hedefleri: goal-tracker.mjs hook'unun yazdığı TodoWrite kalıcı kayıtları.
function goalRecords(slug) {
  const dir = join(CLAUDE, "kaptan", "goals", slug);
  if (!existsSync(dir)) return [];
  let recs = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const r = readJSON(join(dir, f));
    if (!r?.sessionId) continue;
    const acikMaddeler = openItems(r); // resolution-farkındalıklı açık maddeler (model.mjs)
    recs.push({
      sessionId: r.sessionId, title: r.title ?? null,
      agent: r.agent ?? null, transcriptPath: r.transcriptPath ?? null,
      startedAt: r.startedAt ?? null, updatedAt: r.updatedAt ?? null, endedAt: r.endedAt ?? null,
      counts: r.counts ?? null, acikMaddeler,
      yarimKalan: r.endedAt != null && acikMaddeler.length > 0,
    });
  }
  return recs.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 8);
}
function kaptanRecords(slug) {
  const dir = join(CLAUDE, "kaptan", "projects", slug);
  const hedefler = goalRecords(slug);
  if (!existsSync(dir)) return hedefler.length ? { dir: null, acikTasklar: [], sonKayitlar: [], hedefler } : null;
  const tasksRaw = existsSync(join(dir, "tasks.md")) ? readFileSync(join(dir, "tasks.md"), "utf8") : "";
  const acikTasklar = tasksRaw.split("\n").filter((l) => l.trim().startsWith("- [ ]"))
    .map((l) => l.replace(/^\s*- \[ \]\s*/, "").slice(0, 160));
  const sonKayitlar = tailText(join(dir, "log.jsonl"), 16 * 1024)
    .split("\n").filter(Boolean).slice(-3)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { dir, acikTasklar, sonKayitlar, hedefler };
}

// Canlı session'a hedef özetini iliştir (goals/<slug>/<sessionId>.json).
function attachGoals(sessions) {
  for (const s of sessions) {
    if (!s.cwd) { s.hedef = null; continue; }
    const r = readGoal(slugOf(s.cwd), s.sessionId); // canlı VEYA arşiv (model.mjs)
    s.hedef = r ? {
      counts: r.counts ?? null,
      acikMaddeler: openItems(r),
    } : null;
  }
}

// ── Yüzey (surface) join'i — TEK KAYNAK `aide index` ────────────────────────
// Sınıflandırma mantığı (pane-soyağacı ÖNCE, damga son çare) aide core'da yaşar
// (packages/core/src/surface.ts); burada ÇOĞALTILMAZ — kopya kaçınılmaz sapar.
// aide PATH'te yoksa/başarısızsa surface'sız devam edilir + uyarı düşülür.
function attachSurfaces(sessions) {
  const aideBin = [join(HOME, ".bun", "bin", "aide"), "aide"].find(
    (p) => p === "aide" || existsSync(p),
  );
  const raw = sh(aideBin, ["index"], 8000);
  if (!raw) { warnings.push("surface-kaynak-yok:aide-index"); return; }
  let rows;
  try { rows = JSON.parse(raw); } catch { warnings.push("surface-kaynak-bozuk:aide-index"); return; }
  const byId = new Map(rows.map((r) => [r.id, r.surface]));
  for (const s of sessions) {
    const y = byId.get(s.sessionId);
    if (y) s.surface = y;
  }
}

// ── Çıktı ───────────────────────────────────────────────────────────────────
const sessions = collectSessions();
mapTmux(sessions);
attachSurfaces(sessions);
attachGoals(sessions);
const snapshot = {
  generatedAt: new Date().toISOString(),
  sessions,
  projects: collectProjects(sessions),
  maestro: collectMaestro(),
  agents: collectAgents(),
  warnings,
};
process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
