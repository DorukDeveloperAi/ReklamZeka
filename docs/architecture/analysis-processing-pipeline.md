# Analiz işleme pipeline'ı, EffectiveCampaignContext ve agent context bütçesi

## Amaç

Meta ham satırlarını modele yığmadan, tekrar üretilebilir analitik kanıt üretmek; agent'a
yalnız karar için gerekli, kaynaklı ve gerektiğinde drill-down edilebilir bağlam vermek.
Başlangıç mimarisi modular monolith + PostgreSQL + background worker'dır. ClickHouse,
vector DB, event bus veya ayrı feature-store servisi ölçek kanıtı olmadan eklenmez.

## L0–L5 katmanları

| katman | içerik | model erişimi |
|---|---|---|
| L0 source/raw | Meta payload, request/version/hash/provenance; retention kontrollü | asla doğrudan yok |
| L1 canonical facts | account/campaign/adset/ad/creative/post/config + günlük insights | yalnız bounded drill-down |
| L2 deterministic features | CTR/CPC/CPM/CPA/CPL/ROAS, pacing, budget owner, contribution, coverage/freshness | tool ile seçili |
| L3 window/rollup | rolling/calendar/lifetime/learning/action-relative seri, trend, volatility, cohort/pre-post | tool ile özet |
| L4 evidence graph | typed finding, driver, data-quality blocker, policy/guidance/cadence linkleri | birincil kanıt |
| L5 compact agent context | agenda pass'e göre EffectiveCampaignContext + GuidancePack + evidence özetleri | varsayılan prompt/tool context |

L0 configurable retention sonrası encrypted archive veya silme politikasına tabidir; hash,
provenance ve gerekli kanonik facts tutulur. Eksik veri sıfıra çevrilmez. Her L1–L5 kayıt
source snapshot/version ve formula/catalog version'a izlenir.

## Deterministik feature ailesi

- additive/non-additive/ratio metrik ve numerator/denominator;
- spend pacing, planned/committed/actual/forecast ve target gap;
- entity contribution/share ve parent-child reconciliation;
- freshness, coverage, attribution label/lag ve revision age;
- budget owner, status inheritance ve config consistency;
- trend/slope, breakpoint, robust MAD anomaly ve volatility;
- creative/post delivery/fatigue sinyalleri;
- action-relative pre/post, external intervention ve contamination;
- category/objective/cohort uyumluluğu;
- decision cadence/learning/cooldown eligibility.

İlk increment yalnız karar için kullanılan feature'ları materialize eder. Genel amaçlı
feature platformu yapılmaz.

## EffectiveCampaignContext

Her analysis/budget/practice/action run için frozen context:

```text
EffectiveCampaignContext
  identity: workspace/connection/account/entity tree
  meta: objective/optimization/budget-owner/status/targeting/actor/destination
  categories: effective assignments + evidence/manual locks
  guidance: EffectiveGuidancePack + AnalysisAgenda pass
  policies: enforceable compiled policy set + suppression/conflict trace
  cadence: effective DecisionCadenceProfile
  budget: envelope/state/targets
  data: freshness/coverage/attribution/capability + L2/L3 feature refs
  history: actions/experiments/advised-practices/outcomes
  versions: resolver/catalog/formula/source snapshot IDs
```

Resolver tenant→platform safety→workspace/account→category→entity inheritance ve effective
date/version kurallarını deterministik uygular. Guidance ranking bağlama girer ama policy
precedence'i değiştiremez. Context hash aynı inputlarda aynıdır; agent anlatımı hash'e dahil değildir.

## Çift yönlü analiz

- Top-down ana pass: portfolio/account→campaign→adset→ad/creative/post.
- Bottom-up driver pass: lokal anomali/fırsatın parent etkisini contribution ile yukarı taşır.
- Agent hangi yönde araştıracağını serbestçe uydurmaz; AnalysisAgenda ve bounded drill-down
  tool allowlist'i içinde kanıta göre ilerler.

Drill-down araçları:

- `drill_down_entity`
- `compare_timeframes`
- `compare_category_cohort`
- `get_metric_drivers`
- `get_pre_post_action`
- `get_creative_breakdown`
- `get_business_outcome_signals`
- `simulate_budget_plan`

## Context/token bütçesi

L5 bir run bütçesi taşır: maksimum entity/finding/guidance/source/time-series noktası ve
drill-down sayısı. Öncelik hard blocker/locked owner exception→primary KPI/driver→current
agenda topic→recent experiment/outcome→diagnostic'tir. Truncation kayıpsız reason ve
`moreAvailable` işareti taşır; agent gizli ham satır veya sınırsız dump isteyemez.

## Incremental hesap ve invalidation

- Entity/date slice upsert sonrası yalnız etkilenen L2/L3 rollup yeniden hesaplanır.
- Config/category/guidance/policy değişikliği ilgili context materialization'ını invalidate eder.
- Formula/catalog version değişimi yeni materialization üretir; eski run replay için korunur.
- PostgreSQL tabloları/materialized rollup + DB-backed job queue yeterlidir; ölçek eşikleri
  belgelenmeden başka data system eklenmez.

## BusinessOutcomeSignal

Meta proxy metrikleri gerçek iş sonucunun tamamı değildir. İlk sürüm optional manual/CSV
signal alır: qualified lead, appointment, sale/revenue, invalid/spam lead; entity/time/cohort
bağı ve provenance taşır. Eksik mapping'te Meta kampanya optimizasyonuna hüküm vermez.
Canlı CRM connector'ı ayrı ileriki incrementtir ve A08/A10'u bloke etmez.

## Kabul değişmezleri

1. L0 raw payload hiçbir agent prompt/context'ine doğrudan girmez.
2. Aynı snapshot/context versions aynı L2–L5 deterministic çıktıyı üretir.
3. Campaign finding en az bir bounded driver path veya “driver unresolved” nedeni taşır.
4. Guidance/policy değişimi yalnız etkilenen context'i invalidate eder.
5. Context budget aşımı sessiz veri kaybı değil explicit truncation/moreAvailable üretir.
6. PostgreSQL dışında yeni altyapı ancak ölçülmüş hacim/latency eşiğiyle açılır.
