# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 39950fea3c12 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 175 |
| ilk / son iş | 2026-08-06 / 2026-08-10 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-10 | `feat` | wire private analysis context composer | `add0d55b4` |
| 2026-08-10 | `docs` | record ready source bundle evidence | `4c85d52ad` |
| 2026-08-10 | `feat` | assemble ready analysis source bundles | `ec66e64c6` |
| 2026-08-10 | `feat` | bind authority to source snapshots | `4fcf60ffe` |
| 2026-08-10 | `test` | cover guidance selection revisions | `fe302fdfd` |
| 2026-08-10 | `feat` | compose selected guidance snapshots | `b8adfacd0` |
| 2026-08-10 | `feat` | compose categories in source snapshots | `7a23913f7` |
| 2026-08-10 | `feat` | bind guidance selections to campaigns | `e0ddf6972` |
| 2026-08-10 | `feat` | validate reviewed guidance manifests | `ede8d665f` |
| 2026-08-10 | `feat` | share cadence snapshot reads | `695003a0e` |
| 2026-08-10 | `feat` | validate current Meta hierarchy config | `59c51bc78` |
| 2026-08-10 | `feat` | add current source snapshot seam | `20cef249d` |
| 2026-08-10 | `fix` | harden current cadence reader | `62daebfec` |
| 2026-08-10 | `feat` | compose evidence-bound analysis contexts | `f64d77c3c` |
| 2026-08-10 | `test` | cover cadence context live verifier | `1d2ee6e20` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 43
- `docs        ` ███ 6
- `fix         ` ███ 6
- `chore       ` ██ 3
- `test        ` █ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
