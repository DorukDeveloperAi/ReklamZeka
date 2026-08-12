# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: d057d80784a9 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 305 |
| ilk / son iş | 2026-08-06 / 2026-08-12 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-12 | `feat` | classify audience and platform scope | `914aa6406` |
| 2026-08-12 | `feat` | show applicable portfolio rules | `bf6720d23` |
| 2026-08-12 | `feat` | catalog current portfolio scopes | `8b86fa5f8` |
| 2026-08-12 | `feat` | resolve scoped campaign evaluation cohorts | `303223af3` |
| 2026-08-12 | `feat` | scope comparisons by campaign family | `728f53432` |
| 2026-08-12 | `feat` | recognize route naming variants safely | `4538eba61` |
| 2026-08-12 | `feat` | scope rules to campaign families | `930eb9e7c` |
| 2026-08-12 | `feat` | add temporal review semantics | `cdb1c2465` |
| 2026-08-12 | `fix` | separate campaign identity from conversion route | `60e04fb25` |
| 2026-08-12 | `feat` | support scoped evaluation cohorts | `85f777d15` |
| 2026-08-12 | `feat` | separate international acquisition measurement lanes | `e00015c6b` |
| 2026-08-12 | `feat` | enforce domestic foreign portfolio boundary | `3cead9cef` |
| 2026-08-12 | `feat` | audit live campaign naming identity | `572f068ac` |
| 2026-08-12 | `fix` | bind physical therapy targeting to live read | `670ae7965` |
| 2026-08-12 | `feat` | preserve international physical therapy allocation | `f24175682` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 48
- `fix         ` ████ 8
- `docs        ` █ 2
- `test        ` █ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
