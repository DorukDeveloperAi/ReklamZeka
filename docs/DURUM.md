# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 617556df49f6 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 50 |
| ilk / son iş | 2026-08-06 / 2026-08-07 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-07 | `feat` | persist immutable registry | `69c30d6da` |
| 2026-08-07 | `feat` | add immutable existing-post preflight | `68163e504` |
| 2026-08-07 | `feat` | record human approval decisions | `c97235925` |
| 2026-08-07 | `feat` | expose read-only approval inbox | `6210bcffc` |
| 2026-08-07 | `feat` | persist approval proposal queue | `b579ba31f` |
| 2026-08-07 | `feat` | add approval-only safety cores | `9071004b1` |
| 2026-08-07 | `feat` | add explicit audited draft flow | `64eecbe36` |
| 2026-08-07 | `test` | prove local read boundary | `ca6e2febc` |
| 2026-08-07 | `feat` | persist advisory proposal revisions | `a56c7834e` |
| 2026-08-07 | `feat` | compose scenarios and guard proxy mapping | `f960369f5` |
| 2026-08-07 | `feat` | add deterministic planning cores | `047001fc8` |
| 2026-08-07 | `feat` | close analysis assets and practice lab read | `7e0d1b08e` |
| 2026-08-07 | `feat` | secure local runtime and practice lifecycle | `ec1eff7a4` |
| 2026-08-07 | `feat` | connect read model and analysis data | `5ef5e0145` |
| 2026-08-07 | `fix` | harden schedule and observation boundaries | `fa106d121` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 36
- `test        ` ███ 5
- `docs        ` ██ 3
- `?           ` █ 2
- `fix         ` █ 2
- `security    ` █ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
