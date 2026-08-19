# P04-B — Kılavuz persistence ve lifecycle

- deliveryRef: `P04-B-guide-persistence-20260817`
- requirements: immutable Kılavuz revision, exact interpretation acceptance, tek-insan activation, old-active/new-draft, append-only lifecycle/outbox, tenant/RLS sınırı
- migration: `20260817151000_guide_lifecycle_integrity_forward.sql`
- applied ledger: id `128`, SHA-256 `21756fe77d3ccd4db2250b8c4e2b91bb63fb9629ea9122de6c31ce6af6455678`; dosya hash'i birebir aynı
- authority: activation yalnız ReklamZeka içi Kılavuz head değişimidir; approval/action/Meta write yetkisi `0`

## Kabul kanıtı

- `previous_revision_hash` ve canonical `market_key` forward-only eklenip exact predecessor/current published non-tombstoned same-market slice guardıyla doğrulanır.
- Revision, actions ve typed budget refs bounded çocuk kayıtlardan kanonik yeniden kurulur; hash/authority/tamper fail-closed'dur.
- WorkspaceRef server-derived'dır. Agent/analyst guide mutation yapamaz; tek owner aynı revision interpretation'ını kabul edip aktive edebilir.
- Yeni draft hazırlanırken eski active revision çalışmaya devam eder. Başarısız activation head'i değiştirmez.
- Acceptance, lifecycle event ve activation outbox conflictleri immutable alanları exact karşılaştırır; tamper idempotent sayılmaz.
- Pause→reactivate→pause farklı head occurrence'larıdır; exact retry aynı occurrence'a bağlanır.
- 13 composite FK için tenant-leftmost index; 8/8 tablo `RLS ENABLED + FORCED`; PUBLIC/anon/authenticated/service_role grant sayısı `0`.

## Canlı outer-rollback verifier

`node --env-file=.env.local --import tsx scripts/verify-guide-lifecycle-postgres.ts`:

- canonical reload `true`
- analyst spoof reject `true`
- missing acceptance reject `true`
- acceptance idempotent `true`
- old active survives / failed activation keeps old `true`
- reactivation + exact retry `true`; time tamper reject `true`
- cross-workspace, cross-market ve composite FK reject `true`
- revoked `true`, archived `true`, lifecycle event count `11`
- outer rollback + zero residue `true`

İlk postflight denemesinde verifier'ın beklenen direct FK ihlali outer transaction'ı `25P02` durumuna soktu. Uygulama/migration değiştirilmeden verifier-only savepoint izolasyonu eklendi ve exact tekrar yeşil sonuç verdi.

## Gate sonuçları

- Focused: 5 dosya / 22 test PASS
- `npm run typecheck` — PASS
- `npm run db:check` — PASS
- `npm run check:security-boundaries` — PASS (9 test dahil)
- `git diff --check` — PASS
- İki bağımsız critical preflight review sonrası apply onayı; postflight root tarafından tekrarlandı

## Açık P04 işleri

Budget reference resolver/dry-run, Kılavuz Agentı explicit transfer boundary, template/import compatibility ve P06 action invalidation consumer'ı sonraki alt paketlerdir. P04 paketi bütünü henüz tamamlanmış değildir.
