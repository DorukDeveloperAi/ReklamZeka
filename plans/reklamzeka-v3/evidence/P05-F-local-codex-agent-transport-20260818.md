# P05-F — Yerel Codex Guide Run taşıyıcı adayı

## Kapsam

- `CodexGuideRunAgentAdapter`, mevcut salt-okunur `LocalCodexExecAdapter` üzerinden Daily ve Holistic P05 portlarını üretim scheduler kompozisyonuna bağlar.
- Taşıyıcı ayrı `REKLAMZEKA_GUIDE_RUN_CODEX_ENABLED=true` kapısını gerektirir. Meta read ve Guide scheduler kapıları tek başına süreç başlatamaz; interaktif Orchestrator bayrağı da scheduled agent yetkisi vermez.
- Provider cevabı yalnız exact/versioned `finding|no_change` sınıflamasıdır. Markdown, ekstra alan, bilinmeyen sürüm ve 2 KiB üstü çıktı reddedilir.
- Provider hash/ref/candidate üretemez. Evidence hash ile finding/recommendation ref sunucuda deterministik türetilir.
- Server-owned metric adaptörü aynı RR/read-only transaction içinde aktif Guide head, immutable scope snapshot, current exact slice revision ve canonical membership hash'i yeniden doğrular. Guide metni ile önceki 14 tamamlanmış güne ait en fazla 1.024 attribution-korumalı raw metric satırı taşınır; eksik gün `partial`, hiç kanıt yokluğu `unavailable` kalır.
- Metric port çıktısı adaptör sınırında exact shape/ref/hash/date/decimal/currency/cardinality ve canonical evidence hash ile ikinci kez doğrulanır; 1 MiB prompt sınırı vardır.
- Model hiçbir action/candidate alanı üretemez. Sunucu yalnız tam bir finding üyesi, tek izinli `status_pause|status_activate`, frozen+current exact ad-set üyeliği ve uyuşan güncel configured/effective status varsa canonical `candidate/1.1` kurar. Çoklu finding, campaign/budget action, stale/conflicting status veya resolver hatası `candidate=null` bırakır.
- Candidate üzerindeki `dataQuality=ready` yalnız server candidate kanıtının tamamlığını ifade eder; orchestration disposition aşamasındaki bağımsız trusted data-health recheck bunu yeniden doğrular ve hazır değilse staging’i tutar.
- Guide edit, approval, execution ve Meta write authority sıfırdır.

## Doğrulama

- Focused provider/candidate/worker: 4 dosya / 22 test geçti (önceki Guide Run domain/persistence suite ayrıca korunur).
- Uygulanmış P06 POST fixture'ı P05 repository çıktısını doğrudan persisted disposition'a besledi; `serverOwnedStatusCandidate`, `completedRun`, `actionQueuePersisted`, `materialized`, `replay`, iki-client concurrency ve `zeroResidue` dahil bütün bayraklar `true`, süreç exit `0` oldu.
- Bu canlı zincirde candidate public frozen/current üye ref/hash'inden üretildi, typed status `ACTIVE→PAUSED` sunucuda türetildi ve aynı çıktı immutable P05 disposition → P06 ActionUnit materialization/replay yolunda kullanıldı.
- `npm run verify:guide-run-codex-live` iki gerçek local Codex sürecini sentetik public ref/hash kanıtıyla çalıştırdı: Daily ve Holistic cevapları exact `no_change`, candidate/recommendation yok, bütün authority bayrakları kapalı ve Meta write girdisi yok; exit `0`, `elapsedMs=9686`.
- `npm run typecheck -- --pretty false`: geçti.
- `git diff --check`: geçti.

## Açık sınır

Bu alt dilim gerçek sağlayıcı taşımasını, frozen/current bağlı metrik okumasını ve status ad-set için server-owned typed candidate üretimini kapatır. Model cevabı tek başına ActionUnit girdisi olamaz. Gerçek local Codex Daily/Holistic ve PostgreSQL candidate→P06 binding canlı fixture'ları tamamlandı; bağımsız kritik inceleme tamamlanmadan bu kayıt kabul statüsü değildir. Campaign/budget candidate yolları açıkça fail-closed kalır.
