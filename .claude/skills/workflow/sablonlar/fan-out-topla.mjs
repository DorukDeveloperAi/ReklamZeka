// fan-out-topla — gerçekten paralel bölünebilen iş için (Anthropic dersi: fan-out
// YALNIZ bağımsız parçalarda; her işçiye hedef + çıktı formatı + sınır verilir).
// Bu şablon DOSYA YAZMAZ: işçiler ve toplayıcı yalnız JSON üretir; yazma kararı
// çağıran oturumundur (R3/R7 — tek yazar workflow dışında kalır).
//
// SÖZLEŞME (asama-00 kanıtı — bağlayıcı): TOP-LEVEL await; `export default` YOKTUR.
// `agent` / `parallel` GLOBAL'dir; girdi `args` GLOBAL'inden gelir. `meta` saf literal.
// KOPYALA-UYARLA: <parça başına iş tarifi> + şema alanlarını doldur; sonra kapıdan geçir:
//   node .claude/skills/workflow/scripts/dogrula.mjs <bu-dosya>
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
  name: "fan-out-topla",
  description: "Bağımsız parçalara şemalı paralel işçi, sonra tek toplayıcı.",
  phases: [{ title: "islet" }, { title: "topla" }],
  maxParalel: 4, // R4 tavanı — dilimleme AŞAĞIDA buna bağlanır, başka sabit YASAK
};

// R2: her işçiye SINIR — işçi ajan ALT-AJAN DOĞURAMAZ; fan-out yalnız bu script'te.
const SINIR = "SINIR: Bu adımda alt-ajan doğurma; Task/Agent/Workflow araçlarını çağırma; yalnız kendi parçanı işle ve çıktıyı beyan edilen şemada döndür.";
const ISCI_SEMASI = { parca: "", bulgular: [], guven: "yuksek|orta|dusuk" };

// Çağıran `args.parcalar`'ı sağlar: bağımsız, kesişimsiz parça listesi (yoksa boş).
const parcalar = (args && args.parcalar) || [];
const sonuclar = [];
for (let i = 0; i < parcalar.length; i += meta.maxParalel) { // K6: dilim = meta.maxParalel
  const dilim = parcalar.slice(i, i + meta.maxParalel);
  const kume = await parallel(dilim.map((p, j) => () => agent(
    `HEDEF: <parça başına iş tarifi> — parça: ${JSON.stringify(p)}\nÇIKTI FORMATI: beyan edilen şema, başka hiçbir şey.\n${SINIR}`,
    { label: `isci-${i + j}`, phase: "islet", schema: ISCI_SEMASI })));
  sonuclar.push(...kume);
}

// Tek toplayıcı: işçi çıktılarını birleştirir, çelişkileri İLAN eder — yine yalnız JSON.
return await agent(
  `Şu işçi çıktılarını birleştir, çelişkileri İLAN et, tek rapor üret: ${JSON.stringify(sonuclar)}\n${SINIR}`,
  { label: "topla", phase: "topla", schema: { rapor: "", celiskiler: [], parcaSayisi: 0 } });
