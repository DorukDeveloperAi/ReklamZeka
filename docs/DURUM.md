# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 29b423337ab0 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 156 |
| ilk / son iş | 2026-08-06 / 2026-08-10 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-10 | `feat` | expose frozen outcome evidence to findings | `57dfc870b` |
| 2026-08-10 | `feat` | compose persisted outcome evidence into context | `aa8935439` |
| 2026-08-10 | `feat` | persist outcome evidence snapshots | `e84ca60ed` |
| 2026-08-10 | `feat` | add compact business outcome evidence | `7cafd712a` |
| 2026-08-10 | `feat` | add bounded business outcome reads | `ec1e91b6e` |
| 2026-08-10 | `feat` | add server-bound business outcome intake | `95b840c88` |
| 2026-08-10 | `feat` | persist normalized business outcomes | `9fc14ef87` |
| 2026-08-10 | `feat` | expose experiment evidence lifecycle | `7c5cb9999` |
| 2026-08-10 | `feat` | add server-bound cadence publication | `c2269a8f3` |
| 2026-08-10 | `fix` | preserve decision room reads with dry run config | `c37cae7e5` |
| 2026-08-10 | `feat` | add server-bound decision room dry run | `b9504c59d` |
| 2026-08-10 | `docs` | reconcile completed finding capabilities | `ac5d4c18b` |
| 2026-08-10 | `feat` | freeze agenda on decision room runs | `dc9990b5d` |
| 2026-08-10 | `feat` | persist experiment record lifecycle | `98064fc02` |
| 2026-08-10 | `feat` | freeze cadence revision on analysis runs | `69f9d8ef0` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 36
- `docs        ` ███████████ 16
- `fix         ` ███ 4
- `chore       ` ██ 3
- `test        ` █ 1

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | — |
| `reklamzeka-sistemi` | 2 | AÇIK | 0/10 | 01-temel-kapanis |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
