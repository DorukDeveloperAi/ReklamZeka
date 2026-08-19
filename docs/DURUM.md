# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 4239d5f1feac -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 622 |
| ilk / son iş | 2026-08-06 / 2026-08-18 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-18 | `fix` | accept renamed budget route guard in post verifier | `e80d1b663` |
| 2026-08-18 | `fix` | recheck guide scheduler rollout on tick | `ade884e01` |
| 2026-08-18 | `fix` | stop status scheduler when rollout closes | `11c57ef37` |
| 2026-08-18 | `fix` | stop budget scheduler when rollout closes | `1dd3b341c` |
| 2026-08-18 | `fix` | tolerate forward route catalog extensions | `59cf70624` |
| 2026-08-18 | `feat` | gate human rename execution runtime | `8a62f6749` |
| 2026-08-18 | `fix` | compare rename values in execution worker | `82e76ea43` |
| 2026-08-18 | `feat` | persist human rename execution identity | `67bed7fb5` |
| 2026-08-18 | `feat` | extend disabled executor contract for rename | `f6a6fd3b2` |
| 2026-08-18 | `feat` | add human-only rename admission foundation | `7895988be` |
| 2026-08-18 | `feat` | complete operation saved view controls | `e5350c745` |
| 2026-08-18 | `docs` | record migration post acceptance | `103922ec7` |
| 2026-08-18 | `chore` | journal naming template lifecycle | `ab9a212a1` |
| 2026-08-18 | `test` | add naming template post verification | `149ddfc43` |
| 2026-08-18 | `chore` | journal saved scope reports | `718ea01c2` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 27
- `fix         ` ███████████ 12
- `test        ` ███████ 8
- `chore       ` ██████ 7
- `docs        ` █████ 6

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
