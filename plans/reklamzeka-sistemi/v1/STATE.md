# reklamzeka-sistemi v1 — STATE

> Güncelleme: 2026-08-06 · oturum: ot:2026-08-06/reklamzeka-faz-0-kurulum

## Faz durumu

| Faz | Durum | Not |
|---|---|---|
| 0 — Temel + doğrulama | **SÜRÜYOR** | Kod ayağı TAMAM (2026-08-06): iskelet, terminoloji lint'i, SQLite+Sheets şemaları, taksonomi çözücü, rubrik varsayılanları, meta_gateway+guardrails, 14 test yeşil + 2 MCP testi token bekliyor. Kalan: kullanıcı adımları (aşağıda) + canlı doğrulama (docs/api-gercekleri.md teyitsiz tablo) |
| 1 — MVP salt-okuma | bekliyor | Faz 0 canlı doğrulaması ön koşul |
| 2 — Panel + onaylı yazma | bekliyor | |
| 3 — Bütçe danışmanı | bekliyor | |
| 4 — Creative tanı + metin kuralları | bekliyor | |
| 5 — v2: CRM açık kapısı | bekliyor | Kullanıcı kararı: CRM var, v2'de devreye girecek |

## Bloklar / kullanıcıdan beklenen

- Meta Ads MCP OAuth (reklamveren yolu) — interaktif oturum gerekli; sonrasında
  `META_MCP_ACCESS_TOKEN=... .venv/bin/pytest tests/test_mcp_contract.py -v`.
- Google Sheets kimlik bilgisi (service account JSON) + hedef Sheet oluşturma.
- Python 3.12 kurulumu (makinede yalnız sistem 3.9 var; kod 3.9'da da koşuyor,
  venv onunla kuruldu — ama proje hedefi 3.12: `brew install uv` önerilir).
- MASTER §10'daki 8 açık soru (ad account yapısı, İKA/İKK envanteri, tavanlar, CRM arayüzü…).
