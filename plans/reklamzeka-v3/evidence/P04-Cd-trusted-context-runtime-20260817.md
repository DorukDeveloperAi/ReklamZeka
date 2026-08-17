# P04-Cd — Trusted context runtime

**Karar:** Kabul edildi; production fail-closed context/admission kompozisyonu. Authoritative parent ceiling olmadığından gerçek stage happy-path hâlâ kapalıdır.

## Sözleşme

- Budget owner public alias yalnız tenant-bound canonical mirror üzerinde doğrulanır; ActionIntent ve budget owner queue kimliği exact external account/campaign/ad-set refidir.
- Outer REPEATABLE READ / READ ONLY transaction health, published approval policy, autonomy rules/kill-switch, current effective context, categories, protection ve guardrail kanıtını aynı snapshotta çözer.
- Policy/autonomy/guardrail ve affected-geo readerları lock/nested transaction kullanmaz; canonical artifact/head/hash validatorları korunur.
- ABO affected-geo exact snapshot/ordered children/hash kanıtı read-only çözülür. Complete campaign-wide CBO geo aggregate yoksa `protection_unavailable` hold kalır.
- Health report hash'i frozen context/plan hash'e bağlıdır; aynı readiness altında health head değişimi admission drift üretir.
- Local admission runtime caller-supplied Guide gate kabul etmez; server-owned canonical gate'i içeride kurar.
- Draft/recommendation-only Budget Lab parent ceiling sayılmaz. Authoritative ceiling yoksa `parent_ceiling_unavailable`; queue/approve/execute/Meta capability yoktur.

## Kanıt

- Bağımsız kritik final: ACCEPT.
- Focused 6 dosya / 31 test PASS; typecheck ve diff-check PASS.
- Canlı RR/RO Drizzle probe önceki SQLSTATE 25006 yolunu kapattı; transaction RR/read-only kaldı.
- Hostile alias mismatch held; staged fake testte public alias ActionIntent/budgetOwner reflerine sızmadı.
- Caller gate override API'den kaldırıldı; same-ready/different health report hash admissionı kapattı.

## Açık işler

- Canonical parent/pool ceiling source ve Guide limit binding
- Complete CBO campaign geo aggregation
- Real stage→single-human approval→admission PostgreSQL/browser kabulü
- P06 executor/rollback/Meta writer
