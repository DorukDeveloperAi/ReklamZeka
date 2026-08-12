# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: affece4b60c6 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 293 |
| ilk / son iş | 2026-08-06 / 2026-08-12 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-12 | `feat` | audit live campaign naming identity | `572f068ac` |
| 2026-08-12 | `fix` | bind physical therapy targeting to live read | `670ae7965` |
| 2026-08-12 | `feat` | preserve international physical therapy allocation | `f24175682` |
| 2026-08-12 | `feat` | add slice operating rule drafts | `5deb20f02` |
| 2026-08-11 | `feat` | add ephemeral operator notes | `389bb7e5f` |
| 2026-08-11 | `feat` | expose planning template library | `ac69c8e4f` |
| 2026-08-11 | `feat` | add planning sequence | `0b976f766` |
| 2026-08-11 | `feat` | open workbook lanes as drafts | `69d8af2cb` |
| 2026-08-11 | `feat` | add offline workbook portfolio snapshot | `7357644f1` |
| 2026-08-11 | `fix` | separate demo from live performance | `bb4ab0d88` |
| 2026-08-11 | `fix` | expose safe rotation guidance | `9f89d358f` |
| 2026-08-11 | `fix` | guide dashboard session bootstrap | `f99902c39` |
| 2026-08-11 | `fix` | accept zero-length route body | `28107999f` |
| 2026-08-11 | `feat` | add read-only Meta account focus | `a1039cfe1` |
| 2026-08-11 | `fix` | classify diagnostic JSONB dependencies | `677f3f351` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 44
- `fix         ` ████ 7
- `test        ` ███ 5
- `docs        ` ██ 4

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
