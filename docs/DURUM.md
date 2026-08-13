# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 6d320d366795 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 337 |
| ilk / son iş | 2026-08-06 / 2026-08-13 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-13 | `test` | cover budget pool binding contract | `ea697f1ef` |
| 2026-08-13 | `feat` | bind drafts to budget pool revisions | `994086ed8` |
| 2026-08-13 | `feat` | add budget pool hierarchy workspace | `289bf8483` |
| 2026-08-13 | `feat` | expose recommendation-only pool workspace | `1b0dedba6` |
| 2026-08-13 | `feat` | persist recommendation-only pool hierarchies | `dcb13c5bd` |
| 2026-08-13 | `feat` | define market-bound pool hierarchy | `ef8b5e2f0` |
| 2026-08-13 | `fix` | accept standard same-origin reads | `4bbc765ce` |
| 2026-08-13 | `feat` | show persisted operational trace | `d860e95a8` |
| 2026-08-13 | `fix` | require exact optional slice evidence | `841a5c863` |
| 2026-08-13 | `fix` | require frozen proof for scoped impact | `aa74c011b` |
| 2026-08-13 | `feat` | add explicit budget distribution drafts | `f3de526e2` |
| 2026-08-13 | `test` | isolate connection verifier security state | `a625403c0` |
| 2026-08-13 | `feat` | show Meta bootstrap safety state | `6a8ad4b99` |
| 2026-08-13 | `feat` | guide alert conversations | `e9ddee919` |
| 2026-08-13 | `fix` | gate bootstrap on token security | `04d2bebbe` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 41
- `fix         ` ████████ 13
- `docs        ` ██ 4
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
