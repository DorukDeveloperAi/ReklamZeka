#!/usr/bin/env node
// wf-artefakt.mjs — Dynamic Workflow koşumunun KANIT ARTEFAKTINI üreten MOTOR (deterministik, 0 token).
//
// SINIF: motor. Aynı girdi (aynı runId'nin session-run kaydı) → aynı çıktı. LLM DOĞURMAZ.
// NEDEN VAR (04/R5): Rotacı evreninde "bitti" demenin tek yolu kanıt artefaktı + `aide rota kanit`
// exit 0 + STATE satırıdır. Workflow koşumu bu zincirin DIŞINDA kalırsa Maestro "done" der ama
// aşama açık kalır (a03 dersi). Bu motor workflow run kaydını okuyup:
//   1. plans/<slug>/v<N>/kanit/asama-<NN>-workflow-<runId>.json  (+ insan-okur .txt özeti)
//   2. `aide usage wf-yaz --dosya <o json>` çağrısı  (R7: usage.jsonl'a TEK YAZAR = usage-log.ts;
//      bu motor deftere DOKUNMAZ, yalnız chokepoint CLI'ı çağırır)
// üretir. İDEMPOTENT: aynı runId için artefakt byte-aynı yeniden yazılır; usage tarafı runId
// dedupe'ına takılır (ikinci koşum satır EKLEMEZ).
//
// KAYNAK: <depot>/projects/<enc>/<sessionId>/workflows/<runId>.json — Workflow tool'un yazdığı
// otoriter run kaydı (workflowProgress[] adım tablosu: label·model·state·cached). Yoksa aynı
// dizindeki subagents/workflows/<runId>/journal.jsonl'a düşülür (model/cached bilinmez → İLAN).
//
// Girdi:  --run <runId> --proje <kök> --slug <s> --v <N> --asama <no> [--ad <ad>]
//         [--kaynak sablon|elle] [--no-usage] [--usage-file <path>] [--json]
// Çıktı:  artefakt json+txt yolu; --json ile {runId, json, txt, usage:{cagrildi,...}}.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// ── argv (basit; execFile ile çağrılır, kabuk yok) ────────────────────────────────────────────
const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : undefined; };
const has = (f) => process.argv.includes(f);
const runId = arg('--run');
const proje = arg('--proje') || process.cwd();
const slug = arg('--slug');
const v = arg('--v');
const asamaNo = arg('--asama');
const adArg = arg('--ad');
const kaynak = arg('--kaynak') === 'elle' ? 'elle' : 'sablon';
const noUsage = has('--no-usage');
const usageFile = arg('--usage-file');
const json = has('--json');

function oldur(msg) { console.error(`wf-artefakt: ${msg}`); process.exit(1); }
if (!runId || !/^[A-Za-z0-9_-]{8,64}$/.test(runId)) oldur(`--run <runId> zorunlu ve biçimli olmalı (verilen: ${runId ?? '—'})`);
if (!slug || v == null || asamaNo == null) oldur('--slug --v --asama zorunlu');

// ── Claude depoları (subagents.ts listClaudeDepots ikizi) ─────────────────────────────────────
function depolar() {
  const found = new Set();
  const home = os.homedir();
  found.add(path.join(home, '.claude'));
  try {
    for (const d of fs.readdirSync(home)) if (d.startsWith('.claude-')) found.add(path.join(home, d));
  } catch { /* home okunamadı */ }
  if (process.env.CLAUDE_CONFIG_DIR) found.add(process.env.CLAUDE_CONFIG_DIR);
  if (process.env.WF_ARTEFAKT_DEPOT) found.add(process.env.WF_ARTEFAKT_DEPOT); // test dikişi
  return [...found].filter((d) => { try { return fs.existsSync(path.join(d, 'projects')); } catch { return false; } });
}

// <depot>/projects/*/*/workflows/<runId>.json — ilk (en yeni mtime) eşleşme.
function runKaydiBul() {
  const adaylar = [];
  for (const depot of depolar()) {
    const projRoot = path.join(depot, 'projects');
    let encs; try { encs = fs.readdirSync(projRoot); } catch { continue; }
    for (const enc of encs) {
      let sids; try { sids = fs.readdirSync(path.join(projRoot, enc)); } catch { continue; }
      for (const sid of sids) {
        const f = path.join(projRoot, enc, sid, 'workflows', `${runId}.json`);
        const jf = path.join(projRoot, enc, sid, 'subagents', 'workflows', runId, 'journal.jsonl');
        try { const st = fs.statSync(f); adaylar.push({ tur: 'run', yol: f, mtime: st.mtimeMs }); } catch { /* yok */ }
        try { const st = fs.statSync(jf); adaylar.push({ tur: 'journal', yol: jf, mtime: st.mtimeMs }); } catch { /* yok */ }
      }
    }
  }
  // run.json journal'a tercih edilir (zengin); eşit türde en yeni mtime.
  adaylar.sort((a, b) => (a.tur === b.tur ? b.mtime - a.mtime : a.tur === 'run' ? -1 : 1));
  return adaylar[0] ?? null;
}

// ── Adım tablosunu KAYITTAN türet (deterministik) ─────────────────────────────────────────────
function adimlariCoz(kayit) {
  if (kayit.tur === 'run') {
    let o; try { o = JSON.parse(fs.readFileSync(kayit.yol, 'utf8')); } catch { oldur(`run kaydı okunamadı: ${kayit.yol}`); }
    const prog = Array.isArray(o.workflowProgress) ? o.workflowProgress.filter((p) => p?.type === 'workflow_agent') : [];
    const adimlar = prog.map((p) => ({
      ad: String(p.label ?? p.phaseTitle ?? `adim-${p.index ?? '?'}`),
      model: String(p.model ?? o.defaultModel ?? 'bilinmiyor'),
      turSayisi: 1,                       // her workflow_agent girdisi = 1 ajan çağrısı (tur)
      durum: String(p.state ?? 'bilinmiyor'),
      cacheHit: p.cached === true,
    }));
    const baslangic = Number.isFinite(o.startTime) ? o.startTime : Date.parse(o.timestamp || '') || 0;
    const bitis = baslangic + (Number.isFinite(o.durationMs) ? o.durationMs : 0);
    return { adimlar, baslangic, bitis, kaynakTur: 'run', not: null };
  }
  // journal.jsonl düşüşü: result satırları = tamamlanmış adım; model/cached BİLİNMEZ (İLAN).
  let satirlar = [];
  try { satirlar = fs.readFileSync(kayit.yol, 'utf8').split('\n').filter((l) => l.trim()); } catch { oldur(`journal okunamadı: ${kayit.yol}`); }
  const results = satirlar.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.type === 'result');
  const adimlar = results.map((e, i) => ({
    ad: `adim-${i + 1}`, model: 'bilinmiyor', turSayisi: 1, durum: 'done', cacheHit: false,
  }));
  return { adimlar, baslangic: 0, bitis: 0, kaynakTur: 'journal',
           not: 'journal.jsonl düşüşü: model/cacheHit ölçülemedi (run kaydı yok) — resume=false varsayıldı' };
}

const kayit = runKaydiBul();
if (!kayit) oldur(`runId ${runId} için ne workflows/${runId}.json ne journal.jsonl bulundu (depolar: ${depolar().join(', ') || 'yok'})`);
const { adimlar, baslangic, bitis, kaynakTur, not } = adimlariCoz(kayit);

const adimCacheHit = adimlar.filter((a) => a.cacheHit).length;
const adimKosulan = adimlar.filter((a) => !a.cacheHit).length;
const modelKirilimi = {};
for (const a of adimlar) modelKirilimi[a.model] = (modelKirilimi[a.model] ?? 0) + a.turSayisi;

const artefakt = {
  runId,
  proje,
  asama: { slug, v: Number(v), no: Number(asamaNo), ad: adArg ?? null },
  baslangic, bitis,
  resume: adimCacheHit > 0,   // cache-hit varsa bu koşum bir resume'dur (04 R6)
  kaynak,                     // sablon | elle (koşum-muhasebesi kaynağı)
  kaynakTur,                  // run | journal (kanıt zenginliği)
  adimlar,
  toplam: { adimToplam: adimlar.length, adimKosulan, adimCacheHit },
  modelKirilimi,
  ...(not ? { not } : {}),
};

// ── Yaz: kanit/asama-<NN>-workflow-<runId>.{json,txt} (idempotent, deterministik) ──────────────
const NN = String(Number(asamaNo)).padStart(2, '0');
const kanitDir = path.join(proje, 'plans', slug, `v${v}`, 'kanit');
fs.mkdirSync(kanitDir, { recursive: true });
const jsonYol = path.join(kanitDir, `asama-${NN}-workflow-${runId}.json`);
const txtYol = path.join(kanitDir, `asama-${NN}-workflow-${runId}.txt`);

const jsonMetin = JSON.stringify(artefakt, null, 2) + '\n';
fs.writeFileSync(jsonYol, jsonMetin);

const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '—');
const txt = [
  `WORKFLOW KOŞUM ARTEFAKTI — ${runId}`,
  `aşama: ${slug} v${v} #${Number(asamaNo)}${adArg ? ` (${adArg})` : ''}`,
  `kaynak: ${kaynak} · kayıt: ${kaynakTur} · resume: ${artefakt.resume ? 'EVET' : 'hayır'}`,
  `başlangıç: ${iso(baslangic)} · bitiş: ${iso(bitis)} · süre: ${Math.max(0, bitis - baslangic)}ms`,
  `toplam adım: ${artefakt.toplam.adimToplam} · koşulan: ${adimKosulan} · cache-hit: ${adimCacheHit}`,
  `model kırılımı: ${Object.entries(modelKirilimi).map(([m, n]) => `${m}×${n}`).join(', ') || '—'}`,
  '',
  'ADIMLAR:',
  ...adimlar.map((a, i) => `  ${i + 1}. ${a.ad} [${a.model}] ${a.durum}${a.cacheHit ? ' (cache)' : ''}`),
  ...(not ? ['', `NOT: ${not}`] : []),
  '',
].join('\n');
fs.writeFileSync(txtYol, txt);

// ── usage.jsonl'a düş (R7 chokepoint: aide usage wf-yaz; bu motor deftere DOKUNMAZ) ────────────
let usage = { cagrildi: false, atlandi: noUsage ? 'no-usage' : null };
if (!noUsage) {
  const wfYazArgs = ['usage', 'wf-yaz', '--dosya', jsonYol, '--json'];
  if (usageFile) wfYazArgs.push('--usage-file', usageFile);
  // Öncelik: WF_ARTEFAKT_AIDE (test/override) → `aide` (PATH, kurulum katmanı) → bun cli fallback.
  const override = process.env.WF_ARTEFAKT_AIDE;
  let r;
  if (override) r = spawnSync(override, wfYazArgs, { encoding: 'utf8', timeout: 30_000, shell: false });
  else {
    r = spawnSync('aide', wfYazArgs, { encoding: 'utf8', timeout: 30_000 });
    if (r.error && r.error.code === 'ENOENT') {
      const cli = '/Users/ybg/dev/agent-ide/packages/tui-v3/src/cli.ts';
      r = spawnSync('bun', [cli, ...wfYazArgs], { encoding: 'utf8', timeout: 30_000 });
    }
  }
  if (r.error) usage = { cagrildi: false, hata: String(r.error.message || r.error) };
  else {
    let parsed = null; try { parsed = JSON.parse((r.stdout || '').trim()); } catch { /* düz metin */ }
    usage = { cagrildi: true, exit: r.status ?? null, yazildi: parsed?.yazildi ?? null, cikti: (r.stdout || '').trim() };
  }
}

if (json) {
  console.log(JSON.stringify({ runId, json: jsonYol, txt: txtYol, usage }, null, 2));
} else {
  console.log(`artefakt: ${jsonYol}`);
  console.log(`özet:     ${txtYol}`);
  console.log(usage.cagrildi
    ? `usage:    aide usage wf-yaz → ${usage.yazildi === false ? 'yazildi:false (dedupe)' : usage.yazildi === true ? 'yazildi:true' : `exit ${usage.exit}`}`
    : `usage:    ATLANDI (${usage.atlandi || usage.hata || '—'})`);
}
