# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 09ec6ba64e5e -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 473 |
| ilk / son iş | 2026-08-06 / 2026-08-15 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-15 | `feat` | guide users to skill setup | `6cc0c97c0` |
| 2026-08-15 | `feat` | add soft Meta light theme | `0c9687f07` |
| 2026-08-14 | `feat` | expose frozen turn evidence | `42f0364f0` |
| 2026-08-14 | `feat` | bind workspace playbooks to turns | `a483e4e3b` |
| 2026-08-14 | `fix` | enforce user-authored rule boundaries | `653f647a8` |
| 2026-08-14 | `feat` | guide pool hierarchy drafts | `40bcb182e` |
| 2026-08-14 | `feat` | revise user playbooks safely | `ad6044644` |
| 2026-08-14 | `feat` | show read-only decision trace | `3996b7e91` |
| 2026-08-14 | `fix` | retain operational audit coverage | `04d011008` |
| 2026-08-14 | `feat` | add unified preparation gate | `92a7ddf3d` |
| 2026-08-14 | `feat` | manage skill catalog in rules | `4fe3836ce` |
| 2026-08-14 | `feat` | show safe skill catalog context | `3bd1ca607` |
| 2026-08-14 | `feat` | add guarded scenario selection | `d79562e58` |
| 2026-08-14 | `feat` | add private skill catalog route acceptance | `c27504ecd` |
| 2026-08-14 | `feat` | add skill catalog repository and panel | `aed4290b8` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 24
- `fix         ` ██████████████ 14
- `test        ` ████████████ 12
- `docs        ` ███████ 7
- `?           ` ██ 2
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
