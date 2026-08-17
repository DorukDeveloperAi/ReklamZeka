# ReklamZeka v3 — Kayıpsız Requirement ve DoD Matrisi

| ID | DoD / doğrulama | Paket |
|---|---|---|
| R3-01 | Meta mirror tüm kanonik alanları, kaynak/provenance/freshnessi ve beş source-state’i taşır. | P01 |
| R3-02 | 6 saatlik sync ile manual refresh aynı lease’i kullanır; missing sıfır değildir. | P01 |
| R3-03 | Currency mismatch tek alert üretir ve karşılaştırmadan dışlanır; ham kayıt süresiz korunur. | P01 |
| R3-04 | Current budget+budget events+CBO/ABO görünür; stale/missing finding+DevLog üretir ve action block olur. | P01 |
| R3-05 | Kurum hiyerarşisi, org table/membership/primary result ve virtual Atanmamış doğrulanır. | P02 |
| R3-06 | Generic dimensions ilk değerleri/precedence’i, versioned naming template alanları/lifecycle/user preview ile çalışır. | P02 |
| R3-07 | Hybrid revision, predicate, include/exclude, exclude>include>filter ve AND/OR desteklenir. | P03 |
| R3-08 | Current görünüm ile frozen replay ayrıdır; market sınırı ve one-membership negatifleri geçer. | P03 |
| R3-09 | Operasyon tablosu tüm sütunlar, tarih, saved view, action, filter/sort/subtotal/ratio/drill sunar. | P03 |
| R3-10 | Kapsam Raporu ayrı day/week/month Meta-report pivotudur: levels/dimensions/metrics/all raw actions/filter/sort/subtotal/ratio/drill/saved/CSV/XLSX. Guide/decision/audit yalnız contextual linktir. | P03 |
| R3-11 | Kılavuz revisionında slice, frequency, mode, closed actions, free-text ve strict alanlar eksiksizdir; schedule/manual çalışır. | P04 |
| R3-12 | Dört mode, NL formül ve explicit interpretation diff; activation/stale/template detachment bulunur. | P04 |
| R3-13 | Dört katmanlı bütçe kısıtları/havuzları dry-run, çakışma ve en kısıtlayıcı overlap ile doğrulanır. | P04 |
| R3-14 | Guide Agent önerir ama explicit transfer+human save olmadan write yapmaz; Daily Kılavuz edit edemez. | P05 |
| R3-15 | Daily koşum idempotent scheduler state/missed-coalescing ile finding/recommendation/mode-gated staged action candidate üretir. | P05 |
| R3-16 | Finding fingerprint/lifecycle/observations ve DevLog kategorileri/agent-proposed-only kaydedilir. | P05 |
| R3-17 | İnsan akışı candidate→preflight→tek yetkili onay/ret→typed action→RAW→audit/doğrulama zinciridir. | P06 |
| R3-18 | Human approved budget/status/rename; rename human-only, create yok; autonomy admission yalnız budget/status/limit/pencere içidir. | P06 |
| R3-19 | Executor on adımı, kill switch, idempotency, preflight, RAW ve rollback kuralları tamamdır. | P06 |
| R3-20 | Beş alan ve bütün alt öğeler/ortak görsel davranış/consolidation responsive browser’da kabul edilir. | P07 |
| R3-21 | RLS/tenant, immutable audit, DB/migration/manifest/tombstone, payment/delivery ve security gates geçer. | P08 |
| R3-22 | Minimum/merge gates, functional+browser matrix, rollout adımları/flags, protected pilot gerçek write+rollback kanıtı geçer. | P08 |
| R3-23 | Her paket evidence-pack ve runner/stall protokolü ile izlenebilir; default Meta write off kalır. | M00,P01–P08 |

