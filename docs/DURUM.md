# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: f377c2c6f766 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 382 |
| ilk / son iş | 2026-08-06 / 2026-08-13 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-13 | `docs` | record empty bounded insight recovery | `13b515647` |
| 2026-08-13 | `fix` | bound Meta insight recovery to one day | `e875877d5` |
| 2026-08-13 | `docs` | record partial live asset recovery | `6027dde23` |
| 2026-08-13 | `fix` | replay only verified actor post bindings | `b6179d9a2` |
| 2026-08-13 | `fix` | report bounded materialization failures | `05afe327a` |
| 2026-08-13 | `feat` | materialize bounded S1.4 recovery | `d514ff535` |
| 2026-08-13 | `fix` | bootstrap live recovery from S1.4 reads | `44f71e06e` |
| 2026-08-13 | `chore` | add live recovery verifier | `984fd836b` |
| 2026-08-13 | `fix` | recover actor posts from creative evidence | `a2a74a601` |
| 2026-08-13 | `docs` | record allocation binding writer | `f9e3cdc77` |
| 2026-08-13 | `feat` | add server-private allocation binding writer | `506add07b` |
| 2026-08-13 | `docs` | record temporal and allocation foundations | `f10112eb3` |
| 2026-08-13 | `—` | Add immutable slice rule allocation bindings | `acdaa0842` |
| 2026-08-13 | `feat` | expose temporal recommendation ledger safely | `700bdf3de` |
| 2026-08-13 | `feat` | add temporal evaluation ledger | `07261d2fe` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 23
- `fix         ` ████████████████████ 19
- `docs        ` █████████████ 12
- `chore       ` ██ 2
- `test        ` ██ 2
- `?           ` █ 1
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
