# P03-Cb — Primary result binding persistence kanıtı

## Kabul edilen kapsam

- Kurum Kampanyası veya slice subject'ine bağlı immutable primary-result binding revision zinciri.
- `bound | unbound` state, OCC head, exact idempotency ve slice-unbound → organization campaign fallback.
- Yalnız server-trusted canonical Meta action cataloguyla bound revision yazımı.
- Yerli/Yabancı market ve tenant composite FK sınırı; subject XOR.
- Server-side membership role doğrulaması; caller `actorRole` yetki kaynağı değildir.
- Active workspace/non-tombstoned subject kilidi; tombstone sırasında write reddi ve read boşluğu.
- RLS ENABLE+FORCE, Data API dark grants, append-only revision ve exact head guards.
- Workspace tombstone inspect/purge child-first entegrasyonu.

## Migration ve canlı kanıt

- Migration: `20260817162000_primary_result_binding_lifecycle.sql`.
- Journal: `idx=113`.
- Drizzle ledger: `id=130`.
- File/ledger SHA-256: `6f5f1c56c91b762aab5e0e6645aa030633fc43c81e0c58b4b19e5bd94ff865cd`.
- PRE: unjournaled outer rollback; schema objects ve fixture residue sıfır.
- POST: gerçek iki writer pool yarışında tam bir advance + tam bir conflict; WorkspaceTombstoneService cleanup.
- POST flags: bound, rebind, unbound, fallback, exact replay, forged-role reject, cross-tenant/market reject, append-only/head guard, RLS/FORCE, no policies, revoked grants, required FK indexes, named `UNIQUE NULLS NOT DISTINCT` constraints, tombstone write/read, cleanup zero.

## Global fixture identity remediasyonu

İlk POST verifier sürümü global sentetik kullanıcı oluşturuyordu. Exact FK denetiminde sıfır referanslı üç analyst fixture kullanıcısı exact-ID transaction ile silindi; üç owner fixture kullanıcısı 12 immutable tombstone audit event'inin aktörü olduğu için korundu. Verifier artık kullanıcı yaratmaz; exact mevcut local owner'ı kullanır ve `globalUserDeltaZero` zorunludur. Bağımsız son POST tekrarında sayı 3→3 kaldı; her retained kullanıcı dört audit ref ve sıfır membership taşıyor.

## Gate'ler

- Bağımsız kritik PRE: `APPLY APPROVE`.
- Bağımsız kritik POST: `POST ACCEPT`.
- Focused persistence/domain tests: 17/17 geçti.
- `npm run typecheck`, `npm run db:check`, `npm run check:security-boundaries`, `npm run check:architecture`, `git diff --check`: geçti.

## Açık kalan kapsam

`operation-read/2.0.0` projection, bounded primary-result metric query, decimal-string UI parser ve browser states P03-Cc olarak açıktır. Saved views ve ayrı Kapsam Raporu da P03 paketini açık tutar.
