# ReklamZeka Analiz Platformu — CHECKLIST (v2)

## Aşama 01 — analiz sözleşmesi
- [ ] Sürümlü şablon ve draft/published/archived yaşam döngüsü
- [ ] Güvenli kural DSL ve negatif parser matrisi
- [ ] Rolling/fixed/calendar timeframe + comparison resolver
- [ ] Workspace rol policy ve audit olayları

## Aşama 02 — scheduler
- [ ] Schedule sözleşmesi ve IANA timezone doğrulaması
- [ ] DST/misfire/concurrency politikası
- [ ] İdempotent run ledger ve retry sınıfları
- [ ] Manuel run ile scheduled run aynı yürütücüyü kullanır

## Aşama 03 — prompt katmanı
- [ ] Narrative-only prompt envelope
- [ ] Finding bağlı çıktı şeması ve claim validator
- [ ] Injection/secret/tool/tenant negatif matrisi
- [ ] Model, prompt ve sampling sürüm kaydı

## Aşama 04 — ürün yüzeyi
- [ ] Şablon liste/editör/dry-run/yayın akışı
- [ ] Timeframe, comparison ve schedule editörü
- [ ] Run geçmişi, durum, hata ve yeniden çalıştırma
- [ ] Responsive/a11y browser E2E

## Aşama 05 — operasyon ve rollout
- [ ] Kota, alarm, runbook ve maliyet guardrail'leri
- [ ] Migration/backfill ve feature flag
- [ ] Güvenlik ve production build kapıları
- [ ] Kontrollü workspace rollout ve feedback raporu
