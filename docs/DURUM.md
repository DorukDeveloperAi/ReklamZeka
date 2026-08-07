# DURUM — ReklamZeka

> **TÜREV — elle düzenleme sapmadır.** Tek yazar `aide durum` motoru; her `aide tasima`
> koşumunda yeniden üretilir. Deterministik · LLM doğurmaz · 0 token.
>
> İçeriği YALNIZ iş commit'lerinin ve plan durumunun fonksiyonudur — "şu an" damgası,
> HEAD hash'i ya da checkpoint sayısı BİLEREK yoktur (bkz. `durum-log.ts` → döngü yasağı).

<!-- durum-damga: 12ebf063ff34 -->

## Künye

| alan | değer |
|---|---|
| dal | `main` |
| uzak | var |
| iş commit'i (tüm geçmiş) | 38 |
| ilk / son iş | 2026-08-06 / 2026-08-07 |

## Son iş commit'leri

| tarih | kapsam | ne | hash |
|---|---|---|---|
| 2026-08-07 | `feat` | secure local runtime and practice lifecycle | `ec1eff7a4` |
| 2026-08-07 | `feat` | connect read model and analysis data | `5ef5e0145` |
| 2026-08-07 | `fix` | harden schedule and observation boundaries | `fa106d121` |
| 2026-08-07 | `feat` | persist versioned schedules and inbox | `920083baf` |
| 2026-08-07 | `feat` | add deterministic findings and ledger binding | `af656e3c5` |
| 2026-08-07 | `feat` | persist and orchestrate decision room | `4d0a37fd7` |
| 2026-08-07 | `docs` | record frozen context and analysis gates | `c2f6cb0bd` |
| 2026-08-07 | `feat` | persist category guidance and context cores | `243884110` |
| 2026-08-07 | `feat` | add category guidance timeframe cores | `fe851692f` |
| 2026-08-07 | `docs` | start S2 Decision Room | `542fb451c` |
| 2026-08-07 | `feat` | close S1 read mirror trust gate | `4014834a0` |
| 2026-08-07 | `feat` | build change snapshots from mirror | `6e1f9d52f` |
| 2026-08-07 | `feat` | add workspace tombstone boundary | `4260f37f4` |
| 2026-08-07 | `feat` | persist secure connection lifecycle | `4759f711a` |
| 2026-08-07 | `feat` | define safe data lifecycle boundary | `71978fe8e` |

## Nerede çalışılıyor (son 60 iş commit'i)

- `feat        ` ████████████████████████ 25
- `test        ` ████ 4
- `docs        ` ███ 3
- `?           ` ██ 2
- `fix         ` ██ 2
- `security    ` ██ 2

## Planlar

| plan | v | durum | aşama | sıradaki |
|---|---|---|---|---|
| `proje` | 2 | SÜRÜYOR | 6/14 | 08-Meta dijital ikizi |

---

**Muafiyet (ilan):** bu belge *anlık ve deterministik* olanı ölçer. Ölçmedikleri:
çalışan alarmlar (`jobs/alerts.jsonl` — sürekli değişir, döngü yasağına takılır),
açık session'lar (`.claude/filing/DEVRALIS.md`), günlük anlatı (`docs/gunluk/`).
