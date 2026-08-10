# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 3fdca371f1f6 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 193 |
| ilk / son iş | 2026-08-06 / 2026-08-10 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-10 | `feat` | parse canonical Meta insight pages | `4a155dd3f` |
| 2026-08-10 | `feat` | add bounded compact agent context | `c6996a264` |
| 2026-08-10 | `test` | verify cadence experiment adapters | `02fb6a3e6` |
| 2026-08-10 | `test` | verify policy-configured dry run | `3096ba3bb` |
| 2026-08-10 | `docs` | record local MCP live acceptance | `0a9a46161` |
| 2026-08-10 | `feat` | add interactive campaign brief templates | `dd5c1be06` |
| 2026-08-10 | `feat` | verify complete relational authority impact | `a7d587658` |
| 2026-08-10 | `feat` | add private authority topic lifecycle | `00a5179d1` |
| 2026-08-10 | `feat` | add private account group lifecycle | `39a63938a` |
| 2026-08-10 | `feat` | add private semantic binding lifecycle | `f61886e20` |
| 2026-08-10 | `fix` | accept renewed authority snapshots | `bb12209de` |
| 2026-08-10 | `test` | verify authority impact fail-closed | `a530aa6f5` |
| 2026-08-10 | `feat` | evaluate authority impact by family | `2506a492e` |
| 2026-08-10 | `feat` | persist verified policy compositions | `50a11045d` |
| 2026-08-10 | `fix` | invalidate persisted authority contexts | `7a3d94be2` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 41
- `fix         ` █████ 9
- `test        ` ████ 6
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
