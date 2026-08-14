# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: edda929f6992 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 465 |
| ilk / son iş | 2026-08-06 / 2026-08-14 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-14 | `fix` | retain operational audit coverage | `04d011008` |
| 2026-08-14 | `feat` | add unified preparation gate | `92a7ddf3d` |
| 2026-08-14 | `feat` | manage skill catalog in rules | `4fe3836ce` |
| 2026-08-14 | `feat` | show safe skill catalog context | `3bd1ca607` |
| 2026-08-14 | `feat` | add guarded scenario selection | `d79562e58` |
| 2026-08-14 | `feat` | add private skill catalog route acceptance | `c27504ecd` |
| 2026-08-14 | `feat` | add skill catalog repository and panel | `aed4290b8` |
| 2026-08-14 | `feat` | add read-only skill catalog context strip | `fba099714` |
| 2026-08-14 | `feat` | add skill catalog application service | `dd816b584` |
| 2026-08-14 | `feat` | add immutable skill catalog package one | `04814eb4e` |
| 2026-08-14 | `feat` | simplify shell to monitor manage agent | `f22413287` |
| 2026-08-14 | `test` | guard canonical temporal feed | `3e97de2a4` |
| 2026-08-14 | `test` | harden public source states | `670288d39` |
| 2026-08-14 | `—` | DURUM türevlerini de merge=ours ile beyan et (agent-ide emsali) | `e709edff3` |
| 2026-08-14 | `—` | aide türevlerini merge=ours ile beyan et — boot'u öldüren çakışmanın kök nedeni | `0b287b002` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 19
- `fix         ` █████████████████████ 17
- `test        ` ██████████████████ 14
- `docs        ` █████████ 7
- `?           ` ███ 2
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
