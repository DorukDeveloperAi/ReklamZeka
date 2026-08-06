#!/usr/bin/env node
// proof.mjs — /planla-kos kanıt harness'ı. Gerçek koşu YAKMAZ:
// fixture plans/ ağacı geçici dizinde kurulur; dispatch chokepoint'i STUB zamanla ile,
// kuyruk döngüsü ise hiç ateşlenmeyen (+10m → cancel) tek job'la kanıtlanır.
// Kapının KIRMIZI yanabildiği de ölçülür (Ders 17: yeşil yanan kapı değil,
// kırmızı yanabilen kapı kanıttır).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
// CLAUDE_CONFIG_DIR-farkında: hazirla ↔ agac AYNI hesabın (aktif profil) kopyaları olmalı — 03
// kosum köprüsü hazirla→agac SÜRÜM tutarlılığına dayanır (stale agac kosum'u düşürür → sessiz klasik).
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const AGAC = path.join(CLAUDE, 'skills/plan-organizatoru/scripts/agac.mjs');
const HAZIRLA = path.join(CLAUDE, 'skills/planla-kos/scripts/hazirla.mjs');
// hazirla.mjs ile AYNI desen: env önce, sonra kit'in kurulumda çözdüğü kök.
const ZAMANLA = process.env.PLANLA_KOS_ZAMANLA || '/Users/ybg/dev/agent-ide/packages/maestro/bin/zamanla.mjs';
// Placeholder'ı kit motoru KURULUM sırasında çözer (kit.ts → replaceAll). Ham kaldıysa bu
// dosya kurulu kopyadan değil ŞABLONDAN koşuluyor demektir; sessiz ölü yol yerine söyle.
if (ZAMANLA.includes('{{')) {
  console.error('❌ proof: ZAMANLA yolu çözülmemiş — bu harness KURULU kopyadan koşulur.');
  console.error('   onar: node ~/.claude/skills/planla-kos/proof/proof.mjs');
  console.error('   ya da: PLANLA_KOS_ZAMANLA=<zamanla.mjs yolu> node <bu dosya>');
  process.exit(2);
}

const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'planla-kos-proof-'));
const V1 = path.join(FIX, 'plans/test-plan/v1');

const sonuc = [];
const check = (ad, ok, detay = '') => { sonuc.push({ ad, ok }); console.log(`${ok ? '✅' : '❌'} ${ad}${detay ? ` — ${detay}` : ''}`); };
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } });
const agac = (...a) => run('node', [AGAC, '--proje', FIX, ...a]);
const hazirla = (extra = [], env = {}) => run('node', [HAZIRLA, '--proje', FIX, '--slug', 'test-plan', ...extra], env);

// ---------- fixture ----------

const MASTER_OK = `# Test Planı — MASTER

> Kategori: süreç · Üst: — · Üretici: proof · Tarih: 2026-07-16 · Sürüm: v1

## Amaç ve başarı tanımı
BAŞARI = proof senaryoları için sahte plan.
`;
const STATE_ACIK = `# STATE

## Aşama durumları

| # | aşama | durum | son dokunuş | kanıt |
|---|---|---|---|---|
| 01 | kurulum | AÇIK | — | — |
| 02 | uygulama | AÇIK | — | — |

## Tur günlüğü (en yeni üstte)
`;
const STATE_KAPALI = STATE_ACIK.replace(/AÇIK/g, 'KAPALI');
const CHECKLIST = `# CHECKLIST\n\n## Aşama 01 — kurulum\n- [ ] **A01** SONUÇ: sahte\n`;

function resetFixture() {
  fs.rmSync(path.join(FIX, 'plans'), { recursive: true, force: true });
  fs.mkdirSync(V1, { recursive: true });
  fs.writeFileSync(path.join(V1, 'MASTER.md'), MASTER_OK);
  fs.writeFileSync(path.join(V1, 'STATE.md'), STATE_ACIK);
  fs.writeFileSync(path.join(V1, 'CHECKLIST.md'), CHECKLIST);
  fs.writeFileSync(path.join(V1, 'asama-01-kurulum.md'), '# Aşama 01 — kurulum\n\n## SONUÇ\nsahte\n');
  fs.writeFileSync(path.join(V1, 'asama-02-uygulama.md'), '# Aşama 02 — uygulama\n\n## SONUÇ\nsahte\n');
}

// ---------- 1. türet + gate PASS ----------

resetFixture();
let r = agac();
check('1a. INDEX türetildi', r.status === 0, (r.stdout || '').trim().split('\n')[0]);
r = agac('--gate');
check('1b. gate PASS (temiz fixture)', r.status === 0);

// ---------- 2. verbatim-tüketim + politika cümleleri ----------

const durumJson = JSON.parse(agac('--durum', '--json').stdout);
const kaynakGoal = durumJson.plans.find((p) => p.slug === 'test-plan').goal;
r = hazirla(['--kapsam', '1', '--otonomi', 'ates', '--json']);
let j = r.status === 0 ? JSON.parse(r.stdout) : null;
check('2a. hazirla exit 0 + hamGoal === agac goal (verbatim)', !!j && j.hamGoal === kaynakGoal);
check('2b. eklenmiş satır ham goal ile prefix-birebir başlar', !!j && j.satir.startsWith(kaynakGoal + '; '));
check('2c. kapsam=1 cümlesi eklendi', !!j && j.satir.includes('YALNIZ bu aşamayı koş'));
check('2d. otonomi=ates cümlesi eklendi', !!j && j.satir.includes('kullanıcıya soru sorma'));
check('2e. zamanla komutu monte edildi (--new-cwd + +5s)', !!j && j.cmdStr.includes('--new-cwd') && j.cmdStr.includes('+5s'));

r = hazirla(['--kapsam', 'hepsi', '--otonomi', 'kapi', '--json']);
j = r.status === 0 ? JSON.parse(r.stdout) : null;
check('2f. kapsam=hepsi sürdürme cümlesi agac.mjs\'e YENİDEN sorar', !!j && j.satir.includes('agac.mjs --durum') && j.satir.includes('KAPALI olana ya da BLOKE'));
check('2g. kapsam>1: TAMAMLANMA KOŞULU ilan edilir (erken-teslim dersi)', !!j && j.satir.includes('TAMAMLANMA KOŞULU') && j.satir.includes('TAMAMLAMAZ'));

// ---------- 3. nezaket cümlesi (claims-resources varsa) ----------

fs.mkdirSync(path.join(FIX, '.claude'), { recursive: true });
fs.writeFileSync(path.join(FIX, '.claude/claims-resources.json'), '{}');
r = hazirla(['--kapsam', '1', '--otonomi', 'sor', '--json']);
j = r.status === 0 ? JSON.parse(r.stdout) : null;
check('3. claims-resources varken /eszamanli nezaket cümlesi eklendi', !!j && j.satir.includes('/eszamanli claim protokolü'));

// ---------- 4. 4000ch kırpma sırası (test dikişi: PLANLA_KOS_LIMIT) ----------

const talimat = 'T'.repeat(200);
const tam = JSON.parse(hazirla(['--kapsam', '1', '--otonomi', 'sor', '--talimat', talimat, '--json']).stdout);
// limit'i tam satırın 10ch altına çek → önce nezaket düşmeli, kapsam/otonomi yaşamalı
r = hazirla(['--kapsam', '1', '--otonomi', 'sor', '--talimat', talimat, '--json'], { PLANLA_KOS_LIMIT: String(tam.chars - 10) });
j = r.status === 0 ? JSON.parse(r.stdout) : null;
check('4a. kırpma 1. sıra: nezaket düşer', !!j && j.kirpilan[0] === 'nezaket cümlesi' && !j.satir.includes('/eszamanli'));
check('4b. talimat + kapsam/otonomi hayatta', !!j && j.satir.includes('ana talimat') && j.satir.includes('YALNIZ bu aşamayı') && j.satir.includes('kullanıcı kararı'));
// daha da sık → talimat da kırpılır ama kapsam/otonomi asla
r = hazirla(['--kapsam', '1', '--otonomi', 'sor', '--talimat', talimat, '--json'], { PLANLA_KOS_LIMIT: String(tam.chars - 180) });
j = r.status === 0 ? JSON.parse(r.stdout) : null;
check('4c. kırpma 2. sıra: talimat kısalır, kapsam/otonomi hayatta, limit içinde',
  !!j && j.kirpilan.includes('talimat özeti') && j.satir.includes('YALNIZ bu aşamayı') && j.satir.includes('kullanıcı kararı') && j.chars <= tam.chars - 180);
r = hazirla(['--kapsam', '1', '--otonomi', 'sor', '--json'], { PLANLA_KOS_LIMIT: '100' });
check('4d. düşürülemez taşmada exit 5 + dur', r.status === 5);
fs.rmSync(path.join(FIX, '.claude'), { recursive: true, force: true });

// ---------- 5. bitti-dalı: tümü KAPALI → exit 3, dispatch yok ----------

fs.writeFileSync(path.join(V1, 'STATE.md'), STATE_KAPALI);
r = hazirla(['--kapsam', '1', '--otonomi', 'ates']);
check('5. tüm aşamalar KAPALI → exit 3 + revize önerisi', r.status === 3 && r.stderr.includes('koşacak iş yok') && r.stderr.includes('revize'));

// ---------- 6. governance-dalı: aşama açık ama dosya kayıp → exit 4 ----------

fs.writeFileSync(path.join(V1, 'STATE.md'), STATE_ACIK);
fs.rmSync(path.join(V1, 'asama-01-kurulum.md'));
r = hazirla(['--kapsam', '1', '--otonomi', 'ates']);
check('6. aşama açık + dosya kayıp → exit 4, dispatch YOK', r.status === 4 && r.stderr.includes('Dispatch YOK'));

// ---------- 7. gate KIRMIZI yanabilir (Ders 17) ----------

resetFixture(); agac(); // temiz + taze
fs.writeFileSync(path.join(V1, 'STATE.md'), STATE_ACIK.replace('| 02 | uygulama | AÇIK', '| 02 | uygulama | SÜRÜYOR'));
r = agac('--gate');
check('7a. STATE değişti + INDEX türetilmedi → gate FAIL (BAYAT)', r.status === 1 && (r.stderr + r.stdout).includes('BAYAT'));
agac();
r = agac('--gate');
check('7b. türetince gate PASS', r.status === 0);
fs.writeFileSync(path.join(V1, 'MASTER.md'), MASTER_OK.replace('Kategori: süreç · ', ''));
agac();
r = agac('--gate');
check('7c. Kategori silindi → governance FAIL (türetmek kurtarmaz)', r.status === 1 && (r.stderr + r.stdout).includes('KATEGORISIZ'));
resetFixture(); agac();

// ---------- 8. dispatch chokepoint (STUB zamanla — gerçek kuyruğa dokunmaz) ----------

const stub = path.join(FIX, 'stub-zamanla.mjs');
const kayit = path.join(FIX, 'stub-args.json');
fs.writeFileSync(stub, `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(kayit)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ ok: true, id: 'stub-job-1', trigger: { at: '+5s' } }));
`);
r = hazirla(['--kapsam', '2', '--otonomi', 'kapi', '--json', '--dispatch'], { PLANLA_KOS_ZAMANLA: stub });
j = r.status === 0 ? JSON.parse(r.stdout) : null;
const stubArgs = fs.existsSync(kayit) ? JSON.parse(fs.readFileSync(kayit, 'utf8')) : [];
check('8a. --dispatch stub\'ı doğru argümanlarla çağırdı',
  stubArgs[0] === 'add' && stubArgs[stubArgs.indexOf('--text') + 1] === j?.satir &&
  stubArgs[stubArgs.indexOf('--new-cwd') + 1] === FIX && stubArgs[stubArgs.indexOf('--at') + 1] === '+5s');
check('8b. dispatch sonucu (job id) rapora girdi', !!j?.dispatch && j.dispatch.includes('stub-job-1'));

// ---------- 9. gerçek kuyruk döngüsü (job doğar, HİÇ ateşlenmez, iptal edilir) ----------

r = run('bun', [ZAMANLA, 'add', '--text', 'echo planla-kos-proof', '--new-cwd', FIX, '--at', '+10m', '--title', 'planla-kos-proof']);
let jobId = null;
try { jobId = JSON.parse(r.stdout).id; } catch { /* aşağıda FAIL düşer */ }
check('9a. gerçek zamanla add → job doğdu (+10m, ateşlenmeden iptal edilecek)', !!jobId, jobId || (r.stderr || r.stdout).slice(0, 120));
const listOut = run('bun', [ZAMANLA, 'list']).stdout || '';
check('9b. job list\'te görünüyor', !!jobId && listOut.includes(jobId));
const cancelOut = jobId ? run('bun', [ZAMANLA, 'cancel', jobId]) : { stdout: '' };
check('9c. job iptal edildi (hiç ateşlenmedi)', (cancelOut.stdout || '').includes('iptal edildi'));

// ---------- 10. byte-uyum golden-argv (bayraksız argv = kanonik dizi; newCmd config-TÜRETİMLİ, sabitleme yok) ----------

resetFixture(); agac();
const goalNow = JSON.parse(agac('--durum', '--json').stdout).plans.find((p) => p.slug === 'test-plan').goal;

// newCmd, ZAMANLA'nın YANINDAKİ maestro config.json'dan claude_bin okur (hazirla.mjs:121). Stub'ı
// FIX kökünde bıraksak o config bulunamaz → newCmd null olur ve tier pin (R-06) HİÇ test edilemezdi.
// O yüzden stub'ı yanında geçerli bir config.json olan bir alt dizine koyarız → tier pin GERÇEKTEN akar.
const mbin = path.join(FIX, 'mbin');
fs.mkdirSync(mbin, { recursive: true });
const stub2 = path.join(mbin, 'stub-zamanla.mjs');
const kayit2 = path.join(FIX, 'stub2-args.json');
fs.writeFileSync(stub2, `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(kayit2)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ ok: true, id: 'stub-job-2' }));
`);
fs.writeFileSync(path.join(FIX, 'config.json'), JSON.stringify({ claude_bin: 'claude' })); // = path.dirname(stub2)/../config.json
// hazirla.mjs ile AYNI türetim, AYNI ZAMANLA yolundan (kanon/config değişirse birlikte değişir — sabitleme yok):
function beklenenNewCmd(zamanlaPath) {
  try {
    const aideCfg = JSON.parse(fs.readFileSync(path.join(HOME, '.config/agent-ide/config.json'), 'utf8'));
    const tiers = aideCfg.models?.tiers || aideCfg.tiers;
    const mc = JSON.parse(fs.readFileSync(path.join(path.dirname(zamanlaPath), '../config.json'), 'utf8'));
    const bin = mc.claude_bin || 'claude';
    return tiers?.ana?.model ? `${bin} --model '${tiers.ana.model}'` : null;
  } catch { return null; }
}
const nc = beklenenNewCmd(stub2);
// dispatch STUB'ıyla ARGV'yi yakala (gerçek kuyruğa dokunmaz).
const capture = (extra) => {
  fs.rmSync(kayit2, { force: true });
  const rr = hazirla([...extra, '--json', '--dispatch'], { PLANLA_KOS_ZAMANLA: stub2 });
  const jj = rr.status === 0 ? JSON.parse(rr.stdout) : null;
  const cargs = fs.existsSync(kayit2) ? JSON.parse(fs.readFileSync(kayit2, 'utf8')) : [];
  return { jj, cargs };
};

const cap10 = capture(['--kapsam', '1', '--otonomi', 'ates']);
const exp10 = ['add', '--text', cap10.jj?.satir, '--new-cwd', FIX, '--new-name', 'planla-kos-test-plan',
  ...(nc ? ['--new-cmd', nc] : []), '--at', '+5s', '--title', 'planla-kos: test-plan v1 asama-01', '--timeout', '14400'];
check('10. bayraksız argv kanonik diziyle byte-uyumlu (newCmd config-türetimli)',
  !!cap10.jj && JSON.stringify(cap10.cargs) === JSON.stringify(exp10), `${cap10.cargs.length} elem vs ${exp10.length}`);

// ---------- 11. rota pass-through (ek-metin sonda AYRAÇSIZ · hamGoal prefix · argv çiftleri · title öneki · tier akar) ----------

const cap11 = capture(['--kapsam', '1', '--otonomi', 'ates', '--ek-metin', '\n\nPROTO-11',
  '--grup', 'rota:test-plan', '--cap', '2', '--muhur', 'ROTA-KANIT abc11', '--on-fail', 'park', '--title-onek', 'rota:abc11:']);
const j11 = cap11.jj; const a11 = cap11.cargs;
// ek-siz AYNI çağrı → ek-metin AYRAÇSIZ mutlak son olduğunun kesin kanıtı (R-02):
const j11b = JSON.parse(hazirla(['--kapsam', '1', '--otonomi', 'ates',
  '--grup', 'rota:test-plan', '--cap', '2', '--muhur', 'ROTA-KANIT abc11', '--on-fail', 'park', '--title-onek', 'rota:abc11:', '--json']).stdout);
check('11a. ek-metin AYRAÇSIZ mutlak son (satir === ek-siz-satir + ekMetin)', !!j11 && j11.satir === j11b.satir + '\n\nPROTO-11');
check('11b. hamGoal prefix korunur (goal verbatim taşındı)', !!j11 && j11.satir.startsWith(goalNow));
const pair = (f, v) => { const i = a11.indexOf(f); return i >= 0 && a11[i + 1] === v; };
check('11c. argv çiftleri --group/--cap/--muhur/--on-fail zamanla\'ya geçti',
  pair('--group', 'rota:test-plan') && pair('--cap', '2') && pair('--muhur', 'ROTA-KANIT abc11') && pair('--on-fail', 'park'));
check('11d. title öneki başa (rota dedupe anahtarı title.includes rota:<fp>:)', !!j11 && j11.title.startsWith('rota:abc11:planla-kos:'));
check('11e. tier pin rota yolunda da akar (--new-cmd, R-06)', a11.includes('--new-cmd') === (nc !== null));

// ---------- 12. ek-metin kırpılmazlığı (nezaket→talimat düşer, ek-metin biter-pozisyonda; sıkışınca exit 5) ----------

fs.mkdirSync(path.join(FIX, '.claude'), { recursive: true });
fs.writeFileSync(path.join(FIX, '.claude/claims-resources.json'), '{}');
const ek12 = '\n\nEK-KORUNMUS';
const tal12 = 'T'.repeat(200);
const tam12 = JSON.parse(hazirla(['--kapsam', '1', '--otonomi', 'sor', '--talimat', tal12, '--ek-metin', ek12, '--json']).stdout);
r = hazirla(['--kapsam', '1', '--otonomi', 'sor', '--talimat', tal12, '--ek-metin', ek12, '--json'], { PLANLA_KOS_LIMIT: String(tam12.chars - 180) });
j = r.status === 0 ? JSON.parse(r.stdout) : null;
check('12a. sıkışınca ek-metin biter-pozisyonda korunur, nezaket düşer', !!j && j.satir.endsWith(ek12) && !j.satir.includes('/eszamanli'));
check('12b. kapsam/otonomi hayatta + limit içinde', !!j && j.satir.includes('YALNIZ bu aşamayı') && j.satir.includes('kullanıcı kararı') && j.chars <= tam12.chars - 180);
r = hazirla(['--kapsam', '1', '--otonomi', 'sor', '--ek-metin', ek12, '--json'], { PLANLA_KOS_LIMIT: '100' });
check('12c. düşürülemez taşmada exit 5 + mesajda ek-metin uzunluğu', r.status === 5 && r.stderr.includes('ek-metin'));
fs.rmSync(path.join(FIX, '.claude'), { recursive: true, force: true });

// ---------- 13. manual + rota kapıları (--at yok · cap-grupsuz exit 2 · mühür-tek exit 2 · cap-tamsayı exit 2) ----------

j = JSON.parse(hazirla(['--kapsam', '1', '--otonomi', 'ates', '--manual', '--json']).stdout);
check('13a. --manual → cmdStr\'de --at YOK + .manual true', !j.cmdStr.includes('--at') && j.manual === true);
check('13b. --cap grupsuz → exit 2', hazirla(['--kapsam', '1', '--otonomi', 'ates', '--cap', '2', '--json']).status === 2);
check('13c. --muhur tek kelime → exit 2 (zamanla:118-121 aynası)', hazirla(['--kapsam', '1', '--otonomi', 'ates', '--muhur', 'tek', '--json']).status === 2);
check('13d. --cap pozitif tamsayı değil → exit 2', hazirla(['--kapsam', '1', '--otonomi', 'ates', '--grup', 'g', '--cap', 'x', '--json']).status === 2);

// ---------- 14. gerçek manual iş: doğar → list'te trigger.manual:true + tetiksiz → cancel (run-now BASILMAZ) ----------
// KOD KANONİK: BENIGN manual iş kırmızı-action DEĞİL → approval.mjs onu onay[] kovasına KOYMAZ
// (ampirik: benign manual `zamanla list`'te görünür, onay-list'te değil). run-now'a dek ateşlenmez.

r = hazirla(['--kapsam', '1', '--otonomi', 'ates', '--manual', '--grup', 'rota:smoke', '--muhur', 'ROTA-KANIT smoke1', '--title-onek', 'rota:smoke:', '--json', '--dispatch']);
j = r.status === 0 ? JSON.parse(r.stdout) : null;
let mid = null; try { mid = JSON.parse(j.dispatch).id; } catch { /* aşağıda FAIL düşer */ }
check('14a. gerçek --manual --dispatch → iş doğdu', !!mid, mid || (r.stderr || '').slice(0, 120));
const row14 = mid ? JSON.parse(run('bun', [ZAMANLA, 'list']).stdout || '[]').find((x) => x.id === mid) : null;
check('14b. list\'te trigger.manual:true + tetiksiz (pending, runs 0)',
  !!row14 && row14.trigger?.manual === true && row14.state === 'pending' && row14.runs === 0);
const onay14 = mid ? (run('bun', [ZAMANLA, 'onay-list', '--json']).stdout || '') : '';
check('14c. benign manual onay[] kovasında DEĞİL (kırmızı değil → run-now daveti yok)', !!mid && !onay14.includes(mid));
const cancel14 = mid ? run('bun', [ZAMANLA, 'cancel', mid]) : { stdout: '' };
check('14d. iş cancel edildi (run-now BASILMADI)', (cancel14.stdout || '').includes('iptal edildi'));

// ---------- 15. idempotens (aynı bayraklarla 2 kuru koşum satir + cmdStr birebir) ----------

const i1 = JSON.parse(hazirla(['--kapsam', '2', '--otonomi', 'kapi', '--ek-metin', '\n\nX', '--grup', 'g', '--cap', '3', '--json']).stdout);
const i2 = JSON.parse(hazirla(['--kapsam', '2', '--otonomi', 'kapi', '--ek-metin', '\n\nX', '--grup', 'g', '--cap', '3', '--json']).stdout);
check('15. idempotens: 2 kuru koşum satir + cmdStr birebir', i1.satir === i2.satir && i1.cmdStr === i2.cmdStr);

// ---------- G1/G2. 02 geri-beslemesi (--asama hazir-dışı exit 4 · --ham-metin /goal reddi exit 2 + ham yol) ----------

resetFixture(); agac();
check('G1a. --asama hazir-DIŞI (99) → exit 4 (bayat-karar koruması)',
  hazirla(['--kapsam', '1', '--otonomi', 'ates', '--asama', '99', '--json']).status === 4);
const hazirNo = JSON.parse(agac('--durum', '--json').stdout).plans.find((p) => p.slug === 'test-plan').hazir?.[0]?.no;
if (hazirNo) {
  j = JSON.parse(hazirla(['--kapsam', '1', '--otonomi', 'ates', '--asama', hazirNo, '--json']).stdout);
  check('G1b. --asama <hazir> → goal hazir[]\'den verbatim + session -a<NN>',
    j.hamGoal.startsWith('/goal') && j.newName === `planla-kos-test-plan-a${String(hazirNo).padStart(2, '0')}`);
} else {
  check('G1b. --asama <hazir> (fixture hazir[] boş — ölçülemedi)', false, 'hazir[] boş');
}
check('G2a. --ham-metin "/goal x" → exit 2 (goal tek-kaynak kilidi)',
  hazirla(['--ham-metin', '/goal x', '--json']).status === 2);
j = JSON.parse(hazirla(['--ham-metin', 'HAM GÖREV METNİ', '--ek-metin', '\n\nEKX', '--json']).stdout);
check('G2b. --ham-metin: agac tüketilmez, kapsam/otonomi cümlesi yok, satir=ham+ek, session -ham',
  j.satir === 'HAM GÖREV METNİ\n\nEKX' && !j.satir.includes('YALNIZ bu aşamayı') && j.newName === 'test-plan-ham');

// ---------- 16. kosum: workflow köprüsü (03) — WORKFLOW-PROTOKOL + newCmd 00-kalıbı + klasik BYTE-AYNI ----------
// Not: agac.mjs KOSUM PARSER'ı (01) gerekli — CLAUDE aktif profilin agac'ı kullanılır (üstte CLAUDE_CONFIG_DIR-farkında).
// Workflow aşaması frontmatter'la beyan edilir; hazirla kosum'u agac hazir[]'inden OKUR (kendi parse etmez, D1-A).

const WV1 = path.join(FIX, 'plans/wf-plan/v1');
function wfFixture(stage01Kosum) {
  fs.rmSync(path.join(FIX, 'plans/wf-plan'), { recursive: true, force: true });
  fs.mkdirSync(WV1, { recursive: true });
  fs.writeFileSync(path.join(WV1, 'MASTER.md'), MASTER_OK);
  fs.writeFileSync(path.join(WV1, 'STATE.md'), STATE_ACIK);
  fs.writeFileSync(path.join(WV1, 'CHECKLIST.md'), CHECKLIST);
  // Aşama 01: kosum verildiyse frontmatter'lı; Aşama 02: her zaman KLASİK (frontmatter'sız).
  const fm01 = stage01Kosum ? `---\nkosum: ${stage01Kosum}\n---\n` : '';
  fs.writeFileSync(path.join(WV1, 'asama-01-kurulum.md'), `${fm01}# Aşama 01 — kurulum\n\n## SONUÇ\nsahte\n`);
  fs.writeFileSync(path.join(WV1, 'asama-02-uygulama.md'), '# Aşama 02 — uygulama\n\n## SONUÇ\nsahte\n');
  run('node', [AGAC, '--proje', FIX]); // INDEX türet
}
const wfHazirla = (extra = [], env = {}) => run('node', [HAZIRLA, '--proje', FIX, '--slug', 'wf-plan', ...extra], env);

// 16a. agac hazir[0] kosum:workflow taşıyor mu (01 köprü ön-koşulu)?
wfFixture('workflow:uygula-dogrula');
const wfHazir = JSON.parse(agac('--durum', '--json').stdout).plans.find((p) => p.slug === 'wf-plan').hazir?.[0];
check('16a. agac hazir[0].kosum = {tur:workflow,sablon} (01 köprü girdisi)',
  !!wfHazir?.kosum && wfHazir.kosum.tur === 'workflow' && wfHazir.kosum.sablon === 'uygula-dogrula',
  JSON.stringify(wfHazir?.kosum));

// 16b. NORMAL yol (siradaki=01 workflow): WORKFLOW-PROTOKOL satırda + rapor.workflow + öncelik/yasak satırı
let wj = JSON.parse(wfHazirla(['--kapsam', '1', '--otonomi', 'ates', '--json']).stdout);
check('16b. normal yolda WORKFLOW-PROTOKOL bloğu satırda (kosum siradaki.no eşleşmesinden okundu)',
  wj.satir.includes('--- WORKFLOW KOŞUMU (kosum: workflow:uygula-dogrula) ---') &&
  wj.satir.includes('sablonlar/uygula-dogrula.mjs') &&
  wj.satir.includes('dogrula.mjs <script> exit 0 olmadan KOŞMA') &&
  wj.satir.includes('fan-out YALNIZ workflow script') && wj.satir.includes('aide rota kanit --sinif hizli'));
check('16c. rapor.workflow alanı (R-05 — yeni bilgi yeni alanda)',
  wj.workflow?.kosum === 'workflow' && wj.workflow?.sablon === 'uygula-dogrula' && wj.workflow?.wflowProtokolChars > 0);
check('16d. chokepoint korunur: cmdStr `aide zamanla add` ile başlar (doğrudan spawn YOK)', wj.cmdStr.startsWith('aide zamanla add '));

// 16e. --asama yolu da workflow taşır (h.kosum)
const wfNo = wfHazir.no;
let waj = JSON.parse(wfHazirla(['--kapsam', '1', '--otonomi', 'ates', '--asama', wfNo, '--json']).stdout);
check('16e. --asama yolunda da WORKFLOW-PROTOKOL bloğu (h.kosum)',
  waj.satir.includes('--- WORKFLOW KOŞUMU (kosum: workflow:uygula-dogrula) ---'));

// 16f. newCmd 00-KALIBI: workflow --new-cmd == klasik --new-cmd (00 Not-1: ayrı komut YOK, köprü metinde).
//      Klasik aşama için 01'i KAPAT → 02 (klasik) siradaki olur.
const wfNewCmd = wj.cmdStr.match(/--new-cmd (\S+|'[^']*')/)?.[1] || null;
fs.writeFileSync(path.join(WV1, 'STATE.md'), STATE_ACIK.replace('| 01 | kurulum | AÇIK', '| 01 | kurulum | KAPALI'));
run('node', [AGAC, '--proje', FIX]);
const cj = JSON.parse(wfHazirla(['--kapsam', '1', '--otonomi', 'ates', '--json']).stdout);
const clNewCmd = cj.cmdStr.match(/--new-cmd (\S+|'[^']*')/)?.[1] || null;
check('16f. workflow --new-cmd == klasik --new-cmd (00 kalıbı birebir; ayrı workflow komutu YOK)', wfNewCmd === clNewCmd);
check('16g. klasik (02) aşamada WORKFLOW bloğu YOK + workflow alanı YOK (kosum beyansız → BYTE-AYNI sınıf)',
  !cj.satir.includes('--- WORKFLOW KOŞUMU') && cj.workflow === undefined);

// 16h. rota yolu: --ek-metin + workflow → satır SONU HÂLÂ ek-metin (R-02), WORKFLOW bloğu ondan ÖNCE
wfFixture('workflow:uygula-dogrula');
const wek = '\n\n--- ROTACI PROTOKOLÜ (test) ---\nSEN TEK AŞAMA.';
const rj = JSON.parse(wfHazirla(['--kapsam', '1', '--otonomi', 'ates', '--ek-metin', wek, '--json']).stdout);
check('16h. workflow + ek-metin: satir.endsWith(ekMetin) (R-02) VE WORKFLOW bloğu ondan önce',
  rj.satir.endsWith(wek) && rj.satir.indexOf('--- WORKFLOW KOŞUMU') < rj.satir.indexOf('--- ROTACI PROTOKOLÜ (test) ---'));

// 16i. idempotens: aynı bayraklarla 2 kuru koşum satir + cmdStr birebir
const wi1 = JSON.parse(wfHazirla(['--kapsam', '1', '--otonomi', 'ates', '--json']).stdout);
const wi2 = JSON.parse(wfHazirla(['--kapsam', '1', '--otonomi', 'ates', '--json']).stdout);
check('16i. workflow idempotens (2 kuru koşum satir + cmdStr birebir)', wi1.satir === wi2.satir && wi1.cmdStr === wi2.cmdStr);

// 16j. exit-2 GUARD (fail-closed): STUB agac bozuk kosum.tur emit eder → hazirla exit 2 + alan adı.
//      Gerçek agac gecersiz'i gate'te düşürür (01) → hazir[]'e ulaşmaz; bu guard bozuk hazir[] JSON'una karşıdır.
const badAgac = path.join(FIX, 'agac-bad-kosum.mjs');
fs.writeFileSync(badAgac, `console.log(JSON.stringify({ damga:'x', plans:[{ slug:'wf-plan', v:1, durum:'AÇIK', asamaToplam:1, asamaKapali:0,
  siradaki:{no:'01',ad:'x'}, goal:'/goal x',
  hazir:[{ no:'01', ad:'x', goal:'/goal x', kosum:{ tur:'sacma-deger' } }] }] }));\n`);
const g2 = wfHazirla(['--kapsam', '1', '--otonomi', 'ates', '--asama', '01', '--json'], { PLANLA_KOS_AGAC: badAgac });
check('16j. tanınmayan kosum.tur → exit 2 + mesajda "kosum.tur" (sessiz düşme YASAK)',
  g2.status === 2 && /kosum\.tur/.test(g2.stderr || ''));
// 16k. workflow kosum ama sablon-ref geçersiz → exit 2
const badAgac2 = path.join(FIX, 'agac-bad-sablon.mjs');
fs.writeFileSync(badAgac2, `console.log(JSON.stringify({ damga:'x', plans:[{ slug:'wf-plan', v:1, durum:'AÇIK', asamaToplam:1, asamaKapali:0,
  siradaki:{no:'01',ad:'x'}, goal:'/goal x',
  hazir:[{ no:'01', ad:'x', goal:'/goal x', kosum:{ tur:'workflow', sablon:'Bad Ref!' } }] }] }));\n`);
const g3 = wfHazirla(['--kapsam', '1', '--otonomi', 'ates', '--asama', '01', '--json'], { PLANLA_KOS_AGAC: badAgac2 });
check('16k. workflow kosum + geçersiz sablon-ref → exit 2 + mesajda "sablon-ref"',
  g3.status === 2 && /sablon-ref/.test(g3.stderr || ''));

fs.rmSync(path.join(FIX, 'plans/wf-plan'), { recursive: true, force: true });

// ---------- sonuç ----------

fs.rmSync(FIX, { recursive: true, force: true });
const fail = sonuc.filter((s) => !s.ok);
console.log(`\n${sonuc.length - fail.length}/${sonuc.length} PASS${fail.length ? ` — FAIL: ${fail.map((f) => f.ad).join(' · ')}` : ' 🏆'}`);
process.exit(fail.length ? 1 : 0);
