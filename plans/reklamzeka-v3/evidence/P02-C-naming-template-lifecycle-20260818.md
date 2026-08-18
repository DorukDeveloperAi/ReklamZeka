# P02-C — Naming template lifecycle, preview and UI

Status: PRE candidate. Migration is intentionally unapplied and unjournaled pending an independent critical PRE review.

## Delivered

- Immutable tenant/account-bound naming-template revisions with OCC heads and deterministic command replay.
- Draft/published/disabled state machine; publishing and disabling require owner/admin while analysts may draft.
- Closed authority: templates may only propose. They cannot assign a category, publish themselves, approve, execute, or write Meta.
- Server-owned public account/entity resolution. The browser never supplies a workspace or actor identity.
- Repeatable-read/read-only preview evidence from canonical campaign/ad-set names, objective, optimization, platform, and current category assignments/manual locks.
- Unsupported corroboration remains `missing`, so a name alone never becomes a category proposal.
- Same-origin cookie/session/intent API and a Künye UI with explicit before/after evidence. The UI exposes no assignment or Meta-write operation.
- FORCE RLS, zero API-role grants/policies, append-only guards, FK indexes, bounded JSON, tombstone-only child-first purge.

## PRE evidence

`npm run verify:naming-template-postgres`:

```json
{"mode":"pre_outer_rollback","sha256":"0a9946883970dc83d00bb9c4979869691fb12e047385e7e8cef8ee39de476fbb","migrationInstalled":true,"created":true,"exactReplay":true,"occAdvance":true,"canonicalPreviewFailClosed":true,"staleRejected":true,"invalidTransitionRejected":true,"hashTamperRejected":true,"jsonTypeForgeryRejected":true,"nonCanonicalOrderRejected":true,"nonNormalizedTokenRejected":true,"headTimestampForgeryRejected":true,"appendOnly":true,"listCurrent":true,"transactionContracts":true,"catalog":true,"unjournaled":true,"zeroResidue":true}
```

Current gates:

- Full suite: 554 files / 2694 tests passed.
- Focused P02/tombstone: 5 files / 22 tests passed.
- TypeScript, Drizzle `db:check`, architecture/model boundaries, Supabase security audit, and `git diff --check` passed.
- `npm audit --omit=dev`: zero vulnerabilities. The full dev audit retains four moderate `esbuild` findings through the current Drizzle toolchain; the offered fix is a breaking downgrade and was not applied.

## Explicit open gates

- Independent critical PRE review, controlled apply/journal, and POST ledger/catalog verification.
- Authenticated browser acceptance with real tenant mirror rows at 320/390/768/1024/1440 px.
- Explicit user category-assignment action remains in the existing Category Registry flow; preview does not silently perform it.
