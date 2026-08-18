# P05-F — Yerel Codex Guide Run taşıyıcı adayı

## Kapsam

- `CodexGuideRunAgentAdapter`, mevcut salt-okunur `LocalCodexExecAdapter` üzerinden Daily ve Holistic P05 portlarını üretim scheduler kompozisyonuna bağlar.
- Taşıyıcı ayrı `REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED=true` kapısını gerektirir. Meta read ve Guide scheduler kapıları tek başına süreç başlatamaz; interaktif Orchestrator bayrağı da scheduled agent yetkisi vermez.
- Provider cevabı yalnız exact/versioned `finding|no_change` sınıflamasıdır. Markdown, ekstra alan, bilinmeyen sürüm ve 2 KiB üstü çıktı reddedilir.
- Provider hash/ref/candidate üretemez. Evidence hash ile finding/recommendation ref sunucuda deterministik türetilir.
- Server-owned metric adaptörü aynı RR/read-only transaction içinde aktif Guide head, immutable scope snapshot, current exact slice revision ve canonical membership hash'i yeniden doğrular. Guide metni ile önceki 14 tamamlanmış güne ait en fazla 1.024 attribution-korumalı raw metric satırı taşınır; eksik gün `partial`, hiç kanıt yokluğu `unavailable` kalır.
- Metric port çıktısı adaptör sınırında exact shape/ref/hash/date/decimal/currency/cardinality ve canonical evidence hash ile ikinci kez doğrulanır; 1 MiB prompt sınırı vardır.
- Typed candidate builder henüz ayrı kabul edilmediğinden Holistic sonuç daima `dataQuality=missing`, `candidate=null` olur. Guide edit, approval, execution ve Meta write authority sıfırdır.

## Doğrulama

- Focused Guide Run: 4 dosya / 22 test geçti.
- `npm run typecheck -- --pretty false`: geçti.
- `git diff --check`: geçti.

## Açık sınır

Bu alt dilim gerçek sağlayıcı taşımasını ve frozen/current bağlı metrik okumasını kapatır; R3-15’in server-owned typed candidate üretimi ve mode-gated staging happy path’ini kapatmaz. Model cevabı tek başına ActionUnit girdisi olamaz. Bağımsız kritik inceleme ve canlı PostgreSQL evidence fixture yapılmadan bu kayıt kabul statüsü değildir.
