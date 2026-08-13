# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 8027afe592c1 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 434 |
| ilk / son iş | 2026-08-06 / 2026-08-14 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-14 | `fix` | preserve category composition diagnostics | `dadf63549` |
| 2026-08-14 | `fix` | publish approval chain category profiles | `26983ac27` |
| 2026-08-14 | `fix` | retry tombstone transport failures | `dadb6dc62` |
| 2026-08-14 | `fix` | align fixture insight date to analysis window | `029a34eeb` |
| 2026-08-14 | `test` | read authentic queue projection | `6a70c7c1a` |
| 2026-08-14 | `test` | verify authentic rule budget queue chain | `d71df2d9b` |
| 2026-08-14 | `refactor` | share ready budget context fixture | `36061fcee` |
| 2026-08-14 | `docs` | record frozen action context binding | `5a5aacb50` |
| 2026-08-14 | `fix` | bind materialized units to frozen context | `6d7796951` |
| 2026-08-14 | `docs` | record slice readiness projection | `2a0713f0c` |
| 2026-08-14 | `feat` | show frozen context readiness | `c5814def6` |
| 2026-08-14 | `docs` | record manual classification handoff | `7d95faba7` |
| 2026-08-14 | `feat` | hand off review rows to manual assignment | `ebf137c8d` |
| 2026-08-14 | `docs` | record canonical campaign portfolio | `664b14f98` |
| 2026-08-14 | `feat` | show canonical campaign portfolio | `6d3298f67` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 20
- `fix         ` ████████████████████ 17
- `docs        ` ███████████████████ 16
- `test        ` ██████ 5
- `chore       ` █ 1
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
