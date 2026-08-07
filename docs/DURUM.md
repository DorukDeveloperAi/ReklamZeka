# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 754a4fd24415 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 8 |
| ilk / son iş | 2026-08-06 / 2026-08-07 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-07 | `chore` | utopya iskeletleri kalıcı YEREL ilan edildi | `8bbeef3c0` |
| 2026-08-07 | `chore` | 2. merge sonrası türevleri yeniden üret | `211d67333` |
| 2026-08-07 | `merge` | uzak ile birleştir (2. tur) | `03716c2fc` |
| 2026-08-07 | `chore` | merge sonrası türevleri üreticiden yeniden üret (agac.mjs INDEX/TODO + DURUM) | `1927e26a3` |
| 2026-08-07 | `merge` | uzak ile birleştir — kayıpsız (türev yeniden üretilir, içerik birleşimle korunur) | `bfe9b9fce` |
| 2026-08-07 | `feat` | add read-only Meta access inventory | `fa74d5a3a` |
| 2026-08-06 | `—` | vscode ayarları eklendi | `03d03c538` |
| 2026-08-06 | `—` | aide iskelesi + filing katmanı kuruldu (yeni proje) | `0d2239dda` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `chore       ` ████████████████████████ 3
- `?           ` ████████████████ 2
- `merge       ` ████████████████ 2
- `feat        ` ████████ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
