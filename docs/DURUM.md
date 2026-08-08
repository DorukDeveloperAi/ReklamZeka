# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 7b046e38110f -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 114 |
| ilk / son iş | 2026-08-06 / 2026-08-08 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-08 | `docs` | refresh deterministic project state | `ccba7d95e` |
| 2026-08-08 | `feat` | add secure project MCP bridge | `8023e340e` |
| 2026-08-08 | `docs` | refresh deterministic project state | `d0468245c` |
| 2026-08-08 | `docs` | record authenticated handoff slice | `be4484bb6` |
| 2026-08-08 | `feat` | add live agent session hub | `981e744d6` |
| 2026-08-08 | `feat` | expose secure local handoffs | `ac1428135` |
| 2026-08-08 | `docs` | refresh deterministic project state | `6cfbe4585` |
| 2026-08-08 | `docs` | record durable agent sessions | `456bd5842` |
| 2026-08-08 | `feat` | persist local session handoffs | `bbcea6595` |
| 2026-08-08 | `docs` | refresh deterministic project state | `2ce337256` |
| 2026-08-08 | `docs` | record session handoff core | `5b3930eb3` |
| 2026-08-08 | `feat` | add session handoff lifecycle | `fad7505fa` |
| 2026-08-08 | `docs` | refresh deterministic project state | `3090e2920` |
| 2026-08-08 | `docs` | record local agent client gate | `bbbf3adb1` |
| 2026-08-08 | `feat` | add vendor-neutral fixture client | `8f33dbc22` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 30
- `docs        ` ████████████████████ 25
- `test        ` ███ 4
- `fix         ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 11-bütçe planlama |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
