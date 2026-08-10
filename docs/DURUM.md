# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: d413a87d7470 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 162 |
| ilk / son iş | 2026-08-06 / 2026-08-10 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-10 | `feat` | compose evidence-bound analysis contexts | `f64d77c3c` |
| 2026-08-10 | `test` | cover cadence context live verifier | `1d2ee6e20` |
| 2026-08-10 | `feat` | bind cadence evidence to contexts | `5c5f4a382` |
| 2026-08-10 | `feat` | compose current category profiles | `cd3026f76` |
| 2026-08-10 | `feat` | freeze meta analysis config evidence | `f7089add3` |
| 2026-08-10 | `fix` | harden agenda replay and guidance guards | `593a8a249` |
| 2026-08-10 | `feat` | expose frozen outcome evidence to findings | `57dfc870b` |
| 2026-08-10 | `feat` | compose persisted outcome evidence into context | `aa8935439` |
| 2026-08-10 | `feat` | persist outcome evidence snapshots | `e84ca60ed` |
| 2026-08-10 | `feat` | add compact business outcome evidence | `7cafd712a` |
| 2026-08-10 | `feat` | add bounded business outcome reads | `ec1e91b6e` |
| 2026-08-10 | `feat` | add server-bound business outcome intake | `95b840c88` |
| 2026-08-10 | `feat` | persist normalized business outcomes | `9fc14ef87` |
| 2026-08-10 | `feat` | expose experiment evidence lifecycle | `7c5cb9999` |
| 2026-08-10 | `feat` | add server-bound cadence publication | `c2269a8f3` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 38
- `docs        ` ████████ 13
- `fix         ` ███ 5
- `chore       ` ██ 3
- `test        ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
