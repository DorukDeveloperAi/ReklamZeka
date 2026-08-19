# P02-B — Naming template saf domain

- `deliveryRef`: P02-B-naming-template-domain-20260817
- Durum: alt domain teslimi kabul edildi; persistence/preview/publish/assignment akışı açık olduğu için P02 paketi tamamlanmadı.
- Contract: account-scoped campaign/ad-set naming family; structured Unicode alnum token rules; arbitrary regex/metachar yok; immutable revision/hash.
- Lifecycle: revision 1 yalnız draft; draft→draft|published, published→draft|disabled, disabled terminal; revision+1 ve previous hash exact.
- Evidence: isim kuralına ek olarak objective/optimization/geo/targeting/platform/creative/CTA/destination türlerinden en az bir canonical corroboration zorunlu. Missing/partial/conflict ayrıdır.
- Replay: deterministic `candidate|conflict|insufficient_evidence`; yalnız gerçekten kullanılan evidence refs sonucu/hash'i etkiler; unrelated fact etkilemez.
- Künye: yalnız mevcut canonical dimension/definition public refs önerilir; paralel taxonomy yok. Manual lock bütün önerilerden üstündür.
- Authority: propose-only; assign/publish/approve/execute/Meta write false.
- Güvenlik: bounded rules/evidence/assignments; raw Meta ID/name/creative text public candidate'a taşınmaz; property-order bağımsız exact canonical validation ve extra-key rejection.
- Test: `tests/naming-template.test.ts` 10/10; typecheck, security-boundaries, db:check ve diff-check PASS.
- Migration: yok.
