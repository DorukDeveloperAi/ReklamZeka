---
kosum: tek-ajan
---
# Aşama 03 — Prompt anlatım katmanı (v2)

## SONUÇ

Opsiyonel model yalnız deterministik bulguları özetler; kullanıcı talimatı sistem politikasını,
veri kapsamını, aracı veya eylem sınırını değiştiremez.

## Task'lar

- Sabit politika ve JSON prompt envelope; user guidance yalnız veri alanı.
- `findingId` bağlı claim/output şeması; yeni metrik ve kanıtsız iddia reddi.
- Prompt injection, tool çağrısı, secret isteme ve cross-tenant negatif matrisi.
- Model/prompt/sampling sürümü, maliyet, redaksiyon ve audit.
