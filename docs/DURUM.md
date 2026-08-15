# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: c70d1873cc66 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 526 |
| ilk / son iş | 2026-08-06 / 2026-08-15 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-15 | `feat` | hand off canonical portfolio scope to rules | `4d04fdec0` |
| 2026-08-15 | `test` | lock Meta write closed approval chain | `cc24afe71` |
| 2026-08-15 | `fix` | classify cohort scope evidence | `4dbf9c6f4` |
| 2026-08-15 | `feat` | bind cohort receipts to explicit scope proof | `49edf96b2` |
| 2026-08-15 | `—` | Add fail-closed temporal cohort skill receipt | `930a93dc8` |
| 2026-08-15 | `feat` | show proven slice links in portfolio | `531f00072` |
| 2026-08-15 | `fix` | retain contextual help menu | `48963502b` |
| 2026-08-15 | `—` | refine dashboard theme system | `adccc6862` |
| 2026-08-15 | `fix` | pin development origin binding | `324bf0668` |
| 2026-08-15 | `feat` | unify portfolio slice operation table | `668d6dffb` |
| 2026-08-15 | `test` | require fresh official turn citations | `69f503736` |
| 2026-08-15 | `feat` | freeze official turn receipts | `0b6dddb15` |
| 2026-08-15 | `fix` | restore slice rule decision trace | `be2441b72` |
| 2026-08-15 | `fix` | restore human approval preparation | `20332e892` |
| 2026-08-15 | `fix` | keep slice budget impact dry-run only | `7b8dbf1f1` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 33
- `fix         ` ██████████ 14
- `?           ` ███ 4
- `docs        ` ██ 3
- `style       ` ██ 3
- `test        ` ██ 3

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
