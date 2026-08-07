# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 566403eddbce -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 98 |
| ilk / son iş | 2026-08-06 / 2026-08-08 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-08 | `docs` | record no-model API gate | `23025196d` |
| 2026-08-08 | `test` | enforce no-model API boundary | `ba4347d8d` |
| 2026-08-08 | `docs` | refresh deterministic project state | `7d1efb006` |
| 2026-08-08 | `docs` | record K4 and insight gates | `0dea31c39` |
| 2026-08-08 | `feat` | add v23 insight capability catalog | `fd392bc5d` |
| 2026-08-08 | `feat` | complete K4 publication gate | `e8dc56aac` |
| 2026-08-08 | `docs` | refresh deterministic project state | `04be8a651` |
| 2026-08-08 | `docs` | record K4 policy studio gate | `8c9e8295b` |
| 2026-08-08 | `feat` | add K4 policy bundle studio | `9e54284ac` |
| 2026-08-08 | `feat` | add K4 policy bundle drafts | `f725a7f47` |
| 2026-08-08 | `docs` | record proposal route gate | `c8f18d412` |
| 2026-08-08 | `feat` | wire promotion proposal composition | `d3d65adbc` |
| 2026-08-08 | `feat` | bind reviewed evidence freshness | `1ff863f10` |
| 2026-08-08 | `feat` | compose category evidence adapter | `1181f5eda` |
| 2026-08-08 | `docs` | record policy composition gate | `2454cd2dd` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 38
- `docs        ` █████████ 15
- `test        ` ███ 5
- `fix         ` █ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
