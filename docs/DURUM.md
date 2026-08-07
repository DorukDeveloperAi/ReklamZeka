# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: f3deab029608 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 66 |
| ilk / son iş | 2026-08-06 / 2026-08-07 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-07 | `feat` | orchestrate bounded scheduled read sync | `08ea8c27b` |
| 2026-08-07 | `docs` | record trusted policy migration proof | `50e14029a` |
| 2026-08-07 | `feat` | bind proposal snapshots to reviewed policies | `d77d7341b` |
| 2026-08-07 | `docs` | record approval policy migration proof | `d630b21a4` |
| 2026-08-07 | `feat` | register reviewed policy definitions | `ba86b06e6` |
| 2026-08-07 | `feat` | materialize canonical proposal evidence | `22bffc2fe` |
| 2026-08-07 | `feat` | compose canonical read sync runtime | `1ccd967b3` |
| 2026-08-07 | `docs` | record compatibility migration proof | `d0c4d894e` |
| 2026-08-07 | `feat` | register reviewed compatibility evidence | `1bb46c352` |
| 2026-08-07 | `feat` | type existing post source bindings | `d5ac88406` |
| 2026-08-07 | `docs` | record inventory and autonomy studio slices | `00469c406` |
| 2026-08-07 | `feat` | persist reviewed rule revisions | `2223c8181` |
| 2026-08-07 | `fix` | keep guidance advisory-only | `5bb9ac8e3` |
| 2026-08-07 | `feat` | guard explicit proposal drafts | `07ecdf47f` |
| 2026-08-07 | `feat` | resolve guided preflight server-side | `4b46821f2` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 43
- `docs        ` ████ 7
- `test        ` ███ 5
- `fix         ` ██ 3
- `security    ` █ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
