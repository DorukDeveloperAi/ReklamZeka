---
kosum: tek-ajan
---
# Aşama 05 — Performans deneyimi (v1)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 03, 04

## SONUÇ

**Bu aşama bitince:** Kullanıcı çalışma alanından kampanyaya kadar 7/30/90 günlük metrikleri,
karşılaştırmayı, para birimini, attribution'ı ve veri tazeliğini erişilebilir bir arayüzde görür.

## Task'lar

### T05.1 — Aktivasyon ve veri durumu
**SONUÇ:** Bağlantı/CSV, ilk senkronizasyon, boş, kısmi, gecikmiş ve hata durumları ayrıdır.
**Kabul kriteri:** Durum fixture'ları görsel ve erişilebilirlik testlerini geçer.

### T05.2 — Genel bakış ve drill-down
**SONUÇ:** Müşteri özeti, kanal/kampanya tablosu, dönem kıyası ve filtreler ortak metrik tanımlarını kullanır.
**Kabul kriteri:** UI toplamları API golden fixture sonuçlarıyla eşleşir.

### T05.3 — Mobil ve erişilebilirlik
**SONUÇ:** Kritik metrik ve hata akışları klavye, ekran okuyucu ve mobil genişlikte kullanılabilir.
**Kabul kriteri:** Otomatik a11y ve üç viewport smoke testi temizdir.

## Doğrulama

Fixture tabanlı tarayıcı senaryosu girişten kampanya detayına kadar ekran görüntüsü ve JSON kanıtı üretir.
