# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 4e0a258ed47a -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 490 |
| ilk / son iş | 2026-08-06 / 2026-08-15 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-15 | `feat` | guide management workflows | `57cc7a3b6` |
| 2026-08-15 | `feat` | add contextual management terminology help | `80a9d41eb` |
| 2026-08-15 | `feat` | prioritize starter setup path | `37ed01801` |
| 2026-08-15 | `style` | align starter plan with dashboard theme | `f8f053c18` |
| 2026-08-15 | `feat` | guide empty slice scopes to category setup | `1e7b48482` |
| 2026-08-15 | `feat` | separate slice operations workspace | `a15d86cca` |
| 2026-08-15 | `feat` | paginate classification review queue | `4b89804ee` |
| 2026-08-15 | `feat` | seed strict market boundary | `6c0dd365d` |
| 2026-08-15 | `feat` | guide empty review queues to setup | `5e41951ed` |
| 2026-08-15 | `style` | adapt slice workspace to theme tokens | `58d5e625e` |
| 2026-08-15 | `fix` | read canonical mirror timestamps | `30939be4c` |
| 2026-08-15 | `feat` | manage interview kit revisions | `0caf6000d` |
| 2026-08-15 | `feat` | add campaign search and pagination | `9fafcb9c7` |
| 2026-08-15 | `feat` | open facilitated rule sessions | `341128461` |
| 2026-08-15 | `test` | cover slice workspace table | `29469d538` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 29
- `fix         ` ███████████ 13
- `test        ` █████████ 11
- `style       ` ██ 3
- `?           ` ██ 2
- `docs        ` ██ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
