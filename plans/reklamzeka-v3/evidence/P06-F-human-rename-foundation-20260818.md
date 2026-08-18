# P06-F — Human-only rename foundation

**Karar:** KABUL. Campaign/ad-set/ad rename, ActionPlan → immutable ActionUnit → tek insan onayı → current-name preflight → disabled execution admission zincirinde K3/human-only olarak bağlandı. Create/raw ve limited-autonomy kapsamı genişletilmedi; gerçek Meta write rollout'u kapalıdır.

## Migration ve ledger

- Migration: `drizzle/20260818001000_p06_human_rename_foundation.sql`
- SHA-256: `2307b289dfda410895d57e1dd04be06059e959e3fea5619f86785fbf8e6ac3ce`
- Journal: `idx=126`, `when=1787011800000`
- PostgreSQL ledger: `id=143`, aynı hash ve timestamp ile exact tek tuple
- POST verifier: `npm run verify:p06-human-rename-foundation-db:post`

## Kapanan zincir

- `TypedActionIntent.rename` yalnız campaign/adset/ad seviyesinde, exact before/after name ve naming evidence ref ile kabul edilir; aynı, boş, control-character veya 255 karakter üstü adlar reddedilir.
- Rename action types daima `K3` ve `approval_required` üretir. Policy-limited input bile rename'i autonomy yoluna taşıyamaz.
- Proposal queue, published exact rename/K3 ApprovalPolicy ister; Policy Bundle Studio bu üç exact policy'yi oluşturabilir.
- Queue read/UI `entity_name` before/after projeksiyonunu public-safe gösterir; private naming-evidence ref dışarı çıkmaz.
- Meta write spec rename'i typed `previousName/desiredName` mutation'a çevirir; eligibility current mirror adının approved `beforeName` ile exact eşleşmesini zorunlu kılar.
- Admission yalnız ayrı human approval/grant/presence ve güncel plan/context/source/spec kanıtıyla `admitted_for_disabled_executor` döndürür; `canExecute/canWriteMeta/canDispatchNetwork=false` kalır.
- Guardrail selector rename türlerini kapsar ve deny evidence insan önerisini fail-closed durdurabilir.

## PostgreSQL PRE/POST kanıtı

Outer-rollback PRE ve uygulanmış-şema POST aynı canonical campaign-rename fixture'ını kullandı. Aşağıdaki bayrakların tamamı `true` oldu:

- `exactMigrationLedger`, `exactConstraints`
- `canonicalRenameQueued`, `exactReplay`, `publicRenameProjection`
- `humanOnly`, `noAutonomyWidening`, `createRawAbsent`
- `journalUnchanged`, `zeroResidue`

## Regresyon kapıları

- Full suite: 560 test dosyası / 2715 test PASS
- Production build ve secret-artifact taraması PASS
- TypeScript, Drizzle `db:check`, architecture/model/analysis gates PASS
- Security boundaries ve Supabase RLS/grant denetimi PASS (`186/186` RLS enabled; public API table/routine grants `0`)
- `git diff --check` PASS

## Açık sınır

Bu tranche gerçek network write yetkisi açmaz. P06 execution-v2 persistence/worker ve Meta adapter hâlâ yalnız status/budget taşır; rename için persisted execution source + typed writer genişletmesi ve P08 protected human pilot ayrıca kanıtlanmalıdır.
