---
kosum: tek-ajan
---
# Aşama 11 — Bütçe hedefi, tahsis ve simülasyon

## SONUÇ

Kullanıcı hesap/kategori/bölge/kampanya bütçesini ve iş hedefini tanımlar. Sistem
CBO/ABO gerçeğine, korunan tahsislere ve zamanlı performansa uyan, açıklanabilir bir
before/after plan üretir; bu aşamada Meta'ya yazmaz.

## Bütçe nesneleri

- `BudgetEnvelope`: scope, period, currency, total/min/max/fixed/reserve.
- `AllocationRule`: child selector, mode, weight/priority, floor/cap, transfer group.
- `Target`: metric, target/range, volume, timeframe, confidence/min sample.
- `BudgetState`: planned/committed/actual/forecast + budget owner.
- `BudgetProposal`: deltas, constraint trace, risk, expected range, approvals.

## Task'lar

### T11.1 — Envelope ve reconciliation
Parent-child toplamları, fixed allocation, reserve, para birimi ve period; over/under allocation
fail-closed. CBO campaign ve ABO adset owner resolve edilmeden proposal yok.

### T11.2 — Transfer ve koruma politikaları
Allow/deny/within-group; bölge/hizmet/kategori tabanı; “pahalı olsa da sabit tut” golden
senaryosu; bir hard constraint'i preference veya ROAS skoru ezemez.

### T11.3 — Pacing ve forecast
Daily/lifetime pace, kalan gün/bütçe, weekday pattern, confidence band; planned ile Meta
actual farkı. Attribution lag ve veri tazeliği yetersizse forecast/plan bastırılır.

### T11.4 — Deterministik allocation
Fixed, proportional, priority-weighted ve ladder. Amaç kara-kutu optimum değil, constraint
uyumlu aday planıdır. Tie-break stable entity ID; rounding/remainder açık.

### T11.5 — Risk, cap, cooldown ve learning
Max absolute/percent change, workspace/account/category cap, minimum sample, learning guard,
cooldown, max active slots ve budget increase approval zorunluluğu.

### T11.6 — Simülasyon ve alternatifler
Keep-current + conservative + target-seeking en fazla üç alternatif; her biri before/after,
satisfied/violated/suppressed policies, affected entities ve belirsizlik taşır.

### T11.7 — Plan ledger/API
Input run/snapshot/policy versions, proposal status draft/approved/expired/superseded,
line items ve approval requirement. Aynı fingerprint duplicate plan yaratmaz.

### T11.8 — İş sonucu hedefi ve proxy sınırı
Meta lead/purchase proxy ile optional qualified lead/appointment/revenue signal ayrı target
source taşır. Mapping/freshness/coverage yetersizse target-seeking plan bastırılır veya
yalnız Meta-proxy etiketiyle simüle edilir; agent business outcome uyduramaz.

## Kabul ve kanıt

- Protected region sabit kalırken kalan bütçe uygun havuzda dağıtılır.
- Parent total, reserve, floor/cap ve rounding her fixture'da uzlaşır.
- CBO/ABO yanlış seviyeye delta üretmez.
- Freshness/min sample/learning/cooldown uygun değilse sebepli suppression.
- Aynı input planı byte-eş ve Meta write sayısı 0.
