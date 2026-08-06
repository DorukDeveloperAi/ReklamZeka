#!/usr/bin/env node
/**
 * Claude session status hook.
 *
 * Reads a Claude Code hook JSON payload on stdin and updates a per-session
 * status file at ~/.claude/session-status/<session_id>.json. A companion
 * VSCode extension watches that directory to render live session state.
 *
 * Usage (from settings.json hooks):
 *   node ~/.claude/hooks/session-status.mjs <event>
 * where <event> is one of:
 *   session_start | prompt_submit | pre_tool | post_tool | waiting | stop | session_end
 *
 * Designed to be safe + non-blocking (configured with "async": true). Any
 * failure exits 0 so it never disrupts the session.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";

// KOŞUM DAMGASI (otonomi-merdiveni:02.3) — `aide otomasyon durum`un akıbet ekseni bunu okur.
// Dinamik import + try: damga yazarı yoksa ya da bozuksa hook KOŞMAYA DEVAM EDER; bir ölçüm
// aracı ölçtüğü şeyi asla bozamaz. Maliyet: bir dosya yazımı, 0 token.
try { (await import("./hook-nabiz.mjs")).nabiz("session-status", process.argv[2]); } catch {}

const STATUS_DIR = join(homedir(), ".claude", "session-status");
const event = process.argv[2] || "";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadExisting(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function atomicWrite(file, obj) {
  // Unique-ish tmp suffix without Date.now()/Math.random() guarantees, but
  // those are available in a normal node process — pid + hrtime is plenty.
  const tmp = `${file}.tmp-${process.pid}-${process.hrtime.bigint()}`;
  writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  renameSync(tmp, file);
}

function truncate(s, n) {
  if (typeof s !== "string") return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/**
 * Sahip claude sürecinin {pid, procStart}'ı. Süreç-ağacı tırmanışı TEK kaynakta
 * (claims-lib.claudeAncestor) yaşar — ikinci bir motor yazılmaz. Dinamik import:
 * claims-lib yoksa/bozuksa session-status yine de çalışır (kayıt pid'siz kalır,
 * tüketici tarafta "canlılığı kanıtlanamaz" = ölü sayılır — kapalı-fail).
 * Yalnız session'ın İLK olayında koşar (sonra prev.pid'ten okunur).
 */
async function claudeProc() {
  try {
    const L = await import("./claims-lib.mjs");
    const a = L.claudeAncestor();
    return a ? { pid: a.pid, procStart: a.start } : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const payload = safeParse(readStdin());

  const sessionId =
    payload.session_id || payload.sessionId || process.env.CLAUDE_SESSION_ID;
  if (!sessionId) return; // nothing we can key on

  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  const file = join(STATUS_DIR, `${sessionId}.json`);

  if (event === "session_end") {
    try {
      rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
    return;
  }

  const now = Date.now();
  const prev = loadExisting(file);
  const cwd = payload.cwd || prev.cwd || process.cwd();
  const dirName = cwd ? cwd.split("/").filter(Boolean).pop() || cwd : "?";

  // Sahip süreç kimliği: claim defterinin (claims-lib.mjs) CANLILIK ölçütü budur.
  // Dosyanın VARLIĞI canlılık DEĞİLDİR — crash'te SessionEnd ateşlenmez ve kayıt
  // sonsuza dek "generating" kalır (ölçüldü: aylar öncesinden 100+ ölü kayıt).
  // pid TEK BAŞINA da yetmez: pid geri dönüşür → süreç başlama zamanıyla çift.
  const owner = prev.pid ? { pid: prev.pid, procStart: prev.procStart } : await claudeProc();

  const next = {
    sessionId,
    cwd,
    dirName,
    state: prev.state || "idle",
    since: prev.since || now,
    updated: now,
    lastTool: prev.lastTool,
    title: prev.title,
    pid: owner?.pid,
    procStart: owner?.procStart,
  };

  const setState = (state) => {
    if (next.state !== state) next.since = now;
    next.state = state;
  };

  switch (event) {
    case "session_start":
      setState("idle");
      break;
    case "prompt_submit":
      setState("generating");
      next.title = truncate(payload.prompt, 70) || next.title;
      next.lastTool = undefined;
      break;
    case "pre_tool": {
      const tool = payload.tool_name || "";
      // Kullanıcıya soru soran / plan onayı bekleyen araçlar → bekliyor.
      if (tool === "AskUserQuestion" || tool === "ExitPlanMode") setState("waiting");
      else setState("generating");
      next.lastTool = tool || next.lastTool;
      break;
    }
    case "post_tool":
      // bir araç bitti, iş sürüyor
      setState("generating");
      next.lastTool = payload.tool_name || next.lastTool;
      break;
    case "waiting":
      // Notification: yalnız İŞ SÜRERKEN gelen bildirim (izin/soru) = "cevap bekliyor".
      // Tur bittiyse (done) idle hatırlatması durumu bozmasın — done "review bekliyor"
      // olarak kalır; waiting sadece turu bloke eden girdiler içindir.
      if (prev.state === "generating" || prev.state === "waiting") setState("waiting");
      break;
    case "stop":
      // Tur tamamlandı → "done" (review bekliyor). Tüketiciler (aide TUI,
      // claude-session-monitor) csm-seen.json'daki görüldü kaydıyla birleştirip
      // done_unseen/done_seen türetir. Eski "idle" yalnız session_start'ta kalır.
      setState("done");
      break;
    default:
      // unknown event: just bump heartbeat
      break;
  }

  atomicWrite(file, next);
}

// main() artık async (pid çözümü için dinamik import) → process.exit'i AWAIT SONRASINA
// bırak; eskisi gibi senkron exit çağırmak yazımı yarıda keserdi.
main()
  .catch(() => {
    /* never disrupt the session */
  })
  .finally(() => process.exit(0));
