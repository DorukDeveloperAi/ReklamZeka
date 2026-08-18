# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: f779eb769eea -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 593 |
| ilk / son iş | 2026-08-06 / 2026-08-18 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-18 | `feat` | expose canonical guide lifecycle | `40b1288cf` |
| 2026-08-18 | `fix` | bind saved report replay and head evidence | `3dd0d9acd` |
| 2026-08-18 | `test` | verify real local Codex guide agents | `3738bf025` |
| 2026-08-18 | `feat` | add naming lifecycle and trusted status candidates | `3d4e19fe2` |
| 2026-08-18 | `feat` | add deferred approval decisions | `14dc65fc8` |
| 2026-08-18 | `feat` | harden disabled execution contract | `7516f34ba` |
| 2026-08-18 | `feat` | bind guide run status candidates | `a0621d103` |
| 2026-08-18 | `feat` | add accessible scope report interface | `12c1da0cb` |
| 2026-08-18 | `docs` | record xlsx and trusted context acceptance | `e0dfbe770` |
| 2026-08-17 | `feat` | persist guide runs and bind execution contracts | `ce6b86f7a` |
| 2026-08-17 | `docs` | record budget evidence acceptance | `c4ec16b17` |
| 2026-08-17 | `feat` | orchestrate recoverable guide runs | `70648005e` |
| 2026-08-17 | `feat` | persist primary result bindings | `6f85dd8dd` |
| 2026-08-17 | `feat` | harden run scheduling chain | `78b0a16eb` |
| 2026-08-17 | `feat` | add safe budget dry run | `205f88c98` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 33
- `docs        ` █████████ 13
- `fix         ` ██████ 8
- `test        ` ████ 6

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
