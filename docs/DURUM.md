# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: c2aee213372c -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 537 |
| ilk / son iş | 2026-08-06 / 2026-08-17 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-17 | `feat` | add immutable guide revision domain | `17c839f71` |
| 2026-08-17 | `docs` | record unified Meta read fire | `42511e907` |
| 2026-08-17 | `feat` | unify six-hour and manual read sync leases | `c524e70f2` |
| 2026-08-17 | `docs` | record initial v3 implementation chain | `463862587` |
| 2026-08-17 | `feat` | add deterministic canonical resolver | `e23efb1b2` |
| 2026-08-17 | `feat` | add canonical organization campaign foundation | `7da9499df` |
| 2026-08-17 | `docs` | accept M00 evidence pack | `327cf0079` |
| 2026-08-17 | `docs` | establish ReklamZeka v3 canonical chain | `4fdb381e6` |
| 2026-08-17 | `fix` | accept bounded empty bootstrap streams | `b6364b57c` |
| 2026-08-17 | `test` | align dashboard copy with operations shell | `94a789d2f` |
| 2026-08-17 | `feat` | establish five-area operations shell | `2c947a402` |
| 2026-08-15 | `feat` | hand off canonical portfolio scope to rules | `4d04fdec0` |
| 2026-08-15 | `test` | lock Meta write closed approval chain | `cc24afe71` |
| 2026-08-15 | `fix` | classify cohort scope evidence | `4dbf9c6f4` |
| 2026-08-15 | `feat` | bind cohort receipts to explicit scope proof | `49edf96b2` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 30
- `fix         ` ███████████ 14
- `docs        ` ██████ 7
- `?           ` ███ 4
- `test        ` ██ 3
- `style       ` ██ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
