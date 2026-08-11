# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: ec5f69d5de07 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 234 |
| ilk / son iş | 2026-08-06 / 2026-08-11 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-11 | `test` | verify candidate preview binding lifecycle | `e5b49c134` |
| 2026-08-11 | `test` | compose candidate preview lifecycle fixture | `643973024` |
| 2026-08-11 | `fix` | harden candidate authority evidence | `a2713940e` |
| 2026-08-11 | `fix` | validate candidate binding migration and share fixture | `8aa09a476` |
| 2026-08-11 | `feat` | bind G3 replay to verified evidence | `23f2fa992` |
| 2026-08-11 | `fix` | verify closed-world source persistence | `8092d47d5` |
| 2026-08-11 | `feat` | bridge campaign context approval scope | `15f8aab25` |
| 2026-08-10 | `feat` | scope approval inbox by campaign context | `6a2ec7a98` |
| 2026-08-10 | `feat` | bind briefs to persisted context state | `b2180c942` |
| 2026-08-10 | `feat` | expose read-only campaign context | `6df768290` |
| 2026-08-10 | `feat` | derive read-only campaign recommendations | `025aab9fe` |
| 2026-08-10 | `feat` | scope approval reads by campaign hierarchy | `76b74e4a3` |
| 2026-08-10 | `feat` | scope approval queue reads by entity | `eca77a011` |
| 2026-08-10 | `feat` | expose execution safety status | `cf83522f6` |
| 2026-08-10 | `feat` | define verify and rollback contract | `158da5ad7` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 46
- `fix         ` ████ 7
- `test        ` ███ 6
- `docs        ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
