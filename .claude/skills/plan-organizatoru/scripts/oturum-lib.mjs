// oturum-lib.mjs — OTURUM (session) boyutunun TEK parse/hüküm yeri.
//
// NEDEN AYRI MODÜL: oturum künyesini iki tüketici okur — `agac.mjs` (governance + genel TODO
// kaynağı) ve `oturum.mjs` (CLI + global kılavuz). İki yerde iki parser YAZILSAYDI çift dikişin
// kendisi sapardı (Ders 4: değer kopyalanmaz, çözümlenir). Emsal: `claims-lib.mjs`.
//
// SINIF: motor · deterministik · 0 token. LLM DOĞURMAZ, tmux/aide GEREKTİRMEZ — bu modülün
// tüketicileri `aide sistem` KAPALIYKEN de koşar (kullanıcı kararı 2026-07-27: "aide katmanı
// eksikleri tamamlar veya kaliteyi artırır" — taban mekanizma oturumun KENDİ talimatıyla döner).
//
// ÇİFT DİKİŞ (2026-07-27 kullanıcı kararı) — iki yön, iki yazar, tek doğruluk:
//   plan → oturum   ELLE:  `plans/<slug>/v<N>/MASTER.md` künye bloğunda `> Oturum: ot:<ref>`
//   oturum → plan   TÜREV: bu modül `Oturum:` alanlarını tarayıp oturumun plan listesini KURAR
//   oturum hedefi   ELLE:  `plans/oturumlar/<tarih>-<slug>.md` → `## Hedefler` (oturumun beyanı)
//   hüküm           TÜREV: hedefler × planlar → TAM | SÜRÜYOR | EKSİK | BOŞ
// Dosya başına TEK YAZAR korunur: dosya ELLE'dir (oturumun kendi beyanı), roll-up (`OTURUMLAR.md`,
// global kılavuz) TÜREVDİR. Beyan ile gerçeğin YAN YANA durduğu yer roll-up'tır — "double check"
// oradadır; dosyanın içine türev yazılsaydı karşılaştırma yapan göz kalmazdı.
//
// ÇIPA: `ot:<YYYY-MM-DD>/<slug>`. Çıplak session id (hex) ÇIPA DEĞİLDİR — okunamaz ve
// ~/.claude'a bağlıdır (hesap değişince anlamı gider); hex `Session:` alanında YAŞAR, kimliği
// tarih ⊕ ad taşır (CLAUDE.md: "Çıplak hex yasak; ad ⊕ kısa id").

import fs from 'node:fs';
import path from 'node:path';

/** Oturum çıpası. `td:`/`uy:` ad-alanlarından AYRIDIR ve bu modül onları ne parse eder ne kopyalar. */
export const OT_RE = /^ot:\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]*$/;
/** Oturum dosyası durumu — `KAPALI` hükmü EKSİK'e çevirir (açık oturum henüz SÜRÜYOR'dur). */
export const OTURUM_DURUMLARI = ['AÇIK', 'KAPALI'];
export const HUKUMLER = ['TAM', 'SÜRÜYOR', 'EKSİK', 'BOŞ'];

export const oturumlarDir = (plansDir) => path.join(plansDir, 'oturumlar');
/** Çıpa ↔ dosya adı: `ot:2026-07-27/plan-bagi` → `2026-07-27-plan-bagi.md` (deterministik, iki yönlü). */
export const refDosyaAdi = (ref) => `${String(ref).replace(/^ot:/, '').replace('/', '-')}.md`;
export const dosyaAdiRef = (ad) => {
  const m = String(ad).replace(/\.md$/, '').match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  return m ? `ot:${m[1]}/${m[2]}` : null;
};

const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

/** `> A: x · B: y` bloğundan tek alan. `satirSonu` serbest metin (Hedef · Not) için — `·`de
 *  kırpılsaydı cümle sessizce yarılanırdı (agac.mjs'in `kunyeAlan` dersinin aynısı). */
function alan(blok, ad, { satirSonu = false } = {}) {
  const son = satirSonu ? '[^\\n]+' : '[^·\\n]+';
  const v = (blok.match(new RegExp(`(?:^|[>·])\\s*${ad}:\\s*(${son})`, 'm')) || [])[1]
    ?.trim().replace(/\s*<.*>\s*$/, '').trim();
  return v && !/^<.*>$/.test(v) && v !== '—' ? v : null;   // şablon placeholder'ı beyan sayılmaz
}

/** Oturum dosyasını parse et. Bozuk/eksik alan UYDURULMAZ: null döner, `gecersiz[]` dolar. */
export function parseOturumMd(md, { dosya = null } = {}) {
  const blok = (md.match(/^#[^\n]*\n+((?:[ \t]*>[^\n]*\n)+)/m) || [])[1] || '';
  const cipa = (md.match(/<!--\s*(ot:[^\s]+)\s*-->/) || [])[1] || null;
  const refAlan = alan(blok, 'Oturum');
  const dosyaRef = dosya ? dosyaAdiRef(path.basename(dosya)) : null;
  // Çıpa ÜÇ yerde görünür (yorum · künye · dosya adı) ve üçü UYUŞMAK ZORUNDA: uyuşmazlık
  // sessiz kalsaydı plan bir ref'e, roll-up başka bir ref'e bakar ve çift dikiş yalanlaşırdı.
  const adaylar = [cipa, refAlan, dosyaRef].filter(Boolean);
  const ref = adaylar[0] || null;
  const gecersiz = [];
  if (ref && !OT_RE.test(ref)) gecersiz.push({ alan: 'çıpa', deger: ref, neden: 'şema: ot:<YYYY-MM-DD>/<slug>' });
  for (const [ad, v] of [['çıpa yorumu', cipa], ['Oturum alanı', refAlan], ['dosya adı', dosyaRef]])
    if (v && ref && v !== ref) gecersiz.push({ alan: ad, deger: v, neden: `çıpa uyuşmazlığı (beklenen ${ref})` });

  const durumHam = alan(blok, 'Durum');
  const durum = OTURUM_DURUMLARI.includes(String(durumHam || '').toUpperCase()) ? String(durumHam).toUpperCase()
    : durumHam ? null : 'AÇIK';                             // yokluk = AÇIK (legacy); şema dışı = geçersiz
  if (durumHam && !durum) gecersiz.push({ alan: 'Durum', deger: durumHam, neden: `şema: ${OTURUM_DURUMLARI.join('|')}` });

  return {
    ref, dosya,
    baslik: (md.match(/^#\s+(.+)$/m) || [])[1]?.replace(/^Oturum\s*[—:-]\s*/i, '').trim() || null,
    session: alan(blok, 'Session'), proje: alan(blok, 'Proje'),
    baslangic: alan(blok, 'Başlangıç'), bitis: alan(blok, 'Bitiş'),
    durum, hedef: alan(blok, 'Hedef', { satirSonu: true }),
    hedefler: parseHedefler(md), gecersiz,
  };
}

/** `## Hedefler` bölümünün checkbox maddeleri. Terfi işareti `→ td:elle/<slug>` = proje düzeyine
 *  ÇIKARILMIŞ madde (kullanıcı kararı: her oturum todo'su projeye kopyalanmaz; terfi BEYANDIR). */
export function parseHedefler(md) {
  // SATIR TARAYICI, regex DEĞİL. Gerekçe (ölçüldü 2026-07-27): `(?=^##\s|\Z)` ile yazılan bölüm
  // regex'i sessizce YANLIŞ çalışıyordu — `\Z` JS'te ANKOR DEĞİL, literal "Z"ye düşer; lazy eşleşme
  // bölümdeki ilk büyük Z'de (yorumdaki "YALNIZ") kesiliyor ve maddeler GÖRÜNMEZ oluyordu. Bölüm
  // sınırı satır düzeyinde bakıldığında tek anlamlıdır; bu yüzden burada regex'e güvenilmez.
  const satirlar = String(md).split('\n');
  let icinde = false;
  const out = [];
  for (const satir of satirlar) {
    if (/^##\s/.test(satir)) { icinde = /^##\s*Hedefler\s*$/.test(satir); continue; }
    if (!icinde) continue;
    const m = satir.match(/^\s*[-*]\s*\[([ xX])\]\s*(.+?)\s*$/);
    if (!m) continue;
    let metin = m[2].trim();
    const terfi = [];
    metin = metin.replace(/→\s*(td:[a-z0-9][a-z0-9./-]*)/g, (_, r) => { terfi.push(r); return ''; }).trim();
    if (!metin) continue;
    out.push({ metin, kapali: m[1].toLowerCase() === 'x', terfi });
  }
  return out;
}

/** Projedeki tüm oturum dosyalarını oku (sıra: çıpa — yani tarih, sonra ad; deterministik). */
export function oturumlariOku(plansDir) {
  const dir = oturumlarDir(plansDir);
  let adlar = [];
  try { adlar = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_')); } catch { return []; }
  return adlar.sort().map((ad) => {
    const dosya = path.join(dir, ad);
    return parseOturumMd(readIf(dosya) || '', { dosya });
  }).filter((o) => o.ref);
}

/** HÜKÜM — beyan (hedefler) × gerçek (planlar). Ölçülemeyeni uydurmaz: plan yoksa plan tarafı boş.
 *  TAM: açık hedef VE açık plan yok · EKSİK: oturum KAPALI ama açık iş var · SÜRÜYOR: açık iş var,
 *  oturum hâlâ AÇIK · BOŞ: ne hedef ne plan (beyansız oturum — alarm değil, bilgi). */
export function hukumVer(oturum, planlar) {
  const benim = planlar.filter((p) => p.oturum === oturum.ref);
  const hedefAcik = oturum.hedefler.filter((h) => !h.kapali);
  const planAcik = benim.filter((p) => p.durum !== 'KAPALI');
  const bos = !oturum.hedefler.length && !benim.length;
  const hukum = bos ? 'BOŞ'
    : !hedefAcik.length && !planAcik.length ? 'TAM'
    : oturum.durum === 'KAPALI' ? 'EKSİK' : 'SÜRÜYOR';
  return {
    ...oturum, hukum, planlar: benim, planAcik, hedefAcik,
    hedefKapali: oturum.hedefler.length - hedefAcik.length,
    // Terfi etmemiş açık hedef = yalnız bu oturumda yaşayan iş. Oturum kapanırsa KAYBOLUR;
    // global kılavuzun taşıdığı yük tam olarak bu (kullanıcı amacı: yeni oturumlara kılavuz).
    terfisiz: hedefAcik.filter((h) => !h.terfi.length),
  };
}

/** Bir projenin oturum tablosu: dosyalar × plan künyeleri → hükümler. `planlar` = agac.mjs modeli
 *  ({slug, v, durum, oturum, ...}); bu modül plan dosyalarını KENDİ okumaz (tek okuyucu agac.mjs). */
export function oturumTablosu(plansDir, planlar) {
  const oturumlar = oturumlariOku(plansDir).map((o) => hukumVer(o, planlar));
  const bilinen = new Set(oturumlar.map((o) => o.ref));
  // SAHİPSİZ BEYAN: plan bir oturuma atıf yapıyor ama o oturumun dosyası YOK. ADVISORY
  // (`Kapatır:` karşılıksız ref emsali) — dosya sonradan yazılabilir, ama sessiz kalmaz.
  const sahipsiz = [];
  for (const p of planlar) {
    if (!p.oturum || bilinen.has(p.oturum)) continue;
    sahipsiz.push({ slug: p.slug, v: p.v, ref: p.oturum });
  }
  return {
    oturumlar, sahipsiz,
    oturumsuz: planlar.filter((p) => !p.oturum && p.durum !== 'KAPALI'),
    sayim: HUKUMLER.reduce((a, h) => (a[h] = oturumlar.filter((o) => o.hukum === h).length, a), {}),
  };
}

export const hukumRozet = { 'TAM': '✓', 'SÜRÜYOR': '▶', 'EKSİK': '⚠', 'BOŞ': '·' };

/** Oturum dosyası şablonu — tohumlamanın TEK biçim yeri (iki yazar iki biçim üretmesin). */
export function oturumSablonu({ ref, baslik, session, proje, baslangic, hedef, hedefler = [] }) {
  const L = [];
  L.push(`<!-- ${ref} -->`);
  L.push(`# Oturum — ${baslik || ref}`);
  L.push('');
  L.push(`> Oturum: ${ref} · Session: ${session || '—'} · Proje: ${proje || '—'}`);
  L.push(`> Başlangıç: ${baslangic || '—'} · Bitiş: — · Durum: AÇIK`);
  L.push(`> Hedef: ${hedef || '<tek cümle — bu oturum bitince ne değişmiş olacak>'}`);
  L.push('');
  L.push('## Hedefler');
  L.push('<!-- ELLE — bu oturumun KENDİ beyanı (tek yazarı bu oturum). Tohum: kaptan nabzı.');
  L.push('     Proje düzeyine terfi eden madde `→ td:elle/<slug>` işareti taşır; işaretsiz madde');
  L.push('     YALNIZ bu oturumda yaşar ve oturum kapanınca global kılavuza düşer. -->');
  if (hedefler.length) for (const h of hedefler) L.push(`- [${h.kapali ? 'x' : ' '}] ${h.metin}`);
  else L.push('- [ ] <ilk hedef>');
  L.push('');
  L.push('## Notlar');
  L.push('');
  return L.join('\n');
}

/* ═══════════════ DEVİR NOTU — session ölümü niyeti diske bırakır (aşama-05) ═══════════════
 *
 * NEDEN: bir session öldüğünde ("bitti" · limit · kopuş) ne yapmakta olduğu YALNIZ
 * transcript'te kalır ve transcript HESABA BAĞLIDIR (taşınmaz — ilanlı muafiyet). Devir notu
 * o niyeti git-izli PROJE tarafına indirir: `plans/oturumlar/devir/<ref>.json`.
 *
 * TEK PARSE YERİ BURASI (Ders 4: değer kopyalanmaz, çözümlenir). Yazan `oturum.mjs devir`;
 * okuyanlar aşama 06 (açılış devralma) · 07 (limit nabzı) · 08 (kilit ömrü). Tüketici biçimi
 * TAHMİN ETMEZ, `devirDogrula` ile ÖLÇER — arayüz mührü REQUIREMENTS.md § "05→06/07/08".
 *
 * DEVRALIS.md'yi İKAME ETMEZ: o PROJE düzeyidir ve canlı session'ları özetler; bu SESSION
 * düzeyidir ve kapanış anında donar. (`devralis.ts`in devir/ okuması 06+ adayı — bu aşamada
 * kapsam DIŞI, ilanlı.)
 *
 * MOTOR METİN UYDURMAZ: ölçülemeyen alan `null` kalır ve adı `olculemedi[]`ye düşer; `ozet`
 * serbest yorum değil ŞABLONLA dizilir. Kayıt TTL'siz yaşar (MASTER muafiyet 9): bayat devir
 * notunu kimse otomatik silmez, yaş ilanı + eskalasyon aşama 09 denetçinin işidir.
 */
export const DEVIR_SURUM = 1;

/** Devir notlarının dizini — defterlerin YANINDA ayrı klasör. `oturumlariOku` yalnız `.md`
 *  okuduğu için bu dizin ona görünmez; `agac.mjs` YETİM taraması da `plans/oturumlar`ı
 *  beyaz listede tutar (alt dizinlerine inmez) → yeni dizin governance'ı KIRMAZ. */
export const devirDir = (plansDir) => path.join(oturumlarDir(plansDir), 'devir');

/** Çıpa → devir dosyası: defter dosya adının `.md`'si `.json` olur (deterministik, iki yönlü). */
export const devirDosyaYolu = (plansDir, ref) =>
  path.join(devirDir(plansDir), refDosyaAdi(ref).replace(/\.md$/, '.json'));

/** K9 arayüzü (07 → 05): model-düşüş devam önerisi. **07 YAZAR, 05 yalnız GEÇİRİR**; dosya
 *  yoksa `devamModeli: null` — 05 model zinciri hakkında HÜKÜM VERMEZ. */
export const devamOnerisiYolu = (claudeDir, sessionId) =>
  path.join(claudeDir, 'oturum', 'devam', `${sessionId}.json`);

const _t = {
  str: (v) => typeof v === 'string',
  strN: (v) => v === null || typeof v === 'string',
  num: (v) => typeof v === 'number' && Number.isFinite(v),
  arr: (v) => Array.isArray(v),
  arrN: (v) => v === null || Array.isArray(v),
  obj: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  objN: (v) => v === null || (!!v && typeof v === 'object' && !Array.isArray(v)),
};

/** ZORUNLU alanlar ve tipleri. Sıra ANLAMLIDIR: kimlik → niyet → iş durumu → devir → dürüstlük. */
const DEVIR_ALANLAR = [
  ['surum', 'num'], ['ref', 'str'], ['session', 'obj'], ['proje', 'str'], ['kok', 'str'],
  ['baslangic', 'strN'], ['kapanis', 'strN'], ['kapanisSebebi', 'strN'],
  ['niyet', 'strN'], ['acilisIstek', 'strN'], ['sonIstek', 'strN'],
  ['hedefler', 'arr'], ['todos', 'obj'], ['planlar', 'arr'], ['oturumDefteri', 'obj'],
  ['kilitler', 'arrN'], ['siradakiAdim', 'strN'], ['devamModeli', 'objN'],
  ['olculemedi', 'arr'], ['ozet', 'str'],
];

/**
 * Devir notu şemaya uyuyor mu? → `{ gecerli, hatalar[] }`.
 *
 * BİLİNMEYEN ALAN SERBESTTİR (ileri sürümler alan EKLEYEBİLİR; tüketici tanımadığını yok
 * sayar) — ama ZORUNLU alanın yokluğu ya da tip sapması FAIL'dir: eksik alanı "boş" sanan
 * tüketici sessizce yanlış hüküm verir.
 */
export function devirDogrula(obj) {
  if (!_t.obj(obj)) return { gecerli: false, hatalar: ['devir notu bir nesne değil'] };
  const hatalar = [];
  for (const [ad, tip] of DEVIR_ALANLAR) {
    if (!(ad in obj)) { hatalar.push(`eksik alan: ${ad}`); continue; }
    if (!_t[tip](obj[ad]))
      hatalar.push(`tip hatası: ${ad} — ${tip} bekleniyor, ${obj[ad] === null ? 'null' : typeof obj[ad]} geldi`);
  }
  if ('surum' in obj && obj.surum !== DEVIR_SURUM)
    hatalar.push(`sürüm uyuşmazlığı: ${obj.surum} ≠ ${DEVIR_SURUM} (tüketici bu notu okumamalı)`);
  if (_t.str(obj.ref) && !OT_RE.test(obj.ref)) hatalar.push(`çıpa şema dışı: ${obj.ref}`);
  // TAM session id sözleşmesi (gecerlilik.mjs --session girdisi): alan VAR olmalı, değeri
  // null olabilir (ölçülemedi) — ama "kisa"nın tek başına taşınması yasak.
  if (_t.obj(obj.session) && !('id' in obj.session && 'kisa' in obj.session))
    hatalar.push('session: {id, kisa} alanlarının İKİSİ de zorunlu (id TAM kimliktir)');
  if (_t.obj(obj.todos) && !(Array.isArray(obj.todos.acik) && Array.isArray(obj.todos.inProgress) && _t.num(obj.todos.toplam)))
    hatalar.push('todos: {acik[], inProgress[], toplam:number} zorunlu');
  if (_t.obj(obj.oturumDefteri) && !('dosya' in obj.oturumDefteri && 'durum' in obj.oturumDefteri && 'hukum' in obj.oturumDefteri))
    hatalar.push('oturumDefteri: {dosya, durum, hukum} zorunlu');
  if (Array.isArray(obj.kilitler))
    for (const k of obj.kilitler)
      if (!_t.obj(k) || !_t.str(k.key) || !['aktif', 'birakildi'].includes(k.durum))
        { hatalar.push('kilitler[]: {key:string, durum:aktif|birakildi} zorunlu'); break; }
  return { gecerli: !hatalar.length, hatalar };
}

/** Devir notunu OKU — bozuksa/yoksa null (tüketici çökmez). Doğrulama ÇAĞIRANIN işidir. */
export function devirOku(plansDir, ref) {
  try { return JSON.parse(fs.readFileSync(devirDosyaYolu(plansDir, ref), 'utf8')); } catch { return null; }
}

/**
 * DEVİR NOTU RESOLVER (aşama-06 açılış devralması · 07/08 de tüketir).
 *
 * "Bu projede devralınabilir bir devir notu VAR mı?" — dizini tarar, ŞEMADAN GEÇENİ seçer.
 * Bozuk/eski-sürüm not YOK sayılır (`devirDogrula`); bir tüketicinin biçimi tahmin etmesi
 * yasaktır (arayüz mührü: MASTER § "05→06/07/08").
 *
 * SEÇİM SIRASI (deterministik):
 *   1. `tercihRef` — çağıran zaten bir aday biliyorsa (KILAVUZ türevinin en yakın kaydı).
 *      Ref'in notu YOKSA/BOZUKSA sessizce 2'ye düşülür: türev bayat olabilir (ölçüldü
 *      2026-07-29 — defter tekilleştirilince türevdeki ref diskte karşılıksız kaldı).
 *   2. en TAZE geçerli not (mtime azalan; eşitlikte ad azalan — dosya adı tarih taşır).
 * `haricSession` (TAM ya da kısa id) kendi oturumunu eler: yeni oturum kendi devrini devralmaz.
 */
export function devirNotuBul(plansDir, { tercihRef = null, haricSession = null } = {}) {
  const dir = devirDir(plansDir);
  let adlar = [];
  try { adlar = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return null; }
  const harici = String(haricSession || '');
  const aday = [];
  for (const ad of adlar) {
    const yol = path.join(dir, ad);
    let j;
    try { j = JSON.parse(fs.readFileSync(yol, 'utf8')); } catch { continue; }
    if (!devirDogrula(j).gecerli) continue;              // bozuk not YOK sayılır (sessiz değil: sayılır)
    const id = j.session?.id || '', kisa = j.session?.kisa || '';
    if (harici && (id === harici || (kisa && harici.startsWith(kisa)))) continue;
    let ts = 0;
    try { ts = fs.statSync(yol).mtimeMs; } catch { /* ölçülemedi → 0 (en eski sayılır) */ }
    aday.push({ yol, ad, ts, not: j });
  }
  if (!aday.length) return null;
  aday.sort((a, b) => (b.ts - a.ts) || b.ad.localeCompare(a.ad));
  const secili = (tercihRef && aday.find((a) => a.not.ref === tercihRef)) || aday[0];
  const j = secili.not;
  return {
    yol: secili.yol,
    ref: j.ref,
    sessionTamId: j.session?.id ?? null,               // null = ölçülemedi (kısa id YETMEZ)
    acikHedef: (j.hedefler || []).filter((h) => !h?.kapali).length,
    siradakiAdim: j.siradakiAdim ?? null,
    hukum: j.oturumDefteri?.hukum ?? null,
    // AŞAMA-07 (limit dalı) — notun ZATEN taşıdığı iki alanın projeksiyonu; yeni okuma yolu
    // İCAT EDİLMEDİ. `kapanisSebebi` kapanışın cinsini söyler (`limit` → 07 erken devri ya da
    // limitte ölmüş oturum), `devamModeli` K9 önerisidir (07 yazar, 05 geçirir, 06 okur).
    kapanisSebebi: j.kapanisSebebi ?? null,
    devamModeli: j.devamModeli?.model ?? null,
    ts: secili.ts,
    toplam: aday.length,
  };
}
