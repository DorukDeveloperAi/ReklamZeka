---
kosum: tek-ajan
---
# Aşama 06 — İçgörü motoru (v1)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 03, 04

## SONUÇ

**Bu aşama bitince:** Deterministik başlangıç kuralları performans sapmasını kaynak, karşılaştırma,
güven ve önerilen sonraki adımla üretir; aynı snapshot aynı sonucu verir.

## Task'lar

### T06.1 — İçgörü şeması ve kural SDK'sı
**SONUÇ:** Her bulgu zorunlu kanıt alanlarını ve hesaplama sürümünü taşır.
**Kabul kriteri:** Eksik kaynak/güven/sürüm içgörüsü şema kapısından geçemez.

### T06.2 — İlk kural seti
**SONUÇ:** Harcama sıçraması, dönüşüm düşüşü, CPA/ROAS sapması ve veri gecikmesi kuralları golden fixture'larda çalışır.
**Kabul kriteri:** Pozitif/negatif/az-veri fixture matrisi beklenen hükümleri verir.

### T06.3 — Geri bildirim
**SONUÇ:** Yararlı, yararsız ve aksiyon alındı geri bildirimi kullanıcı ve içgörü sürümüne bağlı audit olayıdır.
**Kabul kriteri:** Yetki ve idempotency entegrasyon testleri geçer.

## Doğrulama

Aynı snapshot iki kez çalıştırılır; sıralı içgörü JSON'u byte-eş ve kanıt alanları tamdır.
