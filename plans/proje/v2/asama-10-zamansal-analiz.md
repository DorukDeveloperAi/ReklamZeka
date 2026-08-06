---
kosum: tek-ajan
---
# Aşama 10 — Kampanya bağlamlı zamansal analiz

## SONUÇ

Sistem tek metrik eşiği yerine Meta config + internal category + guidance/policy + kreatif +
zaman serisini birlikte değerlendirir; ne oldu, neden incelenmeli, hangi kuralın devrede
olduğu ve hangi kararın henüz verilemeyeceği kanıtlıdır.

## Analiz ailesi

- Trend ve trend-kırılma; robust medyan/MAD anomali.
- Budget pacing: daily/lifetime/planned/committed/actual/forecast.
- Threshold/target/guardrail ve minimum sample.
- Previous-period, weekday-matched, target/baseline ve uyumlu cohort kıyası.
- Action-relative pre/post; attribution settle ve cooldown sonrası outcome izleme.
- Hiyerarşik driver: account→campaign→adset→ad→creative katkısı.
- Creative fatigue/rotation sinyali: frequency + delivery + asset performansı; causal iddia yok.
- Configuration diagnostics: objective/optimization/KPI uyuşmazlığı, budget owner,
  status inheritance, target/geo ve policy conflict.

## Task'lar

### T10.1 — Metrik kataloğu ve formüller
Additive/non-additive/ratio/action value; CTR/CPC/CPM/CPA/CPL/cost-per-message/ROAS/AOV/
conversion rates/video metrikleri; numerator/denominator provenance.

### T10.2 — Objective ve internal playbook composition
Meta objective temel profile + birden çok category overlay + entity exceptions. Overlay KPI'yı
sessiz değiştiremez; explicit override ve reason ister.

### T10.3 — Timeframe/comparison resolver
Rolling/fixed/calendar/lifetime/learning/action-relative; IANA timezone, inclusive dates,
weekday matching, previous year, baseline ve cohort. Golden DST/calendar matrix.

### T10.4 — Saf analiz fonksiyonları
DB/ağ/clock içermeyen analyze(input); deterministic order/ID; missing-data reason ve
snapshot-ref zorunlu. Window/formül sabitleri tek versioned katalogda.

### T10.5 — Driver ve configuration analysis
Campaign bulgusunu adset/ad/creative contribution ve config değişikliğiyle açıklar;
segment kıyası breakdown uyumluluk ve privacy/min sample guard'larından geçer.

### T10.6 — Action outcome evaluator
Timeline eylemini doğru önce/sonra pencereye bağlar; manual/external change contamination'ı
işaretler. “Sonrasında oldu” ile “eylem nedeniyle oldu” ayrı etiketlenir.

### T10.7 — Dry-run ve analysis ledger
Definition/policy/playbook versions, resolved context/window, input snapshot set, findings,
suppression, data quality ve calculation version append-only analysis run'a yazılır.

### T10.8 — Sıralı AnalysisAgenda
Versioned agenda: genel veri/portföy→group/account→objective/funnel→internal category'ler→
campaign→adset→ad/creative/post→budget/pacing→experiment/history→decision. Kullanıcı sıra,
başlık veya category subset seçebilir. Top-down ana pass, finding'e bağlı bounded bottom-up drill-down.

### T10.9 — EffectiveGuidancePack assembler
Önce strict scope filter, sonra bounded full-text/relevance ranking; applied/suppressed/
conflicting/missing cards, source/freshness ve “neden seçildi” reason. Context budget her
scope'ta must/exception önceliğiyle özetlenir; semantic ranking policy enforcement yapamaz.

### T10.10 — Decision cadence ve hiperaktivite guard'ı
Data settle, min observation, learning/cooldown, entity başına max karar/hamle, repeat
cooldown, evidence threshold ve emergency lane. Her karar act/test/observe/no-change olarak
sonuçlanabilir; yeni kanıt yoksa tekrar öneri bastırılır.

### T10.11 — Experiment/decision ledger
Hypothesis/question, baseline, tek ana değişken, primary metric, guardrails, min sample/window,
stop condition, contamination ve winner/loser/inconclusive. Karar→action→outcome aynı timeline'a bağlanır.

### T10.12 — L0–L5 işleme pipeline'ı
Raw→canonical→deterministic features→window/rollup→evidence graph→compact agent context.
PostgreSQL materialized tables ve DB-backed worker; entity/date incremental recompute,
formula/catalog/context version ve explicit invalidation. Raw L0 agent'a verilmez.

### T10.13 — EffectiveCampaignContext resolver
Meta identity/config, categories, EffectiveGuidancePack, enforceable policy, cadence, budget/
targets, data quality/L2-L3 refs ve action/experiment/advised-practice/outcome history'yi
frozen hash olarak derler. Top-down pass ve bounded bottom-up driver tools aynı context'i kullanır.

### T10.14 — Business outcome signal
Optional manual/CSV qualified lead, appointment, sale/revenue ve invalid/spam lead;
entity/time/cohort/provenance mapping. Eksik veya belirsiz mapping Meta proxy metriğini
gerçek iş sonucu yapmaz. Live CRM connector ayrı ileri incrementtir.

## Kabul ve kanıt

- Awareness ve sales aynı snapshot'ta farklı KPI/karar sorusu üretir.
- Protected budget talimatı bulguyu gizlemez ama aksiyon uygunluğunu bastırır.
- Reach/frequency toplanmaz; ratio aggregate doğru; generic conversion outcome yerine geçmez.
- Aynı girdi byte-eş; action pre/post contamination ve insufficient data sebepli.
- En az bir campaign finding'i adset→ad→creative driver zincirine iner.
- Aynı campaign sıralı agenda'da global/group/objective/category/topic guidance'ını sebepli
  getirir; subset run yalnız seçilen pass'leri koşar.
- Learning/cooldown içindeki entity için acil guardrail yoksa no-change/observe çıkar;
  agent “bir şey yapmış olmak için” proposal üretmez.
- Aynı source snapshot/context versions L2–L5 hash'ini tekrar üretir; raw payload promptta yoktur.
- Business outcome eşleşmiyorsa nitelikli lead/satış iddiası yayınlanmaz.
