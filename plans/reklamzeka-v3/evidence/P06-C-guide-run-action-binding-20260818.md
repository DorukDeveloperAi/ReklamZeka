# P06-C — Guide Run disposition → ActionUnit binding

**Karar:** PRE APPLY APPROVE; uygulanmış migration için yerel POST davranış ve iki-client kanıtı yeşil. Bu alt paket yalnız `status_pause` / `status_activate` ad-set adaylarını insan onaylı kuyruğa hazırlar; onay, execution ve Meta write yetkisi üretmez.

## Teslim edilen sınır

- P05 `candidate/1.1` disposition artifact'i; frozen scope `memberRef`/`membershipHash`, typed status action ve canonical candidate hash ile bağlanır.
- Frozen public member kimliği, aynı tenant/current slice kanıtıyla doğrulanır ve server tarafında exact external account/campaign/ad-set kimliğine çevrilir. Public alias ActionUnit writable entity alanına taşınmaz.
- Aktif Guide head, tamamlanmış Guide Run, immutable disposition/scope artifact'i, current membership, current status, published agent-requester approval policy, data health, autonomy/kill, protection/guardrail ve Effective Guide overlap aynı transaction içinde fail-closed çözülür.
- Agent yalnız proposal requester olabilir; approve/grant/consume yetkileri kapalıdır. Budget/campaign/ad/create ve unsupported action yolları bu tranche'ta fail-closed kalır.
- `guide_run_action_bindings` append-only, tenant composite FK'li, workspace-wide tek ActionUnit ve tek disposition bağlamalıdır; FORCE RLS, grant revoke ve tombstone child-first purge aktiftir.

## Migration / ledger

- `20260817210000_p06_action_bindings.sql`: SHA-256 `80acbf6ed18aba667c9d40f822d6dbaf85766293c2a897afa5f5c0d576f8f70a`, journal idx `116`, ledger id `133`, timestamp `1787000400000`.
- `20260818000100_p06_agent_action_requester.sql`: SHA-256 `9ab5ca9918975484f6d5d0d11ece68e5d6b2251c7df86b235f34ac37b401c5c7`, journal idx `117`, ledger id `134`, timestamp `1787011260000`.

## Kanıt

- PRE outer rollback: gerçek P03 current-slice + P04/P06 context + P05 completed run/disposition + ActionProposal queue/materializer/replay; stale head, candidate/hash/authority tamper, wrong scope, cross-tenant, append/delete, tombstone ve zero-residue bayraklarının tamamı `true`.
- POST: iki farklı PostgreSQL client aynı ikinci completed run için gerçek repository `bind()` çağrısı yaptı; exactly-one materialize + exactly-one replay ve aynı binding id doğrulandı. Fixture tombstone purge sonrası P06 binding satırı `0`.
- Uygulanmış katalog: FORCE/ENABLE RLS, zero policies, zero PUBLIC/anon/authenticated/service_role grants, 10 index, 7 validated constraint, enabled append-only trigger.
- Focused 7 dosya / 46 test, full TypeScript, Drizzle schema check, security boundaries 9/9 ve diff-check yeşil.

## Açık kalanlar

- Budget action staging authoritative parent/pool ceiling tamamlanana dek fail-closed.
- Campaign aggregate geo/protection kanıtı olmadığından campaign status staging fail-closed.
- P06 defer/rename persistence, limited-autonomy quota ve gerçek execution-v2/Meta writer/rollback worker sonraki migration tranche'larıdır.
