# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: f469223fb30b -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 279 |
| ilk / son iş | 2026-08-06 / 2026-08-11 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-11 | `fix` | classify diagnostic JSONB dependencies | `677f3f351` |
| 2026-08-11 | `feat` | carry brief intent into draft template | `e13ad1236` |
| 2026-08-11 | `feat` | link brief to draft policy workspace | `91b430eaf` |
| 2026-08-11 | `fix` | clear scenario after manual brief edit | `355909eb2` |
| 2026-08-11 | `feat` | add workbook campaign scenarios | `18fd1037f` |
| 2026-08-11 | `feat` | assess structured normalization drafts | `0b2b9558f` |
| 2026-08-11 | `feat` | align brief with campaign taxonomy | `7e36cc967` |
| 2026-08-11 | `feat` | add campaign intent templates | `803678f0a` |
| 2026-08-11 | `feat` | select guidance in normalization | `27b0e1403` |
| 2026-08-11 | `feat` | add draft normalization workbench | `ee9773758` |
| 2026-08-11 | `docs` | record today browser boundary | `534f9490c` |
| 2026-08-11 | `feat` | show verified inventory on today | `69a0e4206` |
| 2026-08-11 | `feat` | add campaign hierarchy drilldown | `ce5aa492d` |
| 2026-08-11 | `docs` | record portfolio browser boundary | `6adb094e0` |
| 2026-08-11 | `feat` | select persisted campaign contexts | `d855f1c51` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 45
- `test        ` ███ 6
- `fix         ` ███ 5
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
