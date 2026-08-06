#!/usr/bin/env node
/**
 * kaptan GERİ-DOLDURUCU — hook öncesi geçmişi nabza kazandırır.
 *
 * goal-tracker.mjs hook'u 2026-07-06'da devreye girdi; ondan önceki oturumların
 * TodoWrite çağrıları hiç kaydedilmedi. Bu script transcript'leri (~/.claude/projects)
 * tarar, TodoWrite anlık görüntülerini SIRAYLA replay ederek nabız kaydını yeniden
 * inşa eder — hook'un canlı yazdığıyla aynı şema.
 *
 * Yıkıcı DEĞİL: yalnızca eksik (var olmayan) kayıtları yazar. --force ile üzerine yazar.
 *
 *   node backfill.mjs [--project <slug|cwd|dirName>] [--dry-run] [--force]
 */

import { homedir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, renameSync } from "node:fs";

const CLAUDE = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE, "projects");
const GOALS_DIR = join(CLAUDE, "kaptan", "goals");
const ARCHIVE_DIR = join(GOALS_DIR, "_archive");

/** Transcript'i satır satır oku (bozuk satırları atla). */
function* readLines(file) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return; }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* bozuk satır */ }
  }
}

const firstText = (c) =>
  typeof c === "string" ? c : (Array.isArray(c) ? c.map((x) => x?.text || "").join(" ") : "");

// Kullanıcı promptu gibi görünen ama sistemin enjekte ettiği metinler — başlık olamaz.
const SYSTEM_NOTICE = [
  /^A session-scoped Stop hook/i,
  /^Caveat:/i,
  /^\[Request interrupted/i,
  /system-reminder/i,
  /^This session is being continued/i,
];
const isSystemNotice = (t) => SYSTEM_NOTICE.some((re) => re.test(t));

/**
 * TodoWrite anlık görüntülerini replay et → hook'un ürettiği todos[] yapısı.
 * Semantik (goal-tracker aynası): listeden düşen madde SİLİNMEZ, removed=true olur.
 */
function replay(file) {
  const map = new Map(); // content → {content,status,firstSeen,lastChange,removed}
  let sessionId = null, cwd = null, entrypoint = null, title = null;
  let startedAt = null, endedAt = null, snapshots = 0, lastSnapshot = [];

  for (const j of readLines(file)) {
    if (j.isSidechain) continue; // alt-ajan turları ana nabza girmez
    const ts = j.timestamp || null;
    if (ts) { if (!startedAt) startedAt = ts; endedAt = ts; }
    if (!sessionId && j.sessionId) sessionId = j.sessionId;
    if (!cwd && j.cwd) cwd = j.cwd;
    if (!entrypoint && j.entrypoint) entrypoint = j.entrypoint;
    if (!title && j.type === "user") {
      const t = firstText(j.message?.content).replace(/\s+/g, " ").trim();
      if (t && !t.startsWith("<") && !isSystemNotice(t)) title = t.slice(0, 200);
    }

    const tus = (j.message?.content || []).filter?.((c) => c?.type === "tool_use" && c.name === "TodoWrite") || [];
    for (const tu of tus) {
      const todos = tu.input?.todos;
      if (!Array.isArray(todos)) continue;
      snapshots++;
      lastSnapshot = todos;
      const seen = new Set();
      for (const t of todos) {
        const content = String(t.content || "").trim();
        if (!content) continue;
        seen.add(content);
        const status = t.status || "pending";
        const e = map.get(content);
        if (!e) map.set(content, { content, status, firstSeen: ts, lastChange: ts, removed: false });
        else {
          e.removed = false;
          if (e.status !== status) { e.status = status; e.lastChange = ts; }
        }
      }
      for (const [c, e] of map) if (!seen.has(c)) e.removed = true; // yıkıcı-olmayan silme
    }
  }
  if (!snapshots || !sessionId) return null;

  const counts = { total: lastSnapshot.length, completed: 0, in_progress: 0, pending: 0 };
  for (const t of lastSnapshot) if (counts[t.status] != null) counts[t.status]++;

  return {
    sessionId, cwd, dirName: cwd ? basename(cwd) : null,
    title: title || "(başlıksız)",
    agent: null,
    transcriptPath: file,
    startedAt, endedAt, // geçmiş oturum → kapalı sayılır
    todos: [...map.values()],
    updatedAt: endedAt,
    counts,
    backfilled: true, // kaynak: transcript replay (hook değil)
    entrypoint,
  };
}

function writeRecord(slug, rec) {
  const dir = join(GOALS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${rec.sessionId}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(rec, null, 1), { mode: 0o600 });
  renameSync(tmp, target);
  return target;
}

const hasRecord = (slug, sid) =>
  existsSync(join(GOALS_DIR, slug, `${sid}.json`)) || existsSync(join(ARCHIVE_DIR, slug, `${sid}.json`));

const isMain = (() => {
  try { return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const val = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const want = val("--project");

  let slugs;
  try { slugs = readdirSync(PROJECTS_DIR).filter((d) => !d.startsWith(".")); }
  catch { console.error("transcript dizini okunamadı"); process.exit(1); }
  if (want) slugs = slugs.filter((s) => s === want || s.endsWith("-" + want) || s.includes(want.replace(/[^A-Za-z0-9]/g, "-")));
  if (!slugs.length) { console.error(`proje bulunamadı: ${want}`); process.exit(1); }

  let wrote = 0, skipped = 0, noTodo = 0;
  for (const slug of slugs) {
    let files;
    try { files = readdirSync(join(PROJECTS_DIR, slug)).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const sid = f.slice(0, -6);
      if (!force && hasRecord(slug, sid)) { skipped++; continue; }
      const rec = replay(join(PROJECTS_DIR, slug, f));
      if (!rec) { noTodo++; continue; } // TodoWrite hiç kullanılmamış → task yok → nabza girmez
      if (dryRun) {
        console.log(`+ ${slug}/${sid.slice(0, 8)}  ${rec.todos.length} madde  "${rec.title.slice(0, 50)}"`);
      } else {
        writeRecord(slug, rec);
        console.log(`✓ ${slug}/${sid.slice(0, 8)}  ${rec.todos.length} madde`);
      }
      wrote++;
    }
  }
  console.error(`\n${dryRun ? "[dry-run] " : ""}yazılan: ${wrote} · zaten var: ${skipped} · task üretmemiş (atlandı): ${noTodo}`);
}

export { replay };
