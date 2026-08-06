---
kosum: tek-ajan
---
# Aşama 03 — Veri platformu (v1)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 02

## SONUÇ

**Bu aşama bitince:** Meta Ads, Google Ads ve CSV fixture'ları kaynak izini koruyarak aynı
kanonik modele idempotent akar; tazelik ve senkronizasyon hataları ölçülür.

## Task'lar

### T03.1 — Kanonik şema
**SONUÇ:** Hesap, kampanya, gün ve metrik grain'i; para birimi, saat dilimi ve attribution alanları sürümlüdür.
**Kabul kriteri:** Şema sözleşme testleri iki platform fixture'ını beklenen ortak metriklere dönüştürür.

### T03.2 — Connector sözleşmesi ve CSV
**SONUÇ:** Connector arayüzü salt-okunur scope, cursor, retry, rate-limit ve hata sınıflarını taşır; CSV aynı arayüzü uygular.
**Kabul kriteri:** Contract suite Meta/Google adapter fixture'ları ve CSV üzerinde aynı testleri geçer.

### T03.3 — İdempotent ingest
**SONUÇ:** Tekrarlanan ve yarıda kesilip sürdürülen senkronizasyon kayıt çoğaltmaz.
**Kabul kriteri:** Aynı fixture ×2 ve resume senaryosu sonrası satır/hash sonuçları birebir eşittir.

## Doğrulama

Kanonik metrik golden fixture'ları, idempotency, retry ve gecikmiş veri senaryoları tam kanıt girişine bağlanır.
