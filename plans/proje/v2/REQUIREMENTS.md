# ReklamZeka Analiz Platformu — REQUIREMENTS (v2)

| id | requirement | doğrulama |
|---|---|---|
| R-A1 | Analiz tanımı workspace, owner, sürüm, durum ve immutable yayın içeriği taşır. | schema + lifecycle suite |
| R-A1a | Her tanım objective, funnelStage, optimizationEvent ve doğrulanmış classificationSource taşır. | objective mapping suite |
| R-A1b | Objective profile ana KPI, diagnostic, guardrail, minimum sample ve decision guide taşır. | playbook contract suite |
| R-A1c | Farklı objective'lerin uyumsuz başarı KPI'ları tek hükümde doğrudan karşılaştırılmaz. | cross-objective negative suite |
| R-A2 | Kural DSL yalnız allowlist metric/operator ve sayısal eşik kabul eder; kod/SQL taşımaz. | parser negatif matrisi |
| R-A3 | Timeframe rolling/fixed/calendar biçimlerinden biridir; timezone ve comparison açıktır. | window resolver golden suite |
| R-A4 | Dry-run seçilen snapshot üzerinde bulgu ve veri yeterliliğini yayın öncesi gösterir. | API/engine entegrasyonu |
| R-S1 | Schedule hourly/daily/weekly/monthly sözleşmesi, IANA timezone, misfire ve enabled durumu taşır. | schedule validation suite |
| R-S2 | Aynı logical fire iki kez teslim edilse bile tek analysis run oluşur. | concurrency/idempotency testi |
| R-S3 | Run kaydı resolved window, snapshotId, definitionVersion, status, attempt ve hata sınıfını taşır. | run ledger suite |
| R-S4 | DST boş/çift yerel saatleri belgelenmiş tek hüküm üretir. | timezone golden matrix |
| R-P1 | Prompt eklentisi yalnız narrative üretir; kural/timeframe/tenant/tool politikasını değiştiremez. | injection negatif matrisi |
| R-P2 | Model girdisi sabit politika + yapılandırılmış bulgular + veri olarak user guidance biçimindedir. | prompt envelope snapshot testi |
| R-P3 | Her anlatım iddiası mevcut findingId'ye referans verir; yeni metrik veya aksiyon uyduramaz. | output schema/claim validator |
| R-P4 | Prompt/model/sampling değişikliği narrativeVersion artırır; girdi/çıktı audit ve redaksiyon taşır. | version/audit suite |
| R-U1 | Kullanıcı taslak oluşturur, dry-run yapar, yayınlar, schedule eder, durdurur ve run geçmişini görür. | browser E2E |
| R-U2 | Rol policy: owner/admin yayınlar; analyst taslak/dry-run; viewer yalnız sonuç okur. | tenant/role matrisi |
| R-O1 | Workspace concurrency, günlük run ve narrative bütçesi aşımında fail-closed çalışır. | quota suite |
| R-O2 | Scheduled sonuç yalnız rapor/bildirim üretir; reklam platformu write scope'u yoktur. | connector/security gate |
