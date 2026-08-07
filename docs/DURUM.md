# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 2fc59658741a -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 19 |
| ilk / son iş | 2026-08-06 / 2026-08-07 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-07 | `feat` | persist S1.4 mirror in Postgres | `91fa14241` |
| 2026-08-07 | `test` | cover live linked post inventory | `d6346a57a` |
| 2026-08-07 | `feat` | mirror linked Page and Instagram posts | `6c586b990` |
| 2026-08-07 | `fix` | persist asset discovery evidence | `ddf971314` |
| 2026-08-07 | `feat` | add bounded content persistence and post eligibility | `704f1ce6c` |
| 2026-08-07 | `feat` | persist Meta asset and post evidence | `74f30ef6c` |
| 2026-08-07 | `test` | add live S1.4 read acceptance | `09c8add40` |
| 2026-08-07 | `feat` | add asset and content read mirror | `9b5c35728` |
| 2026-08-07 | `security` | revoke inherited function execution | `d07dfa9da` |
| 2026-08-07 | `test` | verify Supabase security posture | `243b438c1` |
| 2026-08-07 | `security` | close Supabase Data API by default | `22e625ca8` |
| 2026-08-07 | `feat` | connect Supabase persistence | `8bf9d962e` |
| 2026-08-07 | `feat` | integrate durable partial sync | `b69f5ee8a` |
| 2026-08-07 | `feat` | add resumable insights persistence contract | `a3dca0912` |
| 2026-08-07 | `feat` | add resumable partial read sync runtime | `a2962124d` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 11
- `test        ` ███████ 3
- `?           ` ████ 2
- `security    ` ████ 2
- `fix         ` ██ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
