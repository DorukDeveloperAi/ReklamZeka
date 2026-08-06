---
kosum: tek-ajan
---
# Aşama 10 — Kampanya bağlamlı zamansal analiz

## SONUÇ

Sistem tek metrik eşiği yerine Meta config + internal category + talimat + kreatif +
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

## Kabul ve kanıt

- Awareness ve sales aynı snapshot'ta farklı KPI/karar sorusu üretir.
- Protected budget talimatı bulguyu gizlemez ama aksiyon uygunluğunu bastırır.
- Reach/frequency toplanmaz; ratio aggregate doğru; generic conversion outcome yerine geçmez.
- Aynı girdi byte-eş; action pre/post contamination ve insufficient data sebepli.
- En az bir campaign finding'i adset→ad→creative driver zincirine iner.
