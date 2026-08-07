# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: a75943e13650 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 27 |
| ilk / son iş | 2026-08-06 / 2026-08-07 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-07 | `feat` | build change snapshots from mirror | `6e1f9d52f` |
| 2026-08-07 | `feat` | add workspace tombstone boundary | `4260f37f4` |
| 2026-08-07 | `feat` | persist secure connection lifecycle | `4759f711a` |
| 2026-08-07 | `feat` | define safe data lifecycle boundary | `71978fe8e` |
| 2026-08-07 | `feat` | classify external snapshot changes | `4542aa6b5` |
| 2026-08-07 | `docs` | close S1.4 evidence gate | `1fd18b530` |
| 2026-08-07 | `test` | prove live S1.4 persistence | `019cd6d7f` |
| 2026-08-07 | `feat` | persist linked post inventory | `5ae792ac5` |
| 2026-08-07 | `feat` | persist S1.4 mirror in Postgres | `91fa14241` |
| 2026-08-07 | `test` | cover live linked post inventory | `d6346a57a` |
| 2026-08-07 | `feat` | mirror linked Page and Instagram posts | `6c586b990` |
| 2026-08-07 | `fix` | persist asset discovery evidence | `ddf971314` |
| 2026-08-07 | `feat` | add bounded content persistence and post eligibility | `704f1ce6c` |
| 2026-08-07 | `feat` | persist Meta asset and post evidence | `74f30ef6c` |
| 2026-08-07 | `test` | add live S1.4 read acceptance | `09c8add40` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 17
- `test        ` ██████ 4
- `?           ` ███ 2
- `security    ` ███ 2
- `docs        ` █ 1
- `fix         ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
