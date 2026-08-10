# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 85aec0c2cf94 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 145 |
| ilk / son iş | 2026-08-06 / 2026-08-10 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-10 | `docs` | reconcile completed finding capabilities | `ac5d4c18b` |
| 2026-08-10 | `feat` | freeze agenda on decision room runs | `dc9990b5d` |
| 2026-08-10 | `feat` | persist experiment record lifecycle | `98064fc02` |
| 2026-08-10 | `feat` | freeze cadence revision on analysis runs | `69f9d8ef0` |
| 2026-08-10 | `feat` | persist cadence profile revisions | `c3a5f7793` |
| 2026-08-10 | `fix` | recover migrations and verify authority flows | `8b999b063` |
| 2026-08-10 | `fix` | bind cohorts to metric catalog | `92876f6ab` |
| 2026-08-10 | `feat` | harden policy and promotion authoring | `904a45278` |
| 2026-08-10 | `feat` | harden run binding rollout | `a5855809f` |
| 2026-08-09 | `feat` | complete human-gated authoring flows | `68fe5b8ee` |
| 2026-08-09 | `docs` | record external checkpoint takeover | `bfaf4bcd5` |
| 2026-08-09 | `feat` | harden category and Meta read contracts | `0237143f3` |
| 2026-08-09 | `feat` | add selector mapping preview | `44c670e0b` |
| 2026-08-09 | `chore` | quarantine legacy control plane | `cd675c679` |
| 2026-08-09 | `feat` | guard lifecycle mutations | `6d0591f31` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 33
- `docs        ` ███████████████ 20
- `chore       ` ██ 3
- `fix         ` ██ 3
- `test        ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
