# + P03-A — Canonical slice registry ve frozen resolution

- `deliveryRef`: P03-A-canonical-slice-registry-20260817
- Durum: `+` kabul edildi; bu alt task arşivlenebilir. P03 paketinin Operasyon/Kapsam Raporu vertical'ları açıktır.
- Commit zinciri: `e23efb1`, `25f2266`, `328cf95`, `3a08c38`, `388cea8`.
- Contract: immutable slice revision; dimensions AND / values OR; `(dynamic OR include) AND NOT exclude`; `exclude > include > dynamic`; canonical yerli/yabancı hard boundary; exact frozen member evidence/replay.
- Persistence: stable tenant-scoped `slice_ref`, relational predicates/values/overrides, OCC head publication, append-only resolution snapshots/members.
- DB: additive migrations `20260817133000` ve forward-only guard fix `20260817134500` canlı uygulanmıştır; 7 tablo RLS enabled+forced ve Data API dark-grant'tır.
- Canlı doğrulama: gerçek `SliceRegistryService` + Drizzle repository ile exact-head publish başarı; stale head reject; persisted revision/hash freeze başarı; tampered snapshot/member ve başka revision binding reject; cross-tenant/cross-market/market predicate/append-only negatives; outer rollback zero residue.
- Exact command: `node --env-file=.env.local --import tsx scripts/verify-slice-registry-postgres.ts` → PASS.
- Gates: 3 focused dosya / 20 test; typecheck, db:check, security-boundaries ve diff-check PASS.
- Authority / Meta write: publish yalnız registry lifecycle'dır; Guide/action/approval/Meta write yetkisi `0`.
- Rollback: uygulanan migration geçmişi rewrite edilmez; gerekirse yalnız forward migration. Test fixture outer transaction ile tamamen rollback olur.
