# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: a26cf2c0d6d0 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 210 |
| ilk / son iş | 2026-08-06 / 2026-08-10 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-10 | `feat` | add portfolio capability reader | `4e5d6e4b8` |
| 2026-08-10 | `feat` | sequence interactive campaign briefs | `e6bdb2d88` |
| 2026-08-10 | `feat` | compose timeframe-bound L3 contexts | `dacf92810` |
| 2026-08-10 | `feat` | require L3 evidence for decision runs | `23a8f1b8f` |
| 2026-08-10 | `feat` | materialize L3 windows by timeframe | `ec7cce9f9` |
| 2026-08-10 | `feat` | bind L2 L3 context evidence | `e35b9fa41` |
| 2026-08-10 | `feat` | reject invalidated L3 windows | `df68847d9` |
| 2026-08-10 | `feat` | persist invalidation-aware L3 windows | `823e95527` |
| 2026-08-10 | `feat` | add deterministic L3 window contract | `7ca0df3ca` |
| 2026-08-10 | `feat` | reject invalidated L2 features | `340e7dc99` |
| 2026-08-10 | `feat` | journal L1 feature invalidations | `27e7770f2` |
| 2026-08-10 | `feat` | materialize attested L2 features | `63d6ee213` |
| 2026-08-10 | `feat` | attest private L2 source manifests | `eb2c689be` |
| 2026-08-10 | `feat` | add immutable L2 feature storage | `413262efd` |
| 2026-08-10 | `feat` | expose private L2 source manifest | `bf64f2b00` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 46
- `fix         ` ███ 6
- `test        ` ███ 6
- `docs        ` █ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
