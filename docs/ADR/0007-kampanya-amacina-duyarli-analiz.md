# ADR-0007 — Kampanya amacına duyarlı analiz ve karar kılavuzu

## Bağlam

Awareness kampanyasını ROAS, satış kampanyasını yalnız CTR ile değerlendirmek yanlış karar
üretir. Meta ve Google objective adları farklıdır; aynı platform objective'i bile seçilen
optimizasyon olayına göre farklı başarı sinyali taşıyabilir.

## Karar

- Tek `campaignType` yerine dört boyut saklanır: kanonik `objective`, `funnelStage`,
  `optimizationEvent` ve `classificationSource`.
- Sınıflandırma önceliği: doğrulanmış kullanıcı override'ı → kesin platform mapping'i →
  belirsiz. Belirsiz sınıflandırmada kesin karar üretilmez.
- Her objective sürümlü bir playbook taşır: primary KPI, diagnostic metrics, guardrails,
  minimum sample, varsayılan timeframe/schedule, evaluation questions ve decision guide.
- Kullanıcı playbook'u şablonunda genişletebilir; zorunlu kanıt ve güvenlik guardrail'lerini silemez.
- Objective'ler arasında harcama dağılımı karşılaştırılabilir; başarı KPI'ları aynı lig
  tablosuna konmaz.

## Başlangıç objective seti

| objective | primary değerlendirme | diagnostic | guardrail |
|---|---|---|---|
| `awareness` | reach, frequency, CPM | impressions, video completion | aşırı frequency, tazelik |
| `traffic` | landing-page view, CPC | clicks, CTR | bounce/kalite sinyali, tazelik |
| `engagement` | engagement rate, CPE | video/interaction kırılımı | düşük kaliteli etkileşim |
| `lead_generation` | qualified leads, CPL | form rate, lead volume | kalite oranı, takip gecikmesi |
| `app_growth` | install/CPI ve cohort sonucu | click-to-install | retention, event kalitesi |
| `sales` | purchase, revenue, ROAS/CPA | CVR, basket value | attribution, stok/marj |

Mevcut kanonik model bu metriklerin tamamını taşımıyor. Playbook readiness kontrolü eksik
zorunlu metriği açık blocker olarak gösterir; generic `conversions` alanını sessizce yanlış
anlama eşlemez.

## Prompt kompozisyonu

Sıra sabittir: platform politikası → objective playbook → analysis definition sürümü →
resolved timeframe/snapshot → deterministik findings → veri alanı olarak user guidance →
çıktı şeması. Sonraki katman önceki güvenlik ve kanıt sınırını ezemez.
