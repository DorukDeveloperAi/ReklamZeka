# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 70d1ac0bfba9 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 602 |
| ilk / son iş | 2026-08-06 / 2026-08-18 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-18 | `chore` | journal p06 budget execution binding | `bb23ec4ac` |
| 2026-08-18 | `test` | sequence budget execution verification | `3dfac0829` |
| 2026-08-18 | `chore` | journal budget ceiling policies | `8946feb5a` |
| 2026-08-18 | `test` | add ceiling policy post verification | `619d5678b` |
| 2026-08-18 | `chore` | journal p06 execution persistence | `673fc4d6b` |
| 2026-08-18 | `fix` | authenticate execution evidence chain | `d73442f16` |
| 2026-08-18 | `feat` | add manual guide run product path | `4896e179c` |
| 2026-08-18 | `fix` | align guide agent workspace identity | `1d0b2ce1f` |
| 2026-08-18 | `feat` | add immutable guide revision drafts | `0dbea2973` |
| 2026-08-18 | `feat` | expose canonical guide lifecycle | `40b1288cf` |
| 2026-08-18 | `fix` | bind saved report replay and head evidence | `3dd0d9acd` |
| 2026-08-18 | `test` | verify real local Codex guide agents | `3738bf025` |
| 2026-08-18 | `feat` | add naming lifecycle and trusted status candidates | `3d4e19fe2` |
| 2026-08-18 | `feat` | add deferred approval decisions | `14dc65fc8` |
| 2026-08-18 | `feat` | harden disabled execution contract | `7516f34ba` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 32
- `docs        ` ███████ 9
- `fix         ` ███████ 9
- `test        ` █████ 7
- `chore       ` ██ 3

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
