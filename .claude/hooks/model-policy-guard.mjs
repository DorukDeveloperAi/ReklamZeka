#!/usr/bin/env node
// sg: katman=modul rol=motor
// Model politikası bekçisi — politikayı KÂĞITTAN çıkarıp uygulanabilir kılan yer.
//
// Politika (tek kaynak: ~/.claude/model-policy.json ← ~/.config/agent-ide/config.json):
//   ana      → Opus 4.8 (1M)  · interaktif oturum: uygulama, kodlama, test, yürütme
//   plan     → Fable 5        · plan + kompleks analiz (DELEGE edilir, ana loop'a değil)
//   kod/inceleme → Opus 4.8
//
// Neden hook: Claude Code policy dosyamızı okumaz ve bir hook oturum modelini DEĞİŞTİREMEZ.
// İLKE (2026-07-16, kullanıcı kararı): bekçi DURDURMAZ, DEVREDER. Politikaya aykırı bir
// delegasyon reddedilmez; çağrı `updatedInput` ile doğru model ailesine OTOMATİK çevrilir
// ve iş kesintisiz devam eder. Eski deny davranışı çıkışsız kapıydı: önerdiği çare
// (/model …) yalnız kullanıcının koşabildiği bir komuttu → model duvara sürülüyor,
// oturum fiilen kesiliyordu. Sessiz sapma yine yasak: her otomatik devir systemMessage
// ile görünür kılınır; fark edilemeyen bir ihlal, olmayan bir kuraldır.
//
// SessionStart/UserPromptSubmit uyarısı da akışı bozmaz: oturum başına TEK SEFER basılır
// (marker: hooks/.model-policy-state/<session_id>) ve "işi durdur" değil "devir otomatik,
// devam et" der. Her turda tekrar eden eski uyarı, kullanıcının bilinçli model seçimiyle
// her prompt'ta çelişip sohbeti model tartışmasına kilitliyordu.
//
// ÖLÇÜLMÜŞ GERÇEK (2026-07-14): ajan frontmatter'ındaki `model:` GEÇERLİDİR.
// Model parametresi geçilmeden çağrılan bir subagent, frontmatter'daki modelle koşar
// (kanıt: ana loop opus-4-8[1m] · aynı anda subagent claude-fable-5). Bekçinin sorduğu
// tek soru: ETKİN model doğru aileden mi?
//   etkin model  = açık parametre → ajanın frontmatter pini → oturum modeli
//   beklenen     = ajanın frontmatter pini (policy'den türetilir) → yoksa ana modeli
// Ajan sınıfı ELLE LİSTELENMEZ (eski PLAN_AGENTS/KOD_AGENTS = politikanın donmuş
// beşinci kopyası). Sınıf = ajanın KENDİ frontmatter'ı; o da aide `projectAgentPins`
// ile policy'den yazılır → tek kaynak, tek zincir.
//
// Kullanım: settings.json → hooks (PreToolUse matcher "Agent" · SessionStart · UserPromptSubmit)

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

// KOŞUM DAMGASI (otonomi-merdiveni:02.3) — `aide otomasyon durum`un akıbet ekseni bunu okur.
// Dinamik import + try: damga yazarı yoksa ya da bozuksa hook KOŞMAYA DEVAM EDER; bir ölçüm
// aracı ölçtüğü şeyi asla bozamaz. Maliyet: bir dosya yazımı, 0 token.
try { (await import("./hook-nabiz.mjs")).nabiz("model-policy-guard", process.argv[2]); } catch {}

const CLAUDE = join(homedir(), ".claude");
const POLICY = join(CLAUDE, "model-policy.json");
const STATE_DIR = join(CLAUDE, "hooks", ".model-policy-state");

function readJSON(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Model ailesi: alias · tam id · [1m] varyantı → tek ada indir. */
function family(model) {
  if (!model || typeof model !== "string") return null;
  const m = model.trim().toLowerCase();
  if (m.includes("fable")) return "fable";
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return null;
}

// Graceful default (docs/model-policy.md sert kuralı): policy okunamıyorsa İŞİ DURDURMA.
const policy = readJSON(POLICY);
const anaModel = policy?.tiers?.ana?.model ?? "claude-opus-5[1m]";
const anaFam = family(anaModel) ?? "opus";

/** Ajanın frontmatter `model:` pinini bul (global + proje kapsamı). Pin = policy'nin
 *  o ajan için türettiği model (aide projectAgentPins yazar). Yoksa null → ajan
 *  oturum modelini devralır (Claude Code varsayılanı `inherit`). */
function frontmatterModel(type, cwd) {
  const dirs = [join(CLAUDE, "agents"), cwd ? join(cwd, ".claude", "agents") : null].filter(
    (d) => d && existsSync(d),
  );
  for (const d of dirs) {
    let files;
    try {
      files = readdirSync(d).filter((x) => x.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files) {
      let raw;
      try {
        raw = readFileSync(join(d, f), "utf8");
      } catch {
        continue;
      }
      const head = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!head) continue;
      const name = (head[1].match(/^name:[ \t]*(.*)$/m)?.[1] ?? f.replace(/\.md$/, "")).trim();
      if (name.toLowerCase() !== type) continue;
      return head[1].match(/^model:[ \t]*(.*)$/m)?.[1]?.trim() ?? null;
    }
  }
  return null;
}

function out(o) {
  process.stdout.write(JSON.stringify(o));
  process.exit(0);
}
function pass() {
  process.exit(0);
}

function context(event, text) {
  out({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
}

/** Transcript'in SON assistant satırından çalışan modeli oku (hook input'unda model gelmez).
 *  Dosyanın tamamı DEĞİL yalnız kuyruğu okunur — uzun oturumlarda transcript onlarca MB
 *  olur ve bu hook her prompt'ta senkron koşar. */
function activeModel(transcriptPath) {
  if (!transcriptPath) return null;
  let raw;
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const size = fstatSync(fd).size;
      const want = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(want);
      readSync(fd, buf, 0, want, size - want);
      raw = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  // İlk satır kuyruk kesiği olabilir; JSON.parse zaten atlar.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    try {
      const o = JSON.parse(l);
      const m = o?.message?.model;
      if (m) return m;
    } catch {
      /* yarım satır — atla */
    }
  }
  return null;
}

/** Oturum başına tek-seferlik uyarı: marker varsa daha önce uyarılmış demektir. */
function alreadyWarned(hook) {
  const id = hook.session_id || (hook.transcript_path ? basename(hook.transcript_path, ".jsonl") : null);
  if (!id) return false; // kimliksiz oturum — uyar, ama marker yazamayız
  const p = join(STATE_DIR, String(id).replace(/[^\w.-]/g, "_"));
  if (existsSync(p)) return true;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(p, new Date().toISOString());
  } catch {
    /* marker yazılamadı — en kötü ihtimal bir kez daha uyarır */
  }
  return false;
}

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const hook = readJSON_str(input) ?? {};
  const event = hook.hook_event_name || "";

  if (event === "PreToolUse") {
    if (hook.tool_name !== "Agent") pass();
    const ti = hook.tool_input || {};
    const type = String(ti.subagent_type || "").toLowerCase();
    if (!type) pass();

    const pin = frontmatterModel(type, hook.cwd);

    // Beklenen model: ajanın pini (policy türevi) → yoksa ana modeli (built-in ajan
    // oturumu devralır; onu ana ailesinden BAŞKA bir aileye zorlamak risktir).
    const expected = pin ?? anaModel;
    // Etkin model: açık parametre → pin → oturum modeli (miras).
    const effective = ti.model || pin || activeModel(hook.transcript_path) || anaModel;

    const effFam = family(effective);
    const expFam = family(expected);

    // Aileler biliniyor ve ÇELİŞİYORSA: DURDURMA, DEVRET (kullanıcı kararı 2026-07-16).
    // Çağrı doğru aileye updatedInput ile çevrilir; iş kesintisiz sürer. Parametresiz
    // doğru-pinli çağrı burada HER ZAMAN geçer (etkin = beklenen = pin).
    if (effFam && expFam && effFam !== expFam) {
      const why = ti.model
        ? `açık model parametresi (${effFam}) pinle/politikayla çelişiyordu`
        : pin
          ? `frontmatter pini politikadan sapmıştı`
          : `ajan pinsiz; oturum modelini (${effFam}) devralacaktı, politika ${expFam} bekler`;
      out({
        systemMessage: `model-policy: "${ti.subagent_type}" ${effFam}→${expFam} otomatik devredildi (${why}).`,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason:
            `MODEL POLİTİKASI (otomatik devir): "${ti.subagent_type}" ${expFam} ailesinde koşmalı; ` +
            `çağrı model:"${expFam}" ile düzeltilerek geçirildi. İş durdurulmaz. ` +
            `Politika: plan + kompleks analiz Fable · uygulama/kodlama/test Opus (ana loop).`,
          updatedInput: { ...ti, model: expFam },
        },
      });
    }
    pass();
  }

  if (event === "SessionStart" || event === "UserPromptSubmit") {
    const active = activeModel(hook.transcript_path);
    const fam = family(active);
    // Model henüz bilinmiyorsa (yeni oturum, transcript boş) sessiz kal — gürültü yapma.
    if (!fam || fam === anaFam) pass();
    if (alreadyWarned(hook)) pass(); // oturum başına TEK uyarı — her turda tekrar akışı kilitliyordu
    context(
      event,
      `ℹ️ MODEL NOTU (bu oturumda bir kez basılır) — oturum "${active}" ile koşuyor; ana loop kanonu "${anaModel}".\n` +
        `Bekçi delegasyonları doğru aileye OTOMATİK devreder (deny yok) — işe kesintisiz devam et, ` +
        `bu notu gerekçe gösterip DURMA. Kullanıcıya kısa bir not düşmen yeterli; oturum modelini ` +
        `yalnız kullanıcı değiştirebilir (/model ${anaModel}). Bilinçli seçimse ek işlem gerekmez.`,
    );
  }

  pass();
});

function readJSON_str(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
