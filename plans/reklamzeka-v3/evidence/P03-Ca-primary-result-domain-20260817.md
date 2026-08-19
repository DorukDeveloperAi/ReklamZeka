# P03-Ca — Primary Result Domain Evidence

- `deliveryRef`: `P03-Ca-primary-result-domain-20260817`
- Plan: `P03-slice-operasyon-rapor`
- Requirements: R3-08, R3-09
- Code snapshots: `6b7e9b1` + final semantic follow-up commit

## Public contract

- Primary result selector is closed to canonical `actions/<action_type>` values.
- Trusted action catalog can only be minted by the server-only, tenant-scoped Drizzle adapter reading canonical daily insight metrics in a repeatable-read/read-only transaction.
- No public registrar, caller-provided action list, source hash or structural catalog port exists.
- Runtime WeakSet identity rejects recomputed or cloned catalog artifacts.
- Resolution is recomputed from canonical workspace/scope and immutable binding revisions; caller-supplied resolution envelopes are not accepted.
- Slice binding overrides organization-campaign binding; an explicit slice unbind restores organization-campaign fallback.
- Known zero result remains known zero, but result cost is `null`; missing evidence is never converted to zero.
- Ratio-of-sums uses bounded decimal arithmetic and fails closed on attribution/currency inconsistency.

## Gates

- `tests/primary-result-domain.test.ts`: 10/10 PASS.
- `npm run typecheck`: PASS.
- `node scripts/check-architecture.mjs`: PASS.
- `git diff --check`: PASS.
- Independent final review: ACCEPT; forged closed/invented catalogs, scope/reason tamper, hostile nested shapes, bounds and immutability checked.

## Authority

- Database mutation: none.
- Meta network/write: none.
- Guide/policy/action/approval authority: none.

## Open follow-up

Binding revision/head persistence, mutation HTTP, Operation `2.0.0` projection and UI remain a separate dependent vertical after the active P01 schema migration is accepted.
