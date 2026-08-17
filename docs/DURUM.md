# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 9b42ded0be53 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 570 |
| ilk / son iş | 2026-08-06 / 2026-08-17 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-17 | `feat` | persist canonical lifecycle | `a8f5be677` |
| 2026-08-17 | `feat` | resolve canonical current slices | `d4e3e7078` |
| 2026-08-17 | `feat` | persist canonical budget history | `9158181bd` |
| 2026-08-17 | `feat` | add current slice resolver adapter | `3a2bf9c53` |
| 2026-08-17 | `feat` | resolve restrictive overlap authority | `21c63dff1` |
| 2026-08-17 | `fix` | require canonical account timezone | `9ef530049` |
| 2026-08-17 | `fix` | preserve hierarchy pagination and ownership | `182930db4` |
| 2026-08-17 | `feat` | gate actions on canonical data health | `38ebc5aec` |
| 2026-08-17 | `feat` | complete canonical read aggregation | `d0c4323a2` |
| 2026-08-17 | `fix` | bind health reports to workspace | `1cce3fcd4` |
| 2026-08-17 | `feat` | filter canonical current slice coverage | `f63c4e0f6` |
| 2026-08-17 | `feat` | add session-bound read route | `a68f621fa` |
| 2026-08-17 | `feat` | separate policy and daily agents | `c56e13e1c` |
| 2026-08-17 | `feat` | add guarded read service contract | `76a9f9e60` |
| 2026-08-17 | `fix` | harden read model evidence contract | `3dd58e054` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 27
- `fix         ` ████████████ 13
- `docs        ` █████████ 10
- `test        ` ██████ 7
- `?           ` ███ 3

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
