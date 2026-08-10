# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 3d73e12990e5 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 221 |
| ilk / son iş | 2026-08-06 / 2026-08-10 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-10 | `feat` | expose execution safety status | `cf83522f6` |
| 2026-08-10 | `feat` | define verify and rollback contract | `158da5ad7` |
| 2026-08-10 | `feat` | bind admission ceremony to persisted source | `7f5858125` |
| 2026-08-10 | `feat` | add separate execution admission ceremony | `83b8600fe` |
| 2026-08-10 | `feat` | revalidate admission against Meta mirror | `ce1807263` |
| 2026-08-10 | `feat` | bind eligibility into execution admission | `1d59e1932` |
| 2026-08-10 | `feat` | add Meta write eligibility matrix | `cd904ed39` |
| 2026-08-10 | `feat` | add interactive campaign brief panel | `638674a54` |
| 2026-08-10 | `feat` | persist disabled execution admissions | `8c7af77a0` |
| 2026-08-10 | `feat` | add disabled execution admission gate | `46e402276` |
| 2026-08-10 | `feat` | add typed Meta write spec boundary | `e913e65bf` |
| 2026-08-10 | `feat` | add portfolio capability reader | `4e5d6e4b8` |
| 2026-08-10 | `feat` | sequence interactive campaign briefs | `e6bdb2d88` |
| 2026-08-10 | `feat` | compose timeframe-bound L3 contexts | `dacf92810` |
| 2026-08-10 | `feat` | require L3 evidence for decision runs | `23a8f1b8f` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 48
- `fix         ` ███ 5
- `test        ` ███ 5
- `docs        ` █ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
