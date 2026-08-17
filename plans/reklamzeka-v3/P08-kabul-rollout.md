# P08 — kabul-rollout

**Bağımlılık:** M00–P07 cross gate. **DoD:** R3-21–R3-23.

## Minimum ve merge gates

Her teslimin minimum gate'i: `npm run typecheck`, `npm run test:unit -- <hedef testler>`, `npm run db:check`, `npm run check:security-boundaries`, `git diff --check`. Birleşim gate'i: `npm test`, `npm run check:security-boundaries`, `npm run check:experience`, `npm run check:pilot-web`, `npm run check:pilot-readiness`, `npm run build`. İlgili `verify:*` DB scriptleri ve browser local-session matrisi ayrıca çalıştırılır. DB forward-only migrationdır: her yeni tablo tenant-bound composite FK, tenant-leftmost index, RLS enabled+forced, Data API grant revoke, append-only/immutable guard, tombstone/purge lifecycle, migration/cross-tenant ve bounded pagination testleri taşır. Backfill idempotent, batch'li, yeniden başlatılabilir ve başarısız satırı loglayan yapıdadır; destructive rewrite yoktur.

## Functional/browser matrisi

Functional matris: P01 source/lease/manual/6h/missing-zero/currency/CBO-ABO/stale block; P02 hierarchy/membership/primary-result/dimension precedence/template preview; P03 hybrid precedence/AND-OR/current-frozen/table/pivot/day-week-month/raw-actions/saved/export; P04 guide revision/manual/schedule/four modes/NL diff/stale/detach/four budget layers; P05 exact run states/missed coalescing/two-agent denials/fingerprint/lifecycle/DevLog; P06 overlap/human flow/rename/create denial/autonomy admission/executor ten steps/RAW/retry/rollback; P07 five areas/legacy mapping; P08 payment/delivery confirmed-suspected/RLS/write boundary.

Browser matrisi `ready`, `partial`, `empty`, `unavailable`, `demo`, `loading`, `401`, `403`, `409` ve `503` durumlarını; 320/390, 768, 1024 ve 1440 px ekranları; light/dark visual regression, WCAG 2.2 AA, yalnız klavye, screen-reader semantiği, 10.000 görünür düğümlü tablo virtualization, filter/sort/drill sonrası focus/scroll restoration ve sağ tık/Shift+F10/mobile action-sheet eşdeğerliğini kapsar.

## Rollout

Rollout adımları kesin olarak: **1** read-only Meta sync ve veri sağlığı, **2** Kurum Kampanyası/künye/slice, **3** analyze/recommend Kılavuzları, **4** insan onaylı budget/status/rename pilotu, **5** bounded budget/status autonomy canary, **6** workspace/account bazlı genişletme. Feature flag'ler: `meta_read_enabled`, `guide_scheduler_enabled`, `human_action_execution_enabled`, `limited_autonomy_enabled`, `meta_write_enabled`; ayrıca workspace/account/action allowlist zorunludur. Global `meta_write_enabled` varsayılan olarak kapalı kalır. Protected pilotta tek yetkili insanın gerçek adapter ile budget ve status human-approved write'ı; preflight, RAW, idempotent retry, timeline, before/after verify ve rollback kanıtı zorunludur. Rename human-only test edilir; create reddedilir. Her sapmada kill switch, rollback ve DevLog/audit çalışır.
