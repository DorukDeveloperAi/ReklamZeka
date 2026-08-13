# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: ef9199e97578 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 409 |
| ilk / son iş | 2026-08-06 / 2026-08-13 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-13 | `fix` | harden decision trace projection | `a2d6c0291` |
| 2026-08-13 | `test` | bind asset verifier to account discovery | `be6f4b1d6` |
| 2026-08-13 | `fix` | restore budget evidence-bound verifier | `58eb3c3d2` |
| 2026-08-13 | `fix` | classify current-source failures safely | `e370ad054` |
| 2026-08-13 | `docs` | record gated Meta schedule runner | `d040960cc` |
| 2026-08-13 | `feat` | add gated read-only schedule runner | `0bbc7c308` |
| 2026-08-13 | `test` | bind queue verifier to frozen context | `04af0c44b` |
| 2026-08-13 | `docs` | record Meta quality read projection | `a82508c45` |
| 2026-08-13 | `feat` | expose canonical trust readiness report | `a5af7e894` |
| 2026-08-13 | `fix` | classify budget action provenance | `bfd3497c8` |
| 2026-08-13 | `docs` | record dashboard fail-closed acceptance | `7952add5d` |
| 2026-08-13 | `docs` | record normalization and insight evidence | `b17a8e222` |
| 2026-08-13 | `feat` | expose normalization workbench in dashboard | `62d736691` |
| 2026-08-13 | `feat` | surface verified empty insight delivery | `4c066e399` |
| 2026-08-13 | `docs` | record K2 K3 budget policy studio | `7a522638f` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 21
- `docs        ` █████████████████████ 18
- `fix         ` ███████████████████ 17
- `test        ` ██ 2
- `?           ` █ 1
- `chore       ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
