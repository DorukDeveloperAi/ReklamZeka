# P06 — karar-otonomi-uygulama

**Bağımlılık:** P05. **DoD:** R3-17–R3-19.

## Karar ve overlap

Candidate/finding/recommendation Kılavuz scope ve en kısıtlayıcı overlap kuralıyla değerlendirilir. Tek yetkili insan approve/reject/defer eder. Human-approved action budget, status ve rename’dir; rename yalnız insan yoludur. Create yoktur.

## Otonomi ve executor

Limited autonomy admission yalnız Kılavuzdaki mode/closed action, market/slice, zaman penceresi, sayı ve tutar/oran limitleri içinde budget/status’a izin verir. Executor on adımı sırası değişmezdir: **1 lease, 2 idempotency, 3 current Meta read, 4 expected-before, 5 typed mutation, 6 RAW, 7 already-applied no second write, 8 ambiguous transport read-before-retry, 9 immutable terminal, 10 release.**

Rollback, previous observed value, action correlation, failure sınıflaması ve doğrulama sonucunu immutable geçmişe bağlar; kill switch staged/human/autonomy tüm Meta write yollarını kapatır.

## Test, rollout, rollback

Approval chain, overlap order, rename-human-only/create-deny, autonomy admission/limit/bypass, executor 10-step, idempotent replay, preflight, RAW failure, kill-switch ve rollback tests. Default Meta write off; protected pilot P08’de açılır.
