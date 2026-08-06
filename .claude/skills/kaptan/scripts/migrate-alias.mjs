#!/usr/bin/env node
/**
 * TEK SEFERLİK — epic künye defterini SLUG EKSENİ düzeltmesine taşı.
 *
 * projects.json takma-adı + fragment birleştirme devreye girince bir session'ın
 * kanonik projesi değişir (ör. ~/.claude/kaptan'da yazılmış oturum artık agent-ide'nin).
 * epics/<slug>.json ise ESKİ slug'la anahtarlıydı → model.mjs onları artık okumaz ve
 * elle küratörlenmiş `status` / `backlogRef` / `match` alanları kaybolur.
 *
 * Bu script her epic'in ÜYELERİNİ yeni kanonik projelerine dağıtır, aynı oturumu
 * paylaşan epic'leri (ör. "aide-pane-yonetimi" ↔ "aide-pane-yonetimi-ybg") birleştirir,
 * küratörlü alanlarda non-null kazandırır. Yıkıcı değil: özgün dosyalar
 * epics/_alias-oncesi/ altına yedeklenir.
 *
 *   node migrate-alias.mjs --dry-run     # ZORUNLU ilk koşum
 *   node migrate-alias.mjs --apply
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { loadSessions } from "./model.mjs";

const CLAUDE = join(homedir(), ".claude");
const EPICS_DIR = join(CLAUDE, "kaptan", "epics");
const BACKUP_DIR = join(EPICS_DIR, "_alias-oncesi");
const CURATED = ["status", "backlogRef", "match"];

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = args.includes("--dry-run") || !apply;

// ── 1) sessionId → kanonik slug (tek kaynak: model.mjs) ─────────────────────
const homeOf = new Map();
for (const [slug, wraps] of loadSessions()) for (const { rec } of wraps) homeOf.set(rec.sessionId, slug);
console.log(`nabız: ${homeOf.size} session, ${new Set(homeOf.values()).size} kanonik proje\n`);

// ── 2) tüm epic defterlerini oku, üyeleri yeni evlerine dağıt ───────────────
let files;
try { files = readdirSync(EPICS_DIR).filter((f) => f.endsWith(".json")); } catch { files = []; }
if (!files.length) { console.error("epics/ boş — yapacak iş yok"); process.exit(0); }

const byTarget = new Map();   // canonSlug → epic[]
const orphans = [];           // nabızda karşılığı olmayan sessionId'ler
const originals = new Map();  // dosya → içerik (yedek için)

for (const f of files) {
  const slug = f.replace(/\.json$/, "");
  const reg = readJSON(join(EPICS_DIR, f));
  if (!Array.isArray(reg?.epics)) continue;
  originals.set(f, reg);
  for (const e of reg.epics) {
    const groups = new Map(); // targetSlug → members
    for (const m of e.members || []) {
      const sid = m?.sessionId;
      if (!sid) continue;
      const t = homeOf.get(sid);
      if (!t) { orphans.push([slug, e.id, sid]); continue; }
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push({ sessionId: sid });
    }
    // üyesiz epic (ör. yalnız match kuralıyla çalışan) → kaynak slug kanonikse korunur
    if (!groups.size && homeOf.size) {
      const stillValid = [...new Set(homeOf.values())].includes(slug);
      if (stillValid) groups.set(slug, []);
      else { orphans.push([slug, e.id, "(üyesiz)"]); continue; }
    }
    for (const [t, members] of groups) {
      if (!byTarget.has(t)) byTarget.set(t, []);
      byTarget.get(t).push({ ...e, members, _from: slug, _native: t === slug });
    }
  }
}

// ── 3) aynı oturumu paylaşan epic'leri birleştir (union-find sessionId üzerinden) ──
function unify(epics) {
  const out = [];
  for (const e of epics) {
    const sids = new Set(e.members.map((m) => m.sessionId));
    const hit = out.find((o) => o.members.some((m) => sids.has(m.sessionId)));
    if (!hit) { out.push({ ...e, _merged: [] }); continue; }
    // birleştir: üyeler union; küratörlü alanlarda non-null kazanır (native öncelikli)
    const seen = new Set(hit.members.map((m) => m.sessionId));
    for (const m of e.members) if (!seen.has(m.sessionId)) { hit.members.push(m); seen.add(m.sessionId); }
    for (const k of CURATED) {
      if (hit[k] == null && e[k] != null) hit[k] = e[k];
      else if (hit[k] != null && e[k] != null && JSON.stringify(hit[k]) !== JSON.stringify(e[k])) {
        console.warn(`  ! çatışma "${k}": ${hit.id}=${JSON.stringify(hit[k])} vs ${e.id}=${JSON.stringify(e[k])} → ${hit._native ? "native" : "ilk"} kalır`);
      }
    }
    for (const k of ["kategori", "amac"]) if (hit[k] == null && e[k] != null) hit[k] = e[k];
    if (!hit._native && e._native) { hit.id = e.id; hit.title = e.title; hit._native = true; }
    else if (String(e.title || "").length > String(hit.title || "").length && !hit._native) hit.title = e.title;
    const tags = new Set([...(hit.tags || []), ...(e.tags || [])]);
    hit.tags = [...tags].slice(0, 3);
    hit._merged.push(e.id);
  }
  return out;
}

// ── 4) rapor + yazım ────────────────────────────────────────────────────────
const plan = new Map();
for (const [target, epics] of byTarget) plan.set(target, unify(epics));

console.log(`${dryRun ? "PLAN (dry-run)" : "UYGULANIYOR"}\n`);
for (const [target, epics] of [...plan].sort()) {
  const before = originals.get(`${target}.json`)?.epics?.length ?? 0;
  console.log(`▌ epics/${target}.json   ${before} → ${epics.length} epic`);
  for (const e of epics) {
    const moved = e._from !== target ? `  ← ${e._from}` : "";
    const merged = e._merged.length ? `  ⊕ ${e._merged.join(", ")}` : "";
    const cur = CURATED.filter((k) => e[k] != null).map((k) => `${k}=${JSON.stringify(e[k])}`).join(" ");
    console.log(`   ${String(e.members.length).padStart(2)} oturum  ${e.id.padEnd(32)} ${cur}${moved}${merged}`);
  }
  console.log("");
}

const gone = files.map((f) => f.replace(/\.json$/, "")).filter((s) => !plan.has(s));
if (gone.length) console.log(`Boşalan defterler (yedeklenip kaldırılacak): ${gone.join(", ")}\n`);
if (orphans.length) {
  console.log(`Nabızda karşılığı olmayan üyeler (düşürülür): ${orphans.length}`);
  for (const [s, e, sid] of orphans.slice(0, 6)) console.log(`   ${s}/${e} → ${String(sid).slice(0, 8)}`);
  console.log("");
}

// Değişmez SESSION düzeyindedir, epic düzeyinde değil: iki küratörlü epic aynı işi
// anlatıp birleşebilir (aide-pane-yonetimi ⊕ …-ybg, ikisi de status=done) — bu kayıp
// değil, tekleşmedir. Kayıp = bir oturumun taşıdığı küratörlü DEĞERİN yok olması.
const curatedOf = (epics) => {
  const m = new Map(); // sessionId → "status=done|match=..."
  for (const e of epics) {
    const v = CURATED.filter((k) => e[k] != null).map((k) => `${k}=${JSON.stringify(e[k])}`).sort().join(" ");
    if (!v) continue;
    for (const mem of e.members || []) if (mem?.sessionId) m.set(mem.sessionId, v);
  }
  return m;
};
const before = curatedOf([...originals.values()].flatMap((r) => r.epics));
const after = curatedOf([...plan.values()].flat());
const lost = [...before].filter(([sid, v]) => homeOf.has(sid) && after.get(sid) !== v);
const curatedEpics = [[...originals.values()].flatMap((r) => r.epics), [...plan.values()].flat()]
  .map((es) => es.filter((e) => CURATED.some((k) => e[k] != null)).length);
console.log(`Küratörlü epic: ${curatedEpics[0]} → ${curatedEpics[1]} (birleşme normaldir)`);
console.log(`Küratörlü değer taşıyan oturum: ${[...before].filter(([s]) => homeOf.has(s)).length} → ${after.size}  ${lost.length ? "✗ KAYIP" : "✓ korundu"}`);
for (const [sid, v] of lost.slice(0, 8)) console.log(`   ✗ ${sid.slice(0, 8)} kaybetti: ${v}  (şimdi: ${after.get(sid) || "yok"})`);

if (dryRun) { console.log("\n(kuru koşum — hiçbir dosya değişmedi. Uygulamak için: --apply)"); process.exit(lost.length ? 1 : 0); }
if (lost.length) { console.error("\nKüratörlük kaybı — YAZILMADI."); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
for (const f of originals.keys()) {
  if (!existsSync(join(BACKUP_DIR, f))) renameSync(join(EPICS_DIR, f), join(BACKUP_DIR, f));
}
for (const [target, epics] of plan) {
  const clean = epics.map(({ _from, _native, _merged, ...e }) => e);
  const t = join(EPICS_DIR, `${target}.json`);
  const tmp = `${t}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ epics: clean }, null, 2));
  renameSync(tmp, t);
  console.log(`yazıldı: ${t} (${clean.length} epic)`);
}
console.log(`\nözgün defterler: ${BACKUP_DIR}`);
