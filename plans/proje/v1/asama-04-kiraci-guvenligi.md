---
kosum: tek-ajan
---
# Aşama 04 — Kiracı güvenliği (v1)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 02
> Durum: **KAPALI** · 2026-08-06

## SONUÇ

**Bu aşama bitince:** Kimlik doğrulama, çalışma alanı üyeliği, rol, bağlantı sırrı ve audit
olayları sunucu tarafı sınırlarla korunur; çapraz kiracı ve sır sızıntısı testleri kırmızı yanabilir.

## Task'lar

### T04.1 — Kimlik ve üyelik
**SONUÇ:** Owner/admin/analyst/viewer rolleri ve çalışma alanı üyeliği API seviyesinde zorlanır.
**Kabul kriteri:** Her kaynak için yetkili ve çapraz-kiracı negatif entegrasyon matrisi geçer.

### T04.2 — Sır ve OAuth sınırı
**SONUÇ:** Tokenlar şifreli, döndürülebilir ve loglardan dışlanmıştır; MVP yalnız read scope ister.
**Kabul kriteri:** Fixture secret log/hata/istemci yanıtında bulunmaz; scope testi write izni görürse fail olur.

### T04.3 — Audit
**SONUÇ:** Bağlantı, senkronizasyon, paylaşım ve öneri geri bildirimi değişmez aktör/zaman/kaynak kaydı üretir.
**Kabul kriteri:** Audit olay şeması ve kritik akış entegrasyon testleri geçer.

## Doğrulama

Yetki matrisi, tenant escape, secret scan ve audit bütünlüğü tek tam kanıt kümesinde çalışır.

## Kapanış kanıtı

- `npm run check:security-boundaries` — yapısal kapı, 2 dosya / 7 test ve Drizzle kontrolü temiz.
- `tests/security-boundaries.test.ts` — rol matrisi, çapraz kiracı, şifreleme, scope, redaksiyon ve audit hash zinciri.
- `drizzle/20260806155332_vengeful_chimera.sql` — şifreli sır ve append-only audit kalıcılığı.
- `docs/ADR/0003-kiraci-ve-sir-guvenligi.md` — sunucu policy, AES-256-GCM, scope ve audit kararları.
