#!/usr/bin/env node
// oturum.mjs — OTURUM (session) katmanı: "bu oturumda koyduğum hedefleri ve planları bitirdim mi?"
//
// SINIF: motor · deterministik · 0 token. LLM DOĞURMAZ · tmux GEREKTİRMEZ · **aide GEREKTİRMEZ**.
// Kullanıcı kararı (2026-07-27): bu sistemin tabanı OTURUMUN KENDİ TALİMATIDIR — `aide sistem`
// kapalıyken de dönmek zorundadır. O yüzden buradaki hiçbir yol Maestro'ya/daemon'a/pane'e
// bağlanmaz; yalnız node + dosya sistemi. "aide katmanı eksikleri tamamlar veya kaliteyi artırır":
// aide açıkken pano/rozet/bekçi bu çıktıyı TÜKETİR, ama üretimi ona bağlı DEĞİLDİR.
//
// Kullanım:
//   node oturum.mjs tohumla [--ad <slug>] [--hedef "<cümle>"]   oturum dosyasını aç/tazele (ELLE kaynak)
//   node oturum.mjs durum [--json]                              proje roll-up'ı → plans/OTURUMLAR.md (TÜREV)
//   node oturum.mjs bu [--ref ot:…]                             BU oturumun hükmü; EKSİK/SÜRÜYOR → exit 1
//   node oturum.mjs kapat [--ref ot:…]                          dosyayı KAPALI damgala (kapanış)
//   node oturum.mjs devir [--transcript <yol>] [--sebep <s>]    DEVİR NOTU yaz (niyet + sarkık iş + kilitler)
//   node oturum.mjs acilis [--ctx|--json]                       AÇILIŞ ÖZETİ: devralınacak iş (≤12 satır; sinyalsiz BOŞ)
//   node oturum.mjs global [--json]                             projeler-arası SIRALI kılavuz
//   node oturum.mjs gate                                        çift dikiş kapısı; ihlalde exit 1
//   node oturum.mjs backfill [--uygula]                         beyansız LEGACY planları tarih kovasına bağla
//   (her komut `--proje <yol>` alır; varsayılan cwd)
//
// ÇİFT DİKİŞ — neden iki yön birlikte: plan kaynak oturumunu ELLE beyan eder (`> Oturum: ot:…`),
// oturum kendi hedeflerini ELLE beyan eder (`## Hedefler`), ama İKİSİNİN KESİŞİMİ (hüküm) TÜREVDİR.
// Tek yön yeterli olsaydı stale kalırdı: plan kapanır oturum hedefi açık kalır (ya da tersi) ve
// kimse fark etmezdi. Roll-up beyanı gerçekle YAN YANA basar — "double check" tam olarak budur.
//
// OTOMATİK ALGI: oturum kendi hedeflerini yazmayı UNUTABİLİR. `tohumla` bu yüzden kaptan
// nabzından (TodoWrite hook → ~/.claude/kaptan/goals/<proje>/<session>.json) tohum atar.
// SINIR (ilan): kaptan defteri hesaba bağlı DURUM'dur → yalnız TOHUM kaynağıdır, hükmün girdisi
// DEĞİL. Hüküm yalnız git-izli kanondan (plans/) hesaplanır; başka hesapta/makinede aynı çıkar.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  OT_RE, oturumlarDir, refDosyaAdi, parseOturumMd, oturumTablosu, oturumlariOku,
  oturumSablonu, hukumRozet, HUKUMLER,
  DEVIR_SURUM, devirDosyaYolu, devirDogrula, devirOku, devirNotuBul, devamOnerisiYolu,
} from './oturum-lib.mjs';

const argv = process.argv.slice(2);
const cmd = (argv[0] || '').replace(/^--/, '') || 'durum';
const flag = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const ROOT = path.resolve(opt('--proje') || process.cwd());
const PLANS = path.join(ROOT, 'plans');
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// GLOBAL KILAVUZ — TÜREV (bilgi-sinif.ts: `oturum` → turev). Projelerin git-izli kanonundan
// yeniden üretilir; hesap değişince kaybı önemsizdir çünkü kaynak projelerde durur.
const GLOBAL_DIR = path.join(CLAUDE, 'oturum');
const SESSION_ID = opt('--session') || process.env.CLAUDE_CODE_SESSION_ID || null;
const AGAC = path.join(path.dirname(new URL(import.meta.url).pathname), 'agac.mjs');

const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
/** TÜREV çıktılar ATOMİK yazılır (tmp + rename). Gerekçe: birden çok oturum aynı anda kapanabilir
 *  (SessionEnd hook'u) ve hepsi AYNI türevi yazar. İçerik aynı kaynaklardan geldiği için sonuç
 *  yakınsar — ama yarılmış bir dosya okuyucuyu yanıltır. Kilit gerekmez, atomiklik yeter. */
const atomikYaz = (f, icerik) => {
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, icerik);
  fs.renameSync(tmp, f);
};
const slugla = (s) => String(s || '').toLowerCase()
  .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ü/g, 'u')
  .replace(/ö/g, 'o').replace(/ç/g, 'c')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'oturum';
/** Nabız başlığı ham kullanıcı mesajıdır (`/goal …` + paragraf olabilir). Başlık ONDAN türetilir:
 *  slash komutu düşer, ilk cümleye kırpılır. Kırpma İLAN edilir (`…`) — sessiz kırpma yasak. */
function temizBaslik(s) {
  let t = String(s || '').replace(/^\/\S+\s*/, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const nokta = t.search(/[.;\n]/);
  if (nokta > 15) t = t.slice(0, nokta);
  return t.length > 72 ? `${t.slice(0, 71).trimEnd()}…` : t;
}
const bugun = () => new Date().toISOString().slice(0, 10);
const simdi = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const kisaId = (id) => String(id || '').slice(0, 8) || null;

/** Plan modelini agac.mjs'ten AL — plan dosyalarını bu script OKUMAZ (tek okuyucu agac.mjs;
 *  Ders 4). agac yoksa/çökerse plan tarafı BOŞ döner ve bu İLAN edilir; uydurma yasak. */
function planlariAl(root) {
  try {
    const out = execFileSync(process.execPath, [AGAC, '--proje', root, '--durum', '--json'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const j = JSON.parse(out);
    return {
      ok: true,
      plans: (j.plans || []).map((p) => ({
        slug: p.slug, v: p.v, durum: p.durum, oturum: p.kunye?.oturum ?? null,
        oncelik: p.kunye?.oncelik ?? null, puan: p.kunye?.puan ?? null, hedef: p.kunye?.hedef ?? null,
      })),
    };
  } catch {
    return { ok: false, plans: [] };
  }
}

// ---------- tohumla: oturumun kendi dosyası (ELLE kaynak) ----------

/** Kaptan nabzından (TodoWrite) bu oturumun todo'larını oku — TOHUM kaynağı, hüküm girdisi değil.
 *
 *  `maddeler` NORMALLEŞTİRİLMİŞ görünümdür (`{metin, durum}`): `tohumla` yalnız "kapalı mı"
 *  ayrımına bakar, `devir` ise `in_progress`i AYRI görmek zorundadır ("şu an ne yapılıyordu"
 *  sorusunun tek deterministik cevabı odur). Ham `todos` alanı dokunulmadan korunur —
 *  iki tüketici tek okuyucudan beslenir (Ders 4).
 *
 *  ÇOK-SLUG TARAMASI (K#4, 2026-08-03) — nabız anahtarı bölünmesinin okuyan ucu.
 *  YAZAN uç (`goal-tracker.mjs`) kovayı `payload.cwd`den türetir; OKUYAN uç burada proje
 *  ROOT'undan türetiyordu. Bir oturum alt dizinden koştuğunda (ör. cwd
 *  `<proje>/packages/core`) nabız AYRI bir kovaya düşüyor ve buradan HİÇ görünmüyordu —
 *  ölçüldü: `~/.claude/kaptan/goals/` altında `-Users-ybg--claude-skills-plan-organizatoru-scripts`
 *  gibi yetim kovalar. Sonuç: tohumlanmayan hedefler ve kapatılamayan "hayalet" maddeler.
 *
 *  Çare yazan ucu değiştirmek DEĞİL (hook seviye-0 yüzeyidir; kayıt ister, geçmişi de
 *  taşımak gerekirdi) — okuyan ucu yazanın ZATEN uyguladığı ölçüte hizalamak: goal-tracker
 *  todo modunda dosyayı tüm slug dizinlerinde arar ve `payload.cwd` slug'ını tercih eder.
 *  Burada aynısı yapılır. ROOT slug'ı ÖNCE denenir — çakışma olursa proje kovası kazanır. */
function nabizTodolar(root, sessionId) {
  const bos = { todos: [], maddeler: [], baslik: null, baslangic: null };
  if (!sessionId) return bos;
  const kok = path.join(CLAUDE, 'kaptan', 'goals');
  const tercih = String(root).replace(/[^A-Za-z0-9]/g, '-');
  let adaylar;
  try {
    adaylar = [tercih, ...fs.readdirSync(kok).filter((d) => d !== tercih && d !== '_archive')];
  } catch {
    adaylar = [tercih];
  }
  const f = adaylar
    .map((d) => path.join(kok, d, `${sessionId}.json`))
    .find((p) => fs.existsSync(p));
  if (!f) return bos;
  try {
    const j = JSON.parse(readIf(f) || '');
    const todos = (j.todos || []).filter((t) => !t.removed);
    return {
      todos,
      maddeler: todos.map((t) => ({ metin: String(t.content ?? '').trim(), durum: t.status ?? null })),
      baslik: j.title || null, baslangic: j.startedAt || null,
    };
  } catch { return bos; }
}

/** BU SESSION'ın zaten açık defteri var mı? (`Session:` kısa id eşleşmesi — `bu`/`kapat`/`devir`
 *  ile AYNI ölçüt.) B05-1 ONARIMI (aşama-05'in aşama-06'ya devrettiği bulgu): `tohumla` kimliği
 *  ÇIPADAN (tarih ⊕ ad) ölçüyordu, oysa hook eşiği ve zincirin geri kalanı SESSION'dan ölçüyor.
 *  ÇIPLAK `tohumla` (SessionEnd zincirinin yaptığı) bu yüzden `--baslik` ile açılmış bir defterin
 *  yanına adı nabızdan türetilmiş İKİNCİ defter doğuruyordu — ve `kapat` alfabetik olarak önce
 *  geleni damgalayıp asıl defteri AÇIK bırakabiliyordu. Açık beyan (`--ad`/`--baslik`) her zaman
 *  KAZANIR; çözüm yalnız çıplak çağrıya uygulanır. */
function buSessionDefteri() {
  if (!SESSION_ID) return null;
  const kisa = kisaId(SESSION_ID);
  for (const o of oturumlariOku(PLANS))
    if (o.session && kisa.startsWith(String(o.session))) return o.ref;
  return null;
}

function tohumla() {
  const nabiz = nabizTodolar(ROOT, SESSION_ID);
  const baslik = opt('--baslik') || temizBaslik(nabiz.baslik);
  const acikBeyan = !!(opt('--ad') || opt('--baslik'));
  const ad = opt('--ad') || slugla(baslik);
  const ref = (!acikBeyan && buSessionDefteri()) || `ot:${bugun()}/${ad}`;
  if (!OT_RE.test(ref)) { console.error(`GEÇERSİZ ÇIPA: ${ref} — --ad <slug> ver (a-z0-9-)`); process.exit(1); }
  const dir = oturumlarDir(PLANS);
  fs.mkdirSync(dir, { recursive: true });
  const dosya = path.join(dir, refDosyaAdi(ref));
  const varOlan = readIf(dosya);

  // Nabız todo'ları → hedef maddeleri. MONOTON birleştirme: eksik madde EKLENİR, tamamlanan
  // madde İŞARETLENİR, ama hiçbir madde SİLİNMEZ ve İŞARETİ KALDIRILMAZ — dosya oturumun kendi
  // beyanıdır; nabız onu zenginleştirir, EZMEZ (filing `donan` sözleşmesinin aynısı).
  const nabizMaddeler = nabiz.todos.map((t) => ({ metin: String(t.content).trim(), kapali: t.status === 'completed' }));
  if (!varOlan) {
    const icerik = oturumSablonu({
      ref, baslik: baslik || ad, session: kisaId(SESSION_ID), proje: path.basename(ROOT),
      baslangic: nabiz.baslangic || simdi(), hedef: opt('--hedef') || null, hedefler: nabizMaddeler,
    });
    fs.writeFileSync(dosya, icerik);
    console.log(`OTURUM AÇILDI: ${ref}\n  dosya: ${path.relative(process.cwd(), dosya)}`);
    console.log(`  hedef tohumu: ${nabizMaddeler.length} madde (kaptan nabzı${SESSION_ID ? ` · session ${kisaId(SESSION_ID)}` : ' · session YOK — ölçülemedi'})`);
    if (!opt('--hedef')) console.log(`  ✋ SENDEN: "> Hedef:" satırını tek cümleyle doldur (şu an placeholder)`);
    return;
  }

  const o = parseOturumMd(varOlan, { dosya });
  const mevcut = new Map(o.hedefler.map((h) => [h.metin, h]));
  let eklendi = 0, isaretlendi = 0;
  let yeni = varOlan;
  for (const m of nabizMaddeler) {
    const v = mevcut.get(m.metin);
    if (!v) {
      // `## Hedefler` bölümünün SONUNA ekle (bölüm sonu = sonraki `##` ya da dosya sonu).
      const re = /(^##\s*Hedefler\s*$[\s\S]*?)(?=^##\s|\s*$(?![\s\S]))/m;
      if (re.test(yeni)) { yeni = yeni.replace(re, (blk) => `${blk.replace(/\s*$/, '')}\n- [${m.kapali ? 'x' : ' '}] ${m.metin}\n`); eklendi++; }
      continue;
    }
    if (m.kapali && !v.kapali) {
      const esc = m.metin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^(\\s*[-*]\\s*)\\[ \\](\\s*${esc})`, 'm');
      if (re.test(yeni)) { yeni = yeni.replace(re, '$1[x]$2'); isaretlendi++; }
    }
  }
  if (yeni !== varOlan) fs.writeFileSync(dosya, yeni);
  console.log(`OTURUM TAZELENDİ: ${ref} · +${eklendi} yeni hedef · ${isaretlendi} işaretlendi`);
  if (yeni === varOlan) console.log('  (nabız ile dosya aynı — hiçbir şey yazılmadı)');
}

// ---------- roll-up (TÜREV) ----------

function tabloAl(root = ROOT) {
  const plansDir = path.join(root, 'plans');
  const pm = planlariAl(root);
  const t = oturumTablosu(plansDir, pm.plans);
  // DEVİR İLANI (K8): notun VARLIĞI roll-up'ta GÖRÜNÜR — üst katman (kaptan/PM) onu aramak
  // zorunda kalmasın. KAPSAM SINIRI (yazılı): 05 yalnız İLAN eder; notu MODELE almak,
  // içeriğinden karar üretmek 06+ işidir.
  for (const o of t.oturumlar) {
    const j = devirOku(plansDir, o.ref);
    o.devir = j ? { yol: path.relative(root, devirDosyaYolu(plansDir, o.ref)), siradakiAdim: j.siradakiAdim ?? null } : null;
  }
  return { ...t, planOk: pm.ok, root };
}

function renderOturumlarMd(t) {
  const L = [];
  L.push('# OTURUMLAR — oturum × plan çift dikişi (TÜREV — ELLE YAZILMAZ)');
  L.push('');
  L.push('> Tek yazar: `oturum.mjs durum`. Kaynaklar: `plans/oturumlar/*.md` (oturumun ELLE beyanı)');
  L.push('> × plan künyelerindeki `> Oturum:` alanı (planın ELLE beyanı). Sınıf: motor · deterministik · 0 token.');
  L.push(`> Hüküm sayımı: ${HUKUMLER.map((h) => `${h} ${t.sayim[h]}`).join(' · ')}`);
  if (!t.planOk) L.push('> ⚠ plan tarafı ÖLÇÜLEMEDİ (agac.mjs çalışmadı) — plan sütunları boş, hüküm eksik okunmalı.');
  L.push('');
  if (!t.oturumlar.length) {
    L.push('_Henüz oturum dosyası yok. Aç: `node oturum.mjs tohumla`_');
    L.push('');
  }
  for (const o of t.oturumlar) {
    L.push(`## ${hukumRozet[o.hukum]} ${o.ref} — ${o.hukum}`);
    L.push('');
    L.push(`- **${o.baslik || '—'}** · session \`${o.session || '—'}\` · ${o.durum} · başlangıç ${o.baslangic || '—'}${o.bitis ? ` · bitiş ${o.bitis}` : ''}`);
    if (o.hedef) L.push(`- Hedef: ${o.hedef}`);
    L.push(`- Hedefler: ${o.hedefKapali}/${o.hedefler.length} kapalı${o.hedefAcik.length ? ` · **açık ${o.hedefAcik.length}**` : ''}`);
    if (o.devir) L.push(`- devir: \`${o.devir.yol}\` · sıradaki: ${o.devir.siradakiAdim || '—'}`);
    if (o.planlar.length) {
      L.push(`- Planlar (${o.planlar.length}): ${o.planlar.map((p) => `${p.slug} v${p.v} \`${p.durum}\``).join(' · ')}`);
    } else L.push('- Planlar: — (bu oturum plan üretmedi ya da planlar `> Oturum:` beyanı taşımıyor)');
    for (const h of o.hedefAcik) L.push(`  - [ ] ${h.metin}${h.terfi.length ? ` → ${h.terfi.join(', ')}` : ' _(terfisiz — yalnız bu oturumda yaşıyor)_'}`);
    if (o.hukum === 'EKSİK') L.push(`  - onar: hedefi kapat, ya da proje düzeyine terfi ettir (\`plans/TODO-ELLE.md\` + hedefe \`→ td:elle/<slug>\`)`);
    if (o.gecersiz.length) for (const g of o.gecersiz) L.push(`  - ✗ GEÇERSİZ ${g.alan}: \`${g.deger}\` — ${g.neden}`);
    L.push('');
  }
  if (t.sahipsiz.length) {
    L.push('## ⚠ Sahipsiz oturum beyanı (ADVISORY)');
    L.push('');
    L.push('_Plan bir oturuma atıf yapıyor ama o oturumun dosyası yok._');
    for (const s of t.sahipsiz)
      L.push(`- ${s.slug} v${s.v} → \`${s.ref}\` — onar: \`plans/oturumlar/${refDosyaAdi(s.ref)}\` yaz (\`oturum.mjs tohumla --ad …\`) ya da MASTER'daki ref'i düzelt`);
    L.push('');
  }
  if (t.oturumsuz.length) {
    L.push('## Oturum beyanı olmayan açık planlar (ADVISORY)');
    L.push('');
    L.push(`_${t.oturumsuz.length} açık plan \`> Oturum:\` taşımıyor — "bu oturumda ne bitirdim" sorusu onları GÖRMEZ._`);
    for (const p of t.oturumsuz)
      L.push(`- ${p.slug} v${p.v} — onar: \`plans/${p.slug}/v${p.v}/MASTER.md\` künye bloğuna \`> Oturum: ot:<YYYY-MM-DD>/<slug>\` ekle`);
    L.push('');
  }
  return L.join('\n');
}

function durum() {
  const t = tabloAl();
  if (flag('--json')) { process.stdout.write(JSON.stringify(jsonTablo(t), null, 1) + '\n'); return; }
  const out = path.join(PLANS, 'OTURUMLAR.md');
  if (fs.existsSync(PLANS)) atomikYaz(out, renderOturumlarMd(t));
  console.log(`# ${path.basename(ROOT)} — oturum tablosu (${t.oturumlar.length} oturum)`);
  for (const o of t.oturumlar)
    console.log(`  ${hukumRozet[o.hukum]} ${o.hukum.padEnd(8)} ${o.ref.padEnd(34)} hedef ${o.hedefKapali}/${o.hedefler.length} · plan ${o.planlar.filter((p) => p.durum === 'KAPALI').length}/${o.planlar.length}`);
  if (t.sahipsiz.length) console.log(`\n⚠ sahipsiz oturum beyanı: ${t.sahipsiz.length} (${t.sahipsiz.map((s) => s.ref).join(', ')})`);
  if (t.oturumsuz.length) console.log(`⚠ oturum beyanı olmayan açık plan: ${t.oturumsuz.length} (${t.oturumsuz.map((p) => p.slug).join(', ')})`);
  if (!t.planOk) console.log('⚠ plan tarafı ÖLÇÜLEMEDİ (agac.mjs çalışmadı)');
  console.log(`\ntürev: ${path.relative(process.cwd(), out)}`);
}

const jsonTablo = (t) => ({
  proje: path.basename(t.root), root: t.root, planOk: t.planOk, sayim: t.sayim,
  oturumlar: t.oturumlar.map((o) => ({
    ref: o.ref, baslik: o.baslik, session: o.session, durum: o.durum, hukum: o.hukum,
    baslangic: o.baslangic, bitis: o.bitis, hedef: o.hedef,
    hedefToplam: o.hedefler.length, hedefKapali: o.hedefKapali,
    hedefAcik: o.hedefAcik.map((h) => ({ metin: h.metin, terfi: h.terfi })),
    terfisiz: o.terfisiz.length, devir: o.devir ?? null,
    planlar: o.planlar.map((p) => ({ slug: p.slug, v: p.v, durum: p.durum, oncelik: p.oncelik, puan: p.puan })),
    gecersiz: o.gecersiz,
  })),
  sahipsiz: t.sahipsiz, oturumsuz: t.oturumsuz.map((p) => ({ slug: p.slug, v: p.v })),
});

// ---------- bu: BU oturumun kapanış hükmü (exit kodlu) ----------

function bu() {
  const t = tabloAl();
  const ref = opt('--ref');
  const aday = ref ? t.oturumlar.filter((o) => o.ref === ref)
    : SESSION_ID ? t.oturumlar.filter((o) => o.session && kisaId(SESSION_ID).startsWith(o.session)) : [];
  if (!aday.length) {
    console.error(`OTURUM DOSYASI YOK${ref ? `: ${ref}` : SESSION_ID ? ` (session ${kisaId(SESSION_ID)})` : ' (session ölçülemedi)'}`);
    console.error('  onar: node oturum.mjs tohumla   # bu oturumun dosyasını aç');
    process.exit(2);
  }
  let kotu = 0;
  for (const o of aday) {
    console.log(`${hukumRozet[o.hukum]} ${o.hukum} — ${o.ref} (${o.baslik || '—'})`);
    console.log(`  hedef: ${o.hedefKapali}/${o.hedefler.length} kapalı · plan: ${o.planlar.filter((p) => p.durum === 'KAPALI').length}/${o.planlar.length} KAPALI`);
    for (const h of o.hedefAcik) console.log(`  · açık hedef: ${h.metin}${h.terfi.length ? ` → ${h.terfi.join(', ')}` : ''}`);
    for (const p of o.planAcik) console.log(`  · açık plan: ${p.slug} v${p.v} ${p.durum}`);
    if (o.hukum !== 'TAM' && o.hukum !== 'BOŞ') kotu++;
  }
  // exit 1 = "bu oturumda açık iş var". Oturumun KENDİ kapanış kapısı; bekçi değil KAPI olduğu
  // için exit kodu taşır (bekçi sözleşmesi exit 0'dır — bu komut bilinçli olarak kapıdır).
  process.exit(kotu ? 1 : 0);
}

function kapat() {
  const t = tabloAl();
  const ref = opt('--ref') || (SESSION_ID ? t.oturumlar.find((o) => o.session && kisaId(SESSION_ID).startsWith(o.session))?.ref : null);
  if (!ref) { console.error('KAPATILACAK OTURUM ÖLÇÜLEMEDİ — --ref ot:<…> ver'); process.exit(2); }
  const dosya = path.join(oturumlarDir(PLANS), refDosyaAdi(ref));
  const md = readIf(dosya);
  if (md == null) { console.error(`DOSYA YOK: ${dosya}`); process.exit(2); }
  if (/Durum:\s*KAPALI/.test(md)) { console.log(`ZATEN KAPALI: ${ref} (hiçbir şey yazılmadı)`); return; }
  const yeni = md.replace(/(>\s*Başlangıç:[^\n]*?)Bitiş:\s*[^·\n]*·\s*Durum:\s*[^\s·\n]+/,
    `$1Bitiş: ${simdi()} · Durum: KAPALI`);
  if (yeni === md) { console.error(`KÜNYE SATIRI TANINMADI: ${dosya}\n  onar: "> Başlangıç: … · Bitiş: — · Durum: AÇIK" biçimini geri getir`); process.exit(2); }
  fs.writeFileSync(dosya, yeni);
  console.log(`OTURUM KAPATILDI: ${ref} — açık iş artık EKSİK sayılır (roll-up: oturum.mjs durum)`);
}

// ---------- global: projeler-arası SIRALI kılavuz ----------

/** Proje keşfi: `~/dev/*` + sentetik kök `~/.claude/plan-global`. İLANLI SINIR — `~/dev` dışındaki
 *  projeler kapsam DIŞIDIR (aide sync --auto ile aynı keşif tabanı; ayrı bir kayıt defteri
 *  icat etmemek için bilinçli). Kapsam dışı proje `--proje` ile tek tek sorgulanabilir. */
function projeler() {
  const kokler = [];
  // İÇİNDE BULUNDUĞUN PROJE HER ZAMAN KAPSAMDA: `--proje` verilmişse o, yoksa cwd'nin projesi.
  // Keşif tabanı `~/dev` olduğu için bu satır olmadan `~/dev` DIŞINDAKİ bir projede `global`
  // kendi oturumlarını GÖRMÜYORDU (ölçüldü 2026-07-27, proof: fikstür /tmp altındaydı ve
  // kılavuz boş çıkıyordu — kullanıcı `--proje` verdiği hâlde).
  if (fs.existsSync(oturumlarDir(PLANS))) kokler.push(ROOT);
  const dev = path.join(os.homedir(), 'dev');
  try {
    for (const e of fs.readdirSync(dev).sort()) {
      const p = path.join(dev, e);
      if (p === ROOT) continue;                          // yukarıda eklendi — çift sayım olmasın
      if (fs.existsSync(oturumlarDir(path.join(p, 'plans')))) kokler.push(p);
    }
  } catch { /* ~/dev yok — kapsam boş, ilan aşağıda */ }
  const sentetik = path.join(CLAUDE, 'plan-global');
  if (fs.existsSync(oturumlarDir(path.join(sentetik, 'plans')))) kokler.push(sentetik);
  return kokler;
}

/** KILAVUZ SIRASI (kullanıcı amacı 2026-07-27: "uygun sıralamaya koyup komple işleyeceğim, yeni
 *  sessionlara kılavuz olması"). Sıra anahtarı, en güçlüden:
 *    1) hüküm: EKSİK (kapanmış oturumun sarkık işi) → SÜRÜYOR → BOŞ. TAM kılavuza GİRMEZ.
 *    2) planların en yüksek künye puanı (plan katmanının önceliği kılavuzda da geçerlidir)
 *    3) tarih ARTAN — en eski sarkık iş en önce (bekleyen borç önce ödenir)
 *  TAM oturumlar listelenmez ama SAYILIR: "hepsi bitti" ile "hiç yoktu" ayrımı korunur. */
const HUKUM_SIRA = { 'EKSİK': 0, 'SÜRÜYOR': 1, 'BOŞ': 2, 'TAM': 9 };
function kilavuzSirala(a, b) {
  return (HUKUM_SIRA[a.hukum] - HUKUM_SIRA[b.hukum])
    || ((b.enYuksekPuan ?? -1) - (a.enYuksekPuan ?? -1))
    || String(a.ref).localeCompare(String(b.ref));
}

function globalTopla() {
  const kokler = projeler();
  const kayitlar = [];
  const projeOzet = [];
  for (const root of kokler) {
    const t = tabloAl(root);
    projeOzet.push({ proje: path.basename(root), root, sayim: t.sayim, planOk: t.planOk });
    for (const o of t.oturumlar) {
      kayitlar.push({
        proje: path.basename(root), root, ref: o.ref, baslik: o.baslik, session: o.session,
        durum: o.durum, hukum: o.hukum, hedefAcik: o.hedefAcik, terfisiz: o.terfisiz, devir: o.devir ?? null,
        hedefToplam: o.hedefler.length, hedefKapali: o.hedefKapali,
        planlar: o.planlar, planAcik: o.planAcik,
        enYuksekPuan: o.planlar.reduce((m, p) => Math.max(m, p.puan ?? -1), -1),
      });
    }
  }
  const acik = kayitlar.filter((k) => k.hukum !== 'TAM').sort(kilavuzSirala);
  return { kokler, kayitlar, acik, projeOzet, tam: kayitlar.filter((k) => k.hukum === 'TAM').length };
}

function renderKilavuz(g) {
  const L = [];
  L.push('# OTURUM KILAVUZU — projeler-arası sarkık iş (TÜREV — ELLE YAZILMAZ)');
  L.push('');
  L.push('> Tek yazar: `oturum.mjs global`. Sınıf: motor · deterministik · 0 token · **aide gerekmez**.');
  L.push('> Kaynak: her projenin `plans/oturumlar/*.md` kanonu × plan künyelerindeki `> Oturum:` alanı.');
  L.push('> NE İÇİN: yeni bir oturum "hangi işi devralayım" sorusunu buradan yanıtlar — sıra hazırdır,');
  L.push('> tahmin gerekmez. Sıra: EKSİK → SÜRÜYOR, sonra plan künyesi puanı, sonra en eski çıpa.');
  L.push(`> Kapsam: ${g.kokler.length} proje (\`~/dev/*\` + \`~/.claude/plan-global\`) · ${g.kayitlar.length} oturum · ${g.tam} TAM (listelenmez).`);
  L.push('');
  if (!g.acik.length) {
    L.push('**Sarkık iş yok** — kapsamdaki her oturum TAM. Yeni oturum plan katmanından devam eder:');
    L.push('`node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --durum`');
    L.push('');
    return L.join('\n');
  }
  L.push(`## Sıralı devralma listesi (${g.acik.length})`);
  L.push('');
  let i = 0;
  for (const k of g.acik) {
    i++;
    L.push(`### ${i}. ${hukumRozet[k.hukum]} ${k.proje} · ${k.ref} — ${k.hukum}`);
    L.push('');
    L.push(`- ${k.baslik || '—'} · session \`${k.session || '—'}\` · dosya durumu ${k.durum}`);
    L.push(`- hedef: ${k.hedefKapali}/${k.hedefToplam} kapalı · terfisiz açık: ${k.terfisiz.length}`);
    if (k.devir) L.push(`- devir: \`${k.devir.yol}\` · sıradaki: ${k.devir.siradakiAdim || '—'}`);
    for (const h of k.hedefAcik) L.push(`  - [ ] ${h.metin}${h.terfi.length ? ` → ${h.terfi.join(', ')}` : ''}`);
    if (k.planAcik.length) {
      L.push(`- açık plan (${k.planAcik.length}):`);
      for (const p of k.planAcik) L.push(`  - ${p.slug} v${p.v} \`${p.durum}\`${p.oncelik != null ? ` P${p.oncelik}` : ''}`);
    }
    L.push(`- devral: \`cd ${k.root} && node ~/.claude/skills/plan-organizatoru/scripts/oturum.mjs bu --ref ${k.ref}\``);
    L.push('');
  }
  L.push('## Proje özeti');
  L.push('');
  L.push('| proje | TAM | SÜRÜYOR | EKSİK | BOŞ | plan tarafı |');
  L.push('|---|---|---|---|---|---|');
  for (const p of g.projeOzet)
    L.push(`| ${p.proje} | ${p.sayim['TAM']} | ${p.sayim['SÜRÜYOR']} | ${p.sayim['EKSİK']} | ${p.sayim['BOŞ']} | ${p.planOk ? 'ölçüldü' : '**ölçülemedi**'} |`);
  L.push('');
  return L.join('\n');
}

function global_() {
  const g = globalTopla();
  if (flag('--json')) { process.stdout.write(JSON.stringify(g, null, 1) + '\n'); return; }
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  const md = path.join(GLOBAL_DIR, 'KILAVUZ.md');
  atomikYaz(md, renderKilavuz(g));
  atomikYaz(path.join(GLOBAL_DIR, 'oturumlar.json'), JSON.stringify(g, null, 1) + '\n');
  console.log(`GLOBAL KILAVUZ türetildi: ${md}`);
  console.log(`  ${g.kokler.length} proje · ${g.kayitlar.length} oturum · ${g.acik.length} sarkık · ${g.tam} TAM`);
  for (const k of g.acik.slice(0, 10))
    console.log(`  ${hukumRozet[k.hukum]} ${k.proje.padEnd(14)} ${k.ref.padEnd(34)} açık hedef ${k.hedefAcik.length} · açık plan ${k.planAcik.length}`);
  if (g.acik.length > 10) console.log(`  … +${g.acik.length - 10} oturum daha (tamamı: ${path.relative(process.cwd(), md)})`);
}

// ---------- backfill: beyansız LEGACY planları ölçülebilir oturuma bağla ----------
//
// SORUN: oturum boyutu bugün doğdu; ondan önce yazılmış planların kaynak oturumu HİÇBİR YERDE
// kayıtlı değil (kaptan planref defteri boş ölçüldü 2026-07-27). Beyansız plan ADVISORY'dir ama
// "bu oturumun planları bitti mi?" sorusu onları GÖRMEZ — yani sistem doğduğu gün kör başlar.
//
// ÖLÇÜLEBİLİR OLAN: planın DOĞUM TARİHİ (git'te MASTER.md'yi EKLEYEN commit). ÖLÇÜLEMEYEN:
// o günün session ADI/ID'si. O yüzden uydurulmaz — legacy planlar tarih kovasına (`ot:<tarih>/gecmis`)
// bağlanır, `Session: —` kalır ve dosya kendini LEGACY ilan eder. Doğum tarihi bile ölçülemezse
// (git yok · dosya hiç commit'lenmemiş) plan ATLANIR ve İLAN edilir — tahmini tarih yazılmaz.
const gitDogumTarihi = (root, rel) => {
  try {
    const out = execFileSync('git', ['-C', root, 'log', '--diff-filter=A', '--format=%ad', '--date=short', '--', rel],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
    return out.length ? out[out.length - 1] : null;      // en ESKİ ekleme (yeniden ekleme değil)
  } catch { return null; }
};

/** Kaynak SERBEST mi? Protokolün kendi deterministik sondası (`claim.mjs free`) — kimliksiz, 0 token.
 *  Sonda ölçülemezse hüküm BLOKAJ yönündedir (şüphe her koşulda kilit lehine — /eszamanli kuralı). */
function serbestMi(res) {
  const claim = path.join(CLAUDE, 'skills', 'eszamanli', 'scripts', 'claim.mjs');
  if (!fs.existsSync(claim)) return { ok: true, neden: 'protokol kurulu değil (kapı yok)' };
  try {
    execFileSync(process.execPath, [claim, 'free', '--res', res], { stdio: 'ignore' });
    return { ok: true };
  } catch (e) {
    return { ok: false, neden: e.status === 0 ? 'ölçülemedi' : 'başka session tutuyor' };
  }
}

function backfill() {
  const uygula = flag('--uygula');
  const pm = planlariAl(ROOT);
  if (!pm.ok) { console.error('PLAN TARAFI ÖLÇÜLEMEDİ (agac.mjs çalışmadı) — backfill yapılmaz'); process.exit(2); }
  const beyansiz = pm.plans.filter((p) => !p.oturum);
  if (!beyansiz.length) { console.log('Beyansız plan yok — her plan kaynak oturumunu taşıyor.'); return; }

  const kovalar = new Map();  // tarih → plan[]
  const olculemeyen = [];
  for (const p of beyansiz) {
    const rel = `plans/${p.slug}/v${p.v}/MASTER.md`;
    const t = gitDogumTarihi(ROOT, rel);
    if (!t) { olculemeyen.push({ ...p, rel }); continue; }
    if (!kovalar.has(t)) kovalar.set(t, []);
    kovalar.get(t).push({ ...p, rel });
  }

  console.log(`${uygula ? 'BACKFILL' : 'BACKFILL — KURU KOŞUM (hiçbir şey yazılmaz)'}: ${beyansiz.length} beyansız plan · ${kovalar.size} tarih kovası`);
  const atlanan = [];
  for (const [tarih, plans] of [...kovalar].sort()) {
    const ref = `ot:${tarih}/gecmis`;
    const dosya = path.join(oturumlarDir(PLANS), refDosyaAdi(ref));
    console.log(`\n  ${ref}  (${plans.length} plan)`);
    for (const p of plans) console.log(`    · ${p.slug} v${p.v} ${p.durum}${p.oncelik != null ? ` P${p.oncelik}` : ''}`);
    if (!uygula) { console.log(`    → yazılacak: ${path.relative(process.cwd(), dosya)} + her MASTER'a "> Oturum: ${ref}"`); continue; }

    // Kova dosyası: LEGACY ilanı taşır. Hedef maddeleri = planların kendisi (plan KAPALI ise [x]) —
    // böylece "o günün işi bitti mi" sorusu plan durumlarından TÜREYİP cevaplanabilir hale gelir.
    fs.mkdirSync(oturumlarDir(PLANS), { recursive: true });
    if (!fs.existsSync(dosya)) {
      const L = [];
      L.push(`<!-- ${ref} -->`);
      L.push(`# Oturum — ${tarih} geçmiş kovası (LEGACY)`);
      L.push('');
      L.push(`> Oturum: ${ref} · Session: — · Proje: ${path.basename(ROOT)}`);
      L.push(`> Başlangıç: ${tarih} · Bitiş: ${tarih} · Durum: KAPALI`);
      L.push(`> Hedef: ${tarih} tarihinde doğan planları tamamla (oturum boyutundan ÖNCE yazıldı)`);
      L.push('');
      L.push('> **LEGACY KOVA — ölçülen tarih, ölçülemeyen session.** Bu dosya `oturum.mjs backfill`');
      L.push('> tarafından üretildi: plan doğum tarihi git\'ten ÖLÇÜLDÜ (MASTER.md\'yi ekleyen commit),');
      L.push('> ama o günün session adı/id\'si hiçbir yerde kayıtlı değildi → UYDURULMADI (`Session: —`).');
      L.push('> Bundan sonra doğan planlar gerçek oturum çıpası taşır; bu kova geçmişi görünür kılar.');
      L.push('');
      L.push('## Hedefler');
      L.push('<!-- TOHUM: o gün doğan planlar. Plan KAPALI ise madde [x]. Elle düzenlenebilir. -->');
      for (const p of plans) L.push(`- [${p.durum === 'KAPALI' ? 'x' : ' '}] plan ${p.slug} v${p.v} tamamlanacak`);
      L.push('');
      L.push('## Notlar');
      L.push('');
      fs.writeFileSync(dosya, L.join('\n'));
      console.log(`    ✓ kova yazıldı: ${path.relative(process.cwd(), dosya)}`);
    } else console.log(`    · kova zaten var: ${path.relative(process.cwd(), dosya)} (dokunulmadı)`);

    // MASTER künyesine `> Oturum:` satırı. EŞZAMANLILIK: her plan ayrı bir kaynaktır ve başka bir
    // session onu tutuyor olabilir → protokolün `free` sondasıyla ölçülür, tutulan plan ATLANIR ve
    // İLAN edilir. Sonda olmadan yazmak kilidi ARKADAN dolanmak olurdu (kapı Bash'te bu yolu
    // görmez: komut kilitli yolu ANMIYOR) — motorun kendi disiplini bu yüzden zorunlu.
    for (const p of plans) {
      const s = serbestMi(`glob:plans/${p.slug}/**`);
      if (!s.ok) { atlanan.push({ ...p, ref, neden: s.neden }); console.log(`    ⏸ ${p.slug} ATLANDI — ${s.neden}`); continue; }
      const f = path.join(ROOT, p.rel);
      const md = readIf(f);
      if (md == null) { atlanan.push({ ...p, ref, neden: 'MASTER.md okunamadı' }); continue; }
      if (/^\s*>.*\bOturum:/m.test(md)) { console.log(`    · ${p.slug} zaten beyanlı`); continue; }
      // Künye bloğunun SONUNA ekle: blok = başlıktan sonraki kesintisiz `>` satırları.
      const yeni = md.replace(/^(#[^\n]*\n+(?:[ \t]*>[^\n]*\n)+)/m, (blk) => `${blk}> Oturum: ${ref}\n`);
      if (yeni === md) { atlanan.push({ ...p, ref, neden: 'künye bloğu tanınmadı' }); console.log(`    ✗ ${p.slug} — künye bloğu tanınmadı`); continue; }
      fs.writeFileSync(f, yeni);
      console.log(`    ✓ ${p.rel} ← "> Oturum: ${ref}"`);
    }
  }
  if (olculemeyen.length) {
    console.log(`\n⚠ DOĞUM TARİHİ ÖLÇÜLEMEDİ (${olculemeyen.length}) — tahmin yazılmadı, beyansız kaldılar:`);
    for (const p of olculemeyen) console.log(`  · ${p.slug} v${p.v} (${p.rel} git'te ekleme commit'i yok)`);
    console.log('  onar: planı commit\'le, sonra backfill\'i tekrar koş — ya da MASTER künyesine elle "> Oturum: ot:<tarih>/<slug>" yaz');
  }
  if (atlanan.length) {
    console.log(`\n⏸ ATLANAN (${atlanan.length}) — kaynak başka session'da ya da biçim tanınmadı:`);
    for (const p of atlanan) console.log(`  · ${p.slug} v${p.v} → ${p.ref} · ${p.neden}`);
    console.log('  onar: kaynak boşalınca backfill\'i tekrar koş (idempotent — beyanlı planı atlar)');
  }
  if (!uygula) console.log('\nuygulamak için: --uygula');
}

// ---------- devir: session ölümü NİYETİ diske bırakır (aşama-05) ----------
//
// Bu komut "bu oturum ne yapıyordu ve nerede kaldı" sorusunun git-izli cevabını yazar.
// Kaynakların HEPSİ motordur (defter · nabız · plan ağacı · kilit defteri · transcript);
// hiçbiri LLM doğurmaz ve hiçbiri `aide` gerektirmez. ÖLÇÜLEMEYEN alan UYDURULMAZ:
// null kalır ve adı `olculemedi[]`ye düşer (dürüstlük alanı şemanın parçasıdır).

/** SIR ELEĞİ — devir notu transcript'ten ve nabızdan KULLANICI METNİ taşır. FILING'in sır
 *  kapısı `<proje>/plans/` altını TARAMAZ (o kapı `~/.claude` → filing yönünde çalışır),
 *  yani bu alan bu yol üzerindeki TEK elektir. Desen seti bilinçli DARdır: geniş "yüksek
 *  entropi" sezgisi normal metni (uzun slug · hash · commit id) sansürleyip notu okunmaz
 *  kılardı — yön burada okunabilirlik lehine, çünkü elenen şeyin İLANI (`«sır elendi»`)
 *  kaçan bir sırrı da görünür kılar. */
const SIR_DESENLERI = [
  /sk-ant-[A-Za-z0-9_-]{12,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/g,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/g,
];
const SIR_MASKE = '«sır elendi»';
const sirsiz = (s) => (typeof s === 'string'
  ? SIR_DESENLERI.reduce((a, re) => a.replace(re, SIR_MASKE), s) : s);

/** İçeriksiz devam sözcükleri — `packages/core/src/devralis.ts`teki `BOS_ISTEK`in JS uyarlaması.
 *  NEDEN KOPYA (ilanlı): devralis.ts TypeScript'tir ve bun+repo gerektirir; bu motorun
 *  sözleşmesi "yalnız node, aide GEREKTİRMEZ". Kaynağa işaretçi bilerek buraya yazıldı —
 *  desen değişirse iki yer birlikte güncellenir. */
const BOS_ISTEK = /^(devam|devam et|tamam|ok|evet|hayır|peki|olur|güzel|teşekkürler|sağol|dur|bekle)[\s.!?]*$/i;

const tekSatir = (s, n = 200) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Transcript'ten ilk (açılış) ve son ANLAMLI kullanıcı isteği. Hook/sistem enjeksiyonları
 *  atlanır: onlar harness'ın sesidir, "nerede kaldık"ı yanıtlamaz. Dosya yoksa null. */
function transcriptOzeti(yol) {
  let ham;
  try { ham = fs.readFileSync(yol, 'utf8'); } catch { return null; }
  let ilk = null, son = null;
  for (const satir of ham.split('\n')) {
    if (!satir.trim()) continue;
    let j;
    try { j = JSON.parse(satir); } catch { continue; }   // bozuk satır özeti öldürmez
    if (j.type !== 'user' || !j.message?.content) continue;
    const c = j.message.content;
    const metin = typeof c === 'string' ? c : (Array.isArray(c) ? (c.find((x) => x.type === 'text')?.text ?? '') : '');
    const t = String(metin).trim();
    if (!t || t.startsWith('<') || t.includes('system-reminder') || t.includes('Caveat:')) continue;
    if (!ilk) ilk = t;
    if (BOS_ISTEK.test(t)) continue;                     // "devam" nerede kaldığımızı söylemez
    son = t;
  }
  return { ilk, son };
}

/**
 * Bu session'ın kilitleri: AKTİF ∪ ARŞİV.
 *
 * İKİ KAYNAK ZORUNLU çünkü SessionEnd hook SIRASI GARANTİ DEĞİLDİR: `claim-guard release_all`
 * bizden önce koşarsa aktif defter boşalmış olur. Ama release_all kilidi SİLMEZ, `_archive/`e
 * TAŞIR ve `owner.sessionId` KORUNUR (claims-lib `reap()`) → aktif ∪ arşiv okuyunca yarış
 * TASARIMLA yok olur; hangi sırada koşulursa koşulsun kilit nota düşer, yalnız `durum` alanı
 * `aktif` ↔ `birakildi` olarak değişir.
 *
 * claims-lib DİNAMİK import edilir (session-status emsali): kurulu değilse bu motor ÇÖKMEZ,
 * `kilitler: null` döner ve sebep `olculemedi[]`ye yazılır — ölçemediğini "yok" sanmak yasak.
 */
async function kilitleriTopla(root, sessionId, baslangic) {
  if (!sessionId) return { kilitler: null, neden: 'kilitler (session id ölçülemedi)' };
  const lib = path.join(CLAUDE, 'hooks', 'claims-lib.mjs');
  if (!fs.existsSync(lib)) return { kilitler: null, neden: 'kilitler (claims-lib kurulu değil)' };
  try {
    const m = await import(pathToFileURL(lib).href);
    const repo = m.repoRootOf(root);
    const dir = m.ledgerDirOf(repo);
    const out = [];
    const ekle = (c, durum) => {
      const key = c?.resource?.key ?? null;
      if (!key || out.some((k) => k.key === key)) return;   // aktif kayıt kazanır (çift sayım yok)
      out.push({ key, intent: sirsiz(c.intent ?? null), breadth: c.breadth ?? null, durum });
    };
    for (const c of m.activeClaims(repo)) if (c?.owner?.sessionId === sessionId) ekle(c, 'aktif');
    // ARŞİV: `reap()` her biçilen claim için İKİ dosya bırakır (kopya + rename edilmiş asıl);
    // yukarıdaki `key` tekilleştirmesi ikisini tek kayda indirir.
    const t0 = Date.parse(baslangic || '') || 0;
    let arsiv = [];
    try { arsiv = fs.readdirSync(path.join(dir, '_archive')).filter((f) => f.endsWith('.json')).sort(); } catch { /* arşiv yok */ }
    for (const f of arsiv) {
      let c;
      try { c = JSON.parse(fs.readFileSync(path.join(dir, '_archive', f), 'utf8')); } catch { continue; }
      if (c?.owner?.sessionId !== sessionId) continue;
      // Bu oturumdan ÖNCE biçilmiş bir kayıt bu oturumun devri değildir (session id yeniden
      // kullanılmaz ama defter uzun yaşar; ölçüt oturumun kendi başlangıcıdır).
      const ts = Date.parse(c?._reaped?.at || c?.createdAt || '') || 0;
      if (t0 && ts && ts < t0) continue;
      ekle(c, 'birakildi');
    }
    out.sort((a, b) => String(a.key).localeCompare(String(b.key)));   // deterministik sıra
    return { kilitler: out, neden: null };
  } catch (e) {
    return { kilitler: null, neden: `kilitler (claims-lib import düştü: ${String(e?.message || e).slice(0, 60)})` };
  }
}

async function devir() {
  const t = tabloAl();
  const ref = opt('--ref');
  const o = ref ? t.oturumlar.find((x) => x.ref === ref)
    : SESSION_ID ? t.oturumlar.find((x) => x.session && kisaId(SESSION_ID).startsWith(x.session)) : null;
  if (!o) {
    // exit 2 = "ölçülecek oturum YOK" (`bu`/`kapat` emsali). Devri olmayan bir oturum HATA
    // değildir — eşik altı oturumlar defter açmaz; bu yüzden hook bu çıkışı YUTAR (exit 0).
    console.error(`DEVİR YAZILAMADI — oturum defteri yok${ref ? `: ${ref}` : SESSION_ID ? ` (session ${kisaId(SESSION_ID)})` : ' (session ölçülemedi)'}`);
    console.error('  onar: node oturum.mjs tohumla   # bu oturumun defterini aç');
    process.exit(2);
  }

  const olculemedi = [];
  if (!t.planOk) olculemedi.push('planlar (agac.mjs çalışmadı)');

  // ── nabız (TodoWrite) — SINIR ilanı: nabız hesaba bağlı DURUM'dur, hükmün girdisi DEĞİL;
  //    devir notunda "o an ne yapılıyordu" sorusunun tek ölçülebilir kaynağı olduğu için taşınır.
  const nabiz = nabizTodolar(ROOT, SESSION_ID);
  if (!SESSION_ID) olculemedi.push('nabız (session id ölçülemedi)');
  const acik = nabiz.maddeler.filter((m) => m.durum !== 'completed');
  const todos = {
    acik: acik.map((m) => sirsiz(m.metin)),
    inProgress: nabiz.maddeler.filter((m) => m.durum === 'in_progress').map((m) => sirsiz(m.metin)),
    toplam: nabiz.maddeler.length,
  };

  // ── transcript (isteğe bağlı — hook `transcript_path` payload'ından geçirir)
  const trYol = opt('--transcript');
  const tr = trYol ? transcriptOzeti(trYol) : null;
  if (!trYol) olculemedi.push('transcript (yol verilmedi)');
  else if (!tr) olculemedi.push('transcript (dosya okunamadı)');

  // ── kilitler (aktif ∪ arşiv)
  const kl = await kilitleriTopla(ROOT, SESSION_ID, o.baslangic);
  if (kl.neden) olculemedi.push(kl.neden);

  // ── K9: model-düşüş devam önerisi. 07 YAZAR, 05 yalnız GEÇİRİR — biçim bozuksa null
  //    (05 model zinciri hakkında HÜKÜM VERMEZ; bozuk öneriyi taşımak yanlış yönlendirirdi).
  let devamModeli = null;
  if (SESSION_ID) {
    try {
      const j = JSON.parse(fs.readFileSync(devamOnerisiYolu(CLAUDE, SESSION_ID), 'utf8'));
      if (j && j.surum === DEVIR_SURUM && typeof j.model === 'string')
        devamModeli = { model: j.model, sebep: j.sebep ?? null, kaynak: 'oturum/devam', ts: j.ts ?? null };
    } catch { /* öneri yok — null (olculemedi DEĞİL: yokluk normal haldir) */ }
  }

  // ── SIRADAKİ ADIM: DETERMİNİSTİK, yorumsuz. İlk in_progress ?? ilk açık hedef ?? null.
  const siradakiAdim = todos.inProgress[0] ?? (o.hedefAcik[0] ? sirsiz(o.hedefAcik[0].metin) : null);

  const ozet = [
    sirsiz(o.baslik) || o.ref,
    `hüküm ${o.hukum}`,
    `açık hedef ${o.hedefAcik.length}/${o.hedefler.length}`,
    `açık plan ${o.planAcik.length}/${o.planlar.length}`,
    `açık todo ${todos.acik.length}/${todos.toplam}`,
    kl.kilitler ? `kilit ${kl.kilitler.length}` : 'kilit ÖLÇÜLEMEDİ',
    siradakiAdim ? `sıradaki: ${siradakiAdim}` : 'sıradaki adım YOK',
  ].join(' · ');

  const not = {
    // ── kimlik
    surum: DEVIR_SURUM,
    ref: o.ref,
    // TAM session id (gecerlilik.mjs --session girdisi); `kisa` yalnız insan okuması için.
    session: { id: SESSION_ID ?? null, kisa: o.session ?? kisaId(SESSION_ID) },
    proje: path.basename(ROOT),
    kok: ROOT,
    baslangic: o.baslangic ?? null,
    // KAPANIŞ defterin `Bitiş` alanından gelir, `new Date()`ten DEĞİL. Sebep: idempotens —
    // her koşumda taze damga basılsaydı not asla bayt-özdeş olmaz, "aynı → yazma" yolu ölürdü.
    // Zincir bunu garanti eder: `kapat` devirden ÖNCE koşar (SIRA SÖZLEŞMEDİR).
    kapanis: o.bitis ?? null,
    kapanisSebebi: opt('--sebep') ?? null,
    // ── niyet
    niyet: sirsiz(o.hedef) ?? null,
    acilisIstek: sirsiz(tekSatir(tr?.ilk)) ?? null,
    sonIstek: sirsiz(tekSatir(tr?.son)) ?? null,
    // ── iş durumu
    hedefler: o.hedefler.map((h) => ({ metin: sirsiz(h.metin), kapali: h.kapali, terfi: h.terfi })),
    todos,
    planlar: o.planlar.map((p) => ({ slug: p.slug, v: p.v, durum: p.durum })),
    oturumDefteri: {
      dosya: path.relative(ROOT, o.dosya),
      durum: o.durum,
      hukum: o.hukum,
    },
    // ── devir
    kilitler: kl.kilitler,
    siradakiAdim,
    devamModeli,
    // ── dürüstlük (motor metin UYDURMAZ)
    olculemedi,
    ozet,
  };

  const d = devirDogrula(not);
  if (!d.gecerli) {
    // Kendi ürettiğimiz not şemayı tutmuyorsa YAZMAYIZ: bozuk bir notu tüketiciye vermek,
    // hiç not vermemekten kötüdür (06/07/08 biçimi tahmin etmiyor, ölçüyor).
    console.error(`DEVİR ŞEMA HATASI — yazılmadı (${d.hatalar.length}):`);
    for (const h of d.hatalar) console.error(`  ✗ ${h}`);
    process.exit(2);
  }

  const dosya = devirDosyaYolu(PLANS, o.ref);
  const icerik = JSON.stringify(not, null, 1) + '\n';
  if (readIf(dosya) === icerik) {
    console.log(`DEVİR aynı — yazılmadı: ${path.relative(process.cwd(), dosya)}`);
    return;
  }
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  atomikYaz(dosya, icerik);
  console.log(`DEVİR YAZILDI: ${path.relative(process.cwd(), dosya)}`);
  console.log(`  ${ozet}`);
  if (olculemedi.length) console.log(`  ölçülemedi: ${olculemedi.join(' · ')}`);
}

// ---------- acilis: yeni oturum sarkık işi OKUYARAK başlar (aşama-06) ----------
//
// SORU: "hangi işi devralayım?" Bugüne kadar bunun cevabı MODELİN HATIRASIYDI — yani yoktu.
// Bu komut cevabı OKUNAN UÇTAN üretir: bu projenin devir notu (05) + KILAVUZ türevinin bu
// projeye ait sarkık kayıtları. SessionStart hook'u çıktıyı `additionalContext` olarak enjekte
// eder; sinyal yoksa HİÇBİR ŞEY basılmaz (sinyalsiz oturumun token maliyeti SIFIR).
//
// ÜÇ SERT SINIR:
//   1. ÜRETMEZ, OKUR. `global` ASLA çağrılmaz (o 2+ projede agac.mjs koşturur — saniyeler).
//      Türev bayatsa BAYAT satırı basılır ve tazeleme komutu verilir; sessizce tazelenmez.
//   2. ÖLÇMEZ, İŞARET EDER. Geçerlilik ("bu iş hâlâ geçerli mi") uzun sürer ve süresi
//      öngörülemez → hook'ta koşmaz; komut SATIRI basılır, koşma kararı oturumundur.
//   3. DAYATMAZ. Blok BİLGİdir; kullanıcının açılış isteği her koşulda önceliklidir. Bu iki
//      cümle bloğun ilk ve son satırıdır (model bloğu görev sanmasın).
//
// SİNYAL (tetik): devir notu VAR ∨ KILAVUZ türevinde BU projeye ait sarkık kayıt. Ne
// projeler-arası sarkık ne de OTURUM KASASI kaydı TEK BAŞINA tetikler — İLANLI muafiyet, emsali DURUM bloğunun
// session-scoped kuralıdır (başkasının derdi senin açılış bloğunda taşınmaz); o kayıtlar
// sinyal varken tek SAYAÇ satırı olarak görünür.

const ACILIS_TAVAN_SATIR = 12;
const ACILIS_TAVAN_KARAKTER = 900;
const BAYAT_ESIK_SAAT = 24;
/** Bütçe aşılırsa DÜŞÜRÜLEBİLİR satırlar — en az bilgi taşıyandan başlayarak. Düşen satır
 *  `kirpilan[]`e yazılır: sessiz kırpma yasak (muafiyet ilan edilir, gizlenmez). */
const ACILIS_DUSURULEBILIR = ['ayrinti', 'projelerArasi', 'bayat'];

const evKisalt = (p) => String(p).replace(new RegExp(`^${os.homedir()}`), '~');
const kirp = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** KILAVUZ TÜREVİ — `oturum.mjs global`in yazdığı `~/.claude/oturum/oturumlar.json`.
 *  OKUNUR, ÜRETİLMEZ. Yokluk/bozukluk hüküm değil ÖLÇÜLEMEZLİKTİR: `{acik: [], yasSaat: null}`. */
function kilavuzTurevi() {
  const yol = path.join(GLOBAL_DIR, 'oturumlar.json');
  let yasSaat = null;
  try { yasSaat = (Date.now() - fs.statSync(yol).mtimeMs) / 3_600_000; } catch { /* yok */ }
  try {
    const j = JSON.parse(fs.readFileSync(yol, 'utf8'));
    return { acik: Array.isArray(j.acik) ? j.acik : [], yasSaat, yol, okundu: true };
  } catch { return { acik: [], yasSaat, yol, okundu: false }; }
}

/** OTURUM KASASI özeti — `plans/oturumlar/kasa/` (tek yazar: skill:soft-resume `kasa.mjs`).
 *  Burada SAYILIR, ölçülmez: kaydın canlılığı (session hâlâ açık mı) `kasa list`in işidir —
 *  açılış hook'unda pid taraması yapmak 2. sert kuralı ("hiçbir ölçüm koşmaz") kırardı.
 *  Kendi kaydını da sayar: açılış anında bu oturumun kaydı HENÜZ yoktur (kasa açılışta
 *  ayrık süreçte yazar), varsa da bir öncekinin fotoğrafıdır — sayı yine dürüsttür. */
function kasaOzeti() {
  const dir = path.join(PLANS, 'oturumlar', 'kasa');
  try {
    const dosyalar = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (!dosyalar.length) return null;
    let enTaze = null;
    for (const f of dosyalar) {
      const m = fs.statSync(path.join(dir, f)).mtimeMs;
      if (!enTaze || m > enTaze.m) enTaze = { kisa: f.replace(/\.json$/, ''), m };
    }
    return { sayi: dosyalar.length, enTaze };
  } catch { return null; }
}

/** Devir notunun K9 eşi: `oturum/devam/<sessionId>.json` (aşama-07 yazar). Yoksa/bozuksa null. */
function devamOnerisi(sessionTamId) {
  if (!sessionTamId) return null;
  try {
    const j = JSON.parse(fs.readFileSync(devamOnerisiYolu(CLAUDE, sessionTamId), 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

const saatMetni = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * LİMİT DALI — devir notu `kapanisSebebi: "limit"` taşıyorsa yeniden-ateşleme tavrı.
 * Sebep başka bir şeyse (`clear` · `logout` · `other` · null) TEK BAYT basılmaz: her
 * açılışta limit konuşmak, gerçek limit gününde sinyali gürültüye çevirirdi.
 */
function limitDali(devir) {
  if (!devir || devir.kapanisSebebi !== 'limit') return null;
  const oneri = devamOnerisi(devir.sessionTamId);
  const model = devir.devamModeli || oneri?.model || null;
  const reset = Number.isFinite(oneri?.resetTs) ? oneri.resetTs : null;
  const modelEki = model ? ` · önerilen model ${model}` : '';
  if (reset == null)
    return `⚡ önceki oturum LİMİTTE kapandı · reset anı ÖLÇÜLEMEDİ — ağır iş başlatmadan önce bak${modelEki}`;
  if (reset <= Date.now())
    return `⚡ önceki oturum LİMİTTE kapandı · pencere AÇILDI — kaldığın yerden devam${modelEki}`;
  return `⚡ önceki oturum LİMİTTE kapandı · reset ${saatMetni(reset)} — ağır iş başlatma, bölümle${modelEki}`;
}

function acilisOzeti() {
  const kilavuz = kilavuzTurevi();
  const kisa = kisaId(SESSION_ID);
  // KENDİ KAYDINI ÖNERME: türev bu oturum açılmadan önce üretilmiş olsa bile, aynı pencerede
  // ikinci kez açılan bir oturum kendi sarkık kaydını görebilir — "kendini devral" saçmalığı.
  const benimMi = (k) => !!(kisa && k.session && kisa.startsWith(String(k.session)));
  const buProje = kilavuz.acik.filter((k) => k.root === ROOT && !benimMi(k));
  const disProje = kilavuz.acik.filter((k) => k.root !== ROOT);
  const enYakin = buProje[0] || null;                    // türev ZATEN sıralı (kilavuzSirala)
  const sira = enYakin ? kilavuz.acik.indexOf(enYakin) + 1 : null;

  const devir = devirNotuBul(PLANS, { tercihRef: enYakin?.ref ?? null, haricSession: SESSION_ID });
  const sinyal = !!devir || buProje.length > 0;
  if (!sinyal) {
    return {
      sinyal: false, satirlar: [], kirpilan: [],
      kaynaklar: { devirNotu: null, kilavuzYasSaat: kilavuz.yasSaat, kilavuzOkundu: kilavuz.okundu },
    };
  }

  const S = [];   // {ad, metin} — ad bütçe kırpmasının tutamağıdır
  S.push({ ad: 'baslik', metin: '[devralma] açılış özeti — motor · 0 token · BİLGİ verir, görev DAYATMAZ' });
  S.push({
    ad: 'devir',
    metin: devir
      ? `devir notu: ${path.relative(ROOT, devir.yol)} · ${devir.ref} · açık hedef ${devir.acikHedef}`
      : 'devir notu: YOK (bu projede kapanış notu bırakan oturum yok)',
  });
  S.push({
    ad: 'sarkik',
    metin: enYakin
      ? `sarkık (bu proje): KILAVUZ ${sira}/${kilavuz.acik.length} · ${hukumRozet[enYakin.hukum] || '·'} ${enYakin.hukum}`
        + ` · ${enYakin.ref} — ${kirp(enYakin.baslik, 46) || '—'} · açık hedef ${(enYakin.hedefAcik || []).length}`
        + (buProje.length > 1 ? ` · +${buProje.length - 1} kayıt daha` : '')
      : 'sarkık (bu proje): YOK — yalnız devir notu var',
  });
  if (disProje.length)
    S.push({ ad: 'projelerArasi', metin: `projeler-arası sarkık: ${disProje.length} kayıt (bu projenin DIŞINDA — tek başına tetiklemez)` });

  /* KASA — devralınacak olan yalnız KAPANAN oturum değil, o an AÇIK olan sekmelerdir; kasa
     onların yeniden başlatılabilir yedeğidir. Satır DÜŞÜRÜLEBİLİR DEĞİLDİR: içindeki komut
     bloğun tek "eyleme dönüşebilir" ucudur (öteki satırlar bilgi taşır).
     İLANLI MUAFİYET — kasa TEK BAŞINA sinyal SAYILMAZ: SessionEnd/SessionStart zinciri kasayı
     neredeyse her oturumda yazar; sinyal saysaydık blok KALICI hâle gelir ve açılış bütçesini
     kalıcı olarak yerdi. Emsal: `projelerArasi` aynı gerekçeyle tetiklemez. */
  const kasa = kasaOzeti();
  if (kasa) {
    const yasDk = Math.round((Date.now() - kasa.enTaze.m) / 60_000);
    const yas = yasDk < 60 ? `${yasDk} dk` : yasDk < 2880 ? `${Math.round(yasDk / 60)} sa` : `${Math.round(yasDk / 1440)} gün`;
    S.push({
      ad: 'kasa',
      metin: `kasa (açık sekmelerin yedeği): ${kasa.sayi} kayıt · en taze ${kasa.enTaze.kisa} (${yas})`
        + ` · gör/başlat: node ${evKisalt(path.join(CLAUDE, 'skills', 'soft-resume', 'scripts', 'kasa.mjs'))} list`,
    });
  }

  // LİMİT DALI (aşama-07/T07.5): önceki oturum LİMİT yüzünden kapandıysa yeniden-ateşleme
  // TAVRI yazılıdır — "ne yapmalıyım" sorusu modelin hatırasına bırakılmaz.
  // Reset anı devir notunda YOKTUR (not kapanış fotoğrafıdır); 07 onu K9 dosyasına
  // (`oturum/devam/<sid>.json → resetTs`) EK alan olarak bırakır ve burada OKUNUR.
  // Üç hâl ve üçü de İLANLI: pencere AÇILDI · pencere KAPALI · reset ÖLÇÜLEMEDİ
  // (motor uydurmaz — ölçülemeyen hâl "açıldı" sanılırsa ağır iş limite yeniden çarpar).
  const limitSatiri = limitDali(devir);
  if (limitSatiri) S.push({ ad: 'limit', metin: limitSatiri });

  // GEÇERLİLİK: yalnız İŞARET. Girdisi TAM session id'dir (kısa id YETMEZ — `gecerlilik.mjs`
  // transcript'i tam id ile bulur). Motor kurulu değilse satır DÜŞER, blok bozulmaz.
  const gecerlilik = path.join(CLAUDE, 'skills', 'devam', 'scripts', 'gecerlilik.mjs');
  if (fs.existsSync(gecerlilik)) {
    S.push({
      ad: 'gecerlilik',
      metin: devir?.sessionTamId
        ? `geçerlilik (hâlâ geçerli mi?): node ${evKisalt(gecerlilik)} --session ${devir.sessionTamId}`
        : 'geçerlilik: ölçülemedi (legacy kova — devir notunda TAM session id yok)',
    });
  }
  if (kilavuz.yasSaat != null && kilavuz.yasSaat > BAYAT_ESIK_SAAT)
    S.push({
      ad: 'bayat',
      metin: `⚠ BAYAT kaynak: KILAVUZ türevi ${Math.round(kilavuz.yasSaat)} sa önce üretildi —`
        + ` tazele: node ${evKisalt(path.join(CLAUDE, 'skills', 'plan-organizatoru', 'scripts', 'oturum.mjs'))} global`,
    });
  S.push({ ad: 'ayrinti', metin: `ayrıntı: /devam · /soft-resume · ${evKisalt(path.join(GLOBAL_DIR, 'KILAVUZ.md'))}` });
  S.push({ ad: 'kapanis', metin: 'Kullanıcının açılış isteği ÖNCELİKLİDİR — bu blok yalnız okunan uçtur.' });

  // BÜTÇE: tavanı AŞMAK yerine satır DÜŞÜR ve düşeni İLAN et. Tavan test mühürlüdür.
  const kirpilan = [];
  const olcu = (l) => ({ satir: l.length, karakter: l.map((x) => x.metin).join('\n').length });
  let liste = S;
  for (const ad of ACILIS_DUSURULEBILIR) {
    const o = olcu(liste);
    if (o.satir <= ACILIS_TAVAN_SATIR && o.karakter <= ACILIS_TAVAN_KARAKTER) break;
    if (!liste.some((x) => x.ad === ad)) continue;
    liste = liste.filter((x) => x.ad !== ad);
    kirpilan.push(ad);
  }
  return {
    sinyal: true, satirlar: liste.map((x) => x.metin), kirpilan,
    kaynaklar: {
      devirNotu: devir ? path.relative(ROOT, devir.yol) : null,
      kilavuzYasSaat: kilavuz.yasSaat == null ? null : Math.round(kilavuz.yasSaat * 10) / 10,
      kilavuzOkundu: kilavuz.okundu,
    },
  };
}

function acilis() {
  const r = acilisOzeti();
  const metin = r.satirlar.join('\n');
  if (flag('--json')) {
    process.stdout.write(JSON.stringify({
      sinyal: r.sinyal,
      satirlar: r.satirlar,
      butce: {
        satir: r.satirlar.length, karakter: metin.length,
        tavanSatir: ACILIS_TAVAN_SATIR, tavanKarakter: ACILIS_TAVAN_KARAKTER,
      },
      kaynaklar: r.kaynaklar,
      kirpilan: r.kirpilan,
      // İLANLI muafiyetler — 09 denetçisinin assert yüzeyi (kör nokta ilan edilmemişse yalandır).
      muafiyet: ['resume-sessiz', 'projeler-arasi-tek-basina-tetiklemez', 'kasa-tek-basina-tetiklemez'],
    }, null, 1) + '\n');
    return;
  }
  if (metin) process.stdout.write(`${metin}\n`);   // sinyal yoksa TEK BAYT bile basılmaz
}

// ---------- gate: çift dikiş kapısı ----------

function gate() {
  const t = tabloAl();
  const sorunlar = [];
  for (const o of t.oturumlar)
    for (const g of o.gecersiz)
      sorunlar.push(`GEÇERSİZ OTURUM ${g.alan}: ${path.relative(ROOT, o.dosya)} — "${g.deger}" (${g.neden})`);
  // Sahipsiz/oturumsuz ADVISORY'dir, gate'i KIRMAZ (künye emsali: eksik beyan advisory, YANLIŞ
  // beyan FAIL — yanlış beyan tüketiciyi yanlış yere götürür, eksik beyan yalnız görünmez kılar).
  if (sorunlar.length) {
    console.error(`OTURUM GATE FAIL (${sorunlar.length}):\n` + sorunlar.map((s) => `  ✗ ${s}`).join('\n'));
    process.exit(1);
  }
  console.log(`OTURUM GATE PASS — ${t.oturumlar.length} oturum · ${t.sahipsiz.length} sahipsiz + ${t.oturumsuz.length} beyansız plan (ADVISORY)`);
}

// ---------- dispatch ----------

const KOMUTLAR = { tohumla, durum, bu, kapat, devir, acilis, global: global_, gate, backfill };
if (!KOMUTLAR[cmd]) {
  console.error(`bilinmeyen komut: ${cmd}\n  komutlar: ${Object.keys(KOMUTLAR).join(' · ')}`);
  process.exit(2);
}
// `devir` ASENKRONdur (claims-lib dinamik import). Reddi yutmayız: sessizce exit 0 veren bir
// motor "yazdım" der ama yazmamıştır — hata İLAN edilir ve exit 2 ile ölçülebilir kalır.
const _sonuc = KOMUTLAR[cmd]();
if (_sonuc && typeof _sonuc.then === 'function')
  _sonuc.catch((e) => { console.error(`${cmd} HATASI: ${String(e?.message || e)}`); process.exit(2); });
