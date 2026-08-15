# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: bdd4c035983e -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 511 |
| ilk / son iş | 2026-08-06 / 2026-08-15 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-15 | `—` | Clarify canonical portfolio source scope | `ff84f4b9b` |
| 2026-08-15 | `fix` | guide read-first session states | `81052bb38` |
| 2026-08-15 | `fix` | retain evidence and decision guardrails | `c826e3631` |
| 2026-08-15 | `fix` | select published playbook sources | `9aae0b2d4` |
| 2026-08-15 | `feat` | surface working language receipts | `ed7c048fa` |
| 2026-08-15 | `docs` | bind final philosophy to active goal | `5240dba03` |
| 2026-08-15 | `feat` | gate slice handoff on classification evidence | `3315b6bb1` |
| 2026-08-15 | `feat` | bind slice rule decision journey | `86f7e0f56` |
| 2026-08-15 | `feat` | clarify time and cohort evidence boundary | `9b492d771` |
| 2026-08-15 | `fix` | classify local session checkout mismatch | `46e089dac` |
| 2026-08-15 | `—` | Simplify home portfolio overview | `1ce85802b` |
| 2026-08-15 | `feat` | surface user slice context | `24cb05d0a` |
| 2026-08-15 | `docs` | bind workspace philosophy to delivery | `415109e1c` |
| 2026-08-15 | `feat` | clarify workspace shell | `dbffc7706` |
| 2026-08-15 | `feat` | centralize user-authored rule library | `dff2bbf4f` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 39
- `fix         ` ██████ 9
- `?           ` ██ 3
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
