#!/usr/bin/env node
// dogrula.mjs — workflow şablon ŞEMA KAPISI (gate). Deterministik · salt-okunur · sıfır bağımlılık.
//
// Şablonu ÇALIŞTIRMAZ (import etmez → top-level yan etki riski sıfır): metin-tabanlı statik analiz.
// Dosya başına her `agent(` çağrısını dengeli-parantez lexer'ıyla (tırnak/backtick durumunu izler)
// çıkarır, sonra K1–K7 kurallarını ölçer. Hiçbir dosya YAZMAZ. 0 token.
//
// CLI:  node dogrula.mjs <dosya...>   ·   argümansız → ../sablonlar/*.mjs tarar.
// Çıktı: ihlal başına `IHLAL K<n> <dosya>:<satır> — <açıklama> — onar: <cümle>`;
//        dosya sonunda `SONUC <dosya>: OK (7 kural)` ya da `SONUC <dosya>: IHLAL=<n>`.
// Exit:  herhangi bir ihlal → 1; hepsi temiz → 0.
//
// DESEN sabitleri: asama-00 kanıtı FARKLI bir imza bulursa YALNIZ bu blok değişir; kuralların
// KENDİSİ (K1–K7) değişmez. Gerçek imza (asama-00 A/2): agent(prompt, {label, phase, schema,
// model, effort, isolation, agentType}) — per-call `tools` allowlist'i YOK.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESEN = {
  cagri: "agent(",       // Workflow tool: agent(prompt, opts)
  paralel: "parallel(",  // parallel()/pipeline() global — fan-out kanıtı
  sema: "schema",        // opts.schema anahtarı (K2)
  faz: "phase",          // opts.phase anahtarı
  verifyFaz: "verify",   // phase değeri bununla başlıyorsa doğrulama adımı (K3)
  hukum: "hukum",        // hüküm şeması ayırt edici alanı (K3, R3)
  sinir: "ajan doğurma", // SINIR cümlesinin ayırt edici alt-dizesi (K4, R2)
  yazar: ["Edit", "Write", "NotebookEdit"], // per-call tools YOK → verify'de adı bile geçmemeli (K3)
  zamansal: ["Date.now(", "Math.random(", "new Date("], // determinizm ihlali (K5)
};

// ——— dengeli tarama: bir açılıştan (idx=open) eşleşen kapanışa; tırnak/backtick/escape izler ———
function dengeli(src, openIdx, ac, ka) {
  let depth = 0, q = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === "\\") { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === ac) depth++;
    else if (c === ka) { depth--; if (depth === 0) return { son: i, ok: true }; }
  }
  return { son: src.length, ok: false };
}

function satirNo(src, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}

// ——— tüm `agent(` çağrılarını çıkar (identifier sınırı: subagent( vb. eşleşmez) ———
function agentCagrilari(src) {
  const cagrilar = [];
  const tok = DESEN.cagri;
  let idx = 0;
  while ((idx = src.indexOf(tok, idx)) !== -1) {
    const onceki = idx > 0 ? src[idx - 1] : "";
    if (/[A-Za-z0-9_$]/.test(onceki)) { idx += tok.length; continue; } // agentType, subagent( …
    const acIdx = idx + tok.length - 1; // tok son karakteri "("
    const { son, ok } = dengeli(src, acIdx, "(", ")");
    if (!ok) { idx += tok.length; continue; }
    cagrilar.push({ metin: src.slice(idx, son + 1), satir: satirNo(src, idx) });
    idx = son + 1;
  }
  return cagrilar;
}

// ——— dosyadaki const tanımlarını topla (identifier → değer metni) — SINIR/HUKUM_SEMASI çözümü ———
function constDefleri(src) {
  const harita = {};
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    const bas = m.index + m[0].length;
    const c = src[bas];
    let deger;
    if (c === "{" || c === "[") { const { son } = dengeli(src, bas, c, c === "{" ? "}" : "]"); deger = src.slice(bas, son + 1); }
    else if (c === '"' || c === "'" || c === "`") { const { son } = dengeli(`(${src}`, bas, c, c); deger = src.slice(bas, son); }
    else { const nl = src.indexOf("\n", bas); deger = src.slice(bas, nl === -1 ? src.length : nl); }
    harita[m[1]] = deger;
  }
  return harita;
}

// Bir çağrının "etkin metni" = ham çağrı + içinde geçen tanımlı const'ların gövdesi (tek düzey).
function etkinMetin(cagriMetni, defler) {
  let metin = cagriMetni;
  for (const ad of cagriMetni.match(/[A-Za-z_$][\w$]*/g) || []) {
    if (defler[ad]) metin += "\n" + defler[ad];
  }
  return metin;
}

// Bir çağrının schema DEĞERİNİ döndür (inline {…} ya da çözülmüş const gövdesi). Yoksa "".
// K3'ün hüküm-alanı kontrolü YALNIZ bu değere bakar (prompt'taki "hukum" kelimesi yanıltmasın).
function semaDegeri(cagriMetni, defler) {
  const m = cagriMetni.match(new RegExp(`\\b${DESEN.sema}\\s*:\\s*`));
  if (!m) return "";
  const bas = m.index + m[0].length;
  const c = cagriMetni[bas];
  if (c === "{") { const { son } = dengeli(cagriMetni, bas, "{", "}"); return cagriMetni.slice(bas, son + 1); }
  const ad = (cagriMetni.slice(bas).match(/^[A-Za-z_$][\w$]*/) || [""])[0];
  return defler[ad] || "";
}

// ——— meta bloğu ———
function metaBlok(src) {
  const m = src.match(/export\s+const\s+meta\s*=\s*\{/);
  if (!m) return null;
  const acIdx = m.index + m[0].length - 1;
  const { son, ok } = dengeli(src, acIdx, "{", "}");
  if (!ok) return null;
  return { metin: src.slice(m.index, son + 1), bas: m.index, satir: satirNo(src, m.index) };
}

function dosyaDenetle(yol) {
  const src = readFileSync(yol, "utf8");
  const defler = constDefleri(src);
  const cagrilar = agentCagrilari(src);
  const ihlaller = [];
  const ekle = (k, satir, acik, onar) => ihlaller.push(`IHLAL ${k} ${yol}:${satir} — ${acik} — onar: ${onar}`);

  // K1 — meta saf literal + maxParalel 1..4
  const meta = metaBlok(src);
  if (!meta) {
    ekle("K1", 1, "export const meta bulunamadı", "export const meta = { name, description, maxParalel } saf literal ekle");
  } else {
    if (/`|\$\{|\.\.\./.test(meta.metin) || /[A-Za-z_$][\w$.]*\s*\(/.test(meta.metin)) {
      ekle("K1", meta.satir, "meta saf literal değil (backtick/${}/spread/fonksiyon çağrısı)", "meta'yı yalnız literal değerlerle yaz");
    }
    const mp = meta.metin.match(/maxParalel\s*:\s*(\d+)/);
    if (!mp) ekle("K1", meta.satir, "meta'da maxParalel yok", "meta'ya maxParalel: <1-4> literal ekle");
    else if (+mp[1] < 1 || +mp[1] > 4) ekle("K1", meta.satir, `maxParalel=${mp[1]} aralık dışı (1..4)`, "meta'ya maxParalel: <1-4> literal ekle (R4 tavanı 4)");
  }

  // K2/K3/K4 — çağrı bazlı
  for (const c of cagrilar) {
    // K2 — her agent çağrısında schema
    if (!new RegExp(`\\b${DESEN.sema}\\s*:`).test(c.metin)) {
      ekle("K2", c.satir, "agent çağrısında schema yok", "çağrıya schema: {...} ekle — şemasız çıktı toplanamaz");
    }
    // K3 — verify çağrısı: hüküm şeması VAR ∧ yazar araç adı YOK
    const verify = new RegExp(`${DESEN.faz}\\s*:\\s*["'\`]${DESEN.verifyFaz}`).test(c.metin);
    if (verify) {
      if (!new RegExp(DESEN.hukum, "i").test(semaDegeri(c.metin, defler))) {
        ekle("K3", c.satir, "verify çağrısı hüküm şeması taşımıyor", `verify çağrısının şemasına ${DESEN.hukum} alanı ekle — verify yalnız hüküm üretir`);
      }
      const yazar = DESEN.yazar.find((w) => new RegExp(`\\b${w}\\b`).test(c.metin));
      if (yazar) {
        ekle("K3", c.satir, `verify çağrısında yazar araç adı geçiyor (${yazar})`, "verify'den yazar aracı çıkar — hüküm ≠ eylem (R3)");
      }
    }
    // K4 — her çağrının prompt'unda SINIR (doğrudan ya da SINIR const'u üzerinden)
    const etkin = etkinMetin(c.metin, defler);
    if (!etkin.includes(DESEN.sinir)) {
      ekle("K4", c.satir, "prompt SINIR cümlesini içermiyor", "prompt'a SINIR cümlesini ekle (R2 — işçi ajan doğuramaz)");
    }
  }

  // K5 — determinizm: zamansal/rastgele yok
  for (const t of DESEN.zamansal) {
    const i = src.indexOf(t);
    if (i !== -1) ekle("K5", satirNo(src, i), `zamansal/rastgele çağrı (${t})`, "değeri girdi (args) parametresine taşı — resume adım-cache'ini kırar");
  }

  // K6 — parallel( geçiyorsa maxParalel meta DIŞINDA en az bir kez (dilimleme kanıtı)
  if (src.includes(DESEN.paralel)) {
    const govde = meta ? src.replace(meta.metin, "") : src;
    if (!/maxParalel/.test(govde)) {
      ekle("K6", satirNo(src, src.indexOf(DESEN.paralel)), "parallel var ama dilimleme meta.maxParalel'e bağlı değil", "dilimlemeyi meta.maxParalel'e bağla — sabit sayı yazma (R4)");
    }
  }

  // K7 — koşum sözleşmesi: export const meta ∧ top-level agent gövdesi ∧ export default YOK.
  // `export default` yalnız SATIR BAŞI (gerçek deyim) sayılır; yorum/string içi sayılmaz.
  const edm = src.match(/^[ \t]*export\s+default/m);
  if (edm) {
    ekle("K7", satirNo(src, edm.index), "export default var (gerçek Workflow script'i top-level koşar, fonksiyonu çağırmaz)", "gövdeyi top-level yaz — export default kaldır (köprü 03 scriptPath ile koşar)");
  }
  if (!cagrilar.length) {
    ekle("K7", 1, "top-level agent gövdesi yok", "en az bir top-level agent(...) çağrısı ekle — köprü (03) bunu çağırır");
  }
  if (!yol.endsWith(".mjs")) {
    ekle("K7", 1, "uzantı .mjs değil", "dosyayı .mjs uzantısıyla yaz");
  }

  return ihlaller;
}

// ——— CLI ———
function main() {
  let hedefler = process.argv.slice(2);
  if (!hedefler.length) {
    const sablonDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "sablonlar");
    hedefler = readdirSync(sablonDir).filter((f) => f.endsWith(".mjs")).sort().map((f) => join(sablonDir, f));
  }
  let toplamIhlal = 0;
  const cikti = [];
  for (const yol of hedefler) {
    const ihlaller = dosyaDenetle(yol);
    cikti.push(...ihlaller);
    cikti.push(ihlaller.length ? `SONUC ${yol}: IHLAL=${ihlaller.length}` : `SONUC ${yol}: OK (7 kural)`);
    toplamIhlal += ihlaller.length;
  }
  process.stdout.write(cikti.join("\n") + "\n");
  process.exit(toplamIhlal ? 1 : 0);
}

main();
