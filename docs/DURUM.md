# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: f7ec8bfe4f44 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 7 |
| ilk / son iş | 2026-08-06 / 2026-08-07 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-07 | `feat` | integrate durable partial sync | `b69f5ee8a` |
| 2026-08-07 | `feat` | add resumable insights persistence contract | `a3dca0912` |
| 2026-08-07 | `feat` | add resumable partial read sync runtime | `a2962124d` |
| 2026-08-07 | `feat` | establish Meta read mirror core | `23124e1ee` |
| 2026-08-07 | `feat` | add read-only Meta access inventory | `fa74d5a3a` |
| 2026-08-06 | `—` | vscode ayarları eklendi | `03d03c538` |
| 2026-08-06 | `—` | aide iskelesi + filing katmanı kuruldu (yeni proje) | `0d2239dda` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 5
- `?           ` ██████████ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
