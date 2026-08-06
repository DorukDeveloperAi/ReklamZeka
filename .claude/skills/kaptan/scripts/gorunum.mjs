#!/usr/bin/env node
// kaptan CANLI GÖRÜNÜM — görev veri modelinin (model.mjs) TTY/MD projeksiyonu.
// Türetme mantığı ARTIK model.mjs'te tek kaynak (epic gruplama + resolution +
// staleness). Bu dosya yalnız sunum: renkli terminal, --md (GORUNUM.md), --json, --aktif.
//
// Kullanım:
//   node gorunum.mjs                 — renkli epic-gruplu görünüm (tüm projeler)
//   node gorunum.mjs --proje dorukcom06   — tek proje
//   node gorunum.mjs --aktif         — yalnız açık epic'ler (done/dropped gizle)
//   node gorunum.mjs --md            — ~/.claude/kaptan/GORUNUM.md yaz (model.mjs toMarkdown)
//   node gorunum.mjs --json          — türetilmiş model (JSON)

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildModel, toMarkdown, KATEGORI_META, KIND_META } from "./model.mjs";

const OUT_MD = join(homedir(), ".claude", "kaptan", "GORUNUM.md");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const val = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const wantMd = flag("--md");
const wantJson = flag("--json");
const onlyAktif = flag("--aktif");
const projeFilter = val("--proje");

const C = wantMd || wantJson ? null : {
  r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m",
  grn: "\x1b[32m", yel: "\x1b[33m", cyn: "\x1b[36m", mag: "\x1b[35m", red: "\x1b[31m", gry: "\x1b[90m",
  blu: "\x1b[34m",
};
const col = (s, k) => (C ? `${C[k]}${s}${C.r}` : s);

// tüm modeli üret, sonra proje/aktif filtrele (buildModel exact-slug ister; kullanıcı
// kısa ad geçebilsin diye burada esnek filtre)
let model = buildModel();
if (projeFilter) {
  model = { ...model, projects: model.projects.filter((p) => p.dirName.includes(projeFilter) || p.slug.includes(projeFilter)) };
}
if (onlyAktif) {
  model = {
    ...model,
    projects: model.projects
      .map((p) => ({ ...p, epics: p.epics.filter((e) => e.status !== "done" && e.status !== "dropped") }))
      .filter((p) => p.epics.length),
  };
}

const ICON = { active: "▶", planned: "◇", stale: "◑", paused: "⏸", done: "✓", dropped: "✗" };
const ICOL = { active: "cyn", planned: "blu", stale: "yel", paused: "mag", done: "grn", dropped: "gry" };
const LABEL = { active: "AKTİF", planned: "PLANLANDI (başlamadı)", stale: "BAYAT (>7g)", paused: "DURAKLADI", done: "TAMAMLANDI", dropped: "BIRAKILDI" };
const ORDER = ["active", "planned", "stale", "paused", "done", "dropped"];

function render(model) {
  const lines = [];
  const H = (s) => lines.push(s);
  const bar = "─".repeat(64);
  if (!model.projects.length) { H(col("(nabızda görünür görev yok)", "d")); return lines.join("\n"); }
  for (const p of model.projects) {
    const counts = {}; ORDER.forEach((s) => (counts[s] = p.epics.filter((e) => e.status === s).length));
    H("");
    H(col(bar, "gry"));
    H(`${col(p.dirName, "b")}  ${col(ORDER.map((s) => `${ICON[s]}${counts[s]}`).join(" "), "d")}`);
    // PM proje hedefleri — epic'ler bunlara hizmet eder, önce onlar
    if (p.hedefler?.length) {
      H("");
      H("  " + col(`◎ PROJE HEDEFLERİ (${p.hedefler.length})`, "b"));
      for (const h of p.hedefler) {
        const tot = h.progress.doneEver + h.progress.openActive;
        const prog = tot > 0 ? col(` (${h.progress.doneEver}/${tot} · %${h.progress.pct})`, "d") : "";
        const onc = h.oncelik ? col(` ${h.oncelik}`, "yel") : "";
        const oneri = h.origin === "damitma" && !h.onaylandi ? col(" ⟨öneri⟩", "gry") : "";
        H(`    ${col(ICON[h.durum] || "·", ICOL[h.durum] || "gry")}${onc} ${col(h.text, "b")}${prog}${oneri}`);
        if (h.blokaj.length) H(`      ${col(`⛔ blokaj: ${h.blokaj.join(", ")}`, "red")}`);
      }
    }
    for (const st of ORDER) {
      const grp = p.epics.filter((e) => e.status === st);
      if (!grp.length) continue;
      H("");
      H("  " + col(`${ICON[st]} ${LABEL[st]}`, ICOL[st]));
      for (const e of grp) {
        const tot = e.progress.doneEver + e.progress.openActive;
        const prog = tot > 0 ? col(` (${e.progress.doneEver}/${tot} · %${e.progress.pct})`, "d") : "";
        const drop = e.progress.dropped ? col(` ✗${e.progress.dropped}`, "gry") : "";
        const age = e.staleDays != null ? col(` · ${e.staleDays}g önce`, "gry") : "";
        const sess = e.sessions.length > 1 ? col(` · ${e.sessions.length} oturum`, "gry") : "";
        // ⟨künye⟩ = damıtıcı etiketledi. Üyesiz PM hedefinin künyesi olmaz.
        const kunye = e.kunyeli ? col(" ⟨künye⟩", "mag") : "";
        const pm = e.origin === "pm" ? col(" ⟨PM⟩", "blu") : "";
        const onc = e.oncelik ? col(` ${e.oncelik}`, "yel") : "";
        const kat = e.kategori ? `${KATEGORI_META[e.kategori].icon} ` : "";
        H(`    ${kat}${onc ? onc + " " : ""}${col(e.title, "b")}${prog}${drop}${age}${sess}${kunye}${pm}`);
        if (e.amac) H(`      ${col(e.amac, "gry")}`);
        if (st !== "done" && st !== "dropped") {
          for (const t of e.tasks.filter((x) => x.resolution === null)) {
            const mk = t.status === "in_progress" ? col("◐", "yel") : col("○", "gry");
            const ki = col(KIND_META[t.kind]?.icon || "·", "gry");
            H(`        ${mk} ${ki} ${col(t.short, "d")}`);
          }
        }
      }
    }
    const openBL = p.backlog.filter((b) => b.status === "open");
    if (openBL.length) {
      H("");
      H("  " + col(`⚙ BACKLOG (açık · ${openBL.length})`, "d"));
      for (const b of openBL.slice(0, 12)) {
        const sev = b.severity === "yuksek" ? "🔴" : b.severity === "orta" ? "🟡" : "⚪";
        H(`        ${sev} ${col(b.id, "b")} ${col(b.desc.slice(0, 76), "d")}`);
      }
      if (openBL.length > 12) H(col(`        … +${openBL.length - 12}`, "d"));
    }
  }
  return lines.join("\n");
}

if (wantJson) process.stdout.write(JSON.stringify(model, null, 2));
else if (wantMd) { writeFileSync(OUT_MD, toMarkdown(model)); console.log(`yazıldı: ${OUT_MD} (${model.projects.reduce((n, p) => n + p.epics.length, 0)} epic)`); }
else console.log(render(model));
