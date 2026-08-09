# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 15501aa2d97b -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 134 |
| ilk / son iş | 2026-08-06 / 2026-08-09 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-09 | `feat` | harden category and Meta read contracts | `0237143f3` |
| 2026-08-09 | `feat` | add selector mapping preview | `44c670e0b` |
| 2026-08-09 | `chore` | quarantine legacy control plane | `cd675c679` |
| 2026-08-09 | `feat` | guard lifecycle mutations | `6d0591f31` |
| 2026-08-08 | `chore` | merge sonrası türevleri üreticiden yeniden üret | `07fc6819b` |
| 2026-08-08 | `chore` | tema ayarları ve oturum kasası kaydı | `8916ab22f` |
| 2026-08-08 | `feat` | scan effective portfolio health | `c90883c4c` |
| 2026-08-08 | `feat` | preview archive impact safely | `86284c17a` |
| 2026-08-08 | `feat` | surface evidence confidence health | `e65579e21` |
| 2026-08-08 | `feat` | add read-only inventory dashboard | `c0c3f2f70` |
| 2026-08-08 | `fix` | guide local session recovery | `49d98f771` |
| 2026-08-08 | `feat` | add multi-scope authoring | `19eac50de` |
| 2026-08-08 | `feat` | invalidate stale campaign contexts | `ee0e41193` |
| 2026-08-08 | `feat` | add guidance context tools | `65cbab3a8` |
| 2026-08-08 | `feat` | add category-bound studio | `9ddd42599` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 31
- `docs        ` ███████████████ 20
- `test        ` ███ 4
- `chore       ` ██ 3
- `fix         ` ██ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
