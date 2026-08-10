# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 8366bd20c929 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 182 |
| ilk / son iş | 2026-08-06 / 2026-08-10 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-10 | `test` | verify authority impact fail-closed | `a530aa6f5` |
| 2026-08-10 | `feat` | evaluate authority impact by family | `2506a492e` |
| 2026-08-10 | `feat` | persist verified policy compositions | `50a11045d` |
| 2026-08-10 | `fix` | invalidate persisted authority contexts | `7a3d94be2` |
| 2026-08-10 | `test` | verify private root persistence | `58335118f` |
| 2026-08-10 | `fix` | permit selection tombstone purge | `b6a051bfe` |
| 2026-08-10 | `fix` | classify guidance selection storage | `21c384169` |
| 2026-08-10 | `feat` | wire private analysis context composer | `add0d55b4` |
| 2026-08-10 | `docs` | record ready source bundle evidence | `4c85d52ad` |
| 2026-08-10 | `feat` | assemble ready analysis source bundles | `ec66e64c6` |
| 2026-08-10 | `feat` | bind authority to source snapshots | `4fcf60ffe` |
| 2026-08-10 | `test` | cover guidance selection revisions | `fe302fdfd` |
| 2026-08-10 | `feat` | compose selected guidance snapshots | `b8adfacd0` |
| 2026-08-10 | `feat` | compose categories in source snapshots | `7a23913f7` |
| 2026-08-10 | `feat` | bind guidance selections to campaigns | `e0ddf6972` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 41
- `fix         ` █████ 9
- `test        ` ██ 4
- `chore       ` ██ 3
- `docs        ` ██ 3

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
