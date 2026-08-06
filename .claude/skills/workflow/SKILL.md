---
name: workflow
description: Çok parçalı / paralel bölünebilir bir işi Dynamic Workflow ile orkestre etme kütüphanesi — iki kanon şablon (uygula-doğrula: adversarial verify'lı pipeline · fan-out-topla: şemalı paralel işçiler) + deterministik şema kapısı. Kullanıcı "workflow", "orkestrasyon", "fan-out", "paralel işçi", "uygula-doğrula", "adversarial verify", "çok adımlı pipeline" dediğinde ya da /workflow çağrıldığında kullan. Skill kendisi LLM DOĞURMAZ (şablon + kapı, 0 token); LLM'i workflow'u KOŞAN oturum doğurur.
rol: ajan
---

# workflow — Dynamic Workflow şablon kütüphanesi + şema kapısı

Bu skill **deterministiktir**: kanon şablon + kapı, **0 token**. LLM'i workflow'u KOŞAN oturum
doğurur; koşum köprüsü ayrı katmandır (`kosum: workflow:` beyanı — plan katmanı aşama 03).

## 1. Ne zaman

Bir görev **karmaşıklık kapısından** (bkz. `/plan-kur` `kosum:` karar kılavuzu — ≥3 bağımsız
paralel parça · adversarial doğrulama · adım-memoizasyonu ölçütlerinden en az biri) geçiyorsa
workflow açılır. **Tek dosyalık bilinen bir düzeltmeye workflow AÇILMAZ** — doğrudan yap. Fan-out
ancak parçalar GERÇEKTEN bağımsızsa kazançlıdır (Anthropic dersi: gereksiz fan-out ~15x token yakar).

## 2. Şablonlar

Kütüphanede iki kanon şablon var (`sablonlar/`). Kullanım: **projeye kopyala → placeholder'ları
doldur (`<GÖREV>`, `<KABUL>`, şema alanları) → KAPIDAN geçir**; kapı exit 0 vermeden workflow koşulmaz.

| şablon | ne zaman | biçim |
|---|---|---|
| `sablonlar/uygula-dogrula.mjs` | sıralı iş + bağımsız doğrulama gerekiyorsa | uygula → adversarial verify (yazarsız) → düzelt döngüsü (tavan `meta.maxDongu`) |
| `sablonlar/fan-out-topla.mjs` | iş GERÇEKTEN bağımsız parçalara bölünüyorsa | şemalı paralel N işçi (`meta.maxParalel`'e dilimli) → tek toplayıcı; **dosya yazmaz** |

Kapı:

```bash
node .claude/skills/workflow/scripts/dogrula.mjs <sablon.mjs>   # exit 0 = temiz, exit 1 = ihlal
node .claude/skills/workflow/scripts/dogrula.mjs                # argümansız → sablonlar/*.mjs tarar
```

Kanıt artefaktı (04 — koşum SONU, `plans/` bağlamında):

```bash
node .claude/skills/workflow/scripts/wf-artefakt.mjs --run <runId> --proje <kök> --slug <s> --v <N> --asama <no>
```

Motor (deterministik, 0 token): workflow run kaydından adım tablosu + model kırılımı çıkarır,
`kanit/asama-NN-workflow-<runId>.json`+`.txt` yazar ve `aide usage wf-yaz` chokepoint'iyle
`usage.jsonl`'a **workflow** satırını düşürür (runId dedupe → idempotent). Sonra
`aide rota kanit --sinif hizli` exit 0 olmadan aşama "bitti" YAZILMAZ.

## 3. Kurallar (global requirements'ın skill'e inen hâli — kapı ZORLAR, niyete bırakmaz)

- **Koşum sözleşmesi (K7):** Workflow script'i **TOP-LEVEL await** koşar; `export const meta` saf
  literaldir; `agent`/`parallel`/`pipeline`/`budget`/`args` **GLOBAL**'dir; sonuç `return` ile döner.
  `export default` YAZMA (fonksiyon çağrılmaz, gövde doğrudan koşar).
- **Fan-out yalnız script'te (K4/R2):** her adım ajanının prompt'una SINIR cümlesi konur — adım ajanı
  **alt-ajan doğuramaz** (Task/Agent/Workflow çağırmaz). Kapı K4 ile ölçer.
- **Verify yazarsız (K3/R3):** doğrulama adımı yalnız HÜKÜM JSON'u üretir; çağrısında yazar araç
  (Edit/Write/NotebookEdit) adı bile geçmez. Gerçek Workflow `agent` çağrısı per-call `tools`
  allowlist'i SUNMAZ (asama-00 kanıtı) → kısıt SINIR + hüküm şemasıyla sağlanır. **Sertleştirme
  (opsiyonel, önerilir):** verify adımını `agentType` ile salt-okunur bir alt-ajana bağla.
- **`maxParalel` şema-zorunlu ve ≤4 (K1):** paralellik tavanı `meta`'da literal; dilimleme buna
  bağlanır, gövdeye sabit sayı yazılmaz (K6).
- **Her agent çıktısı şemalı (K2):** şemasız çıktı toplanamaz.
- **Tek yazar (R7):** uygula-dogrula'da yazan adım yalnız `uygula`/`duzelt` (sıralı); fan-out-topla
  hiç yazmaz — yazma kararı çağıran oturumdadır.
- **Determinizm (K5):** `Date.now()`/`Math.random()`/`new Date()` YASAK — resume adım-cache'ini kırar;
  zamansal/rastgele değer `args`'tan gelir.

## 4. Sınıf beyanı (terimler sözleşmesi)

Bu skill **deterministiktir** — şablon + kapı, **0 token**. Kapı (`dogrula.mjs`) şablonu
ÇALIŞTIRMAZ; metin-tabanlı statik analizle K1–K7'yi ölçer, hiçbir dosya yazmaz. Kanıt harness'ı:
`node .claude/skills/workflow/proof/proof.mjs` → `PROOF 14/14`. LLM'i workflow'u **KOŞAN** oturum
doğurur; koşum köprüsü ayrı katmandır.

## 5. Muafiyet (İLAN)

- Bu skill **koşum başlatmaz**: `kosum: workflow: <sablon-ref>` beyanının köprüye çevrilmesi
  (`hazirla.mjs` entegrasyonu) aşama 03'ün işidir; bütçe/resume derinliği aşama 04.
- Kapı **kanon biçimi** zorlar, düşman kodunu değil: `agent`'ı dinamik ad arkasına saklayan
  (`const a = agent; a(...)`) şablonu göremez — şablondan türet, biçimi bozma.
