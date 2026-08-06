// uygula-dogrula — pipeline şablonu: uygula → adversarial verify (yazarsız) → düzelt.
// KOPYALA-UYARLA: <GÖREV>, <KABUL> ve şema alanlarını doldur; sonra kapıdan geçir:
//   node .claude/skills/workflow/scripts/dogrula.mjs <bu-dosya>   (exit 0 olmadan koşma)
//
// SÖZLEŞME (asama-00 yetenek sondası kanıtı — bağlayıcı): Workflow script'i TOP-LEVEL
// await koşar; `export default` YOKTUR. `agent` / `parallel` / `budget` / `args` GLOBAL'dir
// (destructure edilmez). Sonuç top-level `return` ile döner. `meta` saf literal olmalı.
// Zamansal/rastgele değer YASAK (resume adım-cache'ini kırar).
//
// KANIT SÖZLEŞMESİ (04 — bu workflow'u koşan /goal oturumuna ZORUNLU; motor değil, İŞ akışı):
//   BAŞ: Workflow tool runId'yi döndürür döndürmez, plan STATE.md'deki bu aşamanın satırına
//        `wf:<runId>` token'ını işle (plan-state kilidi altında) — limit ortada çarparsa runId
//        çoktan kalıcı olur ve Rotacı E-DEVAM'ı resumeFromRunId ile SÜRDÜRÜR (baştan koşmaz).
//   SON: koşum bitince kanıt zinciri —
//        1) node .claude/skills/workflow/scripts/wf-artefakt.mjs --run <runId> --proje <kök>
//           --slug <s> --v <N> --asama <no>   (artefakt json+txt üretir, usage satırını O düşer)
//        2) `aide rota kanit --sinif hizli`   (exit 0 olmadan "bitti" YASAK — a03 dersi)
//        3) STATE satırını KAPALI + kanıt yolu (kanit/asama-NN-workflow-<runId>.json) olarak güncelle.
//   PROTOKOL: bu aşama Rotacı köprüsünden (kosum: workflow) geçtiyse goal metninde
//        "SEN TEK BİR AŞAMAYI uygularsın: <slug> v<V> aşama <no>-<ad>" satırı zaten enjekte
//        (limit.ts aşama-bağını buradan kurar); doğrudan/pilot koşumda bu satırı sen garanti et.
export const meta = {
  name: "uygula-dogrula",
  description: "Tek işi uygula, N bağımsız şüpheciyle refute et, bulgularla düzelt.",
  phases: [{ title: "uygula" }, { title: "verify" }, { title: "duzelt" }],
  maxParalel: 2, // R4: şema-zorunlu, ≤4 — verify şüphecileri bundan fazla olamaz
  maxDongu: 2,   // düzelt döngüsü tavanı (literal — zamansal/rastgele değer YASAK)
};

// R2: her adım ajanına SINIR — işçi ajan ALT-AJAN DOĞURAMAZ, yalnız kendi adımını yapar.
const SINIR = "SINIR: Bu adımda alt-ajan doğurma; Task/Agent/Workflow araçlarını çağırma; yalnız kendi adımını yap ve çıktıyı beyan edilen şemada döndür.";

// R3: verify adımı yalnız HÜKÜM JSON'u üretir (yazar araç taşımaz). Gerçek Workflow agent
// çağrısı per-call `tools` allowlist'i SUNMAZ (asama-00 A/2) → yazar-araç kısıtı SINIR cümlesi
// + hüküm şeması ile sağlanır. Opsiyonel sertleştirme: agentType ile salt-okunur alt-ajan (SKILL.md).
const HUKUM_SEMASI = { hukum: "TAM|EKSIK|RED", bulgular: ["<dosya:satır — sorun — kanıt>"] };
const IS_SEMASI = { dosyalar: [], ozet: "" };

// Adversarial verify: bağımsız şüpheciler, farklı lens, REFUTE görevi (çoğunluk kuralı).
const LENSLER = [
  "correctness: kabul kriterleri gerçekten karşılanıyor mu",
  "repro: değişiklik temiz ortamda koşuyor mu, kanıt komutları gerçek mi",
];

// R7 tek yazar: yazan adım yalnız `uygula`/`duzelt` (pipeline sıralı — aynı anda tek yazar).
let is = await agent(
  `<GÖREV: ne uygulanacak, hangi dosyalar, hangi mevcut desen> — KABUL: <KABUL>\n${SINIR}`,
  { label: "uygula", phase: "uygula", schema: IS_SEMASI });

let sonuc = { sonuc: "EKSIK", is }; // döngü tavanı dolarsa hüküm dışarıya, karar çağırana
for (let tur = 0; tur < meta.maxDongu; tur++) {
  const hukumler = [];
  for (const lens of LENSLER.slice(0, meta.maxParalel)) {
    hukumler.push(await agent(
      `REFUTE görevi (${lens}): şu işin EKSİK/YANLIŞ olduğunu kanıtlamaya çalış: ${JSON.stringify(is)}. Kanıt bulamazsan hukum=TAM de.\n${SINIR}`,
      { label: `verify-${lens.split(":")[0]}`, phase: "verify", schema: HUKUM_SEMASI }));
  }
  const red = hukumler.filter((h) => h.hukum !== "TAM");
  if (red.length * 2 < hukumler.length) { sonuc = { sonuc: "TAM", is, hukumler }; break; } // çoğunluk TAM
  if (budget && budget.remaining() <= 0) { sonuc = { sonuc: "BUTCE", is, hukumler }; break; }
  is = await agent(
    `Şu bulguları gider: ${JSON.stringify(red.flatMap((h) => h.bulgular))}. Orijinal görev: <GÖREV>\n${SINIR}`,
    { label: `duzelt-${tur}`, phase: "duzelt", schema: IS_SEMASI });
}

return sonuc;
