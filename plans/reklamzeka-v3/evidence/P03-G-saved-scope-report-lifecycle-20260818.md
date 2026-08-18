# P03-G — Kayıtlı Kapsam Raporu yaşam döngüsü PRE adayı

## Teslim

- `saved-scope-report/1.0.0` kanonik sorgu sözleşmesi Slice, dönem, granularity, level, metric, action ve sort bağlamını exact doğrular; 366 gün üstü ve takvim dışı dönemler reddedilir.
- PRE-only `20260818000800_scope_report_saved_reports.sql`, immutable revision + tek OCC head zinciri, exact hash/ref, tenant FK, current published Slice, aktif actor, append-only/tombstone-only delete, FORCE RLS ve sıfır public/client grant uygular.
- Server-only Drizzle repository create/replay/advance/list işlemlerini serializable veya RR/read-only transaction içinde yürütür. Workspace ve actor HTTP gövdesinden alınmaz.
- `/api/scope-report-saved` cookie-only same-origin boundary’si `scope_report:read` ve `scope_report:save` capability’lerini ayrı doğrular; GET list ve POST save exact intent taşır. Her yanıt no-store ve Meta/approval/execution authority `none/disabled` taşır.
- Kapsam Raporu paneli mevcut submitted sorguyu kaydeder, kayıtlı active sorguyu forma geri yükleyip kanonik read endpoint’inden yeniden çalıştırır. Kaydedilen şey sonuç snapshot’ı veya aksiyon değil, yalnız sorgu tanımıdır.

## PRE kanıtı

`npm run verify:scope-report-saved-postgres` outer rollback altında exit 0:

```json
{"mode":"pre_outer_rollback","sha256":"cff26151da3ea44fccffe0a85e3ad48596c46a71b4b8a95a455b237c5bb314dd","migrationInstalled":true,"created":true,"exactReplay":true,"replayExpectedVersionBound":true,"occAdvance":true,"staleRejected":true,"hashTamperRejected":true,"jsonTypeForgeryRejected":true,"headTimestampForgeryRejected":true,"appendOnly":true,"listCurrent":true,"transactionContracts":true,"catalog":true,"unjournaled":true,"zeroResidue":true}
```

- Odak: 8 dosya / 26 test PASS.
- Full suite: 550 dosya / 2681 test PASS.
- `typecheck`, `db:check`, architecture, model-provider boundary, security boundaries, `npm audit --omit=dev`, `git diff --check`: PASS.
- Migration uygulanmadı, journal veya DB migration ledger’a yazılmadı; verifier sonrası iki tablo da yok.

## Açık kapılar

- Bağımsız kritik PRE incelemesi olmadan apply/journal yapılmaz.
- Apply sonrası exact file hash + journal + DB ledger tuple ve iki-client replay/OCC POST kabulü gerekir.
- Gerçek signed-in browser save/list/reload/320px/a11y kabulü kullanıcı local-session capability’siyle ayrıca çalıştırılmalıdır.
