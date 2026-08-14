# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 02043cf6096a -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 447 |
| ilk / son iş | 2026-08-06 / 2026-08-14 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-14 | `test` | bound queue verifier transport | `de22424a1` |
| 2026-08-14 | `test` | retry tombstone transport | `b9e55c672` |
| 2026-08-14 | `test` | complete guardrail category context | `ae91bcce6` |
| 2026-08-14 | `test` | materialize active ad set evidence | `4b8187658` |
| 2026-08-14 | `test` | bind ad set category evidence | `4f9d5407e` |
| 2026-08-14 | `test` | evaluate guardrails at command time | `438d52f9d` |
| 2026-08-14 | `test` | materialize complete guardrail evidence | `cddda92c0` |
| 2026-08-14 | `fix` | bind geo evidence through hierarchy | `3377eee7b` |
| 2026-08-14 | `fix` | label trust freshness in hours | `294e5e398` |
| 2026-08-14 | `fix` | enforce published budget guardrails | `2834bf3f7` |
| 2026-08-14 | `fix` | make budget approval scenario selectable | `edb2b8d03` |
| 2026-08-14 | `fix` | bind approval fixture hierarchy evidence | `c1e68ad04` |
| 2026-08-14 | `fix` | align approval chain source evidence | `82b419413` |
| 2026-08-14 | `fix` | preserve category composition diagnostics | `dadf63549` |
| 2026-08-14 | `fix` | publish approval chain category profiles | `26983ac27` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `fix         ` ████████████████████████ 19
- `feat        ` ████████████████████ 16
- `docs        ` ███████████████ 12
- `test        ` ███████████████ 12
- `refactor    ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
