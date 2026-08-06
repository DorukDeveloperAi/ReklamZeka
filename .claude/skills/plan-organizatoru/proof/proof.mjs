#!/usr/bin/env node
// proof.mjs — plan-organizatoru kanıt harness'ı.
// Yıkıcı senaryolar GEÇİCİ fikstürde koşar; gerçek projeler SALT-OKUNUR ölçülür
// (dorukcom06 için tek yazım: INDEX'in kendisi — zaten agac.mjs'in çıktısı, idempotent).
// Kural (Ders 17/18): yeşil yanan kapı değil, KIRMIZI YANABİLEN kapı kanıttır —
// her denetimin bilerek bozulup FAIL ürettiği en az bir senaryosu var.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const AGAC = path.join(os.homedir(), '.claude/skills/plan-organizatoru/scripts/agac.mjs');
// Devir şeması ÜRÜNÜN tek parse yerinden okunur (`oturum-lib.mjs`); harness şemayı KOPYALAMAZ —
// kopyalarsa üründen bağımsız yalanlaşır (Ders 4 / `ledgerDirIn` emsali).
const lib = await import(pathToFileURL(path.join(os.homedir(), '.claude/skills/plan-organizatoru/scripts/oturum-lib.mjs')).href);
const results = [];
const T = (ad, fn) => { try { fn(); results.push(['PASS', ad]); } catch (e) { results.push(['FAIL', `${ad} — ${e.message}`]); } };
const run = (args, opts = {}) => {
  try { return { out: execFileSync('node', [AGAC, ...args], { encoding: 'utf8', ...opts }), code: 0 }; }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 }; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

// ── fikstür ──────────────────────────────────────────────────────────────────
const FX = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-org-proof-'));
const P = (...s) => path.join(FX, 'plans', ...s);
function plan(slug, v, { kategori = 'özellik', ust = 'proje', durumlar = ['AÇIK'], acikCl = 1, kunye = null } = {}) {
  fs.mkdirSync(P(slug, `v${v}`), { recursive: true });
  // kunye: {kritiklik, aciliyet, hacim, hedef} → MASTER üst bloğuna künye satırları. null → künyesiz
  // (legacy plan) — künye YOKKEN üretilen MASTER metni eski fikstürle BAYT-AYNIdır.
  const kn = kunye
    ? `> Kritiklik: ${kunye.kritiklik} · Aciliyet: ${kunye.aciliyet} · Hacim: ${kunye.hacim}\n` +
      (kunye.hedef ? `> Hedef: ${kunye.hedef}\n` : '')
    : '';
  fs.writeFileSync(P(slug, `v${v}`, 'MASTER.md'), `# ${slug} — MASTER (v${v})\n\n> Kategori: ${kategori} · Üst: ${ust}\n${kn}`);
  const rows = durumlar.map((d, i) => `| 0${i + 1} | asama${i + 1} | ${d} | — | — |`).join('\n');
  fs.writeFileSync(P(slug, `v${v}`, 'STATE.md'), `## Aşama durumları\n\n| # | aşama | durum | son dokunuş | kanıt |\n|---|---|---|---|---|\n${rows}\n\n## Tur günlüğü (en yeni üstte)\n\n### 2026-07-16 — tur\n- Yapılan: iş\n`);
  fs.writeFileSync(P(slug, `v${v}`, 'CHECKLIST.md'), Array.from({ length: acikCl }, (_, i) => `- [ ] T${i}`).join('\n') + '\n- [x] T-done\n');
  durumlar.forEach((_, i) => fs.writeFileSync(P(slug, `v${v}`, `asama-0${i + 1}-asama${i + 1}.md`), '# aşama\n'));
}
plan('proje', 1, { kategori: 'proje', ust: '—', durumlar: ['KAPALI'], acikCl: 0 });
plan('ozellik-a', 1, { durumlar: ['KAPALI', 'SÜRÜYOR', 'AÇIK'] });
fs.writeFileSync(P('legacy.json'), JSON.stringify({ entries: [{ ad: 'eski', path: 'eski/PLAN.md', tur: 'plan', not: '' }] }));
fs.mkdirSync(path.join(FX, 'eski'), { recursive: true }); fs.writeFileSync(path.join(FX, 'eski/PLAN.md'), 'x');

// 1) türet + idempotens
T('türet → INDEX.md + INDEX.json doğar', () => {
  const r = run(['--proje', FX]); assert(r.code === 0, r.out);
  assert(fs.existsSync(P('INDEX.md')) && fs.existsSync(P('INDEX.json')), 'INDEX yok');
});
T('idempotens: ikinci koşu bayt-aynı', () => {
  const h1 = fs.readFileSync(P('INDEX.md'), 'utf8'); run(['--proje', FX]);
  assert(h1 === fs.readFileSync(P('INDEX.md'), 'utf8'), 'INDEX değişti');
});
T('gate taze INDEXte PASS', () => { const r = run(['--proje', FX, '--gate']); assert(r.code === 0, r.out); });

// 2) tazelik damgası — KIRMIZI yanabilme
T('STATE değişince gate FAIL (bayat INDEX), yeniden türet → PASS', () => {
  const st = P('ozellik-a', 'v1', 'STATE.md');
  fs.writeFileSync(st, fs.readFileSync(st, 'utf8').replace('SÜRÜYOR', 'KAPALI'));
  const r1 = run(['--proje', FX, '--gate']); assert(r1.code === 1 && /BAYAT/.test(r1.out), 'FAIL etmedi: ' + r1.out);
  run(['--proje', FX]);
  const r2 = run(['--proje', FX, '--gate']); assert(r2.code === 0, r2.out);
});

// 3) governance — her kural kırmızı yanabilir
T('ikinci proje-genel plan → PROJE PLANI TEK OLMALI', () => {
  plan('sahte-proje', 1, { kategori: 'proje', ust: '—' });
  const r = run(['--proje', FX, '--denetle']); assert(/PROJE PLANI TEK OLMALI/.test(r.out), r.out);
  fs.rmSync(P('sahte-proje'), { recursive: true });
});
T('ilansız yetim dizin → YETİM; legacy.json ilanı bulguyu düşürür', () => {
  fs.mkdirSync(P('dagilmis-notlar')); fs.writeFileSync(P('dagilmis-notlar', 'x.md'), 'x');
  let r = run(['--proje', FX, '--denetle']); assert(/YETİM: plans\/dagilmis-notlar/.test(r.out), r.out);
  const lj = JSON.parse(fs.readFileSync(P('legacy.json'), 'utf8'));
  lj.entries.push({ ad: 'notlar', path: 'plans/dagilmis-notlar', tur: 'not', not: 'ilanlı' });
  fs.writeFileSync(P('legacy.json'), JSON.stringify(lj));
  r = run(['--proje', FX, '--denetle']); assert(!/YETİM: plans\/dagilmis-notlar/.test(r.out), 'ilan düşürmedi');
  fs.rmSync(P('dagilmis-notlar'), { recursive: true });
  lj.entries.pop(); fs.writeFileSync(P('legacy.json'), JSON.stringify(lj));
});
T('kırık dal (Üst → olmayan slug) yakalanır', () => {
  plan('kirik', 1, { ust: 'olmayan-slug' });
  const r = run(['--proje', FX, '--denetle']); assert(/KIRIK DAL/.test(r.out), r.out);
  fs.rmSync(P('kirik'), { recursive: true });
});
T('KAPALI plan + açık checklist → TUTARSIZ', () => {
  plan('tutarsiz', 1, { durumlar: ['KAPALI'], acikCl: 3 });
  const r = run(['--proje', FX, '--denetle']); assert(/TUTARSIZ/.test(r.out), r.out);
  fs.rmSync(P('tutarsiz'), { recursive: true });
});
T('kategorisiz plan yakalanır', () => {
  fs.mkdirSync(P('kategorisiz', 'v1'), { recursive: true });
  fs.writeFileSync(P('kategorisiz', 'v1', 'MASTER.md'), '# k — MASTER (v1)\n');
  fs.writeFileSync(P('kategorisiz', 'v1', 'STATE.md'), '## Aşama durumları\n\n| # | aşama | durum | s | k |\n|---|---|---|---|---|\n| 01 | a | AÇIK | — | — |\n');
  fs.writeFileSync(P('kategorisiz', 'v1', 'CHECKLIST.md'), '- [ ] x\n');
  const r = run(['--proje', FX, '--denetle']); assert(/KATEGORISIZ/.test(r.out), r.out);
  fs.rmSync(P('kategorisiz'), { recursive: true });
});
T('legacy kırık yol yakalanır', () => {
  const lj = JSON.parse(fs.readFileSync(P('legacy.json'), 'utf8'));
  lj.entries.push({ ad: 'hayalet', path: 'yok/boyle-dosya.md', tur: 'plan', not: '' });
  fs.writeFileSync(P('legacy.json'), JSON.stringify(lj));
  const r = run(['--proje', FX, '--denetle']); assert(/LEGACY KIRIK/.test(r.out), r.out);
  lj.entries.pop(); fs.writeFileSync(P('legacy.json'), JSON.stringify(lj));
});

// 4) versiyonlama: v2 → INDEX en yükseği gösterir, v1 dokunulmaz
T('v2 eklenince INDEX v2 gösterir, v1 bayt-aynı kalır', () => {
  const v1Hash = fs.readFileSync(P('ozellik-a', 'v1', 'MASTER.md'), 'utf8');
  plan('ozellik-a', 2, { durumlar: ['AÇIK'] });
  run(['--proje', FX]);
  const idx = fs.readFileSync(P('INDEX.md'), 'utf8');
  assert(/ozellik-a\/v2\/MASTER\.md/.test(idx) && /\| v2 \|/.test(idx), 'INDEX v2 göstermiyor');
  assert(fs.readFileSync(P('ozellik-a', 'v1', 'MASTER.md'), 'utf8') === v1Hash, 'v1 değişti');
});

// 4.5) kosum: alanı (workflow katmanı) — şema · hazir[] taşıma · koşullu damga · KIRMIZI yanabilme
const fm = (slug, v, i, val) => {   // aşama-0i dosyasına frontmatter yaz (val=null → frontmatter'sız)
  const f = P(slug, `v${v}`, `asama-0${i}-asama${i}.md`);
  fs.writeFileSync(f, val == null ? '# aşama\n' : `---\nkosum: ${val}\n---\n# aşama\n`);
};
const durumJson = (proje = FX) => JSON.parse(run(['--proje', proje, '--durum', '--json']).out);
const planOf = (j, slug) => j.plans.find((p) => p.slug === slug);
const hazir01 = (slug) => (planOf(durumJson(), slug).hazir || []).find((x) => x.no === '01');

T('kosum beyansızken hazir[]de anahtar YOK (yokluk = tek-ajan)', () => {
  plan('kosum-demo', 1, { durumlar: ['AÇIK', 'AÇIK'] });
  const h = planOf(durumJson(), 'kosum-demo').hazir;
  assert(h.length && h.every((x) => !('kosum' in x)), 'beyansız hazir kosum taşıyor: ' + JSON.stringify(h));
});
T('workflow beyanı hazir[]e {tur,sablon} olarak taşınır', () => {
  fm('kosum-demo', 1, 1, 'workflow:dogrulama-zinciri');
  const h = hazir01('kosum-demo');
  assert(h && h.kosum && h.kosum.tur === 'workflow' && h.kosum.sablon === 'dogrulama-zinciri', JSON.stringify(h));
});
T('tek-ajan beyanı da taşınır (beyan ≠ yokluk; sablon yok)', () => {
  fm('kosum-demo', 1, 1, 'tek-ajan');
  const h = hazir01('kosum-demo');
  assert(h && h.kosum && h.kosum.tur === 'tek-ajan' && !('sablon' in h.kosum), JSON.stringify(h));
});
T('geçersiz kosum → GEÇERSİZ KOŞUM bulgusu + gate FAIL; düzelt → PASS (kırmızı→yeşil)', () => {
  fm('kosum-demo', 1, 1, 'paralel-cok');
  run(['--proje', FX]);                       // türet
  const d = run(['--proje', FX, '--denetle']); assert(/GEÇERSİZ KOŞUM: kosum-demo 01/.test(d.out), d.out);
  const g1 = run(['--proje', FX, '--gate']); assert(g1.code === 1 && /GEÇERSİZ KOŞUM/.test(g1.out), 'gate FAIL etmedi: ' + g1.out);
  // gecersiz beyan hazir[]e SIZMAZ (sözleşme temiz: yalnız {tur,sablon?})
  assert(!('kosum' in (hazir01('kosum-demo') || {})), 'gecersiz kosum hazir[]e sızdı');
  fm('kosum-demo', 1, 1, 'tek-ajan'); run(['--proje', FX]);
  const g2 = run(['--proje', FX, '--gate']); assert(g2.code === 0, 'düzeltince PASS değil: ' + g2.out);
});
T('kosum değişimi damgayı değiştirir → gate BAYAT FAIL → türet → PASS', () => {
  run(['--proje', FX]);                        // taze türet (01=tek-ajan)
  fm('kosum-demo', 1, 1, 'workflow:baska-sablon');  // beyan değişti → INDEX bayat
  const g1 = run(['--proje', FX, '--gate']); assert(g1.code === 1 && /BAYAT/.test(g1.out), 'damga değişimi yakalanmadı: ' + g1.out);
  run(['--proje', FX]);
  const g2 = run(['--proje', FX, '--gate']); assert(g2.code === 0, g2.out);
});
T('beyansız fikstürde kosum damgaya girmez (INDEX bayt-aynı, idempotent)', () => {
  fm('kosum-demo', 1, 1, null); fm('kosum-demo', 1, 2, null);   // frontmatter'ları kaldır
  run(['--proje', FX]); const a = fs.readFileSync(P('INDEX.md'), 'utf8');
  run(['--proje', FX]); const b = fs.readFileSync(P('INDEX.md'), 'utf8');
  assert(a === b, 'beyansız INDEX idempotent değil');
  assert(!('kosum' in (hazir01('kosum-demo') || {})), 'beyansız hazir kosum taşıyor');
  fs.rmSync(P('kosum-demo'), { recursive: true }); run(['--proje', FX]);   // temizle + FX tutarlı bırak
});

// 4.5b) getirir: alanı (aşama 31) — kapalı şema · additive projeksiyon · koşullu damga · KIRMIZI yanabilme
// `fmG` frontmatter'ı SERBEST yazar (kosum satırı opsiyonel) — geçersiz blokları da kurabilmek şart.
const fmG = (slug, v, i, blok) => {
  const f = P(slug, `v${v}`, `asama-0${i}-asama${i}.md`);
  fs.writeFileSync(f, blok == null ? '# aşama\n' : `---\n${blok}\n---\n# aşama\n`);
};
const grafJson = (proje = FX) => JSON.parse(run(['--proje', proje, '--graf', '--json']).out);
// NOT: `kunyeJson` bu noktadan SONRA (4.6'da) tanımlanır — const TDZ'si yüzünden buradan
// çağrılamaz. Bölüm kendi erişimcisini taşır (bölümler bağımsız kalsın diye de doğru).
const kunyeJsonG = (proje = FX) => JSON.parse(run(['--proje', proje, '--kunye', '--json']).out);
const getirirOf = (slug, no) => (planOf(durumJson(), slug).getirir || []).find((x) => x.no === no);

// (a) BEYANSIZ FİKSTÜR — additive sözleşmenin taban ayağı: anahtar HİÇ doğmaz, çıktı bayt-aynı.
T('(a) beyansız fikstürde hiçbir plan getirir taşımaz + idempotens bayt-aynı', () => {
  plan('getirir-demo', 1, { durumlar: ['AÇIK', 'AÇIK'] });
  run(['--proje', FX]);
  const j = durumJson();
  assert(!j.plans.some((p) => 'getirir' in p), 'beyansız fikstürde getirir anahtarı doğdu');
  assert(!grafJson().nodes.some((n) => 'getirir' in n), 'beyansız --graf düğümünde getirir doğdu');
  const a = fs.readFileSync(P('INDEX.json'), 'utf8'); run(['--proje', FX]);
  assert(a === fs.readFileSync(P('INDEX.json'), 'utf8'), 'beyansız INDEX.json idempotent değil');
});

// (b) GEÇERLİ BLOK — normalize özet + gate PASS
T('(b) geçerli blok normalize edilir (katman/dugum/kenar/kaldir/dokunur) + gate PASS', () => {
  fmG('getirir-demo', 1, 1, [
    'kosum: tek-ajan',
    'getirir:',
    '  - katman: plan-graf',
    '  - dugum: daemon:metronom',
    '  - kenar: dogurur oturum:* -> alt-ajan:*',
    '  - kaldir: dugum daemon:telegram',
    '  - dokunur: modul:core/src/sistem-graf.ts',
  ].join('\n'));
  run(['--proje', FX]);
  const g = getirirOf('getirir-demo', '01');
  assert(g && g.durum === 'AÇIK' && g.ad === 'asama1', 'no/ad/durum taşınmadı: ' + JSON.stringify(g));
  assert(JSON.stringify(g.katman) === '["plan-graf"]', 'katman: ' + JSON.stringify(g.katman));
  assert(JSON.stringify(g.dugum) === '["daemon:metronom"]', 'dugum: ' + JSON.stringify(g.dugum));
  assert(g.kenar.length === 1 && g.kenar[0].tip === 'dogurur' && g.kenar[0].from === 'oturum:*'
    && g.kenar[0].to === 'alt-ajan:*', 'kenar: ' + JSON.stringify(g.kenar));
  assert(g.kaldir.length === 1 && g.kaldir[0].tur === 'dugum' && g.kaldir[0].id === 'daemon:telegram', JSON.stringify(g.kaldir));
  assert(JSON.stringify(g.dokunur) === '["modul:core/src/sistem-graf.ts"]', JSON.stringify(g.dokunur));
  // --graf düğümü aynı özeti no/ad/durum'suz taşır (düğüm zaten taşıyor)
  const n = grafJson().nodes.find((x) => x.id === 'getirir-demo:01');
  assert(n.getirir && !('durum' in n.getirir) && !('no' in n.getirir), 'graf özeti no/durum taşıyor: ' + JSON.stringify(n.getirir));
  assert(run(['--proje', FX, '--gate']).code === 0, 'geçerli beyanda gate FAIL');
});

// (c) AÇIK BOŞ BEYAN — beyansızlıktan FARKLI
T('(c) "getirir: yok" → {yok:true} (beyansızlıktan ayrı)', () => {
  fmG('getirir-demo', 1, 2, 'getirir: yok');
  run(['--proje', FX]);
  const g = getirirOf('getirir-demo', '02');
  assert(g && g.yok === true, 'yok beyanı taşınmadı: ' + JSON.stringify(g));
  assert(run(['--proje', FX, '--gate']).code === 0, '"yok" beyanında gate FAIL');
});

// (d)-(h) GEÇERSİZ BLOKLAR — hepsi gate FAIL + `onar:` taşır. KIRMIZI YANABİLİRLİK.
const gecersizSenaryolar = [
  ['(d) bilinmeyen anahtar', 'getirir:\n  - ekle: x', /bilinmeyen anahtar "ekle"/],
  ['(e) union dışı kenar tipi', 'getirir:\n  - kenar: hayalet a:b -> c:d', /geçersiz kenar tipi "hayalet"/],
  ['(f) girintili ama madde değil', 'getirir:\n  - dugum: a:b\n  dugm: x', /madde olmayan girintili satır/],
  ['(g) "yok" altına madde', 'getirir: yok\n  - dugum: a:b', /altına madde yazılamaz/],
  ['(h) birebir tekrar madde', 'getirir:\n  - dugum: a:b\n  - dugum: a:b', /tekrarlanan madde/],
  ['(h2) dugum joker kabul etmez', 'getirir:\n  - dugum: a:*', /joker yalnız kenar ucunda/],
];
for (const [ad, blok, desen] of gecersizSenaryolar) {
  T(`${ad} → GEÇERSİZ GETİRİR + gate FAIL + onar:`, () => {
    fmG('getirir-demo', 1, 1, blok);
    run(['--proje', FX]);
    const d = run(['--proje', FX, '--denetle']);
    assert(/GEÇERSİZ GETİRİR: getirir-demo 01/.test(d.out), 'bulgu yok: ' + d.out);
    assert(desen.test(d.out), `sebep eşleşmedi (${desen}): ` + d.out);
    assert(/onar:/.test(d.out), 'onar: satırı yok: ' + d.out);
    const g1 = run(['--proje', FX, '--gate']);
    assert(g1.code === 1 && /GEÇERSİZ GETİRİR/.test(g1.out), 'gate FAIL etmedi: ' + g1.out);
    // geçersiz beyan PROJEKSİYONA SIZMAZ (gecersiz kosum'un hazir[]e sızmamasının aynısı)
    assert(!getirirOf('getirir-demo', '01'), 'geçersiz beyan INDEX projeksiyonuna sızdı');
    // kırmızı→yeşil: düzelt → PASS
    fmG('getirir-demo', 1, 1, 'getirir: yok'); run(['--proje', FX]);
    assert(run(['--proje', FX, '--gate']).code === 0, 'düzeltince PASS değil');
  });
}

// (i) DAMGA — beyan değişimi BAYAT üretir
T('(i) beyan değişimi damgayı değiştirir → gate BAYAT FAIL → türet → PASS', () => {
  fmG('getirir-demo', 1, 1, 'getirir:\n  - dugum: a:b');
  run(['--proje', FX]);
  fmG('getirir-demo', 1, 1, 'getirir:\n  - dugum: a:c');       // beyan değişti → INDEX bayat
  const g1 = run(['--proje', FX, '--gate']);
  assert(g1.code === 1 && /BAYAT/.test(g1.out), 'beyan değişimi damgada yakalanmadı: ' + g1.out);
  run(['--proje', FX]);
  assert(run(['--proje', FX, '--gate']).code === 0, 'türetince PASS değil');
});

// (j) ADDITIVE — getirir+damga çıkarılınca önce/sonra diff BOŞ
T('(j) beyan ekle/çıkar: getirir+damga dışında INDEX.json DEĞİŞMEZ (additive)', () => {
  fmG('getirir-demo', 1, 1, null); fmG('getirir-demo', 1, 2, null);   // beyansız taban
  run(['--proje', FX]);
  const soy = () => { const j = JSON.parse(fs.readFileSync(P('INDEX.json'), 'utf8'));
    delete j.damga; for (const p of j.plans) delete p.getirir; return JSON.stringify(j); };
  const once = soy();
  fmG('getirir-demo', 1, 1, 'getirir:\n  - katman: yeni-katman');
  run(['--proje', FX]);
  assert(soy() === once, 'beyan eklemek getirir/damga DIŞINDA alan değiştirdi (additive değil)');
  fmG('getirir-demo', 1, 1, null); run(['--proje', FX]);
  assert(soy() === once, 'beyan çıkarmak alan değiştirdi');
});

// (k) ADVISORY — beyansızlık plan-başına TEK satır, KAPALI MUAF, exit 0
T('(k) beyansız açık aşama ADVISORY (plan-başına tek satır, gate KIRILMAZ, KAPALI muaf)', () => {
  const kj = kunyeJsonG();
  const e = kj.getirirEksik.find((x) => x.slug === 'getirir-demo');
  assert(e && e.asamalar.length === 2, 'advisory beklenen aşamaları saymadı: ' + JSON.stringify(e));
  assert(/getirir:/.test(e.onar), 'onar: yok: ' + JSON.stringify(e));
  assert(kj.getirirMuaf && typeof kj.getirirMuaf.planlar === 'number', 'muaf sayısı İLAN edilmiyor');
  // ADVISORY gate'i KIRMAZ (bekçi sözleşmesi)
  assert(run(['--proje', FX, '--gate']).code === 0, 'advisory gate kırdı');
  const k = run(['--proje', FX, '--kunye']);
  assert(k.code === 0 && /getirir: beyanı eksik/.test(k.out), '--kunye advisory basmıyor: ' + k.out);
  // KAPALI aşama MUAF: 01'i KAPALI yap → advisory'den düşer
  const st = P('getirir-demo', 'v1', 'STATE.md');
  fs.writeFileSync(st, fs.readFileSync(st, 'utf8').replace('| 01 | asama1 | AÇIK', '| 01 | asama1 | KAPALI'));
  run(['--proje', FX]);
  const e2 = kunyeJsonG().getirirEksik.find((x) => x.slug === 'getirir-demo');
  assert(e2 && !e2.asamalar.includes('01'), 'KAPALI aşama advisoryden düşmedi: ' + JSON.stringify(e2));
});

// (l) SERBEST GÖVDE ASLA PARSE EDİLMEZ (K-I / E4 determinizmi) — hammadde YALNIZ frontmatter'dır.
T('(l) gövdedeki "getirir:" satırı PARSE EDİLMEZ (yalnız frontmatter hammaddedir)', () => {
  const f = P('getirir-demo', 'v1', 'asama-02-asama2.md');
  fs.writeFileSync(f, '---\nkosum: tek-ajan\n---\n# aşama\n\ngetirir:\n  - dugum: hayali:dugum\n');
  run(['--proje', FX]);
  assert(!getirirOf('getirir-demo', '02'), 'GÖVDE parse edildi — K-I ihlali!');
  fs.rmSync(P('getirir-demo'), { recursive: true }); run(['--proje', FX]);   // temizle + FX tutarlı bırak
});

// 4.6) PLAN KÜNYESİ — kimlik kartı · TÜREV öncelik · legacy sözleşmesi · KAPALI muafiyeti
const kunyeJson = (proje = FX) => JSON.parse(run(['--proje', proje, '--kunye', '--json']).out);

T('künye parse edilir + oncelik/puan TÜRETİLİR (elle yazılmaz)', () => {
  plan('kunye-demo', 1, { durumlar: ['AÇIK', 'AÇIK'],
    kunye: { kritiklik: 'kritik', aciliyet: 'yakın', hacim: 'büyük', hedef: 'X artık şöyledir.' } });
  const k = planOf(durumJson(), 'kunye-demo').kunye;
  assert(k.kritiklik === 'kritik' && k.aciliyet === 'yakın' && k.hacim === 'büyük', JSON.stringify(k));
  // kritik=3, yakın=2 → puan 3*4+2=14 · oncelik min(3, round(5/2))=3
  assert(k.puan === 14 && k.oncelik === 3, `türev yanlış: ${JSON.stringify(k)}`);
  assert(k.hedef === 'X artık şöyledir.', 'hedef taşınmadı: ' + k.hedef);
});
T('hedef serbest metindir — içindeki `·` cümleyi KIRPMAZ', () => {
  plan('kunye-nokta', 1, { durumlar: ['AÇIK'],
    kunye: { kritiklik: 'orta', aciliyet: 'normal', hacim: 'küçük', hedef: 'A · B · C hepsi görünür olur.' } });
  const k = planOf(durumJson(), 'kunye-nokta').kunye;
  assert(k.hedef === 'A · B · C hepsi görünür olur.', 'hedef kırpıldı: ' + k.hedef);
  fs.rmSync(P('kunye-nokta'), { recursive: true });
});
T('künyesiz AÇIK plan: ADVISORY (eksik listesinde) ama gate KIRILMAZ', () => {
  plan('kunyesiz', 1, { durumlar: ['AÇIK'] });          // künye yok
  run(['--proje', FX]);
  const j = kunyeJson();
  const e = j.eksik.find((x) => x.slug === 'kunyesiz');
  assert(e && e.eksik.includes('Kritiklik') && /onar:|MASTER\.md/.test(e.onar), JSON.stringify(j.eksik));
  const g = run(['--proje', FX, '--gate']); assert(g.code === 0, 'künyesizlik gate kırdı: ' + g.out);
});
T('KAPALI plan künyesizse MUAF — alarm üretmez (ilan edilir)', () => {
  plan('kunye-kapali', 1, { durumlar: ['KAPALI'], acikCl: 0 });
  run(['--proje', FX]);
  const j = kunyeJson();
  assert(!j.eksik.some((x) => x.slug === 'kunye-kapali'), 'kapalı plan alarm üretti');
  assert(j.muaf.some((x) => x.slug === 'kunye-kapali'), 'muafiyet İLAN edilmedi: ' + JSON.stringify(j.muaf));
});
T('geçersiz künye → GEÇERSİZ KÜNYE + gate FAIL; düzelt → PASS (kırmızı→yeşil)', () => {
  plan('kunye-bozuk', 1, { durumlar: ['AÇIK'],
    kunye: { kritiklik: 'çok-kritik', aciliyet: 'yakın', hacim: 'büyük', hedef: 'H.' } });
  run(['--proje', FX]);
  const d = run(['--proje', FX, '--denetle']);
  assert(/GEÇERSİZ KÜNYE: plans\/kunye-bozuk/.test(d.out), d.out);
  const g1 = run(['--proje', FX, '--gate']);
  assert(g1.code === 1 && /GEÇERSİZ KÜNYE/.test(g1.out), 'gate FAIL etmedi: ' + g1.out);
  plan('kunye-bozuk', 1, { durumlar: ['AÇIK'],
    kunye: { kritiklik: 'yüksek', aciliyet: 'yakın', hacim: 'büyük', hedef: 'H.' } });
  run(['--proje', FX]);
  const g2 = run(['--proje', FX, '--gate']); assert(g2.code === 0, 'düzeltince PASS değil: ' + g2.out);
});
T('öncelik sırası künye puanına göre TÜREVDİR (P3 üstte, künyesiz en altta)', () => {
  const sira = kunyeJson().sira.map((p) => p.slug);
  const i = (s) => sira.indexOf(s);
  assert(i('kunye-demo') < i('kunye-bozuk'), `P3 önce gelmeli: ${sira.join(' > ')}`);   // 14 > 10
  assert(i('kunye-bozuk') < i('kunyesiz'), `künyesiz sona düşmeli: ${sira.join(' > ')}`);
  const idx = fs.readFileSync(P('INDEX.md'), 'utf8');
  assert(/## Öncelik sırası/.test(idx), 'INDEX.md öncelik sırası bölümü yok');
  assert(/künye \(kritiklik\/aciliyet · hacim\)/.test(idx), 'INDEX.md künye sütunu yok');
});
T('künye değişimi damgayı değiştirir → gate BAYAT FAIL → türet → PASS', () => {
  run(['--proje', FX]);
  plan('kunye-demo', 1, { durumlar: ['AÇIK', 'AÇIK'],
    kunye: { kritiklik: 'düşük', aciliyet: 'ertelenebilir', hacim: 'küçük', hedef: 'X artık şöyledir.' } });
  const g1 = run(['--proje', FX, '--gate']);
  assert(g1.code === 1 && /BAYAT/.test(g1.out), 'künye değişimi damgada görünmedi: ' + g1.out);
  run(['--proje', FX]);
  const g2 = run(['--proje', FX, '--gate']); assert(g2.code === 0, g2.out);
  const k = planOf(durumJson(), 'kunye-demo').kunye;
  assert(k.puan === 0 && k.oncelik === 0, 'alt sınır türevi yanlış: ' + JSON.stringify(k));
  for (const s of ['kunye-demo', 'kunyesiz', 'kunye-kapali', 'kunye-bozuk']) fs.rmSync(P(s), { recursive: true });
  run(['--proje', FX]);   // FX'i tutarlı bırak
});

// 5) gerçek projeler (salt-okunur ölçüm; INDEX yazımı agac.mjs'in kendi işi)
const DORUK = path.join(os.homedir(), 'dev/dorukcom06');
T('dorukcom06: gate PASS + kalite-turu INDEX.json içinde', () => {
  run(['--proje', DORUK]); // taze türet (diğer session STATE güncellemiş olabilir)
  const r = run(['--proje', DORUK, '--gate']); assert(r.code === 0, r.out);
  const j = JSON.parse(fs.readFileSync(path.join(DORUK, 'plans/INDEX.json'), 'utf8'));
  assert(j.plans.some((p) => p.slug === 'kalite-turu'), 'kalite-turu yok');
});
T('kaptan köprüsü: readPlans + buildModel plan taşıyor', async () => {
  // dinamik import senkron T ile uyumsuz olmasın diye execFile ile ölç
  const out = execFileSync('node', ['-e', `
    import(process.env.HOME + '/.claude/skills/kaptan/scripts/model.mjs').then(m => {
      const plans = m.readPlans(process.env.HOME + '/dev/dorukcom06');
      if (!plans.length) { console.log('BOS'); process.exit(0); }
      const model = m.buildModel();
      const p = model.projects.find(x => String(x.cwd || '').includes('dorukcom06'));
      console.log(JSON.stringify({ readPlans: plans.length, modelPlans: (p?.plans || []).length }));
    });`], { encoding: 'utf8' });
  assert(/"readPlans":[1-9]/.test(out) && /"modelPlans":[1-9]/.test(out), out);
});
T('plans/ olmayan projede model KIRILMAZ (readPlans boş döner)', () => {
  const out = execFileSync('node', ['-e', `
    import(process.env.HOME + '/.claude/skills/kaptan/scripts/model.mjs')
      .then(m => console.log(JSON.stringify(m.readPlans('/tmp/olmayan-proje-xyz'))));`], { encoding: 'utf8' });
  assert(out.trim() === '[]', out);
});

// ── OTURUM boyutu (çift dikiş) ───────────────────────────────────────────────
// Kural (Ders 17/18): KIRMIZI YANABİLEN kapı kanıttır — her denetimin bilerek bozulan bir vakası var.
const OTURUM = path.join(os.homedir(), '.claude/skills/plan-organizatoru/scripts/oturum.mjs');
const KAPANIS = path.join(os.homedir(), '.claude/hooks/oturum-kapanis.mjs');
const runO = (args, opts = {}) => {
  try { return { out: execFileSync('node', [OTURUM, ...args], { encoding: 'utf8', ...opts }), code: 0 }; }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 }; }
};
// AYRI fikstür: yukarıdaki FX'in damgası/INDEX'i başka testlerin sözleşmesi — oturum testleri
// onu kirletmemeli. Kendi projesini kurar, kendi ~/.claude'unu (CLAUDE_CONFIG_DIR) izole eder.
const OFX = fs.mkdtempSync(path.join(os.tmpdir(), 'oturum-proof-'));
const OP = (...s) => path.join(OFX, 'proje', 'plans', ...s);
const OCLAUDE = path.join(OFX, 'claude');
function oplan(slug, { durum = 'AÇIK', oturum = null, kunye = '> Kritiklik: yüksek · Aciliyet: yakın · Hacim: orta\n> Hedef: h\n' } = {}) {
  fs.mkdirSync(OP(slug, 'v1'), { recursive: true });
  fs.writeFileSync(OP(slug, 'v1', 'MASTER.md'),
    `# ${slug} — MASTER (v1)\n\n> Kategori: özellik · Üst: —\n${kunye}${oturum ? `> Oturum: ${oturum}\n` : ''}`);
  fs.writeFileSync(OP(slug, 'v1', 'STATE.md'),
    `## Aşama durumları\n\n| # | aşama | durum | son dokunuş | kanıt |\n|---|---|---|---|---|\n| 01 | a | ${durum} | — | — |\n`);
  fs.writeFileSync(OP(slug, 'v1', 'CHECKLIST.md'), '- [x] ok\n');
  fs.writeFileSync(OP(slug, 'v1', 'asama-01-a.md'), '# a\n');
}
const OROOT = path.join(OFX, 'proje');
const oturumDosya = (ad, icerik) => {
  fs.mkdirSync(OP('oturumlar'), { recursive: true });
  fs.writeFileSync(OP('oturumlar', ad), icerik);
};
const dos = (ref, { durum = 'AÇIK', hedefler = [], session = 'aaaaaaaa' } = {}) =>
  `<!-- ${ref} -->\n# Oturum — test\n\n> Oturum: ${ref} · Session: ${session} · Proje: proje\n` +
  `> Başlangıç: 2026-07-27T00:00:00Z · Bitiş: — · Durum: ${durum}\n> Hedef: test hedefi\n\n` +
  `## Hedefler\n<!-- YALNIZ bu oturumda yaşar -->\n${hedefler.map((h) => `- [${h[1] ? 'x' : ' '}] ${h[0]}`).join('\n')}\n\n## Notlar\n`;

oplan('kapali-plan', { durum: 'KAPALI', oturum: 'ot:2026-07-01/tam-oturum' });
oplan('acik-plan', { durum: 'AÇIK', oturum: 'ot:2026-07-02/eksik-oturum' });
oplan('beyansiz-plan', { durum: 'AÇIK' });
oturumDosya('2026-07-01-tam-oturum.md', dos('ot:2026-07-01/tam-oturum', { durum: 'KAPALI', hedefler: [['bitti', true]] }));
oturumDosya('2026-07-02-eksik-oturum.md', dos('ot:2026-07-02/eksik-oturum', { durum: 'KAPALI', hedefler: [['yarım', false]] }));
oturumDosya('2026-07-03-suruyor.md', dos('ot:2026-07-03/suruyor', { durum: 'AÇIK', hedefler: [['devam', false]] }));

T('oturum: HÜKÜM üçe ayrılıyor — TAM · EKSİK · SÜRÜYOR', () => {
  const r = runO(['durum', '--proje', OROOT, '--json']); assert(r.code === 0, r.out);
  const j = JSON.parse(r.out);
  const h = (ref) => j.oturumlar.find((o) => o.ref === ref)?.hukum;
  assert(h('ot:2026-07-01/tam-oturum') === 'TAM', 'TAM değil: ' + h('ot:2026-07-01/tam-oturum'));
  assert(h('ot:2026-07-02/eksik-oturum') === 'EKSİK', 'EKSİK değil');
  assert(h('ot:2026-07-03/suruyor') === 'SÜRÜYOR', 'SÜRÜYOR değil');
});
T('oturum: KAPALI plan + kapalı hedef → TAM; hedef açılırsa TAM DÜŞER (kırmızı yanabilir)', () => {
  const f = OP('oturumlar', '2026-07-01-tam-oturum.md');
  const yedek = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, yedek.replace('- [x] bitti', '- [ ] bitti'));
  const j = JSON.parse(runO(['durum', '--proje', OROOT, '--json']).out);
  const h = j.oturumlar.find((o) => o.ref === 'ot:2026-07-01/tam-oturum').hukum;
  fs.writeFileSync(f, yedek);
  assert(h === 'EKSİK', 'hedef açılınca hüküm düşmedi: ' + h);
});
T('oturum: `bu --ref` açık işte exit 1, TAM oturumda exit 0 (kapanış KAPISI)', () => {
  const a = runO(['bu', '--proje', OROOT, '--ref', 'ot:2026-07-02/eksik-oturum']);
  const b = runO(['bu', '--proje', OROOT, '--ref', 'ot:2026-07-01/tam-oturum']);
  assert(a.code === 1, 'açık iş exit 1 vermedi: ' + a.code);
  assert(b.code === 0, 'TAM oturum exit 0 vermedi: ' + b.code + b.out);
});
T('oturum: BEYANSIZ plan ADVISORY (gate PASS), BİÇİMSİZ beyan gate FAIL', () => {
  const g1 = runO(['gate', '--proje', OROOT]);
  assert(g1.code === 0, 'beyansız plan gate kırdı: ' + g1.out);
  const f = OP('bozuk-beyan', 'v1', 'MASTER.md');
  oplan('bozuk-beyan', { oturum: 'ot:BOZUK' });
  const a = run(['--proje', OROOT, '--denetle']);
  fs.rmSync(path.dirname(path.dirname(f)), { recursive: true, force: true });
  assert(/GEÇERSİZ OTURUM/.test(a.out), 'biçimsiz beyan bulgu üretmedi: ' + a.out);
});
T('oturum: çıpa uyuşmazlığı (dosya adı ≠ künye) gate FAIL', () => {
  oturumDosya('2026-07-09-yanlis.md', dos('ot:2026-07-09/baska-ad'));
  const r = runO(['gate', '--proje', OROOT]);
  fs.rmSync(OP('oturumlar', '2026-07-09-yanlis.md'), { force: true });
  assert(r.code === 1 && /uyuşmazl/i.test(r.out), 'uyuşmazlık yakalanmadı: ' + r.out);
});
T('oturum: agac.mjs `> Oturum:` alanını INDEX.json\'a yayınlıyor', () => {
  run(['--proje', OROOT]);
  const j = JSON.parse(fs.readFileSync(OP('INDEX.json'), 'utf8'));
  const p = j.plans.find((x) => x.slug === 'acik-plan');
  assert(p.kunye.oturum === 'ot:2026-07-02/eksik-oturum', 'kunye.oturum yok: ' + JSON.stringify(p.kunye));
});
T('oturum: EKSİK oturum genel TODO\'ya TEK satır düşüyor (hedef dökümü DEĞİL)', () => {
  const j = JSON.parse(run(['--proje', OROOT, '--todo', '--json']).out);
  const md = j.todo.maddeler.filter((m) => m.tur === 'oturum');
  assert(md.length === 1, `EKSİK oturum sayısı 1 olmalı, ${md.length} bulundu`);
  assert(/^td:oturum\//.test(md[0].ref), 'ref şeması yanlış: ' + md[0].ref);
  assert(/terfi|TODO-ELLE/.test(md[0].onar), 'onar: terfi yolunu söylemiyor');
});
T('oturum: SÜRÜYOR oturum TODO maddesi ÜRETMEZ (canlı iş borç değildir)', () => {
  const j = JSON.parse(run(['--proje', OROOT, '--todo', '--json']).out);
  assert(!j.todo.maddeler.some((m) => m.tur === 'oturum' && /suruyor/.test(m.ref)), 'SÜRÜYOR madde üretti');
});
T('oturum: global kılavuz SIRALI — EKSİK önce, TAM listelenmez', () => {
  const r = runO(['global', '--proje', OROOT, '--json']); assert(r.code === 0, r.out);
  const j = JSON.parse(r.out);
  const acik = j.acik.filter((k) => k.root === OROOT);
  assert(acik.length >= 2, 'sarkık liste boş');
  assert(acik[0].hukum === 'EKSİK', 'ilk sırada EKSİK yok: ' + acik[0].hukum);
  assert(!j.acik.some((k) => k.hukum === 'TAM'), 'TAM kılavuza girdi');
});
T('oturum: backfill KURU koşum hiçbir şey yazmaz; --uygula beyanı işler', () => {
  const once = fs.readFileSync(OP('beyansiz-plan', 'v1', 'MASTER.md'), 'utf8');
  runO(['backfill', '--proje', OROOT]);
  assert(once === fs.readFileSync(OP('beyansiz-plan', 'v1', 'MASTER.md'), 'utf8'), 'kuru koşum yazdı');
  // git yok → doğum tarihi ÖLÇÜLEMEZ → tahmin YAZILMAZ (uydurma yasağının kanıtı)
  const r = runO(['backfill', '--proje', OROOT, '--uygula']);
  assert(/ÖLÇÜLEMEDİ/.test(r.out), 'git\'siz projede ölçülemedi ilanı yok: ' + r.out);
  assert(once === fs.readFileSync(OP('beyansiz-plan', 'v1', 'MASTER.md'), 'utf8'), 'ölçülemeyen plana yazdı');
});
T('oturum: SessionEnd hook eşik ALTINDA dosya AÇMAZ, eşik ÜSTÜNDE açar+kapatır', () => {
  if (!fs.existsSync(KAPANIS)) throw new Error('hook kurulu değil: ' + KAPANIS);
  const sid = 'cafebabe-1111-2222-3333-444444444444';
  const goals = path.join(OCLAUDE, 'kaptan', 'goals', OROOT.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(goals, { recursive: true });
  // izole ~/.claude: hook script'leri oradan çözer → gerçek profile DOKUNULMAZ
  fs.mkdirSync(path.join(OCLAUDE, 'skills', 'plan-organizatoru', 'scripts'), { recursive: true });
  for (const f of ['oturum.mjs', 'oturum-lib.mjs', 'agac.mjs'])
    fs.copyFileSync(path.join(os.homedir(), '.claude/skills/plan-organizatoru/scripts', f),
      path.join(OCLAUDE, 'skills', 'plan-organizatoru', 'scripts', f));
  const cagir = () => execFileSync('node', [KAPANIS], {
    input: JSON.stringify({ session_id: sid, cwd: OROOT }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: OCLAUDE },
  });
  // YALNIZ `.md` sayılır: `plans/oturumlar/` artık `devir/` ALT DİZİNİNİ de barındırıyor
  // (aşama-05). Çıplak `readdirSync().length` onu bir oturum dosyası sanıp sayıyordu —
  // ölçtüğü şey "defter sayısı" olduğu için ölçüt dosya TÜRÜNE bağlanır.
  const say = () => fs.readdirSync(OP('oturumlar')).filter((f) => f.endsWith('.md')).length;
  // (a) eşik ALTI: 2 madde (< 3) → dosya açılmaz
  fs.writeFileSync(path.join(goals, `${sid}.json`), JSON.stringify({
    sessionId: sid, title: 'kücük iş', startedAt: '2026-07-27T00:00:00Z',
    todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }],
  }));
  const once = say(); cagir();
  assert(say() === once, 'eşik altında dosya açıldı');
  // (b) eşik ÜSTÜ: 3 madde → dosya açılır, KAPALI damgalanır, açık hedef EKSİK olur
  fs.writeFileSync(path.join(goals, `${sid}.json`), JSON.stringify({
    sessionId: sid, title: '/goal büyük iş yapılacak', startedAt: '2026-07-27T00:00:00Z',
    todos: [{ content: 'x', status: 'completed' }, { content: 'y', status: 'pending' }, { content: 'z', status: 'pending' }],
  }));
  cagir();
  assert(say() === once + 1, `eşik üstünde dosya açılmadı (${once} → ${say()})`);
  const yeni = fs.readdirSync(OP('oturumlar')).find((f) => /buyuk-is/.test(f));
  assert(yeni, 'dosya adı başlıktan türemedi: ' + fs.readdirSync(OP('oturumlar')).join(','));
  const md = fs.readFileSync(OP('oturumlar', yeni), 'utf8');
  assert(/Durum: KAPALI/.test(md), 'hook KAPALI damgalamadı');
  assert(/- \[x\] x/.test(md) && /- \[ \] y/.test(md), 'nabız hedefleri tohumlanmadı: ' + md);
  assert(fs.existsSync(OP('OTURUMLAR.md')), 'proje roll-up türetilmedi');
  assert(fs.existsSync(path.join(OCLAUDE, 'oturum', 'KILAVUZ.md')), 'global kılavuz türetilmedi');
  // Zincire giren `devir` adımı (aşama-05) bu yolda da GERÇEKTEN koşmalı: eşik üstü oturum
  // defter açtıysa devir notu da doğar (eşik altı oturum ikisini de üretmez — yukarıda ölçüldü).
  const dn = fs.readdirSync(path.join(OP('oturumlar'), 'devir')).filter((f) => f.endsWith('.json'));
  assert(dn.some((f) => /buyuk-is/.test(f)), 'zincirin devir adımı not yazmadı: ' + dn.join(','));
});
// K#4 REGRESYONU (2026-08-03) — NABIZ ANAHTARI BÖLÜNMESİ.
// Yazan uç (goal-tracker.mjs) kovayı `payload.cwd`den türetir; okuyan uç proje ROOT'undan
// türetiyordu. Alt dizinden koşan bir oturumun nabzı AYRI kovaya düşüyor ve tohumlama onu
// HİÇ görmüyordu → tohumlanmayan hedef + kapatılamayan "hayalet" madde. Ölçülen kanıt:
// ~/.claude/kaptan/goals/ altındaki yetim kovalar (…-skills-plan-organizatoru-scripts).
// Bu test kovayı KASTEN yanlış slug'a yazar; okuyan uç onu bulmazsa FAIL eder.
T('oturum: nabız ALT DİZİN kovasına yazılmışsa da tohumlanır (K#4 çok-slug taraması)', () => {
  const sid = 'deadbeef-9999-8888-7777-666666666666';
  // yetim kova: cwd = <proje>/packages/core (proje ROOT'u DEĞİL)
  const altCwd = path.join(OROOT, 'packages', 'core');
  const yetim = path.join(OCLAUDE, 'kaptan', 'goals', altCwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(yetim, { recursive: true });
  fs.writeFileSync(path.join(yetim, `${sid}.json`), JSON.stringify({
    sessionId: sid, title: 'alt dizinden koşan iş', startedAt: '2026-08-03T00:00:00Z',
    todos: [{ content: 'yetim kovadaki madde', status: 'pending' },
            { content: 'kapanmış madde', status: 'completed' }],
  }));
  // ROOT slug'ında bu session'a ait HİÇBİR dosya yok — eski kod burada boş dönerdi
  const rootKova = path.join(OCLAUDE, 'kaptan', 'goals', OROOT.replace(/[^A-Za-z0-9]/g, '-'));
  assert(!fs.existsSync(path.join(rootKova, `${sid}.json`)), 'fikstür bozuk: ROOT kovasında dosya var');
  const r = execFileSync('node', [path.join(OCLAUDE, 'skills', 'plan-organizatoru', 'scripts', 'oturum.mjs'),
    'tohumla', '--ad', 'k4-yetim-kova', '--session', sid], {
    cwd: OROOT, encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: OCLAUDE },
  });
  assert(/OTURUM (AÇILDI|TAZELENDİ)/.test(r), 'defter açılmadı: ' + r);
  const dosya = fs.readdirSync(OP('oturumlar')).find((f) => /k4-yetim-kova/.test(f));
  assert(dosya, 'defter dosyası yok: ' + fs.readdirSync(OP('oturumlar')).join(','));
  const md = fs.readFileSync(OP('oturumlar', dosya), 'utf8');
  assert(/yetim kovadaki madde/.test(md), 'YETİM KOVADAKİ NABIZ TOHUMLANMADI (K#4 nüksetti): ' + md);
  assert(/- \[x\] kapanmış madde/.test(md), 'kapalı madde durumu taşınmadı: ' + md);
});
T('oturum: hook plans/ OLMAYAN klasörde hiçbir şey yapmaz (ve exit 0)', () => {
  const bos = fs.mkdtempSync(path.join(os.tmpdir(), 'oturum-bos-'));
  const out = execFileSync('node', [KAPANIS], {
    input: JSON.stringify({ session_id: 'x', cwd: bos }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: OCLAUDE },
  });
  assert(out.trim() === '', 'çıktı üretti: ' + out);
  assert(!fs.existsSync(path.join(bos, 'plans')), 'plans/ uydurdu');
  fs.rmSync(bos, { recursive: true, force: true });
});
T('oturum: hedef parse\'ı bölüm sınırını doğru bulur ("YALNIZ" tuzağı — \\Z regresyon)', () => {
  // 2026-07-27 ölçümü: `(?=^##\s|\Z)` lookahead'i literal "Z"ye düşüp bölümü yorumdaki
  // "YALNIZ"da kesiyordu → maddeler GÖRÜNMEZ oluyordu. Tuzak metni fikstürde SABİT.
  oturumDosya('2026-07-08-tuzak.md',
    `<!-- ot:2026-07-08/tuzak -->\n# Oturum — t\n\n> Oturum: ot:2026-07-08/tuzak · Session: bbbbbbbb · Proje: proje\n` +
    `> Başlangıç: — · Bitiş: — · Durum: AÇIK\n> Hedef: h\n\n## Hedefler\n` +
    `<!-- işaretsiz madde YALNIZ bu oturumda yaşar -->\n- [ ] tuzaktan sonraki madde\n\n## Notlar\n`);
  const j = JSON.parse(runO(['durum', '--proje', OROOT, '--json']).out);
  const o = j.oturumlar.find((x) => x.ref === 'ot:2026-07-08/tuzak');
  fs.rmSync(OP('oturumlar', '2026-07-08-tuzak.md'), { force: true });
  assert(o && o.hedefToplam === 1, 'yorumdan sonraki madde görülmedi: ' + JSON.stringify(o));
});

// ── DEVİR NOTU (aşama-05) ────────────────────────────────────────────────────
// Kural (Ders 17/18): KIRMIZI YANABİLEN kapı kanıttır. Her senaryonun bilerek bozulan hâli var.
//
// İZOLASYON: devir motoru kilit defterini `claims-lib` üzerinden okur ve claims-lib EV DİZİNİNİ
// `homedir()` ile çözer (CLAUDE_CONFIG_DIR'i DEĞİL). Bu yüzden bu blok HEM `HOME` HEM
// `CLAUDE_CONFIG_DIR` override eder — yoksa fikstür GERÇEK kilit defterine yazardı.

const DFX = fs.mkdtempSync(path.join(os.tmpdir(), 'devir-proof-'));
const DROOT = path.join(DFX, 'repo');
const DHOME = path.join(DFX, 'home');
const DCLAUDE = path.join(DHOME, '.claude');
const DP = (...s) => path.join(DROOT, 'plans', ...s);
const DSID = 'deadbeef-9999-8888-7777-666655554444';   // TAM id — nota TAM hâliyle girmeli
const DKISA = DSID.slice(0, 8);
const dprocs = [];

fs.mkdirSync(DP('oturumlar'), { recursive: true });
fs.mkdirSync(path.join(DCLAUDE, 'session-status'), { recursive: true });
fs.mkdirSync(path.join(DCLAUDE, 'hooks'), { recursive: true });
fs.mkdirSync(path.join(DCLAUDE, 'skills', 'plan-organizatoru', 'scripts'), { recursive: true });
fs.mkdirSync(path.join(DCLAUDE, 'skills', 'eszamanli', 'scripts'), { recursive: true });
execFileSync('git', ['init', '-q', DROOT]);            // repoRootOf gerçek bir kök bulsun
fs.writeFileSync(path.join(DROOT, '.claude-placeholder'), '');
for (const f of ['oturum.mjs', 'oturum-lib.mjs', 'agac.mjs'])
  fs.copyFileSync(path.join(os.homedir(), '.claude/skills/plan-organizatoru/scripts', f),
    path.join(DCLAUDE, 'skills', 'plan-organizatoru', 'scripts', f));
for (const f of ['claims-lib.mjs', 'claim-guard.mjs', 'oturum-kapanis.mjs'])
  fs.copyFileSync(path.join(os.homedir(), '.claude/hooks', f), path.join(DCLAUDE, 'hooks', f));
fs.copyFileSync(path.join(os.homedir(), '.claude/skills/eszamanli/scripts/claim.mjs'),
  path.join(DCLAUDE, 'skills', 'eszamanli', 'scripts', 'claim.mjs'));

const DENV = { ...process.env, HOME: DHOME, CLAUDE_CONFIG_DIR: DCLAUDE, CLAUDE_CODE_SESSION_ID: DSID };
const DOTURUM = path.join(DCLAUDE, 'skills', 'plan-organizatoru', 'scripts', 'oturum.mjs');
const runD = (args) => {
  try { return { out: execFileSync('node', [DOTURUM, ...args, '--proje', DROOT], { encoding: 'utf8', env: DENV }), code: 0 }; }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 }; }
};
/** Devir notunun yolu ÜRÜNÜN çözümleyicisinden sorulur — harness yol mantığını KOPYALAMAZ
 *  (kopyalarsa üründen bağımsız yalanlaşır; `ledgerDirIn` emsali). */
const DNOT = () => path.join(DP('oturumlar'), 'devir', '2026-07-20-devir-testi.json');
const dJson = () => JSON.parse(fs.readFileSync(DNOT(), 'utf8'));

/** Defter: `kapat` çalışmış gibi Bitiş damgalı + KAPALI (zincirde devir kapat'tan SONRA koşar). */
const ddefter = ({ bitis = '2026-07-20T12:00:00Z', hedefler = [['sarkık iş', false], ['biten', true]] } = {}) =>
  `<!-- ot:2026-07-20/devir-testi -->\n# Oturum — devir testi\n\n` +
  `> Oturum: ot:2026-07-20/devir-testi · Session: ${DKISA} · Proje: repo\n` +
  `> Başlangıç: 2026-07-20T09:00:00Z · Bitiş: ${bitis} · Durum: KAPALI\n> Hedef: devir notu doğsun\n\n` +
  `## Hedefler\n${hedefler.map((h) => `- [${h[1] ? 'x' : ' '}] ${h[0]}`).join('\n')}\n\n## Notlar\n`;

const dnabiz = (todos) => {
  const g = path.join(DCLAUDE, 'kaptan', 'goals', DROOT.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(g, { recursive: true });
  fs.writeFileSync(path.join(g, `${DSID}.json`), JSON.stringify({
    sessionId: DSID, title: 'devir testi', startedAt: '2026-07-20T09:00:00Z', todos,
  }));
};

fs.writeFileSync(DP('oturumlar', '2026-07-20-devir-testi.md'), ddefter());
dnabiz([
  { content: 'biten madde', status: 'completed' },
  { content: 'ŞU AN YAPILAN madde', status: 'in_progress' },
  { content: 'sıradaki madde', status: 'pending' },
]);

T('devir: not doğar · şema PASS · session id TAM · sıradaki adım = in_progress', () => {
  const r = runD(['devir']);
  assert(r.code === 0 && /DEVİR YAZILDI/.test(r.out), r.out);
  assert(fs.existsSync(DNOT()), 'devir notu yazılmadı: ' + DNOT());
  const j = dJson();
  const d = lib.devirDogrula(j);
  assert(d.gecerli, 'şema FAIL: ' + d.hatalar.join(' · '));
  assert(j.surum === lib.DEVIR_SURUM, 'sürüm yanlış: ' + j.surum);
  // TAM id sözleşmesi (05→06/07/08 mührü): kısa id kimlik DEĞİLDİR.
  assert(j.session.id === DSID, 'TAM session id taşınmadı: ' + j.session.id);
  assert(j.session.kisa === DKISA, 'kısa id yok: ' + j.session.kisa);
  assert(j.siradakiAdim === 'ŞU AN YAPILAN madde', 'sıradaki adım in_progress değil: ' + j.siradakiAdim);
  assert(j.todos.inProgress.length === 1 && j.todos.acik.length === 2, JSON.stringify(j.todos));
  assert(j.kapanis === '2026-07-20T12:00:00Z', 'kapanış defterin Bitiş\'inden gelmedi: ' + j.kapanis);
  assert(j.oturumDefteri.hukum === 'EKSİK', 'hüküm taşınmadı: ' + j.oturumDefteri.hukum);
});

T('devir: İDEMPOTENS — 2. koşum bayt-özdeş ve "aynı — yazılmadı" der', () => {
  const once = fs.readFileSync(DNOT());
  const r = runD(['devir']);
  assert(/aynı — yazılmadı/.test(r.out), '2. koşum yazma-atlama demedi: ' + r.out);
  assert(Buffer.compare(once, fs.readFileSync(DNOT())) === 0, 'not bayt-özdeş değil');
});

T('devir: sıradaki adım in_progress YOKSA ilk AÇIK HEDEFe düşer (deterministik zincir)', () => {
  dnabiz([{ content: 'biten madde', status: 'completed' }]);
  runD(['devir']);
  assert(dJson().siradakiAdim === 'sarkık iş', 'açık hedefe düşmedi: ' + dJson().siradakiAdim);
  dnabiz([                                            // fikstürü geri al
    { content: 'biten madde', status: 'completed' },
    { content: 'ŞU AN YAPILAN madde', status: 'in_progress' },
    { content: 'sıradaki madde', status: 'pending' },
  ]);
  runD(['devir']);
});

T('devir: transcript VERİLMEZSE uydurmaz — olculemedi ilan eder; verilince ilk/son isteği çıkarır', () => {
  assert(dJson().olculemedi.some((x) => /transcript/.test(x)), 'transcript ilanı yok: ' + JSON.stringify(dJson().olculemedi));
  assert(dJson().acilisIstek === null && dJson().sonIstek === null, 'istek uydurdu');
  const tr = path.join(DFX, 'tr.jsonl');
  fs.writeFileSync(tr, [
    JSON.stringify({ type: 'user', message: { content: 'AÇILIŞ isteği: şunu yap' } }),
    JSON.stringify({ type: 'assistant', message: { content: 'ok' } }),
    JSON.stringify({ type: 'user', message: { content: '<system-reminder>gürültü</system-reminder>' } }),
    JSON.stringify({ type: 'user', message: { content: 'SON anlamlı istek: şurayı düzelt' } }),
    JSON.stringify({ type: 'user', message: { content: 'devam' } }),   // BOS_ISTEK — son OLMAZ
  ].join('\n') + '\n');
  runD(['devir', '--transcript', tr]);
  const j = dJson();
  assert(j.acilisIstek === 'AÇILIŞ isteği: şunu yap', 'açılış isteği yanlış: ' + j.acilisIstek);
  assert(j.sonIstek === 'SON anlamlı istek: şurayı düzelt', 'BOS_ISTEK/gürültü filtresi tutmadı: ' + j.sonIstek);
  assert(!j.olculemedi.some((x) => /transcript/.test(x)), 'ölçüleni ölçülemedi sandı');
});

T('devir: SIR ELEĞİ — sahte token notta YOK, yerinde ilan var', () => {
  const tr = path.join(DFX, 'tr-sir.jsonl');
  const sahte = 'sk-ant-api03-KURULUKANITTOKENUDUR1234567890abcdefXYZ';
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', message: { content: `anahtarım ${sahte} bunu kullan` } }) + '\n');
  runD(['devir', '--transcript', tr]);
  const ham = fs.readFileSync(DNOT(), 'utf8');
  assert(!ham.includes(sahte), 'SIR NOTA SIZDI');
  assert(/«sır elendi»/.test(ham), 'eleme İLAN edilmedi: ' + dJson().sonIstek);
  runD(['devir', '--transcript', path.join(DFX, 'tr.jsonl')]);   // fikstürü geri al
});

T('devir: K9 devam önerisi — YOKken null, VARken geçer; BOZUK öneri null kalır', () => {
  assert(dJson().devamModeli === null, 'öneri yokken null değil');
  const dd = path.join(DCLAUDE, 'oturum', 'devam');
  fs.mkdirSync(dd, { recursive: true });
  // bozuk (sürümsüz) → 05 HÜKÜM VERMEZ, taşımaz
  fs.writeFileSync(path.join(dd, `${DSID}.json`), JSON.stringify({ model: 'x' }));
  runD(['devir', '--transcript', path.join(DFX, 'tr.jsonl')]);
  assert(dJson().devamModeli === null, 'bozuk öneri taşındı: ' + JSON.stringify(dJson().devamModeli));
  fs.writeFileSync(path.join(dd, `${DSID}.json`), JSON.stringify({
    surum: 1, model: 'claude-opus-5[1m]', sebep: 'fable kotası doldu', ts: '2026-07-20T11:00:00Z' }));
  runD(['devir', '--transcript', path.join(DFX, 'tr.jsonl')]);
  const dm = dJson().devamModeli;
  assert(dm && dm.model === 'claude-opus-5[1m]' && dm.sebep === 'fable kotası doldu', JSON.stringify(dm));
});

T('devir: BOZUK ŞEMA devirDogrula ile FAIL eder (kapı kırmızı yanabiliyor)', () => {
  const iyi = dJson();
  assert(lib.devirDogrula(iyi).gecerli, 'iyi not FAIL etti');
  const eksik = { ...iyi }; delete eksik.siradakiAdim;
  assert(!lib.devirDogrula(eksik).gecerli, 'eksik alan yakalanmadı');
  assert(!lib.devirDogrula({ ...iyi, surum: 99 }).gecerli, 'sürüm uyuşmazlığı yakalanmadı');
  assert(!lib.devirDogrula({ ...iyi, ref: 'ot:BOZUK' }).gecerli, 'şema dışı çıpa yakalanmadı');
  assert(!lib.devirDogrula({ ...iyi, todos: { acik: [] } }).gecerli, 'eksik todos alanı yakalanmadı');
  assert(!lib.devirDogrula({ ...iyi, session: { kisa: 'x' } }).gecerli, 'TAM id sözleşmesi delindi');
  assert(!lib.devirDogrula(null).gecerli, 'null nesne kabul edildi');
  // BİLİNMEYEN alan SERBEST (ileri sürüm alan ekleyebilir)
  assert(lib.devirDogrula({ ...iyi, gelecekAlan: 1 }).gecerli, 'bilinmeyen alan reddedildi');
});

T('devir: DEFTER YOKSA exit 2 + çalıştırılabilir onar satırı (uydurma dosya AÇMAZ)', () => {
  const bos = fs.mkdtempSync(path.join(os.tmpdir(), 'devir-defersiz-'));
  fs.mkdirSync(path.join(bos, 'plans', 'oturumlar'), { recursive: true });
  let r;
  try { execFileSync('node', [DOTURUM, 'devir', '--proje', bos], { encoding: 'utf8', env: DENV }); r = { code: 0, out: '' }; }
  catch (e) { r = { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
  assert(r.code === 2, 'exit 2 değil: ' + r.code);
  assert(/onar: node oturum\.mjs tohumla/.test(r.out), 'onar satırı yok: ' + r.out);
  assert(!fs.existsSync(path.join(bos, 'plans', 'oturumlar', 'devir')), 'defter yokken devir/ dizini uydurdu');
  fs.rmSync(bos, { recursive: true, force: true });
});

T('devir: release_all YARIŞI — kilit bırakılmış olsa da ARŞİVDEN "birakildi" olarak nota düşer', () => {
  const CLAIM = path.join(DCLAUDE, 'skills', 'eszamanli', 'scripts', 'claim.mjs');
  const GUARD = path.join(DCLAUDE, 'hooks', 'claim-guard.mjs');
  // GERÇEK canlı sahip: claims-lib canlılığı pid+procStart ile ölçer (Ders 16) — sahte kayıt yetmez.
  const p = spawn('sleep', ['120'], { stdio: 'ignore' });
  dprocs.push(p);
  const procStart = (execFileSync('ps', ['-o', 'lstart=', '-p', String(p.pid)], { encoding: 'utf8' }) || '').trim();
  fs.writeFileSync(path.join(DCLAUDE, 'session-status', `${DSID}.json`), JSON.stringify({
    sessionId: DSID, cwd: DROOT, dirName: 'repo', state: 'generating',
    since: Date.now(), updated: Date.now(), title: 'devir testi', pid: p.pid, procStart,
  }));
  execFileSync('node', [CLAIM, 'claim', '--res', 'glob:src/**', '--intent', 'devir yarış testi'],
    { encoding: 'utf8', cwd: DROOT, env: DENV });
  // (a) kilit AKTİFken nota "aktif" düşer
  runD(['devir', '--transcript', path.join(DFX, 'tr.jsonl')]);
  const aktif = (dJson().kilitler || []).find((k) => k.key === 'glob:src/**');
  assert(aktif && aktif.durum === 'aktif', 'aktif kilit nota düşmedi: ' + JSON.stringify(dJson().kilitler));
  assert(aktif.intent === 'devir yarış testi', 'niyet taşınmadı: ' + aktif.intent);
  // (b) SessionEnd sırası garanti değil: release_all ÖNCE koşarsa aktif defter boşalır
  execFileSync('node', [GUARD, 'release_all'], {
    input: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: DSID, cwd: DROOT }),
    encoding: 'utf8', cwd: DROOT, env: DENV,
  });
  runD(['devir', '--transcript', path.join(DFX, 'tr.jsonl')]);
  const brk = (dJson().kilitler || []).find((k) => k.key === 'glob:src/**');
  assert(brk, 'release_all sonrası kilit KAYBOLDU (arşiv yolu sürülmedi): ' + JSON.stringify(dJson().kilitler));
  assert(brk.durum === 'birakildi', 'durum birakildi değil: ' + brk.durum);
  try { p.kill(); } catch { /* zaten öldü */ }
});

T('devir: roll-up İLAN eder — OTURUMLAR.md ve global KILAVUZ devir satırı taşır (K8)', () => {
  runD(['durum']);
  const md = fs.readFileSync(DP('OTURUMLAR.md'), 'utf8');
  assert(/devir: `plans\/oturumlar\/devir\/2026-07-20-devir-testi\.json`/.test(md), 'OTURUMLAR devir satırı yok:\n' + md);
  assert(/sıradaki: ŞU AN YAPILAN madde/.test(md), 'sıradaki adım ilan edilmedi');
  runD(['global']);
  const kl = fs.readFileSync(path.join(DCLAUDE, 'oturum', 'KILAVUZ.md'), 'utf8');
  assert(/devir: `plans\/oturumlar\/devir\//.test(kl), 'KILAVUZ devir satırı yok:\n' + kl);
});

T('devir: devir/ dizini VARKEN plan gate + oturum gate PASS (yeni dizin governance kırmıyor)', () => {
  assert(fs.existsSync(path.join(DP('oturumlar'), 'devir')), 'fikstürde devir/ yok');
  const g = runD(['gate']);
  assert(g.code === 0, 'oturum gate kırıldı: ' + g.out);
  const a = run(['--proje', DROOT]);          // INDEX türet
  assert(a.code === 0, a.out);
  const ag = run(['--proje', DROOT, '--gate']);
  assert(ag.code === 0, 'plan gate kırıldı: ' + ag.out);
  const dn = run(['--proje', DROOT, '--denetle']);
  assert(!/YETİM/.test(dn.out), 'devir/ YETİM bulgusu üretti: ' + dn.out);
});

T('devir: SessionEnd ZİNCİRİ devri gerçekten yazar (tohumla→kapat→devir→durum→global)', () => {
  const KAP = path.join(DCLAUDE, 'hooks', 'oturum-kapanis.mjs');
  const sid2 = 'feedface-1234-5678-9abc-def012345678';
  const g = path.join(DCLAUDE, 'kaptan', 'goals', DROOT.replace(/[^A-Za-z0-9]/g, '-'));
  fs.writeFileSync(path.join(g, `${sid2}.json`), JSON.stringify({
    sessionId: sid2, title: '/goal zincir provası', startedAt: '2026-07-20T09:00:00Z',
    todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }],
  }));
  const err = path.join(DCLAUDE, 'hooks', 'oturum-kapanis.err.jsonl');
  fs.rmSync(err, { force: true });
  execFileSync('node', [KAP], {
    input: JSON.stringify({ session_id: sid2, cwd: DROOT, reason: 'clear', transcript_path: path.join(DFX, 'tr.jsonl') }),
    encoding: 'utf8', env: { ...DENV, CLAUDE_CODE_SESSION_ID: sid2 },
  });
  const yeni = fs.readdirSync(path.join(DP('oturumlar'), 'devir')).filter((f) => /zincir-provasi/.test(f));
  assert(yeni.length === 1, 'zincir devir notu yazmadı: ' + fs.readdirSync(path.join(DP('oturumlar'), 'devir')).join(','));
  const j = JSON.parse(fs.readFileSync(path.join(DP('oturumlar'), 'devir', yeni[0]), 'utf8'));
  assert(lib.devirDogrula(j).gecerli, 'zincirin yazdığı not şema dışı');
  assert(j.session.id === sid2, 'zincir TAM id geçirmedi: ' + j.session.id);
  assert(j.kapanisSebebi === 'clear', 'reason → --sebep geçmedi: ' + j.kapanisSebebi);
  assert(j.acilisIstek, 'transcript_path → --transcript geçmedi');
  assert(j.kapanis, 'kapat devirden ÖNCE koşmadı (Bitiş boş): ' + j.kapanis);
  assert(!fs.existsSync(err), 'err.jsonl\'a satır düştü: ' + (fs.existsSync(err) ? fs.readFileSync(err, 'utf8') : ''));
});

for (const p of dprocs) { try { p.kill(); } catch { /* zaten öldü */ } }
fs.rmSync(DFX, { recursive: true, force: true });

// ── sonuç ────────────────────────────────────────────────────────────────────
fs.rmSync(FX, { recursive: true, force: true });
fs.rmSync(OFX, { recursive: true, force: true });
const fails = results.filter(([s]) => s === 'FAIL');
for (const [s, ad] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${ad}`);
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
process.exit(fails.length ? 1 : 0);
