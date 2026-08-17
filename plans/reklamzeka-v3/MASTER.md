# ReklamZeka v3 — Kanonik Ürün ve Uygulama Plan Zinciri

## Ürün hedefi

`Meta → künye → Kurum Kampanyası/slice → Kılavuz → koşum → analiz → bulgu/öneri → karar → uygulama → doğrulama → geçmiş`

Sistem guide-centric, holistic çalışır: her Kılavuz tam olarak **bir slice + frequency + mode + closed actions** taşır; koşum aynı kapsamın bütün kanıtını değerlendirir.

## Değişmezler

- Yerli/yabancı market sınırı mutlak; overlapta en kısıtlayıcı kural geçerlidir.
- Kullanıcı-facing tek kavram Kılavuzdur; free text ve strict yapı birlikte yaşar. Guide Agent önerir, explicit kullanıcı transferi/kaydı olmadan saklayamaz; Daily Agent Kılavuz düzenleyemez.
- İsim gerçek değildir; Meta kurulumu/içerik/sonuç kanıtıyla çelişen veya eksik künye review’a gider. Primary result kullanıcı seçimi/override’dır, sistem tahmin etmez.
- Bir Meta nesnesinin en çok bir current organization membership’i vardır; eşleşmeyen virtual Atanmamış’tadır.
- Tek yetkili insan karar verir. Otonomi yalnız budget/status; rename yalnız insan; create yoktur. Kill switch her write yolunu kapatır.
- Write typed, idempotent, preflightlı, read-after-write doğrulamalı ve append-only audittedir.

## Beş alan

**Operasyon, Kılavuzlar, Analiz, Kararlar, Sistem.** P07 bu kabuğu ve ortak davranışları teslim eder.

## Kanonik graph

```text
M00 → P01 → P02 → P03 → P04 → P05 → P06
                    P07 (paralel)
P08 tüm zincirde cross-cutting gate
```

| Paket | Kanonik teslim |
|---|---|
| [P01](P01-meta-veri-sagligi.md) | meta-veri-sagligi |
| [P02](P02-kurum-kampanyasi-kunye.md) | kurum-kampanyasi-kunye |
| [P03](P03-slice-operasyon-rapor.md) | slice-operasyon-rapor |
| [P04](P04-kilavuz-butce.md) | kilavuz-butce |
| [P05](P05-agent-analiz-kosum.md) | agent-analiz-kosum |
| [P06](P06-karar-otonomi-uygulama.md) | karar-otonomi-uygulama |
| [P07](P07-ui-ux.md) | ui-ux (paralel) |
| [P08](P08-kabul-rollout.md) | kabul-rollout (cross gate) |

## Runner/evidence/stall

Runner sırayı uygular; P07 paralel ilerler, P08 her merge/release kapısıdır. Her koşum requirement ID, kaynak/frozen context, diff, test/DB/RLS/browser çıktısı, rollout flag, action/RAW/rollback kanıtını evidence-pack’e yazar. Stall ancak tekrarlanan somut gate hatası, kanıtı ve güvenli çözüm denemeleriyle kaydedilir; kapsam/authority değişikliği ana sürücüye döner.

