# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 82907ee34c1c -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 262 |
| ilk / son iş | 2026-08-06 / 2026-08-11 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-11 | `test` | add normal-sync cohort fixture | `f3d1e21cc` |
| 2026-08-11 | `feat` | add read-only decision timeline | `d27a834c0` |
| 2026-08-11 | `feat` | bind frozen objective to planning brief | `6451c7843` |
| 2026-08-11 | `feat` | add taxonomy-bound planning variants | `1e68a0db2` |
| 2026-08-11 | `feat` | compose private creative window reader | `ca172561a` |
| 2026-08-11 | `feat` | capture direct all-days creative frequency | `a056bfdbc` |
| 2026-08-11 | `feat` | materialize creative fatigue evidence | `7c76a5ff1` |
| 2026-08-11 | `feat` | bind creative windows to settlement policy | `f73f1b734` |
| 2026-08-11 | `feat` | persist creative settlement policies | `a1413a5b7` |
| 2026-08-11 | `feat` | define creative settlement policy | `0e7685c3e` |
| 2026-08-11 | `feat` | materialize creative config evidence | `5727cab8d` |
| 2026-08-11 | `feat` | request daily frequency evidence | `44c56bfda` |
| 2026-08-11 | `feat` | load published creative definitions | `20fec4e4b` |
| 2026-08-11 | `feat` | add creative definition lifecycle writer | `585f73e8c` |
| 2026-08-11 | `feat` | gate creative diagnostic definition revisions | `5a5793bce` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 50
- `test        ` ██ 5
- `fix         ` █ 3
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
