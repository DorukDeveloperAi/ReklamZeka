# P06-G — Rename execution-v2 + typed Meta transport foundation

**Karar:** ŞEMASIZ KABUL / DEFAULT-OFF. Execution-v2 ve tek Meta transport, campaign/ad-set/ad rename'i exact current-name → desired-name değişimi olarak taşıyabilir. Persisted execution source/worker route henüz rename kabul etmediği için production dispatch kapalı kalır.

## Güvenlik özellikleri

- Rename request yalnız `campaign_rename | adset_rename | ad_rename`; budget/currency null; status ve budget değişmeden kalır; before/after name farklı, trimmed, control-character içermeyen ve en çok 255 karakterdir.
- Idempotency digest exact before/desired name değerlerini de bağlar.
- Execution aynı on adımı, beş central gate snapshot'ını, lease/fence, read-before-write, RAW hash, ambiguous read-before-retry, max-one-write ve immutable terminal/rollback sözleşmesini kullanır.
- Meta transport rename okumalarında yalnız `id,status,effective_status,name`, mutation'da yalnız form-encoded `name` gönderir; raw response kalıcılaştırılmaz, yalnız hash receipt döner.
- Ad hedefi yalnız rename için açıldı; status/budget ad write hâlâ fail-closed.
- Current persisted dispatch-authority repository rename'i açıkça reddeder. Böylece bu domain/transport genişlemesi tek başına production authority üretmez.

## Kanıt

- `tests/p06-execution-v2.test.ts`: coherent rename success; same-name ve status-drift rejection.
- `tests/p06-meta-status-writer.test.ts`: gerçek 10-step writer zincirinde exact GET fields, tek POST `name`, desired-state verify ve zero second mutation.
- Focused: 21/21 PASS; full TypeScript ve `git diff --check` PASS.

## Açık sınır

Rename için tenant-bound immutable execution source, approved decision/grant FK, execution-run constraint/repository parity, current dispatch authority ve POST fixture ayrı forward migration tranche'ıdır. P08 protected human pilot öncesinde bu zincir tamamlanmalı; rollout flag'leri bu teslimde değişmedi.
