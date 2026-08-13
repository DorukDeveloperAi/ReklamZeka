# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: ef94b0562edd -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 324 |
| ilk / son iş | 2026-08-06 / 2026-08-13 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-13 | `feat` | guide alert conversations | `e9ddee919` |
| 2026-08-13 | `fix` | gate bootstrap on token security | `04d2bebbe` |
| 2026-08-13 | `docs` | record rule impact and alert surfaces | `4de49fd53` |
| 2026-08-13 | `feat` | preview slice rule impact safely | `1f9c8a091` |
| 2026-08-13 | `feat` | bind rule previews to frozen scope evidence | `7cae18933` |
| 2026-08-13 | `feat` | add delivery health alert workspace | `e1147d3f8` |
| 2026-08-13 | `feat` | add delivery alert ledger and rule impact bridge | `3c2ae2845` |
| 2026-08-13 | `feat` | show read mirror and slice rule workspace | `a7aca5ffc` |
| 2026-08-13 | `feat` | add read mirror rule workspace and Codex chat | `a489278e6` |
| 2026-08-13 | `docs` | reconcile phase zero operating evidence | `7a9f96ff6` |
| 2026-08-13 | `docs` | add completion execution roadmap | `091dc7d8d` |
| 2026-08-13 | `feat` | guide manual Codex tasks by page | `b4fc3de71` |
| 2026-08-13 | `feat` | add manual Codex task handoff | `5c2cc2e75` |
| 2026-08-13 | `feat` | add delivery health alert contract | `bb9848dfd` |
| 2026-08-13 | `feat` | require separate publisher | `2809577a9` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 43
- `fix         ` ██████ 11
- `docs        ` ███ 6

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
