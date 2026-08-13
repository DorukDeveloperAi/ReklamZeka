# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: bdc59adcf991 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 354 |
| ilk / son iş | 2026-08-06 / 2026-08-13 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-13 | `docs` | record Meta mirror recovery progress | `780e52f7e` |
| 2026-08-13 | `fix` | checkpoint bounded read sync runs | `7be94eb7d` |
| 2026-08-13 | `fix` | allow bounded retries for read sync recovery | `5f4d941fa` |
| 2026-08-13 | `feat` | bind saved budget drafts to exact slice rules | `73f85b51e` |
| 2026-08-13 | `docs` | include budget proposal operational trace | `04b1924a1` |
| 2026-08-13 | `feat` | include verified budget proposal traces | `a11c0dbbb` |
| 2026-08-13 | `docs` | record Meta sync checkpoint coverage | `ac3db6610` |
| 2026-08-13 | `fix` | recover durable sync checkpoints without callback transactions | `3724584f2` |
| 2026-08-13 | `docs` | reconcile delivered operation surfaces | `5f282256b` |
| 2026-08-13 | `chore` | serialize local read sync channel | `f9cde2fc1` |
| 2026-08-13 | `feat` | add idempotent inventory bootstrap fallback | `7e29715fc` |
| 2026-08-13 | `docs` | record partial live Meta mirror | `0164bc3de` |
| 2026-08-13 | `feat` | support deferred affected geo backfill | `b69b83747` |
| 2026-08-13 | `fix` | bound initial targeting sync pages | `82dc46ace` |
| 2026-08-13 | `fix` | classify budget pool JSONB surfaces | `b63075483` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 34
- `fix         ` █████████ 13
- `docs        ` ██████ 9
- `test        ` █ 2
- `chore       ` █ 1
- `perf        ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
