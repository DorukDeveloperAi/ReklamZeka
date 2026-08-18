# P06-E — Execution/ceiling/autonomy POST acceptance

**Karar:** KABUL. 003–007 zinciri PRE, kontrollü journal/apply ve uygulanmış-şema POST kapılarından geçmiştir. Rollout/Meta-write bayrakları açılmamıştır.

## Exact PRE dosyaları

| Migration | SHA-256 | Durum |
|---|---|---|
| `20260818000300_p06_execution_persistence.sql` | `952d187fdb951642258adbeb4a276787dfca14eab3f3913a5ecc6a5b69ab075b` | idx119 / ledger id136 |
| `20260818000400_p04_budget_ceiling_policies.sql` | `fae39dde58c2793a2cf1b879d44cdc72a5448e28eace66b45e2ea99e15753468` | idx120 / ledger id137 |
| `20260818000500_p06_budget_execution_binding.sql` | `6fb04c9bde98426fe374813eeb5202b8b041dcfa4784056e3a4d54b500b6e4c6` | idx121 / ledger id138 |
| `20260818000600_p06_limited_autonomy_admissions.sql` | `bca225d1e82687d845d3fb213a2b1ceacf6ad464184128b8f72bd17b9c5aae25` | idx122 / ledger id139 |
| `20260818000700_p06_limited_autonomy_execution.sql` | `daeb75865eba3230fc8fce929f7055e8d006f77f1525ceaff7b49edf699b7ea2` | idx123 / ledger id140 |

## Bu turda kapanan fail-open sınıfları

- Human-approved status/budget execution artık grant expiry'yi caller `evaluatedAt` yerine PostgreSQL `statement_timestamp()` ile doğrular. Süresi dolmuş grant + geçmiş timestamp materialization regresyonu reddedilir.
- Limited-autonomy admission `admitted_at`, aynı transaction'ın millisecond-normalized `transaction_timestamp()` değerine exact bağlıdır. Hash'i yeniden hesaplanmış backdated direct INSERT reddedilir.
- Lease claim/reclaim, trace fence ve late gate lease canlılığı caller `now/updated_at` yerine PostgreSQL `statement_timestamp()` ile doğrulanır. Aktif lease gelecekteki sahte caller time ile erken reclaim edilemez; gerçek expiry sonrası epoch+1 reclaim geçer.
- Head `updated_at`, exact persisted event `occurred_at` değerine bağlanır; terminal release için lease DB saatinde hâlâ canlı olmalıdır.

## Davranış kanıtı

- Execution chain PRE: canonical ActionUnit + insan approval/grant → identity → pending/runnable → claim → phased gates → exact 10 step → observations → success ve verification_failed → immutable rollback proposal/replay. `callerTimeCannotReclaim`, `expiredGrantMaterializationRejected`, stale fence, forged event, cross-tenant, superseded Guide hold ve zero residue değerlerinin tamamı `true`.
- Budget behavior PRE: canonical queue/admission, human approval, budget run/replay, source XOR, dry-run/mirror tamper, no-authority, dispatch fail-closed ve zero residue değerlerinin tamamı `true`.
- Limited autonomy PRE: canonical source/context/policy, atomic quota, replay, action-plan/no-authority, null forgery, backdated admission, disabled-rule hold, execution identity/replay, no-human-authority, current authority, backdated execution, kill switch ve zero residue değerlerinin tamamı `true`.
- Ceiling PRE: dört layer, persisted min-resolution, hash/chain/identity/immutability negatives, FORCE RLS/revoke ve zero residue değerlerinin tamamı `true`.

## Katalog ve güvenlik

- 003/004/005/006 katalog verifierları exact hash ile exit 0; bütün hedefler unjournaled ve rollback sonrası yok.
- 003 tablolarında FORCE RLS, zero policies, PUBLIC/anon/authenticated/service_role revoke, validated constraints, FK indexes ve enabled triggers doğrulandı.
- `npm run db:check`, TypeScript ve `git diff --check` yeşil.

## Kalan rollout sınırı

- Authenticated browser ve protected gerçek Meta pilot, kullanıcı capability girişi ve açık action-time onayı gerektirir.
- Hiçbir rollout/Meta write bayrağı migration apply ile otomatik açılmamıştır.
