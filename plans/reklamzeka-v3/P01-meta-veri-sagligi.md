# P01 — meta-veri-sagligi

**Bağımlılık:** M00. **DoD:** R3-01–R3-04.

## Teslim

- Meta mirror kampanya/ad set/reklam/creative, status, objective, delivery, targeting, platform, geo, result route, content, spend/impression/result ve source provenance/freshness alanlarını kanonik aynalar.
- Sync frekansı 6 saattir; manual refresh aynı lease/idempotency düzenini kullanır.
- Source-state: hazır, kısmi, boş, kullanılamıyor, demo. Missing, zero değildir.
- Currency mismatch tekil alerttir, cross-currency metric/kohorttan dışlar.
- Ham mirror/events süresiz saklanır. Budget current değer, budget-event timeline ve CBO/ABO ayrımı görünür.
- Missing/stale kaynak finding + DevLog üretir ve action candidate/application block eder.

## Test, rollout, rollback

Lease race/manual-vs-scheduled, 6h freshness, all-state, missing-vs-zero, currency alert/exclusion, CBO/ABO, retention ve stale action-block fixture’ları; DB/API/browser kabulü zorunludur. Kaynak adapter flag ile geri alınır, ham tarihçe silinmez.

