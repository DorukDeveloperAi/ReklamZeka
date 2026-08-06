# ReklamZeka Analiz Platformu — STATE (v2)

| # | aşama | durum | kanıt |
|---|---|---|---|
| 01 | analiz sözleşmesi | DEVAM | `src/analyses/schema.ts` + tanım negatif testleri; lifecycle/dry-run sırada |
| 02 | scheduler ve run ledger | AÇIK | — |
| 03 | prompt anlatım katmanı | DEVAM | objective playbook + prompt envelope + claim validator; model/audit sırada |
| 04 | ürün yüzeyi | AÇIK | — |
| 05 | operasyon ve rollout | AÇIK | — |

## 2026-08-06 — kapsam kararı

- Mevcut v1'in yalnız dört sabit deterministik kural ve 7/30/90 manuel dönem taşıdığı doğrulandı.
- Kullanıcı tanımlı analiz, timeframe, scheduled run ve prompt eklentisi v2 olarak ayrıldı.
- “Doğrudan prompt enjeksiyonu” reddedildi; narrative-only, yapılandırılmış ve kanıt bağlı
  eklenti sınırı seçildi.
- İlk uygulama işi: analiz tanımı/timeframe/schedule/rule DSL şeması ve negatif test matrisi.

## 2026-08-06 — kampanya amacına duyarlı temel uygulandı

- Altı amaç için sürümlü playbook eklendi: ana KPI, teşhis metrikleri, guardrail,
  minimum sample, varsayılan dönem/takvim, değerlendirme soruları ve karar kılavuzu.
- `objective + funnelStage + optimizationEvent + classificationSource` yayın öncesi
  uyumluluk kapısına bağlandı; belirsiz sınıflandırma yayınlanamaz.
- Mevcut kanonik veri modelinde olmayan kategori metrikleri generic `conversions` alanına
  sessizce eşlenmedi; readiness blocker/warning olarak raporlanır.
- Prompt talimatı sabit politikaya birleştirilmez; `untrusted_data` alanında yalnız
  ton, odak ve bölüm sırasını etkiler. Her çıktı ifadesi `findingId` ister.
