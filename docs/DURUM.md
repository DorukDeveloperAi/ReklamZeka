# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 8b5d9621adaa -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 583 |
| ilk / son iş | 2026-08-06 / 2026-08-17 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-17 | `docs` | record budget evidence acceptance | `c4ec16b17` |
| 2026-08-17 | `feat` | orchestrate recoverable guide runs | `70648005e` |
| 2026-08-17 | `feat` | persist primary result bindings | `6f85dd8dd` |
| 2026-08-17 | `feat` | harden run scheduling chain | `78b0a16eb` |
| 2026-08-17 | `feat` | add safe budget dry run | `205f88c98` |
| 2026-08-17 | `feat` | persist data health lifecycle | `53186edf9` |
| 2026-08-17 | `feat` | trust canonical primary result catalog | `25dfa99e6` |
| 2026-08-17 | `test` | lock table-first information architecture | `4db71800e` |
| 2026-08-17 | `docs` | record table-first browser checkpoint | `6fb2817e0` |
| 2026-08-17 | `feat` | make operations table first | `a178e25f4` |
| 2026-08-17 | `docs` | open primary result binding vertical | `8d5bc5616` |
| 2026-08-17 | `docs` | record operation and health ledger gates | `e2e808189` |
| 2026-08-17 | `fix` | expose local session boundary | `68c445484` |
| 2026-08-17 | `feat` | persist canonical lifecycle | `a8f5be677` |
| 2026-08-17 | `feat` | resolve canonical current slices | `d4e3e7078` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 30
- `docs        ` ███████████ 14
- `fix         ` ███████ 9
- `test        ` ██████ 7

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
