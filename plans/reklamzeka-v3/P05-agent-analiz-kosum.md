# P05 — agent-analiz-kosum

**Bağımlılık:** P04. **DoD:** R3-14–R3-16.

## İki Agent

- Guide Agent (`guide_policy`) yalnız Kılavuz ifadesi/eksik sorular ve kaynak referansı önerir; Kılavuz/policy/action save, publish, approval ve Meta write yapmaz.
- Daily Analysis Agent (`daily_analysis`) Kılavuzun frozen slice+frequency+mode+closed-actions bağlamında holistic analiz yapar; Kılavuz edit etmez, direct authority kullanmaz.

## Koşum, bulgu ve DevLog

Scheduler idempotenttir. Kullanıcı sözleşmesindeki koşum state machine tam olarak `due → claimed → scope_frozen → analyzing → recorded → held|staged|no_action → completed` akışıdır; `failed` ve `missed` terminal/istisna durumlarıdır. Missed koşumlar coalesce edilir. Koşum zaman değişimi/eşdeğer kohort/Meta evidence üzerinden finding ve recommendation; mode izin verirse staged action candidate üretir. Finding fingerprint, lifecycle ve observations taşır. Yetersiz zaman/kohort kesin yargı değil observe/uncertain sonucudur. DevLog kategorilidir; agent katkısı `agent-proposed-only`dir, kullanıcı actionı değildir.

## Test, rollout, rollback

Duplicate scheduler/missed coalescing, frozen binding/replay/tamper, no-guide-edit/direct-write, finding dedupe/lifecycle/observation, DevLog category/provenance, evidence insufficiency ve mode-gated staging negatifleri kabul edilir. Koşum flag’i kapanır, frozen ledger/DevLog korunur.
