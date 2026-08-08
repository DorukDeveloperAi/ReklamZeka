# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 04553dc0acbc -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 123 |
| ilk / son iş | 2026-08-06 / 2026-08-08 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-08 | `feat` | scan effective portfolio health | `c90883c4c` |
| 2026-08-08 | `feat` | preview archive impact safely | `86284c17a` |
| 2026-08-08 | `feat` | surface evidence confidence health | `e65579e21` |
| 2026-08-08 | `feat` | add read-only inventory dashboard | `c0c3f2f70` |
| 2026-08-08 | `fix` | guide local session recovery | `49d98f771` |
| 2026-08-08 | `feat` | add multi-scope authoring | `19eac50de` |
| 2026-08-08 | `feat` | invalidate stale campaign contexts | `ee0e41193` |
| 2026-08-08 | `feat` | add guidance context tools | `65cbab3a8` |
| 2026-08-08 | `feat` | add category-bound studio | `9ddd42599` |
| 2026-08-08 | `docs` | refresh deterministic project state | `ccba7d95e` |
| 2026-08-08 | `feat` | add secure project MCP bridge | `8023e340e` |
| 2026-08-08 | `docs` | refresh deterministic project state | `d0468245c` |
| 2026-08-08 | `docs` | record authenticated handoff slice | `be4484bb6` |
| 2026-08-08 | `feat` | add live agent session hub | `981e744d6` |
| 2026-08-08 | `feat` | expose secure local handoffs | `ac1428135` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 32
- `docs        ` █████████████████ 22
- `test        ` ███ 4
- `fix         ` ██ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 11-bütçe planlama |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
