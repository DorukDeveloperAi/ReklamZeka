# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: a2bb551676cb -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 78 |
| ilk / son iş | 2026-08-06 / 2026-08-08 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-08 | `test` | verify live geo inventory wiring | `0d7eabaa7` |
| 2026-08-08 | `feat` | wire geo evidence and scheduled sync | `49eefd3a0` |
| 2026-08-08 | `docs` | record affected geo live proof | `3e11209d4` |
| 2026-08-08 | `fix` | order affected geo composite keys | `0561270bd` |
| 2026-08-08 | `feat` | persist affected geo evidence | `1d09a729e` |
| 2026-08-08 | `feat` | normalize verified affected geo | `3b04b6e53` |
| 2026-08-08 | `feat` | materialize authentic category evidence | `1fbbffa15` |
| 2026-08-08 | `test` | verify redacted targeting shape | `ffe0a4af3` |
| 2026-08-08 | `test` | verify live guardrail persistence | `8eb5aa279` |
| 2026-08-08 | `docs` | record guardrail migration proof | `cca08c94f` |
| 2026-08-08 | `feat` | persist reviewed protection guardrails | `2aa61423d` |
| 2026-08-07 | `feat` | resolve reviewed budget guardrails | `57e8d1455` |
| 2026-08-07 | `feat` | orchestrate bounded scheduled read sync | `08ea8c27b` |
| 2026-08-07 | `docs` | record trusted policy migration proof | `50e14029a` |
| 2026-08-07 | `feat` | bind proposal snapshots to reviewed policies | `d77d7341b` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 43
- `docs        ` █████ 9
- `test        ` ███ 5
- `fix         ` ██ 3

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
