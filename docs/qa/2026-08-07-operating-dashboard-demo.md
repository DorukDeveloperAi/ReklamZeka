# Operating Dashboard + Orchestrator demo QA — 2026-08-07

## Kapsam

- Route: `/dashboard` ve `/reports/demo`
- Veri: mevcut kanonik demo snapshot'ı + açıkça etiketli ürün-vizyonu operasyon fixture'ı
- Güvenlik: gerçek Meta write yok; approval execute değildir

## Tarayıcı doğrulaması

| kontrol | sonuç |
|---|---|
| 1440×900 Today görünümü | PASS; yatay overflow yok |
| 390×844 mobil görünüm | PASS; `scrollWidth=clientWidth=390` |
| Sidebar/mobile navigation | PASS |
| Rule text edit + draft save | PASS; publish/action etkisi olmadığı mesajı görünür |
| Orchestrator mesajı + RuleCoach sınırı | PASS |
| Approval satırı | PASS; onay sonrası `execute bekliyor` |
| Demo execute sınırı | PASS; Meta write kapalı mesajı |
| Campaign context ve live copy görünümü | PASS |
| Budget scenario ve scoped autonomy kontrolleri | PASS |

## Ürün sınırı

Bu kanıt bilgi mimarisi ve frontend demo etkileşimine aittir. Meta Read Mirror, gerçek
Orchestrator MCP/skill runtime, persistent policy/budget store, autonomy resolver ve Meta
executor'ın tamamlandığı anlamına gelmez. Bu yetenekler v2 S1–S4 plan kapılarındadır.
