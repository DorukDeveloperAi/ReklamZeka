# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 2fd2950593b4 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 613 |
| ilk / son iş | 2026-08-06 / 2026-08-18 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-18 | `feat` | add human-only rename admission foundation | `7895988be` |
| 2026-08-18 | `feat` | complete operation saved view controls | `e5350c745` |
| 2026-08-18 | `docs` | record migration post acceptance | `103922ec7` |
| 2026-08-18 | `chore` | journal naming template lifecycle | `ab9a212a1` |
| 2026-08-18 | `test` | add naming template post verification | `149ddfc43` |
| 2026-08-18 | `chore` | journal saved scope reports | `718ea01c2` |
| 2026-08-18 | `test` | add saved report post verification | `caf01a913` |
| 2026-08-18 | `chore` | journal limited autonomy execution | `85cba40c1` |
| 2026-08-18 | `test` | add limited execution post verification | `ddddb23c5` |
| 2026-08-18 | `chore` | journal limited autonomy admissions | `5861077db` |
| 2026-08-18 | `test` | sequence limited autonomy admission verification | `f1ea7a87b` |
| 2026-08-18 | `chore` | journal p06 budget execution binding | `bb23ec4ac` |
| 2026-08-18 | `test` | sequence budget execution verification | `3dfac0829` |
| 2026-08-18 | `chore` | journal budget ceiling policies | `8946feb5a` |
| 2026-08-18 | `test` | add ceiling policy post verification | `619d5678b` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 30
- `fix         ` ██████ 8
- `test        ` ██████ 8
- `chore       ` ██████ 7
- `docs        ` ██████ 7

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
